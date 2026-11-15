/* sudo learn — DevOps track: docker build. A Dockerfile parser and a BuildKit-style builder: every RUN step
   really runs in a throwaway container made from the layers so far (with the course's Bash and the image's own
   tools), and what it changed becomes the next layer. The layer cache is keyed like the real one (parent +
   instruction + the checksum of copied files), so reordering COPY and RUN shows "CACHED" exactly when it
   should. Multi-stage builds, .dockerignore, --build-arg (and how ARG values leak into docker history),
   --secret mounts, and Docker 27's build-check warnings are all here. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk;
  var out = U.out, errl = U.errl, note = U.note;

  /* ================================================================== Dockerfile parser */
  var INSTR = ["FROM", "RUN", "CMD", "LABEL", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL", "MAINTAINER"];
  function suggest(w) {
    var best = null, bd = 9;
    INSTR.forEach(function (k) { var d = lev(w.toUpperCase(), k); if (d < bd) { bd = d; best = k; } });
    return bd <= 2 ? best.toLowerCase() : null;
  }
  function lev(a, b) { var m = []; for (var i = 0; i <= a.length; i++) { m[i] = [i]; for (var j = 1; j <= b.length; j++) m[i][j] = i === 0 ? j : Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); } return m[a.length][b.length]; }
  function parseDockerfile(text) {
    var raw = String(text).replace(/\r/g, "").split("\n"), out2 = [], i = 0;
    while (i < raw.length) {
      var l = raw[i], start = i;
      if (/^\s*#/.test(l) || !l.trim()) { i++; continue; }
      var full = l;
      while (/\\\s*$/.test(full) && i + 1 < raw.length) { i++; var nx = raw[i]; if (/^\s*#/.test(nx)) continue; full = full.replace(/\\\s*$/, "") + " " + nx.trim(); }
      i++;
      var m = /^\s*(\S+)\s*(.*)$/.exec(full);
      var kw = m[1].toUpperCase();
      if (INSTR.indexOf(kw) < 0) return { error: "dockerfile parse error on line " + (start + 1) + ": unknown instruction: " + m[1] + (suggest(m[1]) ? " (did you mean " + suggest(m[1]) + "?)" : ""), line: start + 1 };
      var args = m[2].trim(), json = null;
      if (/^\[/.test(args)) { try { var j = JSON.parse(args); if (Array.isArray(j) && j.every(function (x) { return typeof x === "string"; })) json = j; } catch (e) { json = null; } }
      out2.push({ kw: kw, args: args, json: json, line: start + 1, lastLine: i, raw: m[1], text: full.trim() });
    }
    return { instrs: out2, lines: raw };
  }
  Dk.parseDockerfile = parseDockerfile;
  // ${VAR}, $VAR, ${VAR:-default}, ${VAR:+alt} with the build's ARG/ENV values
  function subst(s, vars) {
    return String(s).replace(/\$\{(\w+)(?::?([-+])([^}]*))?\}|\$(\w+)/g, function (m0, a, op, def, b) {
      var k = a || b, v = vars[k];
      if (op === "-") return v != null && v !== "" ? v : def;
      if (op === "+") return v != null && v !== "" ? def : "";
      return v != null ? v : "";
    });
  }
  // KEY=VALUE pairs (ENV, LABEL, ARG) with quotes; or the old "ENV KEY VALUE" form
  function pairs(args) {
    var res = [], s = args.trim();
    if (!/^[\w.-]+=/.test(s)) { var m = /^(\S+)\s+(.*)$/.exec(s); if (m) return [[m[1], m[2].replace(/^"(.*)"$/, "$1")]]; return [[s, null]]; }
    var re = /([\w.\-]+)(?:=("(?:[^"\\]|\\.)*"|'[^']*'|\S*))?/g, x;
    while ((x = re.exec(s))) { var v = x[2]; if (v == null) { res.push([x[1], null]); continue; } if (/^"/.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, "$1"); else if (/^'/.test(v)) v = v.slice(1, -1); res.push([x[1], v]); }
    return res;
  }
  function flagsOf(args) { var f = {}, rest = args; var m; while ((m = /^--([\w-]+)(?:=(\S+))?\s+/.exec(rest))) { f[m[1]] = m[2] === undefined ? true : m[2]; rest = rest.slice(m[0].length); } return { flags: f, rest: rest }; }

  /* ================================================================== .dockerignore and the build context */
  function ignoreRules(text) {
    return String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^#/.test(l); }).map(function (l) {
      var neg = l.charAt(0) === "!"; if (neg) l = l.slice(1).trim();
      l = l.replace(/^\/+/, "").replace(/\/+$/, "");
      var src = "^" + l.split("**").map(function (part) { return part.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"); }).join(".*") + "(/.*)?$";
      return { neg: neg, re: new RegExp(src.replace(/\.\*\//g, "(.*/)?")) };
    });
  }
  function ignored(rules, rel) { var hit = false; rules.forEach(function (r) { if (r.re.test(rel)) hit = !r.neg; }); return hit; }
  Dk.ignoreRules = ignoreRules; Dk.ignored = ignored;
  // Files sent to the builder: {rel: entry}, plus total bytes
  function contextFiles(sys, dir) {
    var dn = Dk.fsNode(sys, dir);
    var all = Dk.mapFrom(dn, "/"), rules = ignoreRules((Dk.fsNode(sys, dir + "/.dockerignore") || {}).content), files = {}, bytes = 0;
    Object.keys(all).forEach(function (p) {
      var rel = p.slice(1);
      if (ignored(rules, rel)) return;
      var e = Object.assign({}, all[p]);
      e.u = 0; e.g = 0;
      files[rel] = e; bytes += Dk.entrySize(e);
    });
    return { files: files, bytes: bytes, rules: rules };
  }
  Dk.contextFiles = contextFiles;

  /* ================================================================== the builder */
  function clock(sys) { return Dk.clock(sys); }
  function stepLabel(stage, nStages, k, total) { return "[" + (nStages > 1 ? stage + " " : "") + k + "/" + total + "]"; }
  function envMap(cfg) { var m = {}; (cfg.Env || []).forEach(function (kv) { var i = kv.indexOf("="); m[kv.slice(0, i)] = kv.slice(i + 1); }); return m; }
  function setEnv(cfg, k, v) { cfg.Env = (cfg.Env || []).filter(function (kv) { return kv.split("=")[0] !== k; }); cfg.Env.push(k + "=" + v); }
  function cloneCfg(c) { return JSON.parse(JSON.stringify(c)); }
  var SECRET_NAME = /(api[-_]?key|apikey|auth|credential|passwd|password|pword|secret|token|private[-_]?key|^key$|_key$)/i;

  // build(sess, {ctxDir, file, tags, args, noCache, target, secrets, plain}, io) -> {img} or {error}
  function build(sess, o, io) {
    var sys = sess.sys, d = Dk.state(sys), t0 = clock(sys);
    var ctxNode = Dk.fsNode(sys, o.ctxDir);
    if (!ctxNode || ctxNode.type !== "d") { errl(io, "ERROR: unable to prepare context: path \"" + o.ctxArg + "\" not found"); return { error: true }; }
    var dfPath = o.file ? Dk.absHost(sess, o.file) : o.ctxDir + "/Dockerfile";
    var dfNode = Dk.fsNode(sys, dfPath);
    var rec = { t: t0, cmd: sys.cmdIndex, tags: o.tags, steps: [], ok: false, ctxDir: o.ctxDir, warnings: [], target: o.target || null, args: Object.keys(o.args || {}), secrets: Object.keys(o.secrets || {}), noCache: !!o.noCache, file: o.file || null };
    d.builds.push(rec); d.lastBuild = rec;
    var hdr = [];
    function line(label, secs, mark) { hdr.push({ label: label, secs: secs, mark: mark || "" }); }
    if (!dfNode || dfNode.type !== "f") {
      out(io, "[+] Building 0.0s (1/1) FINISHED\n => [internal] load build definition from " + (o.file || "Dockerfile").split("/").pop() + "          0.0s\n => => transferring dockerfile: 2B                            0.0s\n");
      errl(io, "ERROR: failed to solve: failed to read dockerfile: open " + (o.file || "Dockerfile").split("/").pop() + ": no such file or directory");
      return { error: true };
    }
    var parsed = parseDockerfile(dfNode.content);
    line("[internal] load build definition from " + dfPath.split("/").pop(), 0.0);
    line("=> transferring dockerfile: " + Dk.human(dfNode.content.length), 0.0, "sub");
    if (parsed.error) { flush(io, hdr, 0.1, false); errl(io, "ERROR: failed to solve: " + parsed.error); rec.error = parsed.error; return { error: true }; }
    // stages
    var stages = [], globalArgs = {}, cur = null;
    parsed.instrs.forEach(function (ins) {
      if (ins.kw === "FROM") { var fm = /^(?:--platform=\S+\s+)?(\S+)(?:\s+(?:AS|as|As)\s+(\S+))?\s*$/.exec(ins.args); cur = { from: fm ? fm[1] : ins.args, name: fm && fm[2] ? fm[2] : null, instrs: [], line: ins.line, fromIns: ins, idx: stages.length }; stages.push(cur); return; }
      if (!cur) { if (ins.kw === "ARG") { pairs(ins.args).forEach(function (p) { globalArgs[p[0]] = o.args[p[0]] != null ? o.args[p[0]] : p[1]; }); return; } rec.error = "no build stage in current context"; return; }
      cur.instrs.push(ins);
    });
    if (rec.error || !stages.length) { flush(io, hdr, 0.1, false); errl(io, "ERROR: failed to solve: " + (rec.error || "file with no instructions")); return { error: true }; }
    // which stages does the target need?
    var target = o.target ? stages.filter(function (s) { return s.name === o.target; })[0] : stages[stages.length - 1];
    if (!target) { flush(io, hdr, 0.1, false); errl(io, "ERROR: failed to solve: target stage \"" + o.target + "\" could not be found"); return { error: true }; }
    stages.forEach(function (s, i) { if (!s.name) s.label = "stage-" + i; else s.label = s.name; });
    var need = {};
    (function mark(s) { if (need[s.idx]) return; need[s.idx] = true; var ref = stages.filter(function (x) { return x.name === s.from; })[0]; if (ref && ref.idx < s.idx) mark(ref); s.instrs.forEach(function (ins) { if (ins.kw !== "COPY") return; var f = flagsOf(ins.args).flags.from; if (f == null) return; var r2 = stages.filter(function (x) { return x.name === f || String(x.idx) === f; })[0]; if (r2) mark(r2); }); })(target);
    // warnings: Docker 27 build checks
    var warns = [];
    parsed.instrs.forEach(function (ins) {
      if ((ins.kw === "CMD" || ins.kw === "ENTRYPOINT") && !ins.json) warns.push("JSONArgsRecommended: JSON arguments recommended for " + ins.kw + " to prevent unintended behavior related to OS signals (line " + ins.line + ")");
      if (ins.kw === "ENV" || ins.kw === "ARG") pairs(ins.args).forEach(function (p) { if (SECRET_NAME.test(p[0]) && !/PUBLIC|_FILE$|PATH/i.test(p[0])) warns.push("SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (" + ins.kw + " \"" + p[0] + "\") (line " + ins.line + ")"); });
      if (ins.kw === "FROM" && /\s+as\s+/.test(ins.args) && ins.raw === "FROM") warns.push("FromAsCasing: 'as' and 'FROM' keywords' casing do not match (line " + ins.line + ")");
      if (ins.kw === "MAINTAINER") warns.push("MaintainerDeprecated: Maintainer instruction is deprecated in favor of using label (line " + ins.line + ")");
    });
    rec.warnings = warns;
    // metadata for base images
    var bases = {};
    stages.forEach(function (s) { if (!need[s.idx]) return; var f = subst(s.from, globalArgs); if (f === "scratch" || stages.some(function (x) { return x.name === f && x.idx < s.idx; })) return; bases[f] = true; });
    var pulled = {};
    var metaFail = null;
    Object.keys(bases).forEach(function (ref) {
      var local = Dk.findImage(sys, ref);
      if (local && !o.pull) { pulled[ref] = local; line("[internal] load metadata for " + Dk.fullName(Dk.parseRef(ref)), 0.0); return; }
      var p = Dk.parseRef(ref), deny = Dk.regAccess(sess, p, false), hit = !deny && Dk.regLookup(sys, p);
      if (deny || !hit) { metaFail = metaFail || { ref: ref, deny: deny }; line("[internal] load metadata for " + Dk.fullName(p), 0.4, "ERROR"); return; }
      pulled[ref] = { remote: hit };
      line("[internal] load metadata for " + Dk.fullName(p), 0.9);
    });
    var ctx = contextFiles(sys, o.ctxDir);
    line("[internal] load .dockerignore", 0.0);
    line("=> transferring context: " + Dk.human((Dk.fsNode(sys, o.ctxDir + "/.dockerignore") || { content: "" }).content.length || 2), 0.0, "sub");
    if (metaFail) {
      flush(io, hdr, 1.1, false);
      var p2 = Dk.parseRef(metaFail.ref);
      errl(io, "ERROR: failed to solve: " + metaFail.ref + ": failed to resolve source metadata for " + Dk.fullName(p2) + ": " + (metaFail.deny ? (/unauthorized/.test(metaFail.deny) ? "unexpected status from HEAD request to https://" + p2.registry + "/v2/" + p2.repo + "/manifests/" + p2.tag + ": 401 Unauthorized" : "pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed") : Dk.fullName(p2) + ": not found"));
      rec.error = "base"; return { error: true };
    }
    var ctxShown = false;
    var results = {}, total = 0;
    var buildArgsUsed = {};
    // build each needed stage in order
    for (var si = 0; si < stages.length; si++) {
      var st = stages[si];
      if (!need[si]) continue;
      var fromRef = subst(st.from, globalArgs), baseImg, baseLayers, cfg;
      var prev = stages.filter(function (x) { return x.name === fromRef && x.idx < si; })[0];
      if (prev) { baseImg = results[prev.idx].img; baseLayers = results[prev.idx].layers.slice(); cfg = cloneCfg(results[prev.idx].cfg); }
      else if (fromRef === "scratch") { baseImg = null; baseLayers = []; cfg = { Env: [], Cmd: null, Entrypoint: null, WorkingDir: "", User: "", ExposedPorts: {}, Volumes: {}, Labels: {}, Healthcheck: null }; }
      else {
        var pi = pulled[fromRef];
        if (pi.remote) { pi = Dk.addImage(sys, pi.remote.img, Dk.parseRef(fromRef).tag ? fromRef : null); pi.digests[Dk.repoName(Dk.parseRef(fromRef))] = pulled[fromRef].remote.digest; pulled[fromRef] = pi; }
        baseImg = pi; baseLayers = pi.layers.slice(); cfg = cloneCfg(pi.cfg);
      }
      var n = 1 + st.instrs.filter(function (x) { return /^(RUN|COPY|ADD|WORKDIR)$/.test(x.kw); }).length, k = 1;
      var hist = baseImg ? baseImg.history.slice() : [];
      var chain = "base:" + (baseImg ? baseImg.id : "scratch");
      var dig = baseImg && Object.keys(baseImg.digests || {}).length ? baseImg.digests[Object.keys(baseImg.digests)[0]] : null;
      line(stepLabel(st.label, Object.keys(need).length, 1, n) + " FROM " + (fromRef === "scratch" || prev ? fromRef : Dk.fullName(Dk.parseRef(fromRef)) + (dig ? "@" + dig.slice(0, 19) + "…" : "")), prev ? 0.0 : (pulled[fromRef] && pulled[fromRef].loadedAt === clock(sys) ? 3.1 : 0.0));
      var args = {}, stageLayers = [];
      Object.keys(globalArgs).forEach(function () {});
      var userVars = function () { var v = envMap(cfg); Object.keys(args).forEach(function (a) { if (v[a] == null) v[a] = args[a]; }); return v; };
      for (var ii = 0; ii < st.instrs.length; ii++) {
        var ins = st.instrs[ii]; if (/^(RUN|COPY|ADD|WORKDIR)$/.test(ins.kw)) k++;
        var label = stepLabel(st.label, Object.keys(need).length, k, n) + " " + ins.kw + " " + ins.args;
        var vars = userVars();
        if (ins.kw === "ARG") { pairs(ins.args).forEach(function (p) { var v = o.args[p[0]] != null ? o.args[p[0]] : p[1] != null ? subst(p[1], vars) : globalArgs[p[0]]; args[p[0]] = v == null ? "" : v; if (o.args[p[0]] != null) buildArgsUsed[p[0]] = true; }); chain += "|ARG " + ins.args + "=" + JSON.stringify(args); continue; }
        if (ins.kw === "ENV") { pairs(ins.args).forEach(function (p) { setEnv(cfg, p[0], subst(p[1] == null ? "" : p[1], vars)); }); hist.push({ by: "ENV " + pairs(ins.args).map(function (p) { return p[0] + "=" + subst(p[1] == null ? "" : p[1], vars); }).join(" "), size: 0, created: clock(sys), empty: true, buildkit: true }); chain += "|ENV " + JSON.stringify(cfg.Env); continue; }
        if (ins.kw === "LABEL") { pairs(ins.args).forEach(function (p) { cfg.Labels[p[0]] = subst(p[1] || "", vars); }); hist.push({ by: "LABEL " + ins.args, size: 0, created: clock(sys), empty: true, buildkit: true }); continue; }
        if (ins.kw === "EXPOSE") { ins.args.split(/\s+/).forEach(function (p) { p = subst(p, vars); cfg.ExposedPorts[/\//.test(p) ? p : p + "/tcp"] = {}; }); hist.push({ by: "EXPOSE map[" + Object.keys(cfg.ExposedPorts).map(function (p) { return p + ":{}"; }).join(" ") + "]", size: 0, created: clock(sys), empty: true, buildkit: true }); continue; }
        if (ins.kw === "USER") { cfg.User = subst(ins.args.trim(), vars); hist.push({ by: "USER " + cfg.User, size: 0, created: clock(sys), empty: true, buildkit: true }); chain += "|USER " + cfg.User; continue; }
        if (ins.kw === "CMD" || ins.kw === "ENTRYPOINT") {
          var argv = ins.json || ["/bin/sh", "-c", ins.args];
          if (ins.kw === "ENTRYPOINT") { cfg.Entrypoint = argv; if (!st.instrs.slice(ii + 1).some(function (x) { return x.kw === "CMD"; })) cfg.Cmd = null; }
          else cfg.Cmd = argv;
          hist.push({ by: ins.kw + " " + JSON.stringify(argv).replace(/","/g, "\" \""), size: 0, created: clock(sys), empty: true, buildkit: true });
          continue;
        }
        if (ins.kw === "VOLUME") { (ins.json || ins.args.split(/\s+/)).forEach(function (p) { cfg.Volumes[p] = {}; }); hist.push({ by: "VOLUME [" + Object.keys(cfg.Volumes).join(" ") + "]", size: 0, created: clock(sys), empty: true, buildkit: true }); continue; }
        if (ins.kw === "STOPSIGNAL") { cfg.StopSignal = ins.args.trim(); continue; }
        if (ins.kw === "SHELL" || ins.kw === "ONBUILD" || ins.kw === "MAINTAINER") { continue; }
        if (ins.kw === "HEALTHCHECK") {
          if (/^NONE$/i.test(ins.args.trim())) cfg.Healthcheck = { Test: ["NONE"] };
          else {
            var hf = flagsOf(ins.args), cm = /^CMD\s+(.*)$/i.exec(hf.rest.trim());
            var hj = null; if (cm && /^\[/.test(cm[1])) { try { hj = JSON.parse(cm[1]); } catch (e) { hj = null; } }
            cfg.Healthcheck = { Test: hj ? ["CMD"].concat(hj) : ["CMD-SHELL", cm ? cm[1] : hf.rest], Interval: Dk.parseDuration(hf.flags.interval || "30s"), Timeout: Dk.parseDuration(hf.flags.timeout || "30s"), StartPeriod: Dk.parseDuration(hf.flags["start-period"] || "0s"), Retries: +(hf.flags.retries || 3) };
          }
          hist.push({ by: "HEALTHCHECK &{" + JSON.stringify(cfg.Healthcheck.Test) + "}", size: 0, created: clock(sys), empty: true, buildkit: true });
          continue;
        }
        // file-system steps: WORKDIR, COPY, ADD, RUN
        var curMap = Dk.merge(baseLayers.concat(stageLayers));
        var key, stepRes;
        if (ins.kw === "WORKDIR") {
          var wd = subst(ins.args.trim(), vars); if (wd.charAt(0) !== "/") wd = S.normAbs((cfg.WorkingDir || "/") + "/" + wd);
          cfg.WorkingDir = wd;
          key = chain + "|WORKDIR " + wd;
          stepRes = cached(d, key, o) || mkdirLayer(curMap, wd);
        } else if (ins.kw === "COPY" || ins.kw === "ADD") {
          var cr = copyStep(sess, ins, st, stages, results, ctx, curMap, cfg, vars, o);
          if (cr.error) {
            if (!ctxShown && !cr.fromStage) { line("[internal] load build context", 0.1); line("=> transferring context: " + Dk.human(ctx.bytes), 0.1, "sub"); ctxShown = true; }
            line(label, 0.0, "ERROR"); rec.steps.push({ label: label, error: cr.error });
            flush(io, hdr, clock(sys) - t0 + 1.4, false);
            errl(io, "------\n > " + label + ":\n------\n" + snippet(parsed, ins) + "ERROR: failed to solve: " + cr.error);
            rec.error = cr.error; return { error: true };
          }
          if (!ctxShown && !cr.fromStage) { line("[internal] load build context", 0.1 + ctx.bytes / 4e8); line("=> transferring context: " + Dk.human(ctx.bytes), ctx.bytes / 4e8, "sub"); ctxShown = true; Dk.tick(sys, ctx.bytes / 4e8); }
          key = chain + "|" + ins.kw + " " + ins.args + "#" + cr.sum;
          stepRes = cached(d, key, o) || { files: cr.files, secs: 0.1 + Dk.mapSize(cr.files) / 5e8 };
        } else if (ins.kw === "RUN") {
          var rf = flagsOf(ins.args), cmdText = rf.rest;
          var argNames = Object.keys(args).filter(function (a) { return args[a] != null && args[a] !== ""; });
          key = chain + "|RUN " + ins.args + "|args:" + JSON.stringify(argNames.map(function (a) { return [a, args[a]]; })) + "|env:" + JSON.stringify(cfg.Env) + "|u:" + cfg.User + "|w:" + cfg.WorkingDir;
          stepRes = cached(d, key, o);
          if (!stepRes) {
            var rr = runStep(sess, curMap, cfg, args, ins, rf, cmdText, o);
            if (rr.error) {
              line(label, rr.secs, "ERROR"); rec.steps.push({ label: label, error: true, out: rr.lines });
              flush(io, hdr, clock(sys) - t0 + rr.secs, false);
              errl(io, "------\n > " + label + ":\n" + rr.lines.map(function (l, x) { return (0.1 + x * 0.05 + rr.secs * x / Math.max(1, rr.lines.length)).toFixed(3) + " " + l; }).join("\n") + (rr.lines.length ? "\n" : "") + "------\n" + snippet(parsed, ins) + "ERROR: failed to solve: " + rr.error);
              rec.error = rr.error; Dk.tick(sys, rr.secs); return { error: true };
            }
            stepRes = { files: rr.files, secs: rr.secs, out: rr.lines };
          }
          var histBy = "RUN " + (argNames.length ? "|" + argNames.length + " " + argNames.map(function (a) { return a + "=" + args[a]; }).join(" ") + " " : "") + (ins.json ? JSON.stringify(ins.json) : "/bin/sh -c " + cmdText) + " # buildkit";
          stepRes.histBy = histBy;
        }
        var isCached = !!stepRes.cached;
        if (!isCached) d.cache[key] = { files: stepRes.files, secs: stepRes.secs, out: stepRes.out, histBy: stepRes.histBy, layerId: Dk.sha("layer:" + key) };
        var ent = d.cache[key];
        var L = { id: ent.layerId, by: ins.kw === "RUN" ? ent.histBy || stepRes.histBy : ins.kw === "WORKDIR" ? "WORKDIR " + cfg.WorkingDir : ins.kw + " " + ins.args + " # buildkit", size: Dk.mapSize(ent.files), files: ent.files, created: clock(sys), key: key };
        if (Object.keys(ent.files).length || ins.kw !== "WORKDIR") stageLayers.push(L);
        hist.push({ by: L.by, size: L.size, created: clock(sys), empty: false, buildkit: true });
        chain = key;
        line((isCached ? "CACHED " : "") + label, isCached ? 0.0 : stepRes.secs);
        rec.steps.push({ label: label, cached: isCached, secs: isCached ? 0 : stepRes.secs, size: L.size, kw: ins.kw, out: stepRes.out || ent.out || [] });
        if (o.plain && !isCached && (stepRes.out || []).length) hdr[hdr.length - 1].out = stepRes.out;
        if (!isCached) Dk.tick(sys, stepRes.secs);
        total += isCached ? 0 : stepRes.secs;
      }
      if (st.instrs.some(function (x) { return x.kw === "USER"; }) === false && prev) { /* inherited user */ }
      results[si] = { layers: baseLayers.concat(stageLayers), cfg: cfg, img: baseImg, hist: hist, chain: chain, stage: st };
    }
    var fin = results[target.idx];
    var img = Dk.makeImage({ id: Dk.sha("built:" + fin.chain + JSON.stringify(fin.cfg)), layers: fin.layers, cfg: fin.cfg, history: fin.hist, created: clock(sys), os: (fin.img && fin.img.os) || "", built: true });
    img.created = clock(sys);
    img.buildCtx = o.ctxDir;
    img.buildArgs = Object.keys(buildArgsUsed);
    var existing = d.images.filter(function (x) { return x.id === img.id; })[0];
    var stored = Dk.addImage(sys, existing || img, null);
    if (!existing) stored.created = clock(sys);
    (o.tags || []).forEach(function (t) { Dk.setTag(sys, stored, t); });
    line("exporting to image", 0.2);
    line("=> exporting layers", 0.2, "sub");
    line("=> writing image " + stored.id, 0.0, "sub");
    (o.tags || []).forEach(function (t) { line("=> naming to " + Dk.fullName(Dk.parseRef(t)), 0.0, "sub"); });
    Dk.tick(sys, 0.3);
    flush(io, hdr, clock(sys) - t0, true);
    if (warns.length) errl(io, "\n " + warns.length + " warning" + (warns.length === 1 ? "" : "s") + " found (use docker --debug to expand):\n" + warns.map(function (w) { return " - " + w; }).join("\n"));
    rec.ok = true; rec.img = stored.id; rec.size = stored.size; rec.secs = clock(sys) - t0;
    Dk.ev(sys, { kind: "build", image: stored.id, ref: (o.tags || [])[0] || stored.id.slice(7, 19) });
    if (o.quiet) { out(io, stored.id + "\n"); }
    return { img: stored };
  }
  Dk.build = build;
  function cached(d, key, o) { var c = !o.noCache && d.cache[key]; return c ? { files: c.files, secs: c.secs, cached: true, out: c.out, histBy: c.histBy } : null; }
  function mkdirLayer(map, wd) {
    var f = {};
    if (!map[wd]) { Dk.parentDirs(wd + "/x").forEach(function (p) { if (!map[p]) f[p] = Dk.Dd(); }); }
    return { files: f, secs: 0.1 };
  }
  // "Dockerfile:4 -------------------- ... >>> RUN ..." block
  function snippet(parsed, ins) {
    var L = parsed.lines, from = Math.max(0, ins.line - 3), to = Math.min(L.length, ins.lastLine + 2), rows = [];
    for (var i = from; i < to; i++) { if (i === L.length - 1 && L[i] === "") continue; var mark = i + 1 >= ins.line && i + 1 <= ins.lastLine; rows.push(("   " + (i + 1)).slice(-4) + " | " + (mark ? ">>> " : "    ") + L[i]); }
    return "Dockerfile:" + ins.line + "\n--------------------\n" + rows.join("\n") + "\n--------------------\n";
  }
  function flush(io, hdr, secs, ok) {
    var steps = hdr.filter(function (h) { return h.mark !== "sub"; }).length;
    var done = hdr.filter(function (h) { return h.mark !== "sub" && h.mark !== "ERROR"; }).length;
    out(io, "[+] Building " + secs.toFixed(1) + "s (" + done + "/" + steps + ")" + (ok ? " FINISHED" : "") + "\n");
    hdr.forEach(function (h) {
      var lab = (h.mark === "sub" ? " => " : h.mark === "ERROR" ? " => ERROR " : " => ") + h.label;
      if (lab.length > 60) lab = lab.slice(0, 59) + "…";
      out(io, (lab + new Array(Math.max(2, 63 - lab.length)).join(" ")) + (h.secs || 0).toFixed(1) + "s\n");
      (h.out || []).forEach(function (l) { out(io, "    " + l + "\n"); });
    });
  }

  /* ---------------- COPY / ADD */
  function copyStep(sess, ins, st, stages, results, ctx, curMap, cfg, vars, o) {
    var f = flagsOf(ins.args), parts = ins.json || f.rest.match(/"[^"]*"|\S+/g) || [];
    if (ins.json && /^--/.test(ins.args)) parts = JSON.parse(f.rest);
    parts = parts.map(function (p) { return subst(p.replace(/^"|"$/g, ""), vars); });
    if (parts.length < 2) return { error: ins.kw + " requires at least two arguments, but only one was provided. Destination could not be determined." };
    var dest = parts.pop(), srcs = parts;
    var wd = cfg.WorkingDir || "/";
    var dabs = dest.charAt(0) === "/" ? dest : S.normAbs(wd + "/" + dest);
    var destDir = /\/$/.test(dest) || dest === "." || srcs.length > 1 || (curMap[dabs] && curMap[dabs].t === "d");
    var source, fromStage = null;
    if (f.flags.from != null) {
      var fs2 = stages.filter(function (x) { return x.name === f.flags.from || String(x.idx) === f.flags.from; })[0];
      if (fs2 && results[fs2.idx]) { source = Dk.merge(results[fs2.idx].layers); fromStage = fs2.label; }
      else { var fi = Dk.findImage(sess.sys, f.flags.from) || (Dk.regLookup(sess.sys, Dk.parseRef(f.flags.from)) || {}).img; if (!fi) return { error: f.flags.from + ": failed to resolve source metadata for " + Dk.fullName(Dk.parseRef(f.flags.from)) + ": not found" }; source = Dk.merge(fi.layers); fromStage = f.flags.from; }
    }
    var srcMap = {};
    if (source) Object.keys(source).forEach(function (p) { srcMap[p.slice(1)] = source[p]; });
    else srcMap = ctx.files;
    var owner = null;
    if (f.flags.chown) {
      var ue = Dk.userEntry({ root: Dk.treeFrom(curMap) }, f.flags.chown);
      var ug = String(f.flags.chown).split(":");
      if (!ue && !/^\d+(:\d+)?$/.test(f.flags.chown)) return { error: "failed to compute cache key: failed to calculate checksum: unable to convert uid/gid chown string to host mapping: can't find uid for user " + ug[0] + ": no such user: " + ug[0] };
      owner = ue || { uid: +ug[0], gid: +(ug[1] || ug[0]) };
      if (ug[1] && !/^\d+$/.test(ug[1])) { var gl = (curMap["/etc/group"] || { c: "" }).c.split("\n").filter(function (l) { return l.split(":")[0] === ug[1]; })[0]; if (gl) owner.gid = +gl.split(":")[2]; }
    }
    var mode = f.flags.chmod ? parseInt(f.flags.chmod, 8) : null;
    var files = {}, sumParts = [];
    for (var i = 0; i < srcs.length; i++) {
      var s = srcs[i].replace(/^\.\/+/, "").replace(/^\/+/, ""), matched = [];
      if (/^https?:\/\//.test(s) && ins.kw === "ADD") { var nm = s.split("/").pop() || "index.html"; var target = destDir ? dabs + "/" + nm : dabs; files[target] = { t: "f", c: "(downloaded from " + s + ")\n", m: 384, u: 0, g: 0, sz: 2.4e6 }; sumParts.push(s); continue; }
      var pat = s === "." || s === "" ? null : new RegExp("^" + s.replace(/\/+$/, "").replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "(/.*)?$");
      Object.keys(srcMap).forEach(function (rel) {
        if (source && rel === "") return;
        if (!pat) { matched.push({ rel: rel, sub: rel }); return; }
        var m = pat.exec(rel); if (!m) return;
        var top = rel.slice(0, rel.length - (m[1] || "").length);
        matched.push({ rel: rel, top: top, sub: m[1] ? m[1].slice(1) : null });
      });
      if (!matched.length) return { error: fromStage ? "failed to compute cache key: failed to calculate checksum of ref " + Dk.hex("ref" + s, 25) + "::" + Dk.hex("ref2" + s, 25) + ": \"/" + s + "\": not found" : "failed to compute cache key: failed to calculate checksum of ref " + Dk.hex("ref" + s, 25) + "::" + Dk.hex("ref2" + s, 25) + ": \"/" + s + "\": not found", fromStage: fromStage };
      var tops = {}; matched.forEach(function (x) { if (x.top) tops[x.top] = true; });
      var singleFile = pat && Object.keys(tops).length === 1 && srcMap[Object.keys(tops)[0]] && srcMap[Object.keys(tops)[0]].t !== "d";
      matched.forEach(function (x) {
        var e = srcMap[x.rel], rel;
        if (!pat) rel = x.rel;
        else if (srcMap[x.top] && srcMap[x.top].t === "d") rel = x.sub;           // a directory: copy its contents
        else rel = x.top.split("/").pop();
        if (rel == null) return;
        var target = !pat ? dabs + "/" + rel : singleFile && !destDir ? dabs : dabs + (rel ? "/" + rel : "");
        if (!rel && srcMap[x.top] && srcMap[x.top].t === "d") { if (!curMap[dabs]) files[dabs] = Dk.Dd(493, owner ? owner.uid : 0, owner ? owner.gid : 0); return; }
        var ne = Object.assign({}, e); ne.u = owner ? owner.uid : source ? e.u : 0; ne.g = owner ? owner.gid : source ? e.g : 0;
        if (mode != null && ne.t === "f") ne.m = mode;
        files[S.normAbs(target)] = ne;
        sumParts.push(x.rel + ":" + (e.t === "f" ? M2.hexOf(e.c + (e.sz || ""), 12) : e.t) + ":" + (e.m || 0));
      });
    }
    // parent directories that don't exist yet
    Object.keys(files).forEach(function (p) { Dk.parentDirs(p).forEach(function (q) { if (!curMap[q] && !files[q]) files[q] = Dk.Dd(493, 0, 0); }); });
    return { files: files, sum: M2.hexOf(sumParts.sort().join("|") + JSON.stringify(f.flags), 32), fromStage: fromStage };
  }

  /* ---------------- RUN: a throwaway container */
  function runStep(sess, curMap, cfg, args, ins, rf, cmdText, o) {
    var sys = sess.sys;
    var rootN = Dk.treeFrom(curMap, Dk.stamp(sys));
    if (!curMap["/etc/passwd"]) { var et = rootN.children.etc || (rootN.children.etc = S.dirNode(493, 0, 0)); et.children.passwd = S.fileNode("root:x:0:0:root:/root:/bin/sh\n", 420, 0, 0); et.children.group = S.fileNode("root:x:0:\n", 420, 0, 0); }
    var fs = Dk.newCtrSys(sys, rootN, { hostname: "buildkitsandbox", id: null, build: true, distro: Dk.DISTRO(curMap) });
    fs.buildSecs = 0;
    var mounts = [];
    Object.keys(rf.flags).forEach(function (k) { if (k === "mount") mounts.push(rf.flags[k]); });
    // --mount can repeat: pick them all from the raw text
    var mm, re = /--mount=(\S+)/g; mounts = []; while ((mm = re.exec(ins.args))) mounts.push(mm[1]);
    var cleanup = [];
    for (var i = 0; i < mounts.length; i++) {
      var kv = {}; mounts[i].split(",").forEach(function (x) { var p = x.split("="); kv[p[0]] = p.length > 1 ? p.slice(1).join("=") : true; });
      if (kv.type === "secret") {
        var id = kv.id, sec = (o.secrets || {})[id], target = kv.target || kv.dst || "/run/secrets/" + id;
        if (sec != null) { S.put(fs, target, sec, 256, 0, 0); cleanup.push(target); }
        else if (kv.required === "true") return { error: "secret " + id + ": not found", lines: [], secs: 0.1 };
      } else if (kv.type === "cache") cleanup.push((kv.target || kv.dst) + "/*");
    }
    var ue = Dk.userEntry(fs, cfg.User || "");
    if (!ue) return { error: "unable to find user " + cfg.User + ": no matching entries in passwd file", lines: [], secs: 0.1 };
    var bs = S.newSession(fs, { user: ue.name || "root" });
    bs.vars = {};
    var env = envMap(cfg); Object.keys(args).forEach(function (a) { if (env[a] == null) env[a] = args[a]; });
    if (!env.PATH) env.PATH = Dk.PATHV;
    env.HOME = env.HOME || ue.home;
    Object.keys(env).forEach(function (k) { bs.vars[k] = { v: env[k], x: true }; });
    bs.vars.IFS = { v: " \t\n", x: false };
    bs.uid = ue.uid; bs.gid = ue.gid; bs.user = ue.name || "I have no name!"; bs.home = ue.home; bs.groups = ue.name ? S.supplementary(fs, ue.name) : []; bs.umask = 18;
    var wd = cfg.WorkingDir || "/"; if (!Dk.fsNode(fs, wd)) S.mkdirs(fs, wd);
    bs.cwd = wd; bs.vars.PWD = { v: wd, x: true };
    var cap = Dk.capture();
    var argv = ins.json ? ins.json : ["/bin/sh", "-c", cmdText];
    var found = S.resolveCommand(bs, argv[0]);
    if (found.error) return { error: "process \"" + argv.join(" ") + "\" did not complete successfully: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: exec: \"" + argv[0] + "\": " + (/\//.test(argv[0]) ? "stat " + argv[0] + ": no such file or directory" : "executable file not found in $PATH") + ": unknown", lines: [], secs: 0.1 };
    var code;
    try { code = S.runCommand(bs, argv, cap.io); }
    catch (e) {
      if (e instanceof S.ExitSignal) code = e.code;
      else if (e instanceof S.ShError) { cap.io.err(e.message + "\n"); code = e.code; }
      else if (e instanceof S.StepLimit) { cap.io.err("(the command ran too long)\n"); code = 137; }
      else throw e;
    }
    var lines = cap.text().replace(/\n$/, "").split("\n").filter(function (l, i, all) { return l !== "" || i < all.length - 1; });
    if (!cap.text()) lines = [];
    var secs = Math.max(0.2, (fs.buildSecs || 0) + 0.2 + (fs.sleptFg || 0));
    if (code) return { error: "process \"" + (ins.json ? argv.join(" ") : "/bin/sh -c " + cmdText) + "\" did not complete successfully: exit code: " + code, lines: lines, secs: secs };
    // what changed
    cleanup.forEach(function (p) {
      if (/\/\*$/.test(p)) { var dn = Dk.fsNode(fs, p.slice(0, -2)); if (dn && dn.children) dn.children = {}; }
      else { var dir = Dk.fsNode(fs, p.slice(0, p.lastIndexOf("/"))); if (dir && dir.children) delete dir.children[p.split("/").pop()]; }
    });
    var after = Dk.mapFrom(fs.root, "/");
    ["/etc/hostname", "/etc/hosts", "/etc/resolv.conf"].forEach(function (p) { if (curMap[p]) after[p] = curMap[p]; else delete after[p]; });
    var files = Dk.diff(curMap, after);
    return { files: files, lines: lines, secs: secs };
  }

  /* ================================================================== docker build CLI */
  Dk.SUB.build = function (a, io, sess, sub) {
    var o = Dk.parseArgs(a, { "t|tag": "list", "f|file": true, "build-arg": "list", "no-cache": false, "target": true, "secret": "list", "progress": true, "pull": false, "q|quiet": false, "platform": true, "label": "list", "load": false, "push": false, "network": true, "rm": false, "force-rm": false, "cache-from": "list", "help": false }, sub, io);
    if (!o) return 1;
    if (o.help) { out(io, "\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nStart a build\n\nOptions:\n      --build-arg stringArray   Set build-time variables\n  -f, --file string             Name of the Dockerfile (default: \"PATH/Dockerfile\")\n      --no-cache                Do not use cache when building the image\n      --progress string         Set type of progress output (\"auto\", \"plain\", \"tty\", \"quiet\")\n      --secret stringArray      Secret to expose to the build (format: \"id=mysecret[,src=/local/secret]\")\n  -t, --tag stringArray         Name and optionally a tag (format: \"name:tag\")\n      --target string           Set the target build stage to build\n"); return 0; }
    if (o._.length !== 1) { errl(io, "ERROR: \"docker buildx build\" requires exactly 1 argument.\nSee 'docker buildx build --help'.\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n\nStart a build"); return 1; }
    var tags = o.tag || [];
    for (var i = 0; i < tags.length; i++) { var p = Dk.parseRef(tags[i]); if (!p.valid || /[A-Z]/.test(tags[i].split(":")[0])) { errl(io, "ERROR: invalid tag \"" + tags[i] + "\": repository name must be lowercase"); return 1; } }
    var args = {};
    (o["build-arg"] || []).forEach(function (kv) { var k = kv.indexOf("="); if (k < 0) { var v = S.getVar(sess, kv); if (v !== undefined) args[kv] = v; } else args[kv.slice(0, k)] = kv.slice(k + 1); });
    var secrets = {};
    for (var s = 0; s < (o.secret || []).length; s++) {
      var kvs = {}; o.secret[s].split(",").forEach(function (x) { var q = x.split("="); kvs[q[0]] = q.slice(1).join("="); });
      var src = kvs.src || kvs.source, envName = kvs.env;
      if (src) { var r = S.readFile(sess, Dk.absHost(sess, src)); if (r.error) { errl(io, "ERROR: failed to stat " + Dk.absHost(sess, src) + ": stat " + Dk.absHost(sess, src) + ": no such file or directory"); return 1; } secrets[kvs.id] = r.content; }
      else if (envName) secrets[kvs.id] = S.getVar(sess, envName) || "";
    }
    var ctxDir = Dk.absHost(sess, o._[0]);
    var res = build(sess, { ctxDir: ctxDir, ctxArg: o._[0], file: o.file, tags: tags, args: args, noCache: o["no-cache"], target: o.target, secrets: secrets, plain: o.progress === "plain", pull: o.pull, quiet: o.quiet }, io);
    if (res.error) return 1;
    if (!tags.length) note(io, "(The image has no name: it shows as <none> in docker images. Use -t NAME:TAG to name it.)");
    return 0;
  };
  Dk.SUB.save = function (a, io) { U.note(io, "(docker save isn't simulated in this lab: use docker history and trivy to look inside images.)"); return 1; };
})(typeof window !== "undefined" ? window : globalThis);
