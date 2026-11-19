/* sudo learn — DevOps Module 2: Kestrel's deploy platform and its CLI, kdeploy. It stands in for what teams use
   Argo Rollouts, Spinnaker, ECS or CodeDeploy for: a service ("notes") runs as a fleet of instances in staging
   and production; rollouts are rolling, blue-green or canary (with automatic analysis of the new version's error
   rate), every rollout is a revision you can roll back to, and production can require images signed by a given
   CI workflow. The fleet answers HTTP at https://staging.notes.kestrel.io, https://notes.kestrel.io and the
   blue-green preview hosts, so curl shows which version is live. State lives on the simulated GitHub's hub, so
   the laptop, Actions runners and Jenkins/Bamboo agents all see the same platform. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk, GH = root.GitHub, A = root.GitActions, G = root.GitCore, CI = root.CI;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  function now(sys) { return G.clock(CI.homeSys(sys)); }

  /* ================================================================== state */
  function fleet(sys) { var h = CI.hubOf(sys); if (!h.fleet) h.fleet = { services: {}, tokens: {}, events: [] }; return h.fleet; }
  CI.fleet = fleet;
  var ENV_SIZE = { dev: 1, staging: 2, production: 4 };
  function hostFor(svc, env, color) { return (color ? color + "." : "") + (env === "production" ? "" : env + ".") + svc + ".kestrel.io"; }
  CI.fleetHost = hostFor;
  // What an image would do in production: its version, whether it starts, how many requests fail.
  CI.FLEET_BUGS = [
    { re: /request\.args\[\s*["']limit["']\s*\]/, rate: 23.4, why: "GET /notes → 400 Bad Request unless the URL has ?limit= (the code reads request.args[\"limit\"])" },
    { re: /raise\s+RuntimeError\(\s*["']boom/, rate: 100, why: "every request raises RuntimeError" },
    { re: /time\.sleep\(\s*[3-9]/, rate: 6.8, why: "requests that hit time.sleep() → 504 Gateway Timeout" }
  ];
  function appSrcOf(img) { var m = Dk.merge(img.layers); var f = keys(m).filter(function (p) { return /^\/app\/(app|api|main)\.py$/.test(p) && m[p].t === "f"; })[0]; return f ? m[f].c : ""; }
  function profile(sys, ref) {
    var hit = CI.resolveRemote(sys, ref);
    if (!hit) return null;
    var img = hit.img, src = appSrcOf(img), map = Dk.merge(img.layers);
    var ver = (img.cfg.Labels || {})["org.opencontainers.image.version"] || ((/^VERSION\s*=\s*["']([^"']+)["']/m.exec(src) || [])[1]) || "unknown";
    if (/^sha-|^[0-9a-f]{7,40}$|^main$/.test(ver)) ver = ((/^VERSION\s*=\s*["']([^"']+)["']/m.exec(src) || [])[1]) || ver;
    var starts = !!src, why = src ? null : "no app in /app";
    if (src) {
      var site = keys(map).filter(function (p) { return /site-packages\/[^/]+$/.test(p) && map[p].t === "d"; }).map(function (p) { return p.split("/").pop().toLowerCase(); });
      src.split("\n").forEach(function (l) { var m = /^\s*(?:from\s+(\w+)\s+import|import\s+(\w+))/.exec(l); if (!m || !starts) return; var mod = (m[1] || m[2]).toLowerCase(); if (["os", "sys", "json", "time", "logging", "re", "datetime", "uuid", "pathlib"].indexOf(mod) >= 0) return; if (site.indexOf(mod) < 0) { starts = false; why = "ModuleNotFoundError: No module named '" + mod + "'"; } });
    }
    var bug = CI.FLEET_BUGS.filter(function (b) { return b.re.test(src); })[0];
    return { ref: ref, p: hit.p, digest: hit.digest, name: Dk.repoName(hit.p), version: ver, starts: starts, why: why, errRate: bug ? bug.rate : 0.2, bug: bug ? bug.why : null, img: img };
  }
  CI.imageProfile = profile;
  // Lab setup: put a service on the platform
  CI.fleetSetup = function (sys, svcName, envs, o) {
    var F = fleet(sys); o = o || {};
    var svc = F.services[svcName] = F.services[svcName] || { name: svcName, envs: {} };
    keys(envs).forEach(function (env) {
      var pr = profile(sys, envs[env]); if (!pr) throw new Error("fleetSetup: no image " + envs[env]);
      var n = ENV_SIZE[env] || 2, rev = { rev: 1, ref: pr.name + "@" + pr.digest, digest: pr.digest, version: pr.version, strategy: "initial", status: "succeeded", by: "maya-chen", t: now(sys) - 86400 * 3, note: "initial" };
      svc.envs[env] = { name: env, size: n, live: "blue", insts: [], revs: [rev], current: rev, rollout: null, policy: {}, reqs: 0 };
      for (var i = 1; i <= n; i++) svc.envs[env].insts.push({ id: "web-" + i, version: pr.version, digest: pr.digest, color: "blue", ok: true });
    });
    return svc;
  };
  CI.fleetToken = function (sys, envs, label) { var F = fleet(sys), t = "kdp_" + M2.hashChars("kdp" + envs.join(",") + (label || "") + keys(F.tokens).length, 32, "abcdefghijklmnopqrstuvwxyz0123456789"); F.tokens[t] = { envs: envs, label: label || "", revoked: false }; return t; };
  function envOf(sys, svcName, env) { var s = fleet(sys).services[svcName]; return s ? s.envs[env] : null; }
  CI.fleetEnv = envOf;
  function ev(sys, e) { var F = fleet(sys); e.t = now(sys); e.where = sys.isRunner ? "actions" : sys.jenkinsAgent ? "jenkins" : sys.bambooAgent ? "bamboo" : "laptop"; e.run = sys.runId || null; F.events.push(e); }
  function shortDg(d) { return d.slice(0, 19) + "…"; }

  /* ================================================================== traffic */
  function live(E) { return E.insts.filter(function (i) { return i.color === E.live; }); }
  function trafficSplit(E) {
    var ro = E.rollout, L = live(E), cur = E.current;
    if (ro && ro.strategy === "canary" && (ro.status === "running" || ro.status === "paused") && ro.weight > 0) return [{ version: cur.version, digest: cur.digest, w: 100 - ro.weight }, { version: ro.version, digest: ro.digest, w: ro.weight }];
    var byV = {}; L.forEach(function (i) { byV[i.version + "|" + i.digest] = (byV[i.version + "|" + i.digest] || 0) + 1; });
    return keys(byV).map(function (k) { return { version: k.split("|")[0], digest: k.split("|")[1], w: Math.round(byV[k] / L.length * 100) }; });
  }
  CI.trafficSplit = trafficSplit;
  function errRateFor(sys, E, digest) { var pr = E.profiles && E.profiles[digest]; return pr ? pr.errRate : 0.2; }
  function remember(E, pr) { E.profiles = E.profiles || {}; E.profiles[pr.digest] = { errRate: pr.errRate, version: pr.version, bug: pr.bug }; }

  /* ================================================================== the CLI */
  function tokenFor(sess) {
    var t = S.getVar(sess, "KDEPLOY_TOKEN");
    if (!t) { var f = M2.rd(sess.sys, (sess.uid === 0 ? "/root" : sess.home) + "/.kdeploy/token"); if (f) t = f.trim(); }
    return t || null;
  }
  function auth(sess, io, env) {
    var t = tokenFor(sess), F = fleet(sess.sys);
    if (!t) { errl(io, "Error: no credentials: set KDEPLOY_TOKEN, or put a token in ~/.kdeploy/token"); return null; }
    var e = F.tokens[t];
    if (!e || e.revoked) { errl(io, "Error: unauthorized: invalid or revoked token"); return null; }
    if (env && e.envs.indexOf(env) < 0) { errl(io, "Error: forbidden: this token can only deploy to " + e.envs.join(", ") + ", not " + env); return null; }
    return e;
  }
  function flags(a) { var o = { _: [] }; for (var i = 0; i < a.length; i++) { var m = /^--([\w-]+)(?:=(.*))?$/.exec(a[i]); if (m) { var bool = /^(wait|manual|auto-promote|auto-rollback|no-auto-rollback|require-signature|no-require-signature|json|yes)$/.test(m[1]); o[m[1]] = m[2] != null ? m[2] : bool ? true : a[++i]; } else o._.push(a[i]); } return o; }
  function pad(s, n) { s = String(s); return s.length >= n ? s : s + new Array(n - s.length + 1).join(" "); }
  function line(io, t) { out(io, t + "\n"); }
  CMDS.kdeploy = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), sub = a.shift(), o = flags(a), F = fleet(sys), svcName = o.service || o.s || "notes", svc = F.services[svcName];
    if (sub === "--version" || sub === "version") { line(io, "kdeploy 3.2.0 (Kestrel deploy platform)"); return 0; }
    if (!sub || sub === "help" || sub === "--help") { out(io, "kdeploy: deploy to Kestrel's platform\n\nUsage:\n  kdeploy status [ENV]                       what runs where\n  kdeploy rollout ENV --image REF [flags]    start a rollout\n      --strategy rolling|blue-green|canary   (default rolling)\n      --max-unavailable N                    rolling: instances replaced at a time (default 1)\n      --canary-steps 10,50,100               canary: traffic steps (default 10,50,100)\n      --max-error-rate PCT                   canary: abort above this error rate (default 1)\n      --manual                               canary/blue-green: stop and wait for kdeploy promote\n      --auto-rollback                        rolling: roll back if instances fail health checks\n  kdeploy promote ENV                        continue a paused canary / switch blue-green traffic\n  kdeploy abort ENV                          stop a rollout and send all traffic back\n  kdeploy rollback ENV [--to REVISION]       redeploy the previous (or a given) revision\n  kdeploy history ENV                        past revisions\n  kdeploy metrics ENV                        traffic and error rate per version\n  kdeploy policy show|set ENV [--require-signature --identity-regexp RE --issuer URL]\n\nAuthentication: KDEPLOY_TOKEN or ~/.kdeploy/token. Service: --service NAME (default notes).\n"); return 0; }
    if (!svc) { errl(io, "Error: service \"" + svcName + "\" not found"); return 1; }
    var envName = o._[0], E = envName ? svc.envs[envName] : null;
    if (sub === "status") {
      if (!auth(sess, io, null)) return 1;
      if (envName && !E) { errl(io, "Error: environment \"" + envName + "\" not found (have: " + keys(svc.envs).join(", ") + ")"); return 1; }
      if (!envName) {
        var rows = [["SERVICE", "ENV", "REVISION", "VERSION", "IMAGE", "INSTANCES", "TRAFFIC"]];
        keys(svc.envs).forEach(function (k) { var e2 = svc.envs[k], L = live(e2), ok = L.filter(function (i) { return i.ok; }).length; rows.push([svcName, k, String(e2.current.rev), e2.current.version, e2.current.ref.replace(/@(sha256:[0-9a-f]{12}).*$/, "@$1…"), ok + "/" + e2.size + " ready", trafficSplit(e2).map(function (x) { return x.w + "% " + x.version; }).join(", ") + (e2.rollout && e2.rollout.status !== "done" ? " (" + e2.rollout.strategy + " " + e2.rollout.status + ")" : "")]); });
        out(io, Dk.table(rows)); return 0;
      }
      line(io, "Service:   " + svcName + "\nEnv:       " + envName + "  (https://" + hostFor(svcName, envName) + ")\nRevision:  " + E.current.rev + " (" + E.current.strategy + ", " + E.current.status + ")\nImage:     " + E.current.ref + "\nVersion:   " + E.current.version + "\nTraffic:   " + trafficSplit(E).map(function (x) { return x.w + "% → " + x.version; }).join(", "));
      if (E.rollout && E.rollout.status !== "done") line(io, "Rollout:   " + E.rollout.strategy + " of " + E.rollout.version + " is " + E.rollout.status + (E.rollout.strategy === "canary" ? " at " + E.rollout.weight + "%" : "") + (E.rollout.status === "paused" ? " (kdeploy promote " + envName + " to continue, kdeploy abort " + envName + " to cancel)" : ""));
      line(io, "\nINSTANCE  COLOR  VERSION  HEALTH");
      E.insts.forEach(function (i) { line(io, pad(i.id, 10) + pad(i.color + (i.color === E.live ? "*" : ""), 7) + pad(i.version, 9) + (i.ok ? "ok" : "failing")); });
      return 0;
    }
    if (!E && sub !== "policy") { errl(io, envName ? "Error: environment \"" + envName + "\" not found (have: " + keys(svc.envs).join(", ") + ")" : "Error: an environment is required, e.g. kdeploy " + sub + " staging"); return 1; }
    if (sub === "history") {
      if (!auth(sess, io, null)) return 1;
      out(io, Dk.table([["REVISION", "VERSION", "STRATEGY", "STATUS", "BY", "IMAGE"]].concat(E.revs.slice().reverse().map(function (r) { return [String(r.rev) + (r === E.current ? "*" : ""), r.version, r.strategy, r.status, r.by, r.ref.replace(/@(sha256:[0-9a-f]{12}).*$/, "@$1…")]; }))));
      return 0;
    }
    if (sub === "metrics") {
      if (!auth(sess, io, null)) return 1;
      var split = trafficSplit(E), total = 200 + (E.size * 10);
      line(io, svcName + " / " + envName + " (last 5 minutes)");
      var rows = split.map(function (x) { var er = errRateFor(sys, E, x.digest); return [x.version, x.w + "%", (total * x.w / 100).toFixed(1), er.toFixed(1) + "%", (38 + (er > 5 ? 7 : 3)) + "ms"]; });
      var lc = E.lastCanary;
      if (lc && now(sys) - lc.t < 300 && !split.some(function (x) { return x.digest === lc.digest; })) rows.push([lc.version + " (canary, aborted)", "0% (was " + lc.weight + "%)", (total * lc.weight / 100).toFixed(1), lc.errRate.toFixed(1) + "%", "45ms"]);
      out(io, Dk.table([["VERSION", "TRAFFIC", "REQUESTS/S", "ERRORS", "P95 LATENCY"]].concat(rows)));
      if (lc && now(sys) - lc.t < 300 && lc.bug) line(io, "\nTop errors for " + lc.version + ": " + lc.bug);
      return 0;
    }
    if (sub === "policy") {
      var verb = o._[0]; envName = o._[1]; var E2 = svc.envs[envName];
      if (!E2) { errl(io, "Error: usage: kdeploy policy show|set ENV"); return 1; }
      if (verb === "show") { if (!auth(sess, io, null)) return 1; line(io, "Policy for " + svcName + "/" + envName + ":\n  require-signature: " + !!E2.policy.requireSignature + (E2.policy.requireSignature ? "\n  identity-regexp:   " + E2.policy.identityRe + "\n  issuer:            " + E2.policy.issuer : "")); return 0; }
      if (verb !== "set") { errl(io, "Error: usage: kdeploy policy show|set ENV"); return 1; }
      var au = auth(sess, io, envName); if (!au) return 1;
      if (au.label === "ci") { errl(io, "Error: forbidden: CI tokens can't change deploy policy"); return 1; }
      if (o["require-signature"]) {
        if (!o["identity-regexp"] || !o.issuer) { errl(io, "Error: --require-signature needs --identity-regexp and --issuer (the same values you'd give cosign verify)"); return 1; }
        try { new RegExp(o["identity-regexp"]); } catch (e) { errl(io, "Error: invalid --identity-regexp"); return 1; }
        E2.policy = { requireSignature: true, identityRe: o["identity-regexp"], issuer: o.issuer };
      } else if (o["no-require-signature"]) E2.policy = {};
      line(io, "✓ Policy for " + svcName + "/" + envName + " updated: require-signature=" + !!E2.policy.requireSignature);
      ev(sys, { kind: "policy", env: envName });
      return 0;
    }
    var who = auth(sess, io, envName); if (!who) return 1;
    var actor = sys.isRunner ? "github-actions" : sys.jenkinsAgent ? "jenkins" : sys.bambooAgent ? "bamboo" : "kc-dev";
    function newRev(pr, strategy, status, note) { var r = { rev: E.revs.length + 1, ref: pr.name + "@" + pr.digest, digest: pr.digest, version: pr.version, strategy: strategy, status: status, by: actor, t: now(sys), note: note || "", run: sys.runId || null }; E.revs.push(r); return r; }
    function checkPolicy(pr) {
      var pol = E.policy; if (!pol || !pol.requireSignature) return true;
      var reg = CI.regOf(sys, pr.p.registry), sigs = ((reg && reg.sigs) || {})[pr.digest] || [];
      var re = new RegExp(pol.identityRe), okSig = sigs.filter(function (x) { return x.keyless && x.issuer === pol.issuer && re.test(x.identity); });
      if (!okSig.length) { line(io, "✗ policy: " + envName + " requires an image signed by an identity matching " + pol.identityRe + " (issuer " + pol.issuer + ")"); errl(io, "Error: admission denied: " + (sigs.length ? "no signature from a trusted identity on " : "no signature found for ") + pr.name + "@" + pr.digest); ev(sys, { kind: "denied", env: envName, digest: pr.digest }); return false; }
      line(io, "✓ policy: signature verified (" + okSig[0].identity + ")");
      return true;
    }
    if (sub === "rollout") {
      if (!o.image) { errl(io, "Error: --image is required"); return 1; }
      if (E.rollout && (E.rollout.status === "running" || E.rollout.status === "paused")) { errl(io, "Error: a " + E.rollout.strategy + " rollout of " + E.rollout.version + " is already " + E.rollout.status + " in " + envName + ": kdeploy promote or kdeploy abort it first"); return 1; }
      var pr = profile(sys, o.image);
      if (!pr) { errl(io, "Error: image " + o.image + " not found in the registry (did the build push it?)"); return 1; }
      remember(E, pr);
      var strat = o.strategy || "rolling";
      if (["rolling", "blue-green", "canary"].indexOf(strat) < 0) { errl(io, "Error: unknown strategy \"" + strat + "\": use rolling, blue-green or canary"); return 1; }
      line(io, "Rolling out " + pr.name + "@" + shortDg(pr.digest) + " (version " + pr.version + ") to " + svcName + "/" + envName + " with strategy " + strat);
      if (!checkPolicy(pr)) return 1;
      if (pr.digest === E.current.digest && !E.rollout) { line(io, "✓ " + envName + " already runs this image (revision " + E.current.rev + "): nothing to do"); return 0; }
      if (strat === "rolling") {
        var mu = Math.max(1, +(o["max-unavailable"] || 1)), L = live(E), changed = [];
        for (var i = 0; i < L.length; i += mu) {
          var batch = L.slice(i, i + mu);
          for (var b = 0; b < batch.length; b++) {
            var inst = batch[b];
            line(io, "→ " + inst.id + ": draining, stopping " + inst.version + ", starting " + pr.version);
            var old = { version: inst.version, digest: inst.digest };
            inst.version = pr.version; inst.digest = pr.digest; changed.push({ inst: inst, old: old });
            if (!pr.starts) {
              inst.ok = false;
              line(io, "✗ " + inst.id + ": health check failed: GET /health: connection refused (container exited: " + pr.why + ")");
              if (o["auto-rollback"]) {
                changed.forEach(function (c) { c.inst.version = c.old.version; c.inst.digest = c.old.digest; c.inst.ok = true; });
                newRev(pr, "rolling", "rolled-back", pr.why);
                line(io, "✗ rollout failed; rolled back " + changed.length + " instance(s) to " + E.current.version);
                ev(sys, { kind: "rollout", env: envName, strategy: "rolling", version: pr.version, status: "rolled-back" });
                return 1;
              }
              E.rollout = { strategy: "rolling", status: "paused", version: pr.version, digest: pr.digest, ref: pr.name + "@" + pr.digest, failed: true };
              newRev(pr, "rolling", "failed", pr.why);
              line(io, "✗ rollout paused with " + changed.length + "/" + L.length + " instance(s) on " + pr.version + " (unhealthy). Fix forward, or: kdeploy rollback " + envName);
              ev(sys, { kind: "rollout", env: envName, strategy: "rolling", version: pr.version, status: "failed" });
              return 1;
            }
            line(io, "✓ " + inst.id + ": healthy (" + pr.version + ")");
          }
        }
        E.current = newRev(pr, "rolling", "succeeded");
        E.rollout = null;
        line(io, "✓ rollout complete: " + L.length + "/" + L.length + " instances on " + pr.version + " (revision " + E.current.rev + ")");
        if (pr.errRate > 2) line(io, "  note: instances pass health checks; check the error rate with kdeploy metrics " + envName);
        ev(sys, { kind: "rollout", env: envName, strategy: "rolling", version: pr.version, status: "succeeded" });
        return 0;
      }
      if (strat === "blue-green") {
        var idle = E.live === "blue" ? "green" : "blue";
        E.insts = E.insts.filter(function (x) { return x.color === E.live; });
        for (var k = 1; k <= E.size; k++) E.insts.push({ id: "web-" + idle.charAt(0) + k, version: pr.version, digest: pr.digest, color: idle, ok: pr.starts });
        line(io, "→ started " + E.size + " " + idle + " instance(s) on " + pr.version + " next to " + E.live + " (" + E.current.version + ")");
        if (!pr.starts) { line(io, "✗ " + idle + " instances fail health checks (" + pr.why + "). Traffic stays on " + E.live + "."); E.rollout = { strategy: "blue-green", status: "failed", version: pr.version, digest: pr.digest, ref: pr.name + "@" + pr.digest, idle: idle }; newRev(pr, "blue-green", "failed", pr.why); ev(sys, { kind: "rollout", env: envName, strategy: "blue-green", version: pr.version, status: "failed" }); return 1; }
        line(io, "✓ " + idle + " is healthy. Preview it at https://" + hostFor(svcName, envName, idle));
        E.rollout = { strategy: "blue-green", status: "paused", version: pr.version, digest: pr.digest, ref: pr.name + "@" + pr.digest, idle: idle };
        ev(sys, { kind: "rollout", env: envName, strategy: "blue-green", version: pr.version, status: "paused" });
        if (o["auto-promote"]) return CMDS.kdeploy(["kdeploy", "promote", envName, "--service", svcName], io, sess);
        line(io, "  live traffic still goes to " + E.live + ". Switch it with: kdeploy promote " + envName);
        return 0;
      }
      // canary
      var steps = String(o["canary-steps"] || "10,50,100").split(",").map(Number).filter(function (x) { return x > 0 && x <= 100; });
      var maxErr = o["max-error-rate"] != null ? +o["max-error-rate"] : 1;
      E.rollout = { strategy: "canary", status: "running", version: pr.version, digest: pr.digest, ref: pr.name + "@" + pr.digest, steps: steps, step: 0, weight: 0, maxErr: maxErr, manual: !!o.manual, pr: pr };
      if (!pr.starts) { line(io, "✗ canary instance fails health checks (" + pr.why + "): aborting, no traffic was sent to it"); E.rollout = null; newRev(pr, "canary", "aborted", pr.why); ev(sys, { kind: "rollout", env: envName, strategy: "canary", version: pr.version, status: "aborted" }); return 1; }
      return canaryAdvance(sys, io, svcName, envName, E, newRev);
    }
    if (sub === "promote") {
      var ro = E.rollout;
      if (!ro || (ro.status !== "paused" && ro.status !== "running")) { errl(io, "Error: nothing to promote in " + envName); return 1; }
      if (ro.strategy === "blue-green") {
        var pr2 = { name: ro.ref.split("@")[0], digest: ro.digest, version: ro.version };
        line(io, "→ switching " + envName + " traffic from " + E.live + " (" + E.current.version + ") to " + ro.idle + " (" + ro.version + ")");
        var oldColor = E.live; E.live = ro.idle;
        E.insts = E.insts.filter(function (x) { return x.color === E.live; }).map(function (x, i) { x.id = "web-" + (i + 1); return x; });
        E.current = newRev(pr2, "blue-green", "succeeded");
        E.rollout = null;
        line(io, "✓ " + ro.version + " is live (revision " + E.current.rev + "); " + oldColor + " instances stopped");
        ev(sys, { kind: "rollout", env: envName, strategy: "blue-green", version: ro.version, status: "succeeded" });
        return 0;
      }
      ro.status = "running";
      return canaryAdvance(sys, io, svcName, envName, E, newRev);
    }
    if (sub === "abort") {
      var ro2 = E.rollout;
      if (!ro2 || ro2.status === "done") { errl(io, "Error: no rollout in progress in " + envName); return 1; }
      if (ro2.strategy === "blue-green") E.insts = E.insts.filter(function (x) { return x.color === E.live; });
      if (ro2.strategy === "rolling") E.insts.forEach(function (x) { x.version = E.current.version; x.digest = E.current.digest; x.ok = true; });
      var abRev = newRev({ name: ro2.ref.split("@")[0], digest: ro2.digest, version: ro2.version }, ro2.strategy, "aborted", "aborted by " + actor);
      void abRev;
      E.rollout = null;
      line(io, "✓ aborted the " + ro2.strategy + " rollout of " + ro2.version + ": 100% of " + envName + " traffic is on " + E.current.version);
      ev(sys, { kind: "rollout", env: envName, strategy: ro2.strategy, version: ro2.version, status: "aborted" });
      return 0;
    }
    if (sub === "rollback") {
      var target;
      if (o.to) { target = E.revs.filter(function (r) { return String(r.rev) === String(o.to); })[0]; if (!target) { errl(io, "Error: no revision " + o.to + " in " + envName + " (kdeploy history " + envName + ")"); return 1; } if (target.status !== "succeeded") { errl(io, "Error: revision " + o.to + " never succeeded (" + target.status + ")"); return 1; } }
      else { var good = E.revs.filter(function (r) { return r.status === "succeeded" && r.digest !== E.current.digest && r.rev < E.current.rev; }); target = good[good.length - 1]; if (!target && E.rollout && E.rollout.failed) target = E.current; if (!target) { errl(io, "Error: no earlier successful revision to roll back to"); return 1; } }
      E.rollout = null;
      E.insts = E.insts.filter(function (x) { return x.color === E.live; });
      E.insts.forEach(function (x) { x.version = target.version; x.digest = target.digest; x.ok = true; });
      var rb = newRev({ name: target.ref.split("@")[0], digest: target.digest, version: target.version }, "rollback", "succeeded", "rollback to revision " + target.rev);
      E.current = rb;
      line(io, "✓ rolled back " + svcName + "/" + envName + " to revision " + target.rev + " (" + target.version + "): now revision " + rb.rev + ", " + E.size + "/" + E.size + " instances healthy");
      ev(sys, { kind: "rollback", env: envName, version: target.version });
      return 0;
    }
    errl(io, "Error: unknown command \"" + sub + "\" (kdeploy help)"); return 1;
  };
  function canaryAdvance(sys, io, svcName, envName, E, newRev) {
    var ro = E.rollout, pr = { name: ro.ref.split("@")[0], digest: ro.digest, version: ro.version }, base = errRateFor(sys, E, E.current.digest), cand = errRateFor(sys, E, ro.digest);
    while (ro.step < ro.steps.length) {
      var w = ro.steps[ro.step];
      ro.weight = w;
      line(io, "→ canary " + w + "%: " + w + "% of " + envName + " traffic to " + ro.version);
      if (w < 100) {
        line(io, "  analysis (2m): error rate " + ro.version + " " + cand.toFixed(1) + "% vs " + E.current.version + " " + base.toFixed(1) + "% (max " + ro.maxErr + "%)");
        if (cand > ro.maxErr) {
          E.lastCanary = { version: ro.version, digest: ro.digest, weight: w, errRate: cand, bug: (E.profiles && E.profiles[ro.digest] || {}).bug || null, t: now(sys) };
          ro.status = "aborted"; ro.weight = 0;
          newRev(pr, "canary", "aborted", "error rate " + cand.toFixed(1) + "% > " + ro.maxErr + "%");
          E.rollout = null;
          line(io, "✗ canary analysis failed at " + w + "%: error rate " + cand.toFixed(1) + "% > " + ro.maxErr + "%. Rolled back: 100% of traffic is on " + E.current.version + ".");
          ev(sys, { kind: "rollout", env: envName, strategy: "canary", version: ro.version, status: "aborted", at: w });
          return 1;
        }
        line(io, "  ✓ analysis passed");
      }
      ro.step++;
      if (ro.manual && ro.step < ro.steps.length && w < 100) { ro.status = "paused"; line(io, "⏸ canary paused at " + w + "%. Continue with: kdeploy promote " + envName + " (or kdeploy abort " + envName + ")"); ev(sys, { kind: "rollout", env: envName, strategy: "canary", version: ro.version, status: "paused", at: w }); return 0; }
    }
    E.insts.forEach(function (x) { x.version = ro.version; x.digest = ro.digest; x.ok = true; });
    E.current = newRev(pr, "canary", "succeeded");
    E.rollout = null;
    line(io, "✓ canary complete: " + ro.version + " serves 100% of " + envName + " (revision " + E.current.rev + ")");
    ev(sys, { kind: "rollout", env: envName, strategy: "canary", version: ro.version, status: "succeeded" });
    return 0;
  }

  /* ================================================================== the service's URLs */
  if (M2.net && M2.net.SITES) {
    var IPS = { production: "198.51.100.40", staging: "198.51.100.41" };
    ["", "green.", "blue."].forEach(function (pre, k) {
      ["production", "staging"].forEach(function (env, j) {
        var host = (pre ? pre : "") + (env === "production" ? "" : env + ".") + "notes.kestrel.io", ip = "198.51.100." + (40 + j + k * 2);
        M2.net.DNS[host] = { A: [ip] };
        M2.net.HOSTS[ip] = { ping: 4.2, ports: [80, 443], site: "kfleet:" + env + ":" + (pre.replace(".", "") || "live") };
        M2.net.SITES["kfleet:" + env + ":" + (pre.replace(".", "") || "live")] = function (req, sys) { return serve(sys, "notes", env, pre.replace(".", "") || null, req); };
      });
    });
    void IPS;
  }
  function jres(status, obj) { return { status: status, headers: { "Content-Type": "application/json", Server: "kestrel-edge" }, body: JSON.stringify(obj) + "\n" }; }
  function serve(sys, svcName, env, color, req) {
    var E = envOf(sys, svcName, env);
    if (!E) return { status: 503, headers: { "Content-Type": "text/plain", Server: "kestrel-edge" }, body: "no healthy upstream\n" };
    var pick;
    if (color) { var cs = E.insts.filter(function (x) { return x.color === color; }); if (!cs.length) return { status: 503, headers: { "Content-Type": "text/plain", Server: "kestrel-edge" }, body: "no healthy upstream\n" }; pick = cs[0]; }
    else {
      E.reqs = (E.reqs || 0) + 1;
      var split = trafficSplit(E), r = (E.reqs * 37) % 100, acc = 0, chosen = split[0];
      for (var i = 0; i < split.length; i++) { acc += split[i].w; if (r < acc) { chosen = split[i]; break; } }
      var L = live(E).filter(function (x) { return x.digest === chosen.digest && x.ok; });
      pick = L[(E.reqs) % Math.max(1, L.length)] || { id: "web-canary", version: chosen.version, digest: chosen.digest, ok: true };
      if (!live(E).some(function (x) { return x.ok; })) return { status: 503, headers: { "Content-Type": "text/plain", Server: "kestrel-edge" }, body: "no healthy upstream\n" };
    }
    var p = req.path.split("?")[0], prof = (E.profiles || {})[pick.digest];
    if (p === "/health") return pick.ok ? jres(200, { status: "ok", version: pick.version, instance: pick.id }) : { status: 502, headers: { "Content-Type": "text/plain" }, body: "Bad Gateway\n" };
    if (p === "/") return jres(200, { service: svcName, version: pick.version });
    if (p === "/notes") { var bad = prof && prof.bug && /limit=/.test(prof.bug) && !/limit=/.test(req.path); return bad ? { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", Server: "gunicorn" }, body: "<!doctype html>\n<html lang=en>\n<title>400 Bad Request</title>\n<h1>Bad Request</h1>\n<p>The browser (or proxy) sent a request that this server could not understand.</p>\n" } : jres(200, []); }
    if (p === "/export" && prof && prof.bug && /sleep/.test(prof.bug)) return { status: 504, headers: { "Content-Type": "text/html", Server: "kestrel-edge" }, body: "<html><body><h1>504 Gateway Time-out</h1>\nThe server didn't respond in time.\n</body></html>\n" };
    return jres(404, { error: "not found" });
  }
  CI.fleetServe = serve;

  /* ================================================================== the setup action */
  CI.addActionRepos({ "kestrel/setup-kdeploy": { v: ["v1.0.0", "v1.2.0"], desc: "Install kdeploy, the Kestrel deploy platform CLI" } });
  A.action("kestrel/setup-kdeploy", { run: function (J, s) { CI.putBin(J.rs, "/opt/kdeploy/bin/kdeploy", "kdeploy"); J.pathAdd.push("/opt/kdeploy/bin"); J.log(s, "Downloading kdeploy 3.2.0 from https://deploy.kestrel.io/releases/kdeploy-3.2.0-linux-amd64.tar.gz\nkdeploy 3.2.0 added to the PATH"); return { code: 0, secs: 2, outputs: { version: "3.2.0" } }; } });
})(typeof window !== "undefined" ? window : globalThis);
