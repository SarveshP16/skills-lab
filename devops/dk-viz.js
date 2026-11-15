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
    el.innerHTML = '<div class="dv-head"><div class="dv-tabs" role="tablist"><button role="tab" data-v="ctr" aria-selected="true">Containers</button><button role="tab" data-v="img" aria-selected="false">Images</button><button role="tab" data-v="bld" aria-selected="false">Build<span class="dot" hidden></span></button></div>' +
      '<span class="dv-cap" id="dvCap"></span><button class="dv-toggle" type="button" id="dvToggle" title="Hide or show the Docker panel">hide</button></div>' +
      '<div class="dv-body"><div class="dv-view" id="dvCtr"></div><div class="dv-view" id="dvImg" hidden></div><div class="dv-view" id="dvBld" hidden></div></div>';
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
    $("dvCtr").hidden = v !== "ctr"; $("dvImg").hidden = v !== "img"; $("dvBld").hidden = v !== "bld";
    if (v === "bld") document.querySelector(".dv-tabs .dot").hidden = true;
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
    if (state.view === "ctr") renderCtr(); else if (state.view === "img") renderImg(); else renderBld();
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
    $("dvCap").innerHTML = "Docker is running on kc-dev-01. Containers, images and builds show up here as you work.";
    show("ctr");
    var cfg = window.LAB_CONFIG;
    if (fresh) cfg.runner.call({ type: "run", code: "", files: src.files || {}, prelude: src.prelude || "", system: src.system, checks: [] }).then(function (res) {
      if (state.src !== src || !res || !res.sys) return;
      state.sys = res.sys; render();
    });
  }
  function onResult(res) {
    if (!res || !res.sys) return;
    state.sys = res.sys;
    state.lastIdx = (res.count || 1) - 1;
    $("dvCap").innerHTML = caption(res.sys, state.lastIdx);
    var evs = ((res.sys.dk && res.sys.dk.events) || []).filter(function (e) { return e.cmd === state.lastIdx; });
    if (evs.some(function (e) { return e.kind === "build"; }) || (res.sys.dk && res.sys.dk.lastBuild && res.sys.dk.lastBuild.cmd === state.lastIdx)) { if (state.view !== "bld") { var dot = document.querySelector(".dv-tabs .dot"); if (dot) dot.hidden = false; } }
    if (evs.some(function (e) { return e.kind === "start" || e.kind === "die" || e.kind === "compose"; }) && state.view === "bld") show("ctr");
    render();
  }

  build();
  root.DkViz = { onLab: onLab, onResult: onResult };
})(window);
