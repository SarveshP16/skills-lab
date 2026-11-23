/* sudo learn — the Docker panel above the DevOps terminal. After every command it redraws what the laptop's
   Docker daemon holds: containers (state, health, published ports, volumes and bind mounts, the user they
   run as, grouped by Compose project), images as stacks of layers (base layers shared between images, the
   layers your Dockerfile added, and a warning on any layer that still holds a secret), and the last build
   step by step with what came from the cache. lab-app.js calls DkViz.onLab and DkViz.onResult. */
(function (root) {
  "use strict";
  var Dk = root.Dk;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var KEY = "sudolearn.dkviz.v1";
  var state = { src: null, sys: null, view: "ctr", lastCount: 0 };

  function build() {
    var work = document.querySelector(".work"), cons = document.querySelector(".console");
    var el = document.createElement("section");
    el.className = "dkviz"; el.id = "dkviz"; el.setAttribute("aria-label", "Docker on this laptop");
    el.innerHTML = '<div class="dv-head"><div class="dv-tabs" role="tablist"><button role="tab" data-v="ctr" aria-selected="true" class="dk-tab">Containers</button><button role="tab" data-v="img" aria-selected="false" class="dk-tab">Images</button><button role="tab" data-v="bld" aria-selected="false" class="dk-tab">Build<span class="dot" hidden></span></button><button role="tab" data-v="k8c" aria-selected="false" class="k8-tab" hidden>Cluster<span class="dot" hidden></span></button><button role="tab" data-v="k8w" aria-selected="false" class="k8-tab" hidden>Workloads<span class="dot" hidden></span></button><button role="tab" data-v="k8t" aria-selected="false" class="k8-tab" hidden>Traffic<span class="dot" hidden></span></button><button role="tab" data-v="obm" aria-selected="false" class="ob-tab" hidden>Metrics<span class="dot" hidden></span></button><button role="tab" data-v="obl" aria-selected="false" class="ob-tab" hidden>Logs<span class="dot" hidden></span></button><button role="tab" data-v="obt" aria-selected="false" class="ob-tab" hidden>Traces<span class="dot" hidden></span></button><button role="tab" data-v="oba" aria-selected="false" class="ob-tab" hidden>Alerts<span class="dot" hidden></span></button><button role="tab" data-v="cloud" aria-selected="false" class="iac-tab" hidden>Cloud<span class="dot" hidden></span></button><button role="tab" data-v="hosts" aria-selected="false" class="iac-tab" hidden>Hosts<span class="dot" hidden></span></button><button role="tab" data-v="pip" aria-selected="false" class="ci-tab" hidden>Pipeline<span class="dot" hidden></span></button><button role="tab" data-v="env" aria-selected="false" class="ci-tab" hidden>Environments<span class="dot" hidden></span></button></div>' +
      '<span class="dv-cap" id="dvCap"></span><button class="dv-toggle" type="button" id="dvToggle" title="Hide or show the Docker panel">hide</button></div>' +
      '<div class="dv-body"><div class="dv-view" id="dvCtr"></div><div class="dv-view" id="dvImg" hidden></div><div class="dv-view" id="dvBld" hidden></div><div class="dv-view" id="dvPip" hidden></div><div class="dv-view" id="dvEnv" hidden></div><div class="dv-view" id="dvCloud" hidden></div><div class="dv-view" id="dvHosts" hidden></div><div class="dv-view" id="dvK8c" hidden></div><div class="dv-view" id="dvK8w" hidden></div><div class="dv-view" id="dvK8t" hidden></div><div class="dv-view" id="dvObm" hidden></div><div class="dv-view" id="dvObl" hidden></div><div class="dv-view" id="dvObt" hidden></div><div class="dv-view" id="dvOba" hidden></div></div>';
    work.insertBefore(el, cons);
    document.body.classList.add("dk-mode");
    var collapsed = false; try { collapsed = localStorage.getItem(KEY) === "hidden"; } catch (e) { /* storage blocked */ }
    if (collapsed) { el.classList.add("collapsed"); $("dvToggle").textContent = "show"; }
    $("dvToggle").addEventListener("click", function () {
      var c = el.classList.toggle("collapsed");
      this.textContent = c ? "show" : "hide";
      try { localStorage.setItem(KEY, c ? "hidden" : "open"); } catch (e) { /* ignore */ }
      if (!c) render();
    });
    el.querySelector(".dv-tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-v]"); if (b) show(b.getAttribute("data-v")); });
  }
  function show(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs button"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-v") === v ? "true" : "false"); });
    $("dvCtr").hidden = v !== "ctr"; $("dvImg").hidden = v !== "img"; $("dvBld").hidden = v !== "bld"; $("dvPip").hidden = v !== "pip"; $("dvEnv").hidden = v !== "env"; $("dvCloud").hidden = v !== "cloud"; $("dvHosts").hidden = v !== "hosts"; $("dvK8c").hidden = v !== "k8c"; $("dvK8w").hidden = v !== "k8w"; $("dvK8t").hidden = v !== "k8t"; $("dvObm").hidden = v !== "obm"; $("dvObl").hidden = v !== "obl"; $("dvObt").hidden = v !== "obt"; $("dvOba").hidden = v !== "oba";
    var tb = document.querySelector('.dv-tabs button[data-v="' + v + '"] .dot'); if (tb) tb.hidden = true;
    render();
  }

  /* ---------------- containers */
  function ctrClass(c) {
    if (c.state === "running") return c.health ? (c.health.status === "healthy" ? "ok" : c.health.status === "unhealthy" ? "bad" : "warn") : "ok";
    if (c.state === "restarting") return "warn";
    if (c.state === "exited") return c.exitCode === 0 ? "idle" : "bad";
    return "idle";
  }
  function userOf(sys, c) {
    var img = Dk.imageById(sys, c.image), spec = c.user != null ? c.user : (img && img.cfg.User) || "";
    var u = String(spec).split(":")[0];
    return !u || u === "0" || u === "root" ? "root" : u;
  }
  function card(sys, c, fresh) {
    var cls = ctrClass(c), st = Dk.statusText(sys, c), user = userOf(sys, c);
    var h = '<div class="dv-card ' + cls + (fresh ? " pulse" : "") + '" title="' + esc(c.name + " · " + c.id.slice(0, 12)) + '">';
    h += '<div class="dv-ct"><i class="st"></i><b>' + esc(c.compose ? c.compose.service : c.name) + "</b><span class=\"img\">" + esc(c.imageRef) + "</span></div>";
    h += '<div class="dv-cs">' + esc(st) + "</div><div class=\"dv-chips\">";
    c.ports.forEach(function (p) { h += '<span class="chip port" title="Published: the laptop\'s port ' + p.hostPort + ' forwards to port ' + p.ctrPort + ' in the container">:' + p.hostPort + " → " + p.ctrPort + (p.hostIp !== "0.0.0.0" ? " <small>" + esc(p.hostIp) + "</small>" : "") + "</span>"; });
    c.mounts.forEach(function (m) {
      if (m.type === "tmpfs") { h += '<span class="chip tmp" title="tmpfs: in memory, gone when the container stops">tmpfs ' + esc(m.dst) + "</span>"; return; }
      var label = m.type === "volume" ? (m.anon ? "anon " + m.name.slice(0, 6) : m.name) : m.src.replace(/^\/home\/dev/, "~");
      h += '<span class="chip ' + (m.type === "volume" ? "vol" : "bind") + '" title="' + (m.type === "volume" ? "Volume " + esc(m.name) : "Bind mount from the laptop's " + esc(m.src)) + " at " + esc(m.dst) + (m.ro ? " (read-only)" : "") + '">' + (m.type === "volume" ? "▣ " : "▤ ") + esc(label) + " → " + esc(m.dst) + (m.ro ? " <small>ro</small>" : "") + "</span>";
    });
    (c.secrets || []).forEach(function (s) { h += '<span class="chip sec" title="Secret file, read-only">🔑 ' + esc(s.dst) + "</span>"; });
    if (c.state === "running" || c.state === "restarting") h += '<span class="chip user ' + (user === "root" ? "root" : "") + '" title="' + (user === "root" ? "Runs as root inside the container" : "Runs as a non-root user") + '">' + (user === "root" ? "root" : "user " + esc(user)) + "</span>";
    if (c.readOnly) h += '<span class="chip ro" title="Read-only root file system">read-only</span>';
    if (c.restart && c.restart.name !== "no") h += '<span class="chip rs" title="Restart policy">↻ ' + esc(c.restart.name) + (c.restarts ? " ×" + c.restarts : "") + "</span>";
    h += "</div></div>";
    return h;
  }
  function renderCtr() {
    var sys = state.sys, d = sys && sys.dk, el = $("dvCtr");
    if (!d || (!d.ctrs.length && !Object.keys(d.vols).length)) { el.innerHTML = '<div class="dv-empty">No containers yet. Start one with <code>docker run</code> and it appears here: running ones in green, stopped ones grey, crashed ones red.</div>'; return; }
    var fresh = {}; (d.events || []).forEach(function (e) { if (e.cmd === state.lastIdx && (e.kind === "start" || e.kind === "create")) fresh[e.ctr] = true; });
    var groups = {}, order = [];
    d.ctrs.slice().reverse().forEach(function (c) { var g = c.compose ? c.compose.project : ""; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(c); });
    var h = "";
    order.sort(function (a, b) { return (a === "") - (b === "") || (a < b ? -1 : 1); }).forEach(function (g) {
      var cs = groups[g];
      if (g) h += '<div class="dv-proj"><div class="dv-ph">compose project <b>' + esc(g) + '</b><span>network ' + esc(g) + "_default · services find each other by name</span></div>";
      h += '<div class="dv-grid">' + cs.map(function (c) { return card(sys, c, fresh[c.id]); }).join("") + "</div>";
      if (g) h += "</div>";
    });
    var vols = Object.keys(d.vols).filter(function (n) { return !d.vols[n].anonymous; });
    if (vols.length) h += '<div class="dv-foot"><span class="lbl">volumes</span>' + vols.map(function (n) { var used = Dk.volumeInUse(sys, n).length; return '<span class="chip vol' + (used ? "" : " dim") + '" title="' + (used ? "Used by " + used + " container(s)" : "Not used by any container: the data is still there") + '">▣ ' + esc(n) + "</span>"; }).join("") + "</div>";
    el.innerHTML = h;
  }

  /* ---------------- images as stacks of layers */
  var BASE_KEYS = {};
  Object.keys(Dk.LAYERS).forEach(function (k) { BASE_KEYS[Dk.LAYERS[k].id] = k; });
  function layerKind(L) {
    if (BASE_KEYS[L.id]) return "base";
    if (/^RUN/.test(L.by)) return "run";
    if (/^(COPY|ADD)/.test(L.by)) return "copy";
    return "meta";
  }
  function secretIn(L) {
    var hit = null;
    Object.keys(L.files || {}).some(function (p) { var e = L.files[p]; if (e.t !== "f" || !e.c || e.c.length > 100000 || /site-packages|node_modules/.test(p)) return false; return Dk.SECRET_RULES.some(function (r) { if (r.re.test(e.c)) { hit = p; return true; } return false; }); });
    return hit;
  }
  function renderImg() {
    var sys = state.sys, d = sys && sys.dk, el = $("dvImg");
    if (!d || !d.images.length) { el.innerHTML = '<div class="dv-empty">No images yet. <code>docker pull</code> or <code>docker build</code> one, and you\'ll see it as a stack of layers here.</div>'; return; }
    var imgs = d.images.slice(0, 7), max = Math.max.apply(null, imgs.map(function (i) { return i.size; }));
    var scale = function (s) { return Math.sqrt(s) / Math.sqrt(max || 1); };
    var h = '<div class="dv-legend"><span><i class="base"></i>from the base image</span><span><i class="copy"></i>COPY / ADD</span><span><i class="run"></i>RUN</span><span><i class="secret"></i>holds a secret</span><span class="note">Bar length grows with size (square-root scale). Hover a layer for its step.</span></div>';
    imgs.forEach(function (img) {
      var layers = img.layers.filter(function (L) { return L.size > 0 || Object.keys(L.files || {}).length; });
      var total = layers.reduce(function (s, L) { return s + Math.max(L.size, 1); }, 0) || 1;
      var w = Math.max(6, scale(img.size) * 100);
      h += '<div class="dv-img"><div class="dv-it" title="' + esc(img.id) + '">' + esc(img.tags[0] || "<none>:<none>") + (img.tags.length > 1 ? ' <small>+' + (img.tags.length - 1) + "</small>" : "") + '</div><div class="dv-bar" style="width:' + w.toFixed(1) + '%">';
      layers.forEach(function (L) {
        var kind = layerKind(L), sec = kind !== "base" ? secretIn(L) : null;
        h += '<span class="ly ' + kind + (sec ? " secret" : "") + '" style="flex:' + Math.max(L.size / total, 0.04).toFixed(4) + '" title="' + esc((sec ? "⚠ holds a secret: " + sec + "\n" : "") + L.by + "\n" + Dk.human(L.size)) + '"></span>';
      });
      h += '</div><div class="dv-is">' + Dk.human(img.size) + "</div></div>";
    });
    if (d.images.length > imgs.length) h += '<div class="dv-more">+' + (d.images.length - imgs.length) + " more (docker images lists them all)</div>";
    el.innerHTML = h;
  }

  /* ---------------- the last build */
  function renderBld() {
    var sys = state.sys, d = sys && sys.dk, el = $("dvBld"), b = d && d.lastBuild;
    if (!b) { el.innerHTML = '<div class="dv-empty">No build yet. Run <code>docker build -t NAME:TAG .</code> and every step shows up here, with what came from the cache.</div>'; return; }
    var cached = b.steps.filter(function (s) { return s.cached; }).length;
    var h = '<div class="dv-bh"><b>' + esc((b.tags || [])[0] || "(no tag)") + "</b> " + (b.ok ? '<span class="good">built in ' + (b.secs || 0).toFixed(1) + "s</span> · " + cached + " of " + b.steps.length + " steps cached · " + Dk.human(b.size || 0) : '<span class="bad">failed</span>') + (b.warnings && b.warnings.length ? ' · <span class="warn">' + b.warnings.length + " warning" + (b.warnings.length > 1 ? "s" : "") + "</span>" : "") + "</div><ol class=\"dv-steps\">";
    b.steps.forEach(function (s) {
      var tag = s.error ? '<span class="tag bad">failed</span>' : s.cached ? '<span class="tag ok">cached</span>' : '<span class="tag run">' + (s.secs || 0).toFixed(1) + "s</span>";
      h += "<li class=\"" + (s.error ? "bad" : s.cached ? "ok" : "") + "\">" + tag + "<code>" + esc(s.label) + "</code>" + (s.size ? '<span class="sz">+' + Dk.human(s.size) + "</span>" : "") + "</li>";
    });
    h += "</ol>";
    if (b.warnings && b.warnings.length) h += '<div class="dv-warn">' + b.warnings.map(function (w) { return "⚠ " + esc(w); }).join("<br>") + "</div>";
    el.innerHTML = h;
  }

  function render() {
    if (!state.sys || document.getElementById("dkviz").classList.contains("collapsed")) return;
    if (state.obs && /^ob/.test(state.view) && window.ObsViz) { var ov = { obm: ["dvObm", "metrics"], obl: ["dvObl", "logs"], obt: ["dvObt", "traces"], oba: ["dvOba", "alerts"] }[state.view]; $(ov[0]).innerHTML = ObsViz[ov[1]](state.sys); return; }
    if (state.k8s && /^k8/.test(state.view) && window.K8sViz) { var vw = { k8c: ["dvK8c", "cluster"], k8w: ["dvK8w", "workloads"], k8t: ["dvK8t", "traffic"] }[state.view]; $(vw[0]).innerHTML = K8sViz[vw[1]](state.sys); return; }
    if (state.view === "ctr") renderCtr(); else if (state.view === "img") renderImg(); else if (state.view === "pip") renderPip(); else if (state.view === "env") renderEnv(); else if (state.view === "cloud") renderCloud(); else if (state.view === "hosts") renderHosts(); else renderBld();
  }
  function caption(sys, idx) {
    var d = sys.dk; if (!d) return "Docker is running on kc-dev-01. Containers, images and builds show up here as you work.";
    var evs = (d.events || []).filter(function (e) { return e.cmd === idx; });
    var running = d.ctrs.filter(function (c) { return c.state === "running"; }).length;
    var base = running + " running · " + d.ctrs.length + " container" + (d.ctrs.length === 1 ? "" : "s") + " · " + d.images.length + " image" + (d.images.length === 1 ? "" : "s");
    var last = evs[evs.length - 1];
    if (!last) return base;
    var c = last.ctr && d.ctrs.filter(function (x) { return x.id === last.ctr; })[0];
    var what = { start: c ? "Started <b>" + esc(c.name) + "</b>" : null, die: c ? "<b>" + esc(c.name) + "</b> <span class=\"bad\">exited (" + last.code + ")</span>" : null, stop: c ? "Stopped <b>" + esc(c.name) + "</b>" : null, destroy: "Removed <b>" + esc(last.name || "") + "</b>", build: "Built <b>" + esc(last.ref) + "</b>", pull: "Pulled <b>" + esc(last.ref) + "</b>", push: "Pushed <b>" + esc(last.ref) + "</b>", tag: "Tagged <b>" + esc(last.ref) + "</b>", exec: c ? "Ran a command in <b>" + esc(c.name) + "</b>" : null, compose: "compose " + esc(last.sub) + " in <b>" + esc(last.project) + "</b>", volume: "Created volume <b>" + esc(last.name) + "</b>" }[last.kind];
    return (what ? what + " · " : "") + base;
  }

  /* ---------------- CI/CD (Module 2): the latest pipeline run, whichever system ran it, and the environments */
  var CI = root.CI;
  function hubOf(sys) { return CI && CI.hubOf ? CI.hubOf(sys) : null; }
  function latestRun(sys) {
    var h = hubOf(sys); if (!h) return null;
    var cands = [];
    [CI.REPO, window.IAC && IAC.INFRA_REPO].forEach(function (full) {
      var r = full && window.GitHub && GitHub.find(sys, full);
      if (r && r.runs.length) { var ar = r.runs.slice().sort(function (a, b) { return b.id - a.id; })[0]; cands.push({ t: ar.created, run: actionsModel(ar) }); }
    });
    if (h.jenkins) Object.keys(h.jenkins.jobs).forEach(function (jn) { var job = h.jenkins.jobs[jn]; Object.keys(job.branches).forEach(function (bn) { var bs = job.branches[bn].builds, b = bs[bs.length - 1]; if (b) cands.push({ t: b.started + 0.5, run: jenkinsModel(job, b) }); }); });
    if (h.bamboo) Object.keys(h.bamboo.plans).forEach(function (pk) { var P = h.bamboo.plans[pk]; Object.keys(P.branches).forEach(function (bn) { var rs = P.branches[bn].results, x = rs[rs.length - 1]; if (x) cands.push({ t: x.t + 0.5, run: bambooModel(P, x) }); }); });
    cands.sort(function (a, b) { return b.t - a.t; });
    return cands[0] ? cands[0].run : null;
  }
  function st(status, conclusion) {
    if (status === "waiting") return "wait";
    if (status !== "completed") return status === "in_progress" ? "run" : "queue";
    return { success: "ok", failure: "bad", cancelled: "skip", skipped: "skip", neutral: "ok" }[conclusion] || "queue";
  }
  function actionsModel(run) {
    var depth = {}, jobs = run.jobs, defs = (run.wf && run.wf.doc && run.wf.doc.jobs) || {};
    function d(k, seen) { if (depth[k] != null) return depth[k]; seen = seen || {}; if (seen[k]) return 0; seen[k] = 1; var n = defs[k] && defs[k].needs; n = n == null ? [] : Array.isArray(n) ? n : [n]; depth[k] = n.length ? 1 + Math.max.apply(null, n.map(function (x) { return d(String(x), seen); })) : 0; return depth[k]; }
    var cols = [];
    jobs.forEach(function (j) { var c = d(j.key); (cols[c] = cols[c] || { name: "", boxes: [] }).boxes.push({ name: j.name, s: st(j.status, j.conclusion), sub: j.envName ? "env: " + j.envName + (j.status === "waiting" ? " · needs approval" : "") : j.steps.length ? j.steps.length + " steps" : "" }); });
    if (!jobs.length && run.error) cols.push({ name: "", boxes: [{ name: "Invalid workflow file", s: "bad", sub: run.wfPath }] });
    var res = run.status === "completed" ? run.conclusion : run.status;
    return { sys: "GitHub Actions", title: run.wfName, num: "#" + run.number, ref: (run.branch || run.ref || "").replace(/^refs\/(heads|tags)\//, "") + " @ " + String(run.headSha || "").slice(0, 7), event: run.event, result: res, s: st(run.status, run.conclusion), cols: cols.filter(Boolean) };
  }
  function jenkinsModel(job, b) {
    // top-level stages are columns; a parallel stage's branches are stacked in its column
    var cols = [];
    (b.stages || []).forEach(function (x) {
      var box = { name: x.name, s: { success: "ok", failed: "bad", skipped: "skip", unstable: "wait", aborted: "skip" }[x.status] || "queue", sub: x.when ? "skipped (when)" : x.status === "skipped" ? "skipped" : "" };
      if (!x.depth || !cols.length) { cols.push({ name: "", boxes: [box], top: x.name }); return; }
      var c = cols[cols.length - 1];
      if (!c.kids) { c.kids = true; c.name = c.top; c.boxes = []; }
      c.boxes.push(box);
    });
    var res = (b.result || "running").toLowerCase();
    return { sys: "Jenkins", title: job.name + " » " + b.branch, num: "#" + b.number, ref: b.branch + " @ " + String(b.sha).slice(0, 7), event: b.cause, result: res, s: { success: "ok", failure: "bad", unstable: "wait", aborted: "skip" }[res] || "run", cols: cols, extra: b.tests ? b.tests.total + " tests" + (b.tests.failed ? ", " + b.tests.failed + " failed" : "") : "" };
  }
  function bambooModel(P, r) {
    var cols = P.stages.map(function (sg) { return { name: sg.name, boxes: r.jobs.filter(function (j) { return j.stage === sg.name; }).map(function (j) { return { name: j.name, s: { Successful: "ok", Failed: "bad", Queued: "wait", "Not built": "skip" }[j.state] || "queue", sub: j.queued ? "no agent" : j.tests ? j.tests.total + " tests" : j.agent || "" }; }) }; });
    return { sys: "Bamboo", title: P.key + " · " + P.name, num: "#" + r.number, ref: r.branch + " @ " + String(r.sha).slice(0, 7), event: r.reason, result: r.state.toLowerCase(), s: { Successful: "ok", Failed: "bad", Queued: "wait" }[r.state] || "run", cols: cols };
  }
  var SICON = { ok: "✓", bad: "✗", skip: "–", wait: "⏸", run: "●", queue: "○" };
  function renderPip() {
    var sys = state.sys, m = latestRun(sys);
    if (!m) { $("dvPip").innerHTML = '<div class="dv-empty">No pipeline runs yet. Push to <code>' + (state.iac ? "kestrel/infra" : "kestrel/notes-api") + '</code> and the latest run, from GitHub Actions, Jenkins or Bamboo, shows up here: each stage or job as a box, green when it passed and red when it failed.</div>'; return; }
    var h = '<div class="dv-bh"><b>' + esc(m.sys) + "</b> · " + esc(m.title) + " " + esc(m.num) + " · " + esc(m.ref) + ' · <span class="' + (m.s === "ok" ? "good" : m.s === "bad" ? "bad" : "warn") + '">' + esc(m.result) + "</span>" + (m.extra ? " · " + esc(m.extra) : "") + "</div>";
    h += '<div class="ci-flow">';
    m.cols.forEach(function (c, i) {
      if (i) h += '<div class="ci-arrow" aria-hidden="true">→</div>';
      h += '<div class="ci-col">' + (c.name ? '<div class="ci-cn">' + esc(c.name) + "</div>" : "") + c.boxes.map(function (b) { return '<div class="ci-box ' + b.s + '" title="' + esc(b.name + (b.sub ? " · " + b.sub : "")) + '"><span class="ic">' + SICON[b.s] + "</span><b>" + esc(b.name) + "</b>" + (b.sub ? "<small>" + esc(b.sub) + "</small>" : "") + "</div>"; }).join("") + "</div>";
    });
    h += "</div>";
    $("dvPip").innerHTML = h;
  }
  function renderEnv() {
    var sys = state.sys, F = hubOf(sys) && hubOf(sys).fleet, svc = F && F.services.notes;
    if (!svc) { $("dvEnv").innerHTML = '<div class="dv-empty">No environments in this lab yet.</div>'; return; }
    var order = ["dev", "staging", "production"].filter(function (e) { return svc.envs[e]; }).concat(Object.keys(svc.envs).filter(function (e) { return ["dev", "staging", "production"].indexOf(e) < 0; }));
    var gh = window.GitHub && GitHub.find(sys, CI.REPO), ghEnvs = (gh && gh.envs) || {};
    var h = '<div class="ci-envs">';
    order.forEach(function (en, i) {
      var E = svc.envs[en], split = CI.trafficSplit(E), ro = E.rollout && E.rollout.status !== "done" ? E.rollout : null;
      var cls = ro && ro.status === "aborted" ? "bad" : ro ? "warn" : "ok";
      if (i) h += '<div class="ci-arrow" aria-hidden="true">→</div>';
      h += '<div class="ci-env ' + cls + '"><div class="ci-et"><b>' + esc(en) + '</b><span class="ver">' + esc(E.current.version) + "</span></div>";
      h += '<div class="ci-es">rev ' + E.current.rev + " · " + esc(E.current.strategy) + " · " + E.insts.filter(function (x) { return x.ok; }).length + "/" + E.size + " ready</div>";
      h += '<div class="ci-traffic">' + split.map(function (sp, k) { return '<span class="seg s' + k + '" style="width:' + Math.max(sp.w, 4) + '%" title="' + esc(sp.version) + ": " + sp.w + '% of traffic">' + (sp.w >= 18 ? esc(sp.version) + " " + sp.w + "%" : "") + "</span>"; }).join("") + "</div>";
      var chips = "";
      if (ro) chips += '<span class="chip ' + (ro.status === "aborted" ? "bad" : "sec") + '">' + esc(ro.strategy) + " " + esc(ro.version) + ": " + esc(ro.status) + "</span>";
      if (E.policy && E.policy.requireSignature) chips += '<span class="chip ro" title="Only images signed by the CI identity may run here">🔏 signed only</span>';
      if (ghEnvs[en]) { var ge = ghEnvs[en], rv = (ge.reviewers || []).length, ns = ge.secrets ? Object.keys(ge.secrets).length : 0; chips += '<span class="chip bind" title="GitHub environment">GitHub env' + (rv ? " · " + rv + " reviewer" + (rv > 1 ? "s" : "") : "") + (ns ? " · " + ns + " secret" + (ns > 1 ? "s" : "") : "") + "</span>"; }
      if (chips) h += '<div class="dv-chips">' + chips + "</div>";
      h += "</div>";
    });
    h += "</div>";
    var evs = (F.events || []).slice(-3).reverse();
    if (evs.length) h += '<div class="dv-foot"><span class="lbl">recent</span>' + evs.map(function (e) { return '<span class="chip">' + esc(e.env || "") + " " + esc(e.kind || e.type || "") + (e.version ? " " + esc(e.version) : "") + " <small>from " + esc(e.where || "") + "</small></span>"; }).join("") + "</div>";
    $("dvEnv").innerHTML = h;
  }
  function ciCaption(sys) {
    var m = latestRun(sys), F = hubOf(sys) && hubOf(sys).fleet, svc = F && F.services.notes;
    var parts = [];
    if (m) parts.push(esc(m.sys) + " " + esc(m.num) + ' <span class="' + (m.s === "ok" ? "" : "bad") + '">' + esc(m.result) + "</span>");
    if (svc) parts.push(Object.keys(svc.envs).map(function (e) { return esc(e) + " <b>" + esc(svc.envs[e].current.version) + "</b>"; }).join(" · "));
    return parts.join(" · ") || "CI/CD for kestrel/notes-api: pipeline runs and environments show up here.";
  }
  function ciSig(sys) { var m = latestRun(sys), F = hubOf(sys) && hubOf(sys).fleet; return { run: m ? m.sys + m.num + m.result + m.title : "", env: F ? JSON.stringify(Object.keys(F.services).map(function (k) { var s = F.services[k]; return Object.keys(s.envs).map(function (e) { return s.envs[e].current.rev + (s.envs[e].rollout ? s.envs[e].rollout.status + s.envs[e].rollout.weight : ""); }); })) : "" }; }

  /* ---------------- infrastructure (Module 3): the AWS account and the servers */
  function iacA(sys) { return window.IAC ? IAC.aws(sys) : null; }
  function tagName(o) { return (o.tags && o.tags.Name) || ""; }
  function lastPlanFor(A) { var lp = A && A.lastPlan; if (!lp) return {}; var m = {}; lp.changes.forEach(function (c) { m[c.type + ":" + c.addr] = c.action; }); return { list: lp.changes, map: m }; }
  function driftIds(A) { var ids = {}; (A.events || []).forEach(function (e) { if (e.kind === "drift") ids[e.id] = true; if (/^tf-(update|create|import)$/.test(e.kind) && ids[e.id]) delete ids[e.id]; }); return ids; }
  function iacCaption(sys) {
    var A = iacA(sys); if (!A) return "";
    var n = 0; Object.keys(A.res).forEach(function (t) { n += Object.keys(A.res[t]).length; });
    var lastApply = (A.events || []).filter(function (e) { return /^tf-(apply|destroy-all)$/.test(e.kind); }).slice(-1)[0];
    var lp = A.lastPlan ? A.lastPlan.changes : null;
    var parts = ["AWS <b>" + n + "</b> resource" + (n === 1 ? "" : "s")];
    if (lp) { var c = { create: 0, update: 0, "delete": 0, replace: 0 }; lp.forEach(function (x) { c[x.action] = (c[x.action] || 0) + 1; }); parts.push("plan <b>+" + (c.create + c.replace) + " ~" + c.update + " -" + (c["delete"] + c.replace) + "</b> (not applied)"); }
    else if (lastApply) parts.push("last apply: +" + lastApply.add + " ~" + lastApply.change + " -" + lastApply.destroy);
    var runs = (window.CI && CI.hubOf(sys).ansibleRuns) || [], lr = runs[runs.length - 1];
    if (lr) { var hs = Object.keys(lr.stats), ch = hs.reduce(function (s2, h) { return s2 + lr.stats[h].changed; }, 0), fl = hs.filter(function (h) { return lr.stats[h].failed || lr.stats[h].unreachable; }).length; parts.push("ansible: " + hs.length + " host" + (hs.length === 1 ? "" : "s") + ", changed=" + ch + (fl ? ' <span class="bad">' + fl + " failed</span>" : "") + (lr.check ? " (check)" : "")); }
    return parts.join(" · ");
  }
  function iacSig(sys) { var A = iacA(sys); if (!A) return { cloud: "", hosts: "", run: "" }; var c = []; Object.keys(A.res).forEach(function (t) { Object.keys(A.res[t]).forEach(function (k) { c.push(t + k); }); }); var runs = (CI.hubOf(sys).ansibleRuns || []).length; var m = latestRun(sys); return { cloud: c.join(",") + (A.lastPlan ? "p" + A.lastPlan.t : "") + (A.events || []).filter(function (e) { return e.kind === "drift"; }).length, hosts: String(runs), run: m ? m.sys + m.num + m.result : "" }; }
  function chip(cls, txt, title) { return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + txt + "</span>"; }
  function renderCloud() {
    var sys = state.sys, A = iacA(sys);
    if (!A) { $("dvCloud").innerHTML = ""; return; }
    var all = function (t) { return IAC.all(A, t); }, drift = driftIds(A), plan = A.lastPlan;
    var h = "";
    if (plan && plan.changes.length) h += '<div class="iac-plan"><b>Planned, not applied:</b> ' + plan.changes.map(function (c) { var s = { create: "+", update: "~", "delete": "-", replace: "-/+" }[c.action] || "?"; return '<span class="pc ' + c.action + '">' + s + " " + esc(c.addr) + "</span>"; }).join(" ") + "</div>";
    var vpcs = all("aws_vpc");
    vpcs.forEach(function (v) {
      var subs = all("aws_subnet").filter(function (s2) { return s2.vpc_id === v.id; });
      var igw = all("aws_internet_gateway").filter(function (g) { return g.vpc_id === v.id; })[0];
      h += '<div class="iac-vpc"><div class="iac-vh"><b>VPC</b> ' + esc(tagName(v) || v.id) + ' <span class="dim">' + esc(v.cidr_block) + "</span>" + (igw ? chip("port", "⇅ internet gateway") : chip("tmp", "no internet gateway")) + (drift[v.id] ? chip("sec", "changed outside Terraform") : "") + "</div><div class=\"iac-subs\">";
      subs.forEach(function (sn) {
        var pub = IAC.publicRoute(A, sn.id), insts = all("aws_instance").filter(function (i) { return i.subnet_id === sn.id; });
        h += '<div class="iac-sub ' + (pub ? "pub" : "priv") + '"><div class="iac-sh">' + (pub ? "public" : "private") + " · " + esc(sn.cidr_block) + ' <span class="dim">' + esc(sn.availability_zone || "") + "</span></div>";
        insts.forEach(function (i) {
          var sgs = (i.vpc_security_group_ids || []).map(function (g) { var x = IAC.find(A, "aws_security_group", function (y) { return y.id === g; }); return x ? x.name : g; });
          var mo = i.metadata_options && i.metadata_options[0], rb = i.root_block_device && i.root_block_device[0];
          h += '<div class="iac-inst ' + (i.instance_state === "running" ? "ok" : "idle") + '"><div class="dv-ct"><span class="st"></span><b>' + esc(tagName(i) || i.id) + '</b><span class="img">' + esc(i.instance_type) + "</span></div>" +
            '<div class="dv-cs">' + esc(i.private_ip) + (i.public_ip ? " · " + esc(i.public_ip) : "") + "</div><div class=\"dv-chips\">" + sgs.map(function (n) { return chip("bind", "sg " + esc(n)); }).join("") +
            (mo && mo.http_tokens === "required" ? chip("ro", "IMDSv2") : chip("sec", "IMDSv1")) + (rb && rb.encrypted ? chip("ro", "🔒 disk") : chip("sec", "disk not encrypted")) + (drift[i.id] ? chip("sec", "drift") : "") + "</div></div>";
        });
        h += "</div>";
      });
      h += "</div></div>";
    });
    var cards = [];
    all("aws_s3_bucket").forEach(function (b) {
      var enc = IAC.find(A, "aws_s3_bucket_server_side_encryption_configuration", function (x) { return x.bucket === b.bucket; }), ver = IAC.find(A, "aws_s3_bucket_versioning", function (x) { return x.bucket === b.bucket; }), pab = IAC.find(A, "aws_s3_bucket_public_access_block", function (x) { return x.bucket === b.bucket; });
      var objs = Object.keys(b.objects || {}).length, isState = /tfstate/.test(b.bucket);
      cards.push('<div class="iac-card"><div class="iac-ct">🪣 <b>' + esc(b.bucket) + "</b></div><div class=\"dv-chips\">" + (isState ? chip("port", "state" + (objs ? " · " + objs + " object" + (objs > 1 ? "s" : "") : "")) : "") + (ver && ver.versioning_configuration[0].status === "Enabled" ? chip("ro", "versioned") : "") + (enc ? chip("ro", enc.rule && enc.rule[0] && enc.rule[0].apply_server_side_encryption_by_default[0].sse_algorithm === "aws:kms" ? "KMS" : "SSE") : "") + (pab && pab.block_public_acls && pab.block_public_policy ? chip("ro", "public blocked") : chip("tmp", "no public block")) + (drift[b.bucket] ? chip("sec", "drift") : "") + Object.keys(b.tags || {}).slice(0, 3).map(function (k) { return chip("tmp", esc(k) + "=" + esc(b.tags[k])); }).join("") + "</div></div>");
    });
    all("aws_security_group").filter(function (g) { return !all("aws_instance").some(function (i) { return (i.vpc_security_group_ids || []).indexOf(g.id) >= 0; }) || true; }).forEach(function (g) {
      var rules = (g.ingress || []).map(function (r) { var open = (r.cidr_blocks || []).indexOf("0.0.0.0/0") >= 0; return chip(open && +r.from_port === 22 ? "sec" : open ? "port" : "bind", (r.protocol === "-1" ? "all" : r.from_port + (r.to_port !== r.from_port ? "-" + r.to_port : "")) + " ← " + esc((r.cidr_blocks || []).join(",") || "sg")); }).join("");
      IAC.all(A, "aws_vpc_security_group_ingress_rule").forEach(function (r) { if (r.security_group_id === g.id) rules += chip(r.cidr_ipv4 === "0.0.0.0/0" && +r.from_port === 22 ? "sec" : "bind", r.from_port + " ← " + esc(r.cidr_ipv4 || "sg")); });
      cards.push('<div class="iac-card"><div class="iac-ct">🛡 <b>' + esc(g.name) + "</b></div><div class=\"dv-chips\">" + (rules || chip("tmp", "no ingress")) + (drift[g.id] ? chip("sec", "changed outside Terraform") : "") + "</div></div>");
    });
    all("aws_ssm_parameter").forEach(function (p) { cards.push('<div class="iac-card"><div class="iac-ct">🔑 <b>' + esc(p.name) + "</b></div><div class=\"dv-chips\">" + chip(p.type === "SecureString" ? "ro" : "sec", esc(p.type)) + chip("tmp", "v" + p.version) + "</div></div>"); });
    all("aws_iam_role").forEach(function (r) { var att = IAC.all(A, "aws_iam_role_policy_attachment").filter(function (x) { return x.role === r.name; }).map(function (x) { return x.policy_arn.split("/").pop(); }); cards.push('<div class="iac-card"><div class="iac-ct">👤 <b>' + esc(r.name) + "</b></div><div class=\"dv-chips\">" + (/token\.actions/.test(r.assume_role_policy) ? chip("port", "GitHub OIDC") : /ec2\.amazonaws/.test(r.assume_role_policy) ? chip("port", "EC2") : "") + att.map(function (x) { return chip(/Administrator/.test(x) ? "sec" : "bind", esc(x)); }).join("") + "</div></div>"); });
    all("aws_dynamodb_table").forEach(function (t) { var locks = Object.keys(t.items || {}).length; cards.push('<div class="iac-card"><div class="iac-ct">🗄 <b>' + esc(t.name) + "</b></div><div class=\"dv-chips\">" + (locks ? chip("sec", "🔒 " + locks + " lock") : chip("tmp", "no locks")) + "</div></div>"); });
    all("aws_key_pair").forEach(function (k) { cards.push('<div class="iac-card"><div class="iac-ct">🗝 <b>' + esc(k.key_name) + "</b></div><div class=\"dv-chips\">" + chip("tmp", esc(k.key_type || "ed25519")) + "</div></div>"); });
    all("aws_iam_openid_connect_provider").forEach(function (p) { cards.push('<div class="iac-card"><div class="iac-ct">🔗 <b>OIDC</b></div><div class="dv-chips">' + chip("port", esc(p.url.replace(/^https:\/\//, ""))) + "</div></div>"); });
    if (cards.length) h += '<div class="iac-grid">' + cards.join("") + "</div>";
    if (!h) h = '<div class="dv-empty">Nothing in the AWS account yet. Resources you create with <code>terraform apply</code> appear here: networks with their servers, buckets, security groups, roles and secrets. A planned-but-not-applied change shows at the top.</div>';
    $("dvCloud").innerHTML = h;
  }
  function renderHosts() {
    var sys = state.sys, home = CI.homeSys(sys), A = iacA(sys), runs = CI.hubOf(sys).ansibleRuns || [], last = {};
    runs.forEach(function (r) { Object.keys(r.stats).forEach(function (h) { last[h] = { s: r.stats[h], check: r.check, pb: r.playbook }; }); });
    var hosts = [];
    Object.keys(IAC.SERVERS).forEach(function (n) { var m = home.net && home.net.byIp && home.net.byIp[IAC.SERVERS[n]]; hosts.push({ name: n, ip: IAC.SERVERS[n], m: m, kind: "on-prem" }); });
    IAC.all(A, "aws_instance").forEach(function (i) { hosts.push({ name: (i.tags && i.tags.Name) || i.id, ip: i.public_ip || i.private_ip, m: A.machines[i.id], kind: "EC2", alt: i.public_ip }); });
    // in a cloud lab, on-prem servers nobody has touched are just noise
    if (hosts.some(function (x) { return x.kind === "EC2"; })) hosts = hosts.filter(function (x) { return x.kind === "EC2" || x.m || last[x.name]; });
    var h = '<div class="dv-grid">' + hosts.map(function (x) {
      var m = x.m, lr = last[x.name] || (x.alt && last[x.alt]);
      var nginx = m && m.units && m.units["nginx.service"] && m.units["nginx.service"].rt.active === "active";
      var ufw = m && /Status: active/.test(String((window.IAC && IAC.H) ? (IAC.H.sh(m, "ufw status").text) : ""));
      var cls = !m ? "idle" : lr && (lr.s.failed || lr.s.unreachable) ? "bad" : "ok";
      return '<div class="dv-card ' + cls + '"><div class="dv-ct"><span class="st"></span><b>' + esc(x.name) + '</b><span class="img">' + esc(x.kind) + '</span></div><div class="dv-cs">' + esc(x.ip) + (m ? "" : " · not contacted yet") + '</div><div class="dv-chips">' +
        (m ? (nginx ? chip("ro", "nginx ●") : chip("tmp", "no nginx")) + (ufw ? chip("bind", "ufw on") : "") : "") +
        (lr ? chip(lr.s.failed || lr.s.unreachable ? "sec" : "port", (lr.s.unreachable ? "unreachable" : lr.s.failed ? "failed" : "ok=" + lr.s.ok + " changed=" + lr.s.changed) + (lr.check ? " (check)" : "")) : "") + "</div></div>";
    }).join("") + "</div>";
    $("dvHosts").innerHTML = h;
  }

  /* ---------------- hooks */
  function badge(lab) {
    var meta = document.querySelector(".ticket-head .meta");
    if (!meta) return;
    var b = meta.querySelector(".pill.tool");
    if (!b) { b = document.createElement("span"); b.className = "pill tool"; meta.insertBefore(b, meta.children[1] || null); }
    b.textContent = lab.tool || "";
    b.hidden = !lab.tool;
    b.title = "The tool this lab is about";
  }
  function onLab(src, lab, drill, fresh) {
    badge(lab);
    state.src = src; state.sys = null; state.lastIdx = -1;
    state.mod = lab && lab.module || 1;
    state.ci = state.mod === 2 || !!(lab && lab.ci);
    state.iac = state.mod === 3;
    state.k8s = state.mod === 4 || state.mod === 5;
    state.obs = state.mod === 5;
    var rp = document.getElementById("repl"); if (rp) rp.placeholder = "type a command, e.g. " + ({ 1: "docker ps", 2: "gh run list", 3: "terraform plan", 4: "kubectl get pods", 5: "promtool query instant $PROM up" }[state.mod] || "docker ps");
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs .dk-tab"), function (b) { b.hidden = state.iac || state.k8s; });
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs .k8-tab"), function (b) { b.hidden = !state.k8s || (state.obs && b.getAttribute("data-v") !== "k8c"); });
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs .ob-tab"), function (b) { b.hidden = !state.obs; });
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs .ci-tab"), function (b) { b.hidden = !(state.ci || (state.iac && b.getAttribute("data-v") === "pip")); });
    Array.prototype.forEach.call(document.querySelectorAll(".dv-tabs .iac-tab"), function (b) { b.hidden = !state.iac; });
    state.sig = null;
    $("dvCap").innerHTML = state.obs ? "kestrel-staging and its monitoring: metrics, logs, traces and alerts show up here as you work." : state.k8s ? "The kestrel-staging cluster: nodes, pods, workloads and traffic show up here as you work." : state.iac ? "AWS account " + (window.IAC ? IAC.ACCOUNT : "") + " (eu-west-1) and the servers you manage show up here." : state.ci ? "CI/CD for kestrel/notes-api: pipeline runs and environments show up here." : "Docker is running on kc-dev-01. Containers, images and builds show up here as you work.";
    show(state.obs ? "obm" : state.k8s ? "k8c" : state.iac ? "cloud" : state.ci ? "pip" : "ctr");
    var cfg = window.LAB_CONFIG;
    if (fresh) cfg.runner.call({ type: "run", code: "", files: src.files || {}, prelude: src.prelude || "", system: src.system, checks: [] }).then(function (res) {
      if (state.src !== src || !res || !res.sys) return;
      state.sys = res.sys; if (state.obs && window.ObsViz) { state.osig = ObsViz.sig(res.sys); state.ksig = K8sViz.sig(res.sys); $("dvCap").innerHTML = ObsViz.caption(res.sys); } else if (state.k8s && window.K8sViz) { state.ksig = K8sViz.sig(res.sys); $("dvCap").innerHTML = K8sViz.caption(res.sys); } else if (state.iac) { state.isig = iacSig(res.sys); $("dvCap").innerHTML = iacCaption(res.sys); } else if (state.ci) { state.sig = ciSig(res.sys); $("dvCap").innerHTML = ciCaption(res.sys); } render();
    });
  }
  function onResult(res) {
    if (!res || !res.sys) return;
    state.sys = res.sys;
    state.lastIdx = (res.count || 1) - 1;
    if (state.obs && window.ObsViz) {
      $("dvCap").innerHTML = ObsViz.caption(res.sys);
      var os = ObsViz.sig(res.sys), oo = state.osig || { m: "", l: "", t: "", a: "" }; state.osig = os;
      var kk = K8sViz.sig(res.sys), ko = state.ksig || { cl: "" }; state.ksig = kk;
      [["m", "obm"], ["l", "obl"], ["t", "obt"], ["a", "oba"]].forEach(function (x) { if (os[x[0]] !== oo[x[0]] && state.view !== x[1]) { var d0 = document.querySelector('.dv-tabs button[data-v="' + x[1] + '"] .dot'); if (d0) d0.hidden = false; } });
      if (kk.cl !== ko.cl && state.view !== "k8c") { var dk0 = document.querySelector('.dv-tabs button[data-v="k8c"] .dot'); if (dk0) dk0.hidden = false; }
      render();
      return;
    }
    if (state.k8s && window.K8sViz) {
      $("dvCap").innerHTML = K8sViz.caption(res.sys, state.lastIdx);
      var ks = K8sViz.sig(res.sys), ok0 = state.ksig || { cl: "", wl: "", tr: "" }; state.ksig = ks;
      [["cl", "k8c"], ["wl", "k8w"], ["tr", "k8t"]].forEach(function (x) { if (ks[x[0]] !== ok0[x[0]] && state.view !== x[1]) { var d0 = document.querySelector('.dv-tabs button[data-v="' + x[1] + '"] .dot'); if (d0) d0.hidden = false; } });
      render();
      return;
    }
    if (state.iac) {
      $("dvCap").innerHTML = iacCaption(res.sys);
      var isg = iacSig(res.sys), oldI = state.isig || { cloud: "", hosts: "", run: "" }; state.isig = isg;
      if (isg.cloud !== oldI.cloud && state.view !== "cloud") { var c1 = document.querySelector('.dv-tabs button[data-v="cloud"] .dot'); if (c1) c1.hidden = false; }
      if (isg.hosts !== oldI.hosts && state.view !== "hosts") { var c2 = document.querySelector('.dv-tabs button[data-v="hosts"] .dot'); if (c2) c2.hidden = false; }
      if (isg.run !== oldI.run && state.view !== "pip") { var c3 = document.querySelector('.dv-tabs button[data-v="pip"] .dot'); if (c3) c3.hidden = false; }
      render();
      return;
    }
    if (state.ci) {
      $("dvCap").innerHTML = ciCaption(res.sys);
      var sig = ciSig(res.sys), old = state.sig || { run: "", env: "" }; state.sig = sig;
      if (sig.run !== old.run && state.view !== "pip") { var d1 = document.querySelector('.dv-tabs button[data-v="pip"] .dot'); if (d1) d1.hidden = false; }
      if (sig.env !== old.env && old.env && state.view !== "env") { var d2 = document.querySelector('.dv-tabs button[data-v="env"] .dot'); if (d2) d2.hidden = false; }
      render();
      return;
    }
    $("dvCap").innerHTML = caption(res.sys, state.lastIdx);
    var evs = ((res.sys.dk && res.sys.dk.events) || []).filter(function (e) { return e.cmd === state.lastIdx; });
    if (evs.some(function (e) { return e.kind === "build"; }) || (res.sys.dk && res.sys.dk.lastBuild && res.sys.dk.lastBuild.cmd === state.lastIdx)) { if (state.view !== "bld") { var dot = document.querySelector(".dv-tabs .dot"); if (dot) dot.hidden = false; } }
    if (evs.some(function (e) { return e.kind === "start" || e.kind === "die" || e.kind === "compose"; }) && state.view === "bld") show("ctr");
    render();
  }

  build();
  root.DkViz = { onLab: onLab, onResult: onResult };
})(window);
