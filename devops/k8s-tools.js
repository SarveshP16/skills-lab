/* sudo learn — DevOps Module 4: the tools around the cluster. Kustomize (bases, overlays, namespace, namePrefix,
   labels, images, replicas, patches, ConfigMap/Secret generators with hash suffixes), Helm 3 (a Go-template
   renderer for charts, a chart repo at charts.kestrel.io, releases stored as Secrets, install/upgrade/rollback/
   history/template/get), Kyverno (validate patterns with anchors, autogen for pod controllers, verifyImages
   against cosign signatures in ghcr.io, Audit policy reports), `trivy k8s`, and Argo CD (Applications that
   follow a Git path, sync status and health, automated sync with prune and self-heal, the argocd CLI). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, CI = root.CI, GH = root.GitHub, G = root.GitCore, K = root.K8s, KC = K.kubectl, Y = root.DevYaml;
  var out = U.out, errl = U.errl;
  var keys = K.keys, clone = K.clone, isObj = K.isObj;

  /* ================================================================== file system views */
  // laptop: {read, isDir, list}
  K.fsOfSess = function (sess) {
    return { read: function (p) { return KC.readF(sess, p); }, isDir: function (p) { var n = Dk.fsNode(sess.sys, p); return !!n && n.type === "d"; }, list: function (p) { var n = Dk.fsNode(sess.sys, p); return n && n.type === "d" ? keys(n.children).sort() : []; } };
  };
  // a git commit: paths relative to the repo root (leading "/")
  K.fsOfCommit = function (sys, sha) {
    var flat = G.commitFlat(CI.homeSys(sys), sha), home = CI.homeSys(sys);
    function norm(p) { return String(p).replace(/^\/+/, ""); }
    return { read: function (p) { var f = flat[norm(p)]; return f ? G.blobText(home, f.sha) : null; }, isDir: function (p) { var n = norm(p).replace(/\/$/, ""); if (!n) return true; return keys(flat).some(function (k) { return k.indexOf(n + "/") === 0; }); }, list: function (p) { var n = norm(p).replace(/\/$/, ""), pre = n ? n + "/" : "", seen = {}; keys(flat).forEach(function (k) { if (k.indexOf(pre) === 0) seen[k.slice(pre.length).split("/")[0]] = 1; }); return keys(seen).sort(); } };
  };
  function join(a, b) { return S.normAbs((b.charAt(0) === "/" ? b : a.replace(/\/$/, "") + "/" + b)); }

  /* ================================================================== Kustomize */
  var ORDER = ["Namespace", "ResourceQuota", "StorageClass", "CustomResourceDefinition", "ServiceAccount", "Role", "ClusterRole", "RoleBinding", "ClusterRoleBinding", "ConfigMap", "Secret", "Endpoints", "Service", "LimitRange", "PriorityClass", "PersistentVolume", "PersistentVolumeClaim", "Deployment", "StatefulSet", "CronJob", "PodDisruptionBudget"];
  function hashSuffix(obj) { var s = JSON.stringify({ kind: obj.kind, name: obj.metadata.name, data: obj.data || {} }), h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return K.rand("kz" + h, 10); }
  function podSpecs(o) { var out2 = []; if (o.kind === "Pod") out2.push(o.spec); else if (o.kind === "CronJob") { if (o.spec && o.spec.jobTemplate) out2.push(o.spec.jobTemplate.spec.template.spec); } else if (o.spec && o.spec.template && o.spec.template.spec) out2.push(o.spec.template.spec); return out2.filter(Boolean); }
  K.podSpecs = podSpecs;
  function renameRefs(objs, kind, from, to) {
    objs.forEach(function (o) {
      podSpecs(o).forEach(function (sp) {
        (sp.volumes || []).forEach(function (v) { if (kind === "ConfigMap" && v.configMap && v.configMap.name === from) v.configMap.name = to; if (kind === "Secret" && v.secret && v.secret.secretName === from) v.secret.secretName = to; if (kind === "PersistentVolumeClaim" && v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === from) v.persistentVolumeClaim.claimName = to; });
        (sp.containers || []).concat(sp.initContainers || []).forEach(function (c) {
          (c.envFrom || []).forEach(function (e) { if (kind === "ConfigMap" && e.configMapRef && e.configMapRef.name === from) e.configMapRef.name = to; if (kind === "Secret" && e.secretRef && e.secretRef.name === from) e.secretRef.name = to; });
          (c.env || []).forEach(function (e) { var vf = e.valueFrom || {}; if (kind === "ConfigMap" && vf.configMapKeyRef && vf.configMapKeyRef.name === from) vf.configMapKeyRef.name = to; if (kind === "Secret" && vf.secretKeyRef && vf.secretKeyRef.name === from) vf.secretKeyRef.name = to; });
        });
        if (kind === "ServiceAccount" && sp.serviceAccountName === from) sp.serviceAccountName = to;
        if (kind === "Secret") (sp.imagePullSecrets || []).forEach(function (s) { if (s.name === from) s.name = to; });
      });
      if (kind === "Service" && o.kind === "Ingress") (o.spec.rules || []).forEach(function (r) { ((r.http || {}).paths || []).forEach(function (p) { if (p.backend.service && p.backend.service.name === from) p.backend.service.name = to; }); });
      if (kind === "Service" && o.kind === "StatefulSet" && o.spec.serviceName === from) o.spec.serviceName = to;
      if ((kind === "Deployment" || kind === "StatefulSet") && o.kind === "HorizontalPodAutoscaler" && o.spec.scaleTargetRef && o.spec.scaleTargetRef.name === from) o.spec.scaleTargetRef.name = to;
      if (kind === "Secret" && o.kind === "Ingress") (o.spec.tls || []).forEach(function (t) { if (t.secretName === from) t.secretName = to; });
      if ((kind === "Role" || kind === "ClusterRole") && /RoleBinding$/.test(o.kind) && o.roleRef && o.roleRef.name === from) o.roleRef.name = to;
      if (kind === "ServiceAccount" && /RoleBinding$/.test(o.kind)) (o.subjects || []).forEach(function (s) { if (s.kind === "ServiceAccount" && s.name === from) s.name = to; });
    });
  }
  function kfile(fs, dir) { var names = ["kustomization.yaml", "kustomization.yml", "Kustomization"]; for (var i = 0; i < names.length; i++) { var t = fs.read(join(dir, names[i])); if (t != null) return { text: t, path: join(dir, names[i]) }; } return null; }
  function setLabels(o, labels, selectors) {
    o.metadata.labels = Object.assign({}, o.metadata.labels || {}, labels);
    if (!selectors) return;
    if (o.kind === "Service") { o.spec = o.spec || {}; o.spec.selector = Object.assign({}, o.spec.selector || {}, labels); }
    if (/^(Deployment|StatefulSet|DaemonSet|ReplicaSet|Job)$/.test(o.kind) && o.spec) { if (o.kind !== "Job") { o.spec.selector = o.spec.selector || {}; o.spec.selector.matchLabels = Object.assign({}, o.spec.selector.matchLabels || {}, labels); } if (o.spec.template) { o.spec.template.metadata = o.spec.template.metadata || {}; o.spec.template.metadata.labels = Object.assign({}, o.spec.template.metadata.labels || {}, labels); } }
    if (o.kind === "CronJob" && o.spec && o.spec.jobTemplate && o.spec.jobTemplate.spec.template) { var tm = o.spec.jobTemplate.spec.template; tm.metadata = tm.metadata || {}; tm.metadata.labels = Object.assign({}, tm.metadata.labels || {}, labels); }
    if (o.kind === "NetworkPolicy" && o.spec && o.spec.podSelector) o.spec.podSelector.matchLabels = Object.assign({}, o.spec.podSelector.matchLabels || {}, labels);
  }
  function build(fs, dir, depth) {
    if (depth > 6) return { error: "error: accumulating resources: too many levels of bases" };
    var kf = kfile(fs, dir);
    if (!kf) return { error: "error: unable to find one of 'kustomization.yaml', 'kustomization.yml' or 'Kustomization' in directory '" + dir + "'" };
    var y = Y.tryParse(kf.text);
    if (y.error) return { error: "error: invalid Kustomization: error converting YAML to JSON: " + y.error };
    var k = y.value || {}, objs = [];
    var allowed = ["apiVersion", "kind", "resources", "bases", "namespace", "namePrefix", "nameSuffix", "commonLabels", "labels", "commonAnnotations", "images", "replicas", "patches", "patchesStrategicMerge", "patchesJson6902", "configMapGenerator", "secretGenerator", "generatorOptions", "components"];
    var bad = keys(k).filter(function (x) { return allowed.indexOf(x) < 0; });
    if (bad.length) return { error: "error: invalid Kustomization: json: unknown field \"" + bad[0] + "\"" };
    var resList = (k.resources || []).concat(k.bases || []);
    for (var i = 0; i < resList.length; i++) {
      var rp = join(dir, resList[i]);
      if (fs.isDir(rp)) { var sub = build(fs, rp, (depth || 0) + 1); if (sub.error) return { error: sub.error.replace(/^error: /, "error: accumulating resources: accumulation err='accumulating resources from '" + resList[i] + "': ") }; objs = objs.concat(sub.objs); continue; }
      var t = fs.read(rp);
      if (t == null) return { error: "error: accumulating resources: accumulation err='accumulating resources from '" + resList[i] + "': open " + rp + ": no such file or directory': must build at directory: not a valid directory: evalsymlink failure on '" + rp + "' : lstat " + rp + ": no such file or directory" };
      var pd = KC.parseDocs(t, resList[i]); if (pd.error) return { error: pd.error };
      pd.docs.forEach(function (d) { objs.push(clone(d.obj)); });
    }
    // generators
    var opts = k.generatorOptions || {};
    var gens = [];
    (k.configMapGenerator || []).concat((k.secretGenerator || []).map(function (g) { return Object.assign({ _secret: true }, g); })).forEach(function (g) {
      var data = {};
      (g.literals || []).forEach(function (l) { var j = l.indexOf("="); data[l.slice(0, j)] = l.slice(j + 1); });
      (g.files || []).forEach(function (f) { var key = f.indexOf("=") > 0 ? f.slice(0, f.indexOf("=")) : f.split("/").pop(), p = f.indexOf("=") > 0 ? f.slice(f.indexOf("=") + 1) : f; var t2 = fs.read(join(dir, p)); data[key] = t2 == null ? "" : t2; });
      (g.envs || (g.env ? [g.env] : [])).forEach(function (f) { (fs.read(join(dir, f)) || "").split("\n").forEach(function (l) { l = l.trim(); if (!l || l.charAt(0) === "#") return; var j = l.indexOf("="); if (j > 0) data[l.slice(0, j)] = l.slice(j + 1); }); });
      var o = g._secret ? { apiVersion: "v1", kind: "Secret", metadata: { name: g.name }, type: g.type || "Opaque", data: (function () { var e = {}; keys(data).forEach(function (x) { e[x] = K.b64(data[x]); }); return e; })() } : { apiVersion: "v1", kind: "ConfigMap", metadata: { name: g.name }, data: data };
      if (g.behavior === "merge" || g.behavior === "replace") { var base = objs.filter(function (x) { return x.kind === o.kind && (x._kzName || x.metadata.name) === g.name; })[0]; if (base) { base.data = g.behavior === "merge" ? Object.assign({}, base.data, o.data) : o.data; return; } }
      o._kzHash = !(opts.disableNameSuffixHash || (g.options || {}).disableNameSuffixHash);
      gens.push(o);
    });
    objs = objs.concat(gens);
    // patches
    var patches = (k.patches || []).concat((k.patchesStrategicMerge || []).map(function (p) { return typeof p === "string" && !/\n/.test(p) ? { path: p } : { patch: p }; }));
    for (var j = 0; j < patches.length; j++) {
      var pt = patches[j], text = pt.patch != null ? pt.patch : fs.read(join(dir, pt.path || ""));
      if (text == null) return { error: "error: trouble configuring builtin PatchTransformer with config: `\npath: " + pt.path + "\n`: failed to get the patch file from path(" + pt.path + "): evalsymlink failure on '" + join(dir, pt.path) + "' : lstat " + join(dir, pt.path) + ": no such file or directory" };
      var pv = Y.tryParse(text); if (pv.error) return { error: "error: trouble configuring builtin PatchTransformer: " + pv.error };
      var pdoc = pv.value, tgt = pt.target || {};
      if (Array.isArray(pdoc)) {
        var hits = objs.filter(function (o) { return (!tgt.kind || o.kind === tgt.kind) && (!tgt.name || o.metadata.name === tgt.name); });
        hits.forEach(function (o) { pdoc.forEach(function (op) { var parts = op.path.split("/").slice(1), par = o; for (var q = 0; q < parts.length - 1; q++) par = par[Array.isArray(par) ? +parts[q] : parts[q]]; var last = parts[parts.length - 1]; if (op.op === "remove") { if (Array.isArray(par)) par.splice(+last, 1); else delete par[last]; } else if (Array.isArray(par) && last === "-") par.push(op.value); else par[Array.isArray(par) ? +last : last] = op.value; }); });
        continue;
      }
      var target = objs.filter(function (o) { return o.kind === (tgt.kind || pdoc.kind) && o.metadata.name === (tgt.name || (pdoc.metadata || {}).name); });
      if (!target.length) return { error: "error: no resource matches strategic merge patch \"" + (pdoc.kind || "") + ".v1." + (pdoc.apiVersion || "").split("/")[0] + "|~X|" + ((pdoc.metadata || {}).name || "") + "\": no matches for Id " + (pdoc.kind || "") + "." + ((pdoc.apiVersion || "").split("/").pop()) + "." + ((pdoc.apiVersion || "").indexOf("/") > 0 ? pdoc.apiVersion.split("/")[0] : "") + "/" + ((pdoc.metadata || {}).name || "") + ".[noNs]; failed to find unique target for patch" };
      target.forEach(function (o) { var m = K.smp(o, pdoc); keys(o).forEach(function (x) { delete o[x]; }); Object.assign(o, m); });
    }
    // images, replicas
    (k.images || []).forEach(function (im) {
      objs.forEach(function (o) { podSpecs(o).forEach(function (sp) { (sp.containers || []).concat(sp.initContainers || []).forEach(function (c) { var ref = Dk.parseRef(c.image || ""), repo = (c.image || "").replace(/[:@].*$/, ""); if (repo !== im.name && repo.split("/").pop() !== im.name && (c.image || "").split(":")[0] !== im.name) return; var nn = im.newName || repo; c.image = nn + (im.digest ? "@" + im.digest : ":" + (im.newTag != null ? im.newTag : ref.tag || "latest")); }); }); });
    });
    (k.replicas || []).forEach(function (rp2) { objs.forEach(function (o) { if (o.metadata.name === rp2.name && o.spec && o.spec.replicas !== undefined || (o.metadata.name === rp2.name && /^(Deployment|StatefulSet|ReplicaSet)$/.test(o.kind))) o.spec.replicas = rp2.count; }); });
    // labels and annotations
    if (k.commonLabels) objs.forEach(function (o) { setLabels(o, k.commonLabels, true); });
    (k.labels || []).forEach(function (L) { objs.forEach(function (o) { setLabels(o, L.pairs || {}, !!L.includeSelectors); if (L.includeTemplates && o.spec && o.spec.template) { o.spec.template.metadata = o.spec.template.metadata || {}; o.spec.template.metadata.labels = Object.assign({}, o.spec.template.metadata.labels || {}, L.pairs || {}); } }); });
    if (k.commonAnnotations) objs.forEach(function (o) { o.metadata.annotations = Object.assign({}, o.metadata.annotations || {}, k.commonAnnotations); });
    // names
    if (k.namePrefix || k.nameSuffix) objs.forEach(function (o) {
      if (o.kind === "Namespace" || /^Cluster/.test(o.kind) && false) return;
      var before = o.metadata.name, after = (k.namePrefix || "") + before + (k.nameSuffix || "");
      if (!o._kzName) o._kzName = before;
      o.metadata.name = after;
      renameRefs(objs, o.kind, before, after);
    });
    if (k.namespace) objs.forEach(function (o) { var info = K.KINDS[o.kind]; if (o.kind === "Namespace") return; if (!info || info.ns) o.metadata.namespace = k.namespace; if (/RoleBinding$/.test(o.kind)) (o.subjects || []).forEach(function (s) { if (s.kind === "ServiceAccount") s.namespace = k.namespace; }); });
    return { objs: objs, depth: depth || 0 };
  }
  K.kustomizeFs = function (fs, dir) {
    var r = build(fs, dir, 0);
    if (r.error) return r;
    // hash suffixes last (after every transform), then rewrite references
    r.objs.forEach(function (o) { if (o._kzHash) { var before = o.metadata.name, after = before + "-" + hashSuffix(o); o.metadata.name = after; renameRefs(r.objs, o.kind, before, after); } delete o._kzHash; delete o._kzName; });
    var objs = r.objs.slice().sort(function (a, b) { var ia = ORDER.indexOf(a.kind), ib = ORDER.indexOf(b.kind); ia = ia < 0 ? 99 : ia; ib = ib < 0 ? 99 : ib; return ia - ib || a.metadata.name.localeCompare(b.metadata.name); });
    return { docs: objs.map(function (o) { return { obj: o, src: dir }; }) };
  };
  K.kustomize = function (sess, dir) { return K.kustomizeFs(K.fsOfSess(sess), dir); };
  S.CMDS.kustomize = function (args, io, sess) {
    var a = args.slice(1);
    if (a[0] === "version") { out(io, "v5.5.0\n"); return 0; }
    if (a[0] !== "build") { errl(io, a[0] ? "Error: unknown command \"" + a[0] + "\" for \"kustomize\"" : "Manages declarative configuration of Kubernetes.\nSee https://sigs.k8s.io/kustomize\n\nUsage:\n  kustomize [command]\n\nAvailable Commands:\n  build       Build a kustomization target from a directory or URL\n  create      Create a new kustomization in the current directory\n  edit        Edits a kustomization file\n  version     Prints the kustomize version"); return a[0] ? 1 : 0; }
    var r = K.kustomize(sess, KC.absPath(sess, a[1] || "."));
    if (r.error) { errl(io, r.error.replace(/^error: /, "Error: ")); return 1; }
    out(io, r.docs.map(function (d) { return KC.yaml(d.obj); }).join("---\n"));
    return 0;
  };

  /* ================================================================== Go templates (Helm) */
  function TplErr(msg) { this.message = msg; }
  function lexTpl(src) {
    var toks = [], i = 0;
    while (i < src.length) {
      var j = src.indexOf("{{", i);
      if (j < 0) { toks.push({ t: "text", v: src.slice(i) }); break; }
      var text = src.slice(i, j), trimL = src.charAt(j + 2) === "-" && /\s/.test(src.charAt(j + 3));
      var end = src.indexOf("}}", j);
      if (end < 0) throw new TplErr("unclosed action");
      var trimR = src.charAt(end - 1) === "-" && /\s/.test(src.charAt(end - 2));
      var body = src.slice(j + 2 + (trimL ? 1 : 0), end - (trimR ? 1 : 0)).trim();
      if (trimL) text = text.replace(/\s+$/, "");
      toks.push({ t: "text", v: text });
      toks.push({ t: "act", v: body, line: src.slice(0, j).split("\n").length, col: j - src.lastIndexOf("\n", j) });
      i = end + 2;
      if (trimR) { var m = /^\s*/.exec(src.slice(i)); i += m[0].length; }
    }
    return toks;
  }
  function parseTpl(toks) {
    var pos = 0, defines = {};
    function block(stop) {
      var nodes = [];
      while (pos < toks.length) {
        var t = toks[pos];
        if (t.t === "text") { if (t.v) nodes.push({ k: "text", v: t.v }); pos++; continue; }
        var a = t.v;
        if (/^\/\*[\s\S]*\*\/$/.test(a)) { pos++; continue; }
        var kw = (/^(if|else if|else|end|range|with|define|template|block)\b/.exec(a) || [])[1];
        if (kw === "end" || kw === "else" || kw === "else if") { if (stop) return nodes; throw new TplErr("unexpected {{" + kw + "}}"); }
        pos++;
        if (kw === "if" || kw === "with" || kw === "range") {
          var node = { k: kw, expr: a.slice(kw.length).trim(), line: t.line, col: t.col, body: block(true), els: null };
          var cur = node;
          while (pos < toks.length) {
            var e = toks[pos].v;
            if (/^else if\b/.test(e)) { pos++; var n2 = { k: "if", expr: e.slice(7).trim(), body: block(true), els: null }; cur.els = [n2]; cur = n2; continue; }
            if (/^else$/.test(e)) { pos++; cur.els = block(true); continue; }
            if (/^end$/.test(e)) { pos++; break; }
            throw new TplErr("unexpected " + e);
          }
          nodes.push(node); continue;
        }
        if (kw === "define") { var nm = /^define\s+"([^"]+)"/.exec(a)[1]; defines[nm] = block(true); pos++; continue; }
        if (kw === "template") { var m = /^template\s+"([^"]+)"\s*(.*)$/.exec(a); nodes.push({ k: "tmpl", name: m[1], expr: m[2] || "." }); continue; }
        nodes.push({ k: "expr", expr: a, line: t.line, col: t.col });
      }
      if (stop) throw new TplErr("unexpected EOF");
      return nodes;
    }
    var main = block(false);
    return { main: main, defines: defines };
  }
  function tokExpr(s) {
    var out2 = [], i = 0, m;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "(" || ch === ")" || ch === "|" || ch === ",") { out2.push({ t: ch }); i++; continue; }
      if (ch === "\"") { m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(i)); out2.push({ t: "str", v: JSON.parse("\"" + m[1] + "\"") }); i += m[0].length; continue; }
      if (ch === "`") { var e = s.indexOf("`", i + 1); out2.push({ t: "str", v: s.slice(i + 1, e) }); i = e + 1; continue; }
      if ((m = /^:=|^=/.exec(s.slice(i)))) { out2.push({ t: "assign", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^-?\d+(\.\d+)?/.exec(s.slice(i)))) { out2.push({ t: "num", v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^\$[\w]*(\.[\w]+)*/.exec(s.slice(i)))) { out2.push({ t: "var", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(\.[\w]+)+|^\./.exec(s.slice(i)))) { out2.push({ t: "field", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][\w]*/.exec(s.slice(i)))) { out2.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
      throw new TplErr("unexpected \"" + ch + "\" in operand");
    }
    return out2;
  }
  function dig(v, path) { var parts = path.split(".").filter(Boolean); for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; } return v; }
  function truthy(v) { return !(v == null || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length) || (isObj(v) && !keys(v).length)); }
  function str(v) { return v == null ? "" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(str).join(" ") + "]" : "map[" + keys(v).sort().map(function (k) { return k + ":" + str(v[k]); }).join(" ") + "]") : String(v); }
  function toYaml(v) { if (v == null) return "null"; if (!isObj(v) && !Array.isArray(v)) return Y.dump(v).replace(/\n$/, ""); return KC.yaml(v).replace(/\n$/, ""); }
  function goPrintf(fmt) { var args = Array.prototype.slice.call(arguments, 1), k = 0; return String(fmt).replace(/%([sdvqf%])/g, function (m0, c) { if (c === "%") return "%"; var a = args[k++]; return c === "q" ? JSON.stringify(str(a)) : c === "d" ? String(parseInt(a, 10)) : str(a); }); }
  K.renderTpl = function (files, values, ctx) {
    // files: {path: text}; returns {docs: [{name, text}], notes} or {error}
    var defines = {}, parsed = {};
    try {
      keys(files).forEach(function (p) { var pt = parseTpl(lexTpl(files[p])); parsed[p] = pt; keys(pt.defines).forEach(function (d) { defines[d] = pt.defines[d]; }); });
    } catch (e) { if (e instanceof TplErr) return { error: "parse error: " + e.message }; throw e; }
    var curFile = "", curLine = 0, curCol = 0;
    function run(nodes, dot, vars) {
      var s = "";
      nodes.forEach(function (n) {
        if (n.k === "text") { s += n.v; return; }
        if (n.line) { curLine = n.line; curCol = n.col; }
        if (n.k === "expr") { var r = pipeline(n.expr, dot, vars); if (r && r.assign) return; s += r === undefined || r === null ? "" : str(r); return; }
        if (n.k === "tmpl") { var d = defines[n.name]; if (!d) throw new TplErr("template: no template \"" + n.name + "\" associated with template \"gotpl\""); s += run(d, pipeline(n.expr, dot, vars), vars); return; }
        if (n.k === "if") { var v = pipeline(n.expr, dot, vars); s += truthy(v) ? run(n.body, dot, Object.create(vars)) : n.els ? run(n.els, dot, Object.create(vars)) : ""; return; }
        if (n.k === "with") { var w = pipeline(n.expr, dot, vars); s += truthy(w) ? run(n.body, w, Object.create(vars)) : n.els ? run(n.els, dot, vars) : ""; return; }
        if (n.k === "range") {
          var m = /^(\$\w+)\s*(?:,\s*(\$\w+))?\s*:=\s*(.*)$/.exec(n.expr), list = pipeline(m ? m[3] : n.expr, dot, vars);
          var items = Array.isArray(list) ? list.map(function (x, i) { return [i, x]; }) : isObj(list) ? keys(list).sort().map(function (k) { return [k, list[k]]; }) : [];
          if (!items.length && n.els) { s += run(n.els, dot, vars); return; }
          items.forEach(function (kv) { var vv = Object.create(vars); if (m) { if (m[2]) { vv[m[1]] = kv[0]; vv[m[2]] = kv[1]; } else vv[m[1]] = kv[1]; } s += run(n.body, kv[1], vv); });
        }
      });
      return s;
    }
    var FN = {
      include: function (name, d) { var t = defines[name]; if (!t) throw new TplErr("template: no template \"" + name + "\" associated with template \"gotpl\""); return run(t, d, { $: ctx }); },
      default: function (def, v) { return truthy(v) ? v : def; }, quote: function (v) { return JSON.stringify(str(v)); }, squote: function (v) { return "'" + str(v) + "'"; },
      upper: function (v) { return str(v).toUpperCase(); }, lower: function (v) { return str(v).toLowerCase(); }, title: function (v) { return str(v).replace(/\b\w/g, function (c) { return c.toUpperCase(); }); },
      trunc: function (n, v) { return str(v).slice(0, n); }, trimSuffix: function (x, v) { v = str(v); return v.slice(-x.length) === x ? v.slice(0, -x.length) : v; }, trimPrefix: function (x, v) { v = str(v); return v.indexOf(x) === 0 ? v.slice(x.length) : v; }, trim: function (v) { return str(v).trim(); },
      toYaml: toYaml, toJson: function (v) { return JSON.stringify(v); }, nindent: function (n, v) { var p = new Array(n + 1).join(" "); return "\n" + str(v).split("\n").map(function (l) { return l ? p + l : l; }).join("\n"); }, indent: function (n, v) { var p = new Array(n + 1).join(" "); return str(v).split("\n").map(function (l) { return p + l; }).join("\n"); },
      b64enc: function (v) { return K.b64(str(v)); }, b64dec: function (v) { return K.unb64(str(v)); }, int: function (v) { return parseInt(v, 10) || 0; }, toString: function (v) { return str(v); },
      printf: goPrintf, print: function () { return Array.prototype.slice.call(arguments).map(str).join(""); },
      eq: function (a, b) { return str(a) === str(b) && typeof a === typeof b || a === b; }, ne: function (a, b) { return a !== b; }, lt: function (a, b) { return a < b; }, gt: function (a, b) { return a > b; }, le: function (a, b) { return a <= b; }, ge: function (a, b) { return a >= b; },
      and: function () { var a = arguments; for (var i = 0; i < a.length; i++) if (!truthy(a[i])) return a[i]; return a[a.length - 1]; }, or: function () { var a = arguments; for (var i = 0; i < a.length; i++) if (truthy(a[i])) return a[i]; return a[a.length - 1]; }, not: function (v) { return !truthy(v); },
      empty: function (v) { return !truthy(v); }, required: function (msg, v) { if (v == null || v === "") throw new TplErr("execution error at (" + curFile + ":" + curLine + ":" + curCol + "): " + msg); return v; },
      contains: function (sub, v) { return str(v).indexOf(str(sub)) >= 0; }, hasPrefix: function (p, v) { return str(v).indexOf(p) === 0; }, hasSuffix: function (p, v) { return str(v).slice(-p.length) === p; }, replace: function (a, b, v) { return str(v).split(a).join(b); },
      len: function (v) { return v == null ? 0 : Array.isArray(v) || typeof v === "string" ? v.length : keys(v).length; }, list: function () { return Array.prototype.slice.call(arguments); }, dict: function () { var o = {}; for (var i = 0; i + 1 < arguments.length; i += 2) o[arguments[i]] = arguments[i + 1]; return o; },
      ternary: function (a, b, c) { return truthy(c) ? a : b; }, hasKey: function (m, k) { return isObj(m) && k in m; }, sha256sum: function (v) { return M2.sha256 ? M2.sha256(str(v)) : K.hex(str(v), 64); }, toYAML: toYaml, semverCompare: function () { return true; }
    };
    function pipeline(expr, dot, vars) {
      var toks = tokExpr(expr), pos = 0;
      if (toks[0] && toks[0].t === "var" && toks[1] && toks[1].t === "assign") { var name = toks[0].v; pos = 2; var val = pipe(); setVar(vars, name, val); return { assign: true }; }
      return pipe();
      function setVar(vs, n, v) { var o = vs; while (o && !Object.prototype.hasOwnProperty.call(o, n) && Object.getPrototypeOf(o)) o = Object.getPrototypeOf(o); (Object.prototype.hasOwnProperty.call(o, n) ? o : vs)[n] = v; }
      function pipe() {
        var v = cmd(undefined, false);
        while (toks[pos] && toks[pos].t === "|") { pos++; v = cmd(v, true); }
        return v;
      }
      function operand() {
        var t = toks[pos++];
        if (!t) throw new TplErr("missing value for command");
        if (t.t === "str" || t.t === "num") return { v: t.v };
        if (t.t === "field") return { v: t.v === "." ? dot : dig(dot, t.v) };
        if (t.t === "var") { var base = t.v.split(".")[0], rest = t.v.slice(base.length); var bv = base === "$" ? (vars.$ !== undefined ? vars.$ : ctx) : vars[base]; if (bv === undefined && base !== "$") throw new TplErr("undefined variable \"" + base + "\""); return { v: rest ? dig(bv, rest) : bv }; }
        if (t.t === "(") { var v = pipe(); pos++; return { v: v }; }
        if (t.t === "id") { if (t.v === "true") return { v: true }; if (t.v === "false") return { v: false }; if (t.v === "nil") return { v: null }; return { fn: t.v }; }
        throw new TplErr("unexpected " + t.t);
      }
      function cmd(prev, piped) {
        var first = operand();
        if (!first.fn) { if (piped) throw new TplErr("non-function in pipeline"); return first.v; }
        var f = FN[first.fn]; if (!f) throw new TplErr("function \"" + first.fn + "\" not defined");
        var args = [];
        while (toks[pos] && toks[pos].t !== "|" && toks[pos].t !== ")") { var a = operand(); args.push(a.fn ? (FN[a.fn] ? FN[a.fn]() : undefined) : a.v); }
        if (piped) args.push(prev);
        return f.apply(null, args);
      }
    }
    var docs = [], notes = null;
    try {
      keys(files).sort().forEach(function (p) {
        if (/\/_[^/]*$/.test(p) || !/\.(ya?ml|tpl|txt)$/.test(p)) return;
        curFile = p;
        var text = run(parsed[p].main, ctx, { $: ctx });
        if (/NOTES\.txt$/.test(p)) { notes = text; return; }
        if (/\.tpl$/.test(p)) return;
        docs.push({ name: p, text: text });
      });
    } catch (e) { if (e instanceof TplErr) return { error: e.message.indexOf("execution error") === 0 ? e.message : "template: " + curFile + ":" + curLine + ":" + curCol + ": executing \"" + curFile + "\" at <" + "...>: " + e.message }; throw e; }
    return { docs: docs, notes: notes };
  };

  /* ================================================================== Helm */
  var NOTES_CHART = {
    "Chart.yaml": "apiVersion: v2\nname: notes\ndescription: Kestrel's notes service\ntype: application\nversion: VERSION\nappVersion: \"APPVERSION\"\n",
    "values.yaml": "# How many pods (ignored when autoscaling is enabled)\nreplicaCount: 2\n\nimage:\n  repository: ghcr.io/kestrel/notes-api\n  # Defaults to the chart's appVersion\n  tag: \"\"\n  pullPolicy: IfNotPresent\n\nservice:\n  type: ClusterIP\n  port: 80\n\ningress:\n  enabled: false\n  className: nginx\n  host: notes.staging.kestrel.dev\n  tls: false\n  clusterIssuer: \"\"\n\nresources:\n  requests:\n    cpu: 100m\n    memory: 64Mi\n  limits:\n    memory: 128Mi\n\nautoscaling:\n  enabled: false\n  minReplicas: 2\n  maxReplicas: 6\n  targetCPUUtilizationPercentage: 70\n\n# Extra environment variables: NAME: value\nenv: {}\n",
    "templates/_helpers.tpl": "{{/* Name of the release's objects */}}\n{{- define \"notes.fullname\" -}}\n{{- if contains .Chart.Name .Release.Name }}\n{{- .Release.Name | trunc 63 | trimSuffix \"-\" }}\n{{- else }}\n{{- printf \"%s-%s\" .Release.Name .Chart.Name | trunc 63 | trimSuffix \"-\" }}\n{{- end }}\n{{- end }}\n\n{{- define \"notes.labels\" -}}\nhelm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}\n{{ include \"notes.selectorLabels\" . }}\napp.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}\napp.kubernetes.io/managed-by: {{ .Release.Service }}\n{{- end }}\n\n{{- define \"notes.selectorLabels\" -}}\napp.kubernetes.io/name: {{ .Chart.Name }}\napp.kubernetes.io/instance: {{ .Release.Name }}\n{{- end }}\n",
    "templates/deployment.yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ include \"notes.fullname\" . }}\n  labels:\n    {{- include \"notes.labels\" . | nindent 4 }}\nspec:\n  {{- if not .Values.autoscaling.enabled }}\n  replicas: {{ .Values.replicaCount }}\n  {{- end }}\n  selector:\n    matchLabels:\n      {{- include \"notes.selectorLabels\" . | nindent 6 }}\n  template:\n    metadata:\n      labels:\n        {{- include \"notes.selectorLabels\" . | nindent 8 }}\n    spec:\n      containers:\n        - name: notes\n          image: \"{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}\"\n          imagePullPolicy: {{ .Values.image.pullPolicy }}\n          ports:\n            - name: http\n              containerPort: 8000\n          {{- with .Values.env }}\n          env:\n            {{- range $name, $value := . }}\n            - name: {{ $name }}\n              value: {{ $value | quote }}\n            {{- end }}\n          {{- end }}\n          readinessProbe:\n            httpGet:\n              path: /health\n              port: http\n          resources:\n            {{- toYaml .Values.resources | nindent 12 }}\n",
    "templates/service.yaml": "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ include \"notes.fullname\" . }}\n  labels:\n    {{- include \"notes.labels\" . | nindent 4 }}\nspec:\n  type: {{ .Values.service.type }}\n  ports:\n    - port: {{ .Values.service.port }}\n      targetPort: http\n      name: http\n  selector:\n    {{- include \"notes.selectorLabels\" . | nindent 4 }}\n",
    "templates/ingress.yaml": "{{- if .Values.ingress.enabled -}}\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: {{ include \"notes.fullname\" . }}\n  labels:\n    {{- include \"notes.labels\" . | nindent 4 }}\n  {{- with .Values.ingress.clusterIssuer }}\n  annotations:\n    cert-manager.io/cluster-issuer: {{ . }}\n  {{- end }}\nspec:\n  ingressClassName: {{ .Values.ingress.className }}\n  {{- if .Values.ingress.tls }}\n  tls:\n    - hosts:\n        - {{ .Values.ingress.host }}\n      secretName: {{ include \"notes.fullname\" . }}-tls\n  {{- end }}\n  rules:\n    - host: {{ .Values.ingress.host }}\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service:\n                name: {{ include \"notes.fullname\" . }}\n                port:\n                  name: http\n{{- end }}\n",
    "templates/hpa.yaml": "{{- if .Values.autoscaling.enabled }}\napiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: {{ include \"notes.fullname\" . }}\n  labels:\n    {{- include \"notes.labels\" . | nindent 4 }}\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: {{ include \"notes.fullname\" . }}\n  minReplicas: {{ .Values.autoscaling.minReplicas }}\n  maxReplicas: {{ .Values.autoscaling.maxReplicas }}\n  metrics:\n    - type: Resource\n      resource:\n        name: cpu\n        target:\n          type: Utilization\n          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}\n{{- end }}\n",
    "templates/NOTES.txt": "The notes service is running as {{ include \"notes.fullname\" . }} in {{ .Release.Namespace }}.\n{{- if .Values.ingress.enabled }}\n\nOpen it at http{{ if .Values.ingress.tls }}s{{ end }}://{{ .Values.ingress.host }}/\n{{- else }}\n\nTry it from inside the cluster:\n  kubectl -n {{ .Release.Namespace }} run tmp --rm -i --image=busybox:1.36 --restart=Never -- wget -qO- http://{{ include \"notes.fullname\" . }}/health\n{{- end }}\n"
  };
  var CHART_VERSIONS = [["0.3.0", "1.5.0"], ["0.4.0", "1.6.0"], ["0.5.0", "1.7.1"]];
  K.chartFiles = function (version) { var v = CHART_VERSIONS.filter(function (x) { return x[0] === version; })[0] || CHART_VERSIONS[1]; var f = {}; keys(NOTES_CHART).forEach(function (k) { f[k] = NOTES_CHART[k].replace("VERSION", v[0]).replace("APPVERSION", v[1]); }); if (v[0] === "0.3.0") f["templates/deployment.yaml"] = f["templates/deployment.yaml"].replace(/          readinessProbe:\n            httpGet:\n              path: \/health\n              port: http\n/, ""); return f; };
  var REPO_URL = "https://charts.kestrel.io";
  function helmHome(sess) { return sess.home + "/.config/helm"; }
  function repos(sess) { var t = KC.readF(sess, helmHome(sess) + "/repositories.yaml"); var y = t ? Y.tryParse(t).value : null; return (y && y.repositories) || []; }
  function saveRepos(sess, list) { var p = helmHome(sess) + "/repositories.yaml"; S.mkdirs(sess.sys, helmHome(sess), 493, sess.uid, sess.gid); S.put(sess.sys, p, KC.yaml({ apiVersion: "", generated: "0001-01-01T00:00:00Z", repositories: list }), 420, sess.uid, sess.gid); }
  // resolve a chart reference -> {files, name, version, appVersion} or {error}
  function loadChart(sess, ref, version) {
    var abs = KC.absPath(sess, ref);
    if (Dk.fsNode(sess.sys, abs) && Dk.fsNode(sess.sys, abs).type === "d") {
      var fs = K.fsOfSess(sess), files = {};
      (function walk(d, rel) { fs.list(d).forEach(function (n) { var p = d + "/" + n; if (fs.isDir(p)) walk(p, rel + n + "/"); else files[rel + n] = fs.read(p); }); })(abs, "");
      if (files["Chart.yaml"] == null) return { error: "Error: Chart.yaml file is missing" };
      var cy = Y.tryParse(files["Chart.yaml"]).value || {};
      return { files: files, name: cy.name, version: String(cy.version), appVersion: String(cy.appVersion || ""), local: true };
    }
    var m = /^([\w-]+)\/([\w-]+)$/.exec(ref);
    if (!m) return { error: "Error: INSTALLATION FAILED: repo " + ref.split("/")[0] + " not found" };
    var rp = repos(sess).filter(function (r) { return r.name === m[1]; })[0];
    if (!rp) return { error: "Error: INSTALLATION FAILED: repo " + m[1] + " not found" };
    if (rp.url.replace(/\/$/, "") !== REPO_URL || m[2] !== "notes") return { error: "Error: INSTALLATION FAILED: chart \"" + m[2] + "\" matching " + (version || "") + " not found in " + m[1] + " index. (try 'helm repo update'): no chart name found" };
    var v = version || CHART_VERSIONS[CHART_VERSIONS.length - 1][0];
    if (!CHART_VERSIONS.some(function (x) { return x[0] === v; })) return { error: "Error: INSTALLATION FAILED: chart \"notes\" matching " + v + " not found in " + m[1] + " index. (try 'helm repo update'): improper constraint: " + v };
    var f2 = K.chartFiles(v), cy2 = Y.tryParse(f2["Chart.yaml"]).value;
    return { files: f2, name: "notes", version: v, appVersion: String(cy2.appVersion) };
  }
  function deepMerge(a, b) { if (!isObj(a) || !isObj(b)) return clone(b); var r = clone(a); keys(b).forEach(function (k) { r[k] = isObj(r[k]) && isObj(b[k]) ? deepMerge(r[k], b[k]) : clone(b[k]); }); return r; }
  function setPath(obj, path, val, asString) {
    var parts = path.match(/[^.[\]]+|\[\d+\]/g), cur = obj;
    parts.forEach(function (p, i) { var last = i === parts.length - 1, idx = /^\[(\d+)\]$/.exec(p), key = idx ? +idx[1] : p; if (last) { cur[key] = asString ? val : val === "true" ? true : val === "false" ? false : val === "null" ? null : /^-?\d+$/.test(val) ? +val : val; return; } var nextIsIdx = /^\[\d+\]$/.test(parts[i + 1]); if (cur[key] == null) cur[key] = nextIsIdx ? [] : {}; cur = cur[key]; });
  }
  function valuesFor(sess, chart, o, io, base) {
    var v = clone(base || (Y.tryParse(chart.files["values.yaml"] || "").value || {}));
    for (var i = 0; i < (o.valuess || []).length; i++) { var t = KC.readF(sess, KC.absPath(sess, o.valuess[i])); if (t == null) { errl(io, "Error: open " + o.valuess[i] + ": no such file or directory"); return null; } var y = Y.tryParse(t); if (y.error) { errl(io, "Error: failed to parse " + o.valuess[i] + ": error converting YAML to JSON: " + y.error); return null; } v = deepMerge(v, y.value || {}); }
    (o.sets || []).forEach(function (s) { String(s).split(/,(?=[\w.[\]-]+=)/).forEach(function (kv) { var j = kv.indexOf("="); setPath(v, kv.slice(0, j), kv.slice(j + 1), false); }); });
    (o["set-strings"] || []).forEach(function (s) { var j = s.indexOf("="); setPath(v, s.slice(0, j), s.slice(j + 1), true); });
    return v;
  }
  function userValues(sess, chart, o, io) { var u = {}; for (var i = 0; i < (o.valuess || []).length; i++) { var t = KC.readF(sess, KC.absPath(sess, o.valuess[i])); if (t == null) return null; u = deepMerge(u, Y.tryParse(t).value || {}); } (o.sets || []).forEach(function (s) { String(s).split(/,(?=[\w.[\]-]+=)/).forEach(function (kv) { var j = kv.indexOf("="); setPath(u, kv.slice(0, j), kv.slice(j + 1), false); }); }); return u; }
  function renderChart(chart, values, rel) {
    var ctx = { Values: values, Release: { Name: rel.name, Namespace: rel.ns, Revision: rel.rev, Service: "Helm", IsInstall: rel.rev === 1, IsUpgrade: rel.rev > 1 }, Chart: { Name: chart.name, Version: chart.version, AppVersion: chart.appVersion }, Capabilities: { KubeVersion: { Version: "v1.31.4" } } };
    var tf = {}; keys(chart.files).forEach(function (k) { if (/^templates\//.test(k)) tf[chart.name + "/" + k] = chart.files[k]; });
    var r = K.renderTpl(tf, values, ctx);
    if (r.error) return r;
    var objs = [];
    for (var i = 0; i < r.docs.length; i++) {
      var d = r.docs[i];
      if (!/\S/.test(d.text.replace(/^\s*#.*$/mg, ""))) continue;
      var pd = KC.parseDocs(d.text, d.name);
      if (pd.error) return { error: "YAML parse error on " + d.name + ": " + pd.error.replace(/^error: error parsing [^:]+: /, "") };
      pd.docs.forEach(function (x) { objs.push({ obj: x.obj, src: d.name, text: d.text }); });
    }
    return { objs: objs, notes: r.notes, manifests: r.docs };
  }
  // helm's tables: every column but the last padded to its widest cell, then a tab
  function helmTable(rows) { var w = []; rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); }); return rows.map(function (r) { return r.map(function (c, i) { c = String(c); return i < r.length - 1 ? c + new Array(w[i] - c.length + 1).join(" ") + "\t" : c; }).join(""); }).join("\n") + "\n"; }
  function relStore(cl) { return cl.helm || (cl.helm = {}); }
  function relList(cl, ns, name) { return relStore(cl)[ns + "/" + name] || []; }
  function helmDate(cl, t) { var d = new Date(Dk.stamp(cl.rt, t)), D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], Mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], p = function (n) { return ("0" + n).slice(-2); }; return D[d.getUTCDay()] + " " + Mo[d.getUTCMonth()] + " " + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " " + d.getUTCFullYear(); }
  function storeRelease(cl, rel) {
    var list = relStore(cl)[rel.ns + "/" + rel.name] = relList(cl, rel.ns, rel.name);
    list.forEach(function (r) { if (r.status === "deployed") r.status = "superseded"; });
    list.push(rel);
    var sec = { apiVersion: "v1", kind: "Secret", type: "helm.sh/release.v1", metadata: { name: "sh.helm.release.v1." + rel.name + ".v" + rel.rev, namespace: rel.ns, labels: { name: rel.name, owner: "helm", status: rel.status, version: String(rel.rev), modifiedAt: String(Math.floor(Dk.stamp(cl.rt) / 1000)) } }, data: { release: K.b64(K.b64(JSON.stringify({ name: rel.name, version: rel.rev, chart: rel.chart.name + "-" + rel.chart.version }))) } };
    K.store(cl, sec);
    relList(cl, rel.ns, rel.name).forEach(function (r) { var s = K.get(cl, "Secret", rel.ns, "sh.helm.release.v1." + rel.name + ".v" + r.rev); if (s) s.metadata.labels.status = r.status; });
  }
  // apply a rendered release; returns error text or null
  function deployRelease(cl, sub, rel, prev, o) {
    var objs = rel.objs;
    for (var i = 0; i < objs.length; i++) {
      var x = objs[i].obj, info = K.byKind(cl, x.kind, x.apiVersion);
      if (!info) return "unable to build kubernetes objects from release manifest: resource mapping not found for name: \"" + ((x.metadata || {}).name || "") + "\" namespace: \"\" from \"\": no matches for kind \"" + x.kind + "\" in version \"" + x.apiVersion + "\"\nensure CRDs are installed first";
      var live = K.get(cl, x.kind, info.ns ? rel.ns : null, x.metadata.name);
      if (live && (!live.metadata.annotations || live.metadata.annotations["meta.helm.sh/release-name"] !== rel.name)) return "Unable to continue with " + (prev ? "update" : "install") + ": " + x.kind + " \"" + x.metadata.name + "\" in namespace \"" + rel.ns + "\" exists and cannot be imported into the current release: invalid ownership metadata; label validation error: missing key \"app.kubernetes.io/managed-by\": must be set to \"Helm\"; annotation validation error: missing key \"meta.helm.sh/release-name\": must be set to \"" + rel.name + "\"; annotation validation error: missing key \"meta.helm.sh/release-namespace\": must be set to \"" + rel.ns + "\"";
    }
    var done = [];
    for (var j = 0; j < objs.length; j++) {
      var y = clone(objs[j].obj);
      y.metadata = y.metadata || {};
      y.metadata.annotations = Object.assign({}, y.metadata.annotations || {}, { "meta.helm.sh/release-name": rel.name, "meta.helm.sh/release-namespace": rel.ns });
      y.metadata.labels = Object.assign({ "app.kubernetes.io/managed-by": "Helm" }, y.metadata.labels || {});
      var r = K.write(cl, y, { ns: rel.ns, mode: "helm", sub: sub, source: objs[j].src, dryRun: !!o.dryRun });
      if (r.error) return r.error.replace(/^Error from server[^:]*: error when (creating|applying patch) "[^"]*": /, "").replace(/^Error from server \(\w+\): /, "");
      done.push(y.kind + "/" + y.metadata.name);
    }
    // objects of the previous revision that aren't in this one are deleted
    if (prev && !o.dryRun) prev.objs.forEach(function (p) { var still = objs.some(function (x) { return x.obj.kind === p.obj.kind && x.obj.metadata.name === p.obj.metadata.name; }); if (!still) { var live = K.get(cl, p.obj.kind, K.KINDS[p.obj.kind] && K.KINDS[p.obj.kind].ns ? rel.ns : null, p.obj.metadata.name); if (live) K.del(cl, live, sub); } });
    return null;
  }
  function waitRelease(cl, rel, timeout) {
    return K.advance(cl, timeout, function () { return rel.objs.every(function (x) { if (x.obj.kind !== "Deployment" && x.obj.kind !== "StatefulSet") return true; var d = K.get(cl, x.obj.kind, rel.ns, x.obj.metadata.name); return d && (x.obj.kind === "Deployment" ? K.deployDone(cl, d) : ((d.status || {}).readyReplicas || 0) >= d.spec.replicas); }); });
  }
  function printRelease(io, cl, rel, notes) {
    out(io, "NAME: " + rel.name + "\nLAST DEPLOYED: " + helmDate(cl, rel.t) + "\nNAMESPACE: " + rel.ns + "\nSTATUS: " + rel.status + "\nREVISION: " + rel.rev + "\nTEST SUITE: None\n" + (notes ? "NOTES:\n" + notes.replace(/^\n+/, "").replace(/\n*$/, "\n") : ""));
  }
  S.CMDS.helm = function (args, io, sess) {
    var o = KC.parse(args.slice(1)), sub = o.pos.shift();
    o.valuess = o.valuess || [];
    // -f means --values for helm
    if (o.f.length) o.valuess = o.valuess.concat(o.f);
    if (o.values) o.valuess = o.valuess.concat(o.valuess.indexOf(o.values) < 0 ? [o.values] : []);
    if (o.sets == null && o.set != null) o.sets = [o.set];
    if (sub === "version") { out(io, "version.BuildInfo{Version:\"v3.16.3\", GitCommit:\"cfd07493f46efc9debd9cc1b02a0961186df7fdf\", GitTreeState:\"clean\", GoVersion:\"go1.22.7\"}\n"); return 0; }
    if (!sub) { out(io, "The Kubernetes package manager\n\nUsage:\n  helm [command]\n\nAvailable Commands:\n  create      create a new chart with the given name\n  get         download extended information of a named release\n  history     fetch release history\n  install     install a chart\n  lint        examine a chart for possible issues\n  list        list releases\n  pull        download a chart from a repository and (optionally) unpack it in local directory\n  repo        add, list, remove, update, and index chart repositories\n  rollback    roll back a release to a previous revision\n  search      search for a keyword in charts\n  show        show information of a chart\n  status      display the status of the named release\n  template    locally render templates\n  uninstall   uninstall a release\n  upgrade     upgrade a release\n  version     print the client version information\n"); return 0; }
    if (sub === "repo") {
      var rs = o.pos.shift(), list = repos(sess);
      if (rs === "add") { var nm = o.pos[0], url = o.pos[1]; if (!nm || !url) { errl(io, "Error: \"helm repo add\" requires 2 arguments"); return 1; } if (url.replace(/\/$/, "") !== REPO_URL) { errl(io, "Error: looks like \"" + url + "\" is not a valid chart repository or cannot be reached: Get \"" + url.replace(/\/$/, "") + "/index.yaml\": dial tcp: lookup " + url.replace(/^https?:\/\//, "").split("/")[0] + ": no such host"); return 1; } if (list.some(function (r) { return r.name === nm; })) { out(io, "\"" + nm + "\" already exists with the same configuration, skipping\n"); return 0; } list.push({ name: nm, url: url, caFile: "", certFile: "", keyFile: "", insecure_skip_tls_verify: false, pass_credentials_all: false, username: "", password: "" }); saveRepos(sess, list); out(io, "\"" + nm + "\" has been added to your repositories\n"); return 0; }
      if (rs === "list" || rs === "ls") { if (!list.length) { errl(io, "Error: no repositories to show"); return 1; } var rows = [["NAME", "URL"]]; list.forEach(function (r) { rows.push([r.name, r.url]); }); out(io, helmTable(rows)); return 0; }
      if (rs === "update" || rs === "up") { if (!list.length) { errl(io, "Error: no repositories found. You must add one before updating"); return 1; } out(io, "Hang tight while we grab the latest from your chart repositories...\n" + list.map(function (r) { return "...Successfully got an update from the \"" + r.name + "\" chart repository\n"; }).join("") + "Update Complete. ⎈Happy Helming!⎈\n"); return 0; }
      if (rs === "remove" || rs === "rm") { saveRepos(sess, list.filter(function (r) { return r.name !== o.pos[0]; })); out(io, "\"" + o.pos[0] + "\" has been removed from your repositories\n"); return 0; }
      errl(io, "Error: unknown command \"" + rs + "\" for \"helm repo\""); return 1;
    }
    if (sub === "search") {
      var kw = o.pos[1] || "", hits = repos(sess).filter(function (r) { return r.url.replace(/\/$/, "") === REPO_URL; });
      if (!hits.length) { out(io, "No results found\n"); return 0; }
      var rows2 = [["NAME", "CHART VERSION", "APP VERSION", "DESCRIPTION"]];
      (o.versions ? CHART_VERSIONS.slice().reverse() : [CHART_VERSIONS[CHART_VERSIONS.length - 1]]).forEach(function (v) { if (!kw || "notes".indexOf(kw.split("/").pop()) >= 0) rows2.push([hits[0].name + "/notes", v[0], v[1], "Kestrel's notes service"]); });
      out(io, helmTable(rows2)); return 0;
    }
    if (sub === "show" || sub === "inspect") {
      var what = o.pos.shift(), ch = loadChart(sess, o.pos[0] || "", o.version);
      if (ch.error) { errl(io, ch.error.replace("INSTALLATION FAILED: ", "")); return 1; }
      if (what === "values") { out(io, ch.files["values.yaml"]); return 0; }
      if (what === "chart") { out(io, ch.files["Chart.yaml"]); return 0; }
      if (what === "all") { out(io, ch.files["Chart.yaml"] + "---\n" + ch.files["values.yaml"]); return 0; }
      errl(io, "Error: unknown command \"" + what + "\" for \"helm show\""); return 1;
    }
    if (sub === "pull" || sub === "fetch") {
      var ch2 = loadChart(sess, o.pos[0] || "", o.version); if (ch2.error) { errl(io, ch2.error.replace("INSTALLATION FAILED: ", "")); return 1; }
      if (!o.untar) { S.put(sess.sys, sess.cwd + "/notes-" + ch2.version + ".tgz", "\x1f\x8b(helm chart archive)\n", 420, sess.uid, sess.gid); return 0; }
      var dest = (o.untardir ? KC.absPath(sess, o.untardir) : sess.cwd) + "/notes";
      keys(ch2.files).forEach(function (k) { var p = dest + "/" + k; S.mkdirs(sess.sys, p.slice(0, p.lastIndexOf("/")), 493, sess.uid, sess.gid); S.put(sess.sys, p, ch2.files[k], 420, sess.uid, sess.gid); });
      return 0;
    }
    if (sub === "lint") {
      var ch3 = loadChart(sess, o.pos[0] || ".", null); if (ch3.error) { errl(io, ch3.error); return 1; }
      var vals = valuesFor(sess, ch3, o, io); if (!vals) return 1;
      var rr = renderChart(ch3, vals, { name: "release-name", ns: "default", rev: 1 });
      out(io, "==> Linting " + (o.pos[0] || ".") + "\n" + (rr.error ? "[ERROR] templates/: " + rr.error + "\n\nError: 1 chart(s) linted, 1 chart(s) failed\n" : "[INFO] Chart.yaml: icon is recommended\n\n1 chart(s) linted, 0 chart(s) failed\n"));
      return rr.error ? 1 : 0;
    }
    if (sub === "create") { errl(io, "Error: helm create isn't simulated in this lab: pull the Kestrel chart to start from (helm pull kestrel/notes --untar) and edit it."); return 1; }
    if (sub === "template") {
      var tn = o.pos[1] ? o.pos[0] : "release-name", tref = o.pos[1] || o.pos[0];
      var ch4 = loadChart(sess, tref || "", o.version); if (ch4.error) { errl(io, ch4.error.replace("INSTALLATION FAILED: ", "")); return 1; }
      var v4 = valuesFor(sess, ch4, o, io); if (!v4) return 1;
      var r4 = renderChart(ch4, v4, { name: tn, ns: o.namespace || "default", rev: 1 });
      if (r4.error) { errl(io, "Error: " + r4.error); return 1; }
      out(io, r4.manifests.filter(function (m) { return /\S/.test(m.text) && !/NOTES/.test(m.name); }).map(function (m) { return "---\n# Source: " + m.name + "\n" + m.text.replace(/^\n+/, "").replace(/\n*$/, "\n"); }).join(""));
      return 0;
    }
    // everything below talks to the cluster
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, ns = C.ns;
    if (sub === "list" || sub === "ls") {
      var all = keys(relStore(cl)).filter(function (k) { return o["all-namespaces"] || k.split("/")[0] === ns; }).map(function (k) { var l = relStore(cl)[k]; return l.filter(function (r) { return r.status === "deployed" || r.status === "failed"; }).pop() || l[l.length - 1]; }).filter(function (r) { return r && r.status !== "uninstalled"; });
      var rows3 = [["NAME", "NAMESPACE", "REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION"]];
      all.forEach(function (r) { rows3.push([r.name, r.ns, r.rev, new Date(Dk.stamp(cl.rt, r.t)).toISOString().replace("T", " ").replace(/\.\d+Z$/, ".123456789 +0000 UTC"), r.status, r.chart.name + "-" + r.chart.version, r.chart.appVersion]); });
      out(io, helmTable(rows3)); return 0;
    }
    var name = o.pos[0], hist = name ? relList(cl, ns, name) : [], last = hist.filter(function (r) { return r.status === "deployed"; }).pop() || hist[hist.length - 1];
    if (sub === "history" || sub === "hist") {
      if (!hist.length) { errl(io, "Error: release: not found"); return 1; }
      var rows4 = [["REVISION", "UPDATED", "STATUS", "CHART", "APP VERSION", "DESCRIPTION"]];
      hist.forEach(function (r) { rows4.push([r.rev, helmDate(cl, r.t), r.status, r.chart.name + "-" + r.chart.version, r.chart.appVersion, r.desc]); });
      out(io, helmTable(rows4)); return 0;
    }
    if (sub === "status") { if (!last) { errl(io, "Error: release: not found"); return 1; } printRelease(io, cl, last, last.notes); return 0; }
    if (sub === "get") {
      var w = o.pos.shift(); name = o.pos[0]; hist = relList(cl, ns, name); last = hist.filter(function (r) { return r.status === "deployed"; }).pop() || hist[hist.length - 1];
      if (!last) { errl(io, "Error: release: not found"); return 1; }
      var rr2 = o.revision ? hist.filter(function (r) { return r.rev === +o.revision; })[0] : last;
      if (w === "values") { out(io, (o.all ? "COMPUTED VALUES:\n" + KC.yaml(rr2.values) : "USER-SUPPLIED VALUES:\n" + (keys(rr2.user || {}).length ? KC.yaml(rr2.user) : "null\n"))); return 0; }
      if (w === "manifest") { out(io, rr2.objs.map(function (x) { return "---\n# Source: " + x.src + "\n" + KC.yaml(x.obj); }).join("")); return 0; }
      if (w === "notes") { out(io, "NOTES:\n" + (rr2.notes || "").replace(/^\n+/, "")); return 0; }
      errl(io, "Error: unknown command \"" + w + "\" for \"helm get\""); return 1;
    }
    if (sub === "uninstall" || sub === "delete" || sub === "un") {
      if (!last || last.status === "uninstalled") { errl(io, "Error: uninstall: Release not loaded: " + name + ": release: not found"); return 1; }
      last.objs.forEach(function (x) { var live = K.get(cl, x.obj.kind, K.KINDS[x.obj.kind].ns ? ns : null, x.obj.metadata.name); if (live) K.del(cl, live, C.sub); });
      hist.forEach(function (r) { var s = K.get(cl, "Secret", ns, "sh.helm.release.v1." + name + ".v" + r.rev); if (s) K.unstore(cl, s); });
      delete relStore(cl)[ns + "/" + name];
      out(io, "release \"" + name + "\" uninstalled\n"); return 0;
    }
    if (sub === "rollback") {
      if (!hist.length) { errl(io, "Error: release: not found"); return 1; }
      var to = o.pos[1] ? +o.pos[1] : (hist.length >= 2 ? hist[hist.length - 2].rev : 0);
      var target = hist.filter(function (r) { return r.rev === to; })[0];
      if (!target) { errl(io, "Error: release has no " + to + " version"); return 1; }
      var rel = { name: name, ns: ns, rev: hist[hist.length - 1].rev + 1, chart: target.chart, values: target.values, user: target.user, objs: target.objs, notes: target.notes, t: K.t(cl), status: "deployed", desc: "Rollback to " + to };
      var err = deployRelease(cl, C.sub, rel, last, {});
      if (err) { errl(io, "Error: " + err); return 1; }
      if (o.wait && !waitRelease(cl, rel, Dk.parseDuration(o.timeout || "5m"))) { errl(io, "Error: context deadline exceeded"); return 1; }
      storeRelease(cl, rel);
      out(io, "Rollback was a success! Happy Helming!\n"); return 0;
    }
    if (sub === "install" || sub === "upgrade") {
      var rname = o.pos[0], cref = o.pos[1];
      if (sub === "install" && o["generate-name"]) { cref = o.pos[0]; rname = "notes-" + Math.floor(Dk.stamp(cl.rt) / 1000); }
      if (!rname || !cref) { errl(io, "Error: \"helm " + sub + "\" requires 2 arguments\n\nUsage:  helm " + sub + " [NAME] [CHART] [flags]"); return 1; }
      var label = sub === "install" ? "INSTALLATION FAILED" : "UPGRADE FAILED";
      hist = relList(cl, ns, rname); last = hist.filter(function (r) { return r.status === "deployed"; }).pop();
      if (sub === "install" && hist.length && hist[hist.length - 1].status !== "uninstalled") { errl(io, "Error: INSTALLATION FAILED: cannot re-use a name that is still in use"); return 1; }
      if (sub === "upgrade" && !hist.length && !o.install) { errl(io, "Error: UPGRADE FAILED: \"" + rname + "\" has no deployed releases"); return 1; }
      if (!K.get(cl, "Namespace", null, ns)) { if (o["create-namespace"]) K.write(cl, { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } }, { mode: "create", sub: C.sub }); else { errl(io, "Error: " + label + ": create: failed to create: namespaces \"" + ns + "\" not found"); return 1; } }
      var chart = loadChart(sess, cref, o.version); if (chart.error) { errl(io, chart.error.replace("INSTALLATION FAILED", label)); return 1; }
      var base = null;
      if (sub === "upgrade" && last && o["reuse-values"]) base = deepMerge(Y.tryParse(chart.files["values.yaml"]).value || {}, last.user || {});
      var vals2 = valuesFor(sess, chart, o, io, base); if (!vals2) return 1;
      var rev = hist.length ? hist[hist.length - 1].rev + 1 : 1;
      var rd = renderChart(chart, vals2, { name: rname, ns: ns, rev: rev });
      if (rd.error) { errl(io, "Error: " + label + ": " + rd.error); return 1; }
      var rel2 = { name: rname, ns: ns, rev: rev, chart: { name: chart.name, version: chart.version, appVersion: chart.appVersion }, values: vals2, user: Object.assign(o["reuse-values"] && last ? clone(last.user) : {}, userValues(sess, chart, o, io) || {}), objs: rd.objs, notes: rd.notes, t: K.t(cl), status: "deployed", desc: rev === 1 ? "Install complete" : "Upgrade complete" };
      if (o["dry-run"]) { printRelease(io, cl, Object.assign({}, rel2, { status: "pending-" + (rev === 1 ? "install" : "upgrade") }), null); out(io, "HOOKS:\nMANIFEST:\n" + rd.objs.map(function (x) { return "---\n# Source: " + x.src + "\n" + KC.yaml(x.obj); }).join("")); return 0; }
      var err2 = deployRelease(cl, C.sub, rel2, last, {});
      if (err2) { rel2.status = "failed"; rel2.desc = (rev === 1 ? "Release \"" + rname + "\" failed: " : "Upgrade \"" + rname + "\" failed: ") + err2; storeRelease(cl, rel2); errl(io, "Error: " + label + ": " + err2); return 1; }
      if ((o.wait || o.atomic) && !waitRelease(cl, rel2, Dk.parseDuration(o.timeout || "5m"))) {
        if (o.atomic && last) { var back = { name: rname, ns: ns, rev: rev + 1, chart: last.chart, values: last.values, user: last.user, objs: last.objs, notes: last.notes, t: K.t(cl), status: "deployed", desc: "Rollback to " + last.rev }; rel2.status = "failed"; rel2.desc = "Upgrade \"" + rname + "\" failed: context deadline exceeded"; storeRelease(cl, rel2); deployRelease(cl, C.sub, back, rel2, {}); storeRelease(cl, back); errl(io, "Error: UPGRADE FAILED: release " + rname + " failed, and has been rolled back due to atomic being set: context deadline exceeded"); return 1; }
        rel2.status = "failed"; rel2.desc = (rev === 1 ? "Release \"" + rname + "\" failed: " : "Upgrade \"" + rname + "\" failed: ") + "context deadline exceeded"; storeRelease(cl, rel2);
        errl(io, "Error: " + label + ": context deadline exceeded"); return 1;
      }
      storeRelease(cl, rel2);
      if (sub === "upgrade") out(io, "Release \"" + rname + "\" " + (rev === 1 ? "does not exist. Installing it now." : "has been upgraded. Happy Helming!") + "\n");
      printRelease(io, cl, rel2, rd.notes);
      return 0;
    }
    errl(io, "Error: unknown command \"" + sub + "\" for \"helm\"\nRun 'helm --help' for usage."); return 1;
  };
  K.helmReleases = function (cl) { return relStore(cl); };

  /* ================================================================== Kyverno */
  function wild(p, v) { var re = new RegExp("^" + String(p).replace(/[.+^${}()[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"); return re.test(String(v)); }
  function valueMatch(pat, v) {
    if (typeof pat === "number" || typeof pat === "boolean") return v === pat;
    var p = String(pat);
    if (p.indexOf("|") >= 0) return p.split("|").some(function (x) { return valueMatch(x.trim(), v); });
    if (p.charAt(0) === "!") return v === undefined ? true : !valueMatch(p.slice(1), v);
    if (p === "?*") return v !== undefined && v !== null && v !== "";
    var m = /^(>=|<=|>|<)(.*)$/.exec(p); if (m) { var a = K.mem(v) || +v, b = K.mem(m[2]) || +m[2]; return m[1] === ">=" ? a >= b : m[1] === "<=" ? a <= b : m[1] === ">" ? a > b : a < b; }
    if (v === undefined || v === null) return false;
    return wild(p, typeof v === "boolean" ? String(v) : v);
  }
  // pattern match with anchors =(x) (only if present) and X(x) (must not exist). -> null or failing path
  function patternFail(pat, v, path) {
    if (isObj(pat)) {
      if (!isObj(v)) return path;
      var ks = keys(pat);
      for (var i = 0; i < ks.length; i++) {
        var k = ks[i], m = /^([=X^+]?)\((.+)\)$/.exec(k), anchor = m ? m[1] : "", key = m ? m[2] : k;
        if (anchor === "X") { if (v[key] !== undefined) return path + "/" + key + "/"; continue; }
        if (anchor === "=" && v[key] === undefined) continue;
        var f = patternFail(pat[k], v[key], path + "/" + key);
        if (f) return f;
      }
      return null;
    }
    if (Array.isArray(pat)) {
      if (!Array.isArray(v)) return v === undefined ? path + "/" : path;
      for (var j = 0; j < v.length; j++) { var f2 = patternFail(pat[0], v[j], path + "/" + j); if (f2) return f2; }
      return null;
    }
    return valueMatch(pat, v) ? null : path + "/";
  }
  function kindsOf(rule) { var m = rule.match || {}, list = []; (m.any || m.all || [m]).forEach(function (x) { var r = (x && x.resources) || {}; list = list.concat((r.kinds || []).map(function (k) { return { k: k.split("/").pop(), ns: r.namespaces, sel: r.selector }; })); }); return list; }
  function excluded(rule, obj) { var e = rule.exclude; if (!e) return false; return (e.any || e.all || [e]).some(function (x) { var r = (x && x.resources) || {}; return (!r.kinds || r.kinds.indexOf(obj.kind) >= 0) && (!r.namespaces || r.namespaces.indexOf(obj.metadata.namespace) >= 0) && (r.kinds || r.namespaces); }); }
  var POD_CTL = { Deployment: "/spec/template", StatefulSet: "/spec/template", DaemonSet: "/spec/template", ReplicaSet: "/spec/template", Job: "/spec/template", CronJob: "/spec/jobTemplate/spec/template" };
  function sigOk(cl, image, att) {
    var reg = CI.regOf(cl.rt, "ghcr.io"), hit = CI.resolveRemote(cl.rt, image);
    if (!hit) return { error: "failed to verify image " + image + ": .attestors[0].entries[0].keyless: failed to get signatures: GET https://" + image.split("/")[0] + "/v2/" + image.split("/").slice(1).join("/").replace(/[:@].*$/, "") + "/manifests/" + (image.split(":").pop()) + ": MANIFEST_UNKNOWN: manifest unknown" };
    var sigs = ((reg || {}).sigs || {})[hit.digest] || [];
    if (!sigs.length) return { error: "failed to verify image " + image + ": .attestors[0].entries[0].keyless: no signatures found" };
    var k = ((((att || [])[0] || {}).entries || [])[0] || {}).keyless || {};
    var good = sigs.some(function (s) { return (!k.subject || wild(k.subject, s.identity)) && (!k.issuer || k.issuer === s.issuer); });
    if (!good) return { error: "failed to verify image " + image + ": .attestors[0].entries[0].keyless: no matching signatures:\nsubject mismatch: expected " + k.subject + ", received " + sigs[0].identity };
    return { ok: true, digest: hit.digest };
  }
  // evaluate one policy on one object -> [{rule, ok, message, path, action}]
  K.kyvernoEval = function (cl, pol, obj) {
    var results = [];
    var action = (pol.spec.validationFailureAction || "Audit");
    (pol.spec.rules || []).forEach(function (rule) {
      var kinds = kindsOf(rule), direct = kinds.some(function (k) { return k.k === obj.kind; }), viaPod = !direct && POD_CTL[obj.kind] && kinds.some(function (k) { return k.k === "Pod"; }) && (pol.metadata.annotations || {})["pod-policies.kyverno.io/autogen-controllers"] !== "none";
      if (!direct && !viaPod) return;
      var k0 = kinds.filter(function (k) { return k.k === obj.kind || k.k === "Pod"; })[0];
      if (k0 && k0.ns && k0.ns.indexOf(obj.metadata.namespace) < 0 && !k0.ns.some(function (n) { return wild(n, obj.metadata.namespace); })) return;
      if (excluded(rule, obj)) return;
      if (/^(kube-system|kyverno|ingress-nginx|cert-manager|argocd)$/.test(obj.metadata.namespace || "")) return;
      var target = obj, base = "", rname = rule.name;
      if (viaPod) { var tp = POD_CTL[obj.kind].split("/").slice(1); target = obj; tp.forEach(function (p) { target = target && target[p]; }); base = POD_CTL[obj.kind]; rname = (obj.kind === "CronJob" ? "autogen-cronjob-" : "autogen-") + rule.name; }
      var act = (rule.validate && rule.validate.failureAction) || action;
      if (rule.validate) {
        var v = rule.validate, fail = null;
        if (v.pattern) { var f = patternFail(v.pattern, target, ""); if (f) fail = base + f; }
        else if (v.anyPattern) { var fs2 = v.anyPattern.map(function (p) { return patternFail(p, target, ""); }); if (fs2.every(Boolean)) fail = base + fs2[0]; }
        else if (v.deny) { fail = null; }
        results.push({ policy: pol.metadata.name, rule: rname, ok: !fail, message: fail ? "validation error: " + (v.message || "") + " rule " + rname + " failed at path " + fail : "validation rule '" + rname + "' passed.", action: act });
      }
      (rule.verifyImages || []).forEach(function (vi) {
        var specs = viaPod ? [target.spec] : obj.kind === "Pod" ? [obj.spec] : [];
        specs.forEach(function (sp) { (sp.containers || []).concat(sp.initContainers || []).forEach(function (c) {
          if (!(vi.imageReferences || []).some(function (ir) { return wild(ir, c.image); })) return;
          var r = sigOk(cl, c.image, vi.attestors);
          results.push({ policy: pol.metadata.name, rule: rname, ok: !!r.ok, message: r.ok ? "verified image signatures for " + c.image : r.error, action: (vi.failureAction || act), image: true });
        }); });
      });
    });
    return results;
  };
  function policies(cl, ns) { return K.all(cl, "ClusterPolicy").concat(ns ? K.list(cl, "Policy", ns) : []); }
  K.onBootstrap = K.onBootstrap || [];
  K.onBootstrap.push(function (cl) {
    if (!cl.comps.kyverno) return;
    cl.hooks.push(function (cl2, obj, op) {
      if (!/^(Pod|Deployment|StatefulSet|DaemonSet|ReplicaSet|Job|CronJob)$/.test(obj.kind) && !policies(cl2, obj.metadata.namespace).some(function (p) { return (p.spec.rules || []).some(function (r) { return kindsOf(r).some(function (k) { return k.k === obj.kind; }); }); })) return null;
      if (obj.kind === "ReplicaSet" && (obj.metadata.ownerReferences || []).length) return null;
      if (obj.kind === "Pod" && (obj.metadata.ownerReferences || []).length) {
        // pods made by controllers were already checked through autogen rules on their owner
        var own = obj.metadata.ownerReferences[0].kind;
        if (own === "ReplicaSet" || own === "StatefulSet" || own === "Job" || own === "DaemonSet") return null;
      }
      var fails = {};
      policies(cl2, obj.metadata.namespace).forEach(function (pol) { if ((pol.status || {}).ready === false) return; K.kyvernoEval(cl2, pol, obj).forEach(function (r) { if (!r.ok && /^enforce$/i.test(r.action)) (fails[pol.metadata.name] = fails[pol.metadata.name] || []).push(r); }); });
      var names = keys(fails);
      if (!names.length) return null;
      var msg = "admission webhook \"" + (fails[names[0]].some(function (r) { return r.image; }) ? "mutate.kyverno.svc-fail" : "validate.kyverno.svc-fail") + "\" denied the request: \n\nresource " + obj.kind + "/" + (obj.metadata.namespace || "") + "/" + obj.metadata.name + " was blocked due to the following policies \n\n" + names.map(function (n) { return n + ":\n" + fails[n].map(function (r) { return "  " + r.rule + ": '" + r.message.replace(/'/g, "''") + "'"; }).join("\n"); }).join("\n") + "\n";
      void op;
      return { deny: msg };
    });
  });
  // policy readiness and background reports (Audit and Enforce both report on existing resources)
  K.ctlHooks.push(function (cl) {
    if (!cl.comps.kyverno) return;
    var r = cl.kyv = cl.kyv || {};
    K.all(cl, "ClusterPolicy").concat(K.all(cl, "Policy")).forEach(function (p) { if (!p.status || !p.status.conditions) { p.status = { ready: true, conditions: [{ type: "Ready", status: "True", reason: "Succeeded", message: "Ready" }], rulecount: { validate: (p.spec.rules || []).filter(function (x) { return x.validate; }).length, generate: 0, mutate: 0, verifyimages: (p.spec.rules || []).filter(function (x) { return x.verifyImages; }).length } }; } });
    if (r.at != null && K.t(cl) - r.at < 10) return;
    r.at = K.t(cl);
    var reports = {};
    ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job", "Pod"].forEach(function (kind) {
      K.all(cl, kind).forEach(function (obj) {
        if (kind === "Pod" && (obj.metadata.ownerReferences || []).length) return;
        if (kind === "Job" && (obj.metadata.ownerReferences || []).length) return;
        var res = [];
        policies(cl, obj.metadata.namespace).forEach(function (pol) { if (pol.spec.background === false) return; K.kyvernoEval(cl, pol, obj).forEach(function (x) { res.push(x); }); });
        if (!res.length) return;
        reports[obj.metadata.uid] = { obj: obj, res: res };
      });
    });
    K.all(cl, "PolicyReport").forEach(function (p) { if (!reports[p.metadata.name]) K.unstore(cl, p); });
    keys(reports).forEach(function (uid) {
      var x = reports[uid], o = x.obj, res = x.res, sum = { pass: 0, fail: 0, warn: 0, error: 0, skip: 0 };
      res.forEach(function (q) { if (q.ok) sum.pass++; else sum.fail++; });
      var old = K.get(cl, "PolicyReport", o.metadata.namespace, uid);
      var pr = { apiVersion: "wgpolicyk8s.io/v1alpha2", kind: "PolicyReport", metadata: { name: uid, namespace: o.metadata.namespace, labels: { "app.kubernetes.io/managed-by": "kyverno" }, ownerReferences: [K.ownerRef(o, false)], creationTimestamp: old ? old.metadata.creationTimestamp : K.t(cl) }, scope: { apiVersion: o.apiVersion, kind: o.kind, name: o.metadata.name, namespace: o.metadata.namespace, uid: uid }, results: res.map(function (q) { return { category: "Kestrel", message: q.message, policy: q.policy, result: q.ok ? "pass" : "fail", rule: q.rule, scored: true, severity: "medium", source: "kyverno", timestamp: { nanos: 0, seconds: Math.floor(Dk.stamp(cl.rt) / 1000) } }; }), summary: sum };
      if (!old || JSON.stringify(old.results.map(function (q) { return q.rule + q.result; })) !== JSON.stringify(pr.results.map(function (q) { return q.rule + q.result; }))) K.store(cl, pr, { quiet: true });
    });
  });
  K.printers = K.printers || {};
  K.printers.ClusterPolicy = K.printers.Policy = { h: ["NAME", "ADMISSION", "BACKGROUND", "READY", "AGE", "MESSAGE"], row: function (cl, p) { return [p.metadata.name, "true", p.spec.background === false ? "false" : "true", "True", K.age(cl, p.metadata.creationTimestamp), "Ready"]; } };
  K.printers.PolicyReport = { h: ["NAME", "KIND", "NAME", "PASS", "FAIL", "WARN", "ERROR", "SKIP", "AGE"], row: function (cl, p) { var s = p.summary || {}; return [p.metadata.name, p.scope.kind, p.scope.name, s.pass || 0, s.fail || 0, s.warn || 0, s.error || 0, s.skip || 0, K.age(cl, p.metadata.creationTimestamp)]; } };
  K.describers = K.describers || {};

  /* ================================================================== trivy k8s */
  var trivyPrev = S.CMDS.trivy;
  S.CMDS.trivy = function (args, io, sess) {
    if (args[1] !== "k8s" && args[1] !== "kubernetes") return trivyPrev ? trivyPrev(args, io, sess) : 1;
    var o = KC.parse(args.slice(2));
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, nsOnly = o["include-namespaces"] ? String(o["include-namespaces"]).split(",") : null;
    var wl = [];
    ["Deployment", "StatefulSet", "DaemonSet", "CronJob"].forEach(function (k) { K.all(cl, k).forEach(function (x) { if (/^(kube-system|ingress-nginx|cert-manager|kyverno|argocd)$/.test(x.metadata.namespace) && !nsOnly) return; if (nsOnly && nsOnly.indexOf(x.metadata.namespace) < 0) return; wl.push(x); }); });
    out(io, "2026-11-23T10:02:11Z\tINFO\tNode scanning is enabled\n2026-11-23T10:02:12Z\tINFO\tScanning K8s...\t{\"K8s\":\"kestrel-staging\"}\n");
    var rows = [];
    wl.forEach(function (x) {
      var sp = K.podSpecs(x)[0], vc = { C: 0, H: 0, M: 0, L: 0, U: 0 }, mc = { C: 0, H: 0, M: 0, L: 0, U: 0 };
      (sp.containers || []).forEach(function (c) {
        var hit = CI.resolveRemote(cl.rt, c.image);
        if (hit && Dk.trivyVulns) { var pk = Dk.trivyPackages(Dk.merge(hit.img.layers)), vv = Dk.trivyVulns(pk, {}); vv.os.concat(vv.py).forEach(function (v) { vc[v.sev.charAt(0)]++; }); }
        var sc2 = Object.assign({}, sp.securityContext || {}, c.securityContext || {});
        if (!sc2.runAsNonRoot) mc.M++; if (sc2.allowPrivilegeEscalation !== false) mc.M++; if (!sc2.readOnlyRootFilesystem) mc.H++; if (!((sc2.capabilities || {}).drop || []).length) mc.L++; if (!((c.resources || {}).limits || {}).memory) mc.L++; if (!((c.resources || {}).limits || {}).cpu) mc.L++; if (sc2.privileged) mc.H++; if (!sc2.seccompProfile) mc.L++;
        if (/:latest$|^[^:]+$/.test(c.image)) mc.M++;
      });
      rows.push([x.metadata.namespace, x.kind + "/" + x.metadata.name, vc, mc]);
    });
    function cell(n) { return n ? String(n) : ""; }
    var lines = ["", "Summary Report for kestrel-staging", "", "", "Workload Assessment", "┌─────────────┬─────────────────────────────────┬───────────────────┬───────────────────┬───────────────────┐", "│  Namespace  │            Resource             │  Vulnerabilities  │ Misconfigurations │      Secrets      │", "│             │                                 ├───┬───┬───┬───┬───┼───┬───┬───┬───┬───┼───┬───┬───┬───┬───┤", "│             │                                 │ C │ H │ M │ L │ U │ C │ H │ M │ L │ U │ C │ H │ M │ L │ U │", "├─────────────┼─────────────────────────────────┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤"];
    function padc(s, w) { s = String(s); return s.length >= w ? s.slice(0, w) : s + new Array(w - s.length + 1).join(" "); }
    function num(s) { s = String(s); return s.length >= 3 ? s.slice(0, 3) : (s.length === 1 ? " " + s + " " : s + " "); }
    rows.forEach(function (r) { lines.push("│ " + padc(r[0], 11) + " │ " + padc(r[1], 31) + " │" + ["C", "H", "M", "L", "U"].map(function (k) { return num(cell(r[2][k])); }).join("│") + "│" + ["C", "H", "M", "L", "U"].map(function (k) { return num(cell(r[3][k])); }).join("│") + "│   │   │   │   │   │"); });
    lines.push("└─────────────┴─────────────────────────────────┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘", "Severities: C=CRITICAL H=HIGH M=MEDIUM L=LOW U=UNKNOWN", "");
    out(io, lines.join("\n"));
    (cl.trivyRuns = cl.trivyRuns || []).push({ t: K.t(cl), cmd: CI.homeSys(sess.sys).cmdIndex, rows: rows.map(function (r) { return { ns: r[0], res: r[1], vulns: r[2], mis: r[3] }; }) });
    return 0;
  };

  /* ================================================================== Argo CD */
  function appRepo(cl, app) { var url = String((app.spec.source || {}).repoURL || ""), m = /github\.com[/:]([\w-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url); return m ? m[1] : null; }
  function appRevision(cl, app) {
    var full = appRepo(cl, app); if (!full) return null;
    var r = GH.find(cl.home, full); if (!r) return null;
    var tr = (app.spec.source || {}).targetRevision || "HEAD", ref = tr === "HEAD" ? r.refs["refs/heads/" + (r.defaultBranch || "main")] || r.refs["refs/heads/main"] : r.refs["refs/heads/" + tr] || r.refs["refs/tags/" + tr];
    return ref || null;
  }
  // desired objects for an Application -> {objs, sha} or {error}
  K.appDesired = function (cl, app) {
    var sha = appRevision(cl, app);
    if (!sha) return { error: "rpc error: code = Unknown desc = authentication required: Repository not found." };
    var fs = K.fsOfCommit(cl.home, sha), path = "/" + String(app.spec.source.path || ".").replace(/^\.?\/?/, "").replace(/\/$/, "");
    if (!fs.isDir(path)) return { error: "rpc error: code = Unknown desc = " + app.spec.source.path + ": app path does not exist", sha: sha };
    var docs;
    if (fs.read(path + "/kustomization.yaml") != null || fs.read(path + "/kustomization.yml") != null) { var kz = K.kustomizeFs(fs, path); if (kz.error) return { error: "rpc error: code = Unknown desc = `kustomize build " + path + "` failed exit status 1: " + kz.error, sha: sha }; docs = kz.docs; }
    else {
      docs = [];
      var files = [];
      (function walk(d, deep) { fs.list(d).forEach(function (n) { var p = d.replace(/\/$/, "") + "/" + n; if (fs.isDir(p)) { if (deep) walk(p, deep); } else if (/\.(ya?ml|json)$/.test(n)) files.push(p); }); })(path, !!((app.spec.source || {}).directory || {}).recurse);
      for (var i = 0; i < files.length; i++) { var pd = KC.parseDocs(fs.read(files[i]), files[i]); if (pd.error) return { error: "rpc error: code = Unknown desc = Manifest generation error (cached): " + pd.error, sha: sha }; docs = docs.concat(pd.docs); }
    }
    var ns = (app.spec.destination || {}).namespace || "default";
    docs.forEach(function (d) { var info = K.KINDS[d.obj.kind]; if (info && info.ns && !d.obj.metadata.namespace) d.obj.metadata.namespace = ns; d.obj.metadata.labels = Object.assign({}, d.obj.metadata.labels || {}, { "app.kubernetes.io/instance": app.metadata.name }); });
    return { objs: docs.map(function (d) { return d.obj; }), sha: sha };
  };
  // does live contain everything desired says? (Argo compares the fields you set)
  function subset(want, have) {
    if (isObj(want)) { if (!isObj(have)) return false; return keys(want).every(function (k) { if (k === "status") return true; if (k === "annotations" && want[k] && have && !have[k]) return false; return subset(want[k], have[k]); }); }
    if (Array.isArray(want)) { if (!Array.isArray(have) || have.length !== want.length) return false; return want.every(function (w, i) { return subset(w, have[i]); }); }
    if (want === null || want === undefined) return true;
    return String(want) === String(have);
  }
  function resState(cl, app, obj) {
    var info = K.KINDS[obj.kind], live = info ? K.get(cl, obj.kind, info.ns ? obj.metadata.namespace : null, obj.metadata.name) : null;
    var want = clone(obj); delete want.status;
    var liveCmp = live ? KC.wire(cl, live) : null;
    if (liveCmp && want.metadata) { delete want.metadata.namespace; }
    var synced = !!live && subset(want.spec || {}, liveCmp.spec || {}) && subset(want.data || {}, liveCmp.data || {}) && subset((want.metadata || {}).labels || {}, liveCmp.metadata.labels || {}) && (!want.rules || subset(want.rules, liveCmp.rules)) && (!want.subjects || subset(want.subjects, liveCmp.subjects));
    var health = "Healthy", hmsg = "";
    if (!live) health = "Missing";
    else if (obj.kind === "Deployment") { if (K.deployFailed(live)) { health = "Degraded"; hmsg = "Deployment \"" + live.metadata.name + "\" exceeded its progress deadline"; } else if (!K.deployDone(cl, live)) { health = "Progressing"; hmsg = "Waiting for rollout to finish: " + ((live.status || {}).updatedReplicas || 0) + " of " + live.spec.replicas + " updated replicas are available..."; } }
    else if (obj.kind === "StatefulSet") { if (((live.status || {}).readyReplicas || 0) < live.spec.replicas) health = "Progressing"; }
    else if (obj.kind === "Ingress") { if (!((live.status || {}).loadBalancer || {}).ingress) health = "Progressing"; }
    else if (obj.kind === "PersistentVolumeClaim") { if ((live.status || {}).phase !== "Bound") health = "Progressing"; }
    else if (obj.kind === "Service" && obj.spec && obj.spec.type === "LoadBalancer") { if (!((live.status || {}).loadBalancer || {}).ingress) health = "Progressing"; }
    return { kind: obj.kind, group: info ? info.group : "", ns: info && info.ns ? obj.metadata.namespace : "", name: obj.metadata.name, status: synced ? "Synced" : "OutOfSync", health: /^(ConfigMap|Secret|ServiceAccount|Role|RoleBinding|ClusterRole|ClusterRoleBinding|NetworkPolicy|HorizontalPodAutoscaler)$/.test(obj.kind) ? null : health, hmsg: hmsg, live: live };
  }
  K.appSync = function (cl, app, o) {
    o = o || {};
    var d = K.appDesired(cl, app);
    if (d.error) return { error: d.error };
    var ns = (app.spec.destination || {}).namespace;
    var opts = (app.spec.syncPolicy || {}).syncOptions || [];
    if (ns && !K.get(cl, "Namespace", null, ns)) { if (opts.indexOf("CreateNamespace=true") >= 0) K.write(cl, { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } }, { mode: "apply" }); else return { error: "one or more synchronization tasks are not valid: namespaces \"" + ns + "\" not found" }; }
    var results = [], failed = null;
    d.objs.forEach(function (obj) {
      var before = resState(cl, app, obj);
      var r = K.write(cl, obj, { ns: ns, mode: "apply", sub: { user: "system:serviceaccount:argocd:argocd-application-controller", groups: ["system:masters"] }, source: app.metadata.name });
      if (r.error) { failed = failed || r.error.replace(/^Error from server[^:]*: error when [a-z ]+"[^"]*": /, ""); results.push({ obj: obj, msg: r.error, failed: true }); return; }
      results.push({ obj: obj, msg: KC.ref(r.info, obj.metadata.name) + " " + (r.action === "created" ? "created" : r.action === "unchanged" ? "unchanged" : "configured"), changed: before.status !== "Synced" });
    });
    var pruned = [];
    var prune = o.prune || ((app.spec.syncPolicy || {}).automated || {}).prune;
    managed(cl, app).forEach(function (live) { if (d.objs.some(function (x) { return x.kind === live.kind && x.metadata.name === live.metadata.name; })) return; if (prune) { K.del(cl, live, null); pruned.push(live); } });
    var st = app.status = app.status || {};
    var hist = st.history = st.history || [];
    if (!failed) hist.push({ id: hist.length, revision: d.sha, deployedAt: K.t(cl), source: clone(app.spec.source) });
    st.operationState = { phase: failed ? "Failed" : "Succeeded", message: failed ? "one or more objects failed to apply, reason: " + failed : "successfully synced (all tasks run)", startedAt: K.t(cl), finishedAt: K.t(cl), syncResult: { revision: d.sha, resources: results.map(function (x) { return { kind: x.obj.kind, name: x.obj.metadata.name, namespace: x.obj.metadata.namespace, message: x.msg, status: x.failed ? "SyncFailed" : "Synced" }; }) } };
    app._rt = app._rt || {}; app._rt.lastSync = K.t(cl); app._rt.results = results; app._rt.pruned = pruned;
    K.event(cl, app, failed ? "Warning" : "Normal", failed ? "OperationCompleted" : "OperationCompleted", "Sync operation to " + d.sha.slice(0, 7) + " " + (failed ? "failed" : "succeeded"), "argocd-application-controller");
    appStatus(cl, app);
    return { results: results, pruned: pruned, failed: failed, sha: d.sha };
  };
  function managed(cl, app) {
    var out2 = [];
    ["Deployment", "Service", "ConfigMap", "Secret", "Ingress", "StatefulSet", "HorizontalPodAutoscaler", "NetworkPolicy", "ServiceAccount", "Role", "RoleBinding", "CronJob", "Job", "PersistentVolumeClaim"].forEach(function (k) { K.all(cl, k).forEach(function (x) { if ((x.metadata.labels || {})["app.kubernetes.io/instance"] === app.metadata.name) out2.push(x); }); });
    return out2;
  }
  function appStatus(cl, app) {
    var d = K.appDesired(cl, app), st = app.status = app.status || {};
    if (d.error) { st.sync = { status: "Unknown", revision: d.sha || "" }; st.health = { status: "Healthy" }; st.conditions = [{ type: "ComparisonError", message: d.error }]; st.resources = []; return st; }
    var res = d.objs.map(function (o) { return resState(cl, app, o); });
    var extra = managed(cl, app).filter(function (live) { return !d.objs.some(function (x) { return x.kind === live.kind && x.metadata.name === live.metadata.name; }); }).map(function (live) { return { kind: live.kind, group: K.KINDS[live.kind].group, ns: live.metadata.namespace, name: live.metadata.name, status: "OutOfSync", health: null, extra: true, requiresPruning: true }; });
    res = res.concat(extra);
    var sync = res.every(function (r) { return r.status === "Synced"; }) ? "Synced" : "OutOfSync";
    var hs = res.map(function (r) { return r.health; }).filter(Boolean), health = hs.indexOf("Degraded") >= 0 ? "Degraded" : hs.indexOf("Missing") >= 0 ? "Missing" : hs.indexOf("Progressing") >= 0 ? "Progressing" : "Healthy";
    st.sync = { status: sync, revision: d.sha, comparedTo: { source: clone(app.spec.source), destination: clone(app.spec.destination) } };
    st.health = { status: health };
    st.resources = res.map(function (r) { return { group: r.group || undefined, kind: r.kind, namespace: r.ns || undefined, name: r.name, status: r.status, health: r.health ? { status: r.health, message: r.hmsg || undefined } : undefined, requiresPruning: r.requiresPruning || undefined }; });
    st.conditions = undefined;
    st.reconciledAt = K.t(cl);
    return st;
  }
  K.appStatus = appStatus;
  // the application controller: compare, and sync automated apps (on new commits, or on drift with selfHeal)
  K.ctlHooks.push(function (cl, o) {
    if (!cl.comps.argocd || o.boot) return;
    K.list(cl, "Application", "argocd").forEach(function (app) {
      var r = app._rt = app._rt || {};
      if (r.checked != null && K.t(cl) - r.checked < 3) return;
      r.checked = K.t(cl);
      var st = appStatus(cl, app), auto = (app.spec.syncPolicy || {}).automated;
      if (!auto || st.sync.status !== "OutOfSync" || !st.sync.revision) return;
      var newRev = st.sync.revision !== r.syncedRev;
      if (newRev || auto.selfHeal) { if (!newRev && r.lastSync != null && K.t(cl) - r.lastSync < 5) return; var res = K.appSync(cl, app, {}); if (!res.error) r.syncedRev = res.sha; }
    });
  });
  K.printers.Application = { h: ["NAME", "SYNC STATUS", "HEALTH STATUS"], row: function (cl, a) { var s = a.status || {}; return [a.metadata.name, (s.sync || {}).status || "Unknown", (s.health || {}).status || "Unknown"]; } };
  function argoTable(rows) { var w = []; rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); }); return rows.map(function (r) { return r.map(function (c, i) { c = String(c); return i < r.length - 1 ? c + new Array(w[i] - c.length + 3).join(" ") : c; }).join("").replace(/\s+$/, ""); }).join("\n") + "\n"; }
  S.CMDS.argocd = function (args, io, sess) {
    var a = args.slice(1), o = KC.parse(a), sub = o.pos.shift();
    if (sub === "version") { out(io, "argocd: v2.13.2+dc43124\n  BuildDate: 2024-12-11T18:37:15Z\n  GitCommit: dc43124058130db9a747d141d86d7c2f4aac7bf9\n  GitTreeState: clean\n  GoVersion: go1.22.9\n  Compiler: gc\n  Platform: linux/amd64\nargocd-server: v2.13.2+dc43124\n"); return 0; }
    var cl = K.of(sess.sys);
    var cfg = KC.readF(sess, sess.home + "/.config/argocd/config");
    if (sub === "login") { if (!cl || !cl.comps.argocd) { errl(io, "FATA[0005] dial tcp: lookup argocd.staging.kestrel.dev: no such host"); return 1; } if (cfg) { out(io, "'admin:login' logged in successfully\nContext 'argocd.staging.kestrel.dev' updated\n"); return 0; } errl(io, "FATA[0000] rpc error: code = Unauthenticated desc = Invalid username or password"); return 20; }
    if (!cl || !cl.comps.argocd || !cfg) { errl(io, "FATA[0000] Argo CD server address unspecified"); return 20; }
    K.touch(cl, 1);
    if (sub === "cluster" && o.pos[0] === "list") { out(io, argoTable([["SERVER", "NAME", "VERSION", "STATUS", "MESSAGE", "PROJECT"], ["https://kubernetes.default.svc", "in-cluster", "1.31", "Successful", "", ""]])); return 0; }
    if (sub === "repo" && o.pos[0] === "list") { var rr = [["TYPE", "NAME", "REPO", "INSECURE", "OCI", "LFS", "CREDS", "STATUS", "MESSAGE", "PROJECT"]]; (cl.argoRepos || []).forEach(function (u) { rr.push(["git", "", u, "false", "false", "false", "true", "Successful", "", ""]); }); out(io, argoTable(rr)); return 0; }
    if (sub !== "app") { errl(io, "Error: unknown command \"" + (sub || "") + "\" for \"argocd\""); return 1; }
    var cmd = o.pos.shift(), name = o.pos[0];
    function find(n) { return K.get(cl, "Application", "argocd", String(n || "").replace(/^argocd\//, "")); }
    if (cmd === "list") {
      var rows = [["NAME", "CLUSTER", "NAMESPACE", "PROJECT", "STATUS", "HEALTH", "SYNCPOLICY", "CONDITIONS", "REPO", "PATH", "TARGET"]];
      K.list(cl, "Application", "argocd").forEach(function (x) { var s = appStatus(cl, x); rows.push(["argocd/" + x.metadata.name, x.spec.destination.server || "https://kubernetes.default.svc", x.spec.destination.namespace, x.spec.project || "default", s.sync.status, s.health.status, (x.spec.syncPolicy || {}).automated ? "Auto" + ((x.spec.syncPolicy.automated.prune) ? "-Prune" : "") : "Manual", s.conditions ? s.conditions[0].type : "<none>", x.spec.source.repoURL, x.spec.source.path, x.spec.source.targetRevision || "HEAD"]); });
      out(io, argoTable(rows)); return 0;
    }
    if (cmd === "create") {
      if (!name) { errl(io, "FATA[0000] rpc error: code = InvalidArgument desc = application spec for  is invalid: InvalidSpecError: Application name is empty"); return 1; }
      var app = { apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: name, namespace: "argocd" }, spec: { project: o.project || "default", source: { repoURL: o.repo, path: o.path, targetRevision: o.revision || "HEAD" }, destination: { server: o["dest-server"] || "https://kubernetes.default.svc", namespace: o["dest-namespace"] } } };
      if (o["sync-policy"] === "automated" || o["sync-policy"] === "auto") { app.spec.syncPolicy = { automated: { prune: !!o["auto-prune"], selfHeal: !!o["self-heal"] } }; }
      if (o["sync-options"] || o["sync-option"]) { app.spec.syncPolicy = app.spec.syncPolicy || {}; app.spec.syncPolicy.syncOptions = [].concat(o["sync-option"] || o["sync-options"]); }
      if (!o.repo || !o.path) { errl(io, "FATA[0000] rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: spec.source.repoURL and either source.path, source.chart, or source.ref are required"); return 1; }
      if (!appRepo(cl, app) || !GH.find(cl.home, appRepo(cl, app))) { errl(io, "FATA[0001] rpc error: code = InvalidArgument desc = application spec for " + name + " is invalid: InvalidSpecError: repository not accessible: repositories not accessible: &Repository{Repo: \"" + o.repo + "\", Type: \"\", Name: \"\", Project: \"\"}: repo client error while testing repository: rpc error: code = Unknown desc = authentication required: Repository not found."); return 20; }
      var r0 = K.write(cl, app, { ns: "argocd", mode: "create", source: "argocd" });
      if (r0.error) { errl(io, "FATA[0000] rpc error: code = InvalidArgument desc = existing application spec is different, use upsert flag to force update"); return 20; }
      out(io, "application '" + name + "' created\n"); return 0;
    }
    var appx = find(name);
    if (!appx) { errl(io, "FATA[0000] rpc error: code = NotFound desc = applications.argoproj.io \"" + String(name || "").replace(/^argocd\//, "") + "\" not found"); return 20; }
    if (cmd === "get") {
      if (o.refresh || o["hard-refresh"]) appx._rt = {};
      var s = appStatus(cl, appx), sp = appx.spec, auto = (sp.syncPolicy || {}).automated;
      var t = "Name:               argocd/" + appx.metadata.name + "\nProject:            " + (sp.project || "default") + "\nServer:             " + sp.destination.server + "\nNamespace:          " + sp.destination.namespace + "\nURL:                https://argocd.staging.kestrel.dev/applications/" + appx.metadata.name + "\nSource:\n- Repo:             " + sp.source.repoURL + "\n  Target:           " + (sp.source.targetRevision || "HEAD") + "\n  Path:             " + sp.source.path + "\nSyncWindow:         Sync Allowed\nSync Policy:        " + (auto ? "Automated" + (auto.prune ? " (Prune)" : "") : "Manual") + "\nSync Status:        " + s.sync.status + " to " + (sp.source.targetRevision || "HEAD") + (s.sync.revision ? " (" + s.sync.revision.slice(0, 7) + ")" : "") + "\nHealth Status:      " + s.health.status + "\n";
      if (s.conditions) t += "\nCONDITION        MESSAGE                                                          LAST TRANSITION\n" + s.conditions[0].type + "  " + s.conditions[0].message + "  " + KC.age(cl, K.t(cl) - 30) + "\n";
      var os = appx.status.operationState;
      if (os) t += "\nOperation:          Sync\nSync Revision:      " + os.syncResult.revision + "\nPhase:              " + os.phase + "\nStart:              " + K.stamp(cl, os.startedAt).replace("T", " ").replace("Z", " +0000 UTC") + "\nFinished:           " + K.stamp(cl, os.finishedAt).replace("T", " ").replace("Z", " +0000 UTC") + "\nDuration:           1s\nMessage:            " + os.message + "\n";
      var rows2 = [["GROUP", "KIND", "NAMESPACE", "NAME", "STATUS", "HEALTH", "HOOK", "MESSAGE"]];
      (s.resources || []).forEach(function (r) { var res = ((appx._rt || {}).results || []).filter(function (x) { return x.obj.kind === r.kind && x.obj.metadata.name === r.name; })[0]; rows2.push([r.group || "", r.kind, r.namespace || "", r.name, r.status + (r.requiresPruning ? "" : ""), (r.health || {}).status || "", "", res ? res.msg : (r.requiresPruning ? "ignored (requires pruning)" : "")]); });
      out(io, t + "\n" + argoTable(rows2)); return 0;
    }
    if (cmd === "sync") {
      var res2 = K.appSync(cl, appx, { prune: !!o.prune });
      if (res2.error) { errl(io, "FATA[0000] rpc error: code = FailedPrecondition desc = " + res2.error); return 20; }
      K.advance(cl, 20, function () { return appStatus(cl, appx).health.status !== "Progressing"; });
      (appx._rt = appx._rt || {}).syncedRev = res2.sha;
      var s2 = appStatus(cl, appx);
      var rows3 = [["TIMESTAMP", "GROUP", "KIND", "NAMESPACE", "NAME", "STATUS", "HEALTH", "HOOK", "MESSAGE"]];
      res2.results.forEach(function (x) { var info = K.KINDS[x.obj.kind]; var rs = (s2.resources || []).filter(function (q) { return q.kind === x.obj.kind && q.name === x.obj.metadata.name; })[0] || {}; rows3.push([K.stamp(cl).replace(/\.\d+Z$/, "Z"), info ? info.group : "", x.obj.kind, x.obj.metadata.namespace || "", x.obj.metadata.name, x.failed ? "SyncFailed" : (rs.status || "Synced"), (rs.health || {}).status || "", "", x.msg]); });
      res2.pruned.forEach(function (x) { rows3.push([K.stamp(cl).replace(/\.\d+Z$/, "Z"), K.KINDS[x.kind].group, x.kind, x.metadata.namespace, x.metadata.name, "Succeeded", "", "", "pruned"]); });
      out(io, argoTable(rows3) + "\nName:               argocd/" + appx.metadata.name + "\nProject:            " + (appx.spec.project || "default") + "\nServer:             " + appx.spec.destination.server + "\nNamespace:          " + appx.spec.destination.namespace + "\nSync Status:        " + s2.sync.status + " to " + (appx.spec.source.targetRevision || "HEAD") + " (" + res2.sha.slice(0, 7) + ")\nHealth Status:      " + s2.health.status + "\n\nOperation:          Sync\nSync Revision:      " + res2.sha + "\nPhase:              " + (res2.failed ? "Failed" : "Succeeded") + "\nMessage:            " + appx.status.operationState.message + "\n");
      return res2.failed ? 20 : 0;
    }
    if (cmd === "diff") {
      var d = K.appDesired(cl, appx); if (d.error) { errl(io, "FATA[0000] " + d.error); return 20; }
      var any = false;
      d.objs.forEach(function (obj) {
        var rs = resState(cl, appx, obj); if (rs.status === "Synced") return; any = true;
        var info = K.KINDS[obj.kind];
        out(io, "\n===== " + (info.group ? info.group + "/" : "/") + obj.kind + " " + (obj.metadata.namespace || "") + "/" + obj.metadata.name + " ======\n");
        var live = rs.live ? KC.wire(cl, rs.live) : null; if (live) { delete live.status; delete live.metadata.managedFields; }
        var want = clone(obj);
        var a1 = live ? KC.yaml({ spec: live.spec, data: live.data }) : "", b1 = KC.yaml({ spec: want.spec, data: want.data });
        var ub = G.unifiedBody(a1, b1, 2); out(io, (ub.lines || ub).map(function (l) { return typeof l === "string" ? l : l.t; }).filter(function (l) { return !/^(---|\+\+\+)/.test(l); }).map(function (l) { return l.replace(/^@@.*@@$/, "").replace(/^-/, "< ").replace(/^\+/, "> ").replace(/^ /, "  "); }).filter(Boolean).join("\n") + "\n");
      });
      managed(cl, appx).forEach(function (live) { if (d.objs.some(function (x) { return x.kind === live.kind && x.metadata.name === live.metadata.name; })) return; any = true; out(io, "\n===== " + (K.KINDS[live.kind].group ? K.KINDS[live.kind].group + "/" : "/") + live.kind + " " + live.metadata.namespace + "/" + live.metadata.name + " ======\n(requires pruning)\n"); });
      return any ? 1 : 0;
    }
    if (cmd === "history") { var rows4 = [["SOURCE", appx.spec.source.repoURL]]; void rows4; var h = ((appx.status || {}).history || []); var r5 = [["ID", "DATE", "REVISION"]]; h.forEach(function (x) { r5.push([x.id, K.stamp(cl, x.deployedAt).replace("T", " ").replace("Z", " +0000 UTC"), (x.source.targetRevision || "HEAD") + " (" + x.revision.slice(0, 7) + ")"]); }); out(io, "SOURCE  " + appx.spec.source.repoURL + "\n" + argoTable(r5)); return 0; }
    if (cmd === "rollback") {
      if ((appx.spec.syncPolicy || {}).automated) { errl(io, "FATA[0000] rpc error: code = FailedPrecondition desc = rollback cannot be initiated when auto-sync is enabled"); return 20; }
      var hh = (appx.status || {}).history || [], id = o.pos[1] != null ? +o.pos[1] : hh.length - 2, tgt = hh.filter(function (x) { return x.id === id; })[0];
      if (!tgt) { errl(io, "FATA[0000] application " + appx.metadata.name + " does not have deployment id '" + id + "' in history"); return 20; }
      var app2 = clone(appx); app2.spec.source = Object.assign({}, app2.spec.source, { targetRevision: tgt.revision }); app2._rt = appx._rt;
      var r6 = K.appSync(cl, app2, {}); appx.status = app2.status;
      out(io, "Application '" + appx.metadata.name + "' rolled back to '" + id + "'\n" + (r6.error ? "" : ""));
      return 0;
    }
    if (cmd === "set") {
      var x = clone(appx);
      if (o["sync-policy"]) { if (/^(none|manual)$/.test(o["sync-policy"])) { if (x.spec.syncPolicy) delete x.spec.syncPolicy.automated; } else { x.spec.syncPolicy = x.spec.syncPolicy || {}; x.spec.syncPolicy.automated = x.spec.syncPolicy.automated || {}; } }
      if (o["self-heal"] && x.spec.syncPolicy && x.spec.syncPolicy.automated) x.spec.syncPolicy.automated.selfHeal = true;
      if (o["auto-prune"] && x.spec.syncPolicy && x.spec.syncPolicy.automated) x.spec.syncPolicy.automated.prune = true;
      if (o.revision) x.spec.source.targetRevision = o.revision; if (o.path) x.spec.source.path = o.path;
      x._rt = appx._rt; K.update(cl, x, null); return 0;
    }
    if (cmd === "delete") { K.del(cl, appx, null); out(io, "application '" + appx.metadata.name + "' deleted\n"); return 0; }
    if (cmd === "wait") { var ok = K.advance(cl, 120, function () { var s3 = appStatus(cl, appx); return s3.sync.status === "Synced" && s3.health.status === "Healthy"; }); if (!ok) { errl(io, "FATA[0120] timed out (2m0s) waiting for app \"" + appx.metadata.name + "\" match desired state"); return 20; } return S.CMDS.argocd(["argocd", "app", "get", appx.metadata.name], io, sess); }
    errl(io, "Error: unknown command \"" + cmd + "\" for \"argocd app\""); return 1;
  };
})(typeof window !== "undefined" ? window : globalThis);
