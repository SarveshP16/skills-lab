/* sudo learn — DevOps Module 1 practice drills (3 per lab, +5 XP each). Terminal drills: type commands;
   each one is checked as you go. Each drill has its own small scenario on the laptop. */
(function () {
  "use strict";
  var T = window.DEV_TRACK, B = T.B, S = window.ShEngine, Dk = window.Dk, DL = window.DevLab, H = DL.H;
  var sc = B.sc, sol = B.sol, out = B.out, all = B.all, ran = B.ran, idx = B.idx, RUN = B.RUN, CURL = B.CURL, img = B.img, readF = B.readF, last = B.last, HOME = B.HOME;
  function httpOk(r, port, path, re) { return B.httpOk(r, port, path, re); }
  function files(base, map) { return B.files(HOME + "/" + base, map); }
  function both() { return B.both.apply(null, arguments); }
  function pulled(ref) { return function (sys) { DL.setup.pulled(sys, ref); }; }
  var WORKER_SH = "if [ -z \"$QUEUE_URL\" ]; then echo \"ERROR: QUEUE_URL is not set\" >&2; exit 2; fi; echo \"connected to $QUEUE_URL\"; sleep 3600";

  var DRILLS = {
    "dev-101": [
      { id: "d1", title: "Ubuntu in a box", text: "<p>Run <code>cat /etc/os-release</code> in an <code>ubuntu:24.04</code> container. Compare its size with alpine's afterwards (<code>docker images</code>).</p>", starter: "",
        solution: sol("docker run ubuntu:24.04 cat /etc/os-release", "docker images"),
        check: function (r) { return ran(r, RUN, function (e) { return /ubuntu:24\.04/.test(e.cmd) && /Ubuntu 24\.04/.test(out(e)); }) ? true : "Run cat /etc/os-release in ubuntu:24.04."; } },
      { id: "d2", title: "Who am I?", text: "<p>Run an alpine container named <code>probe</code> whose command prints its <b>hostname</b>. Then find that name in <code>docker ps -a</code>: what is it?</p>", starter: "",
        solution: sol("docker run --name probe alpine hostname", "docker ps -a"),
        check: function (r) { var c = H.everNamed(r, "probe"); if (!c) return "Run a container named probe."; return ran(r, RUN, function (e) { return /\bprobe\b/.test(e.cmd) && out(e).trim().split("\n").pop() === c.id.slice(0, 12); }) ? true : "Its command should be hostname. (The answer is the container's short ID.)"; } },
      { id: "d3", title: "Leave nothing behind", text: "<p>Run <code>echo bye</code> in an alpine container so the container is <b>deleted automatically</b> when it exits. <code>docker ps -a</code> should stay empty.</p>", starter: "",
        solution: sol("docker run --rm alpine echo bye", "docker ps -a"),
        check: function (r) { if (!ran(r, RUN, function (e) { return /--rm\b/.test(e.cmd) && /^bye$/m.test(out(e)); })) return "docker run has an option that removes the container when it exits."; return H.dk(r).ctrs.length ? "Some containers are left: remove them too." : true; } }
    ],
    "dev-102": [
      { id: "d1", title: "Name taken", text: "<p>A stopped container called <code>api</code> is in the way. Run <code>nginx:1.27</code> as a new <code>api</code> on port 8081.</p>",
        system: function (sys) { DL.setup.run(sys, "nginx:1.27", { name: "api", exit: 0 }); }, starter: "",
        solution: sol("docker ps -a", "docker rm api", "docker run -d --name api -p 8081:80 nginx:1.27", "curl localhost:8081"),
        check: function (r) { var c = H.ctr(r, "api"); if (!c || c.state !== "running") return "Start nginx:1.27 as api (the old api must go first: docker rm api)."; if (!c.ports.some(function (p) { return p.hostPort === 8081; })) return "Publish it on 8081."; return H.everNamed(r, "api") === c && H.ever(r, function (x) { return x.name === "api"; }).length > 1 ? true : "That's still the old container."; } },
      { id: "d2", title: "Port taken", text: "<p><code>web1</code> already uses the laptop's port 8080. Run a second nginx, <code>web2</code>, that you can reach at <code>localhost:8082</code>, and curl it.</p>",
        system: function (sys) { DL.setup.run(sys, "nginx:1.27", { name: "web1", ports: ["8080:80"] }); }, starter: "",
        solution: sol("docker run -d --name web2 -p 8082:80 nginx:1.27", "curl localhost:8082"),
        check: function (r) { var c = H.ctr(r, "web2"); if (!c || c.state !== "running") return "Run web2."; if (!c.ports.some(function (p) { return p.hostPort === 8082 && p.ctrPort === 80; })) return "Publish 8082 → 80."; return httpOk(r, 8082, "", /Welcome to nginx/) ? true : "curl localhost:8082"; } },
      { id: "d3", title: "Why did it stop?", text: "<p>The <code>worker</code> container exited right after it started. Find out why from its logs, then run <code>worker2</code> from the same image in the background, with what it was missing set to <code>redis://cache:6379</code>.</p>",
        system: function (sys) { DL.setup.run(sys, "alpine:3.20", { name: "worker", cmd: ["sh", "-c", WORKER_SH] }); }, starter: "",
        solution: sol("docker ps -a", "docker logs worker", "docker run -d --name worker2 -e QUEUE_URL=redis://cache:6379 alpine:3.20 sh -c '" + WORKER_SH.replace(/'/g, "'\\''") + "'", "docker logs worker2"),
        check: function (r) { if (!ran(r, /^\s*docker\s+(container\s+)?logs\b.*\bworker\b/, function (e) { return /QUEUE_URL/.test(all(e)); })) return "Read worker's logs: docker logs worker"; var c = H.ctr(r, "worker2"); if (!c || c.state !== "running") return "Run worker2 (same image and command, docker inspect worker shows them) with -e QUEUE_URL=redis://cache:6379"; return c.env.QUEUE_URL === "redis://cache:6379" ? true : "Set QUEUE_URL=redis://cache:6379"; } }
    ],
    "dev-103": [
      { id: "d1", title: "Write down a digest", text: "<p>Save the digest of the <code>nginx:1.27</code> image on this laptop (just the <code>sha256:...</code> part) in <code>~/nginx-digest.txt</code>.</p>",
        system: pulled("nginx:1.27"), starter: "",
        solution: sol("docker images --digests nginx", "docker inspect -f '{{index .RepoDigests 0}}' nginx:1.27 | cut -d@ -f2 > ~/nginx-digest.txt", "cat ~/nginx-digest.txt"),
        check: function (r) { var im = img(r, "nginx:1.27"), t = (readF(r, "~/nginx-digest.txt") || "").trim(); if (!t) return "Write it to ~/nginx-digest.txt."; return im && t === im.digests.nginx ? true : "That isn't nginx:1.27's digest (docker images --digests)."; } },
      { id: "d2", title: "Rename without copying", text: "<p>The image <code>notes:dev</code> is ready for release. Give it the tag <code>notes:1.0</code> and remove the <code>notes:dev</code> tag, without deleting the image.</p>",
        system: function (sys) { DL.setup.local(sys, DL.setup.image(sys, { from: "python:3.12-slim", key: "notes-dev", layers: [{ by: "COPY . . # buildkit", files: { "/app/app.py": Dk.F(B.NOTES_APP) } }], cfg: { Cmd: ["python", "app.py"], WorkingDir: "/app" } }), "notes:dev"); }, starter: "",
        solution: sol("docker tag notes:dev notes:1.0", "docker rmi notes:dev", "docker images notes"),
        check: function (r) { var im = img(r, "notes:1.0"); if (!im) return "Tag it: docker tag notes:dev notes:1.0"; if (im.tags.indexOf("notes:dev") >= 0) return "Remove the dev tag: docker rmi notes:dev (with another tag left, it only untags)."; return true; } },
      { id: "d3", title: "Dangling images", text: "<p>Old rebuilds left untagged <code>&lt;none&gt;</code> images behind. Delete just those; keep <code>notes:1.0</code>.</p>",
        system: function (sys) { DL.setup.local(sys, DL.setup.image(sys, { from: "python:3.12-slim", key: "n1", layers: [{ by: "COPY . . # buildkit", files: { "/app/app.py": Dk.F(B.NOTES_APP) } }] }), "notes:1.0"); ["n0", "n00"].forEach(function (k) { DL.setup.local(sys, DL.setup.image(sys, { from: "python:3.12-slim", key: k, layers: [{ by: "COPY . . # buildkit", files: { "/app/app.py": Dk.F(B.NOTES_APP + "#" + k + "\n") } }] }), null); }); }, starter: "",
        solution: sol("docker images", "docker images -f dangling=true", "docker image prune -f", "docker images"),
        check: function (r) { if (!img(r, "notes:1.0")) return "Keep notes:1.0."; return H.dk(r).images.some(function (i) { return !i.tags.length; }) ? "Untagged images are still there: docker image prune -f" : true; } }
    ],
    "dev-104": [
      { id: "d1", title: "Listening on the wrong address", text: "<p><code>hello</code> (from <code>~/hello-api</code>, built as <code>hello-api:1.0</code>) is running with port 8001 published, but <code>curl localhost:8001/health</code> gets an empty reply. Find out why from its logs, fix <code>app.py</code>, rebuild as <code>hello-api:1.1</code> and run that as <code>hello</code> on 8001 instead.</p>",
        system: B.notesProject("hello-api", { "app.py": B.NOTES_APP.replace("host=\"0.0.0.0\"", "host=\"127.0.0.1\""), "Dockerfile": B.NOTES_DF }), prelude: "cd ~/hello-api && docker build -q -t hello-api:1.0 . > /dev/null 2>&1 && docker run -d --name hello -p 8001:8000 hello-api:1.0 > /dev/null; cd ~", starter: "",
        solution: sol("curl localhost:8001/health", "docker logs hello", "cd ~/hello-api", "sed -i 's/127.0.0.1/0.0.0.0/' app.py", "docker build -t hello-api:1.1 .", "docker rm -f hello", "docker run -d --name hello -p 8001:8000 hello-api:1.1", "curl localhost:8001/health"),
        check: function (r) { if (!/0\.0\.0\.0/.test(readF(r, "~/hello-api/app.py") || "")) return "The app binds to 127.0.0.1 inside the container (its logs say so). Make it 0.0.0.0."; var c = H.ctr(r, "hello"); if (!c || c.imageRef !== "hello-api:1.1") return "Run hello-api:1.1 as hello."; return httpOk(r, 8001, "/health", /"status":\s*"ok"/) ? true : "curl localhost:8001/health"; } },
      { id: "d2", title: "A missing package", text: "<p><code>~/report-api</code> starts with gunicorn, but the <code>report</code> container dies at once. Find out why, fix the project, rebuild as <code>report-api:1.1</code>, and run it as <code>report2</code> on port 8002 with <code>/health</code> answering.</p>",
        system: B.notesProject("report-api", { "requirements.txt": sc("flask==3.1.1"), "Dockerfile": B.NOTES_DF.replace("CMD [\"python\", \"app.py\"]", "CMD [\"gunicorn\", \"-b\", \"0.0.0.0:8000\", \"app:app\"]") }), prelude: "cd ~/report-api && docker build -q -t report-api:1.0 . > /dev/null 2>&1 && docker run -d --name report -p 8002:8000 report-api:1.0 > /dev/null; cd ~", starter: "",
        solution: sol("docker ps -a", "docker logs report", "cd ~/report-api", "echo 'gunicorn==23.0.0' >> requirements.txt", "docker build -t report-api:1.1 .", "docker rm report", "docker run -d --name report2 -p 8002:8000 report-api:1.1", "curl localhost:8002/health"),
        check: function (r) { var c = H.ctr(r, "report2"); if (!c || c.state !== "running") return "Run report-api:1.1 as report2 (and check docker logs report for why the first one died)."; return httpOk(r, 8002, "/health", /"status":\s*"ok"/) ? true : "curl localhost:8002/health"; } },
      { id: "d3", title: "Exec form", text: "<p><code>~/notes-api</code>'s Dockerfile ends in <code>CMD python app.py</code>. The build warns about it, and <code>docker stop</code> takes 10 seconds. Switch to exec form and build <code>notes-api:1.1</code> with no warning.</p>",
        system: B.notesProject("notes-api", { "Dockerfile": B.NOTES_DF.replace("CMD [\"python\", \"app.py\"]", "CMD python app.py") }), starter: "",
        solution: sol("cd ~/notes-api", "docker build -t notes-api:1.0 .", "sed -i 's/^CMD python app.py$/CMD [\"python\", \"app.py\"]/' Dockerfile", "docker build -t notes-api:1.1 ."),
        check: function (r) { var im = img(r, "notes-api:1.1"); if (!im) return "Build notes-api:1.1."; if ((im.cfg.Cmd || [])[0] === "/bin/sh") return "CMD is still the shell form: CMD [\"python\", \"app.py\"]"; var b = H.lastBuild(r, "notes-api:1.1"); return b && !b.warnings.some(function (w) { return /JSONArgs/.test(w); }) ? true : "Build it again: the warning should be gone."; } }
    ],
    "dev-105": [
      { id: "d1", title: "One RUN for apt", text: "<p><code>~/tools/Dockerfile</code> runs <code>apt-get update</code> and <code>apt-get install</code> in separate steps (built as <code>tools:1.0</code>). Combine them into <b>one</b> <code>RUN</code> that also skips recommended packages and deletes apt's package lists, and build <code>tools:2.0</code>: at least 15 MB smaller.</p>",
        system: files("tools", { "Dockerfile": sc("FROM debian:bookworm-slim", "RUN apt-get update", "RUN apt-get install -y curl", "CMD [\"curl\", \"--version\"]") }), prelude: "cd ~/tools && docker build -q -t tools:1.0 . > /dev/null 2>&1; cd ~", starter: "",
        solution: sol("cd ~/tools", "docker history tools:1.0", { nano: "~/tools/Dockerfile", text: sc("FROM debian:bookworm-slim", "RUN apt-get update \\", "    && apt-get install -y --no-install-recommends curl \\", "    && rm -rf /var/lib/apt/lists/*", "CMD [\"curl\", \"--version\"]") }, "docker build -t tools:2.0 .", "docker images tools"),
        check: function (r) { var a = img(r, "tools:1.0"), b = img(r, "tools:2.0"); if (!b) return "Build tools:2.0."; var df = readF(r, "~/tools/Dockerfile") || ""; if ((df.match(/^\s*RUN\b/gm) || []).length !== 1) return "Use a single RUN."; if (!/--no-install-recommends/.test(df)) return "Add --no-install-recommends."; if (Object.keys(Dk.merge(b.layers)).some(function (p) { return /^\/var\/lib\/apt\/lists\/.+/.test(p); })) return "Delete /var/lib/apt/lists/* in the same RUN."; return a && b.size <= a.size - 15e6 ? true : "tools:2.0 should be at least 15 MB smaller than tools:1.0."; } },
      { id: "d2", title: "pip's download cache", text: "<p><code>notes-api:1.0</code> (from <code>~/notes-api</code>) contains pip's cache of every download. Rebuild it as <code>notes-api:1.1</code> without it.</p>",
        system: B.notesProject("notes-api", { "Dockerfile": B.NOTES_DF.replace("--no-cache-dir ", ""), ".dockerignore": B.IGNORE }), prelude: "cd ~/notes-api && docker build -q -t notes-api:1.0 . > /dev/null 2>&1; cd ~", starter: "",
        solution: sol("cd ~/notes-api", "sed -i 's/pip install -r/pip install --no-cache-dir -r/' Dockerfile", "docker build -t notes-api:1.1 .", "docker images notes-api"),
        check: function (r) { var b = img(r, "notes-api:1.1"); if (!b) return "Build notes-api:1.1."; return Object.keys(Dk.merge(b.layers)).some(function (p) { return /^\/root\/\.cache\/pip\//.test(p); }) ? "pip's cache (/root/.cache/pip) is still in the image: pip install --no-cache-dir" : true; } },
      { id: "d3", title: "Build one stage", text: "<p><code>~/status-page/Dockerfile</code> has a <code>test</code> stage that runs the tests. Build <b>only up to that stage</b>, tagged <code>status-page:test</code>.</p>",
        system: function (sys) { B.statusProject(sys); DL.setup.files(sys, HOME + "/status-page", { "Dockerfile": sc("FROM node:20-alpine AS build", "WORKDIR /src", "COPY package.json package-lock.json ./", "RUN npm ci", "COPY . .", "RUN npm run build", "", "FROM build AS test", "RUN npm test", "", "FROM nginx:1.27-alpine", "COPY --from=build /src/dist /usr/share/nginx/html") }); }, starter: "",
        solution: sol("cd ~/status-page", "docker build --target test -t status-page:test ."),
        check: function (r) { var b = H.builds(r).filter(function (x) { return x.ok && x.target === "test"; }).pop(); if (!b) return "docker build has an option to stop at a named stage: --target"; var im = img(r, "status-page:test"); return im && Dk.merge(im.layers)["/usr/local/bin/node"] ? true : "Tag it status-page:test."; } }
    ],
    "dev-106": [
      { id: "d1", title: "Where does a volume live?", text: "<p>Find where Docker keeps the <code>notes-data</code> volume on the laptop, and list the files in it there.</p>",
        system: function (sys) { Dk.makeVolume(sys, "notes-data", {}); ["Call the bank", "Order toner"].forEach(function (t, i) { S.put(sys, "/var/lib/docker/volumes/notes-data/_data/" + (i + 1) + ".txt", t + "\n", 420, 0, 0); }); }, starter: "",
        solution: sol("docker volume inspect notes-data", "sudo ls /var/lib/docker/volumes/notes-data/_data"),
        check: function (r) { if (!ran(r, /^\s*docker\s+volume\s+inspect\b.*notes-data/)) return "docker volume inspect notes-data shows its Mountpoint."; return ran(r, /\bls\b.*\/var\/lib\/docker\/volumes\/notes-data\/_data/, function (e) { return /1\.txt/.test(out(e)); }) ? true : "List that folder (it's root's: sudo ls ...)."; } },
      { id: "d2", title: "Restore a backup", text: "<p>Restore <code>~/backups/notes.tar.gz</code> into a new volume <code>notes-restored</code>, run <code>notes-api:1.0</code> on port 8000 with it at <code>/data</code>, and list the notes: there should be three.</p>",
        system: B.notesImage, prelude: B.NOTES_PRE + " && mkdir -p /tmp/n ~/backups && echo 'Call the bank' > /tmp/n/1.txt && echo 'Order toner' > /tmp/n/2.txt && echo 'Fix the printer' > /tmp/n/3.txt && tar czf ~/backups/notes.tar.gz -C /tmp/n . && rm -r /tmp/n", starter: "",
        solution: sol("docker volume create notes-restored", "docker run --rm -v notes-restored:/data -v ~/backups:/backup:ro alpine tar xzf /backup/notes.tar.gz -C /data", "docker run -d --name notes -p 8000:8000 -v notes-restored:/data notes-api:1.0", "curl localhost:8000/notes"),
        check: function (r) { if (!H.vol(r, "notes-restored")) return "Create the volume notes-restored."; return r.history.some(function (e) { return CURL.test(e.cmd) && /:8000\/notes/.test(e.cmd) && (out(e).match(/"id"/g) || []).length === 3; }) ? true : "Extract the backup into the volume (a throwaway alpine with tar), run notes with it and curl localhost:8000/notes."; } },
      { id: "d3", title: "Tidy up volumes", text: "<p>Delete every volume no container uses, but keep <code>notes-data</code> (the running <code>notes</code> container uses it).</p>",
        system: function (sys) { B.notesImage(sys); Dk.makeVolume(sys, "old-data", {}); Dk.makeVolume(sys, "tmp-cache", {}); }, prelude: B.NOTES_PRE + " && docker run -d --name notes -v notes-data:/data notes-api:1.0 > /dev/null", starter: "",
        solution: sol("docker volume ls", "docker volume prune -a -f", "docker volume ls"),
        check: function (r) { var v = H.dk(r).vols; if (!v["notes-data"]) return "notes-data is gone!"; return v["old-data"] || v["tmp-cache"] ? "old-data and tmp-cache are still there (docker volume rm, or docker volume prune -a)." : true; } }
    ],
    "dev-107": [
      { id: "d1", title: "A token in the history", text: "<p><code>~/private-pkg</code> installs from Kestrel's private package index with a token passed as a build <code>ARG</code>: <code>docker history</code> of <code>private:1.0</code> shows it. Switch to a <b>build secret</b> (<code>RUN --mount=type=secret,id=pip_token</code>, reading <code>/run/secrets/pip_token</code>) and build <code>private:1.1</code> with <code>--secret id=pip_token,src=~/.kestrel/pip-token</code>.</p>",
        system: function (sys) { DL.setup.files(sys, HOME + "/private-pkg", { "app.py": B.NOTES_APP, "requirements.txt": B.NOTES_REQ, "Dockerfile": sc("FROM python:3.12-slim", "ARG PIP_TOKEN", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir --index-url https://__token__:${PIP_TOKEN}@pypi.kestrel.io/simple -r requirements.txt", "COPY . .", "CMD [\"python\", \"app.py\"]") }); S.put(sys, HOME + "/.kestrel/pip-token", ["kpt", "dev", "71bd09c3e2"].join("_") + "\n", 384, 1000, 1000); },
        prelude: "cd ~/private-pkg && docker build -q --build-arg PIP_TOKEN=$(cat ~/.kestrel/pip-token) -t private:1.0 . > /dev/null 2>&1; cd ~", starter: "",
        solution: sol("docker history --no-trunc private:1.0", "cd ~/private-pkg", { nano: "~/private-pkg/Dockerfile", text: sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN --mount=type=secret,id=pip_token \\", "    pip install --no-cache-dir --index-url https://__token__:$(cat /run/secrets/pip_token)@pypi.kestrel.io/simple -r requirements.txt", "COPY . .", "CMD [\"python\", \"app.py\"]") }, "docker build --secret id=pip_token,src=$HOME/.kestrel/pip-token -t private:1.1 .", "docker history --no-trunc private:1.1"),
        check: function (r) { var df = readF(r, "~/private-pkg/Dockerfile") || ""; if (/ARG\s+PIP_TOKEN/.test(df)) return "Remove the ARG PIP_TOKEN line."; if (!/--mount=type=secret,id=pip_token/.test(df)) return "Mount the secret in the RUN: RUN --mount=type=secret,id=pip_token ..."; var im = img(r, "private:1.1"); if (!im) return "Build private:1.1 with --secret id=pip_token,src=..."; var tok = (readF(r, "~/.kestrel/pip-token") || "").trim(); return im.history.some(function (h) { return h.by.indexOf(tok) >= 0; }) ? "The token is still in private:1.1's history." : true; } },
      { id: "d2", title: "Which value wins?", text: "<p>Run <code>env</code> in a throwaway alpine container with its variables from <code>~/app.env</code>, but <code>LOG_LEVEL</code> overridden to <code>debug</code>.</p>",
        system: function (sys) { S.put(sys, HOME + "/app.env", sc("APP_NAME=kestrel-notes", "LOG_LEVEL=info", "REGION=eu-west-1"), 384, 1000, 1000); }, starter: "",
        solution: sol("docker run --rm --env-file ~/app.env -e LOG_LEVEL=debug alpine env"),
        check: function (r) { return ran(r, RUN, function (e) { return /^LOG_LEVEL=debug$/m.test(out(e)) && /^APP_NAME=kestrel-notes$/m.test(out(e)); }) ? true : "Use --env-file ~/app.env and -e LOG_LEVEL=debug, and run env."; } },
      { id: "d3", title: "Lock down the env file", text: "<p><code>~/billing/.env</code> holds a database password, but everyone on the laptop can read it, and Git would commit it. Make it readable only by you, and make Git ignore it.</p>",
        system: files("billing", { ".env": { content: sc("DB_PASSWORD=" + ["bill", "ing", "2026", "x7"].join("-")), mode: 420 }, "app.py": "print('billing')\n", ".gitignore": sc("__pycache__/") }), starter: "",
        solution: sol("ls -l ~/billing/.env", "chmod 600 ~/billing/.env", "echo '.env' >> ~/billing/.gitignore", "ls -l ~/billing/.env"),
        check: function (r) { if (r.mode(HOME + "/billing/.env") !== "600") return "Only you should read and write it: chmod 600 ~/billing/.env"; return /^\.env\s*$/m.test(readF(r, "~/billing/.gitignore") || "") ? true : "Add .env to ~/billing/.gitignore."; } }
    ],
    "dev-108": [
      { id: "d1", title: "Fix the file", text: "<p><code>docker compose up -d</code> fails in <code>~/kestrel-shop</code>. Fix <code>compose.yaml</code>, start the stack, and get a healthy <code>/health</code>.</p>",
        system: function (sys) { B.shopProject(sys, { "compose.yaml": B.COMPOSE_V2.replace("    environment:\n      DATABASE_URL", "    enviroment:\n      DATABASE_URL").replace("    image: redis:7-alpine", "     image: redis:7-alpine") }); }, starter: "",
        solution: sol("cd ~/kestrel-shop", "docker compose config", { nano: "~/kestrel-shop/compose.yaml", text: B.COMPOSE_V2 }, "docker compose up -d", "curl localhost:8000/health"),
        check: function (r) { if (!H.loadCompose(r, HOME + "/kestrel-shop")) return "compose.yaml still doesn't load (docker compose config says why)."; return httpOk(r, 8000, "/health", /"db":\s*"ok"/) ? true : "Start it and curl localhost:8000/health"; } },
      { id: "d2", title: "A reverse proxy", text: "<p>Add a <code>web</code> service to <code>~/kestrel-shop/compose.yaml</code>: <code>nginx:1.27-alpine</code> on port 8080, with <code>./nginx.conf</code> mounted read-only at <code>/etc/nginx/conf.d/default.conf</code> and started after <code>api</code>. Then <code>curl localhost:8080/api/health</code> must reach the API.</p>",
        system: function (sys) { B.shopProject(sys, { "compose.yaml": B.COMPOSE_V2, "nginx.conf": sc("server {", "    listen 80;", "", "    location /api/ {", "        proxy_pass http://api:8000/;", "    }", "", "    location / {", "        return 200 \"Kestrel shop\";", "    }", "}") }); }, starter: "",
        solution: sol("cd ~/kestrel-shop", "cat nginx.conf", { nano: "~/kestrel-shop/compose.yaml", text: B.COMPOSE_V2.replace("volumes:\n  db-data:\n", "  web:\n    image: nginx:1.27-alpine\n    ports:\n      - \"8080:80\"\n    volumes:\n      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro\n    depends_on:\n      - api\n\nvolumes:\n  db-data:\n") }, "docker compose up -d", "curl localhost:8080/api/health"),
        check: function (r) { var P = H.loadCompose(r, HOME + "/kestrel-shop"); if (!P || !P.services.web) return "Add a web service."; var v = (P.services.web.volumes || []).filter(function (x) { return x.dst === "/etc/nginx/conf.d/default.conf"; })[0]; if (!v || v.type !== "bind" || !v.ro) return "Mount ./nginx.conf at /etc/nginx/conf.d/default.conf read-only."; return httpOk(r, 8080, "/api/health", /"db":\s*"ok"/) ? true : "Start it and curl localhost:8080/api/health"; } },
      { id: "d3", title: "One service down", text: "<p>The stack is running. Stop <b>only</b> the <code>cache</code> service, show that <code>/health</code> now reports the problem, then start it again.</p>",
        system: function (sys) { B.shopProject(sys, { "compose.yaml": B.COMPOSE_V2 }); }, prelude: "cd ~/kestrel-shop && docker compose up -d > /dev/null 2>&1", starter: "",
        solution: sol("cd ~/kestrel-shop", "docker compose stop cache", "curl localhost:8000/health", "docker compose start cache", "curl localhost:8000/health"),
        check: function (r) { var k = idx(r, /^\s*docker\s+compose\s+stop\b.*\bcache\b/); if (k < 0) return "docker compose stop cache"; if (!r.history.slice(k + 1).some(function (e) { return CURL.test(e.cmd) && /:8000\/health/.test(e.cmd) && /"cache":\s*"Error/.test(out(e)); })) return "curl localhost:8000/health while cache is stopped."; var c = H.svc(r, "kestrel-shop", "cache"); return c && c.state === "running" ? true : "Start cache again."; } }
    ],
    "dev-109": [
      { id: "d1", title: "The docker group is root", text: "<p>You're in the <code>docker</code> group but have no <code>sudo</code> rights in this drill. Print the laptop's <code>/etc/shadow</code> (only root can read it) using a container. Then you'll know why that group must be treated like sudo.</p>",
        system: function (sys) { var sd = S.lookup({ sys: sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, "/etc/sudoers.d").node; if (sd) delete sd.children["90-cloud-init-users"]; }, starter: "",
        solution: sol("cat /etc/shadow", "docker run --rm -v /etc:/host-etc:ro alpine cat /host-etc/shadow"),
        check: function (r) { return ran(r, RUN, function (e) { return /-v\s+\/(etc)?[:\s]/.test(e.cmd + " ") && /^root:[^:]*:\d+:/m.test(out(e)); }) ? true : "Mount the laptop's /etc (or /) into a container and cat the shadow file from there."; } },
      { id: "d2", title: "Ignore with a reason", text: "<p><code>trivy image --severity CRITICAL --exit-code 1 notes-api:2.0</code> fails on a zlib CVE that Debian won't fix (the vulnerable function isn't used by Python). In <code>~/notes-api</code>, add a <code>.trivyignore</code> with that CVE and a comment saying why, so the same command (run from that folder, without <code>--ignore-unfixed</code>) passes.</p>",
        system: B.notesProject("notes-api", { "Dockerfile": B.NOTES_DF, ".dockerignore": B.IGNORE }), prelude: "cd ~/notes-api && docker build -q -t notes-api:2.0 . > /dev/null 2>&1", starter: "",
        solution: sol("cd ~/notes-api", "trivy image --severity CRITICAL --exit-code 1 notes-api:2.0; echo $?", { nano: "~/notes-api/.trivyignore", text: sc("# zlib minizip overflow: Debian won't fix; Python doesn't use minizip. Review 2027-02.", "CVE-2023-45853") }, "trivy image --severity CRITICAL --exit-code 1 notes-api:2.0; echo $?"),
        check: function (r) { var t = readF(r, "~/notes-api/.trivyignore") || ""; if (!/^CVE-2023-45853\s*$/m.test(t)) return "List CVE-2023-45853 in ~/notes-api/.trivyignore."; if (!/^#\s*\S/m.test(t)) return "Add a comment saying why it's ignored (and when to look again)."; return H.trivyRuns(r).some(function (x) { return /notes-api:2\.0/.test(x.target) && x.opts.exitCode && !x.opts.ignoreUnfixed && (x.opts.severity || []).indexOf("CRITICAL") >= 0 && x.found === 0; }) ? true : "Run the scan again from ~/notes-api: it should pass."; } },
      { id: "d3", title: "Lint a Dockerfile", text: "<p>Fix <code>~/legacy-app/Dockerfile</code> until <code>trivy config Dockerfile</code> reports no <b>HIGH</b> or <b>MEDIUM</b> failures.</p>",
        system: files("legacy-app", { "main.py": "print('legacy')\n", "Dockerfile": sc("FROM ubuntu:latest", "ADD . /app", "RUN cd /app && apt-get update && apt-get install -y python3", "CMD python3 /app/main.py") }), starter: "",
        solution: sol("cd ~/legacy-app", "trivy config Dockerfile", { nano: "~/legacy-app/Dockerfile", text: sc("FROM ubuntu:24.04", "RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*", "WORKDIR /app", "COPY . /app", "RUN useradd --uid 10001 app", "USER 10001", "HEALTHCHECK CMD python3 -c 'print(1)'", "CMD [\"python3\", \"/app/main.py\"]") }, "trivy config Dockerfile"),
        check: function (r) { var res = Dk.dockerfileChecks(readF(r, "~/legacy-app/Dockerfile") || ""); if (res.error) return "The Dockerfile doesn't parse: " + res.error; var bad = res.fails.filter(function (f) { return f.id !== "DS005" && f.id !== "DS026"; }); if (bad.length) return "Still failing: " + bad.map(function (f) { return f.id; }).join(", ") + " (trivy config Dockerfile explains each)."; return ran(r, /^\s*trivy\s+config\b/) ? true : "Check it with trivy config Dockerfile."; } }
    ],
    "dev-110": [
      { id: "d1", title: "Back up the database", text: "<p>The orders stack is running in <code>~/kestrel-orders</code>. Dump the <code>orders</code> database to <code>~/backups/orders.sql</code> with <code>pg_dump</code> run inside the <code>db</code> service.</p>",
        system: ordersDone, prelude: ORDERS_UP, starter: "",
        solution: sol("cd ~/kestrel-orders", "mkdir -p ~/backups", "docker compose exec -T db pg_dump -U orders orders > ~/backups/orders.sql", "head ~/backups/orders.sql"),
        check: function (r) { return /PostgreSQL database dump/.test(readF(r, "~/backups/orders.sql") || "") ? true : "Write the dump to ~/backups/orders.sql (docker compose exec -T db pg_dump -U orders orders > ...)."; } },
      { id: "d2", title: "Ship a new version", text: "<p>Change <code>VERSION</code> in <code>api.py</code> to <code>3.1.0</code>, rebuild and restart <b>just the API</b> with Compose, and show <code>/health</code> reporting the new version.</p>",
        system: ordersDone, prelude: ORDERS_UP, starter: "",
        solution: sol("cd ~/kestrel-orders", "sed -i 's/3.0.0/3.1.0/' api.py", "docker compose up -d --build api", "curl localhost:8000/health"),
        check: function (r) { return httpOk(r, 8000, "/health", /"version":\s*"3\.1\.0"/) ? true : "Rebuild and restart the api service (docker compose up -d --build api), then curl localhost:8000/health."; } },
      { id: "d3", title: "Memory limits", text: "<p>Limit the <code>api</code> and <code>worker</code> services to <b>256 MB</b> of memory each in <code>compose.yaml</code>, and apply the change.</p>",
        system: ordersDone, prelude: ORDERS_UP, starter: "",
        solution: sol("cd ~/kestrel-orders", "sed -i 's/^    restart: unless-stopped$/    restart: unless-stopped\\n    mem_limit: 256m/' compose.yaml", "docker compose up -d", "docker stats --no-stream"),
        check: function (r) { var ok = ["api", "worker"].every(function (s) { var c = H.svc(r, "kestrel-orders", s); return c && c.state === "running" && c.mem === 268435456; }); return ok ? true : "Set mem_limit: 256m (or deploy.resources.limits.memory) on api and worker, then docker compose up -d."; } }
    ]
  };
  var ORDERS_UP = "cd ~/kestrel-orders && docker build -q -t kestrel-orders:1.0 . > /dev/null 2>&1 && docker compose up -d > /dev/null 2>&1";
  function ordersDone(sys) {
    B.ordersProject(sys);
    var lab = T.LABS.filter(function (l) { return l.id === "dev-110"; })[0];
    var text = lab.solution.split("\n"), filesOut = {}, cur = null;
    text.forEach(function (l) { var m = /^nano\s+~\/kestrel-orders\/(\S+)$/.exec(l); if (m) { cur = m[1]; filesOut[cur] = []; return; } if (cur && /^ {4}/.test(l)) filesOut[cur].push(l.slice(4)); else cur = null; });
    var m2 = {}; Object.keys(filesOut).forEach(function (k) { m2[k] = filesOut[k].join("\n") + "\n"; });
    DL.setup.files(sys, HOME + "/kestrel-orders", m2);
  }
  DRILLS["dev-110"].forEach(function (d) { d.system = ordersDone; d.prelude = ORDERS_UP; });
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
