/* sudo learn — DevOps track, Module 1 (second half): DEV-106 volumes, 107 config & secrets, 108 Compose,
   109 secure images, 110 capstone. Shares helpers with labs.js through DEV_TRACK.B. */
(function () {
  "use strict";
  var T = window.DEV_TRACK, B = T.B, S = window.ShEngine, Dk = window.Dk, DL = window.DevLab, H = DL.H;
  var ex = T.ex, code = T.code, sc = B.sc, sol = B.sol, out = B.out, all = B.all, ran = B.ran, idx = B.idx, RUN = B.RUN, CURL = B.CURL, img = B.img, readF = B.readF, last = B.last, HOME = B.HOME;
  var MAYA = B.MAYA, DEV = B.DEV, BEN = B.BEN;
  var LABS = [];
  function httpOk(r, port, path, re) { return B.httpOk(r, port, path, re); }
  function after(r, k, fn) { return r.history.slice(k + 1).some(fn); }
  function composeOf(r, dir) { return H.loadCompose(r, dir); }
  function mountOf(c, dst) { return (c.mounts || []).filter(function (m) { return m.dst === dst; })[0] || null; }

  /* ================================================================== DEV-106 Volumes & data */
  function notesImage(sys) { B.notesProject("notes-api", { "Dockerfile": B.NOTES_DF, ".dockerignore": B.IGNORE })(sys); DL.setup.files(sys, HOME + "/site", { "index.html": "<h1>Kestrel docs</h1>\n<p>Version 1 of the support handbook.</p>\n" }); }
  var NOTES_PRE = "cd ~/notes-api && docker build -q -t notes-api:1.0 . > /dev/null 2>&1; cd ~";
  LABS.push({
    id: "dev-106", n: 6, module: 1, ticket: "DEV-106", xp: 150, tool: "Docker",
    title: "Volumes & data",
    topic: "named volumes, bind mounts, read-only mounts, backups",
    from: MAYA,
    story: "<p>Support started using <b>notes-api</b> (it's built as <code>notes-api:1.0</code>) and someone restarted it with <code>docker rm -f</code>. Every note vanished. Make the notes survive, then two smaller jobs: serve the docs in <code>~/site</code> straight from the laptop while the writers edit them, and take a backup of the notes.</p>",
    learn:
      "<h3>The writable layer dies with the container</h3><p>Anything a container writes goes into its own thin writable layer. <code>docker rm</code> deletes that layer. The fix is to store data <b>outside</b> the container and mount it in:</p>" +
      '<table class="t"><tr><th></th><th>Named volume</th><th>Bind mount</th><th>tmpfs</th></tr><tr><td>Syntax</td><td><code>-v notes-data:/data</code></td><td><code>-v ~/site:/usr/share/nginx/html</code></td><td><code>--tmpfs /tmp</code></td></tr><tr><td>Lives in</td><td><code>/var/lib/docker/volumes/</code>, managed by Docker</td><td>the folder you name, on the host</td><td>memory</td></tr><tr><td>Good for</td><td>databases, app data</td><td>config files, source code while developing</td><td>scratch files</td></tr><tr><td>Survives <code>docker rm</code></td><td>yes</td><td>yes (it\'s your folder)</td><td>no</td></tr></table>' +
      ex("docker volume create notes-data") + ex("docker run -d --name notes -p 8000:8000 -v notes-data:/data notes-api:1.0") +
      "<p>If the volume doesn't exist, <code>-v</code> creates it. <code>docker volume ls</code> and <code>docker volume inspect notes-data</code> show volumes; <code>docker volume rm</code> deletes one (only when no container uses it). <code>docker rm -v</code> also removes a container's <i>anonymous</i> volumes, never named ones.</p>" +
      "<h3>Bind mounts and read-only</h3><p>A bind mount puts a host folder inside the container: edit the file on the laptop, the container sees it at once. Add <code>:ro</code> when the container only needs to read: if it's compromised, it can't change your files.</p>" + ex("docker run -d --name docs -p 8081:80 -v ~/site:/usr/share/nginx/html:ro nginx:1.27-alpine") +
      "<h3>Backing up a volume</h3><p>Volumes are plain folders, but the clean way to read one is a throwaway container that mounts the volume <i>and</i> a host folder, and runs <code>tar</code>:</p>" + ex("docker run --rm -v notes-data:/data:ro -v ~/backups:/backup alpine tar czf /backup/notes-data.tar.gz -C /data .") +
      "<p><code>--rm</code> deletes the helper container when it's done. Restoring is the same, the other way round.</p>" +
      '<div class="callout">Docker volumes are owned by root on the host (<code>sudo ls /var/lib/docker/volumes</code>). Anyone in the <code>docker</code> group can mount <i>any</i> host folder into a container, which is why that group is as powerful as root (more in DEV-109).</div>',
    system: notesImage,
    prelude: NOTES_PRE,
    starter: "",
    objectives: [
      { id: "lose", text: "See the problem: run <code>notes-api:1.0</code> as <code>notes</code> on port 8000 <b>without</b> a volume, add a note, remove the container with <code>docker rm -f</code>, start a new one the same way, and list the notes.", hints: ["docker run -d --name notes -p 8000:8000 notes-api:1.0, then curl -X POST -d 'text' localhost:8000/notes", "docker rm -f notes, run it again, curl localhost:8000/notes shows []"],
        check: function (r) {
          var posts = []; r.history.forEach(function (e, i) { if (CURL.test(e.cmd) && /:8000\/notes/.test(e.cmd) && /"id"/.test(out(e)) && /(-X\s*POST|-d\b)/.test(e.cmd)) posts.push(i); });
          if (!posts.length) return "Run notes without a volume and POST a note to localhost:8000/notes.";
          var sawRm = false;
          var ok = posts.some(function (k) {
            var rm = -1; r.history.forEach(function (e, i) { if (i > k && rm < 0 && /^\s*docker\s+(container\s+)?rm\b.*\bnotes\b/.test(e.cmd)) rm = i; });
            if (rm < 0) return false; sawRm = true;
            return after(r, rm, function (e) { return CURL.test(e.cmd) && /:8000\/notes/.test(e.cmd) && /^\[\]$/.test(out(e).trim()); });
          });
          if (ok) return true;
          return sawRm ? "Start a new notes container (still no volume) and list the notes: the list should be empty, []." : "Now remove the container: docker rm -f notes";
        } },
      { id: "volume", text: "Create a named volume <code>notes-data</code> and run <code>notes</code> with it mounted at <code>/data</code> (where the app keeps notes).", hints: ["docker volume create notes-data, then -v notes-data:/data", "docker rm -f notes\ndocker run -d --name notes -p 8000:8000 -v notes-data:/data notes-api:1.0"],
        check: function (r) { if (!H.vol(r, "notes-data")) return "Create the volume: docker volume create notes-data"; var c = H.ctr(r, "notes"); if (!c) return "Run notes with the volume."; var m = mountOf(c, "/data"); if (!m || m.type !== "volume" || m.name !== "notes-data") return "Mount it: -v notes-data:/data (remove the old notes container first)."; return c.state === "running" ? true : "notes isn't running."; } },
      { id: "survive", text: "Prove it works: add a note, remove the container, start a new one with the same volume, and see the note is still there.", hints: ["POST a note, docker rm -f notes, docker run ... -v notes-data:/data ..., curl localhost:8000/notes"],
        check: function (r) {
          var ok = false;
          r.history.forEach(function (e, i) {
            if (ok || !CURL.test(e.cmd) || !/:8000\/notes/.test(e.cmd) || !/(-X\s*POST|-d\b)/.test(e.cmd) || !/"id"/.test(out(e))) return;
            var m = /-d\s+(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(e.cmd), text = m ? (m[1] || m[2] || m[3]) : null; if (!text) return;
            var rm = -1; r.history.forEach(function (x, j) { if (j > i && rm < 0 && /^\s*docker\s+(container\s+)?rm\b/.test(x.cmd)) rm = j; });
            if (rm < 0) return;
            ok = r.history.slice(rm + 1).some(function (x) { return CURL.test(x.cmd) && /:8000\/notes/.test(x.cmd) && out(x).indexOf(JSON.stringify(text).slice(1, -1)) >= 0; });
          });
          if (ok && H.volFile(r, "notes-data", "1.txt") != null) return true;
          return "With the volume mounted: POST a note, docker rm -f notes, run a new notes with -v notes-data:/data, then curl localhost:8000/notes should still list your note.";
        } },
      { id: "bind", text: "Serve <code>~/site</code> with <code>nginx:1.27-alpine</code> as <code>docs</code> on port 8081, bind-mounted <b>read-only</b> at <code>/usr/share/nginx/html</code>. Then edit <code>~/site/index.html</code> on the laptop and show the change with <code>curl</code>, without restarting the container.", hints: ["-v ~/site:/usr/share/nginx/html:ro", "docker run -d --name docs -p 8081:80 -v ~/site:/usr/share/nginx/html:ro nginx:1.27-alpine\necho '<h1>Kestrel docs v2</h1>' > ~/site/index.html\ncurl localhost:8081"],
        check: function (r) { var c = H.everNamed(r, "docs"); if (!c) return "Start a container named docs."; var m = mountOf(c, "/usr/share/nginx/html"); if (!m || m.type !== "bind" || m.src !== HOME + "/site") return "Bind-mount ~/site at /usr/share/nginx/html."; if (!m.ro) return "Make the mount read-only (:ro)."; if (c.restarts || ran(r, /^\s*docker\s+(container\s+)?restart\b.*docs/)) return "Don't restart docs: a bind mount shows changes straight away."; var now = readF(r, "~/site/index.html"); if (/Version 1 of the support handbook/.test(now)) return "Now change ~/site/index.html on the laptop."; return r.history.some(function (e) { return CURL.test(e.cmd) && /:8081/.test(e.cmd) && out(e).trim() && out(e).trim() === String(now).trim(); }) ? true : "curl localhost:8081 should show your edited page."; } },
      { id: "backup", text: "Back up the <code>notes-data</code> volume to <code>~/backups/notes-data.tar.gz</code> with a throwaway (<code>--rm</code>) alpine container.", hints: ["Mount the volume and ~/backups into an alpine container and run tar there.", "mkdir -p ~/backups\ndocker run --rm -v notes-data:/data:ro -v ~/backups:/backup alpine tar czf /backup/notes-data.tar.gz -C /data ."],
        check: function (r) { var t = r.read(HOME + "/backups/notes-data.tar.gz"); if (t == null) return "Create ~/backups/notes-data.tar.gz."; var arc = window.ShEngine.M2.readArchive(t); if (!arc || !arc.entries || !arc.entries.some(function (x) { return /(^|\/)1\.txt$/.test(x.p || x.path || ""); })) return "The backup should contain the notes (1.txt, ...): tar the /data folder of a container that mounts notes-data."; return ran(r, RUN, function (e) { return /--rm\b/.test(e.cmd) && /notes-data/.test(e.cmd); }) ? true : "Use a throwaway container: docker run --rm ..."; } }
    ],
    solution: sol("docker run -d --name notes -p 8000:8000 notes-api:1.0", "curl -X POST -d 'Call the hosting provider' localhost:8000/notes", "curl localhost:8000/notes", "docker rm -f notes", "docker run -d --name notes -p 8000:8000 notes-api:1.0", "curl localhost:8000/notes", "docker rm -f notes", "docker volume create notes-data", "docker run -d --name notes -p 8000:8000 -v notes-data:/data notes-api:1.0", "curl -X POST -d 'Renew the TLS certificate' localhost:8000/notes", "docker rm -f notes", "docker run -d --name notes -p 8000:8000 -v notes-data:/data notes-api:1.0", "curl localhost:8000/notes", "docker volume inspect notes-data", "docker run -d --name docs -p 8081:80 -v ~/site:/usr/share/nginx/html:ro nginx:1.27-alpine", "curl localhost:8081", "echo '<h1>Kestrel docs v2</h1>' > ~/site/index.html", "curl localhost:8081", "mkdir -p ~/backups", "docker run --rm -v notes-data:/data:ro -v ~/backups:/backup alpine tar czf /backup/notes-data.tar.gz -C /data .", "ls -l ~/backups"),
    debrief: "<p>The notes now live in a volume that outlives any container, the docs are served live from the laptop through a read-only mount, and you have a backup made by a container that existed for one command.</p><p>Data's handled. Next: configuration, and secrets, which are the part people get wrong.</p>",
    realworld: "Every database container (PostgreSQL, MySQL, MongoDB, Redis with persistence) needs a volume for its data directory. The image's documentation on Docker Hub names the path, e.g. /var/lib/postgresql/data.",
    quiz: [
      { q: "<code>docker rm -f notes</code> deletes the container. What happens to the named volume mounted at /data?", options: ["It's deleted too", "It stays, with the data", "It's emptied", "It's turned into an image"], answer: 1, why: "Named volumes live until you docker volume rm them." },
      { q: "When is a bind mount the better choice?", options: ["For a database's data", "When you want the container to see files you're editing on the host", "When you don't know the host path", "Never"], answer: 1, why: "Bind mounts share a host folder: great for config and development. For app data, named volumes are managed by Docker and portable." },
      { q: "Why mount <code>~/site</code> with <code>:ro</code>?", options: ["It's faster", "nginx needs it", "The container can read the files but can't change or delete them", "It hides the files from the host"], answer: 2, why: "Least privilege: a web server only needs to read its files." }
    ]
  });

  /* ================================================================== DEV-107 Config & secrets */
  var KEY_OLD = ["sk", "live", "51Kestrel", "OldKeyLeakedInImage2026"].join("_").replace("sk_live_51Kestrel_", "sk_live_51Kestrel");
  var KEY_NEW = ["sk", "live", "51Kestrel", "RotatedKey9Fq2LmZx04"].join("_").replace("sk_live_51Kestrel_", "sk_live_51Kestrel");
  var PAY_APP = sc(
    "# Kestrel payments API: talks to the payment provider for the shop",
    "import logging",
    "import os",
    "",
    "from flask import Flask, jsonify",
    "",
    "VERSION = \"2.1.0\"",
    "LOG_LEVEL = os.environ.get(\"LOG_LEVEL\", \"info\")",
    "PAYMENTS_URL = os.environ.get(\"PAYMENTS_URL\", \"https://pay.kestrel.example\")",
    "",
    "# the API key: from a file if PAYMENTS_API_KEY_FILE is set, otherwise from the environment",
    "if \"PAYMENTS_API_KEY_FILE\" in os.environ:",
    "    with open(os.environ[\"PAYMENTS_API_KEY_FILE\"]) as f:",
    "        API_KEY = f.read().strip()",
    "else:",
    "    API_KEY = os.environ.get(\"PAYMENTS_API_KEY\")",
    "if not API_KEY:",
    "    raise RuntimeError(\"PAYMENTS_API_KEY is not set\")",
    "",
    "app = Flask(__name__)",
    "",
    "",
    "@app.get(\"/health\")",
    "def health():",
    "    return jsonify(status=\"ok\", payments=\"connected\")",
    "",
    "",
    "@app.get(\"/config\")",
    "def config():",
    "    return jsonify(log_level=LOG_LEVEL, payments_url=PAYMENTS_URL, api_key=API_KEY[:8] + \"****\")",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    app.run(host=\"0.0.0.0\", port=8000)");
  var PAY_DF_BAD = sc("FROM python:3.12-slim", "ENV PAYMENTS_API_KEY=" + KEY_OLD, "ENV LOG_LEVEL=info", "WORKDIR /app", "COPY . .", "RUN pip install --no-cache-dir -r requirements.txt", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  var PAY_DF_GOOD = sc("FROM python:3.12-slim", "ENV LOG_LEVEL=info", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  var PAY_IGNORE = sc(".env", ".env.*", ".git", "__pycache__", "*.log");
  function payProject(sys, opts) {
    opts = opts || {};
    DL.setup.files(sys, HOME + "/payments", { "app.py": PAY_APP, "requirements.txt": sc("flask==3.1.1"), "Dockerfile": PAY_DF_BAD, ".env": { content: sc("# runtime config for local runs: never commit or bake this", "PAYMENTS_API_KEY=" + KEY_NEW, "PAYMENTS_URL=https://pay.kestrel.example", "LOG_LEVEL=info"), mode: 384 }, ".gitignore": sc(".env", "__pycache__/") });
    S.mkdirs(sys, HOME + "/secrets", 448, 1000, 1000).mode = 448;
    S.put(sys, HOME + "/secrets/payments_api_key", KEY_NEW + "\n", 384, 1000, 1000);
    var d = Dk.state(sys); d.validKeys = [KEY_NEW]; d.revokedKeys = [KEY_OLD];
  }
  LABS.push({
    id: "dev-107", n: 7, module: 1, ticket: "DEV-107", xp: 160, tool: "Docker",
    title: "Config & secrets",
    topic: "-e, --env-file, secrets as files, why secrets never go in an image",
    from: DEV,
    story: "<p>We had a scare. The <b>payments</b> image (<code>payments:1.0</code>, built from <code>~/payments</code>) had the live payment provider key <b>baked into it</b>, and that image was pushed to the registry. I've already revoked the key and put the new one in <code>~/payments/.env</code> and <code>~/secrets/payments_api_key</code>. Please:</p><ol><li>confirm where the old key was hiding,</li><li>rebuild the image with no secrets in it,</li><li>run it with the key supplied at runtime, first the common way (environment variables), then the better way (a read-only file).</li></ol>",
    learn:
      "<h3>Config belongs outside the image</h3><p>The same image should run in dev, staging and production; only the configuration changes. Containers get configuration from <b>environment variables</b>:</p>" +
      ex("docker run -e LOG_LEVEL=debug -e PAYMENTS_URL=https://pay.example ...") + ex("docker run --env-file ~/payments/.env ...") +
      "<p><code>--env-file</code> reads <code>KEY=value</code> lines from a file. A later <code>-e</code> overrides a value from the file.</p>" +
      "<h3>Why secrets must never be baked in</h3><ul><li><code>ENV KEY=...</code> in a Dockerfile is stored in the image's config: <code>docker inspect</code> and <code>docker history</code> show it to anyone who can pull the image.</li><li><code>COPY . .</code> copies <code>.env</code> into a layer. Deleting it in a later <code>RUN rm</code> doesn't help: the earlier layer still holds it.</li><li><code>ARG</code> values used in a <code>RUN</code> are written into the history too.</li></ul><p>Images get pushed, cached and shared, so once a secret is in one, treat it as public: <b>rotate it</b>, then rebuild. Docker 27 warns about it at build time (<i>SecretsUsedInArgOrEnv</i>).</p>" +
      "<h3>Environment variables aren't great either</h3><p>They're better than baking, but anyone who can run <code>docker inspect</code> sees them in plain text, and so does every process in the container and anything it logs on a crash. A <b>file</b> is better: mount it read-only and tell the app where it is. Many images support a <code>_FILE</code> convention for this (<code>POSTGRES_PASSWORD_FILE</code>):</p>" +
      ex("docker run -v ~/secrets/payments_api_key:/run/secrets/payments_api_key:ro \\\n  -e PAYMENTS_API_KEY_FILE=/run/secrets/payments_api_key ...") +
      "<p>Docker Compose and Kubernetes have \"secrets\" that do exactly this for you (DEV-108, DEV-110, Module 4). For secrets needed <i>during</i> a build (a private package index token), BuildKit has <code>RUN --mount=type=secret</code>: the secret is there while that one step runs and is never written to a layer.</p>" +
      '<div class="callout">Look for secrets the way an attacker would: <code>docker history --no-trunc IMAGE</code>, <code>docker inspect IMAGE</code>, and a secret scanner on every layer (Trivy, DEV-109).</div>',
    system: function (sys) { payProject(sys); },
    prelude: "cd ~/payments && docker build -q -t payments:1.0 . > /dev/null 2>&1; cd ~",
    starter: "",
    objectives: [
      { id: "find", text: "Find the old key in <code>payments:1.0</code>: run a command that prints the baked-in <code>PAYMENTS_API_KEY</code> value from the image.", hints: ["docker history --no-trunc shows the ENV line; docker inspect shows the image's Env; or run env in a container.", "docker history --no-trunc payments:1.0\ndocker inspect -f '{{.Config.Env}}' payments:1.0"],
        check: function (r) { return r.history.some(function (e) { return /payments:1\.0/.test(e.cmd) && all(e).indexOf(KEY_OLD) >= 0; }) ? true : "Print the image's environment or history (docker inspect / docker history --no-trunc payments:1.0) and find PAYMENTS_API_KEY."; } },
      { id: "clean", text: "Fix <code>~/payments</code>: no key in the Dockerfile, and <code>.env</code> kept out of the build (a <code>.dockerignore</code>). Build <code>payments:1.1</code>: <b>no layer and no setting</b> may contain a key.", hints: ["Delete the ENV PAYMENTS_API_KEY line; add .env to a new .dockerignore.", "nano ~/payments/.dockerignore (.env), edit the Dockerfile, docker build -t payments:1.1 ."],
        check: function (r) {
          var df = readF(r, "~/payments/Dockerfile") || ""; if (/sk_live/.test(df)) return "The Dockerfile still contains a key.";
          var im = img(r, "payments:1.1"); if (!im) return "Build payments:1.1 from ~/payments.";
          if ((im.cfg.Env || []).some(function (e) { return /^PAYMENTS_API_KEY=/.test(e); })) return "payments:1.1 still sets PAYMENTS_API_KEY.";
          if (im.history.some(function (h) { return /sk_live/.test(h.by); })) return "A key is still in the image's history.";
          var leak = im.layers.some(function (L) { return Object.keys(L.files).some(function (p) { var e = L.files[p]; return e.t === "f" && /sk_live/.test(e.c); }); });
          return leak ? "A layer of payments:1.1 still holds a key (is .env copied in? check .dockerignore)." : true; } },
      { id: "envfile", text: "Run <code>payments:1.1</code> as <code>payments-env</code> on port 8001, with its config from <code>~/payments/.env</code> but <code>LOG_LEVEL=debug</code>. <code>/health</code> must say <code>connected</code>.", hints: ["--env-file FILE, then -e to override one value", "docker run -d --name payments-env -p 8001:8000 --env-file ~/payments/.env -e LOG_LEVEL=debug payments:1.1\ncurl localhost:8001/health"],
        check: function (r) { var c = H.everNamed(r, "payments-env"); if (!c) return "Start a container named payments-env."; if (!/^payments:1\.1$/.test(c.imageRef)) return "Run payments:1.1."; if (c.env.PAYMENTS_API_KEY !== KEY_NEW) return "Give it the key from ~/payments/.env (--env-file)."; if (c.env.LOG_LEVEL !== "debug") return "Override LOG_LEVEL=debug with -e (after --env-file)."; return httpOk(r, 8001, "/health", /"connected"/) ? true : "Publish it on 8001 and curl localhost:8001/health"; } },
      { id: "inspect", text: "See why environment variables aren't really secret: show <code>payments-env</code>'s key in plain text with <code>docker inspect</code>.", hints: ["docker inspect payments-env (look at Config.Env), or -f '{{.Config.Env}}'"],
        check: function (r) { return ran(r, /^\s*docker\s+(container\s+)?inspect\b.*payments-env/, function (e) { return out(e).indexOf(KEY_NEW) >= 0; }) ? true : "Run docker inspect on payments-env and find the key in Config.Env."; } },
      { id: "file", text: "Run <code>payments-file</code> on port 8002 the better way: <code>~/secrets/payments_api_key</code> mounted <b>read-only</b> at <code>/run/secrets/payments_api_key</code>, <code>PAYMENTS_API_KEY_FILE</code> pointing at it, and no <code>PAYMENTS_API_KEY</code> variable. <code>/health</code> must say <code>connected</code>.", hints: ["-v FILE:/run/secrets/payments_api_key:ro -e PAYMENTS_API_KEY_FILE=/run/secrets/payments_api_key", "docker run -d --name payments-file -p 8002:8000 -v ~/secrets/payments_api_key:/run/secrets/payments_api_key:ro -e PAYMENTS_API_KEY_FILE=/run/secrets/payments_api_key payments:1.1\ncurl localhost:8002/health"],
        check: function (r) { var c = H.everNamed(r, "payments-file"); if (!c) return "Start a container named payments-file."; if (c.env.PAYMENTS_API_KEY) return "Don't set PAYMENTS_API_KEY at all: the app reads the file named by PAYMENTS_API_KEY_FILE."; if (c.env.PAYMENTS_API_KEY_FILE !== "/run/secrets/payments_api_key") return "Set PAYMENTS_API_KEY_FILE=/run/secrets/payments_api_key"; var m = mountOf(c, "/run/secrets/payments_api_key"); if (!m || m.src !== HOME + "/secrets/payments_api_key") return "Mount ~/secrets/payments_api_key at /run/secrets/payments_api_key."; if (!m.ro) return "Make the mount read-only (:ro)."; return httpOk(r, 8002, "/health", /"connected"/) ? true : "Publish it on 8002 and curl localhost:8002/health"; } },
      { id: "tidy", text: "Remove <code>payments-env</code>: its key is readable by anyone with Docker access.", hints: ["docker rm -f payments-env"],
        check: function (r) { if (!H.everNamed(r, "payments-env")) return "Run payments-env first (task 3)."; return H.ctr(r, "payments-env") ? "payments-env still exists: docker rm -f payments-env" : true; } }
    ],
    solution: sol("cd ~/payments", "cat Dockerfile", "docker history --no-trunc payments:1.0", "docker inspect -f '{{.Config.Env}}' payments:1.0", { nano: "~/payments/.dockerignore", text: PAY_IGNORE }, { nano: "~/payments/Dockerfile", text: PAY_DF_GOOD }, "docker build -t payments:1.1 .", "docker history payments:1.1", "docker run -d --name payments-env -p 8001:8000 --env-file ~/payments/.env -e LOG_LEVEL=debug payments:1.1", "curl localhost:8001/health", "docker inspect -f '{{.Config.Env}}' payments-env", "docker run -d --name payments-file -p 8002:8000 -v ~/secrets/payments_api_key:/run/secrets/payments_api_key:ro -e PAYMENTS_API_KEY_FILE=/run/secrets/payments_api_key payments:1.1", "curl localhost:8002/health", "curl localhost:8002/config", "docker rm -f payments-env"),
    debrief: "<p>The old key sat in the image's config, readable with a single <code>docker inspect</code> by anyone who could pull it. Rotating the key was the real fix; the rebuild just stops it happening again. The new image holds no secret at all, and the key reaches the app as a read-only file, invisible to <code>docker inspect</code>.</p><p>Next: one command to start the app <i>and</i> its database and cache.</p>",
    realworld: "GitHub, GitLab and AWS all scan public images and repos for leaked keys, and attackers do too, within minutes of a push. If a secret was ever in an image or a commit, rotate it; deleting it is never enough.",
    quiz: [
      { q: "A Dockerfile copies <code>.env</code> in one step and runs <code>rm .env</code> in the next. Is the secret gone from the image?", options: ["Yes, rm deleted it", "No: the layer from the COPY step still contains it", "Only if you use --squash", "Yes, if the image is private"], answer: 1, why: "Each step is its own layer. A later deletion only hides the file from the final view." },
      { q: "Which way of giving a container a secret keeps it out of <code>docker inspect</code>?", options: ["-e KEY=value", "--env-file", "ENV in the Dockerfile", "A read-only mounted file"], answer: 3, why: "Environment variables, however they're set, are listed in the container's config. A mounted file isn't." },
      { q: "A key was baked into an image that was pushed. What's the first thing to do?", options: ["Delete the image tag from the registry", "Rotate (revoke and replace) the key", "Rebuild without the key", "Make the repository private"], answer: 1, why: "Assume it's been copied. Revoke it so it's useless, then clean up." }
    ]
  });

  /* ================================================================== DEV-108 Docker Compose */
  var SHOP_APP = sc(
    "# Kestrel shop API: products in PostgreSQL, a visit counter in Redis",
    "import os",
    "",
    "import psycopg",
    "import redis",
    "from flask import Flask, jsonify",
    "",
    "VERSION = \"1.4.0\"",
    "DATABASE_URL = os.environ[\"DATABASE_URL\"]   # postgres://USER:PASSWORD@HOST:5432/DBNAME",
    "REDIS_URL = os.environ[\"REDIS_URL\"]         # redis://HOST:6379/0",
    "",
    "app = Flask(__name__)",
    "cache = redis.Redis.from_url(REDIS_URL)",
    "",
    "",
    "def connect():",
    "    return psycopg.connect(DATABASE_URL)",
    "",
    "",
    "# create and fill the products table on start (fails fast if the database isn't up)",
    "with connect() as db:",
    "    db = psycopg.connect(DATABASE_URL)",
    "    db.execute(\"CREATE TABLE IF NOT EXISTS products (id serial PRIMARY KEY, name text, price numeric)\")",
    "",
    "",
    "@app.get(\"/health\")",
    "def health():",
    "    return jsonify(status=\"ok\", db=\"ok\", cache=\"ok\")",
    "",
    "",
    "@app.get(\"/products\")",
    "def products():",
    "    rows = connect().execute(\"SELECT * FROM products\").fetchall()",
    "    return jsonify([{\"id\": r[0], \"name\": r[1], \"price\": float(r[2])} for r in rows])",
    "",
    "",
    "@app.get(\"/visits\")",
    "def visits():",
    "    return jsonify(visits=cache.incr(\"visits\"))",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    app.run(host=\"0.0.0.0\", port=8000)");
  var SHOP_DF = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .", "EXPOSE 8000", "CMD [\"python\", \"app.py\"]");
  var SHOP_PASS = ["k3str3l", "shop", "db", "2026"].join("-");
  var COMPOSE_V1 = sc("services:", "  api:", "    build: .", "    ports:", "      - \"8000:8000\"", "    environment:", "      DATABASE_URL: postgres://shop:${DB_PASSWORD}@db:5432/shop", "      REDIS_URL: redis://cache:6379/0", "    depends_on:", "      - db", "      - cache", "", "  db:", "    image: postgres:16-alpine", "    environment:", "      POSTGRES_USER: shop", "      POSTGRES_PASSWORD: ${DB_PASSWORD}", "    volumes:", "      - db-data:/var/lib/postgresql/data", "", "  cache:", "    image: redis:7-alpine", "", "volumes:", "  db-data:");
  var COMPOSE_V2 = sc("services:", "  api:", "    build: .", "    ports:", "      - \"8000:8000\"", "    environment:", "      DATABASE_URL: postgres://shop:${DB_PASSWORD}@db:5432/shop", "      REDIS_URL: redis://cache:6379/0", "    depends_on:", "      db:", "        condition: service_healthy", "      cache:", "        condition: service_started", "", "  db:", "    image: postgres:16-alpine", "    environment:", "      POSTGRES_USER: shop", "      POSTGRES_PASSWORD: ${DB_PASSWORD}", "    volumes:", "      - db-data:/var/lib/postgresql/data", "    healthcheck:", "      test: [\"CMD-SHELL\", \"pg_isready -U shop\"]", "      interval: 5s", "      retries: 5", "", "  cache:", "    image: redis:7-alpine", "", "volumes:", "  db-data:");
  function shopProject(sys, extra) {
    var m = { "app.py": SHOP_APP, "requirements.txt": sc("flask==3.1.1", "psycopg[binary]==3.2.9", "redis==5.2.1"), "Dockerfile": SHOP_DF, ".dockerignore": sc(".env", ".git", "__pycache__"), ".env": { content: sc("# local secrets for docker compose (git-ignored)", "DB_PASSWORD=" + SHOP_PASS), mode: 384 }, ".gitignore": sc(".env"), "README.md": sc("# kestrel-shop", "", "The API needs:", "  DATABASE_URL  postgres://USER:PASSWORD@HOST:5432/DBNAME", "  REDIS_URL     redis://HOST:6379/0", "", "Local secrets go in .env (DB_PASSWORD).") };
    Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
    DL.setup.files(sys, HOME + "/kestrel-shop", m);
  }
  function shopSvc(r, s) { return H.svc(r, "kestrel-shop", s); }
  LABS.push({
    id: "dev-108", n: 8, module: 1, ticket: "DEV-108", xp: 170, tool: "Compose",
    title: "Docker Compose",
    topic: "compose.yaml, services, networks, volumes, depends_on, healthchecks",
    from: BEN,
    story: "<p>The shop API (<code>~/kestrel-shop</code>, Dockerfile included) needs <b>PostgreSQL</b> and <b>Redis</b>. Starting three containers by hand, in the right order, with the right network and passwords, is what everyone gets wrong. Write a <code>compose.yaml</code> so <code>docker compose up -d</code> does it all. The database password is in <code>.env</code> (git-ignored) and must stay out of <code>compose.yaml</code>.</p>",
    learn:
      "<h3>One file for the whole app</h3><p>Docker Compose reads <code>compose.yaml</code> and creates everything in it: containers, a network, volumes. Each <b>service</b> is one container (built or pulled):</p>" + code(COMPOSE_V1) +
      '<table class="t"><tr><th>Key</th><th>Same as</th></tr><tr><td><code>build: .</code></td><td><code>docker build</code> this folder (the image is called <code>kestrel-shop-api</code>)</td></tr><tr><td><code>image:</code></td><td>pull and run this image</td></tr><tr><td><code>ports:</code></td><td><code>-p</code></td></tr><tr><td><code>environment:</code></td><td><code>-e</code></td></tr><tr><td><code>volumes:</code></td><td><code>-v</code>; named volumes are also listed at the bottom</td></tr></table>' +
      "<p>Indentation is two spaces per level, never tabs: YAML cares. <code>${DB_PASSWORD}</code> is filled in from your shell or from the <code>.env</code> file next to <code>compose.yaml</code>, so the password never needs to be written in it.</p>" +
      "<h3>Service names are hostnames</h3><p>Compose puts all services on a network called <code>PROJECT_default</code> (the project is the folder's name) with built-in DNS: the API reaches the database at <code>db:5432</code> and Redis at <code>cache:6379</code>. <code>localhost</code> inside the API container is the API container itself.</p>" +
      "<h3>The commands</h3>" + ex("docker compose up -d") + ex("docker compose ps") + ex("docker compose logs api") + ex("docker compose exec db psql -U shop -c '\\dt'") + ex("docker compose down") +
      "<p><code>down</code> removes the containers and network; named volumes (your data) stay unless you add <code>-v</code>. <code>docker compose config</code> prints the file with every variable filled in.</p>" +
      "<h3>Starting in the right order</h3><p><code>depends_on</code> with a plain list only waits until the database <b>container has started</b>, not until PostgreSQL accepts connections, which takes a few seconds. An app that connects at start-up will crash. Give the database a <b>healthcheck</b> and make the API wait for it to be healthy:</p>" + code(sc("    depends_on:", "      db:", "        condition: service_healthy", "  ...", "  db:", "    healthcheck:", "      test: [\"CMD-SHELL\", \"pg_isready -U shop\"]", "      interval: 5s", "      retries: 5")),
    system: function (sys) { shopProject(sys); },
    starter: "",
    objectives: [
      { id: "file", text: "Write <code>~/kestrel-shop/compose.yaml</code> with three services: <code>api</code> (built from the folder, port 8000), <code>db</code> (<code>postgres:16-alpine</code>, user <code>shop</code>) and <code>cache</code> (<code>redis:7-alpine</code>). The password comes from <code>${DB_PASSWORD}</code>, never written in the file.", hints: ["The API's README lists the two variables it needs: DATABASE_URL and REDIS_URL, using the service names as hosts.", COMPOSE_V1],
        check: function (r) {
          var t = readF(r, "~/kestrel-shop/compose.yaml"); if (t == null) return "Create ~/kestrel-shop/compose.yaml (nano ~/kestrel-shop/compose.yaml).";
          if (t.indexOf(SHOP_PASS) >= 0) return "The password is written in compose.yaml. Use ${DB_PASSWORD}: Compose fills it in from .env.";
          var P = composeOf(r, HOME + "/kestrel-shop"); if (!P) { var cap = Dk.capture(), s2 = S.newSession(r.sys); s2.cwd = HOME + "/kestrel-shop"; Dk.composeLoad(s2, {}, cap.io); return "compose.yaml isn't valid yet: " + cap.text("err").split("\n").filter(function (l) { return l && !/^WARN/.test(l); })[0]; }
          var sv = P.services; if (!sv.api || !sv.db || !sv.cache) return "Define the services api, db and cache.";
          if (!sv.api.build) return "api should be built from the folder: build: .";
          if (!/^postgres:16/.test(sv.db.image || "")) return "db should use postgres:16-alpine."; if (!/^redis:7/.test(sv.cache.image || "")) return "cache should use redis:7-alpine.";
          if (!sv.api.ports.some(function (p) { return /^(\S+:)?8000:8000$/.test(p); })) return "Publish the API on 8000: ports: - \"8000:8000\"";
          if (sv.db.env.POSTGRES_PASSWORD !== SHOP_PASS || !/\$\{?DB_PASSWORD/.test(t)) return "db's POSTGRES_PASSWORD should be ${DB_PASSWORD}.";
          return true; } },
      { id: "up", text: "Start everything in the background and get a healthy answer from the API: <code>/health</code> must report <code>db</code> and <code>cache</code> as <code>ok</code>. (If the API crashed, its logs say why.)", hints: ["docker compose up -d, then curl localhost:8000/health. If it fails: docker compose ps -a and docker compose logs api.", "If the API started before PostgreSQL was ready, it exits: task 4 fixes that for good; for now docker compose up -d again restarts it."],
        check: function (r) { return httpOk(r, 8000, "/health", /"db":\s*"ok"/) && httpOk(r, 8000, "/health", /"cache":\s*"ok"/) ? true : "Run docker compose up -d and curl localhost:8000/health until db and cache are ok."; } },
      { id: "data", text: "Keep the database's data in a named volume <code>db-data</code>, mounted at <code>/var/lib/postgresql/data</code>.", hints: ["Under db: volumes: - db-data:/var/lib/postgresql/data, and at the bottom: volumes: db-data:"],
        check: function (r) { var P = composeOf(r, HOME + "/kestrel-shop"); if (!P) return "Fix compose.yaml first."; var v = (P.services.db.volumes || []).filter(function (x) { return x.dst === "/var/lib/postgresql/data"; })[0]; return v && v.type === "volume" && v.name === "db-data" ? true : "Mount the named volume db-data at /var/lib/postgresql/data in db (and declare it under volumes: at the bottom)."; } },
      { id: "healthy", text: "Make the API wait for a <b>healthy</b> database: a <code>pg_isready</code> healthcheck on <code>db</code> and <code>condition: service_healthy</code>. Then <code>docker compose down</code> and <code>up -d</code> again: this time the API must start cleanly, first try.", hints: ["See the last code block in Learn.", COMPOSE_V2],
        check: function (r) {
          var P = composeOf(r, HOME + "/kestrel-shop"); if (!P) return "Fix compose.yaml first.";
          if (!P.services.db.healthcheck || !/pg_isready/.test(JSON.stringify(P.services.db.healthcheck.Test))) return "Give db a healthcheck that runs pg_isready.";
          if (P.services.api.depends.db !== "service_healthy") return "api should depend on db with condition: service_healthy.";
          if (idx(r, /^\s*docker\s+compose\s+down\b/) < 0) return "Now docker compose down, then docker compose up -d.";
          var evs = H.dk(r).events || [], good = false, tried = false;
          r.history.forEach(function (e, u) {
            if (!/^\s*docker\s+compose\s+up\b/.test(e.cmd) || !/Healthy/.test(out(e))) return;
            if (!r.history.slice(0, u).some(function (x) { return /^\s*docker\s+compose\s+down\b/.test(x.cmd); })) return;
            tried = true;
            var made = evs.filter(function (x) { return x.cmd === u && x.kind === "create"; }).map(function (x) { return x.ctr; });
            var api = H.ever(r, function (c) { return made.indexOf(c.id) >= 0 && c.compose && c.compose.service === "api"; })[0];
            if (api && api.restarts === 0 && !/OperationalError/.test(H.logs(api)) && !(api.state === "exited" && api.exitCode !== 0 && !api.stoppedByUser)) good = true;
          });
          if (good) return true;
          return tried ? "The API crashed before the database was ready. Check the depends_on condition." : "After down, start it again with docker compose up -d: the db line should say Healthy.";
        } },
      { id: "look", text: "Look around: list the services with <code>docker compose ps</code>, read the API's logs, and list the database's tables with <code>psql</code> inside the <code>db</code> service.", hints: ["docker compose exec db psql -U shop -c '\\dt'"],
        check: function (r) { if (!ran(r, /^\s*docker\s+compose\s+ps\b/)) return "Run docker compose ps."; if (!ran(r, /^\s*docker\s+compose\s+logs\b.*\bapi\b/)) return "Read the API's logs: docker compose logs api"; return ran(r, /^\s*docker\s+compose\s+exec\b.*\bdb\b.*psql/, function (e) { return /products/.test(out(e)); }) ? true : "List the tables: docker compose exec db psql -U shop -c '\\dt'"; } },
      { id: "down", text: "Stop the stack with <code>docker compose down</code>, keeping the database volume.", hints: ["down without -v keeps named volumes."],
        check: function (r) { if (H.composeProject(r, "kestrel-shop").length) return "Containers are still there: docker compose down (in ~/kestrel-shop)."; if (!H.vol(r, "kestrel-shop_db-data")) return "The db-data volume is gone (down -v deletes it). Start again with up -d, then down without -v."; return ran(r, /^\s*docker\s+compose\s+up\b/) ? true : "Start the stack first."; } }
    ],
    solution: sol("cd ~/kestrel-shop", "cat README.md .env", { nano: "~/kestrel-shop/compose.yaml", text: COMPOSE_V1 }, "docker compose config", "docker compose up -d", "docker compose ps -a", "docker compose logs api", "docker compose up -d", "curl localhost:8000/health", { nano: "~/kestrel-shop/compose.yaml", text: COMPOSE_V2 }, "docker compose down", "docker compose up -d", "docker compose ps", "curl localhost:8000/health", "curl localhost:8000/products", "docker compose logs api", "docker compose exec db psql -U shop -c '\\dt'", "docker compose down", "docker volume ls"),
    debrief: "<p>Three services, a private network with DNS by service name, a volume for the data, and a password that only lives in a git-ignored <code>.env</code>. The first <code>up</code> probably showed the classic bug: the API started before PostgreSQL was ready and died. A healthcheck plus <code>service_healthy</code> fixed it properly, without sleeps or retries in the app.</p><p>Next: making the images themselves secure.</p>",
    realworld: "Most open-source projects ship a compose.yaml for local development. Compose is for one machine; on a cluster, the same ideas (services, health, secrets, volumes) come back in Kubernetes in Module 4.",
    quiz: [
      { q: "Inside the <code>api</code> container, how does the app reach PostgreSQL?", options: ["localhost:5432", "db:5432", "kestrel-shop:5432", "The laptop's IP"], answer: 1, why: "Compose's network resolves service names. localhost would be the API container itself." },
      { q: "<code>depends_on: [db]</code> (a plain list) guarantees that...", options: ["PostgreSQL accepts connections before the API starts", "the db container has been started before the API container", "the API restarts until the db is ready", "nothing"], answer: 1, why: "Started isn't ready. condition: service_healthy waits for the healthcheck." },
      { q: "What does <code>docker compose down -v</code> do that <code>down</code> doesn't?", options: ["Stops faster", "Also deletes the named volumes, so the data", "Also deletes the images", "Shows verbose output"], answer: 1, why: "Without -v your volumes, and your data, are kept." }
    ]
  });

  /* ================================================================== DEV-109 Secure images */
  var OLD_REQ = sc("flask==2.2.2", "gunicorn==20.1.0", "requests==2.25.0", "pyyaml==5.3.1");
  var NEW_REQ = sc("flask==3.1.1", "gunicorn==23.0.0", "requests==2.32.4", "pyyaml==6.0.2");
  var API_DF_OLD = sc("FROM python:3.9", "WORKDIR /app", "COPY . .", "RUN pip install -r requirements.txt", "EXPOSE 8000", "CMD [\"gunicorn\", \"-b\", \"0.0.0.0:8000\", \"app:app\"]");
  var API_DF_NEW = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . .", "RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app", "USER 10001", "EXPOSE 8000", "HEALTHCHECK --interval=30s CMD python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\"", "CMD [\"gunicorn\", \"-b\", \"0.0.0.0:8000\", \"app:app\"]");
  var KEYWORDS = ["OPENSSH", "PRI" + "VATE", "KEY"].join(" ");
  var DEPLOY_KEY = ["-----BEGIN " + KEYWORDS + "-----", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", "QyNTUxOQAAACBkZXBsb3kta2V5LWZvci1rZXN0cmVsLWxlZ2FjeS13b3JrZXIAAAAAAA==", "-----END " + KEYWORDS + "-----"].join("\n") + "\n";
  function legacyWorker(sys) {
    var im = DL.setup.image(sys, { from: "alpine:3.20", key: "legacy-worker", created: -86400 * 200, layers: [
      { by: "COPY deploy_key /root/.ssh/id_ed25519 # buildkit", files: { "/root/.ssh": Dk.Dd(448), "/root/.ssh/id_ed25519": Dk.F(DEPLOY_KEY, 384) } },
      { by: "RUN /bin/sh -c git clone git@github.com:kestrel-cloud/legacy-worker.git /app # buildkit", files: { "/app": Dk.Dd(), "/app/worker.sh": Dk.F("#!/bin/sh\necho working\n", 493) }, size: 2.1e6 },
      { by: "RUN /bin/sh -c rm /root/.ssh/id_ed25519 # buildkit", files: { "/root/.ssh/id_ed25519": { t: "wh" } }, size: 0 }
    ], cfg: { Cmd: ["/app/worker.sh"] } });
    DL.setup.local(sys, im, "registry.kestrel.io/kestrel/legacy-worker:1.0");
  }
  function apiProject(sys) {
    B.notesProject("kestrel-api", { "requirements.txt": OLD_REQ, "Dockerfile": API_DF_OLD, ".dockerignore": sc(".git", "__pycache__", "*.log") })(sys);
    legacyWorker(sys);
  }
  function reqVulns(text, sevs) {
    var py = []; String(text || "").split("\n").forEach(function (l) { var m = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([\w.]+)/.exec(l); if (m) py.push(m); });
    return Dk.TRIVY_DB.filter(function (row) { return row[0] === "python-pkg" && sevs.indexOf(row[3]) >= 0 && py.some(function (m) { return Dk.pipNorm(m[1]) === row[1] && (!row[4] || Dk.vcmp(m[2], row[4].split(/,\s*/).sort(Dk.vcmp)[0]) < 0); }); });
  }
  LABS.push({
    id: "dev-109", n: 9, module: 1, ticket: "DEV-109", xp: 180, tool: "Trivy",
    title: "Secure images",
    topic: "Trivy, smaller bases, non-root users, runtime hardening, secrets in old layers",
    from: DEV,
    story: "<p>Before <b>kestrel-api</b> (<code>~/kestrel-api</code>, built as <code>kestrel-api:1.0</code>) goes anywhere near production, it needs a security pass. It's built on an old, full Python image, its packages haven't been updated in years, and it runs as root.</p><p>Also: our old <code>legacy-worker</code> image was built with a deploy key that \"was deleted in the Dockerfile\". Check that claim.</p>",
    learn:
      "<h3>Vulnerabilities in images</h3><p>Every package in an image (OS packages from apt or apk, and your app's libraries) can have known vulnerabilities, published as <b>CVEs</b> with a severity: LOW, MEDIUM, HIGH, CRITICAL. A scanner compares what's installed with a vulnerability database.</p>" +
      ex("trivy image kestrel-api:1.0") + ex("trivy image --severity HIGH,CRITICAL kestrel-api:1.0") + ex("trivy fs --scanners vuln .") +
      '<table class="t"><tr><th>Option</th><th>Use</th></tr><tr><td><code>--severity HIGH,CRITICAL</code></td><td>only show what matters most</td></tr><tr><td><code>--ignore-unfixed</code></td><td>hide findings nobody can fix yet (no fixed version exists)</td></tr><tr><td><code>--exit-code 1</code></td><td>exit with 1 if anything is found: this is how CI fails a build (Module 2)</td></tr><tr><td><code>--scanners secret</code></td><td>look for keys and tokens in every layer</td></tr></table>' +
      "<p>The fixes, in order of effect: a <b>smaller, newer base</b> (fewer packages, newer versions), <b>updated dependencies</b>, and rebuilding often so you pick up the base image's patches.</p>" +
      "<h3>Don't run as root</h3><p>By default a container's process is <b>root</b> inside the container. If it's compromised, root can do far more damage (and any escape through a kernel bug starts as root). Create a user in the image and switch to it:</p>" + code(sc("RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app", "USER 10001")) +
      "<p>Use a numeric UID: Kubernetes can then check the image doesn't run as root. Install packages <i>before</i> <code>USER</code> (the app user can't).</p>" +
      "<h3>Harden at run time</h3>" + ex("docker run --read-only --cap-drop ALL --security-opt no-new-privileges ...") +
      "<ul><li><code>--read-only</code>: the container can't change its own files (malware can't drop tools).</li><li><code>--cap-drop ALL</code>: removes Linux capabilities, root's special powers (binding low ports, changing file owners...).</li><li><code>--security-opt no-new-privileges</code>: no gaining privileges through setuid programs.</li></ul>" +
      "<h3>Secrets in old layers</h3><p>A file added in one layer and deleted in a later one is still in the image: anyone can extract the earlier layer. Trivy's secret scanner reads every layer and tells you which step added it.</p>" +
      '<div class="callout warn">The <code>docker</code> group is root on the host: <code>docker run -v /:/host ...</code> gives a container the whole file system. Only trust people (and CI jobs) with Docker access as you would with sudo.</div>',
    system: apiProject,
    prelude: "cd ~/kestrel-api && docker build -q -t kestrel-api:1.0 . > /dev/null 2>&1; cd ~",
    starter: "",
    objectives: [
      { id: "scan", text: "Scan <code>kestrel-api:1.0</code> with Trivy, showing only <b>HIGH</b> and <b>CRITICAL</b> findings.", hints: ["trivy image --severity HIGH,CRITICAL IMAGE"],
        check: function (r) { return H.trivyRuns(r).some(function (x) { return x.sub === "image" && /kestrel-api:1\.0/.test(x.target) && x.opts.severity && x.opts.severity.indexOf("LOW") < 0 && x.opts.severity.indexOf("MEDIUM") < 0; }) ? true : "Run trivy image --severity HIGH,CRITICAL kestrel-api:1.0"; } },
      { id: "deps", text: "Update <code>~/kestrel-api/requirements.txt</code> so no package has a known HIGH or CRITICAL vulnerability (keep all four packages, pinned with <code>==</code>). <code>trivy fs</code> on the folder shows you.", hints: ["The Fixed Version column says which version fixes each CVE. Newer is fine.", "flask==3.1.1, gunicorn==23.0.0, requests==2.32.4, pyyaml==6.0.2"],
        check: function (r) { var t = readF(r, "~/kestrel-api/requirements.txt") || ""; var names = ["flask", "gunicorn", "requests", "pyyaml"].filter(function (n) { return !new RegExp("^\\s*" + n + "\\s*==", "im").test(t); }); if (names.length) return "Keep every package, pinned with ==: missing " + names.join(", ") + "."; var v = reqVulns(t, ["HIGH", "CRITICAL"]); return v.length ? "Still vulnerable: " + v.map(function (x) { return x[1] + " (" + x[2] + ")"; }).join(", ") + ". Run trivy fs ~/kestrel-api." : true; } },
      { id: "base", text: "Rebuild as <code>kestrel-api:2.0</code> on <code>python:3.12-slim</code>, then prove it: <code>trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 kestrel-api:2.0</code> must exit with <b>0</b>.", hints: ["Change FROM, rebuild, scan. echo $? right after shows the exit code."],
        check: function (r) { var im = img(r, "kestrel-api:2.0"); if (!im) return "Build kestrel-api:2.0."; if (!/12/.test((Dk.merge(im.layers)["/etc/debian_version"] || { c: "" }).c) && !Dk.merge(im.layers)["/etc/alpine-release"]) return "kestrel-api:2.0 isn't on a current base image (python:3.12-slim)."; return H.trivyRuns(r).some(function (x) { return x.sub === "image" && /kestrel-api:2\.0/.test(x.target) && x.opts.exitCode && x.opts.ignoreUnfixed && x.opts.severity && x.opts.severity.indexOf("LOW") < 0 && x.found === 0; }) ? true : "Scan it with --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1: it must find nothing."; } },
      { id: "user", text: "Make <code>kestrel-api:2.0</code> run as a non-root user with UID <b>10001</b>, and show it: <code>docker run --rm kestrel-api:2.0 id</code>.", hints: ["RUN useradd --uid 10001 ... app, then USER 10001, near the end of the Dockerfile (after pip install).", "docker build -t kestrel-api:2.0 . then docker run --rm kestrel-api:2.0 id"],
        check: function (r) { var im = img(r, "kestrel-api:2.0"); if (!im) return "Build kestrel-api:2.0."; var u = Dk.userEntry({ root: Dk.treeFrom(Dk.merge(im.layers)) }, im.cfg.User || ""); if (!u || u.uid === 0) return "kestrel-api:2.0 still runs as root: add USER (after creating the user)."; if (u.uid !== 10001) return "Use UID 10001 (it runs as " + u.uid + ")."; return r.history.some(function (e) { return /\bkestrel-api:2\.0\b/.test(e.cmd) && /\bid\b/.test(e.cmd) && /uid=10001/.test(out(e)); }) ? true : "Show it: docker run --rm kestrel-api:2.0 id"; } },
      { id: "harden", text: "Run <code>kestrel-api:2.0</code> as <code>api</code> on port 8000 with a <b>read-only</b> file system, <b>all capabilities dropped</b> and <b>no-new-privileges</b>. <code>/health</code> must still answer.", hints: ["--read-only --cap-drop ALL --security-opt no-new-privileges", "docker run -d --name api -p 8000:8000 --read-only --cap-drop ALL --security-opt no-new-privileges kestrel-api:2.0\ncurl localhost:8000/health"],
        check: function (r) { var c = H.everNamed(r, "api"); if (!c) return "Run a container named api."; if (!/^kestrel-api:2\.0$/.test(c.imageRef)) return "api should run kestrel-api:2.0."; if (!c.readOnly) return "Add --read-only."; if (!c.capDrop.some(function (x) { return /^ALL$/i.test(x); })) return "Drop all capabilities: --cap-drop ALL"; if (!c.secOpt.some(function (x) { return /^no-new-privileges(:true)?$/.test(x); })) return "Add --security-opt no-new-privileges"; return B.httpOk(r, 8000, "/health", /"status":\s*"ok"/) ? true : "Publish 8000 and curl localhost:8000/health"; } },
      { id: "layers", text: "Check the claim about <code>registry.kestrel.io/kestrel/legacy-worker:1.0</code>: scan it for <b>secrets</b> and find the key that was \"deleted\".", hints: ["trivy image --scanners secret IMAGE. docker history shows the steps too."],
        check: function (r) { return H.trivyRuns(r).some(function (x) { return x.sub === "image" && /legacy-worker/.test(x.target) && x.found > 0 && (!x.opts.scanners || x.opts.scanners.indexOf("secret") >= 0); }) ? true : "Scan legacy-worker for secrets: trivy image --scanners secret registry.kestrel.io/kestrel/legacy-worker:1.0"; } }
    ],
    solution: sol("trivy image kestrel-api:1.0", "trivy image --severity HIGH,CRITICAL kestrel-api:1.0", "cd ~/kestrel-api", "trivy fs --scanners vuln --severity HIGH,CRITICAL .", { nano: "~/kestrel-api/requirements.txt", text: NEW_REQ }, "trivy fs --scanners vuln --severity HIGH,CRITICAL .", { nano: "~/kestrel-api/Dockerfile", text: API_DF_NEW }, "docker build -t kestrel-api:2.0 .", "trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 kestrel-api:2.0; echo exit code $?", "docker run --rm kestrel-api:2.0 id", "docker run -d --name api -p 8000:8000 --read-only --cap-drop ALL --security-opt no-new-privileges kestrel-api:2.0", "curl localhost:8000/health", "docker history registry.kestrel.io/kestrel/legacy-worker:1.0", "trivy image --scanners secret registry.kestrel.io/kestrel/legacy-worker:1.0"),
    debrief: "<p>From a dozen HIGH and CRITICAL findings to none that can be fixed, mostly by changing one <code>FROM</code> line and four version numbers. The app now runs as UID 10001 on a read-only file system with no capabilities, so a bug in it is much less useful to an attacker.</p><p>And the legacy worker's deploy key was never deleted: it's in the second layer, readable by anyone who can pull the image. That key needs revoking today.</p><p>One ticket left in this module: put it all together.</p>",
    realworld: "Run trivy image on images you use at home or work: you'll see the same pattern. Docker Scout, Grype and Snyk do the same job; registries like ECR and GHCR can scan on push.",
    quiz: [
      { q: "What does <code>--exit-code 1</code> make Trivy do?", options: ["Print less", "Exit with 1 when it finds something, so a CI step fails", "Stop after the first finding", "Ignore exit codes"], answer: 1, why: "That's how a scanner becomes a gate in a pipeline." },
      { q: "Why install packages <i>before</i> the <code>USER</code> line?", options: ["It's faster", "The non-root user can't write to the system's package folders", "USER deletes installed packages", "It doesn't matter"], answer: 1, why: "Everything after USER runs as that user, including RUN steps." },
      { q: "A secret was added in layer 3 and deleted in layer 5. To fix it you...", options: ["add another layer that deletes it again", "squash the layers", "revoke the secret, and rebuild without ever adding it", "make the image private"], answer: 2, why: "The old image (and every copy) still holds it, so revoke it first. Then never add it: use build secrets or runtime files." }
    ]
  });

  /* ================================================================== DEV-110 capstone */
  var ORD_API = sc(
    "# Kestrel orders API: takes orders, queues them for the worker",
    "import os",
    "",
    "import psycopg",
    "import redis",
    "from flask import Flask, jsonify, request",
    "",
    "VERSION = \"3.0.0\"",
    "",
    "",
    "def connect_db():",
    "    # DB_HOST, DB_NAME, DB_USER, and the password from the file named by DB_PASSWORD_FILE",
    "    with open(os.environ[\"DB_PASSWORD_FILE\"]) as f:",
    "        password = f.read().strip()",
    "    return psycopg.connect(host=os.environ[\"DB_HOST\"], dbname=os.environ[\"DB_NAME\"], user=os.environ[\"DB_USER\"], password=password)",
    "",
    "",
    "app = Flask(__name__)",
    "queue = redis.Redis.from_url(os.environ[\"REDIS_URL\"])",
    "db = connect_db()",
    "",
    "",
    "@app.get(\"/health\")",
    "def health():",
    "    return jsonify(status=\"ok\", db=\"ok\", queue=\"ok\", version=VERSION)",
    "",
    "",
    "@app.post(\"/orders\")",
    "def create_order():",
    "    item = request.get_json()[\"item\"]",
    "    order_id = db.execute(\"INSERT INTO orders (item, status) VALUES (%s, 'pending') RETURNING id\", (item,)).fetchone()[0]",
    "    queue.lpush(\"orders\", order_id)",
    "    return jsonify(id=order_id, status=\"pending\"), 201",
    "",
    "",
    "@app.get(\"/orders/<int:order_id>\")",
    "def get_order(order_id):",
    "    row = db.execute(\"SELECT id, item, status FROM orders WHERE id = %s\", (order_id,)).fetchone()",
    "    return jsonify(id=row[0], item=row[1], status=row[2])");
  var ORD_WORKER = sc(
    "# Kestrel orders worker: marks queued orders as processed",
    "import os",
    "",
    "import psycopg",
    "import redis",
    "",
    "",
    "def connect_db():",
    "    with open(os.environ[\"DB_PASSWORD_FILE\"]) as f:",
    "        password = f.read().strip()",
    "    return psycopg.connect(host=os.environ[\"DB_HOST\"], dbname=os.environ[\"DB_NAME\"], user=os.environ[\"DB_USER\"], password=password)",
    "",
    "",
    "db = connect_db()",
    "queue = redis.Redis.from_url(os.environ[\"REDIS_URL\"])",
    "while True:",
    "    _, order_id = queue.brpop(\"orders\")",
    "    db.execute(\"UPDATE orders SET status = 'processed' WHERE id = %s\", (int(order_id),))");
  var ORD_README = sc("# kestrel-orders", "", "Two processes from one codebase:", "  api     gunicorn -b 0.0.0.0:8000 api:app   (HTTP on 8000, GET /health)", "  worker  python worker.py", "", "Both need these environment variables:", "  DB_HOST, DB_NAME, DB_USER   where PostgreSQL is (user and database: orders)", "  DB_PASSWORD_FILE            path of a file holding the database password", "  REDIS_URL                   redis://HOST:6379/0", "", "Local secrets live in secrets/ (git-ignored). Never commit them, never bake them into an image.");
  var ORD_DF = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY api.py worker.py ./", "RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app", "USER 10001", "EXPOSE 8000", "HEALTHCHECK --interval=10s --timeout=3s CMD python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\"", "CMD [\"gunicorn\", \"-b\", \"0.0.0.0:8000\", \"api:app\"]");
  var ORD_IGNORE = sc(".git", "venv", "secrets", "tests", "__pycache__", "*.log", ".env*");
  var ORD_COMPOSE = sc("services:", "  api:", "    image: kestrel-orders:1.0", "    build: .", "    ports:", "      - \"8000:8000\"", "    environment: &env", "      DB_HOST: db", "      DB_NAME: orders", "      DB_USER: orders", "      DB_PASSWORD_FILE: /run/secrets/db_password", "      REDIS_URL: redis://cache:6379/0", "    secrets: [db_password]", "    depends_on:", "      db:", "        condition: service_healthy", "      cache:", "        condition: service_started", "    restart: unless-stopped", "", "  worker:", "    image: kestrel-orders:1.0", "    command: [\"python\", \"worker.py\"]", "    environment:", "      DB_HOST: db", "      DB_NAME: orders", "      DB_USER: orders", "      DB_PASSWORD_FILE: /run/secrets/db_password", "      REDIS_URL: redis://cache:6379/0", "    secrets: [db_password]", "    depends_on:", "      db:", "        condition: service_healthy", "      cache:", "        condition: service_started", "    healthcheck:", "      disable: true", "    restart: unless-stopped", "", "  db:", "    image: postgres:16-alpine", "    environment:", "      POSTGRES_USER: orders", "      POSTGRES_DB: orders", "      POSTGRES_PASSWORD_FILE: /run/secrets/db_password", "    secrets: [db_password]", "    volumes:", "      - db-data:/var/lib/postgresql/data", "    healthcheck:", "      test: [\"CMD-SHELL\", \"pg_isready -U orders\"]", "      interval: 5s", "      retries: 10", "    restart: unless-stopped", "", "  cache:", "    image: redis:7-alpine", "    restart: unless-stopped", "", "volumes:", "  db-data:", "", "secrets:", "  db_password:", "    file: ./secrets/db_password.txt").replace("    environment: &env\n", "    environment:\n");
  var ORD_PASS = ["Kx9", "orders", "Pq27", "db"].join("-");
  function ordersProject(sys) {
    DL.setup.files(sys, HOME + "/kestrel-orders", { "api.py": ORD_API, "worker.py": ORD_WORKER, "requirements.txt": sc("flask==3.1.1", "gunicorn==23.0.0", "psycopg[binary]==3.2.9", "redis==5.2.1"), "README.md": ORD_README, "tests/test_api.py": sc("def test_placeholder():", "    assert True"), ".gitignore": sc("secrets/", "venv/", "__pycache__/"),
      "venv/lib/python3.12/site-packages/flask/__init__.py": { content: "", size: 160e6 }, ".git/objects/pack/pack-a.pack": { content: "", size: 12e6 }, "secrets/db_password.txt": { content: ORD_PASS + "\n", mode: 384 } });
    S.lookup({ sys: sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, HOME + "/kestrel-orders/secrets").node.mode = 448;
  }
  function ordSvc(r, s) { return H.svc(r, "kestrel-orders", s); }
  LABS.push({
    id: "dev-110", n: 10, module: 1, ticket: "DEV-110", xp: 300, capstone: true, tool: "Docker",
    title: "Capstone: Containerise Kestrel's API",
    topic: "everything from Module 1",
    from: MAYA,
    story: "<p>The <b>orders</b> service (<code>~/kestrel-orders</code>) is the last one still running straight on a VM. It's two processes from one codebase: an <b>API</b> that takes orders and a <b>worker</b> that processes them, using <b>PostgreSQL</b> and <b>Redis</b>. Read its <code>README.md</code>, then ship it:</p><ul>" +
      "<li>One image, <code>kestrel-orders:1.0</code>: under <b>200 MB</b>, running as a <b>non-root</b> user, with a <b>HEALTHCHECK</b>, starting gunicorn with an exec-form <code>CMD</code>, built from a context under 100 kB, with <b>no secret in any layer</b>.</li>" +
      "<li>It passes <code>trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1</code>.</li>" +
      "<li>A <code>compose.yaml</code> with <code>api</code> (port 8000), <code>worker</code> (same image, <code>python worker.py</code>), <code>db</code> (<code>postgres:16-alpine</code>, data in a named volume, a healthcheck) and <code>cache</code> (<code>redis:7-alpine</code>). The API and worker wait for a healthy database. Every service restarts <b>unless stopped</b>.</li>" +
      "<li>The database password comes <b>only</b> from <code>secrets/db_password.txt</code> as a Compose secret: not in <code>compose.yaml</code>, not in any environment variable.</li>" +
      "<li>Prove it end to end: POST an order and watch the worker mark it <code>processed</code>.</li></ul>" +
      "<p>No hints on a capstone. The Compose file reference you need for secrets: a top-level <code>secrets: NAME: file: PATH</code>, and <code>secrets: [NAME]</code> in a service mounts it at <code>/run/secrets/NAME</code>.</p>",
    learn: "<h3>You've got this</h3><p>Everything comes from this module:</p>" +
      '<table class="t"><tr><th>Need</th><th>Lab</th></tr><tr><td>Dockerfile, exec-form CMD</td><td>DEV-104</td></tr><tr><td>Small image, cache-friendly order, .dockerignore</td><td>DEV-105</td></tr><tr><td>Named volume for the database</td><td>DEV-106</td></tr><tr><td>Secrets as files, the <code>_FILE</code> convention</td><td>DEV-107</td></tr><tr><td>compose.yaml, healthcheck, depends_on</td><td>DEV-108</td></tr><tr><td>Non-root user, Trivy gate</td><td>DEV-109</td></tr></table>' +
      "<p>A HEALTHCHECK in a slim image can't use <code>curl</code> (it isn't installed); Python is there: <code>python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\"</code>.</p>" +
      '<div class="callout">Order of work that saves time: Dockerfile and image first (and scan it), then compose.yaml, then <code>docker compose up -d</code>, then test. <code>docker compose logs SERVICE</code> answers most "why isn\'t it working" questions.</div>',
    system: ordersProject,
    starter: "",
    objectives: [
      { id: "image", hints: [], text: "<code>kestrel-orders:1.0</code>: under 200 MB, non-root, a HEALTHCHECK, exec-form CMD running gunicorn, context under 100 kB, no secret in any layer.",
        check: function (r) {
          var im = img(r, "kestrel-orders:1.0"); if (!im) return "Build kestrel-orders:1.0.";
          if (im.size >= 200e6) return "kestrel-orders:1.0 is " + Dk.human(im.size) + ".";
          var u = Dk.userEntry({ root: Dk.treeFrom(Dk.merge(im.layers)) }, im.cfg.User || ""); if (!u || u.uid === 0) return "The image runs as root.";
          if (!im.cfg.Healthcheck || im.cfg.Healthcheck.Test[0] === "NONE") return "The image has no HEALTHCHECK.";
          if (!(im.cfg.Cmd || []).length || im.cfg.Cmd[0] === "/bin/sh" || !/gunicorn/.test((im.cfg.Entrypoint || []).concat(im.cfg.Cmd || []).join(" "))) return "CMD should start gunicorn, in exec form.";
          var ctx = Dk.contextFiles(r.sys, HOME + "/kestrel-orders"); if (ctx.bytes >= 100e3) return "The build context is " + Dk.human(ctx.bytes) + ".";
          if (im.layers.some(function (L) { return Object.keys(L.files).some(function (p) { var e = L.files[p]; return e.t === "f" && e.c && e.c.indexOf(ORD_PASS) >= 0; }); }) || (im.cfg.Env || []).some(function (e) { return e.indexOf(ORD_PASS) >= 0; })) return "The database password is inside the image.";
          return true; } },
      { id: "scan", hints: [], text: "<code>trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 kestrel-orders:1.0</code> passes.",
        check: function (r) { return H.trivyRuns(r).some(function (x) { return x.sub === "image" && /kestrel-orders:1\.0/.test(x.target) && x.opts.exitCode && x.opts.ignoreUnfixed && x.opts.severity && x.opts.severity.indexOf("LOW") < 0 && x.found === 0; }) ? true : "No passing Trivy gate run on kestrel-orders:1.0 yet."; } },
      { id: "compose", hints: [], text: "<code>compose.yaml</code>: api, worker, db (named volume, healthcheck) and cache; api and worker wait for a healthy db; every service restarts unless stopped.",
        check: function (r) {
          var P = composeOf(r, HOME + "/kestrel-orders"); if (!P) return "~/kestrel-orders/compose.yaml is missing or invalid (docker compose config shows why).";
          var sv = P.services; var miss = ["api", "worker", "db", "cache"].filter(function (n) { return !sv[n]; }); if (miss.length) return "Missing service(s): " + miss.join(", ") + ".";
          if (!/^postgres:16/.test(sv.db.image || "") || !/^redis:7/.test(sv.cache.image || "")) return "db should be postgres:16-alpine and cache redis:7-alpine.";
          if (!(sv.db.volumes || []).some(function (v) { return v.type === "volume" && !v.anon && v.dst === "/var/lib/postgresql/data"; })) return "db's data should be in a named volume at /var/lib/postgresql/data.";
          if (!sv.db.healthcheck) return "db needs a healthcheck.";
          if (sv.api.depends.db !== "service_healthy" || sv.worker.depends.db !== "service_healthy") return "api and worker should wait for db with condition: service_healthy.";
          if (!sv.api.ports.some(function (p) { return /(^|:)8000:8000$/.test(p); })) return "Publish the API on 8000.";
          if (!(sv.worker.command || []).join(" ").match(/worker\.py/)) return "worker should run python worker.py.";
          var notRs = ["api", "worker", "db", "cache"].filter(function (n) { return sv[n].restart !== "unless-stopped"; }); if (notRs.length) return "Set restart: unless-stopped on " + notRs.join(", ") + ".";
          return true; } },
      { id: "secret", hints: [], text: "The database password reaches PostgreSQL, the API and the worker <b>only</b> as a Compose secret from <code>secrets/db_password.txt</code>.",
        check: function (r) {
          var t = readF(r, "~/kestrel-orders/compose.yaml") || ""; if (t.indexOf(ORD_PASS) >= 0) return "The password is written in compose.yaml.";
          var P = composeOf(r, HOME + "/kestrel-orders"); if (!P) return "Fix compose.yaml first.";
          var sec = Object.keys(P.secrets || {}).filter(function (k) { return /secrets\/db_password\.txt$/.test(P.secrets[k].file || ""); })[0]; if (!sec) return "Declare a top-level secret with file: ./secrets/db_password.txt";
          var bad = ["api", "worker", "db"].filter(function (n) { var s = P.services[n]; return !s || !s.secrets.some(function (x) { return x.source === sec; }); }); if (bad.length) return "Give the secret to: " + bad.join(", ") + ".";
          var envLeak = ["api", "worker", "db", "cache"].filter(function (n) { return P.services[n] && Object.keys(P.services[n].env).some(function (k) { return P.services[n].env[k].indexOf(ORD_PASS) >= 0; }); }); if (envLeak.length) return "The password is in an environment variable of " + envLeak.join(", ") + ".";
          if (!/_FILE$/.test(Object.keys(P.services.db.env).filter(function (k) { return /PASSWORD/.test(k); })[0] || "")) return "PostgreSQL should read it from the file: POSTGRES_PASSWORD_FILE.";
          var db = ordSvc(r, "db"); if (!db) return "Start the stack."; return true; } },
      { id: "works", hints: [], text: "Everything runs: POST an order to the API and show that the worker marked it <code>processed</code>.",
        check: function (r) { var k = idx(r, CURL, function (e) { return /:8000\/orders/.test(e.cmd) && /"status":\s*"pending"/.test(out(e)); }); if (k < 0) return "POST an order: curl -X POST -H 'Content-Type: application/json' -d '{\"item\": \"tea\"}' localhost:8000/orders"; return r.history.slice(k + 1).some(function (e) { return CURL.test(e.cmd) && /:8000\/orders\/\d+/.test(e.cmd) && /"status":\s*"processed"/.test(out(e)); }) ? true : "Fetch the order (GET /orders/ID): it should be processed by the worker."; } },
      { id: "healthy", hints: [], text: "All four services are running, the API's container reports <b>healthy</b>, and no container reports unhealthy.",
        check: function (r) { var miss = ["api", "worker", "db", "cache"].filter(function (n) { var c = ordSvc(r, n); return !c || c.state !== "running"; }); if (miss.length) return "Not running: " + miss.join(", ") + "."; Dk.advance(r.sys, 0); var api = ordSvc(r, "api"); if (!api.health || api.health.status !== "healthy") return "The api container isn't healthy yet (docker compose ps shows the health; give it a few seconds: sleep 15)."; var sick = ["worker", "db", "cache"].filter(function (n) { var c = ordSvc(r, n); return c.health && c.health.status !== "healthy"; }); return sick.length ? "Not healthy: " + sick.join(", ") + ". (A healthcheck baked into an image applies to every container made from it: does it make sense for that service?)" : true; } }
    ],
    solution: sol("cd ~/kestrel-orders", "cat README.md", "ls -la", "du -sh venv .git", { nano: "~/kestrel-orders/.dockerignore", text: ORD_IGNORE }, { nano: "~/kestrel-orders/Dockerfile", text: ORD_DF }, "docker build -t kestrel-orders:1.0 .", "docker images kestrel-orders", "docker history kestrel-orders:1.0", "trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 kestrel-orders:1.0; echo exit code $?", { nano: "~/kestrel-orders/compose.yaml", text: ORD_COMPOSE }, "docker compose config --services", "docker compose up -d", "docker compose ps", "curl -X POST -H 'Content-Type: application/json' -d '{\"item\": \"tea\"}' localhost:8000/orders", "curl localhost:8000/orders/1", "sleep 15", "docker compose ps", "docker compose logs worker"),
    debrief: "<p><b>Module 1 complete.</b> The orders service now ships as one small, non-root, scanned image with a health check, and runs as four services that start in the right order, keep their data in a volume, restart on their own, and get the database password as a file that never touches an image, an environment variable or Git.</p><p>So far you built and ran everything by hand. Module 2 hands that to a <b>CI/CD pipeline</b>: every push builds, tests, scans and ships the image, in GitHub Actions and in Bamboo.</p>",
    realworld: "This is a real production-ready baseline for a small service. The next steps teams take: build and scan in CI (Module 2), sign the image (DEV-208), and run it on a cluster with the same health checks, limits and secrets (Module 4).",
    quiz: []
  });

  LABS.forEach(function (l) { T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 1; });
  Object.assign(B, { payProject: payProject, KEY_OLD: KEY_OLD, KEY_NEW: KEY_NEW, PAY_DF_GOOD: PAY_DF_GOOD, PAY_APP: PAY_APP, shopProject: shopProject, SHOP_PASS: SHOP_PASS, COMPOSE_V1: COMPOSE_V1, COMPOSE_V2: COMPOSE_V2, apiProject: apiProject, legacyWorker: legacyWorker, OLD_REQ: OLD_REQ, NEW_REQ: NEW_REQ, API_DF_NEW: API_DF_NEW, ordersProject: ordersProject, notesImage: notesImage, NOTES_PRE: NOTES_PRE, reqVulns: reqVulns, mountOf: mountOf });
})();
