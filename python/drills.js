/* sudo learn — Python practice drills: 3 short optional exercises per lab (+5 XP each).
   Same check format as labs.js: Python defining check(ns, out, run, src). */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;

  var DRILLS = {
    /* ---------------------------------------------------------------- PY-101 */
    "py-101": [
      {
        id: "d1", title: "Unit converter",
        text: "<p>Create <code>disk_mb</code> from <code>disk_gb</code> (1 GB = 1024 MB), then print <code>512 GB = 524288 MB</code> using an f-string.</p>",
        starter: py`
          disk_gb = 512

        `,
        solution: py`
          disk_gb = 512
          disk_mb = disk_gb * 1024
          print(f"{disk_gb} GB = {disk_mb} MB")
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.vars(ns, src, run, {"disk_mb": 524288}, [(r"disk_gb\s*=\s*512", "disk_gb = 2", {"disk_mb": 2048}, "disk_gb = 2")])
              if r is not True:
                  return r
              return H.printed(out, ["512 GB = 524288 MB"])
        `
      },
      {
        id: "d2", title: "Fix the TypeError",
        text: "<p>This code crashes. Press Run to see why. Make <code>next_port</code> the <b>number</b> 8081 by converting <code>port</code> with <code>int()</code>. Leave the first line as it is.</p>",
        starter: py`
          port = "8080"
          next_port = port + 1
          print(next_port)
        `,
        solution: py`
          port = "8080"
          next_port = int(port) + 1
          print(next_port)
        `,
        check: py`
          def check(ns, out, run, src):
              if not re.search(r"port\s*=\s*\"8080\"", src):
                  return "Keep port = \"8080\" as text. The point is to convert it."
              return H.expect(ns, "next_port", 8081, int)
        `
      },
      {
        id: "d3", title: "Disk usage",
        text: "<p>Calculate <code>percent</code> = used ÷ total × 100, then print <code>Disk 74.0% full</code>.</p>",
        starter: py`
          used_gb = 37
          total_gb = 50

        `,
        solution: py`
          used_gb = 37
          total_gb = 50
          percent = used_gb / total_gb * 100
          print(f"Disk {percent}% full")
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.printed(out, ["Disk 74.0% full"])
              if r is not True:
                  return r
              return H.values(src, run, r"used_gb\s*=\s*\d+", "used_gb = %d", [(25, "Disk 50.0% full")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-102 */
    "py-102": [
      {
        id: "d1", title: "Hostname parts",
        text: "<p>From <code>fqdn</code>, make <code>short</code> = <code>\"web-01\"</code> (the part before the first dot) and <code>env</code> = <code>\"prod\"</code> (the second part).</p>",
        starter: py`
          fqdn = "web-01.prod.kestrel.io"

        `,
        solution: py`
          fqdn = "web-01.prod.kestrel.io"
          parts = fqdn.split(".")
          short = parts[0]
          env = parts[1]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"short": "web-01", "env": "prod"},
                            [(r"fqdn\s*=\s*\"[^\"\n]*\"", 'fqdn = "db-07.dev.kestrel.io"', {"short": "db-07", "env": "dev"}, "db-07.dev.kestrel.io")])
        `
      },
      {
        id: "d2", title: "Spot an AWS key",
        text: "<p>AWS access key IDs start with <code>AKIA</code> and are exactly 20 characters long. Set <code>looks_like_aws</code> to <code>True</code> or <code>False</code> by checking both rules, without an <code>if</code>: a comparison already gives you a bool.</p>",
        starter: py`
          key = "AKIAIOSFODNN7EXAMPLE"

        `,
        solution: py`
          key = "AKIAIOSFODNN7EXAMPLE"
          looks_like_aws = key.startswith("AKIA") and len(key) == 20
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "looks_like_aws", True, bool)
              if r is not True:
                  return r
              return H.values(src, run, r"key\s*=\s*\"[^\"\n]*\"", "key = %r",
                              [("AKIA123", False), ("XKIAIOSFODNN7EXAMPLE", False), ("AKIAABCDEFGHIJKLMNOP", True)], var="looks_like_aws")
        `
      },
      {
        id: "d3", title: "Make a URL slug",
        text: "<p>Turn <code>title</code> into <code>slug</code> = <code>\"q3-access-review\"</code>: no outer spaces, lowercase, spaces replaced by hyphens.</p>",
        starter: py`
          title = "  Q3 Access Review  "

        `,
        solution: py`
          title = "  Q3 Access Review  "
          slug = title.strip().lower().replace(" ", "-")
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"slug": "q3-access-review"},
                            [(r"title\s*=\s*\"[^\"\n]*\"", 'title = "  Patch Night  "', {"slug": "patch-night"}, "\"  Patch Night  \"")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-103 */
    "py-103": [
      {
        id: "d1", title: "CPU alert levels",
        text: "<p>Print exactly one word: <code>CRITICAL</code> if <code>cpu</code> is over 90, <code>WARNING</code> if it's 75 or more, otherwise <code>OK</code>. I'll test several values.</p>",
        starter: py`
          cpu = 85

        `,
        solution: py`
          cpu = 85
          if cpu > 90:
              print("CRITICAL")
          elif cpu >= 75:
              print("WARNING")
          else:
              print("OK")
        `,
        check: py`
          def check(ns, out, run, src):
              return H.values(src, run, r"cpu\s*=\s*\d+", "cpu = %d",
                              [(95, "CRITICAL"), (91, "CRITICAL"), (90, "WARNING"), (75, "WARNING"), (74, "OK"), (10, "OK")])
        `
      },
      {
        id: "d2", title: "Classify a port",
        text: "<p>Set <code>kind</code> to <code>\"well-known\"</code> for ports 0–1023, <code>\"registered\"</code> for 1024–49151, and <code>\"dynamic\"</code> for anything higher.</p>",
        starter: py`
          port = 443

        `,
        solution: py`
          port = 443
          if port <= 1023:
              kind = "well-known"
          elif port <= 49151:
              kind = "registered"
          else:
              kind = "dynamic"
        `,
        check: py`
          def check(ns, out, run, src):
              return H.values(src, run, r"port\s*=\s*\d+", "port = %d",
                              [(443, "well-known"), (1023, "well-known"), (1024, "registered"), (8080, "registered"),
                               (49151, "registered"), (49152, "dynamic")], var="kind")
        `
      },
      {
        id: "d3", title: "Page the on-call engineer?",
        text: "<p>Outside office hours, alerts page the on-call engineer. Set <code>page</code> to <code>True</code> if <code>hour</code> is before 9 or 18 and later, <b>or</b> <code>day</code> is <code>\"Sat\"</code> or <code>\"Sun\"</code>. Otherwise <code>False</code>.</p>",
        starter: py`
          hour = 14
          day = "Sat"

        `,
        solution: py`
          hour = 14
          day = "Sat"
          page = hour < 9 or hour >= 18 or day in ["Sat", "Sun"]
        `,
        check: py`
          def check(ns, out, run, src):
              for h, d, want in [(14, "Sat", True), (14, "Tue", False), (8, "Tue", True), (18, "Wed", True),
                                 (17, "Fri", False), (9, "Sun", True), (9, "Mon", False)]:
                  new = H.sub(src, r"hour\s*=\s*\d+", "hour = %d" % h)
                  new = new and H.sub(new, r"day\s*=\s*\"[^\"\n]*\"", "day = %r" % d)
                  if not new:
                      return "Keep the hour = ... and day = ... lines so I can test other values."
                  n, o, e = run(new)
                  if e:
                      return "With hour=%d, day=%r your code crashed: %s" % (h, d, e[0].splitlines()[-1])
                  if n.get("page") != want:
                      return "With hour=%d and day=%r, page should be %r but it's %r." % (h, d, want, n.get("page"))
              return True
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-104 */
    "py-104": [
      {
        id: "d1", title: "Deploy countdown",
        text: "<p>Use a loop to print <code>5</code>, <code>4</code>, <code>3</code>, <code>2</code>, <code>1</code> on separate lines, then <code>deploy!</code>.</p>",
        starter: py`
          # countdown from 5, then print deploy!

        `,
        solution: py`
          n = 5
          while n > 0:
              print(n)
              n -= 1
          print("deploy!")
        `,
        check: py`
          def check(ns, out, run, src):
              if not re.search(r"^\s*(for|while)\b", src, re.M):
                  return "Use a loop. Five print lines would work, but this drill is about loops."
              return H.printed(out, ["5", "4", "3", "2", "1", "deploy!"])
        `
      },
      {
        id: "d2", title: "Total and largest",
        text: "<p>With one loop, work out <code>total_mb</code> (all sizes added up) and <code>largest</code> (the biggest size). Try it without <code>sum()</code> or <code>max()</code>.</p>",
        starter: py`
          sizes_mb = [120, 45, 300, 15]

        `,
        solution: py`
          sizes_mb = [120, 45, 300, 15]
          total_mb = 0
          largest = sizes_mb[0]
          for size in sizes_mb:
              total_mb += size
              if size > largest:
                  largest = size
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"total_mb": 480, "largest": 300},
                            [(r"sizes_mb\s*=\s*\[[^\]]*\]", "sizes_mb = [7, 2, 9]", {"total_mb": 18, "largest": 9}, "sizes_mb = [7, 2, 9]")])
        `
      },
      {
        id: "d3", title: "First error",
        text: "<p>Set <code>first_error</code> to the first log line that starts with <code>\"ERROR\"</code>, and stop looking once you find it (<code>break</code>). If there's none, it stays <code>None</code>.</p>",
        starter: py`
          logs = ["INFO start", "INFO ok", "ERROR disk full", "ERROR again"]
          first_error = None

        `,
        solution: py`
          logs = ["INFO start", "INFO ok", "ERROR disk full", "ERROR again"]
          first_error = None
          for line in logs:
              if line.startswith("ERROR"):
                  first_error = line
                  break
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"first_error": "ERROR disk full"},
                            [(r"logs\s*=\s*\[[^\]]*\]", 'logs = ["ERROR a", "ERROR b"]', {"first_error": "ERROR a"}, "two errors"),
                             (r"logs\s*=\s*\[[^\]]*\]", 'logs = ["INFO x"]', {"first_error": None}, "no errors at all")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-105 */
    "py-105": [
      {
        id: "d1", title: "Count protocols",
        text: "<p>Build <code>freq</code>: a dict counting how many times each protocol appears in <code>traffic</code>.</p>",
        starter: py`
          traffic = ["ssh", "ssh", "http", "ssh", "dns", "http"]

        `,
        solution: py`
          traffic = ["ssh", "ssh", "http", "ssh", "dns", "http"]
          freq = {}
          for proto in traffic:
              freq[proto] = freq.get(proto, 0) + 1
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"freq": {"ssh": 3, "http": 2, "dns": 1}},
                            [(r"traffic\s*=\s*\[[^\]]*\]", 'traffic = ["smtp", "smtp"]', {"freq": {"smtp": 2}}, "different traffic")])
        `
      },
      {
        id: "d2", title: "Name the ports",
        text: "<p>Build <code>names</code>: for each port in <code>ports</code>, its service name from <code>services</code>, or <code>\"unknown\"</code>.</p>",
        starter: py`
          services = {22: "ssh", 80: "http", 443: "https"}
          ports = [22, 8080, 443]

        `,
        solution: py`
          services = {22: "ssh", 80: "http", 443: "https"}
          ports = [22, 8080, 443]
          names = []
          for port in ports:
              names.append(services.get(port, "unknown"))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"names": ["ssh", "unknown", "https"]},
                            [(r"ports\s*=\s*\[[^\]]*\]", "ports = [80, 1]", {"names": ["http", "unknown"]}, "ports = [80, 1]")])
        `
      },
      {
        id: "d3", title: "Remove duplicates",
        text: "<p>Build <code>unique</code>: the IPs without duplicates, in the order they first appear.</p>",
        starter: py`
          ips = ["10.0.0.5", "10.0.0.9", "10.0.0.5", "8.8.8.8", "10.0.0.9"]

        `,
        solution: py`
          ips = ["10.0.0.5", "10.0.0.9", "10.0.0.5", "8.8.8.8", "10.0.0.9"]
          unique = []
          for ip in ips:
              if ip not in unique:
                  unique.append(ip)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"unique": ["10.0.0.5", "10.0.0.9", "8.8.8.8"]},
                            [(r"ips\s*=\s*\[[^\]]*\]", 'ips = ["b", "a", "b", "c", "a"]', {"unique": ["b", "a", "c"]}, "a different list")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-106 */
    "py-106": [
      {
        id: "d1", title: "Server room temperature",
        text: "<p>Write <code>fahrenheit_to_c(f)</code> that returns the Celsius value rounded to 1 decimal: <code>round((f - 32) * 5 / 9, 1)</code>.</p>",
        starter: py`
          def fahrenheit_to_c(f):
              pass


          print(fahrenheit_to_c(80))
        `,
        solution: py`
          def fahrenheit_to_c(f):
              return round((f - 32) * 5 / 9, 1)


          print(fahrenheit_to_c(80))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "fahrenheit_to_c", [((32,), 0.0), ((212,), 100.0), ((98.6,), 37.0), ((80,), 26.7)])
        `
      },
      {
        id: "d2", title: "Private IP?",
        text: "<p>Write <code>is_private(ip)</code>: return <code>True</code> if the IP starts with <code>\"10.\"</code>, <code>\"192.168.\"</code> or <code>\"127.\"</code>, otherwise <code>False</code>.</p>",
        starter: py`
          def is_private(ip):
              pass
        `,
        solution: py`
          def is_private(ip):
              return ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("127.")
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "is_private", [(("10.0.0.5",), True), (("192.168.1.20",), True), (("127.0.0.1",), True),
                                               (("8.8.8.8",), False), (("100.10.0.1",), False), (("192.169.0.1",), False)])
        `
      },
      {
        id: "d3", title: "Clamp a value",
        text: "<p>Write <code>clamp(n, low=0, high=100)</code>: return <code>low</code> if n is below it, <code>high</code> if n is above it, otherwise <code>n</code>.</p>",
        starter: py`
          def clamp(n, low=0, high=100):
              pass
        `,
        solution: py`
          def clamp(n, low=0, high=100):
              if n < low:
                  return low
              if n > high:
                  return high
              return n
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "clamp", [((50,), 50), ((150,), 100), ((-5,), 0), ((5, 10, 20), 10), ((25, 10, 20), 20), ((15, 10, 20), 15)])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-107 */
    "py-107": [
      {
        id: "d1", title: "Number or default",
        text: "<p>Write <code>to_int(text, default=0)</code>: return <code>int(text)</code>, or <code>default</code> if that raises a <code>ValueError</code>.</p>",
        starter: py`
          def to_int(text, default=0):
              pass
        `,
        solution: py`
          def to_int(text, default=0):
              try:
                  return int(text)
              except ValueError:
                  return default
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "to_int", [(("42",), 42), (("abc",), 0), (("x", -1), -1), ((" 7 ",), 7), (("",), 0)])
        `
      },
      {
        id: "d2", title: "Safe divide",
        text: "<p>Write <code>safe_divide(a, b)</code>: return <code>a / b</code>, or <code>None</code> when b is zero. Catch only <code>ZeroDivisionError</code>.</p>",
        starter: py`
          def safe_divide(a, b):
              pass
        `,
        solution: py`
          def safe_divide(a, b):
              try:
                  return a / b
              except ZeroDivisionError:
                  return None
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.func(ns, "safe_divide", [((10, 2), 5.0), ((1, 0), None), ((0, 5), 0.0)])
              if r is not True:
                  return r
              ok, got = H.call(ns["safe_divide"], "a", 1)
              if ok:
                  return "safe_divide(\"a\", 1) returned " + repr(got) + ". Dividing text is a real bug and should crash. Catch ZeroDivisionError only."
              return True
        `
      },
      {
        id: "d3", title: "First line of a file",
        text: "<p>Write <code>first_line(path)</code>: return the first line of the file without the newline, or <code>\"\"</code> if the file doesn't exist. <code>motd.txt</code> exists. Tip: <code>f.readline()</code> reads one line, and <code>.strip()</code> removes the newline.</p>",
        files: { "motd.txt": "Welcome to web-01\nAuthorized use only\n" },
        removeFiles: ["nope.txt"],
        starter: py`
          def first_line(path):
              pass
        `,
        solution: py`
          def first_line(path):
              try:
                  with open(path) as f:
                      return f.readline().strip()
              except FileNotFoundError:
                  return ""
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "first_line", [(("motd.txt",), "Welcome to web-01"), (("nope.txt",), "")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-108 */
    "py-108": [
      {
        id: "d1", title: "List the admins",
        text: "<p>Build <code>admins</code>: the <code>name</code> of every user whose <code>admin</code> is <code>True</code>.</p>",
        starter: py`
          users = [
              {"name": "maya", "admin": True},
              {"name": "dev", "admin": False},
              {"name": "sam", "admin": True},
          ]

        `,
        solution: py`
          users = [
              {"name": "maya", "admin": True},
              {"name": "dev", "admin": False},
              {"name": "sam", "admin": True},
          ]
          admins = []
          for u in users:
              if u["admin"]:
                  admins.append(u["name"])
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"admins": ["maya", "sam"]},
                            [(r"\"admin\":\s*True", '"admin": False', {"admins": ["sam"]}, "maya losing admin")])
        `
      },
      {
        id: "d2", title: "Nested lookup with a default",
        text: "<p>Set <code>db_port</code> to the database port, and <code>cache_port</code> to the cache's port, or <code>6379</code> if it isn't set. Use <code>.get()</code> for the second one.</p>",
        starter: py`
          config = {
              "db": {"host": "db-01", "port": 5432},
              "cache": {"host": "redis-01"},
          }

        `,
        solution: py`
          config = {
              "db": {"host": "db-01", "port": 5432},
              "cache": {"host": "redis-01"},
          }
          db_port = config["db"]["port"]
          cache_port = config["cache"].get("port", 6379)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"db_port": 5432, "cache_port": 6379},
                            [(r"\"cache\":\s*\{\"host\":\s*\"redis-01\"\}", '"cache": {"host": "redis-01", "port": 7000}', {"cache_port": 7000}, "a cache with port 7000")])
        `
      },
      {
        id: "d3", title: "Alerts by severity",
        text: "<p>Build <code>by_sev</code>: a dict counting how many alerts have each severity.</p>",
        starter: py`
          alerts = [
              {"id": 1, "sev": "high"},
              {"id": 2, "sev": "low"},
              {"id": 3, "sev": "high"},
              {"id": 4, "sev": "medium"},
          ]

        `,
        solution: py`
          alerts = [
              {"id": 1, "sev": "high"},
              {"id": 2, "sev": "low"},
              {"id": 3, "sev": "high"},
              {"id": 4, "sev": "medium"},
          ]
          by_sev = {}
          for a in alerts:
              by_sev[a["sev"]] = by_sev.get(a["sev"], 0) + 1
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"by_sev": {"high": 2, "low": 1, "medium": 1}},
                            [(r"\"sev\":\s*\"low\"", '"sev": "high"', {"by_sev": {"high": 3, "medium": 1}}, "alert 2 becoming high")])
        `
      }
    ],

    /* ---------------------------------------------------------------- PY-109 */
    "py-109": [
      {
        id: "d1", title: "Numbered pipeline steps",
        text: "<p>Print <code>Step 1: build</code>, <code>Step 2: test</code> and so on for every step, using <code>enumerate</code>.</p>",
        starter: py`
          steps = ["build", "test", "scan", "deploy"]

        `,
        solution: py`
          steps = ["build", "test", "scan", "deploy"]
          for i, step in enumerate(steps, start=1):
              print(f"Step {i}: {step}")
        `,
        check: py`
          def check(ns, out, run, src):
              if "enumerate" not in src:
                  return "Use enumerate() to get the numbers."
              return H.printed(out, ["Step 1: build", "Step 2: test", "Step 3: scan", "Step 4: deploy"])
        `
      },
      {
        id: "d2", title: "Hosts to IPs",
        text: "<p>Build <code>host_ip</code>: a dict mapping each host to its IP. Tip: <code>dict(zip(a, b))</code> does it in one line.</p>",
        starter: py`
          hosts = ["web-01", "db-01", "ci-01"]
          ips = ["10.0.0.10", "10.0.0.20", "10.0.0.30"]

        `,
        solution: py`
          hosts = ["web-01", "db-01", "ci-01"]
          ips = ["10.0.0.10", "10.0.0.20", "10.0.0.30"]
          host_ip = dict(zip(hosts, ips))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"host_ip": {"web-01": "10.0.0.10", "db-01": "10.0.0.20", "ci-01": "10.0.0.30"}},
                            [(r"hosts\s*=\s*\[[^\]]*\]", 'hosts = ["a", "b", "c"]', {"host_ip": {"a": "10.0.0.10", "b": "10.0.0.20", "c": "10.0.0.30"}}, "different host names")])
        `
      },
      {
        id: "d3", title: "Biggest logs first",
        text: "<p>Each item is <code>(filename, size_kb)</code>. Build <code>biggest_first</code>: just the filenames, sorted by size, largest first.</p>",
        starter: py`
          files = [("app.log", 120), ("auth.log", 980), ("cron.log", 45)]

        `,
        solution: py`
          files = [("app.log", 120), ("auth.log", 980), ("cron.log", 45)]
          biggest_first = []
          for name, size in sorted(files, key=lambda f: f[1], reverse=True):
              biggest_first.append(name)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"biggest_first": ["auth.log", "app.log", "cron.log"]},
                            [(r"files\s*=\s*\[\(.*?\)\]",'files = [("a.log", 1), ("b.log", 3), ("c.log", 2)]', {"biggest_first": ["b.log", "c.log", "a.log"]}, "different files")])
        `
      }
    ]
  };

  T.LABS.forEach(function (l) { l.drills = DRILLS[l.id] || []; });
})();
