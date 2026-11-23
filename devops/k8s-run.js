/* sudo learn — DevOps Module 4: what makes the simulated cluster move. Controllers (Deployments with rolling
   updates and revisions, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, HPA, PVC provisioning,
   Endpoints, cert-manager certificates), the scheduler (requests, taints, nodeSelector, unbound claims), and the
   kubelet: every pod container is a real container on the Docker engine (k8s runtime machine), so images are
   pulled from the simulated registries, apps really start (or crash), probes really call /health, exec and logs
   work. Pod networking: cluster DNS, Services, NetworkPolicy. Time: K.advance(cl, secs). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, CI = root.CI, K = root.K8s;
  var keys = K.keys, clone = K.clone, isObj = K.isObj;
  var MB = 1048576;

  /* ================================================================== bootstrap */
  var NODES = [
    { name: "kc-cp-1", ip: "10.40.0.10", cp: true, zone: "eu-west-1a", cpu: 2000, mem: 4 * 1024 * MB },
    { name: "kc-node-1", ip: "10.40.0.11", zone: "eu-west-1a", cpu: 2000, mem: 4 * 1024 * MB },
    { name: "kc-node-2", ip: "10.40.0.12", zone: "eu-west-1b", cpu: 2000, mem: 4 * 1024 * MB },
    { name: "kc-node-3", ip: "10.40.0.13", zone: "eu-west-1c", cpu: 2000, mem: 4 * 1024 * MB }
  ];
  K.NODES = NODES;
  K.INGRESS_IP = "198.51.100.80";
  function sysObj(cl, o) { o.metadata.creationTimestamp = o.metadata.creationTimestamp != null ? o.metadata.creationTimestamp : cl.created; K.defaults(cl, o); return K.store(cl, o, { quiet: true }); }
  K.sysObj = sysObj;
  function ns(cl, name, labels) { return sysObj(cl, { kind: "Namespace", metadata: { name: name, labels: Object.assign({ "kubernetes.io/metadata.name": name }, labels || {}) }, spec: { finalizers: ["kubernetes"] }, status: { phase: "Active" } }); }
  K.ensureNs = function (cl, name, labels) { var n = K.get(cl, "Namespace", null, name); if (n) { if (labels) n.metadata.labels = Object.assign(n.metadata.labels, labels); return n; } var x = ns(cl, name, labels); x.metadata.creationTimestamp = K.t(cl) - 3600 * 20; return x; };
  // a virtual system deployment: its pods run without containers (no image to pull, canned logs)
  function sysDeploy(cl, nsName, name, o) {
    o = o || {};
    var lbl = o.labels || { "app.kubernetes.io/name": name };
    var d = { kind: "Deployment", metadata: { name: name, namespace: nsName, labels: lbl, creationTimestamp: o.created != null ? o.created : cl.created + 300 },
      spec: { replicas: o.replicas || 1, selector: { matchLabels: lbl }, template: { metadata: { labels: lbl, annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: o.ctr || name, image: o.image, ports: (o.ports || []).map(function (p) { return { containerPort: p, protocol: "TCP" }; }), resources: { requests: { cpu: o.cpu || "100m", memory: o.mem || "70Mi" } } }] } } } };
    sysObj(cl, d);
    return d;
  }
  K.sysDeploy = sysDeploy;
  function sysSvc(cl, nsName, name, spec, o) { return sysObj(cl, { kind: "Service", metadata: Object.assign({ name: name, namespace: nsName, labels: (o || {}).labels || { "app.kubernetes.io/name": name } }, {}), spec: spec }); }
  K.sysSvc = sysSvc;
  function crole(cl, name, rules, agg) { return sysObj(cl, { kind: "ClusterRole", metadata: { name: name, labels: agg ? { "kubernetes.io/bootstrapping": "rbac-defaults" } : {} }, rules: rules }); }
  var READ = ["get", "list", "watch"], WRITE = ["create", "delete", "deletecollection", "patch", "update"];
  var VIEW_RES = [{ apiGroups: [""], resources: ["configmaps", "endpoints", "persistentvolumeclaims", "pods", "pods/log", "pods/status", "replicationcontrollers", "services", "serviceaccounts", "events", "namespaces", "limitranges", "resourcequotas"], verbs: READ }, { apiGroups: ["apps"], resources: ["daemonsets", "deployments", "deployments/scale", "replicasets", "statefulsets"], verbs: READ }, { apiGroups: ["batch"], resources: ["cronjobs", "jobs"], verbs: READ }, { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: READ }, { apiGroups: ["networking.k8s.io"], resources: ["ingresses", "networkpolicies"], verbs: READ }, { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: READ }];
  var EDIT_RES = [{ apiGroups: [""], resources: ["configmaps", "endpoints", "persistentvolumeclaims", "pods", "replicationcontrollers", "services", "serviceaccounts", "secrets"], verbs: WRITE }, { apiGroups: [""], resources: ["pods/exec", "pods/attach", "pods/portforward", "pods/eviction", "services/proxy"], verbs: ["create", "get"] }, { apiGroups: [""], resources: ["secrets"], verbs: READ }, { apiGroups: ["apps"], resources: ["daemonsets", "deployments", "deployments/scale", "deployments/rollback", "replicasets", "statefulsets", "statefulsets/scale"], verbs: WRITE }, { apiGroups: ["batch"], resources: ["cronjobs", "jobs"], verbs: WRITE }, { apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"], verbs: WRITE }, { apiGroups: ["networking.k8s.io"], resources: ["ingresses", "networkpolicies"], verbs: WRITE }, { apiGroups: ["policy"], resources: ["poddisruptionbudgets"], verbs: WRITE }, { apiGroups: [""], resources: ["serviceaccounts/token"], verbs: ["create"] }];
  K.bootstrap = function (cl, o) {
    ["default", "kube-system", "kube-public", "kube-node-lease"].forEach(function (n) { ns(cl, n); });
    NODES.forEach(function (n, i) {
      sysObj(cl, { kind: "Node", metadata: { name: n.name, creationTimestamp: cl.created + i * 40, labels: { "kubernetes.io/hostname": n.name, "kubernetes.io/os": "linux", "kubernetes.io/arch": "amd64", "topology.kubernetes.io/zone": n.zone, "node.kubernetes.io/instance-type": "t3.medium", "node-role.kubernetes.io/control-plane": n.cp ? "true" : undefined, "kestrel.io/pool": n.cp ? undefined : "general" } },
        spec: { podCIDR: "10.42." + i + ".0/24", taints: n.cp ? [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }] : undefined },
        status: { addresses: [{ type: "InternalIP", address: n.ip }, { type: "Hostname", address: n.name }], capacity: { cpu: String(n.cpu / 1000), memory: (n.mem / 1024) + "Ki", pods: "110", "ephemeral-storage": "41152812Ki" }, allocatable: { cpu: String(n.cpu / 1000), memory: (n.mem / 1024 - 100 * 1024) + "Ki", pods: "110", "ephemeral-storage": "40035351015" },
          nodeInfo: { kubeletVersion: cl.version, kubeProxyVersion: cl.version, osImage: "Ubuntu 24.04.1 LTS", kernelVersion: "6.8.0-1018-aws", containerRuntimeVersion: "containerd://1.7.23", operatingSystem: "linux", architecture: "amd64" }, conditions: [{ type: "Ready", status: "True", reason: "KubeletReady", message: "kubelet is posting ready status" }] } });
      keys(K.get(cl, "Node", null, n.name).metadata.labels).forEach(function (k) { var L = K.get(cl, "Node", null, n.name).metadata.labels; if (L[k] === undefined) delete L[k]; });
    });
    sysObj(cl, { kind: "StorageClass", metadata: { name: "local-path", annotations: { "storageclass.kubernetes.io/is-default-class": "true" } }, provisioner: "rancher.io/local-path", reclaimPolicy: "Delete", volumeBindingMode: "WaitForFirstConsumer", allowVolumeExpansion: false });
    crole(cl, "cluster-admin", [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }, { nonResourceURLs: ["*"], verbs: ["*"] }], true);
    crole(cl, "view", VIEW_RES, true);
    crole(cl, "edit", VIEW_RES.concat(EDIT_RES), true);
    crole(cl, "admin", VIEW_RES.concat(EDIT_RES).concat([{ apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles", "rolebindings"], verbs: READ.concat(WRITE) }, { apiGroups: ["authorization.k8s.io"], resources: ["localsubjectaccessreviews"], verbs: ["create"] }]), true);
    sysObj(cl, { kind: "ClusterRoleBinding", metadata: { name: "cluster-admin", labels: { "kubernetes.io/bootstrapping": "rbac-defaults" } }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" }, subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "system:masters" }] });
    sysDeploy(cl, "kube-system", "coredns", { replicas: 2, labels: { "k8s-app": "kube-dns" }, image: "registry.k8s.io/coredns/coredns:v1.11.3", ports: [53, 9153] });
    sysSvc(cl, "kube-system", "kube-dns", { clusterIP: "10.43.0.10", selector: { "k8s-app": "kube-dns" }, ports: [{ name: "dns", port: 53, protocol: "UDP" }, { name: "dns-tcp", port: 53, protocol: "TCP" }, { name: "metrics", port: 9153 }] }, { labels: { "k8s-app": "kube-dns" } });
    sysDeploy(cl, "kube-system", "local-path-provisioner", { labels: { app: "local-path-provisioner" }, image: "rancher/local-path-provisioner:v0.0.30" });
    if (cl.comps.metrics) { sysDeploy(cl, "kube-system", "metrics-server", { labels: { "k8s-app": "metrics-server" }, image: "registry.k8s.io/metrics-server/metrics-server:v0.7.2", ports: [10250] }); sysSvc(cl, "kube-system", "metrics-server", { selector: { "k8s-app": "metrics-server" }, ports: [{ name: "https", port: 443, targetPort: 10250 }] }); }
    if (cl.comps.ingress) {
      ns(cl, "ingress-nginx", { "app.kubernetes.io/name": "ingress-nginx" });
      sysDeploy(cl, "ingress-nginx", "ingress-nginx-controller", { labels: { "app.kubernetes.io/name": "ingress-nginx", "app.kubernetes.io/component": "controller" }, ctr: "controller", image: "registry.k8s.io/ingress-nginx/controller:v1.11.3", ports: [80, 443] });
      var isvc = sysSvc(cl, "ingress-nginx", "ingress-nginx-controller", { type: "LoadBalancer", selector: { "app.kubernetes.io/name": "ingress-nginx", "app.kubernetes.io/component": "controller" }, ports: [{ name: "http", port: 80, targetPort: 80, nodePort: 31080 }, { name: "https", port: 443, targetPort: 443, nodePort: 31443 }] }, { labels: { "app.kubernetes.io/name": "ingress-nginx" } });
      isvc.status = { loadBalancer: { ingress: [{ ip: K.INGRESS_IP }] } };
      sysObj(cl, { kind: "IngressClass", metadata: { name: "nginx", annotations: { "ingressclass.kubernetes.io/is-default-class": "true" } }, spec: { controller: "k8s.io/ingress-nginx" } });
    }
    if (cl.comps.certManager) { ns(cl, "cert-manager"); ["cert-manager", "cert-manager-cainjector", "cert-manager-webhook"].forEach(function (n) { sysDeploy(cl, "cert-manager", n, { labels: { "app.kubernetes.io/name": n.replace("cert-manager-", "") || "cert-manager", "app.kubernetes.io/instance": "cert-manager" }, image: "quay.io/jetstack/" + n.replace("cert-manager", "cert-manager-controller").replace("controller-", "") + ":v1.16.2" }); }); }
    if (cl.comps.kyverno) { ns(cl, "kyverno"); ["kyverno-admission-controller", "kyverno-background-controller", "kyverno-cleanup-controller", "kyverno-reports-controller"].forEach(function (n) { sysDeploy(cl, "kyverno", n, { labels: { "app.kubernetes.io/component": n.replace("kyverno-", ""), "app.kubernetes.io/instance": "kyverno" }, ctr: n.replace("kyverno-", "").replace("-controller", "").replace("admission", "kyverno"), image: "ghcr.io/kyverno/" + (n === "kyverno-admission-controller" ? "kyverno" : n.replace("kyverno-", "").replace("-controller", "-controller")) + ":v1.13.2" }); }); }
    if (cl.comps.argocd) { ns(cl, "argocd"); ["argocd-server", "argocd-repo-server", "argocd-applicationset-controller", "argocd-redis", "argocd-dex-server", "argocd-notifications-controller"].forEach(function (n) { sysDeploy(cl, "argocd", n, { labels: { "app.kubernetes.io/name": n }, image: n === "argocd-redis" ? "public.ecr.aws/docker/library/redis:7.4.1-alpine" : "quay.io/argoproj/argocd:v2.13.2" }); }); sysObj(cl, { kind: "StatefulSet", metadata: { name: "argocd-application-controller", namespace: "argocd", labels: { "app.kubernetes.io/name": "argocd-application-controller" } }, spec: { replicas: 1, serviceName: "argocd-application-controller", selector: { matchLabels: { "app.kubernetes.io/name": "argocd-application-controller" } }, template: { metadata: { labels: { "app.kubernetes.io/name": "argocd-application-controller" }, annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: "argocd-application-controller", image: "quay.io/argoproj/argocd:v2.13.2" }] } } } }); sysSvc(cl, "argocd", "argocd-server", { selector: { "app.kubernetes.io/name": "argocd-server" }, ports: [{ name: "http", port: 80, targetPort: 8080 }, { name: "https", port: 443, targetPort: 8080 }] }); }
    if (K.onBootstrap) K.onBootstrap.forEach(function (fn) { fn(cl, o); });
    // let the system settle: everything has been running for weeks
    var t0 = Dk.clock(cl.rt); cl.rt.dk.t = cl.created + 600; K.reconcile(cl, { boot: true }); cl.rt.dk.t = t0;
    keys(cl.objs).forEach(function (k) { K.all(cl, k).forEach(function (x) { x.metadata.creationTimestamp = Math.min(x.metadata.creationTimestamp, cl.created + 900); if (x.status && x.status.startTime != null) x.status.startTime = x.metadata.creationTimestamp + 5; }); });
    cl.events = [];
  };

  /* ================================================================== API writes (apply/create/replace/delete) */
  // three-way merge for kubectl apply: fields you never set in your file (like replicas set by kubectl scale) survive
  function merge3(live, last, mine) {
    if (!isObj(live) || !isObj(mine)) return clone(mine);
    var out = clone(mine);
    keys(live).forEach(function (k) {
      if (k in mine) { if (isObj(live[k]) && isObj(mine[k]) && k !== "selector" && k !== "matchLabels" && k !== "labels" && k !== "data" && k !== "stringData") out[k] = merge3(live[k], last && last[k], mine[k]); return; }
      if (last && (k in last)) return;
      out[k] = clone(live[k]);
    });
    return out;
  }
  // o: {ns (from -n or context), mode apply|create|replace, dryRun, sub (subject), source, forceNs}
  K.write = function (cl, input, o) {
    o = o || {};
    var obj = clone(input), k = obj && obj.kind;
    if (!isObj(obj) || !k || !obj.apiVersion) return { error: "error: error validating data: " + (!obj || !obj.apiVersion ? "apiVersion not set" : "kind not set") + "; if you choose to ignore these errors, turn validation off with --validate=false" };
    var info = K.byKind(cl, k, obj.apiVersion);
    if (!info) return { error: "error: resource mapping not found for name: \"" + ((obj.metadata || {}).name || "") + "\" namespace: \"" + ((obj.metadata || {}).namespace || "") + "\" from \"" + (o.source || "STDIN") + "\": no matches for kind \"" + k + "\" in version \"" + obj.apiVersion + "\"\nensure CRDs are installed first" };
    obj.metadata = obj.metadata || {};
    var md = obj.metadata, nsName = info.ns ? (md.namespace || o.ns || "default") : null;
    if (info.ns && md.namespace && o.ns && o.forceNs && md.namespace !== o.ns) return { error: "error: the namespace from the provided object \"" + md.namespace + "\" does not match the namespace \"" + o.ns + "\". You must pass '--namespace=" + md.namespace + "' to perform this operation." };
    if (info.ns) md.namespace = nsName;
    if (!md.name && md.generateName) md.name = md.generateName + K.rand("gen" + cl.rv, 5);
    var ref = info.plural + (info.group ? "." + info.group : "") + "/" + (md.name || "");
    var live = md.name ? K.get(cl, k, nsName, md.name) : null;
    var verb = live ? (o.mode === "replace" ? "update" : "patch") : "create";
    if (o.mode === "create" && live) return { error: "Error from server (AlreadyExists): error when creating \"" + (o.source || "STDIN") + "\": " + info.plural + (info.group ? "." + info.group : "") + " \"" + md.name + "\" already exists" };
    if (o.sub && !K.can(cl, o.sub, live ? (o.mode === "replace" ? "update" : "patch") : "create", info.plural, info.group, nsName, live ? md.name : null) && !(live && K.can(cl, o.sub, "update", info.plural, info.group, nsName, md.name))) {
      if (!live && !K.can(cl, o.sub, "get", info.plural, info.group, nsName, md.name) && o.mode === "apply") return { error: "Error from server (Forbidden): error when retrieving current configuration of:\nResource: \"" + (info.group || "") + "/" + info.gv.split("/").pop() + ", Resource=" + info.plural + "\", GroupVersionKind: \"" + (info.group || "") + "/" + info.gv.split("/").pop() + ", Kind=" + k + "\"\nName: \"" + md.name + "\", Namespace: \"" + (nsName || "") + "\"\nfrom server for: \"" + (o.source || "STDIN") + "\": " + K.forbidden(o.sub, "get", info, nsName, md.name).replace(/^Error from server \(Forbidden\): /, "") };
      return { error: "Error from server (Forbidden): error when " + (live ? "applying patch" : "creating") + " \"" + (o.source || "STDIN") + "\": " + K.forbidden(o.sub, verb, info, nsName, md.name).replace(/^Error from server \(Forbidden\): /, "") };
    }
    var unk = K.unknownFields(obj);
    if (unk.length) return { error: "Error from server (BadRequest): error when " + (live ? "applying patch" : "creating") + " \"" + (o.source || "STDIN") + "\": " + k + " in version \"" + obj.apiVersion.split("/").pop() + "\" cannot be handled as a " + k + ": strict decoding error: " + unk.map(function (u) { return "unknown field \"" + u + "\""; }).join(", ") };
    if (info.ns && !K.get(cl, "Namespace", null, nsName)) return { error: "Error from server (NotFound): error when " + (live ? "applying patch" : "creating") + " \"" + (o.source || "STDIN") + "\": namespaces \"" + nsName + "\" not found" };
    var mine = clone(obj);
    delete mine.status;
    var next;
    if (live && o.mode !== "replace") {
      var lastTxt = ((live.metadata.annotations || {})["kubectl.kubernetes.io/last-applied-configuration"]), last = null;
      try { last = lastTxt ? JSON.parse(lastTxt) : null; } catch (e) { last = null; }
      var liveNoStatus = clone(live); delete liveNoStatus.status; delete liveNoStatus._rt;
      next = merge3(liveNoStatus, last, mine);
      next.metadata = Object.assign({}, live.metadata, { labels: mine.metadata.labels || (last && last.metadata && last.metadata.labels ? {} : live.metadata.labels), annotations: Object.assign({}, live.metadata.annotations || {}, mine.metadata.annotations || {}) });
      if (last && last.metadata && last.metadata.annotations) keys(last.metadata.annotations).forEach(function (a) { if (!(mine.metadata.annotations || {})[a]) delete next.metadata.annotations[a]; });
    } else next = mine;
    if (o.mode === "apply") { next.metadata.annotations = next.metadata.annotations || {}; var lac = clone(obj); delete lac.status; if (lac.metadata) { delete lac.metadata.resourceVersion; delete lac.metadata.uid; delete lac.metadata.creationTimestamp; } next.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"] = JSON.stringify(lac) + "\n"; }
    if (next.metadata.annotations && !keys(next.metadata.annotations).length) delete next.metadata.annotations;
    if (!live) next.metadata.uid = K.uid(cl, ref);
    K.defaults(cl, next);
    var errs = K.validate(cl, next, live);
    if (errs.length) return { error: "The " + k + " \"" + md.name + "\" is invalid: " + (errs.length === 1 ? errs[0] : "\n" + errs.map(function (e) { return "* " + e; }).join("\n")) };
    var adm = K.admit(cl, next, live ? "UPDATE" : "CREATE", o.sub);
    if (adm.deny) return { error: "Error from server" + (adm.code ? " (" + adm.code + ")" : "") + ": error when " + (live ? "applying patch" : "creating") + " \"" + (o.source || "STDIN") + "\": " + adm.deny };
    var same = false;
    if (live) { var a = clone(live), b = clone(next); [a, b].forEach(function (x) { delete x.status; delete x._rt; delete x.metadata.resourceVersion; delete x.metadata.generation; delete x.metadata.managedFields; }); same = JSON.stringify(a) === JSON.stringify(b); }
    var res = { ref: ref, info: info, warnings: adm.warnings || [], action: live ? (same ? "unchanged" : (o.mode === "replace" ? "replaced" : "configured")) : "created" };
    if (o.dryRun) { res.obj = next; res.dry = true; return res; }
    if (!same) { if (live) next.status = live.status; K.store(cl, next); K.audit(cl, o.sub, live ? verb : "create", next); }
    res.obj = K.get(cl, k, nsName, md.name);
    K.reconcile(cl);
    return res;
  };
  K.audit = function (cl, sub, verb, obj, extra) { cl.audit.push(Object.assign({ t: K.t(cl), cmd: CI.homeSys(cl.home).cmdIndex, user: sub ? sub.user : "system", verb: verb, kind: obj.kind, ns: obj.metadata.namespace, name: obj.metadata.name }, extra || {})); };
  // a controller-side update (status, scale, image): no admission beyond validation
  K.update = function (cl, obj, sub, verb) {
    K.defaults(cl, obj);
    var live = K.get(cl, obj.kind, obj.metadata.namespace, obj.metadata.name);
    var errs = K.validate(cl, obj, live);
    if (errs.length) return { error: "The " + obj.kind + " \"" + obj.metadata.name + "\" is invalid: " + errs.join("; ") };
    var adm = K.admit(cl, obj, "UPDATE", sub);
    if (adm.deny) return { error: "Error from server" + (adm.code ? " (" + adm.code + ")" : "") + ": " + adm.deny };
    K.store(cl, obj); if (sub) K.audit(cl, sub, verb || "patch", obj);
    K.reconcile(cl);
    return { obj: obj, warnings: adm.warnings };
  };
  K.del = function (cl, obj, sub) { K.audit(cl, sub, "delete", obj); K.remove(cl, obj); K.reconcile(cl); };

  /* ================================================================== templates -> pods */
  function tplHash(tpl) { var s = JSON.stringify(tpl), h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return K.rand("h" + h, 10).slice(0, 10).replace(/^(.{10}).*/, "$1"); }
  K.tplHash = tplHash;
  function podFrom(cl, owner, tpl, name, extraLabels) {
    var p = { apiVersion: "v1", kind: "Pod", metadata: { name: name, namespace: owner.metadata.namespace, labels: Object.assign({}, (tpl.metadata || {}).labels || {}, extraLabels || {}), annotations: clone((tpl.metadata || {}).annotations) || undefined, ownerReferences: [K.ownerRef(owner)] }, spec: clone(tpl.spec) };
    if (!p.metadata.annotations) delete p.metadata.annotations;
    return p;
  }
  // create a pod through admission (PSA, Kyverno); failures become FailedCreate events on the owner
  function createPod(cl, owner, pod, ctlName) {
    K.defaults(cl, pod);
    pod.metadata.uid = K.uid(cl, pod.metadata.name);
    var adm = K.admit(cl, pod, "CREATE", { user: "system:serviceaccount:kube-system:" + ctlName, groups: ["system:serviceaccounts"] });
    if (adm.deny) { K.event(cl, owner, "Warning", "FailedCreate", "Error creating: " + adm.deny.replace(/^admission webhook/, "admission webhook"), ctlName.replace(/-controller$/, "-controller")); return null; }
    var sa = pod.spec.serviceAccountName || "default";
    if (!K.get(cl, "ServiceAccount", pod.metadata.namespace, sa)) { K.event(cl, owner, "Warning", "FailedCreate", "Error creating: pods \"" + pod.metadata.name + "\" is forbidden: error looking up service account " + pod.metadata.namespace + "/" + sa + ": serviceaccount \"" + sa + "\" not found", ctlName); return null; }
    pod.status = { phase: "Pending", qosClass: qos(pod.spec) };
    K.store(cl, pod);
    K.event(cl, owner, "Normal", "SuccessfulCreate", (owner.kind === "ReplicaSet" || owner.kind === "Job" || owner.kind === "DaemonSet" ? "Created pod: " : "create Pod " + pod.metadata.name + " in StatefulSet " + owner.metadata.name + " successful").replace(/^Created pod: $/, "Created pod: " + pod.metadata.name), ctlName);
    return pod;
  }
  function qos(spec) {
    var cs = spec.containers || [], allG = cs.length > 0, any = false;
    cs.forEach(function (c) { var r = c.resources || {}, rq = r.requests || {}, lm = r.limits || {}; if (keys(rq).length || keys(lm).length) any = true; if (!(lm.cpu && lm.memory && (!rq.cpu || K.cpu(rq.cpu) === K.cpu(lm.cpu)) && (!rq.memory || K.mem(rq.memory) === K.mem(lm.memory)))) allG = false; });
    return allG ? "Guaranteed" : any ? "Burstable" : "BestEffort";
  }
  K.podReady = function (p) { return !p.metadata.deletionTimestamp && p.status && p.status.phase === "Running" && (p.status.conditions || []).some(function (c) { return c.type === "Ready" && c.status === "True"; }); };
  K.podAvailable = function (cl, p, minReady) { return K.podReady(p) && (!minReady || K.t(cl) - (p._rt && p._rt.readySince || 0) >= minReady); };
  K.terminating = function (p) { return p.metadata.deletionTimestamp != null; };

  /* ================================================================== controllers */
  function pct(v, n, up) { if (typeof v === "number") return v; var m = /^(\d+)%$/.exec(String(v)); if (!m) return parseInt(v, 10) || 0; var x = n * +m[1] / 100; return up ? Math.ceil(x) : Math.floor(x); }
  K.pct = pct;
  function rsRevision(rs) { return +((rs.metadata.annotations || {})["deployment.kubernetes.io/revision"] || 0); }
  K.rsRevision = rsRevision;
  function deployCtl(cl, d) {
    var sp = d.spec, rss = K.ownedBy(cl, d, "ReplicaSet").filter(function (r) { return r.kind === "ReplicaSet"; });
    var tpl = clone(sp.template), hash = tplHash(tpl);
    var cur = rss.filter(function (r) { return r.metadata.labels["pod-template-hash"] === hash; })[0];
    var maxRev = rss.reduce(function (m, r) { return Math.max(m, rsRevision(r)); }, 0);
    if (sp.paused) { d.status = statusOf(cl, d, rss, cur); return; }
    if (!cur) {
      var lbl = Object.assign({}, (tpl.metadata || {}).labels, { "pod-template-hash": hash });
      tpl.metadata = Object.assign({}, tpl.metadata, { labels: lbl });
      var cause = (d.metadata.annotations || {})["kubernetes.io/change-cause"];
      cur = { apiVersion: "apps/v1", kind: "ReplicaSet", metadata: { name: d.metadata.name + "-" + hash, namespace: d.metadata.namespace, labels: lbl, annotations: Object.assign({ "deployment.kubernetes.io/desired-replicas": String(sp.replicas), "deployment.kubernetes.io/max-replicas": String(sp.replicas + pct(sp.strategy.rollingUpdate ? sp.strategy.rollingUpdate.maxSurge : 0, sp.replicas, true)), "deployment.kubernetes.io/revision": String(maxRev + 1) }, cause ? { "kubernetes.io/change-cause": cause } : {}), ownerReferences: [K.ownerRef(d)] },
        spec: { replicas: 0, selector: { matchLabels: Object.assign({}, (sp.selector || {}).matchLabels, { "pod-template-hash": hash }), matchExpressions: (sp.selector || {}).matchExpressions }, template: tpl, minReadySeconds: sp.minReadySeconds }, status: { replicas: 0 } };
      if (!cur.spec.selector.matchExpressions) delete cur.spec.selector.matchExpressions;
      K.store(cl, cur);
      rss.push(cur);
      K.event(cl, d, "Normal", "ScalingReplicaSet", "Scaled up replica set " + cur.metadata.name + " to " + (sp.strategy.type === "Recreate" ? 0 : Math.min(sp.replicas, 1)), "deployment-controller");
      d._rt = d._rt || {}; d._rt.progressAt = K.t(cl);
    } else if (rsRevision(cur) < maxRev && rss.length > 1) {
      // rolling back to an older template: it becomes the newest revision
      cur.metadata.annotations["deployment.kubernetes.io/revision"] = String(maxRev + 1);
      var cc = (d.metadata.annotations || {})["kubernetes.io/change-cause"]; if (cc) cur.metadata.annotations["kubernetes.io/change-cause"] = cc;
      d._rt = d._rt || {}; d._rt.progressAt = K.t(cl);
    }
    var cc0 = (d.metadata.annotations || {})["kubernetes.io/change-cause"];
    if (cc0 && cur.metadata.annotations["kubernetes.io/change-cause"] !== cc0) { cur.metadata.annotations["kubernetes.io/change-cause"] = cc0; K.store(cl, cur, { quiet: true }); }
    var olds = rss.filter(function (r) { return r !== cur; });
    var want = sp.replicas;
    function setRs(rs, n) { if (rs.spec.replicas === n) return; var up = n > rs.spec.replicas; rs.spec.replicas = n; rs.metadata.annotations["deployment.kubernetes.io/desired-replicas"] = String(want); K.store(cl, rs); K.event(cl, d, "Normal", "ScalingReplicaSet", "Scaled " + (up ? "up" : "down") + " replica set " + rs.metadata.name + " to " + n + (olds.length && rs === cur ? " from " + (n - 1) : ""), "deployment-controller"); }
    var readyOf = function (rs) { return K.ownedBy(cl, rs, "Pod").filter(function (p) { return K.podAvailable(cl, p, sp.minReadySeconds); }).length; };
    if (sp.strategy.type === "Recreate") {
      var oldPods = olds.reduce(function (n, r) { return n + K.ownedBy(cl, r, "Pod").length; }, 0);
      olds.forEach(function (r) { setRs(r, 0); });
      if (!oldPods) setRs(cur, want);
    } else {
      var surge = pct(sp.strategy.rollingUpdate.maxSurge, want, true), unav = pct(sp.strategy.rollingUpdate.maxUnavailable, want, false);
      if (!surge && !unav) unav = 1;
      var total = rss.reduce(function (n, r) { return n + r.spec.replicas; }, 0);
      if (!olds.some(function (r) { return r.spec.replicas > 0; })) setRs(cur, want);
      else {
        // scale up the new RS within the surge budget
        var room = want + surge - total;
        if (room > 0 && cur.spec.replicas < want) setRs(cur, Math.min(want, cur.spec.replicas + room));
        // scale down old ones while keeping enough available
        var avail = rss.reduce(function (n, r) { return n + readyOf(r); }, 0), minAvail = want - unav;
        var canDrop = avail - minAvail;
        // old pods that aren't available can always go
        olds.sort(function (a, b) { return rsRevision(a) - rsRevision(b); }).forEach(function (r) {
          var notReady = r.spec.replicas - readyOf(r), drop = Math.min(r.spec.replicas, Math.max(0, notReady) + Math.max(0, canDrop));
          if (drop > 0 && r.spec.replicas > 0) { var take = Math.min(drop, r.spec.replicas); canDrop -= Math.max(0, take - Math.max(0, notReady)); setRs(r, r.spec.replicas - take); }
        });
        total = rss.reduce(function (n, r) { return n + r.spec.replicas; }, 0);
        room = want + surge - total;
        if (room > 0 && cur.spec.replicas < want) setRs(cur, Math.min(want, cur.spec.replicas + room));
      }
    }
    // old ReplicaSets beyond revisionHistoryLimit are deleted
    var spare = olds.filter(function (r) { return r.spec.replicas === 0 && !K.ownedBy(cl, r, "Pod").length; }).sort(function (a, b) { return rsRevision(a) - rsRevision(b); });
    while (spare.length > sp.revisionHistoryLimit) K.remove(cl, spare.shift());
    d.status = statusOf(cl, d, K.ownedBy(cl, d, "ReplicaSet"), cur);
  }
  function statusOf(cl, d, rss, cur) {
    var sp = d.spec, pods = [], st = d.status || {};
    rss.forEach(function (r) { pods = pods.concat(K.ownedBy(cl, r, "Pod").filter(function (p) { return !K.terminating(p); })); });
    var ready = pods.filter(K.podReady).length, avail = pods.filter(function (p) { return K.podAvailable(cl, p, sp.minReadySeconds); }).length;
    var upd = cur ? K.ownedBy(cl, cur, "Pod").filter(function (p) { return !K.terminating(p); }).length : 0;
    var done = cur && upd === sp.replicas && pods.length === sp.replicas && avail === sp.replicas;
    var dr = d._rt || (d._rt = {});
    if (done && !dr.complete) { dr.complete = K.t(cl); }
    if (!done) dr.complete = null;
    var failed = !done && dr.progressAt != null && K.t(cl) - dr.progressAt > sp.progressDeadlineSeconds;
    var conds = [{ type: "Available", status: avail >= sp.replicas - pct(sp.strategy.rollingUpdate ? sp.strategy.rollingUpdate.maxUnavailable : 0, sp.replicas, false) ? "True" : "False", reason: avail >= sp.replicas - pct(sp.strategy.rollingUpdate ? sp.strategy.rollingUpdate.maxUnavailable : 0, sp.replicas, false) ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable", message: avail >= sp.replicas - pct(sp.strategy.rollingUpdate ? sp.strategy.rollingUpdate.maxUnavailable : 0, sp.replicas, false) ? "Deployment has minimum availability." : "Deployment does not have minimum availability." },
      { type: "Progressing", status: failed ? "False" : "True", reason: failed ? "ProgressDeadlineExceeded" : done ? "NewReplicaSetAvailable" : "ReplicaSetUpdated", message: failed ? "ReplicaSet \"" + (cur ? cur.metadata.name : "") + "\" has timed out progressing." : done ? "ReplicaSet \"" + cur.metadata.name + "\" has successfully progressed." : "ReplicaSet \"" + (cur ? cur.metadata.name : "") + "\" is progressing." }];
    return { observedGeneration: d.metadata.generation, replicas: pods.length, updatedReplicas: upd, readyReplicas: ready || undefined, availableReplicas: avail || undefined, unavailableReplicas: Math.max(0, sp.replicas - avail) || undefined, conditions: conds, collisionCount: st.collisionCount };
  }
  K.deployDone = function (cl, d) { var c = ((d.status || {}).conditions || []).filter(function (x) { return x.type === "Progressing"; })[0]; return !!c && c.reason === "NewReplicaSetAvailable" && (d.status.availableReplicas || 0) >= d.spec.replicas && (d.status.observedGeneration === d.metadata.generation); };
  K.deployFailed = function (d) { var c = ((d.status || {}).conditions || []).filter(function (x) { return x.type === "Progressing"; })[0]; return !!c && c.reason === "ProgressDeadlineExceeded"; };
  function rsCtl(cl, rs) {
    var pods = K.ownedBy(cl, rs, "Pod").filter(function (p) { return !K.terminating(p); });
    var want = rs.spec.replicas;
    if (pods.length < want) {
      var fails = (rs._rt || {}).createFailAt;
      if (fails && K.t(cl) - fails < 3) { rs.status = rsStatus(cl, rs); return; }
      for (var i = pods.length; i < want; i++) {
        var p = createPod(cl, rs, podFrom(cl, rs, rs.spec.template, rs.metadata.name + "-" + K.rand("pod" + cl.rv + i + rs.metadata.uid, 5)), "replicaset-controller");
        if (!p) { (rs._rt = rs._rt || {}).createFailAt = K.t(cl); break; }
      }
    } else if (pods.length > want) {
      // delete not-ready pods first, then the newest
      pods.sort(function (a, b) { return (K.podReady(a) ? 1 : 0) - (K.podReady(b) ? 1 : 0) || b.metadata.creationTimestamp - a.metadata.creationTimestamp; });
      pods.slice(0, pods.length - want).forEach(function (p) { K.terminatePod(cl, p); K.event(cl, rs, "Normal", "SuccessfulDelete", "Deleted pod: " + p.metadata.name, "replicaset-controller"); });
    }
    rs.status = rsStatus(cl, rs);
  }
  function rsStatus(cl, rs) { var pods = K.ownedBy(cl, rs, "Pod").filter(function (p) { return !K.terminating(p); }); return { replicas: pods.length, readyReplicas: pods.filter(K.podReady).length || undefined, availableReplicas: pods.filter(function (p) { return K.podAvailable(cl, p, rs.spec.minReadySeconds); }).length || undefined, fullyLabeledReplicas: pods.length, observedGeneration: rs.metadata.generation }; }
  function stsCtl(cl, s) {
    var sp = s.spec, pods = K.ownedBy(cl, s, "Pod"), want = sp.replicas, hash = tplHash(sp.template), rev = s.metadata.name + "-" + hash;
    // claims from volumeClaimTemplates: data-<sts>-<ordinal>
    for (var i = 0; i < want; i++) {
      var name = s.metadata.name + "-" + i, p = pods.filter(function (x) { return x.metadata.name === name; })[0];
      (sp.volumeClaimTemplates || []).forEach(function (vt) {
        var cn = vt.metadata.name + "-" + name;
        if (!K.get(cl, "PersistentVolumeClaim", s.metadata.namespace, cn)) { var pvc = { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: cn, namespace: s.metadata.namespace, labels: clone((sp.selector || {}).matchLabels) }, spec: clone(vt.spec) }; K.defaults(cl, pvc); pvc.status = { phase: "Pending" }; K.store(cl, pvc); K.event(cl, s, "Normal", "SuccessfulCreate", "create Claim " + cn + " Pod " + name + " in StatefulSet " + s.metadata.name + " success", "statefulset-controller"); }
      });
      if (!p) {
        if (sp.podManagementPolicy !== "Parallel" && i > 0) { var prev = K.get(cl, "Pod", s.metadata.namespace, s.metadata.name + "-" + (i - 1)); if (!prev || !K.podReady(prev)) break; }
        var pod = podFrom(cl, s, sp.template, name, { "statefulset.kubernetes.io/pod-name": name, "apps.kubernetes.io/pod-index": String(i), "controller-revision-hash": rev });
        pod.spec.hostname = name; pod.spec.subdomain = sp.serviceName;
        (sp.volumeClaimTemplates || []).forEach(function (vt) { pod.spec.volumes = (pod.spec.volumes || []).filter(function (v) { return v.name !== vt.metadata.name; }).concat([{ name: vt.metadata.name, persistentVolumeClaim: { claimName: vt.metadata.name + "-" + name } }]); });
        if (!createPod(cl, s, pod, "statefulset-controller")) break;
        if (sp.podManagementPolicy !== "Parallel") break;
      } else if (p.metadata.labels["controller-revision-hash"] !== rev && !K.terminating(p)) {
        // rolling update from the highest ordinal down, one at a time
        var higherNotReady = pods.some(function (x) { var o = +x.metadata.labels["apps.kubernetes.io/pod-index"]; return o > i && (!K.podReady(x) || x.metadata.labels["controller-revision-hash"] !== rev); });
        if (!higherNotReady && i === Math.max.apply(null, pods.filter(function (x) { return x.metadata.labels["controller-revision-hash"] !== rev; }).map(function (x) { return +x.metadata.labels["apps.kubernetes.io/pod-index"]; }))) K.terminatePod(cl, p);
      }
    }
    pods.filter(function (p) { return +p.metadata.labels["apps.kubernetes.io/pod-index"] >= want && !K.terminating(p); }).sort(function (a, b) { return +b.metadata.labels["apps.kubernetes.io/pod-index"] - +a.metadata.labels["apps.kubernetes.io/pod-index"]; }).slice(0, 1).forEach(function (p) { K.terminatePod(cl, p); K.event(cl, s, "Normal", "SuccessfulDelete", "delete Pod " + p.metadata.name + " in StatefulSet " + s.metadata.name + " successful", "statefulset-controller"); });
    var live = K.ownedBy(cl, s, "Pod").filter(function (p) { return !K.terminating(p); });
    s.status = { observedGeneration: s.metadata.generation, replicas: live.length, readyReplicas: live.filter(K.podReady).length || undefined, availableReplicas: live.filter(K.podReady).length, currentReplicas: live.filter(function (p) { return p.metadata.labels["controller-revision-hash"] === rev; }).length, updatedReplicas: live.filter(function (p) { return p.metadata.labels["controller-revision-hash"] === rev; }).length, currentRevision: rev, updateRevision: rev, collisionCount: 0 };
  }
  function dsCtl(cl, d) {
    var nodes = K.all(cl, "Node").filter(function (n) { return !(n.spec.taints || []).length || ((d.spec.template.spec || {}).tolerations || []).length; });
    var pods = K.ownedBy(cl, d, "Pod");
    nodes.forEach(function (n) {
      if (pods.some(function (p) { return p.spec.nodeName === n.metadata.name; })) return;
      var p = podFrom(cl, d, d.spec.template, d.metadata.name + "-" + K.rand("ds" + n.metadata.name + d.metadata.uid, 5), { "controller-revision-hash": tplHash(d.spec.template), "pod-template-generation": String(d.metadata.generation || 1) });
      p.spec.nodeName = n.metadata.name;
      createPod(cl, d, p, "daemonset-controller");
    });
    var live = K.ownedBy(cl, d, "Pod");
    d.status = { currentNumberScheduled: live.length, desiredNumberScheduled: nodes.length, numberReady: live.filter(K.podReady).length, numberAvailable: live.filter(K.podReady).length || undefined, updatedNumberScheduled: live.length, numberMisscheduled: 0, observedGeneration: d.metadata.generation };
  }
  function jobCtl(cl, j) {
    var sp = j.spec, st = j.status = j.status || {}, pods = K.ownedBy(cl, j, "Pod");
    if (st.completionTime || (st.conditions || []).some(function (c) { return c.type === "Failed" && c.status === "True"; })) return;
    if (st.startTime == null) st.startTime = K.t(cl);
    var succeeded = pods.filter(function (p) { return p.status.phase === "Succeeded"; }).length;
    var failedPods = pods.filter(function (p) { return p.status.phase === "Failed"; }).length;
    var restarts = pods.reduce(function (n, p) { return n + ((p.status.containerStatuses || []).reduce(function (m, c) { return m + c.restartCount; }, 0)); }, 0);
    var failures = failedPods + (sp.template.spec.restartPolicy === "OnFailure" ? restarts : 0);
    var active = pods.filter(function (p) { return !K.terminating(p) && p.status.phase !== "Succeeded" && p.status.phase !== "Failed"; });
    st.active = active.length || undefined; st.succeeded = succeeded || undefined; st.failed = failures || undefined; st.ready = active.filter(K.podReady).length; st.terminating = 0;
    if (failures > sp.backoffLimit) {
      active.forEach(function (p) { K.terminatePod(cl, p); });
      st.conditions = [{ type: "FailureTarget", status: "True", reason: "BackoffLimitExceeded", message: "Job has reached the specified backoff limit" }, { type: "Failed", status: "True", reason: "BackoffLimitExceeded", message: "Job has reached the specified backoff limit", lastTransitionTime: K.t(cl) }];
      st.active = undefined;
      K.event(cl, j, "Warning", "BackoffLimitExceeded", "Job has reached the specified backoff limit", "job-controller");
      return;
    }
    if (succeeded >= sp.completions) {
      st.completionTime = K.t(cl); st.active = undefined;
      st.conditions = [{ type: "SuccessCriteriaMet", status: "True", reason: "CompletionsReached", message: "Reached expected number of succeeded pods" }, { type: "Complete", status: "True", reason: "CompletionsReached", message: "Reached expected number of succeeded pods", lastTransitionTime: K.t(cl) }];
      K.event(cl, j, "Normal", "Completed", "Job completed", "job-controller");
      return;
    }
    if (sp.suspend) return;
    var lastFail = (j._rt || {}).lastFail;
    var need = Math.min(sp.parallelism, sp.completions - succeeded) - active.length;
    if (failedPods && lastFail && K.t(cl) - lastFail < 10 * Math.pow(2, Math.max(0, failedPods - 1))) need = 0;
    for (var i = 0; i < need; i++) createPod(cl, j, podFrom(cl, j, sp.template, j.metadata.name + "-" + K.rand("job" + cl.rv + i + j.metadata.uid, 5)), "job-controller");
  }
  function cronCtl(cl, cj) {
    var sp = cj.spec, r = cj._rt = cj._rt || { last: Math.max(cj.metadata.creationTimestamp, K.t(cl) - 1) };
    var now = K.t(cl);
    if (!sp.suspend) {
      var due = K.cronDue(cl, sp.schedule, r.last, now);
      if (due != null) {
        r.last = due;
        var running = K.ownedBy(cl, cj, "Job").filter(function (j) { return !(j.status || {}).completionTime && !((j.status || {}).conditions || []).some(function (c) { return c.type === "Failed"; }); });
        if (sp.concurrencyPolicy === "Forbid" && running.length) K.event(cl, cj, "Normal", "JobAlreadyActive", "Not starting job because prior execution is running and concurrency policy is Forbid", "cronjob-controller");
        else {
          if (sp.concurrencyPolicy === "Replace") running.forEach(function (j) { K.remove(cl, j); });
          var sched = Math.floor((Dk.stamp(cl.rt, due) / 1000) / 60);
          K.jobFromTemplate(cl, cj, cj.metadata.name + "-" + sched, true);
          cj.status = Object.assign(cj.status || {}, { lastScheduleTime: due });
        }
      } else r.last = Math.max(r.last, now - 1);
    }
    // history limits
    var jobs = K.ownedBy(cl, cj, "Job").sort(function (a, b) { return a.metadata.creationTimestamp - b.metadata.creationTimestamp; });
    var okJ = jobs.filter(function (j) { return (j.status || {}).completionTime; }), badJ = jobs.filter(function (j) { return ((j.status || {}).conditions || []).some(function (c) { return c.type === "Failed"; }); });
    while (okJ.length > sp.successfulJobsHistoryLimit) { var x = okJ.shift(); K.remove(cl, x); K.event(cl, cj, "Normal", "SawCompletedJob", "Saw completed job: " + x.metadata.name + ", condition: Complete", "cronjob-controller"); }
    while (badJ.length > sp.failedJobsHistoryLimit) K.remove(cl, badJ.shift());
    var act = K.ownedBy(cl, cj, "Job").filter(function (j) { return !(j.status || {}).completionTime && !((j.status || {}).conditions || []).some(function (c) { return c.type === "Failed"; }); });
    cj.status = Object.assign(cj.status || {}, { active: act.length ? act.map(function (j) { return { kind: "Job", name: j.metadata.name, namespace: j.metadata.namespace }; }) : undefined });
    var lastOk = okJ.length ? okJ[okJ.length - 1] : null; if (lastOk) cj.status.lastSuccessfulTime = lastOk.status.completionTime;
  }
  K.jobFromTemplate = function (cl, cj, name, owned) {
    var t = cj.spec.jobTemplate, j = { apiVersion: "batch/v1", kind: "Job", metadata: { name: name, namespace: cj.metadata.namespace, labels: clone((t.metadata || {}).labels), annotations: owned ? undefined : { "cronjob.kubernetes.io/instantiate": "manual" }, ownerReferences: [K.ownerRef(cj, owned)] }, spec: clone(t.spec) };
    if (!j.metadata.labels) delete j.metadata.labels; if (!j.metadata.annotations) delete j.metadata.annotations;
    j.metadata.uid = K.uid(cl, name);
    K.defaults(cl, j);
    K.store(cl, j);
    if (owned) K.event(cl, cj, "Normal", "SuccessfulCreate", "Created job " + name, "cronjob-controller");
    return j;
  };
  function nsCtl(cl, n) {
    var name = n.metadata.name;
    if (!K.get(cl, "ServiceAccount", name, "default")) K.store(cl, { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: "default", namespace: name, creationTimestamp: n.metadata.creationTimestamp }, imagePullSecrets: cl.pullSecret && K.get(cl, "Secret", name, cl.pullSecret) ? [{ name: cl.pullSecret }] : undefined }, { quiet: true });
    if (!K.get(cl, "ConfigMap", name, "kube-root-ca.crt")) K.store(cl, { apiVersion: "v1", kind: "ConfigMap", metadata: { name: "kube-root-ca.crt", namespace: name, creationTimestamp: n.metadata.creationTimestamp, annotations: { "kubernetes.io/description": "Contains a CA bundle that can be used to verify the kube-apiserver when using internal endpoints such as the internal service IP or kubernetes.default.svc. No other usage is guaranteed across distributions of Kubernetes clusters." } }, data: { "ca.crt": "-----BEGIN CERTIFICATE-----\nMIIBdzCCAR2gAwIBAgIBADAKBggqhkjOPQQDAjAjMSEwHwYDVQQDDBhrM3Mtc2Vy\n-----END CERTIFICATE-----\n" } }, { quiet: true });
    if (name === "default" && !K.get(cl, "Service", "default", "kubernetes")) K.store(cl, { apiVersion: "v1", kind: "Service", metadata: { name: "kubernetes", namespace: "default", labels: { component: "apiserver", provider: "kubernetes" }, creationTimestamp: cl.created }, spec: { clusterIP: "10.43.0.1", clusterIPs: ["10.43.0.1"], type: "ClusterIP", ports: [{ name: "https", port: 443, protocol: "TCP", targetPort: 6443 }], sessionAffinity: "None" } }, { quiet: true });
  }

  /* ---------------- PVCs and volumes */
  function pvcCtl(cl, c) {
    var st = c.status = c.status || { phase: "Pending" };
    if (st.phase === "Bound") return;
    var sc = c.spec.storageClassName ? K.get(cl, "StorageClass", null, c.spec.storageClassName) : null;
    if (c.spec.storageClassName && !sc) { K.event(cl, c, "Warning", "ProvisioningFailed", "storageclass.storage.k8s.io \"" + c.spec.storageClassName + "\" not found", "persistentvolume-controller"); return; }
    if (!sc) { K.event(cl, c, "Normal", "FailedBinding", "no persistent volumes available for this claim and no storage class is set", "persistentvolume-controller"); return; }
    var user = K.list(cl, "Pod", c.metadata.namespace).filter(function (p) { return p.spec.nodeName && (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === c.metadata.name; }); })[0];
    if (sc.volumeBindingMode === "WaitForFirstConsumer" && !user) { K.event(cl, c, "Normal", "WaitForFirstConsumer", "waiting for first consumer to be created before binding", "persistentvolume-controller"); return; }
    var r = c._rt = c._rt || {};
    if (r.provAt == null) { r.provAt = K.t(cl) + 2; K.event(cl, c, "Normal", "ExternalProvisioning", "Waiting for a volume to be created either by the external provisioner 'rancher.io/local-path' or manually by the system administrator. If volume creation is delayed, please verify that your external provisioner is running and correctly registered.", "persistentvolume-controller"); K.event(cl, c, "Normal", "Provisioning", "External provisioner is provisioning volume for claim \"" + c.metadata.namespace + "/" + c.metadata.name + "\"", "rancher.io/local-path_local-path-provisioner-" + K.rand("lpp", 5)); return; }
    if (K.t(cl) < r.provAt) return;
    var pvName = "pvc-" + c.metadata.uid, node = user ? user.spec.nodeName : "kc-node-1";
    var pv = { apiVersion: "v1", kind: "PersistentVolume", metadata: { name: pvName, annotations: { "pv.kubernetes.io/provisioned-by": "rancher.io/local-path", "local.path.provisioner/selected-node": node } },
      spec: { capacity: { storage: c.spec.resources.requests.storage }, accessModes: clone(c.spec.accessModes), persistentVolumeReclaimPolicy: sc.reclaimPolicy || "Delete", storageClassName: sc.metadata.name, volumeMode: "Filesystem", claimRef: { apiVersion: "v1", kind: "PersistentVolumeClaim", name: c.metadata.name, namespace: c.metadata.namespace, uid: c.metadata.uid }, hostPath: { path: "/var/lib/rancher/k3s/storage/" + pvName + "_" + c.metadata.namespace + "_" + c.metadata.name, type: "DirectoryOrCreate" }, nodeAffinity: { required: { nodeSelectorTerms: [{ matchExpressions: [{ key: "kubernetes.io/hostname", operator: "In", values: [node] }] }] } } },
      status: { phase: "Bound" } };
    K.store(cl, pv);
    Dk.makeVolume(cl.rt, pvName, {});
    c.spec.volumeName = pvName;
    c.status = { phase: "Bound", accessModes: clone(c.spec.accessModes), capacity: { storage: c.spec.resources.requests.storage } };
    c.metadata.annotations = Object.assign({}, c.metadata.annotations, { "pv.kubernetes.io/bind-completed": "yes", "pv.kubernetes.io/bound-by-controller": "yes", "volume.kubernetes.io/selected-node": node, "volume.kubernetes.io/storage-provisioner": "rancher.io/local-path" });
    K.store(cl, c);
    K.event(cl, c, "Normal", "ProvisioningSucceeded", "Successfully provisioned volume " + pvName, "rancher.io/local-path_local-path-provisioner-" + K.rand("lpp", 5));
  }
  K.onDelete = function (cl, obj) {
    if (obj.kind === "PersistentVolumeClaim" && obj.spec.volumeName) { var pv = K.get(cl, "PersistentVolume", null, obj.spec.volumeName); if (pv) { if (pv.spec.persistentVolumeReclaimPolicy === "Delete") { K.remove(cl, pv); Dk.removeVolume(cl.rt, pv.metadata.name); } else { pv.status = { phase: "Released" }; } } }
    if (obj.kind === "Pod") K.killPodContainers(cl, obj, true);
  };

  /* ================================================================== the scheduler */
  function nodeOf(cl, name) { return K.get(cl, "Node", null, name); }
  function nodeIp(cl, name) { var n = nodeOf(cl, name); return n ? n.status.addresses[0].address : ""; }
  K.nodeIp = nodeIp;
  function podRequests(p) { var cpu = 0, mem = 0; (p.spec.containers || []).forEach(function (c) { var r = (c.resources || {}).requests || {}; cpu += K.cpu(r.cpu); mem += K.mem(r.memory); }); return { cpu: cpu, mem: mem }; }
  K.podRequests = podRequests;
  K.nodeUsage = function (cl, name) { var cpu = 0, mem = 0, n = 0; K.all(cl, "Pod").forEach(function (p) { if (p.spec.nodeName !== name || /^(Succeeded|Failed)$/.test(p.status.phase)) return; var r = podRequests(p); cpu += r.cpu; mem += r.mem; n++; }); return { cpu: cpu, mem: mem, pods: n }; };
  function tolerates(p, taint) { return (p.spec.tolerations || []).some(function (t) { return (t.operator === "Exists" && (!t.key || t.key === taint.key)) || (t.key === taint.key && (!t.effect || t.effect === taint.effect)); }); }
  function schedule(cl, p) {
    var nodes = K.all(cl, "Node"), req = podRequests(p), reasons = {};
    function why(r) { reasons[r] = (reasons[r] || 0) + 1; }
    // claims must exist; bound volumes pin the node
    var pin = null, claimProblem = null;
    (p.spec.volumes || []).forEach(function (v) {
      if (!v.persistentVolumeClaim) return;
      var c = K.get(cl, "PersistentVolumeClaim", p.metadata.namespace, v.persistentVolumeClaim.claimName);
      if (!c) { claimProblem = "persistentvolumeclaim \"" + v.persistentVolumeClaim.claimName + "\" not found"; return; }
      var sc = c.spec.storageClassName ? K.get(cl, "StorageClass", null, c.spec.storageClassName) : null;
      if (c.status.phase !== "Bound" && !(sc && sc.volumeBindingMode === "WaitForFirstConsumer")) { claimProblem = "pod has unbound immediate PersistentVolumeClaims"; return; }
      if (c.spec.volumeName) { var pv = K.get(cl, "PersistentVolume", null, c.spec.volumeName); if (pv) pin = pv.metadata.annotations["local.path.provisioner/selected-node"]; }
    });
    if (claimProblem) { K.event(cl, p, "Warning", "FailedScheduling", "0/" + nodes.length + " nodes are available: " + claimProblem + ". preemption: 0/" + nodes.length + " nodes are available: " + nodes.length + " Preemption is not helpful for scheduling.", "default-scheduler"); return null; }
    var fit = nodes.filter(function (n) {
      var nm = n.metadata.name;
      var bad = (n.spec.taints || []).filter(function (t) { return t.effect === "NoSchedule" && !tolerates(p, t); })[0];
      if (bad) { why("1 node(s) had untolerated taint {" + bad.key + ": }"); return false; }
      if (p.spec.nodeSelector && !keys(p.spec.nodeSelector).every(function (k) { return (n.metadata.labels || {})[k] === String(p.spec.nodeSelector[k]); })) { why("node(s) didn't match Pod's node affinity/selector"); return false; }
      if (pin && pin !== nm) { why("node(s) had volume node affinity conflict"); return false; }
      var u = K.nodeUsage(cl, nm), alloc = { cpu: K.cpu(n.status.allocatable.cpu), mem: K.mem(n.status.allocatable.memory) };
      var noCpu = u.cpu + req.cpu > alloc.cpu, noMem = u.mem + req.mem > alloc.mem;
      if (noCpu) why("Insufficient cpu"); if (noMem) why("Insufficient memory");
      return !noCpu && !noMem;
    });
    if (!fit.length) {
      var parts = keys(reasons).map(function (r) { var m = /^1 node\(s\)/.test(r) ? r : reasons[r] + " " + r; return m; }).sort();
      K.event(cl, p, "Warning", "FailedScheduling", "0/" + nodes.length + " nodes are available: " + parts.join(", ") + ". preemption: 0/" + nodes.length + " nodes are available: " + (reasons["1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }"] ? "1 Preemption is not helpful for scheduling, " + (nodes.length - 1) + " No preemption victims found for incoming pod." : nodes.length + " No preemption victims found for incoming pod."), "default-scheduler");
      p.status.conditions = [{ type: "PodScheduled", status: "False", reason: "Unschedulable", message: "0/" + nodes.length + " nodes are available: " + parts.join(", ") + "." }];
      return null;
    }
    // spread: fewest pods of the same owner, then least requested
    var owner = ((p.metadata.ownerReferences || [])[0] || {}).uid;
    fit.sort(function (a, b) {
      var sa = K.all(cl, "Pod").filter(function (x) { return x.spec.nodeName === a.metadata.name && ((x.metadata.ownerReferences || [])[0] || {}).uid === owner; }).length;
      var sb = K.all(cl, "Pod").filter(function (x) { return x.spec.nodeName === b.metadata.name && ((x.metadata.ownerReferences || [])[0] || {}).uid === owner; }).length;
      return sa - sb || K.nodeUsage(cl, a.metadata.name).cpu - K.nodeUsage(cl, b.metadata.name).cpu || a.metadata.name.localeCompare(b.metadata.name);
    });
    return fit[0].metadata.name;
  }

  /* ================================================================== the kubelet */
  function podIp(cl, node) { var idx = NODES.map(function (n) { return n.name; }).indexOf(node); cl.podIp[node] = (cl.podIp[node] || 3) + 1; return "10.42." + Math.max(0, idx) + "." + cl.podIp[node]; }
  function ctrStatus(p, name) { return (p.status.containerStatuses || []).filter(function (c) { return c.name === name; })[0]; }
  function cs(p, c) {
    var list = p.status.containerStatuses = p.status.containerStatuses || [];
    var s = list.filter(function (x) { return x.name === c.name; })[0];
    if (!s) { s = { name: c.name, image: c.image, imageID: "", ready: false, restartCount: 0, started: false, state: { waiting: { reason: "ContainerCreating" } }, lastState: {} }; list.push(s); }
    return s;
  }
  // can the node pull this image? -> {img, digest} or {error, notFound}
  function pullCheck(cl, p, image) {
    var ref = Dk.parseRef(image);
    if (!ref.valid) return { error: "failed to pull and unpack image \"" + image + "\": failed to resolve reference \"" + image + "\": invalid reference format", invalid: true };
    var full = (ref.registry === "docker.io" ? "docker.io/" + ref.repo : ref.registry + "/" + ref.repo) + (ref.tag ? ":" + ref.tag : "@" + ref.digest);
    var regs = Dk.state(cl.rt).regs, reg = regs[ref.registry];
    if (!reg) return { error: "failed to pull and unpack image \"" + full + "\": failed to resolve reference \"" + full + "\": failed to do request: Head \"https://" + ref.registry + "/v2/" + ref.repo + "/manifests/" + (ref.tag || ref.digest) + "\": dial tcp: lookup " + ref.registry + ": no such host" };
    var creds = null;
    var sa = K.get(cl, "ServiceAccount", p.metadata.namespace, p.spec.serviceAccountName || "default");
    var secrets = (p.spec.imagePullSecrets || []).concat((sa && sa.imagePullSecrets) || []);
    secrets.forEach(function (ps) {
      var s = K.get(cl, "Secret", p.metadata.namespace, ps.name); if (!s || creds) return;
      var cfg = null; try { cfg = JSON.parse(K.unb64((s.data || {})[".dockerconfigjson"] || "") || "{}"); } catch (e) { cfg = null; }
      var a = cfg && cfg.auths && (cfg.auths[ref.registry] || cfg.auths["https://" + ref.registry]);
      if (a) { var up = a.auth ? K.unb64(a.auth).split(":") : [a.username, a.password]; creds = { user: up[0], pass: up.slice(1).join(":") }; }
    });
    if (!creds && cl.nodeCreds && cl.nodeCreds[ref.registry]) creds = cl.nodeCreds[ref.registry];
    var fake = { sys: cl.rt, uid: 0, home: "/root" };
    var deny = null;
    if (reg.custom && Dk.registryAuth[reg.name]) deny = Dk.registryAuth[reg.name].access(fake, ref, false, creds);
    else if (!reg.public) { var u = creds && reg.users && reg.users[creds.user]; deny = u && u.token === creds.pass && u.namespaces.indexOf(ref.repo.split("/")[0]) >= 0 ? null : "denied"; }
    var hit = Dk.regLookup(cl.rt, ref);
    var auth401 = ref.registry === "ghcr.io" ? "failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3A" + ref.repo.replace(/\//g, "%2F") + "%3Apull&service=ghcr.io: 401 Unauthorized" : "pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed";
    if (deny) return { error: "failed to pull and unpack image \"" + full + "\": failed to resolve reference \"" + full + "\": " + auth401, auth: true };
    if (!hit) return { error: (ref.registry === "docker.io" && !reg.repos[ref.repo] ? "failed to pull and unpack image \"" + full + "\": failed to resolve reference \"" + full + "\": pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed" : "failed to pull and unpack image \"" + full + "\": failed to resolve reference \"" + full + "\": " + full + ": not found"), notFound: true };
    return { img: hit.img, digest: hit.digest, full: full, repo: (ref.registry === "docker.io" ? "docker.io/" + ref.repo : ref.registry + "/" + ref.repo) };
  }
  K.pullCheck = pullCheck;
  // where the container's env comes from -> {env} or {error}
  function envFor(cl, p, c) {
    var env = {}, nsName = p.metadata.namespace;
    function cm(n) { return K.get(cl, "ConfigMap", nsName, n); }
    function sec(n) { return K.get(cl, "Secret", nsName, n); }
    var list = c.envFrom || [];
    for (var i = 0; i < list.length; i++) {
      var ef = list[i];
      if (ef.configMapRef) { var m = cm(ef.configMapRef.name); if (!m) { if (ef.configMapRef.optional) continue; return { error: "configmap \"" + ef.configMapRef.name + "\" not found" }; } keys(m.data || {}).forEach(function (k) { env[(ef.prefix || "") + k] = m.data[k]; }); }
      if (ef.secretRef) { var s = sec(ef.secretRef.name); if (!s) { if (ef.secretRef.optional) continue; return { error: "secret \"" + ef.secretRef.name + "\" not found" }; } keys(s.data || {}).forEach(function (k) { env[(ef.prefix || "") + k] = K.unb64(s.data[k]); }); }
    }
    var ev = c.env || [];
    for (var j = 0; j < ev.length; j++) {
      var e = ev[j];
      if (e.valueFrom) {
        var vf = e.valueFrom;
        if (vf.configMapKeyRef) { var m2 = cm(vf.configMapKeyRef.name); if (!m2) { if (vf.configMapKeyRef.optional) continue; return { error: "configmap \"" + vf.configMapKeyRef.name + "\" not found" }; } if (!(vf.configMapKeyRef.key in (m2.data || {}))) { if (vf.configMapKeyRef.optional) continue; return { error: "couldn't find key " + vf.configMapKeyRef.key + " in ConfigMap " + nsName + "/" + vf.configMapKeyRef.name }; } env[e.name] = m2.data[vf.configMapKeyRef.key]; }
        else if (vf.secretKeyRef) { var s2 = sec(vf.secretKeyRef.name); if (!s2) { if (vf.secretKeyRef.optional) continue; return { error: "secret \"" + vf.secretKeyRef.name + "\" not found" }; } if (!(vf.secretKeyRef.key in (s2.data || {}))) { if (vf.secretKeyRef.optional) continue; return { error: "couldn't find key " + vf.secretKeyRef.key + " in Secret " + nsName + "/" + vf.secretKeyRef.name }; } env[e.name] = K.unb64(s2.data[vf.secretKeyRef.key]); }
        else if (vf.fieldRef) { var fp = vf.fieldRef.fieldPath; env[e.name] = fp === "metadata.name" ? p.metadata.name : fp === "metadata.namespace" ? nsName : fp === "status.podIP" ? p.status.podIP : fp === "spec.nodeName" ? p.spec.nodeName : fp === "status.hostIP" ? p.status.hostIP : fp === "spec.serviceAccountName" ? p.spec.serviceAccountName : ""; }
      } else env[e.name] = String(e.value == null ? "" : e.value).replace(/\$\((\w+)\)/g, function (m0, n) { return env[n] != null ? env[n] : m0; });
    }
    // service links: NOTES_SERVICE_HOST etc.
    if (p.spec.enableServiceLinks !== false) K.list(cl, "Service", nsName).forEach(function (s) { if (!s.spec.clusterIP || s.spec.clusterIP === "None") return; var n = s.metadata.name.toUpperCase().replace(/-/g, "_"); if (env[n + "_SERVICE_HOST"] == null) { env[n + "_SERVICE_HOST"] = s.spec.clusterIP; env[n + "_SERVICE_PORT"] = String(s.spec.ports[0].port); } });
    env.KUBERNETES_SERVICE_HOST = "10.43.0.1"; env.KUBERNETES_SERVICE_PORT = "443";
    return { env: env };
  }
  K.envFor = envFor;
  // volumes -> Docker engine mounts. Files for configMap/secret/emptyDir live under the runtime's /var/lib/kubelet
  function mountsFor(cl, p, c) {
    var rt = cl.rt, base = "/var/lib/kubelet/pods/" + p.metadata.uid + "/volumes/", out = [];
    var vols = {}; (p.spec.volumes || []).forEach(function (v) { vols[v.name] = v; });
    // service account token
    var sa = K.get(cl, "ServiceAccount", p.metadata.namespace, p.spec.serviceAccountName || "default");
    var automount = p.spec.automountServiceAccountToken != null ? p.spec.automountServiceAccountToken : !(sa && sa.automountServiceAccountToken === false);
    if (automount) {
      var tdir = base + "kubernetes.io~projected/kube-api-access";
      if (!M2.rd(rt, tdir + "/token")) { var tok = K.issueToken(cl, "system:serviceaccount:" + p.metadata.namespace + ":" + (p.spec.serviceAccountName || "default"), 3607, p); S.mkdirs(rt, tdir, 493, 0, 0); S.put(rt, tdir + "/token", tok, 420, 0, 0); S.put(rt, tdir + "/namespace", p.metadata.namespace, 420, 0, 0); S.put(rt, tdir + "/ca.crt", "-----BEGIN CERTIFICATE-----\nMIIBdzCCAR2gAwIBAgIBADAKBggqhkjOPQQDAjAjMSEwHwYDVQQDDBhrM3Mtc2Vy\n-----END CERTIFICATE-----\n", 420, 0, 0); }
      out.push({ type: "bind", src: tdir, dst: "/var/run/secrets/kubernetes.io/serviceaccount", ro: true });
    }
    var list = c.volumeMounts || [];
    for (var i = 0; i < list.length; i++) {
      var vm = list[i], v = vols[vm.name]; if (!v) continue;
      var ro = !!vm.readOnly, dir;
      if (v.emptyDir) { dir = base + "kubernetes.io~empty-dir/" + v.name; if (!Dk.fsNode(rt, dir)) S.mkdirs(rt, dir, 511, 0, 0); out.push({ type: "bind", src: dir + (vm.subPath ? "/" + vm.subPath : ""), dst: vm.mountPath, ro: ro }); continue; }
      if (v.configMap || v.secret) {
        var isSec = !!v.secret, nm = isSec ? v.secret.secretName : v.configMap.name, o2 = isSec ? K.get(cl, "Secret", p.metadata.namespace, nm) : K.get(cl, "ConfigMap", p.metadata.namespace, nm);
        if (!o2) { if ((v.configMap || v.secret).optional) continue; return { error: "MountVolume.SetUp failed for volume \"" + v.name + "\" : " + (isSec ? "secret" : "configmap") + " \"" + nm + "\" not found", mount: true }; }
        dir = base + (isSec ? "kubernetes.io~secret/" : "kubernetes.io~configmap/") + v.name;
        S.mkdirs(rt, dir, 511, 0, 0);
        var dn = Dk.fsNode(rt, dir); dn.children = {};
        var items = (v.configMap || v.secret).items, data = o2.data || {};
        var mode = (v.configMap || v.secret).defaultMode != null ? (v.configMap || v.secret).defaultMode : 420;
        (items || keys(data).map(function (k) { return { key: k, path: k }; })).forEach(function (it) { if (!(it.key in data)) return; S.put(rt, dir + "/" + it.path, isSec ? K.unb64(data[it.key]) : data[it.key], it.mode != null ? it.mode : mode, 0, 0); });
        out.push({ type: "bind", src: dir + (vm.subPath ? "/" + vm.subPath : ""), dst: vm.mountPath, ro: true, k8sSrc: true });
        continue;
      }
      if (v.persistentVolumeClaim) {
        var claim = K.get(cl, "PersistentVolumeClaim", p.metadata.namespace, v.persistentVolumeClaim.claimName);
        if (!claim || !claim.spec.volumeName) return { error: "pending claim" };
        Dk.makeVolume(rt, claim.spec.volumeName, {}); var vn = Dk.fsNode(rt, "/var/lib/docker/volumes/" + claim.spec.volumeName + "/_data"); if (vn && !vn.k8sInit) { vn.mode = 511; vn.k8sInit = true; }
        out.push({ type: "volume", name: claim.spec.volumeName, dst: vm.mountPath, ro: ro || !!v.persistentVolumeClaim.readOnly, sub: vm.subPath });
        continue;
      }
      if (v.hostPath) { dir = "/var/lib/k8s-hostpath/" + p.spec.nodeName + v.hostPath.path; S.mkdirs(rt, dir, 493, 0, 0); out.push({ type: "bind", src: dir, dst: vm.mountPath, ro: ro }); }
    }
    return { mounts: out };
  }
  K.issueToken = function (cl, sub, ttl, pod) {
    var claims = { aud: ["https://kubernetes.default.svc.cluster.local", "k3s"], exp: Math.floor(Dk.stamp(cl.rt) / 1000) + ttl, iat: Math.floor(Dk.stamp(cl.rt) / 1000), iss: "https://kubernetes.default.svc.cluster.local", "kubernetes.io": { namespace: sub.split(":")[2], serviceaccount: { name: sub.split(":")[3] }, pod: pod ? { name: pod.metadata.name } : undefined }, sub: sub };
    var b64u = function (s) { return K.b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var tok = b64u(JSON.stringify({ alg: "RS256", kid: "k3s-" + K.hex("kid", 8) })) + "." + b64u(JSON.stringify(claims)) + "." + K.rand("sig" + cl.uidSeq++ + sub, 86);
    cl.tokens[tok] = { sub: sub, exp: K.t(cl) + ttl };
    return tok;
  };
  function effUser(p, c, img) {
    var psc = p.spec.securityContext || {}, csc = c.securityContext || {};
    var uid = csc.runAsUser != null ? csc.runAsUser : psc.runAsUser != null ? psc.runAsUser : null;
    var nonRoot = csc.runAsNonRoot != null ? csc.runAsNonRoot : psc.runAsNonRoot;
    var iu = String((img && img.cfg.User) || "");
    if (nonRoot && uid == null) {
      if (!iu || iu === "root" || iu === "0" || /^0:/.test(iu)) return { error: "container has runAsNonRoot and image will run as root (pod: \"" + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")\", container: " + c.name + ")" };
      if (!/^\d+/.test(iu)) return { error: "container has runAsNonRoot and image has non-numeric user (" + iu + "), cannot verify user is non-root (pod: \"" + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")\", container: " + c.name + ")" };
    }
    if (nonRoot && uid === 0) return { error: "container's runAsUser breaks non-root policy (pod: \"" + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")\", container: " + c.name + ")" };
    return { user: uid != null ? String(uid) + (csc.runAsGroup != null || psc.runAsGroup != null ? ":" + (csc.runAsGroup != null ? csc.runAsGroup : psc.runAsGroup) : "") : null };
  }
  function backoff(n) { return Math.min(300, 10 * Math.pow(2, Math.max(0, n - 1))); }
  K.ctrOf = function (cl, p, name) { var r = p._rt && p._rt.ctrs && p._rt.ctrs[name || (p.spec.containers[0] || {}).name]; return r && r.c ? r.c : null; };
  K.killPodContainers = function (cl, p, remove) {
    var r = p._rt; if (!r || !r.ctrs) return;
    keys(r.ctrs).forEach(function (n) { var x = r.ctrs[n]; if (x.c) { if (x.c.state === "running") Dk.stopCtr(cl.rt, x.c, "TERM"); if (remove) Dk.removeCtr(cl.rt, x.c, false); } });
  };
  K.terminatePod = function (cl, p) {
    if (p.metadata.deletionTimestamp != null) return;
    p.metadata.deletionTimestamp = K.t(cl);
    p.metadata.deletionGracePeriodSeconds = p.spec.terminationGracePeriodSeconds;
    (p._rt = p._rt || {}).goneAt = K.t(cl) + (p._rt.virtual ? 1 : 2);
    keys(p._rt.ctrs || {}).forEach(function (n) { var x = p._rt.ctrs[n]; if (x.c && x.c.state === "running") { K.event(cl, p, "Normal", "Killing", "Stopping container " + n, "kubelet"); } });
    (p.status.conditions || []).forEach(function (c) { if (c.type === "Ready" || c.type === "ContainersReady") c.status = "False"; });
  };
  function setCond(p, type, status, reason, msg) {
    var cs2 = p.status.conditions = p.status.conditions || [];
    var c = cs2.filter(function (x) { return x.type === type; })[0];
    if (!c) { c = { type: type }; cs2.push(c); }
    c.status = status; if (reason) c.reason = reason; else delete c.reason; if (msg) c.message = msg; else delete c.message;
  }
  // probes: -> {ok} or {fail: message, timeout}
  function probe(cl, p, c, spec, dc) {
    var app = dc.app, hang = dc.k8sHangAt != null && K.t(cl) >= dc.k8sHangAt;
    var port = function (x) { if (typeof x === "number") return x; var hit = null; (c.ports || []).forEach(function (pp) { if (pp.name === x) hit = pp.containerPort; }); return hit || parseInt(x, 10) || 0; };
    var ip = p.status.podIP;
    if (spec.httpGet) {
      var pt = port(spec.httpGet.port), url = "http://" + ip + ":" + pt + spec.httpGet.path;
      if (hang) return { fail: "Get \"" + url + "\": context deadline exceeded (Client.Timeout exceeded while awaiting headers)", timeout: true };
      var r = dc.state === "running" ? Dk.ctrHttp(cl.rt, dc, pt, { method: "GET", path: spec.httpGet.path, headers: { host: ip + ":" + pt, "user-agent": "kube-probe/1.31" }, scheme: "http", port: pt }, nodeIp(cl, p.spec.nodeName)) : { closed: true };
      if (!r || r.closed || r.proto) return { fail: "Get \"" + url + "\": dial tcp " + ip + ":" + pt + ": connect: connection refused" };
      if (r.status >= 200 && r.status < 400) return { ok: true };
      return { fail: "HTTP probe failed with statuscode: " + r.status };
    }
    if (spec.tcpSocket) { var tp = port(spec.tcpSocket.port); if (!hang && app && (app.listen || []).some(function (l) { return l.port === tp && !/^127\./.test(l.addr); }) && !(app.readyAt != null && Dk.clock(cl.rt) < app.readyAt)) return { ok: true }; return { fail: "dial tcp " + ip + ":" + tp + ": connect: connection refused" }; }
    if (spec.exec) { var x = Dk.runIn(cl.rt, dc, spec.exec.command || [], {}); if (!x.error && x.code === 0) return { ok: true }; return { fail: x.error ? "rpc error: code = Unknown desc = failed to exec in container: failed to start exec \"" + K.hex("ex", 16) + "\": OCI runtime exec failed: exec failed: unable to start container process: " + x.error + ": unknown" : "command " + JSON.stringify((spec.exec.command || []).join(" ")) + " exited with " + x.code + ": " + x.lines.map(function (l) { return l.text; }).join("").trim() }; }
    return { ok: true };
  }
  function startContainer(cl, p, c, r, init) {
    var t = K.t(cl), st = cs(p, c), x = r.ctrs[c.name];
    // image
    if (!x.image) {
      var policy = c.imagePullPolicy, cache = cl.nodeImages[p.spec.nodeName] = cl.nodeImages[p.spec.nodeName] || {};
      if (x.pullAt == null) {
        var cached = cache[c.image];
        if (cached && policy !== "Always") { x.image = cached; K.event(cl, p, "Normal", "Pulled", "Container image \"" + c.image + "\" already present on machine", "kubelet"); }
        else if (policy === "Never") { st.state = { waiting: { reason: "ErrImageNeverPull", message: "Container image \"" + c.image + "\" is not present with pull policy of Never" } }; K.event(cl, p, "Warning", "ErrImageNeverPull", "Container image \"" + c.image + "\" is not present with pull policy of Never", "kubelet"); return; }
        else { x.pullAt = t + (x.pullFails ? 0 : 2); K.event(cl, p, "Normal", "Pulling", "Pulling image \"" + c.image + "\"", "kubelet"); st.state = { waiting: { reason: x.pullFails ? "ImagePullBackOff" : "ContainerCreating", message: x.pullFails ? "Back-off pulling image \"" + c.image + "\": ErrImagePull: " + x.pullErr : undefined } }; return; }
      }
      if (!x.image) {
        if (t < x.pullAt) return;
        var pc = pullCheck(cl, p, c.image);
        if (pc.error) {
          x.pullFails = (x.pullFails || 0) + 1; x.pullErr = pc.error; x.pullAt = null; x.pullRetry = t + backoff(x.pullFails);
          K.event(cl, p, "Warning", "Failed", "Failed to pull image \"" + c.image + "\": " + pc.error, "kubelet");
          K.event(cl, p, "Warning", "Failed", "Error: ErrImagePull", "kubelet");
          st.state = { waiting: { reason: "ErrImagePull", message: pc.error } };
          return;
        }
        var img = Dk.addImage(cl.rt, pc.img, null); img.digests[pc.repo] = pc.digest;
        cache[c.image] = { img: img, digest: pc.digest, repo: pc.repo };
        x.image = cache[c.image];
        K.event(cl, p, "Normal", "Pulled", "Successfully pulled image \"" + c.image + "\" in 1.84s (1.84s including waiting). Image size: " + Math.round(Dk.human ? (pc.img.size || 52e6) / 1e6 : 52) + "000000 bytes.", "kubelet");
      }
    }
    // config
    var ev = envFor(cl, p, c);
    if (ev.error) { st.state = { waiting: { reason: "CreateContainerConfigError", message: ev.error } }; K.event(cl, p, "Warning", "Failed", "Error: " + ev.error, "kubelet"); return; }
    var img2 = x.image.img, eu = effUser(p, c, img2);
    if (eu.error) { st.state = { waiting: { reason: "CreateContainerConfigError", message: eu.error } }; K.event(cl, p, "Warning", "Failed", "Error: " + eu.error, "kubelet"); return; }
    var mt = mountsFor(cl, p, c);
    if (mt.error) { if (mt.mount) { st.state = { waiting: { reason: "ContainerCreating" } }; K.event(cl, p, "Warning", "FailedMount", mt.error, "kubelet"); } return; }
    if (x.c) { x.prev = x.c.logs.slice(); Dk.removeCtr(cl.rt, x.c, false); }
    var csc = c.securityContext || {};
    var dc = Dk.createCtr(cl.rt, img2, { name: "k8s_" + c.name + "_" + p.metadata.name + "_" + p.metadata.namespace + "_" + p.metadata.uid.slice(0, 8) + "_" + st.restartCount, imageRef: c.image, hostname: p.metadata.name, network: "none",
      entrypoint: c.command || null, cmd: c.args || null, env: ev.env, mounts: mt.mounts, user: eu.user, workdir: c.workingDir || null, readOnly: !!csc.readOnlyRootFilesystem, capDrop: (csc.capabilities || {}).drop, privileged: !!csc.privileged });
    if (c.command && !c.args) dc.cmd = []; // command without args drops the image CMD
    dc.nets = [{ net: "k8s", ip: p.status.podIP, aliases: [] }];
    dc.k8s = { uid: p.metadata.uid, ns: p.metadata.namespace, pod: p.metadata.name, ctr: c.name };
    x.c = dc;
    var lim = (c.resources || {}).limits || {};
    dc.mem = lim.memory ? K.mem(lim.memory) : 0;
    var started = Dk.startCtr(cl.rt, dc, {});
    var label = (img2.cfg.Labels || {});
    if (started.error) {
      st.state = { terminated: { exitCode: started.code || 128, reason: "StartError", message: "failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: " + started.error + ": unknown", startedAt: t, finishedAt: t } };
      K.event(cl, p, "Normal", "Created", "Created container " + c.name, "kubelet");
      K.event(cl, p, "Warning", "Failed", "Error: failed to create containerd task: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: " + started.error + ": unknown", "kubelet");
      x.lastExit = t; x.term = true;
      return;
    }
    if (x.restarting) K.event(cl, p, "Normal", "Pulled", "Container image \"" + c.image + "\" already present on machine", "kubelet");
    K.event(cl, p, "Normal", "Created", "Created container " + c.name, "kubelet");
    K.event(cl, p, "Normal", "Started", "Started container " + c.name, "kubelet");
    st.image = c.image; st.imageID = x.image.repo + "@" + x.image.digest; st.containerID = "containerd://" + dc.id;
    st.state = { running: { startedAt: t } }; st.started = true; x.startedAt = t; x.term = false; x.restarting = false;
    x.probes = { startupOk: !c.startupProbe, live: 0, ready: 0, readyOk: !c.readinessProbe, lastL: t, lastR: t, lastS: t };
    // simulated faults carried by the image: a slow warm-up, a hang after a while, memory growth
    if (label["kestrel.sim/warmup-seconds"] && dc.app) dc.app.readyAt = Dk.clock(cl.rt) + +label["kestrel.sim/warmup-seconds"];
    if (label["kestrel.sim/hang-after-seconds"]) dc.k8sHangAt = t + +label["kestrel.sim/hang-after-seconds"];
    var appMem = (dc.app && dc.app.mem) || 8 * MB;
    if (label["kestrel.sim/memory-mb"]) appMem = +label["kestrel.sim/memory-mb"] * MB;
    dc.k8sMem = appMem;
    if (dc.mem && appMem > dc.mem && dc.state === "running") dc.k8sOomAt = t + 2;
    // a leak: resident memory grows by N MiB a minute until the limit kills it
    if (label["kestrel.sim/leak-mb-per-min"]) { dc.k8sLeak = +label["kestrel.sim/leak-mb-per-min"]; dc.k8sLeakStart = t; dc.k8sMemBase = appMem; if (dc.mem && dc.k8sOomAt == null) dc.k8sOomAt = t + Math.max(30, Math.round((dc.mem - appMem) / MB / dc.k8sLeak * 60)); }
    void init;
  }
  function stopped(cl, p, c, x, code, reason) {
    var st = cs(p, c), t = K.t(cl);
    st.lastState = { terminated: { exitCode: code, reason: reason, startedAt: x.startedAt, finishedAt: t, containerID: st.containerID } };
    st.state = { terminated: { exitCode: code, reason: reason, startedAt: x.startedAt, finishedAt: t, containerID: st.containerID } };
    st.ready = false; x.lastExit = t; x.term = true;
  }
  function kubelet(cl, p) {
    var t = K.t(cl), r = p._rt = p._rt || {};
    p.status = p.status || { phase: "Pending", qosClass: qos(p.spec) };
    if (p.metadata.deletionTimestamp != null) { if (t >= r.goneAt) { K.killPodContainers(cl, p, true); K.unstore(cl, p); } return; }
    if (p.status.phase === "Succeeded" || p.status.phase === "Failed") return;
    if (!p.spec.nodeName) { var n = schedule(cl, p); if (!n) return; p.spec.nodeName = n; K.event(cl, p, "Normal", "Scheduled", "Successfully assigned " + p.metadata.namespace + "/" + p.metadata.name + " to " + n, "default-scheduler"); setCond(p, "PodScheduled", "True"); r.schedAt = t; return; }
    if (!p.status.podIP) { p.status.podIP = podIp(cl, p.spec.nodeName); p.status.podIPs = [{ ip: p.status.podIP }]; p.status.hostIP = nodeIp(cl, p.spec.nodeName); p.status.hostIPs = [{ ip: p.status.hostIP }]; p.status.startTime = t; setCond(p, "PodReadyToStartContainers", "True"); setCond(p, "Initialized", "True"); setCond(p, "Ready", "False", "ContainersNotReady", "containers with unready status: [" + p.spec.containers.map(function (c) { return c.name; }).join(" ") + "]"); setCond(p, "ContainersReady", "False", "ContainersNotReady", "containers with unready status: [" + p.spec.containers.map(function (c) { return c.name; }).join(" ") + "]"); }
    if ((p.metadata.annotations || {})["sim.kestrel.io/virtual"] === "true") {
      r.virtual = true;
      p.spec.containers.forEach(function (c) { var st = cs(p, c); if (!st.started) { st.state = { running: { startedAt: p.metadata.creationTimestamp + 4 } }; st.started = true; st.ready = true; st.imageID = c.image.replace(/:.*$/, "") + "@sha256:" + K.hex("vimg" + c.image, 64); st.containerID = "containerd://" + K.hex("vc" + p.metadata.uid, 64); } });
      p.status.phase = "Running"; setCond(p, "Ready", "True"); setCond(p, "ContainersReady", "True"); r.readySince = r.readySince || t;
      return;
    }
    // volumes need bound claims
    var pending = (p.spec.volumes || []).filter(function (v) { if (!v.persistentVolumeClaim) return false; var c = K.get(cl, "PersistentVolumeClaim", p.metadata.namespace, v.persistentVolumeClaim.claimName); return !c || c.status.phase !== "Bound"; });
    if (pending.length) { p.status.phase = "Pending"; p.spec.containers.forEach(function (c) { var st = cs(p, c); st.state = { waiting: { reason: "ContainerCreating" } }; }); return; }
    if (r.schedAt != null && t - r.schedAt < 1) { p.status.phase = "Pending"; p.spec.containers.forEach(function (c) { cs(p, c); }); return; }
    r.ctrs = r.ctrs || {};
    var policy = p.spec.restartPolicy;
    // init containers run one after another
    var inits = p.spec.initContainers || [];
    for (var ii = 0; ii < inits.length; ii++) {
      var ic = inits[ii], ix = r.ctrs[ic.name] = r.ctrs[ic.name] || {}, ist = (p.status.initContainerStatuses = p.status.initContainerStatuses || []).filter(function (s) { return s.name === ic.name; })[0];
      if (!ist) { ist = { name: ic.name, image: ic.image, ready: false, restartCount: 0, started: false, state: { waiting: { reason: "PodInitializing" } }, lastState: {} }; p.status.initContainerStatuses.push(ist); }
      if (ist.state.terminated && ist.state.terminated.exitCode === 0) continue;
      p.status.phase = "Pending";
      setCond(p, "Initialized", "False", "ContainersNotInitialized", "containers with incomplete status: [" + inits.slice(ii).map(function (c) { return c.name; }).join(" ") + "]");
      p.spec.containers.forEach(function (c) { var st = cs(p, c); st.state = { waiting: { reason: "PodInitializing" } }; });
      if (ix.c && ix.c.state === "running") return;
      if (ix.c && ix.c.state !== "running" && !ix.handled) { ix.handled = true; var code0 = ix.c.exitCode; ist.state = { terminated: { exitCode: code0, reason: code0 ? "Error" : "Completed", startedAt: ix.startedAt, finishedAt: t } }; if (code0) { ist.restartCount++; ix.retryAt = t + backoff(ist.restartCount); ist.lastState = ist.state; ist.state = { waiting: { reason: "CrashLoopBackOff", message: "back-off " + backoff(ist.restartCount) + "s restarting failed container=" + ic.name + " pod=" + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")" } }; } else ist.ready = false; return; }
      if (ix.retryAt && t < ix.retryAt) return;
      var save = p.status.containerStatuses; p.status.containerStatuses = []; ix.handled = false;
      startContainer(cl, p, ic, r, true);
      var tmp = p.status.containerStatuses[0]; p.status.containerStatuses = save;
      if (tmp) { ist.state = tmp.state; ist.imageID = tmp.imageID; ist.containerID = tmp.containerID; }
      return;
    }
    if (inits.length) setCond(p, "Initialized", "True");
    var allReady = true, anyRunning = false, allDone = true, anyFailed = false;
    p.spec.containers.forEach(function (c) {
      var x = r.ctrs[c.name] = r.ctrs[c.name] || {}, st = cs(p, c), dc = x.c;
      if (!st.started && !dc) {
        if (x.pullRetry && t < x.pullRetry) { st.state = { waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image \"" + c.image + "\": ErrImagePull: " + x.pullErr } }; if (!x.boEv || t - x.boEv > 10) { x.boEv = t; K.event(cl, p, "Normal", "BackOff", "Back-off pulling image \"" + c.image + "\"", "kubelet"); K.event(cl, p, "Warning", "Failed", "Error: ImagePullBackOff", "kubelet"); } allReady = false; allDone = false; return; }
        startContainer(cl, p, c, r);
        dc = x.c;
        if (!dc) { allReady = false; allDone = false; return; }
      }
      if (dc && dc.state === "running") {
        // memory limit
        if (dc.k8sOomAt != null && t >= dc.k8sOomAt) { dc.k8sOomAt = null; Dk.exitCtr(cl.rt, dc, 137, true); dc.oom = true; }
      }
      if (dc && dc.state !== "running" && !x.term) {
        var code = dc.exitCode, reason = dc.oom ? "OOMKilled" : code === 0 ? "Completed" : "Error";
        stopped(cl, p, c, x, code, reason);
      }
      if (x.term) {
        var restart = policy === "Always" || (policy === "OnFailure" && st.state.terminated && st.state.terminated.exitCode !== 0);
        if (!restart) { if (st.state.terminated && st.state.terminated.exitCode !== 0) anyFailed = true; allReady = false; return; }
        allDone = false; allReady = false;
        if (x.restartAt == null) { x.restartAt = t + (st.restartCount === 0 ? 0 : backoff(st.restartCount)); }
        if (t < x.restartAt) {
          var lt = st.state.terminated || (st.lastState || {}).terminated;
          if (lt) st.lastState = { terminated: lt };
          st.state = { waiting: { reason: "CrashLoopBackOff", message: "back-off " + backoff(st.restartCount) + "s restarting failed container=" + c.name + " pod=" + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")" } };
          if (!x.boEv || t - x.boEv > 10) { x.boEv = t; K.event(cl, p, "Warning", "BackOff", "Back-off restarting failed container " + c.name + " in pod " + p.metadata.name + "_" + p.metadata.namespace + "(" + p.metadata.uid + ")", "kubelet"); }
          return;
        }
        var last = st.state.terminated || (st.lastState || {}).terminated;
        st.restartCount++; x.restartAt = null; x.restarting = true;
        if (last) st.lastState = { terminated: last };
        startContainer(cl, p, c, r);
        dc = x.c;
        if (!dc || dc.state !== "running") return;
      }
      if (!dc || dc.state !== "running") { allReady = false; if (!(dc && dc.state === "exited")) allDone = false; return; }
      anyRunning = true; allDone = false;
      // probes
      var pr = x.probes;
      if (c.startupProbe && !pr.startupOk) {
        var sp0 = c.startupProbe;
        if (t - x.startedAt >= (sp0.initialDelaySeconds || 0) && t - pr.lastS >= sp0.periodSeconds) {
          pr.lastS = t; var rs0 = probe(cl, p, c, sp0, dc);
          if (rs0.ok) pr.startupOk = true;
          else { pr.sFail = (pr.sFail || 0) + 1; K.event(cl, p, "Warning", "Unhealthy", "Startup probe failed: " + rs0.fail, "kubelet"); if (pr.sFail >= sp0.failureThreshold) { K.event(cl, p, "Normal", "Killing", "Container " + c.name + " failed startup probe, will be restarted", "kubelet"); Dk.stopCtr(cl.rt, dc, "KILL"); dc.stoppedByUser = false; stopped(cl, p, c, x, 137, "Error"); } }
        }
        st.started = pr.startupOk; st.ready = false; allReady = false;
        return;
      }
      st.started = true;
      if (c.livenessProbe) {
        var lp = c.livenessProbe;
        if (t - x.startedAt >= (lp.initialDelaySeconds || 0) && t - pr.lastL >= lp.periodSeconds) {
          pr.lastL = t; var rl = probe(cl, p, c, lp, dc);
          if (rl.ok) pr.live = 0;
          else { pr.live++; K.event(cl, p, "Warning", "Unhealthy", "Liveness probe failed: " + rl.fail, "kubelet"); if (pr.live >= lp.failureThreshold) { K.event(cl, p, "Normal", "Killing", "Container " + c.name + " failed liveness probe, will be restarted", "kubelet"); Dk.stopCtr(cl.rt, dc, "TERM"); dc.stoppedByUser = false; stopped(cl, p, c, x, 137, "Error"); x.restartAt = t + 1; allReady = false; return; } }
        }
      }
      if (c.readinessProbe) {
        var rp = c.readinessProbe;
        if (t - x.startedAt >= (rp.initialDelaySeconds || 0) && t - pr.lastR >= rp.periodSeconds || pr.lastR === x.startedAt && t - x.startedAt >= (rp.initialDelaySeconds || 0)) {
          pr.lastR = t + 0.001; var rr = probe(cl, p, c, rp, dc);
          if (rr.ok) { pr.ready = 0; pr.readyOk = true; }
          else { pr.ready++; if (pr.ready >= (pr.readyOk ? rp.failureThreshold : 1)) { if (pr.readyOk || !pr.rEv || t - pr.rEv > 9) { pr.rEv = t; K.event(cl, p, "Warning", "Unhealthy", "Readiness probe failed: " + rr.fail, "kubelet"); } pr.readyOk = false; } }
        }
      } else if (dc.app && dc.app.readyAt != null && Dk.clock(cl.rt) < dc.app.readyAt) pr.readyOk = true;
      st.ready = !!pr.readyOk;
      if (!st.ready) allReady = false;
    });
    var cstat = p.status.containerStatuses || [];
    if (policy !== "Always" && cstat.length === p.spec.containers.length && cstat.every(function (s) { return s.state.terminated; }) && (policy === "Never" || cstat.every(function (s) { return s.state.terminated.exitCode === 0; }))) {
      var ok = cstat.every(function (s) { return s.state.terminated.exitCode === 0; });
      p.status.phase = ok ? "Succeeded" : "Failed";
      setCond(p, "Ready", "False", "PodCompleted"); setCond(p, "ContainersReady", "False", "PodCompleted");
      if (!ok && (p.metadata.ownerReferences || [])[0] && p.metadata.ownerReferences[0].kind === "Job") { var job = K.ownerOf(cl, p); if (job) (job._rt = job._rt || {}).lastFail = t; }
      return;
    }
    void allDone; void anyFailed;
    p.status.phase = anyRunning || cstat.some(function (s) { return s.restartCount > 0 || s.state.terminated; }) ? "Running" : "Pending";
    var wasReady = (p.status.conditions || []).some(function (c) { return c.type === "Ready" && c.status === "True"; });
    var unready = cstat.filter(function (s) { return !s.ready; }).map(function (s) { return s.name; });
    if (allReady && cstat.length === p.spec.containers.length) { setCond(p, "Ready", "True"); setCond(p, "ContainersReady", "True"); if (!wasReady) r.readySince = t; }
    else { setCond(p, "Ready", "False", "ContainersNotReady", "containers with unready status: [" + unready.join(" ") + "]"); setCond(p, "ContainersReady", "False", "ContainersNotReady", "containers with unready status: [" + unready.join(" ") + "]"); r.readySince = null; }
  }

  /* ================================================================== Services: endpoints, DNS, connections */
  function targetPort(svcPort, pod) {
    var tp = svcPort.targetPort;
    if (typeof tp === "number") return tp;
    var hit = null; pod.spec.containers.forEach(function (c) { (c.ports || []).forEach(function (p) { if (p.name === tp) hit = p.containerPort; }); });
    return hit;
  }
  K.targetPort = targetPort;
  K.endpointsOf = function (cl, svc, all) {
    if (!svc.spec.selector) return [];
    return K.list(cl, "Pod", svc.metadata.namespace).filter(function (p) { return K.matches(svc.spec.selector, p.metadata.labels) && p.status.podIP && !K.terminating(p) && p.status.phase === "Running" && (all || svc.spec.publishNotReadyAddresses || K.podReady(p)); });
  };
  function epCtl(cl, svc) {
    if (!svc.spec.selector) return;
    var ready = K.endpointsOf(cl, svc), notReady = K.endpointsOf(cl, svc, true).filter(function (p) { return ready.indexOf(p) < 0; });
    var ep = { apiVersion: "v1", kind: "Endpoints", metadata: { name: svc.metadata.name, namespace: svc.metadata.namespace, labels: clone(svc.metadata.labels) }, subsets: [] };
    if (ready.length || notReady.length) ep.subsets.push({ addresses: ready.length ? ready.map(function (p) { return { ip: p.status.podIP, nodeName: p.spec.nodeName, targetRef: { kind: "Pod", name: p.metadata.name, namespace: p.metadata.namespace, uid: p.metadata.uid } }; }) : undefined, notReadyAddresses: notReady.length ? notReady.map(function (p) { return { ip: p.status.podIP, nodeName: p.spec.nodeName, targetRef: { kind: "Pod", name: p.metadata.name, namespace: p.metadata.namespace } }; }) : undefined, ports: (svc.spec.ports || []).map(function (sp) { var pod = ready[0] || notReady[0]; return { name: sp.name, port: targetPort(sp, pod) || sp.targetPort, protocol: sp.protocol }; }) });
    var old = K.get(cl, "Endpoints", svc.metadata.namespace, svc.metadata.name);
    if (!old || JSON.stringify(old.subsets) !== JSON.stringify(ep.subsets)) { ep.metadata.creationTimestamp = old ? old.metadata.creationTimestamp : svc.metadata.creationTimestamp; K.store(cl, ep, { quiet: true }); }
  }
  K.podByIp = function (cl, ip) { return K.all(cl, "Pod").filter(function (p) { return p.status.podIP === ip && !K.terminating(p); })[0] || null; };
  K.podOfCtr = function (cl, c) { if (!c || !c.k8s) return null; var p = K.get(cl, "Pod", c.k8s.ns, c.k8s.pod); return p && p.metadata.uid === c.k8s.uid ? p : null; };
  // DNS from a pod: -> {svc} | {pod} | {ip} | null
  K.resolve = function (cl, fromNs, host) {
    host = String(host).replace(/\.$/, "");
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      var s = K.all(cl, "Service").filter(function (x) { return x.spec.clusterIP === host; })[0]; if (s) return { svc: s };
      var p = K.podByIp(cl, host); if (p) return { pod: p };
      return { ip: host };
    }
    var parts = host.split(".");
    var m = /^(.+?)(?:\.svc)?(?:\.cluster\.local)?$/.exec(host), n = m[1].split(".");
    // pod-0.svc.ns (statefulset pods via a headless service)
    var tries = [];
    if (n.length === 1) tries.push({ svc: n[0], ns: fromNs });
    if (n.length === 2) { tries.push({ svc: n[0], ns: n[1] }); tries.push({ pod: n[0], svc: n[1], ns: fromNs }); }
    if (n.length === 3) tries.push({ pod: n[0], svc: n[1], ns: n[2] });
    for (var i = 0; i < tries.length; i++) {
      var tr = tries[i], svc = K.get(cl, "Service", tr.ns, tr.svc);
      if (!svc) continue;
      if (!tr.pod) return { svc: svc };
      var pod = K.get(cl, "Pod", tr.ns, tr.pod); if (pod && pod.spec.subdomain === svc.metadata.name && pod.status.podIP) return { pod: pod };
    }
    void parts;
    return null;
  };
  // NetworkPolicy: may traffic go from pod a (or an outside ip) to pod b on port?
  function peerMatch(cl, peers, other, otherIp, policyNs) {
    if (!peers) return true;
    return peers.some(function (pe) {
      if (pe.ipBlock) { var cidr = pe.ipBlock.cidr; if (!otherIp) return false; return K.inCidr(otherIp, cidr) && !(pe.ipBlock.except || []).some(function (e) { return K.inCidr(otherIp, e); }); }
      if (!other) return false;
      var nsOk = pe.namespaceSelector ? K.matches(pe.namespaceSelector, (K.get(cl, "Namespace", null, other.metadata.namespace) || { metadata: {} }).metadata.labels || {}) || K.emptySel(pe.namespaceSelector) : other.metadata.namespace === policyNs;
      if (!nsOk) return false;
      return !pe.podSelector || K.emptySel(pe.podSelector) || K.matches(pe.podSelector, other.metadata.labels);
    });
  }
  function portMatch(ports, port, proto, pod) { if (!ports || !ports.length) return true; return ports.some(function (p) { var pp = typeof p.port === "string" ? targetPort({ targetPort: p.port }, pod) : p.port; return (p.protocol || "TCP") === (proto || "TCP") && (p.port == null || pp === port || (p.endPort && port >= pp && port <= p.endPort)); }); }
  K.policyAllows = function (cl, src, srcIp, dst, dstIp, port, proto) {
    // egress from src
    if (src) {
      var eg = K.list(cl, "NetworkPolicy", src.metadata.namespace).filter(function (np) { return (np.spec.policyTypes || []).indexOf("Egress") >= 0 && (K.emptySel(np.spec.podSelector) || K.matches(np.spec.podSelector, src.metadata.labels)); });
      if (eg.length && !eg.some(function (np) { return (np.spec.egress || []).some(function (r) { return peerMatch(cl, r.to, dst, dstIp, np.metadata.namespace) && portMatch(r.ports, port, proto, dst); }); })) return { denied: "egress", policies: eg };
    }
    if (dst) {
      var ig = K.list(cl, "NetworkPolicy", dst.metadata.namespace).filter(function (np) { return (np.spec.policyTypes || []).indexOf("Ingress") >= 0 && (K.emptySel(np.spec.podSelector) || K.matches(np.spec.podSelector, dst.metadata.labels)); });
      if (ig.length && !ig.some(function (np) { return (np.spec.ingress || []).some(function (r) { return peerMatch(cl, r.from, src, srcIp, np.metadata.namespace) && portMatch(r.ports, port, proto, dst); }); })) return { denied: "ingress", policies: ig };
    }
    return { ok: true };
  };
  function dnsOk(cl, src) {
    if (!src) return true;
    var dns = K.list(cl, "Pod", "kube-system").filter(function (p) { return (p.metadata.labels || {})["k8s-app"] === "kube-dns"; })[0];
    return K.policyAllows(cl, src, null, dns, dns && dns.status.podIP, 53, "UDP").ok;
  }
  K.dnsOk = dnsOk;
  // pick a ready endpoint of svc for svcPort -> {pod, port} or null
  K.pickEndpoint = function (cl, svc, svcPortNum, salt) {
    var sp = (svc.spec.ports || []).filter(function (p) { return p.port === svcPortNum; })[0];
    if (!sp) return { noPort: true };
    var eps = K.endpointsOf(cl, svc);
    if (!eps.length) return { none: true };
    cl.rr = (cl.rr || 0) + 1;
    var pod = eps[(cl.rr + (salt || 0)) % eps.length];
    return { pod: pod, port: targetPort(sp, pod) };
  };
  // a container of pod listening on port -> Docker container
  function listener(cl, pod, port) {
    var r = pod._rt; if (!r || !r.ctrs) return null;
    var hit = null;
    keys(r.ctrs).forEach(function (n) { var c = r.ctrs[n].c; if (!hit && c && c.state === "running" && c.app && (c.app.listen || []).some(function (l) { return l.port === port; })) hit = c; });
    return hit;
  }
  K.listener = listener;
  // Connect from container c (in a pod) to host:port -> Dk.connect result shape
  K.connect = function (cl, c, host, port, o) {
    o = o || {};
    var src = c ? K.podOfCtr(cl, c) : null, fromNs = src ? src.metadata.namespace : "default";
    if (src && (host === "localhost" || /^127\./.test(host))) { var self = listener(cl, src, port); return self ? { ok: true, ctr: self, app: self.app } : { why: "refused" }; }
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && src && !dnsOk(cl, src)) return { why: "dns", dnsBlocked: true };
    var r = K.resolve(cl, fromNs, host);
    if (!r) {
      if (src && /\./.test(host) && !/\.(local|internal)$/.test(host)) { var eg = K.policyAllows(cl, src, src.status.podIP, null, "93.184.215.14", port, "TCP"); if (!eg.ok) return { why: "timeout", policy: eg }; }
      return { why: "dns" };
    }
    var pod = r.pod, tport = port, ip = host;
    if (r.svc) {
      if (r.svc.spec.clusterIP === "None") { var eps0 = K.endpointsOf(cl, r.svc); pod = eps0[0]; if (!pod) return { why: "dns" }; }
      else {
        var pe = K.pickEndpoint(cl, r.svc, port, o.salt);
        if (pe.noPort) return { why: "timeout" };
        if (pe.none) return { why: "refused" };
        pod = pe.pod; tport = pe.port;
      }
    }
    if (r.ip) return { why: "timeout" };
    ip = pod.status.podIP;
    var pol = K.policyAllows(cl, src, src ? src.status.podIP : o.fromIp, pod, ip, tport, "TCP");
    if (!pol.ok) return { why: "timeout", policy: pol };
    var t = listener(cl, pod, tport);
    if (!t) return { why: "refused", ctr: K.ctrOf(cl, pod) };
    if (t.k8sHangAt != null && K.t(cl) >= t.k8sHangAt) return { why: "timeout" };
    if (t.app.readyAt != null && Dk.clock(cl.rt) < t.app.readyAt) return { why: "refused", ctr: t, starting: true };
    var lst = (t.app.listen || []).filter(function (l) { return l.port === tport; })[0];
    if (lst && /^127\./.test(lst.addr)) return { why: "refused", ctr: t };
    return { ok: true, ctr: t, app: t.app, pod: pod, port: tport };
  };
  // pods' own connections go through the cluster
  var origConnect = Dk.connect, origResolve = Dk.resolveFrom;
  Dk.connect = function (sys, c, host, port) { if (sys && sys.k8sRt && sys.k8sCl) return K.connect(sys.k8sCl, c, host, port); return origConnect(sys, c, host, port); };
  Dk.resolveFrom = function (sys, c, host) {
    if (sys && sys.k8sRt && sys.k8sCl) { var cl = sys.k8sCl, src = K.podOfCtr(cl, c); if (host === "localhost" || /^127\./.test(host)) return { ctr: c, self: true }; if (src && !/^\d/.test(host) && !dnsOk(cl, src)) return null; var r = K.resolve(cl, src ? src.metadata.namespace : "default", host); if (!r) return null; var pod = r.pod || (r.svc ? K.endpointsOf(cl, r.svc)[0] : null); return { ctr: (pod && K.ctrOf(cl, pod)) || c, svc: r.svc }; }
    return origResolve(sys, c, host);
  };

  /* ---------------- HPA and metrics */
  // cpu used by a pod's containers in millicores
  K.podCpu = function (cl, p) {
    if ((p._rt || {}).virtual) return 3 + parseInt(K.hex("cpu" + p.metadata.name, 2), 16) % 6;
    var base = 0; keys((p._rt || {}).ctrs || {}).forEach(function (n) { var c = p._rt.ctrs[n].c; if (c && c.state === "running") base += Math.round(((c.app && c.app.cpu) || 0.002) * 1000 / 4) + 1; });
    // load generators aimed at services this pod serves
    keys(cl.load).forEach(function (k) { var L = cl.load[k]; if (!L.active) return; var svc = K.get(cl, "Service", L.ns, L.svc); if (!svc || !K.matches(svc.spec.selector, p.metadata.labels) || !K.podReady(p)) return; var n = K.endpointsOf(cl, svc).length || 1; base += Math.round(L.mcpu / n); });
    return base;
  };
  // a leaking container's memory at time t (k8sLeakPrev: start times of earlier runs, for history before this one)
  function leakMem(cl, c, t) { var st = c.k8sLeakStart; if (t < st && c.k8sLeakPrev) c.k8sLeakPrev.forEach(function (x) { if (x <= t) st = x; }); return Math.min(c.mem || 1e15, c.k8sMemBase + c.k8sLeak * MB * Math.max(0, t - st) / 60); }
  K.leakMem = leakMem;
  K.podMem = function (cl, p, at) {
    if ((p._rt || {}).virtual) return (18 + parseInt(K.hex("mem" + p.metadata.name, 2), 16) % 40) * MB;
    var m = 0; keys((p._rt || {}).ctrs || {}).forEach(function (n) { var c = p._rt.ctrs[n].c; if (c && c.state === "running") m += c.k8sLeak ? leakMem(cl, c, at == null ? K.t(cl) : at) : c.k8sMem || (c.app && c.app.mem) || 4 * MB; });
    return m;
  };
  function hpaCtl(cl, h) {
    var r = h._rt = h._rt || {}, t = K.t(cl);
    var ref = h.spec.scaleTargetRef, tgt = K.get(cl, ref.kind, h.metadata.namespace, ref.name);
    var st = h.status = h.status || { currentReplicas: 0, desiredReplicas: 0 };
    if (!tgt) { st.conditions = [{ type: "AbleToScale", status: "False", reason: "FailedGetScale", message: "the HPA controller was unable to get the target's current scale: " + ref.kind.toLowerCase() + "s.apps \"" + ref.name + "\" not found" }]; return; }
    if (r.last != null && t - r.last < 15) return;
    r.last = t;
    var m = (h.spec.metrics || []).filter(function (x) { return x.type === "Resource" && x.resource.name === "cpu"; })[0];
    var pods = K.list(cl, "Pod", h.metadata.namespace).filter(function (p) { return K.matches(tgt.spec.selector, p.metadata.labels) && !K.terminating(p) && p.status.phase === "Running"; });
    var cur = tgt.spec.replicas;
    st.currentReplicas = cur;
    if (!m) { st.desiredReplicas = cur; return; }
    var missing = pods.some(function (p) { return p.spec.containers.some(function (c) { return !((c.resources || {}).requests || {}).cpu; }); });
    if (missing || !pods.length) {
      st.conditions = [{ type: "AbleToScale", status: "True", reason: "SucceededGetScale", message: "the HPA controller was able to get the target's current scale" }, { type: "ScalingActive", status: "False", reason: "FailedGetResourceMetric", message: "the HPA was unable to compute the replica count: failed to get cpu utilization: missing request for cpu in container " + (pods[0] ? pods[0].spec.containers[0].name : "") + " of Pod " + (pods[0] ? pods[0].metadata.name : "") }];
      st.currentMetrics = [{ type: "Resource", resource: { name: "cpu", current: {} } }];
      if (!r.warned || t - r.warned > 60) { r.warned = t; K.event(cl, h, "Warning", "FailedGetResourceMetric", "failed to get cpu utilization: missing request for cpu in container " + (pods[0] ? pods[0].spec.containers[0].name : "") + " of Pod " + (pods[0] ? pods[0].metadata.name : ""), "horizontal-pod-autoscaler"); }
      return;
    }
    var used = 0, req = 0; pods.forEach(function (p) { used += K.podCpu(cl, p); req += K.podRequests(p).cpu; });
    var util = Math.round(used / req * 100), target = m.resource.target.averageUtilization || 80;
    var desired = Math.ceil(cur * util / target);
    if (Math.abs(util / target - 1) <= 0.1) desired = cur;
    desired = Math.max(h.spec.minReplicas, Math.min(h.spec.maxReplicas, desired));
    // scale down only after the stabilisation window (300s)
    if (desired < cur) { r.downSince = r.downSince || t; if (t - r.downSince < 300) desired = cur; } else r.downSince = null;
    st.currentMetrics = [{ type: "Resource", resource: { name: "cpu", current: { averageUtilization: util, averageValue: Math.round(used / pods.length) + "m" } } }];
    st.desiredReplicas = desired;
    st.conditions = [{ type: "AbleToScale", status: "True", reason: desired !== cur ? "SucceededRescale" : "ReadyForNewScale", message: desired !== cur ? "the HPA controller was able to update the target scale to " + desired : "recommended size matches current size" }, { type: "ScalingActive", status: "True", reason: "ValidMetricFound", message: "the HPA was able to successfully calculate a replica count from cpu resource utilization (percentage of request)" }, { type: "ScalingLimited", status: desired === h.spec.maxReplicas && Math.ceil(cur * util / target) > desired ? "True" : "False", reason: desired === h.spec.maxReplicas && Math.ceil(cur * util / target) > desired ? "TooManyReplicas" : "DesiredWithinRange", message: desired === h.spec.maxReplicas && Math.ceil(cur * util / target) > desired ? "the desired replica count is more than the maximum replica count" : "the desired count is within the acceptable range" }];
    if (desired !== cur) {
      tgt.spec.replicas = desired; K.store(cl, tgt);
      st.lastScaleTime = t;
      K.event(cl, h, "Normal", "SuccessfulRescale", "New size: " + desired + "; reason: " + (desired > cur ? "cpu resource utilization (percentage of request) above target" : "All metrics below target"), "horizontal-pod-autoscaler");
    }
  }

  K.ctlHooks = K.ctlHooks || [];
  K.ctlHooks.push(function (cl) {
    var seen = {};
    K.all(cl, "Pod").forEach(function (p) {
      if (p.status.phase !== "Running" || K.terminating(p)) return;
      (p.spec.containers || []).forEach(function (c) {
        var txt = (c.command || []).concat(c.args || []).join(" ");
        var m = /while\s+(true|:)[\s\S]*?\b(wget|curl)\b[^;]*?https?:\/\/([\w.-]+)/.exec(txt);
        if (!m) return;
        var r = K.resolve(cl, p.metadata.namespace, m[3]);
        if (!r || !r.svc) return;
        if (!K.policyAllows(cl, p, p.status.podIP, K.endpointsOf(cl, r.svc)[0] || null, null, (r.svc.spec.ports[0] || {}).port, "TCP").ok) return;
        seen[p.metadata.uid] = 1;
        cl.load[p.metadata.uid] = { ns: r.svc.metadata.namespace, svc: r.svc.metadata.name, mcpu: 450, active: true };
      });
    });
    keys(cl.load).forEach(function (k) { if (!seen[k]) delete cl.load[k]; });
  });

  /* ---------------- certificates (cert-manager) and Ingress status */
  function certCtl(cl, c) {
    var r = c._rt = c._rt || {}, st = c.status = c.status || {};
    var iss = c.spec.issuerRef || {}, issuer = iss.kind === "Issuer" ? null : K.get(cl, "ClusterIssuer", null, iss.name);
    if (!issuer) { st.conditions = [{ type: "Ready", status: "False", reason: "Pending", message: "Issuing certificate as Secret does not exist" }, { type: "Issuing", status: "True", reason: "DoesNotExist", message: "Issuing certificate as Secret does not exist" }]; if (!r.warned) { r.warned = true; K.event(cl, c, "Warning", "IssuerNotFound", "Referenced \"ClusterIssuer\" not found: clusterissuer.cert-manager.io \"" + iss.name + "\" not found", "cert-manager-certificates-trigger"); } return; }
    var sec = K.get(cl, "Secret", c.metadata.namespace, c.spec.secretName);
    if (sec && (sec.metadata.annotations || {})["cert-manager.io/certificate-name"] === c.metadata.name && JSON.stringify((sec._cert || {}).dns) === JSON.stringify(c.spec.dnsNames)) { st.conditions = [{ type: "Ready", status: "True", reason: "Ready", message: "Certificate is up to date and has not expired" }]; return; }
    if (r.at == null) { r.at = K.t(cl) + 6; K.event(cl, c, "Normal", "Issuing", "Issuing certificate as Secret does not exist", "cert-manager-certificates-trigger"); K.event(cl, c, "Normal", "Generated", "Stored new private key in temporary Secret resource \"" + c.metadata.name + "-" + K.rand("tmp" + c.metadata.name, 5) + "\"", "cert-manager-certificates-key-manager"); K.event(cl, c, "Normal", "Requested", "Created new CertificateRequest resource \"" + c.metadata.name + "-1\"", "cert-manager-certificates-request-manager"); st.conditions = [{ type: "Ready", status: "False", reason: "DoesNotExist", message: "Issuing certificate as Secret does not exist" }]; return; }
    if (K.t(cl) < r.at) return;
    var s = { apiVersion: "v1", kind: "Secret", type: "kubernetes.io/tls", metadata: { name: c.spec.secretName, namespace: c.metadata.namespace, annotations: { "cert-manager.io/alt-names": (c.spec.dnsNames || []).join(","), "cert-manager.io/certificate-name": c.metadata.name, "cert-manager.io/common-name": (c.spec.dnsNames || [])[0], "cert-manager.io/issuer-kind": "ClusterIssuer", "cert-manager.io/issuer-name": iss.name } }, data: { "tls.crt": K.b64("-----BEGIN CERTIFICATE-----\nKESTREL-SIM issuer=" + iss.name + " dns=" + (c.spec.dnsNames || []).join(",") + "\n-----END CERTIFICATE-----\n"), "tls.key": K.b64("-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg" + K.rand("k" + c.metadata.uid, 40) + "\n-----END PRIVATE KEY-----\n") } };
    K.store(cl, s); K.get(cl, "Secret", s.metadata.namespace, s.metadata.name)._cert = { issuer: iss.name, dns: clone(c.spec.dnsNames), trusted: !!(issuer.spec && issuer.spec.acme && !/staging/.test(issuer.spec.acme.server || "")) || !!(issuer.spec && issuer.spec.ca) };
    st.conditions = [{ type: "Ready", status: "True", reason: "Ready", message: "Certificate is up to date and has not expired" }];
    st.notBefore = K.t(cl); st.notAfter = K.t(cl) + 90 * 86400; st.renewalTime = K.t(cl) + 60 * 86400; st.revision = 1;
    K.event(cl, c, "Normal", "Issuing", "The certificate has been successfully issued", "cert-manager-certificates-issuing");
  }
  function ingressCtl(cl, ing) {
    // ingress-shim: cert-manager.io/cluster-issuer annotation -> Certificate per tls entry
    var ann = (ing.metadata.annotations || {})["cert-manager.io/cluster-issuer"];
    if (ann && cl.comps.certManager) (ing.spec.tls || []).forEach(function (t) {
      if (!t.secretName) return;
      var c = K.get(cl, "Certificate", ing.metadata.namespace, t.secretName);
      var want = { apiVersion: "cert-manager.io/v1", kind: "Certificate", metadata: { name: t.secretName, namespace: ing.metadata.namespace, labels: clone(ing.metadata.labels), ownerReferences: [K.ownerRef(ing)] }, spec: { dnsNames: clone(t.hosts || []), issuerRef: { group: "cert-manager.io", kind: "ClusterIssuer", name: ann }, secretName: t.secretName, usages: ["digital signature", "key encipherment"] } };
      if (!c) { K.store(cl, want); K.event(cl, ing, "Normal", "CreateCertificate", "Successfully created Certificate \"" + t.secretName + "\"", "cert-manager-ingress-shim"); }
      else if (JSON.stringify(c.spec.dnsNames) !== JSON.stringify(want.spec.dnsNames) || c.spec.issuerRef.name !== ann) { c.spec = want.spec; c._rt = {}; K.store(cl, c); }
    });
    var cls = ing.spec.ingressClassName || ((ing.metadata.annotations || {})["kubernetes.io/ingress.class"]) || (K.all(cl, "IngressClass").filter(function (x) { return (x.metadata.annotations || {})["ingressclass.kubernetes.io/is-default-class"] === "true"; })[0] || { metadata: {} }).metadata.name;
    if (cl.comps.ingress && cls === "nginx") {
      if (!(ing.status && ing.status.loadBalancer && ing.status.loadBalancer.ingress)) { ing.status = { loadBalancer: { ingress: [{ ip: K.INGRESS_IP }] } }; K.event(cl, ing, "Normal", "Sync", "Scheduled for sync", "nginx-ingress-controller"); }
    }
  }
  function lbCtl(cl, svc) {
    if (svc.spec.type !== "LoadBalancer" || (svc.status && svc.status.loadBalancer && svc.status.loadBalancer.ingress)) return;
    var r = svc._rt = svc._rt || {};
    if (r.lbAt == null) { r.lbAt = K.t(cl) + 4; K.event(cl, svc, "Normal", "EnsuringLoadBalancer", "Ensuring load balancer", "service-controller"); return; }
    if (K.t(cl) < r.lbAt) return;
    cl.ipSeq.lb++;
    svc.status = { loadBalancer: { ingress: [{ ip: "198.51.100." + cl.ipSeq.lb, ipMode: "VIP" }] } };
    K.event(cl, svc, "Normal", "EnsuredLoadBalancer", "Ensured load balancer", "service-controller");
  }

  /* ================================================================== reconcile and time */
  K.ctlHooks = K.ctlHooks || [];
  var reconciling = false;
  K.reconcile = function (cl, o) {
    if (reconciling) return;
    reconciling = true;
    cl.rt.k8sCl = cl;
    try {
      for (var pass = 0; pass < 4; pass++) {
        cl.dirty = false;
        K.all(cl, "Namespace").forEach(function (n) { nsCtl(cl, n); });
        K.all(cl, "CronJob").forEach(function (x) { cronCtl(cl, x); });
        K.all(cl, "Deployment").forEach(function (x) { deployCtl(cl, x); });
        K.all(cl, "ReplicaSet").forEach(function (x) { rsCtl(cl, x); });
        K.all(cl, "StatefulSet").forEach(function (x) { stsCtl(cl, x); });
        K.all(cl, "DaemonSet").forEach(function (x) { dsCtl(cl, x); });
        K.all(cl, "Job").forEach(function (x) { jobCtl(cl, x); });
        K.all(cl, "Pod").forEach(function (x) { kubelet(cl, x); });
        K.all(cl, "PersistentVolumeClaim").forEach(function (x) { pvcCtl(cl, x); });
        K.all(cl, "Service").forEach(function (x) { epCtl(cl, x); lbCtl(cl, x); });
        if (cl.comps.certManager) K.all(cl, "Certificate").forEach(function (x) { certCtl(cl, x); });
        K.all(cl, "Ingress").forEach(function (x) { ingressCtl(cl, x); });
        if (cl.comps.metrics) K.all(cl, "HorizontalPodAutoscaler").forEach(function (x) { hpaCtl(cl, x); });
        K.ctlHooks.forEach(function (fn) { fn(cl, o || {}); });
        K.all(cl, "Deployment").forEach(function (x) { deployCtl(cl, x); });
        if (!cl.dirty) break;
      }
    } finally { reconciling = false; }
  };
  // let the cluster's clock run (each kubectl command takes a moment; sleep and rollout status wait longer)
  K.advance = function (cl, secs, until) {
    var rt = cl.rt, d = Dk.state(rt), end = d.t + secs;
    while (d.t < end) {
      var step = d.t - (cl.lastActive || 0) > 120 ? Math.min(5, end - d.t) : Math.min(1, end - d.t);
      d.t += step;
      Dk.settle(rt);
      K.reconcile(cl);
      if (until && until()) return true;
    }
    return until ? !!until() : true;
  };
  K.touch = function (cl, secs) { K.advance(cl, secs == null ? 1 : secs); cl.lastActive = K.t(cl); };
  // laptop sleep moves the cluster too
  var sleepPrev = S.CMDS.sleep;
  S.CMDS.sleep = function (args, io, sess) {
    var r = sleepPrev(args, io, sess);
    var cl = sess.sys.dkCtr ? null : K.of(sess.sys);
    if (cl && !sess.sys.k8sRt) { var secs = args.slice(1).reduce(function (s, x) { var m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(x); return m ? s + +m[1] * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]) : s; }, 0); K.advance(cl, Math.min(secs, 900)); cl.lastActive = K.t(cl); }
    return r;
  };
  // inside a pod: keep pod files in sync after each line typed in `kubectl exec -it`
  var afterPrev = S.afterLine;
  S.afterLine = function (sess, io) {
    if (afterPrev) afterPrev(sess, io);
    var cl = K.of(sess.sys); if (!cl) return;
    Dk.state(cl.rt).ctrs.forEach(function (c) { if (c.shellOpen && c.fs) Dk.syncOut(cl.rt, c); });
  };
})(typeof window !== "undefined" ? window : globalThis);
