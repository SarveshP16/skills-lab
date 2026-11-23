/* sudo learn — DevOps Module 4 panel views (used by dk-viz.js): Cluster (nodes and the pods on them, coloured by
   status), Workloads (Deployments/StatefulSets with rollout progress, revisions, HPA, Helm releases, Argo CD apps,
   Jobs) and Traffic (Ingress hosts -> Services -> pods, NetworkPolicies per namespace). */
(function (root) {
  "use strict";
  var K = root.K8s;
  var SYS_NS = /^(kube-system|kube-public|kube-node-lease|ingress-nginx|cert-manager|kyverno|argocd)$/;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function chip(cls, t, title) { return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + t + "</span>"; }
  function cl(sys) { return K && K.of ? K.of(sys) : null; }
  function podState(p) {
    var s = K.kubectl.podStatus(p);
    if (/CrashLoop|Err|Error|OOM|BackOff|Failed|Invalid/.test(s)) return { cls: "bad", s: s };
    if (s === "Completed" || s === "Succeeded") return { cls: "idle", s: s };
    if (s === "Running" && K.podReady(p)) return { cls: "ok", s: s };
    return { cls: "warn", s: s === "Running" ? "Running, not ready" : s };
  }
  function short(name) { return String(name).replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, function (m) { return "-…" + m.slice(-5); }); }
  function bar(n, of) { var pct = of ? Math.round(Math.min(n, of) / of * 100) : 0; return '<span class="k8-bar"><span style="width:' + pct + '%"></span></span>'; }

  /* ---------------- Cluster: nodes and pods */
  function cluster(sys) {
    var c = cl(sys); if (!c) return '<div class="dv-empty">No cluster yet.</div>';
    var pods = K.all(c, "Pod"), h = '<div class="k8-nodes">';
    K.all(c, "Node").forEach(function (n) {
      var name = n.metadata.name, mine = pods.filter(function (p) { return p.spec.nodeName === name; }), app = mine.filter(function (p) { return !SYS_NS.test(p.metadata.namespace); }), sysN = mine.length - app.length;
      var u = K.nodeUsage(c, name), cpuA = K.cpu(n.status.allocatable.cpu), memA = K.mem(n.status.allocatable.memory);
      var cp = !!(n.metadata.labels || {})["node-role.kubernetes.io/control-plane"];
      h += '<div class="k8-node' + (cp ? " cp" : "") + '"><div class="k8-nh"><b>' + esc(name) + "</b>" + (cp ? '<span class="dim"> control plane</span>' : "") + '<span class="dim"> ' + esc((n.metadata.labels || {})["topology.kubernetes.io/zone"] || "") + "</span></div>" +
        '<div class="k8-res"><span>cpu ' + bar(u.cpu, cpuA) + " " + Math.round(u.cpu / cpuA * 100) + "%</span><span>mem " + bar(u.mem, memA) + " " + Math.round(u.mem / memA * 100) + "%</span></div><div class=\"k8-pods\">";
      app.forEach(function (p) { var st = podState(p); var rc = (p.status.containerStatuses || []).reduce(function (s, x) { return s + x.restartCount; }, 0); h += '<div class="k8-pod ' + st.cls + (K.terminating(p) ? " term" : "") + '" title="' + esc(p.metadata.namespace + "/" + p.metadata.name + " · " + st.s + (p.status.podIP ? " · " + p.status.podIP : "")) + '"><span class="st"></span><span class="pn">' + esc(short(p.metadata.name)) + '</span><span class="ps">' + esc(st.s) + (rc ? " ↻" + rc : "") + "</span></div>"; });
      if (sysN) h += '<div class="k8-sys">+ ' + sysN + " system pod" + (sysN > 1 ? "s" : "") + "</div>";
      if (!mine.length) h += '<div class="k8-sys">no pods</div>';
      h += "</div></div>";
    });
    h += "</div>";
    var pend = pods.filter(function (p) { return !p.spec.nodeName && !K.terminating(p); });
    if (pend.length) h += '<div class="k8-pend"><b>Not scheduled:</b> ' + pend.map(function (p) { return chip("sec", esc(p.metadata.name), ((p.status.conditions || [])[0] || {}).message); }).join(" ") + "</div>";
    return h;
  }

  /* ---------------- Workloads */
  function nsList(c) { return K.all(c, "Namespace").map(function (n) { return n.metadata.name; }).filter(function (n) { return !SYS_NS.test(n); }); }
  function workloads(sys) {
    var c = cl(sys); if (!c) return "";
    var h = "", any = false;
    var apps = c.comps.argocd ? K.list(c, "Application", "argocd") : [];
    if (apps.length) { h += '<div class="k8-apps">' + apps.map(function (a) { var s = a.status || {}, sy = (s.sync || {}).status || "Unknown", he = (s.health || {}).status || "Unknown"; return '<div class="k8-app"><b>⟳ ' + esc(a.metadata.name) + '</b> <span class="dim">' + esc(a.spec.source.path) + " → " + esc(a.spec.destination.namespace) + "</span> " + chip(sy === "Synced" ? "ro" : "sec", esc(sy) + ((s.sync || {}).revision ? " " + esc(s.sync.revision.slice(0, 7)) : "")) + chip(he === "Healthy" ? "ro" : he === "Degraded" || he === "Missing" ? "bad" : "sec", esc(he)) + ((a.spec.syncPolicy || {}).automated ? chip("port", "auto" + (a.spec.syncPolicy.automated.selfHeal ? " · self-heal" : "") + (a.spec.syncPolicy.automated.prune ? " · prune" : "")) : chip("tmp", "manual sync")) + "</div>"; }).join("") + "</div>"; any = true; }
    var rels = K.helmReleases ? K.helmReleases(c) : {};
    nsList(c).forEach(function (ns) {
      var deps = K.list(c, "Deployment", ns), sts = K.list(c, "StatefulSet", ns), jobs = K.list(c, "Job", ns), cjs = K.list(c, "CronJob", ns), hpas = K.list(c, "HorizontalPodAutoscaler", ns);
      if (!deps.length && !sts.length && !jobs.length && !cjs.length) return;
      any = true;
      h += '<div class="k8-ns"><div class="k8-nsh">namespace <b>' + esc(ns) + "</b>" + (K.psaLevel(c, ns, "enforce") ? " " + chip("ro", "pod security: " + esc(K.psaLevel(c, ns, "enforce"))) : "") + Object.keys(rels).filter(function (k) { return k.split("/")[0] === ns; }).map(function (k) { var r = rels[k][rels[k].length - 1]; return " " + chip("port", "⎈ " + esc(r.name) + " rev " + r.rev + " · " + esc(r.chart.name + "-" + r.chart.version)); }).join("") + '</div><div class="dv-grid">';
      deps.forEach(function (d) {
        var st = d.status || {}, rss = K.ownedBy(c, d, "ReplicaSet").sort(function (a, b) { return K.rsRevision(b) - K.rsRevision(a); });
        var cur = rss.filter(function (r) { return r.metadata.labels["pod-template-hash"] === K.tplHash(d.spec.template); })[0], olds = rss.filter(function (r) { return r !== cur && r.spec.replicas > 0; });
        var ok = K.deployDone(c, d), failed = K.deployFailed(d), hpa = hpas.filter(function (x) { return x.spec.scaleTargetRef.name === d.metadata.name; })[0];
        var img = (d.spec.template.spec.containers || []).map(function (x) { return x.image.split("/").pop(); }).join(", ");
        h += '<div class="dv-card ' + (failed ? "bad" : ok ? "ok" : "warn") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(d.metadata.name) + '</b><span class="img">deploy</span></div><div class="dv-cs">' + bar(st.availableReplicas || 0, d.spec.replicas) + " " + (st.availableReplicas || 0) + "/" + d.spec.replicas + " available · " + esc(img) + "</div><div class=\"dv-chips\">" +
          (cur ? chip("tmp", "rev " + K.rsRevision(cur)) : "") + (olds.length ? chip("sec", "rolling: " + olds.map(function (r) { return "old " + r.spec.replicas; }).join(", ") + " → new " + (cur ? cur.spec.replicas : 0)) : "") + (failed ? chip("bad", "progress deadline exceeded") : "") +
          (hpa ? chip("port", "HPA " + hpa.spec.minReplicas + "–" + hpa.spec.maxReplicas + (((hpa.status || {}).currentMetrics || [])[0] && hpa.status.currentMetrics[0].resource.current.averageUtilization != null ? " · cpu " + hpa.status.currentMetrics[0].resource.current.averageUtilization + "%" : "")) : "") + "</div></div>";
      });
      sts.forEach(function (s) { var r = (s.status || {}).readyReplicas || 0; h += '<div class="dv-card ' + (r >= s.spec.replicas ? "ok" : "warn") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(s.metadata.name) + '</b><span class="img">statefulset</span></div><div class="dv-cs">' + bar(r, s.spec.replicas) + " " + r + "/" + s.spec.replicas + " ready</div><div class=\"dv-chips\">" + (s.spec.volumeClaimTemplates || []).map(function (v) { return chip("vol", "💾 " + esc(v.metadata.name) + " " + esc(v.spec.resources.requests.storage)); }).join("") + "</div></div>"; });
      cjs.forEach(function (j) { h += '<div class="dv-card ' + (j.spec.suspend ? "idle" : "ok") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(j.metadata.name) + '</b><span class="img">cronjob</span></div><div class="dv-cs">' + esc(j.spec.schedule) + "</div><div class=\"dv-chips\">" + K.ownedBy(c, j, "Job").slice(-3).map(function (x) { var cp = ((x.status || {}).conditions || []).some(function (q) { return q.type === "Complete"; }), fl = ((x.status || {}).conditions || []).some(function (q) { return q.type === "Failed"; }); return chip(cp ? "ro" : fl ? "bad" : "sec", esc(x.metadata.name.replace(j.metadata.name + "-", "#"))); }).join("") + "</div></div>"; });
      jobs.filter(function (j) { return !(j.metadata.ownerReferences || []).length; }).forEach(function (j) { var cp = ((j.status || {}).conditions || []).some(function (q) { return q.type === "Complete"; }), fl = ((j.status || {}).conditions || []).some(function (q) { return q.type === "Failed"; }); h += '<div class="dv-card ' + (cp ? "ok" : fl ? "bad" : "warn") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(j.metadata.name) + '</b><span class="img">job</span></div><div class="dv-cs">' + ((j.status || {}).succeeded || 0) + "/" + j.spec.completions + " complete" + (fl ? " · failed" : "") + "</div></div>"; });
      h += "</div></div>";
    });
    if (!any) h = '<div class="dv-empty">No workloads in your namespaces yet. Deployments, StatefulSets and Jobs appear here with their rollout progress, revisions and autoscalers.</div>';
    return h;
  }

  /* ---------------- Traffic */
  function traffic(sys) {
    var c = cl(sys); if (!c) return "";
    var h = "";
    var ings = K.all(c, "Ingress");
    if (ings.length) {
      h += '<div class="k8-flow">';
      ings.forEach(function (g) {
        (g.spec.rules || []).forEach(function (r) {
          ((r.http || {}).paths || []).forEach(function (p) {
            var sv = K.get(c, "Service", g.metadata.namespace, p.backend.service.name), eps = sv ? K.endpointsOf(c, sv) : [];
            var tls = (g.spec.tls || []).some(function (t) { return (t.hosts || []).indexOf(r.host) >= 0; }), sec = tls ? K.get(c, "Secret", g.metadata.namespace, (g.spec.tls.filter(function (t) { return (t.hosts || []).indexOf(r.host) >= 0; })[0] || {}).secretName) : null;
            h += '<div class="k8-route"><span class="k8-host">' + (tls ? (sec ? "🔒 " : "⚠ ") : "") + esc((tls ? "https://" : "http://") + (r.host || "*") + p.path) + '</span><span class="arr">→</span>' + chip(sv ? "port" : "bad", "svc " + esc(p.backend.service.name) + ":" + esc(p.backend.service.port.number || p.backend.service.port.name)) + '<span class="arr">→</span>' + (eps.length ? eps.map(function (x) { return chip("ro", esc(short(x.metadata.name))); }).join("") : chip("bad", "no ready pods")) + "</div>";
          });
        });
      });
      h += "</div>";
    }
    var cards = [];
    nsList(c).forEach(function (ns) {
      K.list(c, "Service", ns).forEach(function (s) {
        if (s.metadata.name === "kubernetes") return;
        var eps = K.endpointsOf(c, s), all = K.endpointsOf(c, s, true);
        cards.push('<div class="dv-card ' + (eps.length ? "ok" : s.spec.selector ? "bad" : "idle") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(s.metadata.name) + '</b><span class="img">' + esc(s.spec.type) + '</span></div><div class="dv-cs">' + esc(ns) + " · " + esc(s.spec.clusterIP) + (s.spec.type === "LoadBalancer" && ((s.status || {}).loadBalancer || {}).ingress ? " · " + esc(s.status.loadBalancer.ingress[0].ip) : "") + "</div><div class=\"dv-chips\">" + (s.spec.ports || []).map(function (p) { return chip("port", p.port + (p.nodePort && s.spec.type !== "ClusterIP" ? ":" + p.nodePort : "") + "→" + p.targetPort); }).join("") + chip(eps.length ? "ro" : "bad", eps.length + " endpoint" + (eps.length === 1 ? "" : "s") + (all.length > eps.length ? " (+" + (all.length - eps.length) + " not ready)" : "")) + "</div></div>");
      });
    });
    if (cards.length) h += '<div class="dv-grid">' + cards.join("") + "</div>";
    var pols = [];
    nsList(c).forEach(function (ns) {
      var nps = K.list(c, "NetworkPolicy", ns); if (!nps.length) return;
      pols.push('<div class="k8-np"><b>' + esc(ns) + "</b> " + nps.map(function (n) {
        var sel = K.emptySel(n.spec.podSelector) ? "all pods" : K.selStr(n.spec.podSelector);
        var desc = (n.spec.policyTypes || []).map(function (t) { var rules = t === "Ingress" ? n.spec.ingress : n.spec.egress; return !rules || !rules.length ? "deny " + t.toLowerCase() : t.toLowerCase() + " ← " + rules.map(function (r) { return ((r.from || r.to || []).map(function (p) { return p.podSelector ? (K.emptySel(p.podSelector) ? "ns pods" : K.selStr(p.podSelector)) : p.namespaceSelector ? "ns " + K.selStr(p.namespaceSelector) : p.ipBlock ? p.ipBlock.cidr : ""; }).join("|") || "any") + ((r.ports || []).length ? ":" + r.ports.map(function (p) { return p.port; }).join(",") : ""); }).join("; "); }).join(" · ");
        return chip(/deny/.test(desc) ? "sec" : "bind", esc(n.metadata.name) + ": " + esc(sel) + " · " + esc(desc));
      }).join(" ") + "</div>");
    });
    if (pols.length) h += '<div class="k8-pols"><div class="k8-nsh">NetworkPolicies</div>' + pols.join("") + "</div>";
    if (!h) h = '<div class="dv-empty">No Services or Ingresses yet. Routes from the outside (Ingress hosts) to Services and their ready pods appear here, with NetworkPolicies.</div>';
    return h;
  }

  function caption(sys, idx) {
    var c = cl(sys); if (!c) return "No cluster.";
    var pods = K.all(c, "Pod").filter(function (p) { return !SYS_NS.test(p.metadata.namespace) && !K.terminating(p); });
    var bad = pods.filter(function (p) { return podState(p).cls === "bad"; }).length, ready = pods.filter(K.podReady).length;
    var base = "kestrel-staging · " + K.all(c, "Node").length + " nodes · " + ready + "/" + pods.length + " pods ready" + (bad ? ' · <span class="bad">' + bad + " failing</span>" : "");
    var last = c.events.filter(function (e) { return e.type === "Warning" && !SYS_NS.test(e.ns); }).slice(-1)[0];
    if (last && K.t(c) - last.last < 30) base += ' · <span class="bad">' + esc(last.reason) + "</span> " + esc(last.kind.toLowerCase() + "/" + last.name);
    void idx;
    return base;
  }
  function sig(sys) {
    var c = cl(sys); if (!c) return { cl: "", wl: "", tr: "" };
    return { cl: K.all(c, "Pod").map(function (p) { return p.metadata.name + K.kubectl.podStatus(p) + K.podReady(p); }).join(","), wl: K.all(c, "Deployment").concat(K.all(c, "StatefulSet")).map(function (d) { return d.metadata.name + JSON.stringify(d.status && [d.status.availableReplicas, d.status.updatedReplicas]) + d.metadata.generation; }).join(","), tr: K.all(c, "Service").concat(K.all(c, "Ingress"), K.all(c, "NetworkPolicy")).map(function (x) { return x.metadata.name + x.metadata.resourceVersion; }).join(",") };
  }
  root.K8sViz = { cluster: cluster, workloads: workloads, traffic: traffic, caption: caption, sig: sig };
})(typeof window !== "undefined" ? window : globalThis);
