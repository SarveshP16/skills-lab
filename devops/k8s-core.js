/* sudo learn — DevOps Module 4: a simulated Kubernetes cluster (kestrel-staging, v1.31). This file is the API
   server: resource kinds, the object store, quantities and label selectors, defaulting, validation worded like
   the real API server (strict decoding errors, "The Deployment "x" is invalid: ..."), admission (namespaces,
   Pod Security Admission, webhook hooks for Kyverno), RBAC authorisation and events. Controllers, the
   scheduler and the kubelet (pods run as real simulated containers on the Docker engine) are in k8s-run.js;
   kubectl is in k8s-kubectl.js. The cluster lives on the laptop's machine object (home.k8s), like GitHub. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, CI = root.CI;
  var K = root.K8s = root.K8s || {};
  function keys(o) { return o ? Object.keys(o) : []; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o, function (k, v) { return k === "_rt" || k === "_cert" || k === "_e" ? undefined : v; })); }
  function isObj(o) { return o && typeof o === "object" && !Array.isArray(o); }
  K.keys = keys; K.clone = clone; K.isObj = isObj;
  function ipn(ip) { return String(ip).split(".").reduce(function (n, x) { return n * 256 + (+x); }, 0); }
  K.inCidr = function (ip, c) { if (!ip || !c) return false; var m = String(c).split("/"), p = +(m[1] == null ? 32 : m[1]); if (p === 0) return true; var sz = Math.pow(2, 32 - p); return Math.floor(ipn(ip) / sz) === Math.floor(ipn(m[0]) / sz); };

  /* ================================================================== resource kinds */
  var KINDS = {};
  function kind(name, plural, short, gv, ns, o) { KINDS[name] = Object.assign({ kind: name, plural: plural, short: short || [], gv: gv, ns: ns, group: gv.indexOf("/") > 0 ? gv.split("/")[0] : "" }, o || {}); }
  kind("Pod", "pods", ["po"], "v1", true);
  kind("Service", "services", ["svc"], "v1", true);
  kind("Endpoints", "endpoints", ["ep"], "v1", true);
  kind("ConfigMap", "configmaps", ["cm"], "v1", true);
  kind("Secret", "secrets", [], "v1", true);
  kind("Namespace", "namespaces", ["ns"], "v1", false);
  kind("Node", "nodes", ["no"], "v1", false);
  kind("PersistentVolumeClaim", "persistentvolumeclaims", ["pvc"], "v1", true);
  kind("PersistentVolume", "persistentvolumes", ["pv"], "v1", false);
  kind("ServiceAccount", "serviceaccounts", ["sa"], "v1", true);
  kind("Event", "events", ["ev"], "v1", true);
  kind("ResourceQuota", "resourcequotas", ["quota"], "v1", true);
  kind("LimitRange", "limitranges", ["limits"], "v1", true);
  kind("Deployment", "deployments", ["deploy"], "apps/v1", true);
  kind("ReplicaSet", "replicasets", ["rs"], "apps/v1", true);
  kind("StatefulSet", "statefulsets", ["sts"], "apps/v1", true);
  kind("DaemonSet", "daemonsets", ["ds"], "apps/v1", true);
  kind("Job", "jobs", [], "batch/v1", true);
  kind("CronJob", "cronjobs", ["cj"], "batch/v1", true);
  kind("Ingress", "ingresses", ["ing"], "networking.k8s.io/v1", true);
  kind("IngressClass", "ingressclasses", [], "networking.k8s.io/v1", false);
  kind("NetworkPolicy", "networkpolicies", ["netpol"], "networking.k8s.io/v1", true);
  kind("HorizontalPodAutoscaler", "horizontalpodautoscalers", ["hpa"], "autoscaling/v2", true);
  kind("PodDisruptionBudget", "poddisruptionbudgets", ["pdb"], "policy/v1", true);
  kind("Role", "roles", [], "rbac.authorization.k8s.io/v1", true);
  kind("RoleBinding", "rolebindings", [], "rbac.authorization.k8s.io/v1", true);
  kind("ClusterRole", "clusterroles", [], "rbac.authorization.k8s.io/v1", false);
  kind("ClusterRoleBinding", "clusterrolebindings", [], "rbac.authorization.k8s.io/v1", false);
  kind("StorageClass", "storageclasses", ["sc"], "storage.k8s.io/v1", false);
  kind("Certificate", "certificates", ["cert", "certs"], "cert-manager.io/v1", true, { crd: "certManager" });
  kind("ClusterIssuer", "clusterissuers", [], "cert-manager.io/v1", false, { crd: "certManager" });
  kind("ClusterPolicy", "clusterpolicies", ["cpol"], "kyverno.io/v1", false, { crd: "kyverno" });
  kind("Policy", "policies", ["pol"], "kyverno.io/v1", true, { crd: "kyverno" });
  kind("PolicyReport", "policyreports", ["polr"], "wgpolicyk8s.io/v1alpha2", true, { crd: "kyverno" });
  kind("Application", "applications", ["app", "apps"], "argoproj.io/v1alpha1", true, { crd: "argocd" });
  K.KINDS = KINDS;
  // "po", "pods", "pod", "deployments.apps", "deploy" -> kind info (or null)
  K.kindOf = function (cl, word) {
    var w = String(word || "").toLowerCase(), g = null;
    if (w.indexOf(".") > 0) { g = w.slice(w.indexOf(".") + 1); w = w.slice(0, w.indexOf(".")); }
    var hit = null;
    keys(KINDS).forEach(function (k) {
      var x = KINDS[k];
      if (hit) return;
      if (g && x.group !== g) return;
      if (x.kind.toLowerCase() === w || x.plural === w || x.short.indexOf(w) >= 0) hit = x;
    });
    if (hit && hit.crd && cl && !cl.comps[hit.crd]) return null;
    if (hit && hit.short.indexOf("apps") >= 0 && w === "apps" && !g) return cl && cl.comps.argocd ? hit : null;
    return hit;
  };
  K.byKind = function (cl, k, apiVersion) {
    var x = KINDS[k]; if (!x) return null;
    if (apiVersion && x.gv !== apiVersion && !(x.kind === "HorizontalPodAutoscaler" && /^autoscaling\/v[12]$/.test(apiVersion))) return null;
    if (x.crd && cl && !cl.comps[x.crd]) return null;
    return x;
  };

  /* ================================================================== quantities */
  K.cpu = function (q) { if (q == null || q === "") return 0; var s = String(q); if (/m$/.test(s)) return parseFloat(s); return Math.round(parseFloat(s) * 1000); };
  var BIN = { Ki: 1024, Mi: 1048576, Gi: 1073741824, Ti: 1099511627776 }, DEC = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, m: 0.001 };
  K.mem = function (q) { if (q == null || q === "") return 0; var m = /^([0-9.]+)([A-Za-z]*)$/.exec(String(q)); if (!m) return NaN; var n = parseFloat(m[1]), u = m[2]; if (!u) return n; if (BIN[u]) return n * BIN[u]; if (DEC[u]) return n * DEC[u]; return NaN; };
  K.validQty = function (q) { return /^([0-9]+(\.[0-9]+)?|\.[0-9]+)(m|k|M|G|T|Ki|Mi|Gi|Ti)?$/.test(String(q)); };
  K.memStr = function (b) { return b >= BIN.Gi && b % BIN.Gi === 0 ? b / BIN.Gi + "Gi" : Math.round(b / BIN.Mi) + "Mi"; };

  /* ================================================================== labels and selectors */
  // a LabelSelector object (matchLabels + matchExpressions) or a plain map
  K.matches = function (sel, labels) {
    labels = labels || {};
    if (!sel) return false;
    var ml = sel.matchLabels || (sel.matchExpressions ? {} : sel), me = sel.matchExpressions || [];
    if (!keys(ml).every(function (k) { return labels[k] === String(ml[k]); })) return false;
    return me.every(function (e) {
      var v = labels[e.key], vals = (e.values || []).map(String);
      if (e.operator === "In") return v !== undefined && vals.indexOf(v) >= 0;
      if (e.operator === "NotIn") return v === undefined || vals.indexOf(v) < 0;
      if (e.operator === "Exists") return v !== undefined;
      if (e.operator === "DoesNotExist") return v === undefined;
      return false;
    });
  };
  K.emptySel = function (sel) { return !sel || (!keys(sel.matchLabels || {}).length && !(sel.matchExpressions || []).length && !keys(sel).filter(function (k) { return k !== "matchLabels" && k !== "matchExpressions"; }).length); };
  // kubectl -l "app=notes,tier!=db,env in (a,b),!legacy"
  K.parseSel = function (s) {
    var parts = [], depth = 0, cur = "";
    String(s).split("").forEach(function (ch) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; });
    if (cur) parts.push(cur);
    var tests = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim(), m;
      if ((m = /^([\w./-]+)\s*(==|=|!=)\s*([\w.-]*)$/.exec(p))) tests.push({ k: m[1], op: m[2] === "!=" ? "ne" : "eq", v: m[3] });
      else if ((m = /^([\w./-]+)\s+(in|notin)\s*\(([^)]*)\)$/.exec(p))) tests.push({ k: m[1], op: m[2], vals: m[3].split(",").map(function (x) { return x.trim(); }) });
      else if ((m = /^!([\w./-]+)$/.exec(p))) tests.push({ k: m[1], op: "absent" });
      else if ((m = /^([\w./-]+)$/.exec(p))) tests.push({ k: m[1], op: "present" });
      else return { error: "unable to parse requirement: found '" + p + "', expected: identifier" };
    }
    return { test: function (labels) { labels = labels || {}; return tests.every(function (t) { var v = labels[t.k]; return t.op === "eq" ? v === t.v : t.op === "ne" ? v !== t.v : t.op === "in" ? t.vals.indexOf(v) >= 0 : t.op === "notin" ? t.vals.indexOf(v) < 0 : t.op === "absent" ? v === undefined : v !== undefined; }); } };
  };
  K.selStr = function (sel) { if (!sel) return "<none>"; var ml = sel.matchLabels || sel; return keys(ml).filter(function (k) { return k !== "matchExpressions"; }).map(function (k) { return k + "=" + ml[k]; }).concat((sel.matchExpressions || []).map(function (e) { return e.key + " " + e.operator.toLowerCase() + " (" + (e.values || []).join(",") + ")"; })).join(",") || "<none>"; };

  /* ================================================================== the cluster */
  K.of = function (sys) { var h = CI.homeSys(sys); return h.k8s || null; };
  K.t = function (cl) { return Dk.clock(cl.rt); };
  K.stamp = function (cl, t) { return new Date(Dk.stamp(cl.rt, t == null ? K.t(cl) : t)).toISOString().replace(/\.\d+Z$/, "Z"); };
  // Kubernetes' HumanDuration
  K.age = function (cl, t) {
    var s = Math.max(0, Math.floor(K.t(cl) - t)), m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400), y = Math.floor(d / 365);
    if (s < 120) return s + "s";
    if (m < 10) return s % 60 ? m + "m" + (s % 60) + "s" : m + "m";
    if (m < 180) return m + "m";
    if (h < 8) return m % 60 ? h + "h" + (m % 60) + "m" : h + "h";
    if (h < 48) return h + "h";
    if (h < 192) return h % 24 ? d + "d" + (h % 24) + "h" : d + "d";
    if (y < 2) return d + "d";
    return y + "y";
  };
  K.hex = function (seed, n) { return M2.hexOf(String(seed), n || 10); };
  var ALNUM = "bcdfghjklmnpqrstvwxz2456789";
  K.rand = function (seed, n) { return M2.hashChars ? M2.hashChars(String(seed), n, ALNUM) : K.hex(seed, n); };
  K.uid = function (cl, seed) { var h = K.hex("uid:" + cl.uidSeq++ + ":" + seed, 32); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32); };

  function newRuntime(home) {
    var rt = Dk.newCtrSys(home, S.dirNode(493, 0, 0), { hostname: "kestrel-staging", id: "k8s-runtime", distro: "ubuntu" });
    rt.dkCtr = undefined; rt.dkHost = undefined; rt.hubSys = home; rt.k8sRt = true; rt.host = "kestrel-staging";
    Dk.state(rt);
    return rt;
  }
  // Create the cluster. o: {comps: {ingress, certManager, kyverno, argocd, metrics}}
  K.make = function (sys, o) {
    o = o || {};
    var home = CI.homeSys(sys);
    var cl = home.k8s = {
      name: "kestrel-staging", server: "https://10.40.0.10:6443", version: "v1.31.4", rt: newRuntime(home), home: home,
      objs: {}, rv: 18342, uidSeq: 1, events: [], audit: [], ipSeq: { svc: 20, lb: 80 }, podIp: {}, nodeImages: {},
      comps: Object.assign({ metrics: true, ingress: true, certManager: false, kyverno: false, argocd: false }, o.comps || {}),
      load: {}, hooks: [], tokens: {}, created: -86400 * 41
    };
    K.current = cl;
    K.bootstrap(cl, o);
    return cl;
  };

  /* ================================================================== the object store */
  function bag(cl, k) { return cl.objs[k] || (cl.objs[k] = {}); }
  function okey(kindName, ns, name) { return KINDS[kindName] && KINDS[kindName].ns ? (ns || "default") + "/" + name : name; }
  K.bag = bag;
  K.get = function (cl, k, ns, name) { return bag(cl, k)[okey(k, ns, name)] || null; };
  K.list = function (cl, k, ns, sel) {
    var b = bag(cl, k);
    return keys(b).map(function (x) { return b[x]; }).filter(function (o) { return (!ns || !KINDS[k].ns || o.metadata.namespace === ns) && (!sel || sel(o.metadata.labels || {})); }).sort(function (a, b2) { return (a.metadata.namespace || "").localeCompare(b2.metadata.namespace || "") || a.metadata.name.localeCompare(b2.metadata.name); });
  };
  K.all = function (cl, k) { return K.list(cl, k, null); };
  // Store (create or replace) without admission: controllers and setup use this.
  K.store = function (cl, obj, o) {
    o = o || {};
    var k = obj.kind, md = obj.metadata = obj.metadata || {}, b = bag(cl, k), id = okey(k, md.namespace, md.name);
    var old = b[id];
    if (KINDS[k].ns && !md.namespace) md.namespace = "default";
    if (!KINDS[k].ns) delete md.namespace;
    obj.apiVersion = obj.apiVersion || KINDS[k].gv;
    md.uid = old ? old.metadata.uid : md.uid || K.uid(cl, k + id);
    md.creationTimestamp = old ? old.metadata.creationTimestamp : (md.creationTimestamp != null ? md.creationTimestamp : K.t(cl));
    md.resourceVersion = String(++cl.rv);
    if (/^(Deployment|StatefulSet|DaemonSet|ReplicaSet|Job|CronJob)$/.test(k)) md.generation = old ? (JSON.stringify(old.spec) === JSON.stringify(obj.spec) ? old.metadata.generation : (old.metadata.generation || 1) + 1) : 1;
    if (old && old._rt) obj._rt = old._rt;
    if (old && old._cert && !obj._cert && JSON.stringify(old.data) === JSON.stringify(obj.data)) obj._cert = old._cert;
    b[id] = obj;
    if (!o.quiet) cl.dirty = true;
    return obj;
  };
  K.unstore = function (cl, obj) { delete bag(cl, obj.kind)[okey(obj.kind, obj.metadata.namespace, obj.metadata.name)]; cl.dirty = true; };
  K.ownedBy = function (cl, owner, k) { return K.list(cl, k, owner.metadata.namespace).filter(function (o) { return (o.metadata.ownerReferences || []).some(function (r) { return r.uid === owner.metadata.uid; }); }); };
  K.ownerRef = function (o, ctl) { return { apiVersion: o.apiVersion, kind: o.kind, name: o.metadata.name, uid: o.metadata.uid, controller: ctl !== false, blockOwnerDeletion: true }; };
  K.ownerOf = function (cl, o) { var r = (o.metadata.ownerReferences || []).filter(function (x) { return x.controller; })[0]; if (!r) return null; var x = K.get(cl, r.kind, o.metadata.namespace, r.name); return x && x.metadata.uid === r.uid ? x : null; };
  // delete with garbage collection of owned objects (background propagation)
  K.remove = function (cl, obj) {
    K.unstore(cl, obj);
    if (K.onDelete) K.onDelete(cl, obj);
    keys(KINDS).forEach(function (k) { if (!KINDS[k].ns && obj.kind !== "Namespace") return; K.all(cl, k).forEach(function (o) { if ((o.metadata.ownerReferences || []).some(function (r) { return r.uid === obj.metadata.uid; })) K.remove(cl, o); }); });
    if (obj.kind === "Namespace") keys(KINDS).forEach(function (k) { if (KINDS[k].ns) K.list(cl, k, obj.metadata.name).forEach(function (o) { K.remove(cl, o); }); });
  };

  /* ================================================================== events */
  K.event = function (cl, obj, type, reason, msg, src) {
    var ns = obj.metadata.namespace || "default", t = K.t(cl);
    var e = cl.events.filter(function (x) { return x.uid === obj.metadata.uid && x.reason === reason && x.message === msg; })[0];
    if (e) { e.count++; e.last = t; cl.events.splice(cl.events.indexOf(e), 1); cl.events.push(e); return e; }
    e = { ns: ns, kind: obj.kind, name: obj.metadata.name, uid: obj.metadata.uid, type: type, reason: reason, message: msg, source: src || "", first: t, last: t, count: 1, id: K.rand("ev" + cl.events.length + obj.metadata.name, 16) };
    cl.events.push(e); if (cl.events.length > 600) cl.events.shift();
    return e;
  };
  K.eventsFor = function (cl, obj) { return cl.events.filter(function (e) { return e.uid === obj.metadata.uid; }); };

  /* ================================================================== field schemas (strict decoding) */
  var ANY = "any", MAP = "map";
  var META = { name: 1, generateName: 1, namespace: 1, labels: MAP, annotations: MAP, uid: 1, resourceVersion: 1, creationTimestamp: 1, generation: 1, ownerReferences: ANY, finalizers: ANY, managedFields: ANY, deletionTimestamp: 1, deletionGracePeriodSeconds: 1, selfLink: 1 };
  var SELECTOR = { matchLabels: MAP, matchExpressions: [{ key: 1, operator: 1, values: ANY }] };
  var PROBE = { httpGet: { path: 1, port: 1, host: 1, scheme: 1, httpHeaders: ANY }, tcpSocket: { port: 1, host: 1 }, exec: { command: ANY }, grpc: { port: 1, service: 1 }, initialDelaySeconds: 1, periodSeconds: 1, timeoutSeconds: 1, successThreshold: 1, failureThreshold: 1, terminationGracePeriodSeconds: 1 };
  var CSC = { runAsUser: 1, runAsGroup: 1, runAsNonRoot: 1, readOnlyRootFilesystem: 1, allowPrivilegeEscalation: 1, privileged: 1, capabilities: { add: ANY, drop: ANY }, seccompProfile: { type: 1, localhostProfile: 1 }, procMount: 1, seLinuxOptions: ANY, appArmorProfile: ANY };
  var KEYREF = { name: 1, key: 1, optional: 1 };
  var ENV = { name: 1, value: 1, valueFrom: { configMapKeyRef: KEYREF, secretKeyRef: KEYREF, fieldRef: { fieldPath: 1, apiVersion: 1 }, resourceFieldRef: ANY } };
  var CONTAINER = { name: 1, image: 1, command: ANY, args: ANY, workingDir: 1, ports: [{ containerPort: 1, name: 1, protocol: 1, hostPort: 1, hostIP: 1 }], env: [ENV], envFrom: [{ configMapRef: { name: 1, optional: 1 }, secretRef: { name: 1, optional: 1 }, prefix: 1 }],
    resources: { requests: MAP, limits: MAP, claims: ANY }, volumeMounts: [{ name: 1, mountPath: 1, readOnly: 1, subPath: 1, subPathExpr: 1, mountPropagation: 1 }], livenessProbe: PROBE, readinessProbe: PROBE, startupProbe: PROBE,
    imagePullPolicy: 1, securityContext: CSC, stdin: 1, stdinOnce: 1, tty: 1, lifecycle: ANY, terminationMessagePath: 1, terminationMessagePolicy: 1, restartPolicy: 1, resizePolicy: ANY, volumeDevices: ANY };
  var VOLUME = { name: 1, emptyDir: { medium: 1, sizeLimit: 1 }, configMap: { name: 1, items: [{ key: 1, path: 1, mode: 1 }], defaultMode: 1, optional: 1 }, secret: { secretName: 1, items: [{ key: 1, path: 1, mode: 1 }], defaultMode: 1, optional: 1 }, persistentVolumeClaim: { claimName: 1, readOnly: 1 }, hostPath: { path: 1, type: 1 }, projected: ANY, downwardAPI: ANY, ephemeral: ANY, csi: ANY, nfs: ANY };
  var PODSPEC = { containers: [CONTAINER], initContainers: [CONTAINER], volumes: [VOLUME], restartPolicy: 1, nodeSelector: MAP, nodeName: 1, serviceAccountName: 1, serviceAccount: 1, automountServiceAccountToken: 1, securityContext: { runAsUser: 1, runAsGroup: 1, runAsNonRoot: 1, fsGroup: 1, fsGroupChangePolicy: 1, seccompProfile: { type: 1, localhostProfile: 1 }, supplementalGroups: ANY, sysctls: ANY, seLinuxOptions: ANY, appArmorProfile: ANY },
    imagePullSecrets: [{ name: 1 }], tolerations: ANY, affinity: ANY, topologySpreadConstraints: ANY, terminationGracePeriodSeconds: 1, dnsPolicy: 1, dnsConfig: ANY, hostNetwork: 1, hostPID: 1, hostIPC: 1, priorityClassName: 1, priority: 1, schedulerName: 1, enableServiceLinks: 1, hostname: 1, subdomain: 1, activeDeadlineSeconds: 1, shareProcessNamespace: 1, preemptionPolicy: 1, runtimeClassName: 1, overhead: ANY };
  var TEMPLATE = { metadata: META, spec: PODSPEC };
  var BACKEND = { service: { name: 1, port: { number: 1, name: 1 } }, resource: ANY };
  var METRIC = { type: 1, resource: { name: 1, target: { type: 1, averageUtilization: 1, averageValue: 1, value: 1 } }, pods: ANY, object: ANY, external: ANY, containerResource: ANY };
  var PEER = [{ podSelector: SELECTOR, namespaceSelector: SELECTOR, ipBlock: { cidr: 1, except: ANY } }];
  var NPPORTS = [{ port: 1, protocol: 1, endPort: 1 }];
  var RULE = [{ apiGroups: ANY, resources: ANY, verbs: ANY, resourceNames: ANY, nonResourceURLs: ANY }];
  var SPECS = {
    Pod: PODSPEC,
    Deployment: { replicas: 1, selector: SELECTOR, template: TEMPLATE, strategy: { type: 1, rollingUpdate: { maxSurge: 1, maxUnavailable: 1 } }, revisionHistoryLimit: 1, progressDeadlineSeconds: 1, minReadySeconds: 1, paused: 1 },
    ReplicaSet: { replicas: 1, selector: SELECTOR, template: TEMPLATE, minReadySeconds: 1 },
    StatefulSet: { replicas: 1, selector: SELECTOR, template: TEMPLATE, serviceName: 1, volumeClaimTemplates: [{ apiVersion: 1, kind: 1, metadata: META, spec: { accessModes: ANY, resources: { requests: MAP, limits: MAP }, storageClassName: 1, volumeMode: 1, selector: ANY } }], podManagementPolicy: 1, updateStrategy: ANY, revisionHistoryLimit: 1, minReadySeconds: 1, persistentVolumeClaimRetentionPolicy: ANY, ordinals: ANY },
    DaemonSet: { selector: SELECTOR, template: TEMPLATE, updateStrategy: ANY, revisionHistoryLimit: 1, minReadySeconds: 1 },
    Job: { template: TEMPLATE, completions: 1, parallelism: 1, backoffLimit: 1, activeDeadlineSeconds: 1, ttlSecondsAfterFinished: 1, completionMode: 1, suspend: 1, selector: SELECTOR, manualSelector: 1, podFailurePolicy: ANY, backoffLimitPerIndex: 1, maxFailedIndexes: 1, podReplacementPolicy: 1 },
    CronJob: { schedule: 1, timeZone: 1, concurrencyPolicy: 1, suspend: 1, startingDeadlineSeconds: 1, successfulJobsHistoryLimit: 1, failedJobsHistoryLimit: 1, jobTemplate: { metadata: META, spec: null } },
    Service: { type: 1, selector: MAP, ports: [{ name: 1, port: 1, targetPort: 1, nodePort: 1, protocol: 1, appProtocol: 1 }], clusterIP: 1, clusterIPs: ANY, externalName: 1, externalTrafficPolicy: 1, internalTrafficPolicy: 1, sessionAffinity: 1, sessionAffinityConfig: ANY, loadBalancerIP: 1, loadBalancerSourceRanges: ANY, loadBalancerClass: 1, publishNotReadyAddresses: 1, ipFamilies: ANY, ipFamilyPolicy: 1, externalIPs: ANY, allocateLoadBalancerNodePorts: 1, healthCheckNodePort: 1, trafficDistribution: 1 },
    Ingress: { ingressClassName: 1, defaultBackend: BACKEND, tls: [{ hosts: ANY, secretName: 1 }], rules: [{ host: 1, http: { paths: [{ path: 1, pathType: 1, backend: BACKEND }] } }] },
    NetworkPolicy: { podSelector: SELECTOR, policyTypes: ANY, ingress: [{ from: PEER, ports: NPPORTS }], egress: [{ to: PEER, ports: NPPORTS }] },
    HorizontalPodAutoscaler: { scaleTargetRef: { apiVersion: 1, kind: 1, name: 1 }, minReplicas: 1, maxReplicas: 1, metrics: [METRIC], behavior: ANY, targetCPUUtilizationPercentage: 1 },
    PersistentVolumeClaim: { accessModes: ANY, resources: { requests: MAP, limits: MAP }, storageClassName: 1, volumeName: 1, volumeMode: 1, selector: ANY, dataSource: ANY, dataSourceRef: ANY },
    PodDisruptionBudget: { minAvailable: 1, maxUnavailable: 1, selector: SELECTOR, unhealthyPodEvictionPolicy: 1 }
  };
  SPECS.CronJob.jobTemplate.spec = SPECS.Job;
  var TOP = { apiVersion: 1, kind: 1, metadata: META, spec: ANY, status: ANY };
  var TOPS = { ConfigMap: { data: MAP, binaryData: MAP, immutable: 1 }, Secret: { data: MAP, stringData: MAP, type: 1, immutable: 1 }, ServiceAccount: { secrets: ANY, imagePullSecrets: [{ name: 1 }], automountServiceAccountToken: 1 }, Role: { rules: RULE }, ClusterRole: { rules: RULE, aggregationRule: ANY },
    RoleBinding: { subjects: [{ kind: 1, name: 1, namespace: 1, apiGroup: 1 }], roleRef: { apiGroup: 1, kind: 1, name: 1 } }, ClusterRoleBinding: { subjects: [{ kind: 1, name: 1, namespace: 1, apiGroup: 1 }], roleRef: { apiGroup: 1, kind: 1, name: 1 } },
    StorageClass: { provisioner: 1, reclaimPolicy: 1, volumeBindingMode: 1, allowVolumeExpansion: 1, parameters: MAP, mountOptions: ANY }, IngressClass: {} };
  // unknown field paths: ["spec.replica", "spec.template.spec.containers[0].imagePullPolice"]
  function unknownFields(v, sch, path, outList) {
    if (sch === ANY || sch === 1 || v == null) return;
    if (sch === MAP) return;
    if (Array.isArray(sch)) { if (Array.isArray(v)) v.forEach(function (x, i) { unknownFields(x, sch[0], path + "[" + i + "]", outList); }); return; }
    if (!isObj(v)) return;
    keys(v).forEach(function (k) { if (k.charAt(0) === "_") return; if (!(k in sch)) outList.push((path ? path + "." : "") + k); else unknownFields(v[k], sch[k], (path ? path + "." : "") + k, outList); });
  }
  K.unknownFields = function (obj) {
    var list = [], top = Object.assign({}, TOP, TOPS[obj.kind] || {});
    if (SPECS[obj.kind]) top.spec = SPECS[obj.kind];
    if (/^(ConfigMap|Secret|ServiceAccount|Role|ClusterRole|RoleBinding|ClusterRoleBinding|StorageClass)$/.test(obj.kind)) delete top.spec;
    if (obj.kind === "Namespace") top.spec = ANY;
    unknownFields(obj, top, "", list);
    return list;
  };

  /* ================================================================== validation (the API server's own messages) */
  var DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/, LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
  function goMap(m) { return "map[string]string{" + keys(m || {}).sort().map(function (k) { return JSON.stringify(k) + ":" + JSON.stringify(String(m[k])); }).join(", ") + "}"; }
  K.goMap = goMap;
  function vContainers(list, path, errs, o) {
    if (!list || !list.length) { if (!o || !o.init) errs.push(path + ": Required value"); return; }
    var names = {};
    list.forEach(function (c, i) {
      var p = path + "[" + i + "]";
      if (!c.name) errs.push(p + ".name: Required value"); else if (!LABEL.test(c.name)) errs.push(p + ".name: Invalid value: \"" + c.name + "\": a lowercase RFC 1123 label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')");
      else if (names[c.name]) errs.push(p + ".name: Duplicate value: \"" + c.name + "\""); names[c.name] = 1;
      if (!c.image) errs.push(p + ".image: Required value");
      (c.ports || []).forEach(function (pt, j) { if (typeof pt.containerPort !== "number" || pt.containerPort < 1 || pt.containerPort > 65535) errs.push(p + ".ports[" + j + "].containerPort: " + (pt.containerPort == null ? "Required value" : "Invalid value: " + JSON.stringify(pt.containerPort) + ": must be between 1 and 65535, inclusive")); });
      var rq = (c.resources || {}).requests || {}, lm = (c.resources || {}).limits || {};
      ["cpu", "memory"].forEach(function (r) {
        [["requests", rq], ["limits", lm]].forEach(function (x) { if (x[1][r] != null && !K.validQty(x[1][r])) errs.push(p + ".resources." + x[0] + "[" + r + "]: Invalid value: \"" + x[1][r] + "\": must match the regex ^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$"); });
        if (rq[r] != null && lm[r] != null && K.validQty(rq[r]) && K.validQty(lm[r])) { var a = r === "cpu" ? K.cpu(rq[r]) : K.mem(rq[r]), b = r === "cpu" ? K.cpu(lm[r]) : K.mem(lm[r]); if (a > b) errs.push(p + ".resources.requests: Invalid value: \"" + rq[r] + "\": must be less than or equal to " + r + " limit of " + lm[r]); }
      });
      ["livenessProbe", "readinessProbe", "startupProbe"].forEach(function (pn) {
        var pr = c[pn]; if (!pr) return;
        var hs = ["httpGet", "tcpSocket", "exec", "grpc"].filter(function (h) { return pr[h]; });
        if (!hs.length) errs.push(p + "." + pn + ": Required value: must specify a handler type");
        else if (hs.length > 1) errs.push(p + "." + pn + "." + hs[1] + ": Forbidden: may not specify more than 1 handler type");
        if (pr.httpGet && pr.httpGet.port == null) errs.push(p + "." + pn + ".httpGet.port: Required value");
        if (pn === "livenessProbe" && pr.successThreshold != null && pr.successThreshold !== 1) errs.push(p + "." + pn + ".successThreshold: Invalid value: " + pr.successThreshold + ": must be 1");
      });
      (c.volumeMounts || []).forEach(function (vm, j) { if (o && o.vols && o.vols.indexOf(vm.name) < 0) errs.push(p + ".volumeMounts[" + j + "].name: Not found: \"" + vm.name + "\""); if (!vm.mountPath) errs.push(p + ".volumeMounts[" + j + "].mountPath: Required value"); });
      (c.env || []).forEach(function (e, j) { if (!e.name) errs.push(p + ".env[" + j + "].name: Required value"); });
    });
  }
  function vPodSpec(spec, path, errs, extra) {
    if (!spec) { errs.push(path + ": Required value"); return; }
    var vols = (spec.volumes || []).map(function (v) { return v.name; }).concat(extra || []);
    vContainers(spec.containers, path + ".containers", errs, { vols: vols });
    vContainers(spec.initContainers, path + ".initContainers", errs, { vols: vols, init: true });
    if (spec.restartPolicy && ["Always", "OnFailure", "Never"].indexOf(spec.restartPolicy) < 0) errs.push(path + ".restartPolicy: Unsupported value: \"" + spec.restartPolicy + "\": supported values: \"Always\", \"OnFailure\", \"Never\"");
    (spec.volumes || []).forEach(function (v, i) { var srcs = ["emptyDir", "configMap", "secret", "persistentVolumeClaim", "hostPath", "projected", "downwardAPI", "ephemeral", "csi", "nfs"].filter(function (s) { return v[s] !== undefined; }); if (!srcs.length) errs.push(path + ".volumes[" + i + "]: Required value: must specify a volume type"); });
  }
  function vTemplate(o, path, errs, needLabels) {
    if (!o.spec.template) { errs.push(path + ".template.metadata.labels: Invalid value: map[string]string(nil): `selector` does not match template `labels`"); return; }
    var sel = o.spec.selector, lbl = (o.spec.template.metadata || {}).labels;
    if (needLabels !== false) {
      if (!sel) errs.push(path + ".selector: Required value");
      else if (K.emptySel(sel)) errs.push(path + ".selector: Invalid value: v1.LabelSelector{MatchLabels:map[string]string(nil), MatchExpressions:[]v1.LabelSelectorRequirement(nil)}: empty selector is invalid for deployment");
      else if (!K.matches(sel, lbl)) errs.push(path + ".template.metadata.labels: Invalid value: " + (lbl ? goMap(lbl) : "map[string]string(nil)") + ": `selector` does not match template `labels`");
    }
    vPodSpec(o.spec.template.spec, path + ".template.spec", errs, (o.spec.volumeClaimTemplates || []).map(function (v) { return (v.metadata || {}).name; }));
    var rp = (o.spec.template.spec || {}).restartPolicy;
    if (o.kind !== "Job" && rp && rp !== "Always") errs.push(path + ".template.spec.restartPolicy: Unsupported value: \"" + rp + "\": supported values: \"Always\"");
    if (o.kind === "Job" && (!rp || rp === "Always")) errs.push(path + ".template.spec.restartPolicy: " + (rp ? "Unsupported value: \"Always\": supported values: \"OnFailure\", \"Never\"" : "Required value: valid values: \"OnFailure\", \"Never\""));
  }
  // -> list of "path: message" strings
  K.validate = function (cl, o, old) {
    var errs = [], md = o.metadata || {}, k = o.kind;
    if (!md.name && !md.generateName) errs.push("metadata.name: Required value: name or generateName is required");
    else if (md.name && !(k === "Namespace" || k === "Service" ? LABEL : /^(ClusterRole|ClusterRoleBinding|Role|RoleBinding)$/.test(k) ? /^[^/%]+$/ : DNS1123).test(md.name)) errs.push("metadata.name: Invalid value: \"" + md.name + "\": a lowercase RFC 1123 " + (k === "Namespace" || k === "Service" ? "label must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character (e.g. 'my-name',  or '123-abc', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?')" : "subdomain must consist of lower case alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (e.g. 'example.com', regex used for validation is '[a-z0-9]([-a-z0-9]*[a-z0-9])?(\\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*')"));
    keys(md.labels || {}).forEach(function (lk) { var v = String(md.labels[lk]); if (v.length > 63 || !/^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?$/.test(v)) errs.push("metadata.labels: Invalid value: \"" + v + "\": a valid label must be an empty string or consist of alphanumeric characters, '-', '_' or '.', and must start and end with an alphanumeric character (e.g. 'MyValue',  or 'my_value',  or '12345', regex used for validation is '(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])?')"); });
    var sp = o.spec || {};
    if (k === "Pod") vPodSpec(o.spec, "spec", errs);
    if (/^(Deployment|ReplicaSet|StatefulSet|DaemonSet)$/.test(k)) { if (sp.replicas != null && (typeof sp.replicas !== "number" || sp.replicas < 0)) errs.push("spec.replicas: Invalid value: " + JSON.stringify(sp.replicas) + ": must be greater than or equal to 0"); vTemplate(o, "spec", errs); }
    if (k === "StatefulSet" && !sp.serviceName && false) errs.push("spec.serviceName: Required value");
    if (k === "Job") vTemplate(o, "spec", errs, false);
    if (k === "CronJob") {
      if (!sp.schedule) errs.push("spec.schedule: Required value");
      else if (!K.cronParse(sp.schedule)) errs.push("spec.schedule: Invalid value: \"" + sp.schedule + "\": " + (String(sp.schedule).split(/\s+/).length !== 5 ? "expected exactly 5 fields, found " + String(sp.schedule).split(/\s+/).length + ": " + sp.schedule : "unparsable"));
      if (!sp.jobTemplate || !sp.jobTemplate.spec) errs.push("spec.jobTemplate.spec.template.spec.containers: Required value");
      else vTemplate({ kind: "Job", spec: sp.jobTemplate.spec }, "spec.jobTemplate.spec", errs, false);
    }
    if (k === "Service") {
      var ty = sp.type || "ClusterIP";
      if (["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"].indexOf(ty) < 0) errs.push("spec.type: Unsupported value: \"" + ty + "\": supported values: \"ClusterIP\", \"ExternalName\", \"LoadBalancer\", \"NodePort\"");
      if (ty !== "ExternalName" && !(sp.ports || []).length && sp.clusterIP !== "None") errs.push("spec.ports: Required value");
      (sp.ports || []).forEach(function (p, i) {
        if (typeof p.port !== "number" || p.port < 1 || p.port > 65535) errs.push("spec.ports[" + i + "].port: " + (p.port == null ? "Required value" : "Invalid value: " + JSON.stringify(p.port) + ": must be between 1 and 65535, inclusive"));
        if (p.nodePort != null && (p.nodePort < 30000 || p.nodePort > 32767)) errs.push("spec.ports[" + i + "].nodePort: Invalid value: " + p.nodePort + ": provided port is not in the valid range. The range of valid ports is 30000-32767");
        if (p.nodePort != null && ty === "ClusterIP") errs.push("spec.ports[" + i + "].nodePort: Forbidden: may not be used when `type` is 'ClusterIP'");
        if ((sp.ports.length > 1) && !p.name) errs.push("spec.ports[" + i + "].name: Required value");
      });
    }
    if (k === "Ingress") (sp.rules || []).forEach(function (r, i) { ((r.http || {}).paths || []).forEach(function (p, j) { var pp = "spec.rules[" + i + "].http.paths[" + j + "]"; if (!p.pathType) errs.push(pp + ".pathType: Required value: pathType must be specified"); else if (["Exact", "Prefix", "ImplementationSpecific"].indexOf(p.pathType) < 0) errs.push(pp + ".pathType: Unsupported value: \"" + p.pathType + "\": supported values: \"Exact\", \"ImplementationSpecific\", \"Prefix\""); if (!p.backend || !p.backend.service) errs.push(pp + ".backend: Invalid value: \"\": resource or service must be specified"); else if (!p.backend.service.port || (p.backend.service.port.number == null && !p.backend.service.port.name)) errs.push(pp + ".backend.service.port: Invalid value: \"\": port name or number is required"); }); });
    if (k === "HorizontalPodAutoscaler") { if (!sp.maxReplicas) errs.push("spec.maxReplicas: Required value"); if (sp.minReplicas != null && sp.maxReplicas != null && sp.minReplicas > sp.maxReplicas) errs.push("spec.maxReplicas: Invalid value: " + sp.maxReplicas + ": must be greater than or equal to `minReplicas`"); if (!sp.scaleTargetRef || !sp.scaleTargetRef.name) errs.push("spec.scaleTargetRef.name: Required value"); }
    if (k === "PersistentVolumeClaim") { if (!(sp.accessModes || []).length) errs.push("spec.accessModes: Required value: at least 1 access mode is required"); if (!((sp.resources || {}).requests || {}).storage) errs.push("spec.resources[storage]: Required value"); }
    if (k === "NetworkPolicy" && sp.podSelector === undefined) errs.push("spec.podSelector: Required value");
    if ((k === "RoleBinding" || k === "ClusterRoleBinding") && (!o.roleRef || !o.roleRef.name)) errs.push("roleRef.name: Required value");
    if (k === "Secret" && o.data) keys(o.data).forEach(function (dk) { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(String(o.data[dk]).replace(/\s/g, ""))) errs.push("data[" + dk + "]: Invalid value: illegal base64 data"); });
    if (old) {
      if (/^(Deployment|ReplicaSet|StatefulSet|DaemonSet)$/.test(k) && old.spec && JSON.stringify(old.spec.selector) !== JSON.stringify(sp.selector)) errs.push("spec.selector: Invalid value: v1.LabelSelector{MatchLabels:" + goMap((sp.selector || {}).matchLabels) + ", MatchExpressions:[]v1.LabelSelectorRequirement(nil)}: field is immutable");
      if (k === "Job" && JSON.stringify(old.spec.template.spec) !== JSON.stringify((sp.template || {}).spec)) errs.push("spec.template: Invalid value: core.PodTemplateSpec{...}: field is immutable");
      if (k === "PersistentVolumeClaim" && old.spec && JSON.stringify(old.spec.accessModes) !== JSON.stringify(sp.accessModes)) errs.push("spec: Forbidden: spec is immutable after creation except resources.requests and volumeAttributesClassName for bound claims");
      if (k === "Service" && old.spec.clusterIP && sp.clusterIP && old.spec.clusterIP !== sp.clusterIP) errs.push("spec.clusterIPs[0]: Invalid value: []string{\"" + sp.clusterIP + "\"}: may not change once set");
      if (k === "Pod") {
        var strip = function (s) { var c = clone(s); (c.containers || []).forEach(function (x) { delete x.image; }); delete c.activeDeadlineSeconds; delete c.tolerations; return JSON.stringify(c); };
        if (strip(old.spec) !== strip(sp)) errs.push("spec: Forbidden: pod updates may not change fields other than `spec.containers[*].image`,`spec.initContainers[*].image`,`spec.activeDeadlineSeconds`,`spec.tolerations` (only additions to existing tolerations),`spec.terminationGracePeriodSeconds` (allow it to be set to 1 if it was previously negative)");
      }
      if ((k === "ConfigMap" || k === "Secret") && old.immutable && (JSON.stringify(old.data) !== JSON.stringify(o.data))) errs.push("data: Forbidden: field is immutable when `immutable` is set");
    }
    return errs;
  };

  /* ================================================================== defaulting */
  K.defaultPodSpec = function (cl, spec) {
    if (!spec) return;
    spec.restartPolicy = spec.restartPolicy || "Always";
    spec.dnsPolicy = spec.dnsPolicy || "ClusterFirst";
    spec.schedulerName = spec.schedulerName || "default-scheduler";
    spec.serviceAccountName = spec.serviceAccountName || spec.serviceAccount || "default";
    if (spec.terminationGracePeriodSeconds == null) spec.terminationGracePeriodSeconds = 30;
    spec.securityContext = spec.securityContext || {};
    (spec.containers || []).concat(spec.initContainers || []).forEach(function (c) {
      if (!c.imagePullPolicy) { var tg = Dk.parseRef(c.image || "x").tag; c.imagePullPolicy = /@sha256:/.test(c.image || "") ? "IfNotPresent" : (!tg || tg === "latest") ? "Always" : "IfNotPresent"; }
      c.terminationMessagePath = c.terminationMessagePath || "/dev/termination-log";
      c.terminationMessagePolicy = c.terminationMessagePolicy || "File";
      c.resources = c.resources || {};
      if (c.resources.limits && !c.resources.requests) c.resources.requests = clone(c.resources.limits);
      (c.ports || []).forEach(function (p) { p.protocol = p.protocol || "TCP"; });
      ["livenessProbe", "readinessProbe", "startupProbe"].forEach(function (pn) { var p = c[pn]; if (!p) return; p.periodSeconds = p.periodSeconds || 10; p.timeoutSeconds = p.timeoutSeconds || 1; p.successThreshold = p.successThreshold || 1; p.failureThreshold = p.failureThreshold || 3; if (p.httpGet) { p.httpGet.path = p.httpGet.path || "/"; p.httpGet.scheme = p.httpGet.scheme || "HTTP"; } });
    });
  };
  K.defaults = function (cl, o) {
    var sp = o.spec, md = o.metadata;
    if (/^(Deployment|ReplicaSet|StatefulSet|DaemonSet|Job)$/.test(o.kind) && sp.template) { sp.template.metadata = sp.template.metadata || {}; K.defaultPodSpec(cl, sp.template.spec); }
    if (o.kind === "Deployment") {
      if (sp.replicas == null) sp.replicas = 1;
      sp.strategy = sp.strategy || {}; sp.strategy.type = sp.strategy.type || "RollingUpdate";
      if (sp.strategy.type === "RollingUpdate") { sp.strategy.rollingUpdate = sp.strategy.rollingUpdate || {}; if (sp.strategy.rollingUpdate.maxSurge == null) sp.strategy.rollingUpdate.maxSurge = "25%"; if (sp.strategy.rollingUpdate.maxUnavailable == null) sp.strategy.rollingUpdate.maxUnavailable = "25%"; }
      if (sp.revisionHistoryLimit == null) sp.revisionHistoryLimit = 10;
      if (sp.progressDeadlineSeconds == null) sp.progressDeadlineSeconds = 600;
    }
    if (o.kind === "StatefulSet") { if (sp.replicas == null) sp.replicas = 1; sp.podManagementPolicy = sp.podManagementPolicy || "OrderedReady"; sp.updateStrategy = sp.updateStrategy || { type: "RollingUpdate", rollingUpdate: { partition: 0 } }; if (sp.revisionHistoryLimit == null) sp.revisionHistoryLimit = 10; }
    if (o.kind === "ReplicaSet" && sp.replicas == null) sp.replicas = 1;
    if (o.kind === "Job") { if (sp.backoffLimit == null) sp.backoffLimit = 6; if (sp.completions == null) sp.completions = 1; if (sp.parallelism == null) sp.parallelism = 1; sp.completionMode = sp.completionMode || "NonIndexed"; sp.suspend = !!sp.suspend; if (!sp.selector) { sp.selector = { matchLabels: { "batch.kubernetes.io/controller-uid": md.uid } }; sp.template.metadata.labels = Object.assign({ "batch.kubernetes.io/controller-uid": md.uid, "batch.kubernetes.io/job-name": md.name, "controller-uid": md.uid, "job-name": md.name }, sp.template.metadata.labels || {}); } }
    if (o.kind === "CronJob") { sp.concurrencyPolicy = sp.concurrencyPolicy || "Allow"; sp.suspend = !!sp.suspend; if (sp.successfulJobsHistoryLimit == null) sp.successfulJobsHistoryLimit = 3; if (sp.failedJobsHistoryLimit == null) sp.failedJobsHistoryLimit = 1; }
    if (o.kind === "Pod") K.defaultPodSpec(cl, sp);
    if (o.kind === "Service") {
      sp.type = sp.type || "ClusterIP"; sp.sessionAffinity = sp.sessionAffinity || "None";
      (sp.ports || []).forEach(function (p) { p.protocol = p.protocol || "TCP"; if (p.targetPort == null) p.targetPort = p.port; });
      if (!sp.clusterIP && sp.type !== "ExternalName") sp.clusterIP = K.allocSvcIp(cl);
      if (sp.clusterIP && sp.clusterIP !== "None") sp.clusterIPs = [sp.clusterIP];
      sp.ipFamilies = ["IPv4"]; sp.ipFamilyPolicy = "SingleStack"; sp.internalTrafficPolicy = sp.internalTrafficPolicy || "Cluster";
      if (sp.type === "NodePort" || sp.type === "LoadBalancer") { sp.externalTrafficPolicy = sp.externalTrafficPolicy || "Cluster"; (sp.ports || []).forEach(function (p) { if (!p.nodePort) p.nodePort = K.allocNodePort(cl); }); }
    }
    if (o.kind === "PersistentVolumeClaim") { sp.volumeMode = sp.volumeMode || "Filesystem"; if (sp.storageClassName === undefined) { var dsc = K.all(cl, "StorageClass").filter(function (s) { return (s.metadata.annotations || {})["storageclass.kubernetes.io/is-default-class"] === "true"; })[0]; if (dsc) sp.storageClassName = dsc.metadata.name; } }
    if (o.kind === "Secret") { o.type = o.type || "Opaque"; if (o.stringData) { o.data = o.data || {}; keys(o.stringData).forEach(function (k) { o.data[k] = K.b64(String(o.stringData[k])); }); delete o.stringData; } }
    if (o.kind === "HorizontalPodAutoscaler") { if (sp.minReplicas == null) sp.minReplicas = 1; if (sp.targetCPUUtilizationPercentage != null && !sp.metrics) { sp.metrics = [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: sp.targetCPUUtilizationPercentage } } }]; delete sp.targetCPUUtilizationPercentage; } }
    if (o.kind === "NetworkPolicy") { if (!sp.policyTypes) { sp.policyTypes = ["Ingress"]; if (sp.egress) sp.policyTypes.push("Egress"); } }
  };
  K.allocSvcIp = function (cl) { cl.ipSeq.svc++; return "10.43." + Math.floor(cl.ipSeq.svc / 250) + "." + (cl.ipSeq.svc % 250 + 2); };
  K.allocNodePort = function (cl) { var used = {}; K.all(cl, "Service").forEach(function (s) { (s.spec.ports || []).forEach(function (p) { if (p.nodePort) used[p.nodePort] = 1; }); }); var n = 30000 + (parseInt(K.hex("np" + cl.rv, 6), 16) % 2700); while (used[n]) n++; return n; };
  K.b64 = function (s) { return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"); };
  K.unb64 = function (s) { try { return typeof atob === "function" ? decodeURIComponent(escape(atob(String(s).replace(/\s/g, "")))) : Buffer.from(String(s), "base64").toString("utf8"); } catch (e) { return null; } };

  /* ================================================================== who is asking: RBAC */
  // subject: {user, groups[]}
  K.subjectOf = function (cl, sess, as) {
    if (as) { var m = /^system:serviceaccount:([^:]+):(.+)$/.exec(as); return { user: as, groups: m ? ["system:serviceaccounts", "system:serviceaccounts:" + m[1], "system:authenticated"] : ["system:authenticated"], sa: m ? { ns: m[1], name: m[2] } : null }; }
    var kc = K.kubeconfig(sess), ctx = kc && kc.ctx, u = ctx && kc.users[ctx.user];
    if (!u) return null;
    if (u.token) { var t = cl.tokens[u.token]; if (!t || t.exp <= K.t(cl)) return { invalid: true }; return K.subjectOf(cl, null, t.sub); }
    var cn = u.cn || ctx.user;
    return { user: cn, groups: (u.groups || []).concat(["system:authenticated"]) };
  };
  function ruleAllows(r, verb, res, group, name) {
    var g = r.apiGroups || [""], rs = r.resources || [], vs = r.verbs || [];
    if (g.indexOf("*") < 0 && g.indexOf(group) < 0) return false;
    if (rs.indexOf("*") < 0 && rs.indexOf(res) < 0) return false;
    if (vs.indexOf("*") < 0 && vs.indexOf(verb) < 0) return false;
    if ((r.resourceNames || []).length && (!name || r.resourceNames.indexOf(name) < 0)) return false;
    return true;
  }
  function subjMatch(s, sub) {
    if (s.kind === "User") return s.name === sub.user;
    if (s.kind === "Group") return (sub.groups || []).indexOf(s.name) >= 0;
    if (s.kind === "ServiceAccount") return !!sub.sa && sub.sa.name === s.name && sub.sa.ns === (s.namespace || "");
    return false;
  }
  K.rulesFor = function (cl, sub, ns) {
    var rules = [];
    function role(ref, bns) { var r = ref.kind === "ClusterRole" ? K.get(cl, "ClusterRole", null, ref.name) : K.get(cl, "Role", bns, ref.name); return r ? r.rules || [] : []; }
    K.all(cl, "ClusterRoleBinding").forEach(function (b) { if ((b.subjects || []).some(function (s) { return subjMatch(s, sub); })) rules = rules.concat(role(b.roleRef)); });
    if (ns) K.list(cl, "RoleBinding", ns).forEach(function (b) { if ((b.subjects || []).some(function (s) { return subjMatch(s, sub); })) rules = rules.concat(role(b.roleRef, ns)); });
    return rules;
  };
  // verb: get list watch create update patch delete deletecollection; res: plural or plural/sub
  K.can = function (cl, sub, verb, res, group, ns, name) {
    if (!sub || sub.invalid) return false;
    if ((sub.groups || []).indexOf("system:masters") >= 0) return true;
    return K.rulesFor(cl, sub, ns).some(function (r) { return ruleAllows(r, verb, res, group, name); });
  };
  K.forbidden = function (sub, verb, info, ns, name, sublabel) {
    var res = info.plural + (sublabel ? "/" + sublabel : ""), who = sub.user;
    return "Error from server (Forbidden): " + (name ? info.plural + (info.group ? "." + info.group : "") + " \"" + name + "\" is forbidden: " : info.plural + (info.group ? "." + info.group : "") + " is forbidden: ") + "User \"" + who + "\" cannot " + verb + " resource \"" + res + "\" in API group \"" + info.group + "\"" + (info.ns && ns ? " in the namespace \"" + ns + "\"" : " at the cluster scope");
  };

  /* ================================================================== kubeconfig (~/.kube/config) */
  K.kubeconfig = function (sess) {
    var path = S.getVar(sess, "KUBECONFIG") || (sess.home + "/.kube/config"), t = M2.rd(sess.sys, path.split(":")[0]);
    if (t == null) return null;
    var y = root.DevYaml.tryParse(t); if (y.error || !isObj(y.value)) return { error: "error loading config file \"" + path + "\": " + (y.error || "invalid") };
    var c = y.value, kc = { path: path, raw: c, clusters: {}, users: {}, contexts: {}, current: c["current-context"] || "" };
    (c.clusters || []).forEach(function (x) { kc.clusters[x.name] = x.cluster || {}; });
    (c.users || []).forEach(function (x) { var u = x.user || {}; kc.users[x.name] = { token: u.token, cn: u["client-certificate-data"] ? K.certCN(u["client-certificate-data"]) : null, groups: u["client-certificate-data"] ? K.certGroups(u["client-certificate-data"]) : [] }; });
    (c.contexts || []).forEach(function (x) { kc.contexts[x.name] = x.context || {}; });
    kc.ctx = kc.contexts[kc.current] || null;
    return kc;
  };
  // client certificates are simulated as base64 of "CN=...;O=..." with a marker
  K.makeCert = function (cn, groups) { return K.b64("-----BEGIN CERTIFICATE-----\nKESTREL-SIM CN=" + cn + ";O=" + (groups || []).join(",") + "\n-----END CERTIFICATE-----\n"); };
  K.certCN = function (d) { var m = /CN=([^;\n]+)/.exec(K.unb64(d) || ""); return m ? m[1] : null; };
  K.certGroups = function (d) { var m = /;O=([^\n]*)/.exec(K.unb64(d) || ""); return m && m[1] ? m[1].split(",") : []; };

  /* ================================================================== admission */
  // Pod Security Standards: returns list of violation strings for level baseline/restricted
  K.podSecurity = function (spec, level, meta) {
    var v = [], cs = (spec.containers || []).concat(spec.initContainers || []), psc = spec.securityContext || {};
    function list(arr) { return arr.map(function (x) { return "\"" + x + "\""; }).join(", "); }
    var priv = cs.filter(function (c) { return (c.securityContext || {}).privileged; }).map(function (c) { return c.name; });
    if (priv.length) v.push("privileged (container" + (priv.length > 1 ? "s " : " ") + list(priv) + " must not set securityContext.privileged=true)");
    if (spec.hostNetwork || spec.hostPID || spec.hostIPC) v.push("host namespaces (" + ["hostNetwork", "hostPID", "hostIPC"].filter(function (h) { return spec[h]; }).map(function (h) { return h + "=true"; }).join(", ") + ")");
    var hp = (spec.volumes || []).filter(function (x) { return x.hostPath; }).map(function (x) { return x.name; });
    if (hp.length) v.push("hostPath volumes (volume" + (hp.length > 1 ? "s " : " ") + list(hp) + ")");
    var addCaps = cs.filter(function (c) { return ((c.securityContext || {}).capabilities || {}).add && c.securityContext.capabilities.add.some(function (x) { return ["AUDIT_WRITE", "CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID", "KILL", "MKNOD", "NET_BIND_SERVICE", "SETFCAP", "SETGID", "SETPCAP", "SETUID", "SYS_CHROOT"].indexOf(x) < 0; }); });
    if (addCaps.length) v.push("non-default capabilities (container" + (addCaps.length > 1 ? "s " : " ") + list(addCaps.map(function (c) { return c.name; })) + " must not include " + list(addCaps[0].securityContext.capabilities.add) + " in securityContext.capabilities.add)");
    var hostPorts = cs.filter(function (c) { return (c.ports || []).some(function (p) { return p.hostPort; }); });
    if (hostPorts.length) v.push("hostPort (container " + list(hostPorts.map(function (c) { return c.name; })) + " uses hostPort " + hostPorts[0].ports.filter(function (p) { return p.hostPort; })[0].hostPort + ")");
    if (level !== "restricted") return v;
    var ape = cs.filter(function (c) { return (c.securityContext || {}).allowPrivilegeEscalation !== false; }).map(function (c) { return c.name; });
    if (ape.length) v.push("allowPrivilegeEscalation != false (container" + (ape.length > 1 ? "s " : " ") + list(ape) + " must set securityContext.allowPrivilegeEscalation=false)");
    var caps = cs.filter(function (c) { var d = ((c.securityContext || {}).capabilities || {}).drop || []; return d.indexOf("ALL") < 0; }).map(function (c) { return c.name; });
    if (caps.length) v.push("unrestricted capabilities (container" + (caps.length > 1 ? "s " : " ") + list(caps) + " must set securityContext.capabilities.drop=[\"ALL\"])");
    var nr = cs.filter(function (c) { var x = (c.securityContext || {}).runAsNonRoot; return x === false || (x == null && psc.runAsNonRoot !== true); }).map(function (c) { return c.name; });
    if (nr.length) v.push("runAsNonRoot != true (pod or container" + (nr.length > 1 ? "s " : " ") + list(nr) + " must set securityContext.runAsNonRoot=true)");
    var ru0 = psc.runAsUser === 0 || cs.some(function (c) { return (c.securityContext || {}).runAsUser === 0; });
    if (ru0) v.push("runAsUser=0 (pod and container must not set runAsUser=0)");
    var sc = cs.filter(function (c) { var t = ((c.securityContext || {}).seccompProfile || psc.seccompProfile || {}).type; return t !== "RuntimeDefault" && t !== "Localhost"; }).map(function (c) { return c.name; });
    if (sc.length) v.push("seccompProfile (pod or container" + (sc.length > 1 ? "s " : " ") + list(sc) + " must set securityContext.seccompProfile.type to \"RuntimeDefault\" or \"Localhost\")");
    var badVol = (spec.volumes || []).filter(function (x) { return !(x.configMap || x.secret || x.emptyDir || x.persistentVolumeClaim || x.projected || x.downwardAPI || x.ephemeral || x.csi); }).map(function (x) { return x.name; });
    if (badVol.length && !hp.length) v.push("restricted volume types (volume " + list(badVol) + ")");
    void meta;
    return v;
  };
  function psaLevel(cl, ns, mode) { var n = K.get(cl, "Namespace", null, ns); return n && (n.metadata.labels || {})["pod-security.kubernetes.io/" + mode] || null; }
  K.psaLevel = psaLevel;
  // Run admission for a create/update. Returns {deny: message} or {warnings: [...]}
  K.admit = function (cl, obj, op, user) {
    var warnings = [];
    var ns = obj.metadata.namespace;
    var podSpec = obj.kind === "Pod" ? obj.spec : obj.kind === "CronJob" ? (((obj.spec || {}).jobTemplate || {}).spec || {}).template && obj.spec.jobTemplate.spec.template.spec : ((obj.spec || {}).template || {}).spec;
    if (podSpec && ns) {
      ["enforce", "warn"].forEach(function (mode) {
        var lvl = psaLevel(cl, ns, mode); if (!lvl || lvl === "privileged") return;
        var v = K.podSecurity(podSpec, lvl, obj.metadata);
        if (!v.length) return;
        var msg = "violates PodSecurity \"" + lvl + ":latest\": " + v.join(", ");
        if (mode === "enforce" && obj.kind === "Pod") { warnings.deny = "pods \"" + obj.metadata.name + "\" is forbidden: " + msg; }
        else if (mode === "warn" || obj.kind !== "Pod") warnings.push("would " + msg.replace(/^violates/, "violate"));
      });
      if (warnings.deny) return { deny: warnings.deny, code: "Forbidden" };
    }
    for (var i = 0; i < cl.hooks.length; i++) { var r = cl.hooks[i](cl, obj, op, user); if (r && r.deny) return r; if (r && r.warnings) warnings = warnings.concat(r.warnings); }
    return { warnings: warnings.filter(function (w, j) { return warnings.indexOf(w) === j; }) };
  };

  /* ================================================================== cron schedules */
  K.cronParse = function (s) {
    var f = String(s || "").trim().split(/\s+/);
    if (/^@(hourly|daily|midnight|weekly|monthly|yearly|annually)$/.test(f[0]) && f.length === 1) f = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *" }[f[0]].split(" ");
    if (f.length !== 5) return null;
    var R = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]], out = [];
    for (var i = 0; i < 5; i++) {
      var set = {}, ok = true;
      f[i].split(",").forEach(function (part) {
        var m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part); if (!m) { ok = false; return; }
        var lo = R[i][0], hi = R[i][1], step = m[2] ? +m[2] : 1;
        if (m[1] !== "*") { var ab = m[1].split("-"); lo = +ab[0]; hi = ab[1] != null ? +ab[1] : (m[2] ? R[i][1] : lo); }
        if (lo < R[i][0] || hi > R[i][1] || lo > hi) { ok = false; return; }
        for (var v = lo; v <= hi; v += step) set[v] = 1;
      });
      if (!ok) return null;
      out.push(set);
    }
    return out;
  };
  K.cronDue = function (cl, sched, from, to) {
    var c = K.cronParse(sched); if (!c) return null;
    var base = Dk.stamp(cl.rt, 0) / 1000;
    var lo = Math.floor((base + from) / 60) * 60 + 60;
    for (var t = Math.floor((base + to) / 60) * 60; t >= lo && t > base + to - 86400 * 8; t -= 60) { var d = new Date(t * 1000); if (c[0][d.getUTCMinutes()] && c[1][d.getUTCHours()] && c[2][d.getUTCDate()] && c[3][d.getUTCMonth() + 1] && c[4][d.getUTCDay()]) return t - base; }
    return null;
  };
})(typeof window !== "undefined" ? window : globalThis);
