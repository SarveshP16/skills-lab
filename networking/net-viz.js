/* sudo learn — the network panel for the Networking track. After every command it redraws the map of Kestrel's
   network from the simulated machine (each node green, amber or red, as kc-web-01 sees it right now), animates
   what the command sent (a packet travelling hop by hop, a red cross where it died), decodes captured packets
   layer by layer with their bytes, and lights the OSI layers the lab and the last command worked on.
   lab-app.js calls NetViz.onLab when a lab or drill loads and NetViz.onResult after each command. */
(function (root) {
  "use strict";
  var NL = root.NetLab;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var SVGNS = "http://www.w3.org/2000/svg";
  var KEY = "sudolearn.netviz.v1";
  var OSI = [[7, "Application"], [6, "Presentation"], [5, "Session"], [4, "Transport"], [3, "Network"], [2, "Data link"], [1, "Physical"]];
  var POS = { you: [70, 118], sw: [205, 118], gw: [372, 118], inet: [522, 118], dns: [150, 36], db: [250, 36], backup: [350, 36], stor: [446, 36], legacy: [150, 200], data: [262, 200], build: [372, 200], lb: [150, 200], vpn: [262, 200], partner: [372, 200], mon: [470, 200], site: [522, 36] };
  var LINKS = [["you", "sw"], ["sw", "gw"], ["gw", "inet"], ["sw", "dns"], ["sw", "db"], ["sw", "backup"], ["sw", "stor", "VLAN 30"], ["sw", "legacy"], ["sw", "data"], ["sw", "build"], ["sw", "lb"], ["sw", "vpn"], ["vpn", "partner", "VPN"], ["gw", "mon", "office"], ["inet", "site"]];
  var BASE = ["you", "sw", "gw", "dns", "db", "inet"];
  var state = { src: null, lab: null, layers: [], pkts: [], pk: 0, view: "map", sys: null, anim: null, statuses: {} };

  /* ---------------- DOM */
  function build() {
    var work = document.querySelector(".work"), cons = document.querySelector(".console");
    var el = document.createElement("section");
    el.className = "netviz"; el.id = "netviz"; el.setAttribute("aria-label", "Network diagram");
    el.innerHTML = '<div class="nv-head"><div class="nv-tabs" role="tablist"><button role="tab" data-v="map" aria-selected="true">Network map</button><button role="tab" data-v="pkt" aria-selected="false">Packet<span class="dot" hidden></span></button><button role="tab" data-v="ports" aria-selected="false">Ports</button></div>' +
      '<span class="nv-cap" id="nvCap">The map shows what kc-web-01 can reach right now.</span><button class="nv-toggle" type="button" id="nvToggle" title="Hide or show the network panel">hide</button></div>' +
      '<div class="nv-body"><div class="nv-view nv-map" id="nvMap"></div><div class="nv-view nv-pkt" id="nvPkt" hidden></div><div class="nv-view nv-ports" id="nvPorts" hidden></div><aside class="nv-osi" id="nvOsi" aria-label="OSI layers"></aside></div>';
    work.insertBefore(el, cons);
    document.body.classList.add("net-mode");
    var collapsed = false; try { collapsed = localStorage.getItem(KEY) === "hidden"; } catch (e) { /* storage blocked: start open */ }
    if (collapsed) { el.classList.add("collapsed"); $("nvToggle").textContent = "show"; }
    $("nvToggle").addEventListener("click", function () {
      var c = el.classList.toggle("collapsed");
      this.textContent = c ? "show" : "hide";
      try { localStorage.setItem(KEY, c ? "hidden" : "open"); } catch (e) { /* ignore */ }
      if (!c) render();
    });
    el.querySelector(".nv-tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-v]"); if (b) showView(b.getAttribute("data-v")); });
    $("nvOsi").innerHTML = "<h5>OSI layers</h5>" + OSI.map(function (l) { return '<div class="osi-row l' + l[0] + '" data-l="' + l[0] + '" title="Layer ' + l[0] + ': ' + l[1] + '"><b>L' + l[0] + "</b>" + l[1] + "</div>"; }).join("");
    $("nvPkt").addEventListener("click", function (e) { var b = e.target.closest("button[data-pk]"); if (!b) return; state.pk = Math.max(0, Math.min(state.pkts.length - 1, state.pk + (+b.getAttribute("data-pk")))); renderPkt(); });
    $("nvPkt").addEventListener("mouseover", function (e) { var l = e.target.closest(".lay"); hiBytes(l ? l.getAttribute("data-span") : null); });
    $("nvPkt").addEventListener("mouseout", function () { hiBytes(null); });
  }
  function showView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll(".nv-tabs button"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-v") === v ? "true" : "false"); });
    $("nvMap").hidden = v !== "map"; $("nvPkt").hidden = v !== "pkt"; $("nvPorts").hidden = v !== "ports";
    if (v === "pkt") { document.querySelector(".nv-tabs .dot").hidden = true; renderPkt(); }
    if (v === "ports") renderPorts();
  }

  /* ---------------- the ports card: every port the track teaches, its secure version, and what to watch for */
  var PORTS = [
    ["20/21", "tcp", "FTP", "990 FTPS, or SFTP on 22", "passwords in clear text"], ["22", "tcp", "SSH, SFTP, scp", "", "brute force: keys only"], ["23", "tcp", "Telnet", "22 SSH", "everything in clear text"],
    ["25", "tcp", "SMTP, server to server", "STARTTLS", "open relays"], ["53", "udp/tcp", "DNS", "853 DoT, 443 DoH", "spoofing, amplification"], ["67/68", "udp", "DHCP", "", "rogue DHCP servers"],
    ["69", "udp", "TFTP", "", "no authentication"], ["80", "tcp", "HTTP", "443 HTTPS", "clear text, redirect to 443"], ["110", "tcp", "POP3", "995 POP3S", "clear-text passwords"],
    ["123", "udp", "NTP", "", "amplification"], ["143", "tcp", "IMAP", "993 IMAPS", "clear-text passwords"], ["161", "udp", "SNMP", "SNMPv3", "community \"public\""],
    ["389", "tcp", "LDAP", "636 LDAPS", "clear-text binds"], ["443", "tcp+udp", "HTTPS, HTTP/3 (QUIC)", "", ""], ["445", "tcp", "SMB", "", "never on the internet"],
    ["465", "tcp", "SMTP submission over TLS", "", ""], ["587", "tcp", "SMTP submission", "STARTTLS", ""], ["993", "tcp", "IMAPS", "", ""], ["995", "tcp", "POP3S", "", ""],
    ["2375", "tcp", "Docker API", "2376 with client certs", "root on the host"], ["3306", "tcp", "MySQL", "TLS", "never on the internet"], ["3389", "tcp", "RDP", "behind a VPN", "brute force"],
    ["5432", "tcp", "PostgreSQL", "TLS", "never on the internet"], ["6379", "tcp", "Redis", "TLS, AUTH", "often no password"], ["6443", "tcp", "Kubernetes API", "", "anonymous access"],
    ["8080", "tcp", "HTTP alternative", "8443", "admin panels"], ["9200", "tcp", "Elasticsearch", "TLS, auth", "often open, no auth"], ["27017", "tcp", "MongoDB", "TLS, auth", "often open, no auth"]
  ];
  function renderPorts() {
    var el = $("nvPorts");
    if (el.getAttribute("data-done")) return;
    el.setAttribute("data-done", "1");
    el.innerHTML = '<input class="pt-find" type="search" placeholder="Filter: a port, a name or a word" aria-label="Filter the ports">' +
      '<table class="pt"><thead><tr><th>Port</th><th>Proto</th><th>Service</th><th>Encrypted version</th><th>Watch for</th></tr></thead><tbody>' +
      PORTS.map(function (p) { return "<tr><td>" + p[0] + "</td><td>" + p[1] + "</td><td>" + esc(p[2]) + "</td><td>" + esc(p[3]) + "</td><td>" + esc(p[4]) + "</td></tr>"; }).join("") + "</tbody></table>";
    el.querySelector(".pt-find").addEventListener("input", function () {
      var q = this.value.trim().toLowerCase();
      Array.prototype.forEach.call(el.querySelectorAll("tbody tr"), function (tr) { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; });
    });
  }

  /* ---------------- layers of the lab */
  function parseLayers(s) {
    var m = /L(\d)(?:\s*[–-]\s*(\d))?/.exec(String(s || ""));
    if (!m) return [];
    var a = +m[1], b = m[2] ? +m[2] : a, r = [];
    for (var i = a; i <= b; i++) r.push(i);
    return r;
  }
  function setOsi(hit) {
    Array.prototype.forEach.call(document.querySelectorAll(".osi-row"), function (row) {
      var l = +row.getAttribute("data-l");
      row.classList.toggle("inlab", state.layers.indexOf(l) >= 0);
      row.classList.remove("hit");
      if (hit && hit.indexOf(l) >= 0) { void row.offsetWidth; row.classList.add("hit"); }
    });
  }

  /* ---------------- the map */
  function visible() {
    var want = BASE.concat((state.lab && state.lab.diagram) || []).concat((state.src && state.src.diagram) || []);
    var sys = state.sys;
    if (sys && sys.nw && Object.keys(sys.nw.ifs).some(function (k) { return sys.nw.ifs[k].kind === "vlan"; }) && want.indexOf("stor") < 0) want.push("stor");
    return want.filter(function (x, i) { return want.indexOf(x) === i && POS[x]; });
  }
  function icon(kind) {
    if (kind === "server") return '<path class="ico" d="M-37 -7h9v14h-9z M-35 -3h5 M-35 1h5"/>';
    if (kind === "router") return '<circle class="ico" cx="-32.5" cy="0" r="6"/><path class="ico" d="M-36 0h7 M-32.5 -3.5v7"/>';
    if (kind === "switch") return '<path class="ico" d="M-38 -4h11v8h-11z M-36 0h1 M-33 0h1 M-30 0h1"/>';
    if (kind === "site") return '<path class="ico" d="M-36 -1v-3a3.5 3.5 0 0 1 7 0v3 M-37.5 -1h10v7h-10z"/>';
    return '<path class="ico" d="M-38 4h12a3.5 3.5 0 0 0 0-7a5 5 0 0 0-9.5-1a3.5 3.5 0 0 0-2.5 8z"/>';
  }
  function render() {
    var map = $("nvMap");
    if (!map || !state.sys) return;
    var vis = visible();
    var st = state.statuses = NL.status(state.sys, vis);
    var h = '<svg viewBox="0 0 600 236" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Network map">';
    LINKS.forEach(function (l) {
      if (vis.indexOf(l[0]) < 0 || vis.indexOf(l[1]) < 0) return;
      var a = POS[l[0]], b = POS[l[1]], s = l[0] === "you" ? st.you : st[l[1]];
      var cls = "nv-link " + (s ? s.st : "") + (l[2] === "VLAN 30" ? " vlan" : "");
      h += '<path class="' + cls + '" d="M' + a[0] + " " + a[1] + " L" + b[0] + " " + b[1] + '"/>';
      if (l[2]) h += '<text class="nv-link-label" x="' + ((a[0] + b[0]) / 2 + 4) + '" y="' + ((a[1] + b[1]) / 2 - 4) + '">' + l[2] + "</text>";
    });
    vis.forEach(function (id) {
      var p = POS[id], s = st[id] || { st: "unknown", label: id };
      var ip = id === "sw" ? "switch" : id === "inet" ? "1.1.1.1 …" : id === "site" ? "https" : s.ip;
      h += '<g class="nv-node ' + s.st + (id === "you" ? " me" : "") + '" data-id="' + id + '" transform="translate(' + p[0] + " " + p[1] + ')">' +
        '<rect class="box" x="-44" y="-17" width="88" height="34" rx="8"/>' + icon(s.kind) +
        '<text class="nm" x="-24" y="-2">' + esc(s.label.length > 13 ? s.label.slice(0, 12) + "…" : s.label) + '</text><text class="ip" x="-24" y="10">' + esc(ip) + "</text>" +
        '<circle class="st" cx="40" cy="-13" r="4.5"/></g>';
    });
    h += '<g id="nvAnim"></g></svg><div class="nv-legend"><span><i style="background:var(--green)"></i>reachable</span><span><i style="background:var(--amber)"></i>flaky</span><span><i style="background:var(--red)"></i>broken</span></div>';
    map.innerHTML = h;
    var tip = document.createElement("div"); tip.className = "nv-tip"; tip.hidden = true; map.appendChild(tip);
    Array.prototype.forEach.call(map.querySelectorAll(".nv-node"), function (g) {
      g.addEventListener("mouseenter", function () { var s = st[g.getAttribute("data-id")]; if (!s) return; tip.innerHTML = "<b>" + esc(s.label) + "</b> " + esc(s.ip || "") + "<br>" + esc(s.why || ""); tip.hidden = false; var r = g.getBoundingClientRect(), m = map.getBoundingClientRect(); tip.style.left = Math.max(4, Math.min(m.width - 264, r.left - m.left - 40)) + "px"; tip.style.top = (r.bottom - m.top + 4 > m.height - 50 ? r.top - m.top - 52 : r.bottom - m.top + 4) + "px"; });
      g.addEventListener("mouseleave", function () { tip.hidden = true; });
    });
  }
  // animate one event's path: a packet out (and back if it got an answer), or a cross where it died
  function animate(evs) {
    var g = document.getElementById("nvAnim");
    if (!g) return;
    if (state.anim) cancelAnimationFrame(state.anim);
    var vis = visible();
    var jobs = evs.filter(function (e) { return e.path && e.path.length; }).slice(0, 3).map(function (e) {
      var path = e.path.filter(function (id) { return POS[id] && vis.indexOf(id) >= 0; });
      if (e.path.indexOf("inet") >= 0 && vis.indexOf("inet") >= 0 && path.indexOf("inet") < 0) path.push("inet");
      return { e: e, path: path };
    }).filter(function (j) { return j.path.length; });
    if (!jobs.length) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var i = 0;
    function runJob() {
      if (i >= jobs.length) return;
      var j = jobs[i++], pts = j.path.map(function (id) { return POS[id]; }), ok = j.e.ok;
      var failAt = !ok && j.e.fail && POS[j.e.fail] ? POS[j.e.fail] : null;
      var seq = pts.slice();
      if (!ok && failAt) { var fi = j.path.indexOf(j.e.fail); if (fi >= 0) seq = pts.slice(0, fi + 1); }
      var back = ok ? seq.slice().reverse() : [];
      if (seq.length === 1 && ok) { pulse(j.path[0]); setTimeout(runJob, 400); return; }
      var dot = document.createElementNS(SVGNS, "circle"); dot.setAttribute("r", "4.5"); dot.setAttribute("class", "nv-pk"); g.appendChild(dot);
      function legLen(a) { var s = 0; for (var k = 1; k < a.length; k++) s += Math.hypot(a[k][0] - a[k - 1][0], a[k][1] - a[k - 1][1]); return s; }
      function at(a, d) { for (var k = 1; k < a.length; k++) { var L = Math.hypot(a[k][0] - a[k - 1][0], a[k][1] - a[k - 1][1]); if (d <= L) { var t = L ? d / L : 0; return [a[k - 1][0] + (a[k][0] - a[k - 1][0]) * t, a[k - 1][1] + (a[k][1] - a[k - 1][1]) * t]; } d -= L; } return a[a.length - 1]; }
      var phase = 0, legs = [seq, back], start = null, speed = reduce ? 1e9 : 0.32;
      function frame(ts) {
        if (start === null) start = ts;
        var a = legs[phase], L = legLen(a), d = (ts - start) * speed;
        var p = at(a, Math.min(d, L));
        dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]);
        if (d < L && a.length > 1) { state.anim = requestAnimationFrame(frame); return; }
        if (phase === 0) {
          pulse(j.path[Math.min(j.path.length - 1, seq.length - 1)]);
          if (!ok) { cross(a[a.length - 1]); g.removeChild(dot); setTimeout(runJob, 500); return; }
          phase = 1; start = null; dot.setAttribute("class", "nv-pk back"); state.anim = requestAnimationFrame(frame); return;
        }
        setTimeout(function () { if (dot.parentNode) g.removeChild(dot); runJob(); }, 120);
      }
      state.anim = requestAnimationFrame(frame);
    }
    function cross(p) {
      var x = document.createElementNS(SVGNS, "path");
      x.setAttribute("class", "nv-x"); x.setAttribute("d", "M" + (p[0] - 7) + " " + (p[1] - 26) + " l14 14 M" + (p[0] + 7) + " " + (p[1] - 26) + " l-14 14");
      g.appendChild(x);
      setTimeout(function () { if (x.parentNode) x.parentNode.removeChild(x); }, 2600);
    }
    function pulse(id) { var n = document.querySelector('.nv-node[data-id="' + id + '"]'); if (n) { n.classList.remove("pulse"); void n.getBoundingClientRect(); n.classList.add("pulse"); } }
    runJob();
  }

  /* ---------------- captions */
  function caption(evs, count) {
    if (!evs.length) return null;
    var e = evs[evs.length - 1];
    var ok = function (t) { return '<span class="good">' + t + "</span>"; }, bad = function (t) { return '<span class="bad">' + t + "</span>"; };
    if (e.k === "ping") return "<b>ICMP</b> echo to " + esc(e.to) + ": " + (e.ok ? ok(e.loss ? e.loss + "% lost" : "replies came back") : bad(e.err === "netunreach" ? "no route (Network is unreachable)" : e.nic ? "the card has no link (Host Unreachable)" : e.err === "hostunreach" ? "nobody answered ARP (Host Unreachable)" : "no reply"));
    if (e.k === "trace") return "<b>traceroute</b> to " + esc(e.to) + ": " + (e.ok ? ok((e.hops || []).length + " hops") : bad("stopped" + (e.fail ? " at " + esc(e.fail) : "")));
    if (e.k === "arp") return "<b>ARP</b> who has " + esc(e.to) + "? " + (e.macs && e.macs.length > 1 ? bad(e.macs.length + " different MACs answered!") : e.ok ? ok(esc(e.macs[0])) : bad("no answer"));
    if (e.k === "dns") return "<b>DNS</b> " + esc(e.name) + (e.server ? " via " + esc(e.server) : "") + ": " + (e.ok ? ok(e.hosts ? "found in /etc/hosts" : "answered") : bad(e.status || "no answer"));
    if (e.k === "http") return "<b>HTTP</b> " + esc(e.url) + ": " + (e.ok ? ok(e.status + (e.http === "2" ? " over HTTP/2" : "") + (e.tls ? " · TLS" : "")) : bad(e.tlsErr ? "TLS: " + esc(e.tlsErr) : e.err ? esc(e.err) : e.status ? e.status : e.dns ? "name didn't resolve" : "failed"));
    if (e.k === "tcp") return "<b>TCP</b> " + esc(e.to) + ":" + e.port + ": " + (e.ok ? ok("connected (SYN, SYN-ACK, ACK)") : bad(e.err === "refused" ? "refused (RST: nothing listening)" : e.err === "timeout" ? "timed out (packets dropped)" : esc(e.err)));
    if (e.k === "udp") return "<b>UDP</b> " + esc(e.to) + ":" + e.port + ": sent (UDP has no handshake, so nc can't tell if anyone listens)";
    if (e.k === "tls") return "<b>TLS</b> " + esc(e.host || e.what || "") + ": " + (e.ok ? ok(e.what === "certbot" ? "certbot finished" : "certificate verified") : bad(e.verify || e.what === "certbot" && "renewal failed" || "handshake failed"));
    if (e.k === "pkt") return "<b>Captured</b> " + e.count + " packet" + (e.count === 1 ? "" : "s") + (e.saved ? " to " + esc(e.saved) : "") + (e.count ? ": open the Packet tab to take them apart" : "");
    if (e.k === "route") return "<b>Route</b> to " + esc(e.to) + ": " + (e.ok ? ok(e.via ? "via " + esc(e.via) : "directly on " + esc(e.dev)) : bad("none"));
    if (e.k === "link") return "<b>Changed</b> " + esc(e.what || "the network settings") + ": the map is redrawn from the new settings";
    if (e.k === "look") return "Looked at <b>" + esc(e.what) + "</b>";
    return null;
  }
  var LAYER_OF = { ping: [3], trace: [3], arp: [2], dns: [7], http: [7], tcp: [4], udp: [4], tls: [5, 6], pkt: [2, 3, 4], route: [3], link: [1, 2], look: [] };
  var LOOK_LAYER = { addr: [3], link: [1, 2], route: [3], neigh: [2], ethtool: [1], ss: [4] };

  /* ---------------- packet view */
  function renderPkt() {
    var el = $("nvPkt");
    if (!state.pkts.length) { el.innerHTML = '<div class="pk-empty">No packet yet. Capture or read some with <code>tcpdump</code> (for example <code>tcpdump -r FILE -n</code>), and they appear here, taken apart layer by layer.</div>'; return; }
    var p = state.pkts[state.pk];
    var h = '<div class="pk-nav"><button data-pk="-1" ' + (state.pk ? "" : "disabled") + ' aria-label="Previous packet">‹</button><span class="n">' + (state.pk + 1) + " / " + state.pkts.length + '</span><button data-pk="1" ' + (state.pk < state.pkts.length - 1 ? "" : "disabled") + ' aria-label="Next packet">›</button><span class="sum">' + esc(p.summary) + "</span></div>";
    // the layers nest like the headers do: each one wraps the next
    var open = "", close = "";
    p.layers.forEach(function (l) {
      open += '<div class="lay l' + l.l + '" data-span="' + l.span + '"><div class="lh">L' + l.l + " · " + esc(l.name) + (l.unit ? " <small>(" + l.unit + ")</small>" : "") + '</div><div class="fl">' + l.fields.map(function (f) { return "<span><em>" + esc(f[0]) + "</em>" + esc(f[1]) + "</span>"; }).join("") + "</div>";
      close += "</div>";
    });
    h += '<div class="pk-doll">' + open + close + "</div>";
    h += '<div class="pk-hexh">The ' + p.bytes.length + " bytes on the wire, coloured by layer</div><div class=\"pk-hex\">";
    p.bytes.forEach(function (b, i) { var s = p.spans.filter(function (x) { return i >= x.from && i < x.to; })[0]; h += '<span class="l' + (s ? s.l : 0) + '" data-s="' + (s ? p.spans.indexOf(s) : -1) + '">' + ("0" + b.toString(16)).slice(-2) + "</span>"; });
    h += "</div>";
    el.innerHTML = h;
  }
  function hiBytes(si) {
    Array.prototype.forEach.call(document.querySelectorAll("#nvPkt .pk-hex span"), function (s) { s.classList.toggle("hl", si !== null && s.getAttribute("data-s") === String(si)); });
    Array.prototype.forEach.call(document.querySelectorAll("#nvPkt .lay"), function (l) { l.classList.toggle("on", si !== null && l.getAttribute("data-span") === String(si)); });
  }

  /* ---------------- hooks from lab-app.js */
  function badge(lab) {
    var meta = document.querySelector(".ticket-head .meta");
    if (!meta) return;
    var b = meta.querySelector(".pill.layer");
    if (!b) { b = document.createElement("span"); b.className = "pill layer"; meta.insertBefore(b, meta.children[1] || null); }
    b.textContent = lab.layer || "";
    b.hidden = !lab.layer;
    b.title = "OSI layers this lab works on";
  }
  function onLab(src, lab, drill, fresh) {
    state.src = src; state.lab = lab;
    state.layers = parseLayers((drill && drill.layer) || lab.layer);
    state.pkts = []; state.pk = 0;
    badge(lab);
    setOsi(null);
    $("nvCap").innerHTML = "The map shows what kc-web-01 can reach right now. Hover a machine for details.";
    document.querySelector(".nv-tabs .dot").hidden = true;
    showView("map");
    if (fresh) {
      var cfg = window.LAB_CONFIG;
      cfg.runner.call({ type: "run", code: "", files: src.files || {}, prelude: src.prelude || "", system: src.system, checks: [] }).then(function (res) {
        if (state.src !== src || !res || !res.sys) return;
        state.sys = res.sys;
        render();
      });
    }
  }
  function onResult(res, src) {
    if (!res || !res.sys) return;
    state.sys = res.sys;
    var last = (res.count || 1) - 1;
    var evs = (res.sys.nw && res.sys.nw.events || []).filter(function (e) { return e.i === last; });
    var cap = caption(evs);
    if (cap) $("nvCap").innerHTML = cap;
    var hit = [];
    evs.forEach(function (e) { (e.k === "look" ? (LOOK_LAYER[e.what] || (e.layer ? [e.layer] : [])) : e.layer ? (e.k === "pkt" ? LAYER_OF.pkt : e.k === "tls" ? [5, 6] : [e.layer]) : LAYER_OF[e.k] || []).forEach(function (l) { if (hit.indexOf(l) < 0) hit.push(l); }); });
    setOsi(hit);
    var pk = evs.filter(function (e) { return e.k === "pkt" && e.pkts && e.pkts.length; }).pop();
    if (pk) {
      state.pkts = pk.pkts; state.pk = 0;
      // start on the most interesting packet: the first one carrying application data
      for (var i = 0; i < pk.pkts.length; i++) { if (pk.pkts[i].layers.some(function (l) { return l.l === 7; })) { state.pk = i; break; } }
      if (state.view === "pkt") renderPkt(); else document.querySelector(".nv-tabs .dot").hidden = false;
      if (pk.count === 1 || pk.file) showView("pkt");
    }
    if (document.getElementById("netviz").classList.contains("collapsed")) return;
    render();
    if (state.view === "map") animate(evs);
  }

  build();
  root.NetViz = { onLab: onLab, onResult: onResult, parseLayers: parseLayers };
})(window);
