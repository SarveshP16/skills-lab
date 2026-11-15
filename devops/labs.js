/* sudo learn — DevOps track, Module 1: Containers with Docker (DEV-101..105; 106..110 are in labs-b.js).
   Terminal-first labs on the dev laptop kc-dev-01 with a simulated Docker Engine 27 (dk-*.js). Dockerfiles and
   compose.yaml are written in the editor panel (nano FILE). Checks read what your commands printed and what the
   Docker daemon holds (DevLab.H), including containers you've since removed, so tasks stay ticked. */
(function () {
  "use strict";
  var S = window.ShEngine, Dk = window.Dk, DL = window.DevLab, H = DL.H, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev";

  /* ---------------- helpers shared by every DevOps lab file */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ex(cmd) { return '<pre class="ex">' + esc(cmd) + "</pre>"; }
  function code(text) { return '<pre class="code">' + esc(text) + "</pre>"; }
  function sc() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  // A reference solution: strings are commands; {nano: PATH, text} is a file written in the editor.
  function sol() {
    var outL = [];
    Array.prototype.slice.call(arguments).forEach(function (x) {
      if (typeof x === "string") outL.push(x);
      else { outL.push("nano " + x.nano); x.text.replace(/\n$/, "").split("\n").forEach(function (l) { outL.push("    " + l); }); }
    });
    return outL.join("\n");
  }
  function out(e) { return e.out.join("\n"); }
  function all(e) { return e.lines.map(function (l) { return l.text; }).join("\n"); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function idx(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  var RUN = /^\s*(sudo\s+)?docker\s+(container\s+)?run\b/;
  var CURL = /^\s*curl\b/;
  function files(base, map) { return function (sys) { DL.setup.files(sys, base, map); }; }
  function both() { var fns = Array.prototype.slice.call(arguments); return function (sys) { fns.forEach(function (f) { if (f) f(sys); }); }; }
  function img(r, ref) { return H.image(r, ref); }
  function readF(r, p) { return r.read(p.replace(/^~/, HOME)); }
  function dockerfileOf(r, dir) { var t = readF(r, dir + "/Dockerfile"); if (t == null) return null; var p = Dk.parseDockerfile(t); return p.error ? { error: p.error, text: t } : { ins: p.instrs, text: t }; }
  function last(arr) { return arr[arr.length - 1]; }
  // the stages of a parsed Dockerfile: [{from, name, ins: [...]}]
  function stages(df) { var st = [], cur = null; df.ins.forEach(function (i) { if (i.kw === "FROM") { var m = /^(\S+)(?:\s+as\s+(\S+))?/i.exec(i.args); cur = { from: m[1], name: m[2] || null, ins: [] }; st.push(cur); } else if (cur) cur.ins.push(i); }); return st; }
  function lastCmdOf(image) { return (image.cfg.Entrypoint || []).concat(image.cfg.Cmd || []).join(" "); }
  function httpOk(r, port, path, re) { return r.history.some(function (e) { return CURL.test(e.cmd) && new RegExp("(localhost|127\\.0\\.0\\.1):" + port + (path ? path.replace(/[.?]/g, "\\$&") : "")).test(e.cmd) && re.test(out(e)); }); }

  /* ---------------- the apps the labs containerise */
  var NOTES_APP = sc(
    "# Kestrel notes API: a tiny note store for the support team",
    "import os",
    "",
    "from flask import Flask, jsonify, request",
    "",
    "VERSION = \"1.0.0\"",
    "NOTES_DIR = os.environ.get(\"NOTES_DIR\", \"/data\")",
    "",
    "app = Flask(__name__)",
    "",
    "",
    "@app.get(\"/\")",
    "def index():",
    "    return jsonify(service=\"notes\", version=VERSION)",
    "",
    "",
    "@app.get(\"/health\")",
    "def health():",
    "    return jsonify(status=\"ok\")",
    "",
    "",
    "@app.get(\"/notes\")",
    "def list_notes():",
    "    if not os.path.isdir(NOTES_DIR):",
    "        return jsonify([])",
    "    names = sorted(os.listdir(NOTES_DIR), key=lambda n: int(n.split(\".\")[0]))",
    "    return jsonify([{\"id\": int(n.split(\".\")[0]), \"text\": open(os.path.join(NOTES_DIR, n)).read().strip()} for n in names])",
    "",
    "",
    "@app.post(\"/notes\")",
    "def add_note():",
    "    os.makedirs(NOTES_DIR, exist_ok=True)",
    "    note_id = len(os.listdir(NOTES_DIR)) + 1",
    "    with open(os.path.join(NOTES_DIR, f\"{note_id}.txt\"), \"w\") as f:",
    "        f.write(request.get_data(as_text=True))",
    "    return jsonify(id=note_id), 201",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    app.run(host=\"0.0.0.0\", port=int(os.environ.get(\"PORT\", \"8000\")))");
  var NOTES_REQ = sc("flask==3.1.1", "gunicorn==23.0.0");
  var NOTES_README = sc("# notes-api", "", "A small Flask API. Run it with: python app.py (listens on 0.0.0.0:8000).", "", "Endpoints: GET /health, GET /notes, POST /notes (the body is the note).");
  var NOTES_TEST = sc("from app import app", "", "", "def test_health():", "    assert app.test_client().get(\"/health\").json == {\"status\": \"ok\"}");
  var NOTES_DF = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  function notesProject(dir, extra) { var m = { "app.py": NOTES_APP, "requirements.txt": NOTES_REQ, "README.md": NOTES_README, "tests/test_app.py": NOTES_TEST }; Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; }); return files(HOME + "/" + (dir || "notes-api"), m); }

  var LABS = [];

  /* ================================================================== DEV-101 */
  LABS.push({
    id: "dev-101", n: 1, module: 1, ticket: "DEV-101", xp: 120, tool: "Docker",
    title: "Containers vs virtual machines",
    topic: "images, containers, what a container isolates",
    from: MAYA,
    story: "<p>Kestrel is moving its services into containers, and your laptop (<code>kc-dev-01</code>) now has Docker. Before we package anything, get a feel for what a container really is: what's inside it, what it shares with the laptop, and what's left behind when it stops.</p>",
    learn:
      "<h3>Two ways to share a machine</h3><p>A <b>virtual machine</b> pretends to be a whole computer: it boots its own kernel and operating system on virtual hardware. A <b>container</b> is just a normal process on your machine that has been given its own view of the world: its own files, its own process list, its own network, its own hostname. It shares the laptop's <b>kernel</b>.</p>" +
      '<table class="t"><tr><th></th><th>Virtual machine</th><th>Container</th></tr><tr><td>Has its own kernel</td><td>yes</td><td>no, uses the host\'s</td></tr><tr><td>Starts in</td><td>tens of seconds</td><td>well under a second</td></tr><tr><td>Size</td><td>gigabytes</td><td>a few MB to a few hundred MB</td></tr><tr><td>Isolation</td><td>strong (separate kernel)</td><td>good, but a kernel bug affects every container</td></tr></table>' +
      "<h3>What does the isolating?</h3><p>Two Linux kernel features:</p><ul><li><b>Namespaces</b> decide what a process can <i>see</i>: its own process list (PID), file system (mount), network, hostname (UTS) and users.</li><li><b>cgroups</b> decide what it can <i>use</i>: memory, CPU, number of processes.</li></ul>" +
      "<h3>Images and containers</h3><p>An <b>image</b> is a read-only template: the files a program needs (a small Linux userland, libraries, your app) plus a default command. It's built from <b>layers</b>, each one a set of file changes stacked on the one below. A <b>container</b> is a running (or stopped) instance of an image: the image's layers, a thin writable layer on top, and a process.</p>" +
      code("image  (read-only layers)  ──docker run──▶  container = image + writable layer + a process") +
      "<h3>Your first commands</h3>" + ex("docker version") + "<p>shows the <b>client</b> (the <code>docker</code> command) and the <b>server</b> (the Docker daemon, <code>dockerd</code>, which does the work).</p>" +
      ex("docker run alpine echo hello") +
      "<p><code>docker run IMAGE COMMAND</code> downloads the image if it isn't on the laptop yet, creates a container from it, runs the command inside, and shows the output. When the command finishes, the container <b>stops</b>, but it isn't deleted:</p>" +
      ex("docker ps") + ex("docker ps -a") + ex("docker images") +
      "<p><code>docker ps</code> lists running containers, <code>-a</code> adds the stopped ones, and <code>docker images</code> lists the images on the laptop. <code>docker rm NAME</code> deletes a stopped container; <code>docker container prune</code> deletes all of them.</p>" +
      '<div class="callout">Alpine Linux is a tiny distribution (about 8 MB) that\'s popular for containers. Its tools come from BusyBox, so their output looks a little different from Ubuntu\'s.</div>',
    system: null,
    starter: "",
    objectives: [
      { id: "hello", text: "Run the <code>hello-world</code> image and read what it says Docker just did.", hints: ["docker run IMAGE", "docker run hello-world"],
        check: function (r) { return ran(r, RUN, function (e) { return /hello-world/.test(e.cmd) && /Hello from Docker!/.test(out(e)); }) ? true : "Run the hello-world image with docker run."; } },
      { id: "os", text: "Run a command in an <code>alpine</code> container that prints its <code>/etc/os-release</code>. The laptop runs Ubuntu: what does the container think it is?", hints: ["docker run IMAGE COMMAND: the command here is cat /etc/os-release", "docker run alpine cat /etc/os-release"],
        check: function (r) { return ran(r, RUN, function (e) { return /\balpine\b/.test(e.cmd) && /Alpine Linux/.test(out(e)); }) ? true : "Run cat /etc/os-release inside an alpine container (docker run alpine ...)."; } },
      { id: "kernel", text: "Show the kernel version on the laptop and inside an alpine container (<code>uname -r</code> in both). Are they different?", hints: ["uname -r on the laptop, then the same command through docker run alpine", "uname -r\ndocker run alpine uname -r"],
        check: function (r) {
          var host = ran(r, /^\s*uname\s+-r\s*$/, function (e) { return /6\.8\.0-48-generic/.test(out(e)); });
          var ctr = ran(r, RUN, function (e) { return /uname\s+-r/.test(e.cmd) && /6\.8\.0-48-generic/.test(out(e)); });
          if (!host) return "Run uname -r on the laptop itself."; return ctr ? true : "Now run uname -r inside a container: docker run alpine uname -r";
        } },
      { id: "pid", text: "Run <code>ps</code> inside an alpine container. How many processes can it see, and what's its PID?", hints: ["docker run alpine ps"],
        check: function (r) { return ran(r, RUN, function (e) { return /\bps\b/.test(e.cmd) && /^\s+1 root\s+0:00 ps/m.test(out(e)); }) ? true : "Run ps in an alpine container: docker run alpine ps"; } },
      { id: "list", text: "List <b>all</b> containers, including the stopped ones your commands left behind.", hints: ["docker ps only shows running containers. One option adds the stopped ones.", "docker ps -a"],
        check: function (r) { return ran(r, /^\s*docker\s+(ps|container\s+(ls|list|ps))\b.*(-a\b|--all)/, function (e) { return (out(e).match(/Exited \(/g) || []).length >= 3; }) ? true : "Run docker ps -a once there are at least three stopped containers to see."; } },
      { id: "clean", text: "Delete every stopped container, so <code>docker ps -a</code> shows none.", hints: ["docker rm NAME deletes one; docker container prune deletes all stopped ones (-f skips the question).", "docker container prune -f\ndocker ps -a"],
        check: function (r) { var d = H.dk(r); if ((d.ever || []).length < 3) return "Run a few containers first (the tasks above)."; return d.ctrs.length === 0 ? true : "There are still " + d.ctrs.length + " container(s): docker container prune -f (or docker rm each one)."; } }
    ],
    solution: sol("docker version", "docker run hello-world", "docker run alpine cat /etc/os-release", "uname -r", "docker run alpine uname -r", "docker run alpine ps", "docker ps", "docker ps -a", "docker images", "docker container prune -f", "docker ps -a"),
    debrief: "<p>The container said it was <b>Alpine Linux</b> while running on an Ubuntu laptop, yet <code>uname -r</code> gave the <b>same kernel</b> in both: the files are the image's, the kernel is shared. Inside, <code>ps</code> was <b>PID 1</b> and could see nothing else. That's a PID namespace.</p><p>Every <code>docker run</code> left a stopped container behind until you pruned them. Next: keeping containers running, reaching them over the network, and looking inside.</p>",
    realworld: "Install Docker Desktop (Windows, macOS) or Docker Engine (Linux) and try the same commands. On Windows and macOS, Docker runs your containers inside a small Linux VM, because containers need a Linux kernel.",
    quiz: [
      { q: "What does a container share with the machine it runs on?", options: ["Nothing: it's a separate computer", "The kernel", "Its root file system", "Its process list"], answer: 1, why: "Containers are processes on the host kernel. Files, processes, network and hostname are separate views made by namespaces." },
      { q: "You ran <code>docker run alpine echo hi</code>. Afterwards the container is...", options: ["deleted automatically", "stopped but still there (docker ps -a)", "still running in the background", "turned into an image"], answer: 1, why: "When its command ends the container stops, and it stays until you docker rm it (or you ran it with --rm)." },
      { q: "An image is to a container as...", options: ["a recipe is to a meal made from it", "a file is to a folder", "a server is to a client", "a log is to a process"], answer: 0, why: "One read-only image can be used to start many containers, each with its own writable layer." }
    ]
  });

  /* ================================================================== DEV-102 */
  LABS.push({
    id: "dev-102", n: 2, module: 1, ticket: "DEV-102", xp: 130, tool: "Docker",
    title: "Running containers",
    topic: "run -d -p --name, logs, exec, stop, rm, restart policies, limits",
    from: MAYA,
    story: "<p>The support team wants a status page, today. Run <b>nginx</b> on your laptop as a background container, check it answers, read its logs, put Kestrel's message on the page, then clean up. While you're at it, start the <b>Redis</b> cache the team uses for local testing, set up so it survives a reboot and can't eat all the laptop's memory.</p>",
    learn:
      "<h3>Long-running containers</h3><p>A web server never finishes, so <code>docker run nginx:1.27</code> would hold your terminal. <code>-d</code> (detached) starts it in the background and prints its ID. Give it a <code>--name</code> so you can refer to it:</p>" +
      ex("docker run -d --name web -p 8080:80 nginx:1.27") +
      "<h3>Publishing ports</h3><p>A container has its own network. Nothing outside can reach it until you <b>publish</b> a port: <code>-p HOST:CONTAINER</code>. <code>-p 8080:80</code> means \"connections to the laptop's port 8080 go to port 80 in the container\".</p>" +
      code("curl localhost:8080  ─▶  laptop :8080  ─▶  docker-proxy  ─▶  web :80 (nginx)") +
      ex("curl localhost:8080") +
      "<h3>Looking at a container</h3>" +
      '<table class="t"><tr><th>Command</th><th>What it does</th></tr><tr><td><code>docker ps</code></td><td>running containers, their status and ports</td></tr><tr><td><code>docker logs web</code></td><td>what the main process printed (stdout and stderr). <code>--tail 20</code>, <code>-f</code> to follow</td></tr><tr><td><code>docker exec web COMMAND</code></td><td>run another command inside the running container</td></tr><tr><td><code>docker exec -it web sh</code></td><td>open a shell inside it (<code>exit</code> to leave)</td></tr><tr><td><code>docker inspect web</code></td><td>every setting, as JSON. <code>-f \'{{.State.Status}}\'</code> picks one</td></tr><tr><td><code>docker stop web</code> / <code>start</code> / <code>restart</code></td><td>stop it (SIGTERM, then SIGKILL after 10 s), start it again</td></tr><tr><td><code>docker rm web</code></td><td>delete it (<code>-f</code> stops it first)</td></tr></table>' +
      "<p><code>-it</code> means interactive with a terminal: you need it whenever you want a prompt inside a container. Without it, <code>sh</code> starts, finds no input, and exits.</p>" +
      "<h3>Restart policies and limits</h3><p>By default a stopped container stays stopped. <code>--restart unless-stopped</code> makes Docker restart it if it crashes or the laptop reboots (but not after you <code>docker stop</code> it). <code>--restart on-failure:3</code> retries a crashing container three times.</p>" +
      "<p>Without limits, a container can use all the machine's memory and CPU. <code>-m 256m</code> (or <code>--memory</code>) caps memory: if the process goes over, the kernel kills it (exit code 137, <code>OOMKilled</code>). <code>--cpus 0.5</code> caps CPU.</p>" +
      ex("docker run -d --name cache --restart unless-stopped -m 256m redis:7-alpine") +
      '<div class="callout">Changes you make inside a container with <code>docker exec</code> live only in that container\'s writable layer. Remove the container and they\'re gone. That\'s fine for a quick test, and it\'s why real changes go into the image (DEV-104) or a volume (DEV-106).</div>',
    system: null,
    starter: "",
    objectives: [
      { id: "web", text: "Run <code>nginx:1.27</code> in the background, named <code>web</code>, with the laptop's port <b>8080</b> published to port 80 in the container.", hints: ["-d for background, --name to name it, -p HOST:CONTAINER", "docker run -d --name web -p 8080:80 nginx:1.27"],
        check: function (r) { var c = H.everNamed(r, "web"); if (!c) return "Start a container named web."; if (!/^nginx:1\.27$/.test(c.imageRef)) return "web should run the nginx:1.27 image (it runs " + c.imageRef + ")."; if (!c.ports.some(function (p) { return p.hostPort === 8080 && p.ctrPort === 80; })) return "Publish the laptop's 8080 to the container's 80: -p 8080:80"; return c.started != null ? true : "web was created but never started."; } },
      { id: "curl", text: "Fetch the page from the laptop with <code>curl</code>.", hints: ["curl localhost:8080"],
        check: function (r) { return httpOk(r, 8080, "", /Welcome to nginx!/) ? true : "curl localhost:8080 should show nginx's welcome page."; } },
      { id: "logs", text: "Show web's logs and find your <code>curl</code> request in them.", hints: ["docker logs NAME"],
        check: function (r) { return ran(r, /^\s*docker\s+(container\s+)?logs\b.*\bweb\b/, function (e) { return /"GET \/ HTTP\/1\.1" 200/.test(all(e)); }) ? true : "Run docker logs web after you've curled the page, so the request is in the log."; } },
      { id: "exec", text: "From inside the running container, replace the page so that <code>curl localhost:8080</code> shows <code>Kestrel status: OK</code>. The page is <code>/usr/share/nginx/html/index.html</code>.", hints: ["docker exec web sh -c '...' runs a shell command inside web. Or open a shell with docker exec -it web sh.", "docker exec web sh -c 'echo \"<h1>Kestrel status: OK</h1>\" > /usr/share/nginx/html/index.html'\ncurl localhost:8080"],
        check: function (r) { var k = idx(r, /^\s*docker\s+(container\s+)?exec\b.*\bweb\b/); if (k < 0) return "Use docker exec to change the file inside web."; return r.history.slice(k).some(function (e) { return CURL.test(e.cmd) && /:8080/.test(e.cmd) && /Kestrel status: OK/.test(out(e)); }) ? true : "After changing it, curl localhost:8080 should show Kestrel status: OK."; } },
      { id: "cache", text: "Run <code>redis:7-alpine</code> in the background named <code>cache</code>, restarting <b>unless stopped</b>, with a memory limit of <b>256 MB</b>.", hints: ["--restart unless-stopped and -m 256m", "docker run -d --name cache --restart unless-stopped -m 256m redis:7-alpine"],
        check: function (r) { var c = H.ctr(r, "cache"); if (!c) return "Start a container named cache."; if (!/^redis:7/.test(c.imageRef)) return "cache should run redis:7-alpine."; if (c.restart.name !== "unless-stopped") return "Its restart policy should be unless-stopped (it's " + c.restart.name + "). Remove it and run it again: settings are fixed when a container is created."; if (c.mem !== 268435456) return "Limit its memory to 256 MB: -m 256m"; return c.state === "running" ? true : "cache isn't running."; } },
      { id: "clean", text: "Stop and remove <code>web</code> (the status page is going on a real server). Leave <code>cache</code> running.", hints: ["docker stop web, then docker rm web (or docker rm -f web)."],
        check: function (r) { if (!H.everNamed(r, "web")) return "Start web first."; if (H.ctr(r, "web")) return "web still exists: docker stop web && docker rm web"; return H.running(r, "cache") ? true : "Keep cache running."; } }
    ],
    solution: sol("docker run -d --name web -p 8080:80 nginx:1.27", "docker ps", "curl localhost:8080", "docker logs web", "docker exec web sh -c 'echo \"<h1>Kestrel status: OK</h1>\" > /usr/share/nginx/html/index.html'", "curl localhost:8080", "docker run -d --name cache --restart unless-stopped -m 256m redis:7-alpine", "docker inspect -f '{{.HostConfig.RestartPolicy.Name}} {{.HostConfig.Memory}}' cache", "docker stop web", "docker rm web", "docker ps -a"),
    debrief: "<p>You ran a server in the background, reached it through a published port, read its logs, changed it from the inside, and cleaned up. That's the daily loop with containers.</p><p>Notice that the page you edited died with the container. Real changes belong in the <b>image</b>: in DEV-104 you'll write a Dockerfile. First, where do images come from?</p>",
    realworld: "docker run -d -p is how people try out almost any server software locally: databases, message queues, monitoring tools. Docker Hub (hub.docker.com) shows each official image's options.",
    quiz: [
      { q: "<code>-p 8080:80</code> means...", options: ["the container listens on 8080", "the laptop's port 8080 forwards to port 80 in the container", "ports 8080 to 80 are opened", "the container can reach the laptop's port 80"], answer: 1, why: "HOST:CONTAINER. The left side is on the laptop, the right side is inside the container." },
      { q: "<code>docker exec -it web sh</code> drops you in a shell. You type <code>exit</code>. What happens to <code>web</code>?", options: ["It stops", "It keeps running: you only left the extra shell", "It's deleted", "It restarts"], answer: 1, why: "exec starts an extra process. The container's main process (nginx) keeps running." },
      { q: "Which restart policy brings a container back after the laptop reboots, but not after you <code>docker stop</code> it?", options: ["no", "on-failure", "unless-stopped", "--rm"], answer: 2, why: "always would also restart it after a reboot even if you'd stopped it; unless-stopped remembers that you stopped it." }
    ]
  });

  /* ================================================================== DEV-103 */
  var WORKERS = { "2.3.0": -60, "2.3.1": -44, "2.4.0": -6 };
  function workerImage(ver) {
    return DL.setup.image(null, { from: "alpine:3.20", key: "worker-" + ver, created: Dk.stamp ? undefined : undefined, layers: [{ by: "COPY worker /usr/local/bin/worker # buildkit", files: { "/usr/local/bin/worker": Dk.bin("dkworker"), "/etc/kestrel-version": Dk.F(ver + "\n") }, size: 9.2e6 }], cfg: { Cmd: ["worker"], Labels: { "org.opencontainers.image.version": ver, "org.opencontainers.image.source": "https://github.com/kestrel-cloud/worker" } } });
  }
  function registrySetup(sys) {
    var digests = {};
    Object.keys(WORKERS).forEach(function (v) { var im = workerImage(v); im.created = S.NOW + WORKERS[v] * 86400000; digests[v] = DL.setup.publish(sys, "registry.kestrel.io/kestrel/worker:" + v, im); });
    DL.setup.publish(sys, "registry.kestrel.io/kestrel/worker:stable", workerImage("2.4.0"));
    var repo = Dk.state(sys).regs["registry.kestrel.io"].repos["kestrel/worker"];
    repo.tags.stable = digests["2.4.0"];
    return digests;
  }
  function deploysFile(sys, digests, ver) {
    DL.setup.files(sys, HOME + "/deploys", { "worker.txt": sc("# What production runs (written by the deploy job)", "service: kestrel-worker", "image: registry.kestrel.io/kestrel/worker@" + digests[ver], "deployed: 2026-10-02 14:20 UTC by deploy-bot", "note: the stable tag was used to pick this build") });
  }
  LABS.push({
    id: "dev-103", n: 3, module: 1, ticket: "DEV-103", xp: 130, tool: "Docker",
    title: "Images & registries",
    topic: "names, tags vs digests, pull, push, docker login",
    from: MAYA,
    story: "<p>Kestrel keeps its own images in a private registry, <code>registry.kestrel.io</code>. Two jobs:</p><ul><li>The incident channel asks <b>which version of the worker production is running</b>. The deploy record in <code>~/deploys/worker.txt</code> has the image it deployed, but no version number, and the <code>stable</code> tag has moved since.</li><li>Publish a small tools image to your own space in the registry, then don't leave your login lying around.</li></ul><p>Your registry token is in <code>~/.kestrel/registry-token</code>.</p>",
    learn:
      "<h3>Image names</h3>" + code("registry.kestrel.io / kestrel / worker : 2.4.0\n└── registry ─────┘   └ repo ───────┘   └ tag ┘\n\npython:3.12-slim   =   docker.io/library/python:3.12-slim") +
      "<p>With no registry in the name, Docker uses <b>Docker Hub</b> (<code>docker.io</code>); official images live under <code>library/</code>. With no tag, Docker uses <code>:latest</code>, which is just a tag name, not \"the newest\".</p>" +
      "<h3>Tags move, digests don't</h3><p>A <b>tag</b> is a label that anyone with push rights can move to a different image. A <b>digest</b> (<code>sha256:...</code>) is the hash of the image's manifest: it identifies exactly one image, forever. Pull or run by digest with <code>@</code>:</p>" +
      ex("docker pull python:3.12-slim") + ex("docker images --digests") + ex("docker run --rm IMAGE@sha256:... ") +
      "<p><code>docker inspect -f '{{.RepoDigests}}' IMAGE</code> shows an image's digests too. Production deploys should use digests (or tags that never move), so what's running can't silently change.</p>" +
      "<h3>Private registries</h3><p>Log in first. Never type a token on the command line (it lands in your shell history); pipe it in:</p>" +
      ex("docker login registry.kestrel.io -u dev --password-stdin < ~/.kestrel/registry-token") +
      "<p>Docker saves the credentials in <code>~/.docker/config.json</code>, <b>only base64-encoded</b>, which anyone who can read that file can decode. That's what the warning is about; on shared machines use a credential helper, and <code>docker logout</code> when you're done.</p>" +
      "<h3>Pushing</h3><p>An image's name says where it goes. To push, give it a name in the registry with <code>docker tag</code> (a new name for the same image), then push:</p>" +
      ex("docker tag alpine:3.20 registry.kestrel.io/dev/tools:1.0") + ex("docker push registry.kestrel.io/dev/tools:1.0") +
      "<p>Layers the registry already has aren't uploaded again. Here you may push to <code>registry.kestrel.io/dev/...</code> but only pull from <code>kestrel/...</code>.</p>",
    system: function (sys) { var dg = registrySetup(sys); deploysFile(sys, dg, "2.3.1"); },
    starter: "",
    objectives: [
      { id: "pull", text: "Pull <code>python:3.12-slim</code> and list your images <b>with their digests</b>.", hints: ["docker pull NAME:TAG, then docker images with an option", "docker pull python:3.12-slim\ndocker images --digests"],
        check: function (r) { var im = img(r, "python:3.12-slim"); if (!im) return "Pull python:3.12-slim."; var dg = im.digests["python"]; return ran(r, /^\s*docker\s+(images|image\s+ls)\b.*--digests/, function (e) { return out(e).indexOf(dg) >= 0; }) ? true : "List the images with docker images --digests."; } },
      { id: "login", text: "Log in to <code>registry.kestrel.io</code> as <code>dev</code>, reading the token from <code>~/.kestrel/registry-token</code> through <code>--password-stdin</code>.", hints: ["docker login REGISTRY -u USER --password-stdin < FILE", "docker login registry.kestrel.io -u dev --password-stdin < ~/.kestrel/registry-token"],
        check: function (r) { if (ran(r, /docker\s+login\b.*(\s-p\s|--password[ =](?!-stdin))/)) return "Don't put the token on the command line (-p): it ends up in your shell history. Use --password-stdin."; return ran(r, /^\s*docker\s+login\b.*registry\.kestrel\.io/, function (e) { return /Login Succeeded/.test(out(e)); }) ? true : "Log in with docker login registry.kestrel.io -u dev --password-stdin < ~/.kestrel/registry-token"; } },
      { id: "which", text: "Find out which worker <b>version</b> production runs, then prove it: run the exact image from <code>~/deploys/worker.txt</code> <b>by digest</b> with the command <code>worker --version</code>.", hints: ["Pull the worker tags (2.3.0, 2.3.1, 2.4.0, stable) and compare their digests with the one in worker.txt: docker images --digests. Or just run the digest.", "docker run --rm registry.kestrel.io/kestrel/worker@sha256:...  worker --version (copy the digest from ~/deploys/worker.txt)"],
        check: function (r) { return ran(r, RUN, function (e) { return /worker@/.test(e.cmd) && /kestrel-worker 2\.3\.1/.test(out(e)); }) ? true : "Run the image by its digest (worker@sha256:...) with worker --version: it should say which version production runs."; } },
      { id: "push", text: "Name <code>alpine:3.20</code> as <code>registry.kestrel.io/dev/tools:1.0</code> and push it.", hints: ["docker tag SOURCE TARGET, then docker push TARGET", "docker pull alpine:3.20\ndocker tag alpine:3.20 registry.kestrel.io/dev/tools:1.0\ndocker push registry.kestrel.io/dev/tools:1.0"],
        check: function (r) { var repo = H.dk(r).regs && H.dk(r).regs["registry.kestrel.io"].repos["dev/tools"]; return repo && repo.tags["1.0"] ? true : "Push registry.kestrel.io/dev/tools:1.0 (tag alpine:3.20 with that name first)."; } },
      { id: "logout", text: "Log out of the registry, so your token isn't left in <code>~/.docker/config.json</code>.", hints: ["docker logout REGISTRY"],
        check: function (r) { if (!ran(r, /^\s*docker\s+login\b/)) return "Log in first (task 2)."; var t = readF(r, "~/.docker/config.json") || ""; return /registry\.kestrel\.io/.test(t) ? "config.json still holds your registry login: docker logout registry.kestrel.io" : true; } }
    ],
    solution: sol("docker pull python:3.12-slim", "docker images --digests", "docker login registry.kestrel.io -u dev --password-stdin < ~/.kestrel/registry-token", "cat ~/deploys/worker.txt", "docker pull registry.kestrel.io/kestrel/worker:stable", "docker pull registry.kestrel.io/kestrel/worker:2.3.1", "docker images --digests", "docker run --rm registry.kestrel.io/kestrel/worker@$(grep -o 'sha256:[0-9a-f]*' ~/deploys/worker.txt) worker --version", "docker pull alpine:3.20", "docker tag alpine:3.20 registry.kestrel.io/dev/tools:1.0", "docker push registry.kestrel.io/dev/tools:1.0", "docker logout registry.kestrel.io"),
    debrief: "<p>Production runs <b>2.3.1</b>, even though <code>stable</code> now points at 2.4.0. Anyone reading \"stable\" in the deploy note would have guessed wrong; the digest can't lie. That's why production deploys pin digests (or tags that are never reused).</p><p>You also pushed your first image, and logged out so a base64 token wasn't left in your home folder. Next: building your own image.</p>",
    realworld: "Every cloud has a registry: Amazon ECR, Google Artifact Registry, Azure Container Registry, GitHub Container Registry (ghcr.io). docker login works the same with all of them; CI systems log in with short-lived tokens.",
    quiz: [
      { q: "Which reference always gives you exactly the same image?", options: ["myapp:latest", "myapp:stable", "myapp:1.4", "myapp@sha256:4f2c..."], answer: 3, why: "A digest is the hash of the image's content. Tags, even version-looking ones, can be moved." },
      { q: "<code>docker pull nginx</code> pulls...", options: ["the newest nginx image ever built", "docker.io/library/nginx:latest", "nothing: a tag is required", "every nginx tag"], answer: 1, why: "No registry means Docker Hub; no tag means the tag called latest." },
      { q: "Why <code>--password-stdin</code> instead of <code>-p TOKEN</code>?", options: ["It's faster", "-p doesn't work with private registries", "The token would be saved in your shell history and visible in the process list", "--password-stdin encrypts config.json"], answer: 2, why: "Anything on a command line is visible to other users (ps) and saved in history. config.json is still only base64: that's a separate problem." }
    ]
  });

  /* ================================================================== DEV-104 */
  LABS.push({
    id: "dev-104", n: 4, module: 1, ticket: "DEV-104", xp: 150, tool: "Docker",
    title: "Your first Dockerfile",
    topic: "FROM, WORKDIR, COPY, RUN, EXPOSE, CMD, docker build",
    from: BEN,
    story: "<p>I wrote <b>notes-api</b>, a small Flask service the support team uses to share notes (<code>~/notes-api</code>). Right now it only runs on my machine, with my Python. Can you package it as an image, <code>notes-api:1.0</code>, so anyone can run it with one command?</p>",
    learn:
      "<h3>A Dockerfile is the recipe for an image</h3><p>Each line is an instruction, run top to bottom:</p>" +
      code(NOTES_DF) +
      '<table class="t"><tr><th>Instruction</th><th>What it does</th></tr>' +
      "<tr><td><code>FROM python:3.12-slim</code></td><td>start from this image (a Debian userland with Python installed)</td></tr>" +
      "<tr><td><code>WORKDIR /app</code></td><td>create <code>/app</code> and run everything after it from there</td></tr>" +
      "<tr><td><code>COPY requirements.txt .</code></td><td>copy files from your folder (the <b>build context</b>) into the image</td></tr>" +
      "<tr><td><code>RUN pip install ...</code></td><td>run a command during the build; whatever it changes becomes a new layer</td></tr>" +
      "<tr><td><code>EXPOSE 8000</code></td><td>documents the port the app listens on (it doesn't publish anything)</td></tr>" +
      "<tr><td><code>CMD [\"python\", \"app.py\"]</code></td><td>the command a container runs when it starts</td></tr></table>" +
      "<h3>Building</h3>" + ex("cd ~/notes-api\ndocker build -t notes-api:1.0 .") +
      "<p><code>-t</code> names the image. The <code>.</code> at the end is the build context: the folder whose files <code>COPY</code> can use. Docker prints each step; a <code>RUN</code> that fails stops the build and shows that command's output.</p>" +
      "<h3>Running it</h3>" + ex("docker run -d --name notes -p 8000:8000 notes-api:1.0") + ex("curl localhost:8000/health") +
      "<p><code>docker history notes-api:1.0</code> shows the layers: one per instruction that changed files, on top of the base image's.</p>" +
      "<h3>Two details that matter</h3><ul><li><b>Exec form</b> <code>CMD [\"python\", \"app.py\"]</code> runs python directly as PID 1. The shell form <code>CMD python app.py</code> runs it under <code>/bin/sh</code>, which doesn't pass on <code>docker stop</code>'s signal, so stopping takes 10 seconds and ends in a kill.</li><li>Inside a container, an app must listen on <b>0.0.0.0</b>, not 127.0.0.1 (localhost <i>inside the container</i>), or the published port leads nowhere. Ben's app already does.</li></ul>" +
      '<div class="callout">Write the Dockerfile with <code>nano ~/notes-api/Dockerfile</code>: the editor panel opens, Save writes the file. The name is exactly <code>Dockerfile</code>, capital D, no extension.</div>',
    system: notesProject("notes-api"),
    starter: "",
    objectives: [
      { id: "df", text: "Write <code>~/notes-api/Dockerfile</code>: start from <code>python:3.12-slim</code>, install the packages in <code>requirements.txt</code>, copy the app in, and start it with <code>python app.py</code> in <b>exec form</b>.", hints: ["Six or seven lines: FROM, WORKDIR, COPY, RUN pip install -r requirements.txt, COPY . ., CMD", "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD [\"python\", \"app.py\"]"],
        check: function (r) {
          var df = dockerfileOf(r, "~/notes-api"); if (!df) return "Create ~/notes-api/Dockerfile (nano ~/notes-api/Dockerfile)."; if (df.error) return "The Dockerfile doesn't parse: " + df.error;
          var st = last(stages(df)); if (!/^python:3\.12/.test(st.from)) return "Start FROM python:3.12-slim.";
          if (!st.ins.some(function (i) { return i.kw === "RUN" && /pip\d?\s+install\b.*-r\s+\S*requirements\.txt/.test(i.args); })) return "Install the packages: RUN pip install -r requirements.txt";
          var cmd = st.ins.filter(function (i) { return i.kw === "CMD"; }).pop(); if (!cmd) return "Add a CMD that starts the app."; if (!cmd.json) return "Write CMD in exec form: CMD [\"python\", \"app.py\"]"; return /app\.py|gunicorn/.test(cmd.args) ? true : "CMD should start the app (python app.py)."; } },
      { id: "build", text: "Build it as <code>notes-api:1.0</code>.", hints: ["docker build -t NAME:TAG FOLDER", "cd ~/notes-api\ndocker build -t notes-api:1.0 ."],
        check: function (r) { var im = img(r, "notes-api:1.0"); if (!im) return "Build the image: docker build -t notes-api:1.0 . (from ~/notes-api)"; return im.built && /app\.py|gunicorn/.test(lastCmdOf(im)) ? true : "notes-api:1.0 should be built from your Dockerfile."; } },
      { id: "run", text: "Run it in the background as <code>notes</code>, with the laptop's port 8000 published to the container's 8000.", hints: ["docker run -d --name notes -p 8000:8000 notes-api:1.0"],
        check: function (r) { var c = H.everNamed(r, "notes"); if (!c) return "Start a container named notes."; if (!/^notes-api:1\.0$/.test(c.imageRef)) return "notes should run notes-api:1.0."; if (!c.ports.some(function (p) { return p.hostPort === 8000 && p.ctrPort === 8000; })) return "Publish port 8000: -p 8000:8000"; return c.state === "running" ? true : "notes isn't running: docker logs notes shows why."; } },
      { id: "health", text: "Check it from the laptop: <code>/health</code> should answer <code>{\"status\":\"ok\"}</code>.", hints: ["curl localhost:8000/health"],
        check: function (r) { return httpOk(r, 8000, "/health", /"status":\s*"ok"/) ? true : "curl localhost:8000/health"; } },
      { id: "note", text: "Add a note with a POST to <code>/notes</code>, then list the notes to see it.", hints: ["curl -X POST -d 'your text' localhost:8000/notes", "curl -X POST -d 'Remember the 3pm deploy' localhost:8000/notes\ncurl localhost:8000/notes"],
        check: function (r) { var k = idx(r, CURL, function (e) { return /:8000\/notes/.test(e.cmd) && /"id"/.test(out(e)) && /(-X\s*POST|-d|--data)/.test(e.cmd); }); if (k < 0) return "POST a note: curl -X POST -d 'text' localhost:8000/notes"; return r.history.slice(k + 1).some(function (e) { return CURL.test(e.cmd) && /:8000\/notes/.test(e.cmd) && /\[\{"id"/.test(out(e)); }) ? true : "Now list them: curl localhost:8000/notes"; } },
      { id: "history", text: "Show the layers of <code>notes-api:1.0</code>.", hints: ["docker history IMAGE"],
        check: function (r) { return ran(r, /^\s*docker\s+(image\s+)?history\b.*notes-api:1\.0/, function (e) { return /pip install/.test(out(e)); }) ? true : "Run docker history notes-api:1.0"; } }
    ],
    solution: sol("cd ~/notes-api", "ls", { nano: "~/notes-api/Dockerfile", text: NOTES_DF }, "docker build -t notes-api:1.0 .", "docker images", "docker run -d --name notes -p 8000:8000 notes-api:1.0", "curl localhost:8000/health", "curl -X POST -d 'Remember the 3pm deploy' localhost:8000/notes", "curl localhost:8000/notes", "docker logs notes", "docker history notes-api:1.0"),
    debrief: "<p>Ben's app now ships as one image: anyone with Docker runs <code>docker run -p 8000:8000 notes-api:1.0</code> and gets the same Python, the same packages, the same files. No \"works on my machine\".</p><p>Look at <code>docker history</code>: your layers sit on top of python:3.12-slim's. In the next lab you'll make builds faster and images smaller by using those layers well.</p>",
    realworld: "Most projects on GitHub have a Dockerfile in the root. Read a few (search for \"FROM python:\" or \"FROM node:\"): you'll recognise every instruction now.",
    quiz: [
      { q: "What does <code>EXPOSE 8000</code> do?", options: ["Publishes port 8000 on the host", "Opens the firewall", "Documents that the app listens on 8000; you still publish it with -p", "Makes the app listen on 8000"], answer: 2, why: "EXPOSE is metadata. -p (or -P) publishes the port." },
      { q: "The <code>.</code> at the end of <code>docker build -t app .</code> is...", options: ["the image name", "the build context: the folder COPY can read from", "the current container", "required punctuation"], answer: 1, why: "Docker sends that folder to the builder. COPY can only use files inside it." },
      { q: "Why does the app have to listen on 0.0.0.0 inside the container?", options: ["127.0.0.1 inside a container is the container itself, so traffic from the published port can't reach it", "0.0.0.0 is faster", "Docker blocks 127.0.0.1", "It doesn't matter"], answer: 0, why: "The published port forwards to the container's network interface. An app bound to the container's loopback never sees those connections." }
    ]
  });

  /* ================================================================== DEV-105 */
  var NAIVE_DF = sc("FROM python:3.12", "WORKDIR /app", "COPY . .", "RUN pip install -r requirements.txt", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  var BETTER_DF = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  var IGNORE = sc(".git", "venv", "__pycache__", "*.log", "tests", "Dockerfile", ".dockerignore");
  var STATUS_PKG = JSON.stringify({ name: "status-page", version: "1.0.0", private: true, scripts: { dev: "vite", build: "vite build", test: "vitest run" }, dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" }, devDependencies: { vite: "^5.4.10", "@vitejs/plugin-react": "^4.3.3" } }, null, 2) + "\n";
  var STATUS_DF = sc("# build stage: Node and all the dev tools", "FROM node:20-alpine AS build", "WORKDIR /src", "COPY package.json package-lock.json ./", "RUN npm ci", "COPY . .", "RUN npm run build", "", "# runtime stage: only nginx and the built files", "FROM nginx:1.27-alpine", "COPY --from=build /src/dist /usr/share/nginx/html");
  function statusProject(sys) {
    DL.setup.files(sys, HOME + "/status-page", { "package.json": STATUS_PKG, "package-lock.json": "{\n  \"name\": \"status-page\",\n  \"lockfileVersion\": 3\n}\n", "index.html": "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>Kestrel status</title></head>\n<body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body>\n</html>\n", "src/main.jsx": "import { createRoot } from \"react-dom/client\";\ncreateRoot(document.getElementById(\"root\")).render(<h1>All systems normal</h1>);\n", ".dockerignore": "node_modules\ndist\n.git\n", "node_modules/react/package.json": { content: "{\"name\":\"react\"}\n", size: 4.4e6 } });
  }
  function bigNotes(sys) {
    notesProject("notes-api", { "Dockerfile": NAIVE_DF, "notes.log": { content: "2026-11-10 09:00:01 GET /health 200\n", size: 25e6 }, "venv/lib/python3.12/site-packages/flask/__init__.py": { content: "", size: 180e6 }, ".git/objects/pack/pack-1.pack": { content: "", size: 41e6 }, "__pycache__/app.cpython-312.pyc": { content: "", size: 6e3 } })(sys);
    statusProject(sys);
  }
  function notesBuilds(r) { return H.builds(r).filter(function (b) { return b.ok && b.ctxDir === HOME + "/notes-api"; }); }
  LABS.push({
    id: "dev-105", n: 5, module: 1, ticket: "DEV-105", xp: 160, tool: "Docker",
    title: "Better images",
    topic: "small bases, .dockerignore, the layer cache, multi-stage builds",
    from: MAYA,
    story: "<p>Ben's first try at a Dockerfile (<code>~/notes-api/Dockerfile</code>, already built as <code>notes-api:1.0</code>) works, but the image is over a <b>gigabyte</b>, every build sends 250 MB to the builder, and changing one line of Python reinstalls every package. Fix all three.</p><p>Then the status page: a React app in <code>~/status-page</code>. It needs Node to <b>build</b>, but only a web server to <b>run</b>. Production shouldn't ship Node at all.</p>",
    learn:
      "<h3>Why size matters</h3><p>Every server and CI run pulls the image: smaller means faster deploys. And every program in the image is something that can have a vulnerability. Ship what the app needs, nothing else.</p>" +
      '<table class="t"><tr><th>Base image</th><th>Size</th><th>What\'s inside</th></tr><tr><td><code>python:3.12</code></td><td>~1 GB</td><td>Debian plus compilers, git, curl, headers: handy for building, heavy for running</td></tr><tr><td><code>python:3.12-slim</code></td><td>~125 MB</td><td>Debian with just Python</td></tr><tr><td><code>python:3.12-alpine</code></td><td>~58 MB</td><td>Alpine (musl): tiny, but some Python packages need compiling</td></tr></table>' +
      "<h3>.dockerignore</h3><p><code>docker build</code> sends the whole folder to the builder first, and <code>COPY . .</code> copies all of it into the image: your <code>.git</code>, virtualenv, logs, maybe a <code>.env</code> with secrets. A <code>.dockerignore</code> file (same idea as <code>.gitignore</code>) leaves things out:</p>" + code(IGNORE) +
      "<h3>The layer cache</h3><p>Docker reuses a step's result if the step and everything before it are unchanged (for <code>COPY</code>, unchanged means the copied files have the same content). The first step that changes, and <b>every step after it</b>, run again. So order steps from \"changes rarely\" to \"changes often\":</p>" + code(BETTER_DF) +
      "<p>Now editing <code>app.py</code> only invalidates the last <code>COPY . .</code>; the slow <code>pip install</code> shows <code>CACHED</code>. <code>--no-cache-dir</code> stops pip keeping a copy of every download inside the image.</p>" +
      "<h3>Multi-stage builds</h3><p>Use one stage, with all the build tools, to <i>make</i> something, and copy only the result into a small final stage. Everything else is thrown away:</p>" + code(STATUS_DF) +
      "<p><code>AS build</code> names a stage, <code>COPY --from=build</code> copies out of it. The final image is just <code>nginx:1.27-alpine</code> plus a few hundred kB of HTML and JavaScript. The <b>Build</b> tab of the panel shows which steps came from the cache.</p>",
    system: bigNotes,
    prelude: "cd ~/notes-api && docker build -q -t notes-api:1.0 . > /dev/null 2>&1; cd ~",
    starter: "",
    objectives: [
      { id: "ignore", text: "Add <code>~/notes-api/.dockerignore</code> so the build context is <b>under 100 kB</b> (it's about 250 MB now). The app's own files must still get in.", hints: ["Leave out .git, venv, __pycache__ and *.log. The next build's \"transferring context\" line shows the size.", "nano ~/notes-api/.dockerignore with lines: .git  venv  __pycache__  *.log"],
        check: function (r) { if (readF(r, "~/notes-api/.dockerignore") == null) return "Create ~/notes-api/.dockerignore."; var ctx = Dk.contextFiles(r.sys, HOME + "/notes-api"); if (!ctx.files["app.py"] || !ctx.files["requirements.txt"]) return ".dockerignore now leaves out app.py or requirements.txt: the build needs those."; return ctx.bytes < 100e3 ? true : "The context is still " + Dk.human(ctx.bytes) + ". What's big in there? ls -la ~/notes-api and du -sh ~/notes-api/*"; } },
      { id: "slim", text: "Rebuild as <code>notes-api:2.0</code> on <code>python:3.12-slim</code>: under <b>200 MB</b>.", hints: ["Change the FROM line, then docker build -t notes-api:2.0 ."],
        check: function (r) { var im = img(r, "notes-api:2.0"); if (!im) return "Build notes-api:2.0."; return im.size < 200e6 ? true : "notes-api:2.0 is " + Dk.human(im.size) + ". Use FROM python:3.12-slim (and check what COPY copies)."; } },
      { id: "cache", text: "Reorder the Dockerfile so a code change doesn't reinstall packages. Prove it: build, change <code>VERSION</code> in <code>app.py</code>, build again: the <code>pip install</code> step must say <b>CACHED</b>.", hints: ["Copy requirements.txt and run pip install BEFORE COPY . .", "sed -i 's/1.0.0/1.1.0/' ~/notes-api/app.py, then docker build -t notes-api:2.0 . again"],
        check: function (r) { var bs = notesBuilds(r), b = last(bs); if (!b) return "Build notes-api again after reordering."; var pip = b.steps.filter(function (s) { return s.kw === "RUN" && /pip\d?\s+install/.test(s.label); })[0]; if (!pip) return "The last notes-api build has no pip install step."; if (!pip.cached) return "In your last build, pip install ran again. Change only app.py between two builds; if it still reruns, COPY requirements.txt and RUN pip install must come before COPY . ."; var copy = b.steps.filter(function (s) { return s.kw === "COPY" && !s.cached; })[0]; if (!copy) return "Change app.py (e.g. the VERSION line) and build again, so the code layer is rebuilt while pip comes from the cache."; var im = img(r, (b.tags || [])[0]); return im && Dk.merge(im.layers)["/app/app.py"] && Dk.merge(im.layers)["/app/app.py"].c === readF(r, "~/notes-api/app.py") ? true : "Build once more so the image has your current app.py."; } },
      { id: "multi", text: "Write a <b>multi-stage</b> <code>~/status-page/Dockerfile</code>: build with <code>node:20-alpine</code> (<code>npm ci</code>, <code>npm run build</code>), serve the <code>dist</code> folder with <code>nginx:1.27-alpine</code>. Build it as <code>status-page:1.0</code>: under <b>60 MB</b>, with no Node in it.", hints: ["Two FROM lines. The first stage AS build; the second copies with COPY --from=build /src/dist /usr/share/nginx/html", STATUS_DF],
        check: function (r) { var im = img(r, "status-page:1.0"); if (!im) return "Build status-page:1.0 from ~/status-page."; var m = Dk.merge(im.layers); if (m["/usr/local/bin/node"]) return "status-page:1.0 still contains Node. The final stage should be FROM nginx:1.27-alpine."; var ix = m["/usr/share/nginx/html/index.html"]; if (!ix || !/assets\/index-/.test(ix.c)) return "The built site (dist) should be in /usr/share/nginx/html."; if (Object.keys(m).some(function (p) { return /node_modules/.test(p); })) return "node_modules ended up in the image."; return im.size < 60e6 ? true : "status-page:1.0 is " + Dk.human(im.size) + "; it should be under 60 MB."; } },
      { id: "serve", text: "Run <code>status-page:1.0</code> with port 8080 published to the container's 80, and fetch the page.", hints: ["docker run -d --name status -p 8080:80 status-page:1.0\ncurl localhost:8080"],
        check: function (r) { return r.history.some(function (e) { return CURL.test(e.cmd) && /:8080/.test(e.cmd) && /<title>Kestrel status<\/title>/.test(out(e)) && /assets\/index-/.test(out(e)); }) ? true : "Run it with -p 8080:80 and curl localhost:8080."; } }
    ],
    solution: sol("cd ~/notes-api", "ls -la", "docker images", "du -sh venv .git notes.log", { nano: "~/notes-api/.dockerignore", text: IGNORE }, { nano: "~/notes-api/Dockerfile", text: BETTER_DF }, "docker build -t notes-api:2.0 .", "sed -i 's/1.0.0/1.1.0/' app.py", "docker build -t notes-api:2.0 .", "docker images", "cd ~/status-page", { nano: "~/status-page/Dockerfile", text: STATUS_DF }, "docker build -t status-page:1.0 .", "docker images", "docker run -d --name status -p 8080:80 status-page:1.0", "curl localhost:8080"),
    debrief: "<p>From over 1 GB to about 130 MB for the API, a build context of a few kB instead of 250 MB, and code changes that rebuild in under a second because the package layer comes from the cache. The status page ships as nginx plus its files: Node, npm and 200 MB of <code>node_modules</code> stayed in the build stage.</p><p>Next: containers are disposable, so where does data go?</p>",
    realworld: "Look at the image sizes on your own machine with docker images, and at an image's layers with docker history --no-trunc. Tools like dive (github.com/wagoodman/dive) show what each layer added, file by file.",
    quiz: [
      { q: "You change one line in <code>app.py</code>. With <code>COPY . .</code> <i>before</i> <code>RUN pip install</code>...", options: ["only the COPY step reruns", "the COPY and every step after it rerun, including pip install", "nothing reruns", "the whole build, including FROM, reruns"], answer: 1, why: "A changed step invalidates the cache for itself and everything after it. Copy the dependency list first, install, then copy the code." },
      { q: "In a multi-stage build, what ends up in the final image?", options: ["Every stage", "Only the last stage (plus whatever it COPY --from's)", "Only the first stage", "Only files under /src"], answer: 1, why: "Earlier stages are build helpers. Only the final stage becomes the image." },
      { q: "Which belongs in .dockerignore?", options: ["requirements.txt", ".git and .env", "app.py", "The Dockerfile's FROM image"], answer: 1, why: "History and secrets shouldn't be sent to the builder, let alone copied into the image." }
    ]
  });

  var UPCOMING = [
    ["CI/CD pipelines", 2, [["Pipeline design", "stages, failing fast, caching"], ["Build & push images", "commit-ID tags, registries"], ["Tests & quality gates", "tests, coverage, lint"], ["Security gates", "code, dependency, image and secret scanning"], ["Versions & releases", "semver, changelogs"], ["Deployment strategies", "rolling, blue-green, canary"], ["Environments & rollback", "dev → staging → prod"], ["Signing & provenance", "cosign, SLSA"], ["Bamboo plans & Specs", "plans, stages, jobs, tasks"], ["Bamboo deployments", "environments, releases, agents"], ["Module 2 capstone", "Commit to production", true]]],
    ["Infrastructure as code", 3, [["Terraform basics", "init, plan, apply"], ["State, locking & drift", "remote state, drift"], ["Variables, outputs & modules", "reusable blocks"], ["Building on AWS", "VPC, EC2, S3"], ["Ansible basics", "inventory, playbooks"], ["Ansible roles & templates", "many servers, one config"], ["Secrets management", "Vault, AWS SSM"], ["Scanning IaC", "Checkov"], ["Module 3 capstone", "Kestrel's staging environment", true]]],
    ["Kubernetes", 4, [["Pods & kubectl", "create, inspect, debug"], ["Deployments", "scaling, rollouts"], ["Services & Ingress", "routing traffic"], ["ConfigMaps & Secrets", "config outside the image"], ["Health checks & resources", "probes, requests, limits"], ["Storage", "persistent volumes"], ["Helm charts", "package and upgrade"], ["NetworkPolicy", "who may talk to whom"], ["RBAC & pod security", "least privilege"], ["GitOps with Argo CD", "the cluster follows Git"], ["Module 4 capstone", "Deploy Kestrel to the cluster", true]]],
    ["Observability & reliability", 5, [["Metrics with Prometheus", "PromQL"], ["Dashboards", "Grafana"], ["Logs at scale", "Loki"], ["Tracing", "OpenTelemetry"], ["Alerts & SLOs", "error budgets"], ["Incident response", "runbooks, postmortems"], ["Security monitoring", "Falco"], ["Module 5 capstone", "The 3 a.m. outage", true]]]
  ].reduce(function (acc, m) { return acc.concat(m[2].map(function (l) { return { module: m[1], title: l[0], topic: l[1], capstone: !!l[2] }; })); }, []);
  var MODULES = [{ n: 1, name: "Containers with Docker" }, { n: 2, name: "CI/CD pipelines" }, { n: 3, name: "Infrastructure as code" }, { n: 4, name: "Kubernetes" }, { n: 5, name: "Observability & reliability" }];

  window.DEV_TRACK = {
    MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, ex: ex, code: code, lines: sc,
    B: { sc: sc, sol: sol, out: out, all: all, ran: ran, idx: idx, RUN: RUN, CURL: CURL, files: files, both: both, img: img, readF: readF, dockerfileOf: dockerfileOf, stages: stages, last: last, lastCmdOf: lastCmdOf, httpOk: httpOk, HOME: HOME, MAYA: MAYA, DEV: DEV, BEN: BEN,
      NOTES_APP: NOTES_APP, NOTES_REQ: NOTES_REQ, NOTES_DF: NOTES_DF, NOTES_README: NOTES_README, NOTES_TEST: NOTES_TEST, notesProject: notesProject, NAIVE_DF: NAIVE_DF, BETTER_DF: BETTER_DF, IGNORE: IGNORE, STATUS_DF: STATUS_DF, statusProject: statusProject, workerImage: workerImage, registrySetup: registrySetup, deploysFile: deploysFile, notesBuilds: notesBuilds }
  };
})();
