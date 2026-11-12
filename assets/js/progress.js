/* sudo learn — shared progress store (localStorage, per browser) and track catalogue. */
(function () {
  "use strict";
  var KEY = "sudolearn.progress.v1";
  var CODE_KEY = "sudolearn.code.v1";

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: play without saving */ }
  }

  var RANKS = [
    { min: 0, name: "guest" },
    { min: 300, name: "user" },
    { min: 800, name: "operator" },
    { min: 1600, name: "sysadmin" },
    { min: 3000, name: "root" }
  ];

  // The learning path, in the order the learner chose.
  var TRACKS = [
    { id: "python", name: "Python", path: "python/", status: "open", color: "#ffd43b", labs: 36,
      blurb: "Write real Python that runs in your browser. From variables to a security scanner.",
      topics: ["Basics", "Files & regex", "Automation", "Secure coding"] },
    { id: "powershell", name: "PowerShell", path: "powershell/", status: "open", color: "#5ea5ff", labs: 36,
      blurb: "Automate Windows admin and security work with objects and pipelines. Runs in a simulated PowerShell 7.",
      topics: ["Pipeline", "Windows system", "GUI tools", "Security"] },
    { id: "linux", name: "Linux", path: "linux/", status: "open", color: "#fb923c", labs: 36,
      blurb: "Live in the terminal: files, permissions, services, Bash scripts and server security. A simulated Ubuntu server in your browser.",
      topics: ["Shell", "Running a server", "Bash scripting", "Security"] },
    { id: "git", name: "Git & GitHub", path: "git/", status: "open", color: "#f05133", labs: 36,
      blurb: "Track changes, branch, merge, and collaborate the way engineering teams do.",
      topics: ["Commits", "Branches", "Pull requests", "Actions"] },
    { id: "networking", name: "Networking", path: "networking/", status: "outline", color: "#22d3ee", labs: 48,
      blurb: "Climb the OSI layers, learn the ports that matter, read captured traffic, catch attacks and lock down networks, on-prem and in the cloud.",
      topics: ["OSI layers", "Ports", "Packet capture", "Attacks & defence", "Cloud networks"] },
    { id: "devops", name: "DevOps", path: "devops/", status: "outline", color: "#a78bfa", labs: 49,
      blurb: "Containers, CI/CD pipelines in GitHub Actions and Bamboo, infrastructure as code, Kubernetes and observability, with security at every step.",
      topics: ["Docker", "CI/CD", "Terraform & Ansible", "Kubernetes", "Observability"] },
    { id: "appsec", name: "AppSec & Security", path: "appsec/", status: "outline", color: "#4ade80", labs: 46,
      blurb: "Attack a deliberately vulnerable web shop, then fix its code: injection, XSS, auth, access control, APIs, and AppSec in the pipeline.",
      topics: ["OWASP Top 10", "Auth & access", "API security", "Code review", "SAST/DAST"] }
  ];

  var SL = {
    TRACKS: TRACKS,
    load: function () { return read(KEY); },
    trackData: function (track) {
      var p = read(KEY);
      return p[track] || { labs: {} };
    },
    lab: function (track, lab) {
      return this.trackData(track).labs[lab] || {};
    },
    setLab: function (track, lab, data) {
      var p = read(KEY);
      p[track] = p[track] || { labs: {} };
      p[track].labs[lab] = Object.assign(p[track].labs[lab] || {}, data);
      write(KEY, p);
    },
    resetTrack: function (track) {
      var p = read(KEY);
      delete p[track];
      write(KEY, p);
      var c = read(CODE_KEY);
      Object.keys(c).forEach(function (k) { if (k.indexOf(track + "/") === 0) delete c[k]; });
      write(CODE_KEY, c);
    },
    trackXP: function (track) {
      var labs = this.trackData(track).labs, x = 0;
      for (var k in labs) x += labs[k].xp || 0;
      return x;
    },
    trackDone: function (track) {
      var labs = this.trackData(track).labs, n = 0;
      for (var k in labs) if (labs[k].done) n++;
      return n;
    },
    totalXP: function () {
      var x = 0;
      for (var i = 0; i < TRACKS.length; i++) x += this.trackXP(TRACKS[i].id);
      return x;
    },
    rank: function (xp) {
      var r = RANKS[0], i;
      for (i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].min) r = RANKS[i];
      var idx = RANKS.indexOf(r);
      return { name: r.name, min: r.min, next: RANKS[idx + 1] || null };
    },
    getCode: function (track, lab) {
      return read(CODE_KEY)[track + "/" + lab];
    },
    setCode: function (track, lab, code) {
      var c = read(CODE_KEY);
      if (code == null) delete c[track + "/" + lab];
      else c[track + "/" + lab] = code;
      write(CODE_KEY, c);
    }
  };

  window.SL = SL;
})();
