/* sudo learn — Python Module 3 practice drills: 3 short optional exercises per lab (+5 XP each).
   Same format as drills.js. Loaded after labs-m3.js; drills can set prelude, files, argv and env. */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;
  function lab(id) { for (var i = 0; i < T.LABS.length; i++) if (T.LABS[i].id === id) return T.LABS[i]; return {}; }
  var API = lab("py-119"), TESTS = lab("py-126");

  var DRILLS = {
    "py-118": [
      {
        id: "d1", title: "Parse a timestamp",
        text: "<p>Set <code>when</code> to a <code>datetime</code> parsed from <code>stamp</code>, then print the hour: <code>3</code>.</p>",
        starter: py`
          from datetime import datetime

          stamp = "2026-11-10 03:01:12"

        `,
        solution: py`
          from datetime import datetime

          stamp = "2026-11-10 03:01:12"
          when = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")
          print(when.hour)
        `,
        check: py`
          def check(ns, out, run, src):
              from datetime import datetime
              w = ns.get("when")
              if isinstance(w, str):
                  return "when is still a string. Use datetime.strptime(stamp, \"%Y-%m-%d %H:%M:%S\")."
              r = H.expect(ns, "when", datetime(2026, 11, 10, 3, 1, 12))
              if r is not True:
                  return r
              return H.values(src, run, r"stamp\s*=\s*\"[^\"]*\"", 'stamp = "%s"', [("2027-01-31 22:45:00", "22")])
        `
      },
      {
        id: "d2", title: "Minutes between",
        text: "<p>Set <code>minutes</code> to the whole number of minutes between <code>start</code> and <code>end</code> (an <code>int</code>: <code>47</code>).</p>",
        starter: py`
          from datetime import datetime

          FMT = "%Y-%m-%d %H:%M:%S"
          start = "2026-11-10 03:20:01"
          end = "2026-11-10 04:07:30"

        `,
        solution: py`
          from datetime import datetime

          FMT = "%Y-%m-%d %H:%M:%S"
          start = "2026-11-10 03:20:01"
          end = "2026-11-10 04:07:30"
          gap = datetime.strptime(end, FMT) - datetime.strptime(start, FMT)
          minutes = int(gap.total_seconds() // 60)
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "minutes", 47, int)
              if r is not True:
                  return r
              return H.alt(src, run, r"end\s*=\s*\"[^\"]*\"", 'end = "2026-11-11 03:20:01"', {"minutes": 1440}, "an end time one day later")
        `
      },
      {
        id: "d3", title: "Most-targeted user",
        text: "<p>Use a regex and a <code>Counter</code> to set <code>top_user</code> to the username that appears in the most failed logins (<code>\"root\"</code>). Remember the <code>invalid user</code> lines.</p>",
        starter: py`
          import re
          from collections import Counter

          lines = [
              "Failed password for root from 203.0.113.50 port 50112 ssh2",
              "Failed password for invalid user admin from 203.0.113.50 port 50120 ssh2",
              "Failed password for root from 192.0.2.77 port 60001 ssh2",
              "Failed password for invalid user admin from 192.0.2.77 port 60021 ssh2",
              "Failed password for root from 192.0.2.77 port 60030 ssh2",
          ]

        `,
        solution: py`
          import re
          from collections import Counter

          lines = [
              "Failed password for root from 203.0.113.50 port 50112 ssh2",
              "Failed password for invalid user admin from 203.0.113.50 port 50120 ssh2",
              "Failed password for root from 192.0.2.77 port 60001 ssh2",
              "Failed password for invalid user admin from 192.0.2.77 port 60021 ssh2",
              "Failed password for root from 192.0.2.77 port 60030 ssh2",
          ]
          users = Counter()
          for line in lines:
              m = re.search(r"for (?:invalid user )?(\S+) from", line)
              if m:
                  users[m.group(1)] += 1
          top_user = users.most_common(1)[0][0]
        `,
        check: py`
          def check(ns, out, run, src):
              if ns.get("top_user") == "invalid":
                  return "top_user is \"invalid\": the pattern picked up the word from \"invalid user\". Make (?:invalid user )? optional before the name."
              r = H.expect(ns, "top_user", "root")
              if r is not True:
                  return r
              new = src.replace("for root from", "for deploy from")
              if new != src:
                  n, o, e = run(new)
                  if n.get("top_user") != "deploy":
                      return "When I changed root to deploy in the lines, top_user came out as " + H.short(n.get("top_user")) + ". Count from the data."
              return True
        `
      }
    ],

    "py-119": [
      {
        id: "d1", title: "Read one user",
        text: "<p>GET <code>BASE + \"/users/bob\"</code> with <code>HEADERS</code> and a timeout. Set <code>status</code> to the status code and <code>role</code> to the role from the JSON body.</p>",
        prelude: API.prelude, files: API.files,
        starter: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}

        `,
        solution: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}
          r = requests.get(BASE + "/users/bob", headers=HEADERS, timeout=5)
          status = r.status_code
          role = r.json()["role"]
        `,
        check: py`
          def check(ns, out, run, src):
              if ns.get("status") == 401:
                  return "The API answered 401: send headers=HEADERS."
              r = H.vars(ns, src, run, {"status": 200, "role": "developer"},
                         [(r"/users/bob", "/users/carol", {"role": "admin"}, "/users/carol")])
              if r is not True:
                  return r
              if "timeout" not in src:
                  return "Pass timeout=5 to requests.get."
              return True
        `
      },
      {
        id: "d2", title: "Handle a 404",
        text: "<p>Write <code>get_role(name)</code>: return the user's role, or <code>None</code> when the API answers <code>404</code>.</p>",
        prelude: API.prelude, files: API.files,
        starter: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}


          def get_role(name):
              pass
        `,
        solution: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}


          def get_role(name):
              r = requests.get(BASE + "/users/" + name, headers=HEADERS, timeout=5)
              if r.status_code == 404:
                  return None
              r.raise_for_status()
              return r.json()["role"]
        `,
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "get_role")
              if f:
                  ok, got = H.call(f, "zoe")
                  if ok and isinstance(got, str) and "not found" in got:
                      return "get_role(\"zoe\") returned the error text. Check r.status_code == 404 and return None."
              return H.func(ns, "get_role", [(("alice",), "admin"), (("frank",), "developer"), (("zoe",), None)])
        `
      },
      {
        id: "d3", title: "Follow the pages",
        text: "<p>Request <code>/users</code> page by page (<code>params={\"page\": n}</code>) until <code>next</code> is <code>None</code>. Set <code>pages</code> to how many pages you fetched and <code>names</code> to every user's name.</p>",
        prelude: API.prelude, files: API.files,
        starter: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}

        `,
        solution: py`
          import requests

          BASE = "https://api.kestrel.io/v1"
          HEADERS = {"Authorization": "Bearer kc_demo_7f3a"}
          pages = 0
          names = []
          page = 1
          while page is not None:
              data = requests.get(BASE + "/users", params={"page": page}, headers=HEADERS, timeout=5).json()
              pages += 1
              names += [u["name"] for u in data["users"]]
              page = data["next"]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"pages": 3, "names": ["alice", "bob", "carol", "dave", "erin", "frank", "grace", "svc-ci"]})
        `
      }
    ],

    "py-120": [
      {
        id: "d1", title: "Hash a string",
        text: "<p>Set <code>digest</code> to the SHA-256 hex digest of <code>message</code>.</p>",
        starter: py`
          import hashlib

          message = "deploy v2.4.1 approved by maya"

        `,
        solution: py`
          import hashlib

          message = "deploy v2.4.1 approved by maya"
          digest = hashlib.sha256(message.encode()).hexdigest()
        `,
        check: py`
          def check(ns, out, run, src):
              import hashlib
              d = ns.get("digest")
              if isinstance(d, bytes) or (d is not None and not isinstance(d, str)):
                  return "digest should be the hex string: call .hexdigest(), not .digest()."
              r = H.expect(ns, "digest", hashlib.sha256(b"deploy v2.4.1 approved by maya").hexdigest())
              if r is not True:
                  return r
              return H.alt(src, run, r"message\s*=\s*\"[^\"]*\"", 'message = "deploy v2.4.2 approved by maya"',
                           {"digest": hashlib.sha256(b"deploy v2.4.2 approved by maya").hexdigest()}, "a different message")
        `
      },
      {
        id: "d2", title: "Verify a download",
        text: "<p>Set <code>verified</code> to <code>True</code> if the SHA-256 of <code>data</code> equals <code>expected</code>, otherwise <code>False</code>.</p>",
        starter: py`
          import hashlib

          data = b"kestrel-agent 2.4.1"
          expected = "0c6c1c5f0e3e2f63e7a9b1d0fca1f8f1a6c1f0c0e9b8f3e2a1d4c7b6a5f4e3d2"

        `,
        solution: py`
          import hashlib

          data = b"kestrel-agent 2.4.1"
          expected = "0c6c1c5f0e3e2f63e7a9b1d0fca1f8f1a6c1f0c0e9b8f3e2a1d4c7b6a5f4e3d2"
          verified = hashlib.sha256(data).hexdigest() == expected
        `,
        check: py`
          def check(ns, out, run, src):
              import hashlib
              r = H.expect(ns, "verified", False, bool)
              if r is not True:
                  return r
              good = hashlib.sha256(b"kestrel-agent 2.4.1").hexdigest()
              return H.alt(src, run, r"expected\s*=\s*\"[0-9a-f]*\"", 'expected = "' + good + '"', {"verified": True}, "the correct expected hash")
        `
      },
      {
        id: "d3", title: "Hash a file",
        text: "<p>Set <code>digest</code> to the SHA-256 hex digest of the file <code>backup.tar</code>, read in binary mode.</p>",
        files: { "backup.tar": "pretend this is a backup archive\n" },
        starter: py`
          import hashlib

        `,
        solution: py`
          import hashlib

          with open("backup.tar", "rb") as f:
              digest = hashlib.sha256(f.read()).hexdigest()
        `,
        check: py`
          def check(ns, out, run, src):
              import hashlib
              r = H.expect(ns, "digest", hashlib.sha256(open("backup.tar", "rb").read()).hexdigest())
              if r is not True:
                  return r
              orig = open("backup.tar", "rb").read()
              try:
                  with open("backup.tar", "wb") as fh:
                      fh.write(b"\x00\xffdifferent bytes")
                  n, o, e = run()
              finally:
                  with open("backup.tar", "wb") as fh:
                      fh.write(orig)
              if e:
                  return "For a file with non-text bytes your code crashed: " + e[0].splitlines()[-1] + ". Open it with \"rb\"."
              if n.get("digest") != hashlib.sha256(b"\x00\xffdifferent bytes").hexdigest():
                  return "When the file changed, digest didn't. Hash the file's contents."
              return True
        `
      }
    ],

    "py-121": [
      {
        id: "d1", title: "Kestrel API keys",
        text: "<p>Kestrel's own API keys are <code>kc_live_</code> followed by exactly 24 lowercase hex characters (<code>0-9</code>, <code>a-f</code>). Write the pattern <code>KESTREL_KEY</code>.</p>",
        starter: py`
          import re

          KESTREL_KEY = re.compile(r"")
        `,
        solution: py`
          import re

          KESTREL_KEY = re.compile(r"kc_live_[0-9a-f]{24}")
        `,
        check: py`
          def check(ns, out, run, src):
              p = ns.get("KESTREL_KEY")
              if p is None or not hasattr(p, "search"):
                  return "KESTREL_KEY should be a compiled pattern: re.compile(r\"...\")."
              if not p.pattern:
                  return "The pattern is empty, and r\"\" matches everything."
              for s in ["token=kc_live_" + "0123456789abcdef01234567", "kc_live_" + "ffffffffffffffffffffffff"]:
                  if not p.search(s):
                      return "The pattern should match " + repr(s) + "."
              for s in ["kc_live_" + "0123456789abcdef", "kc_test_" + "0123456789abcdef01234567", "kc_live_" + "0123456789ABCDEF01234567", "kc_demo_7f3a"]:
                  if p.search(s):
                      return "The pattern shouldn't match " + repr(s) + "."
              return True
        `
      },
      {
        id: "d2", title: "Lines with keys",
        text: "<p>Set <code>flagged</code> to the list of line numbers (from 1) in <code>config</code> that contain an AWS access key ID (<code>AKIA</code> + 16 capital letters or digits).</p>",
        starter: py`
          import re

          config = """region = ap-southeast-2
          key_id = AKIA""" + "QWERTYUIOPASDFGH" + """
          note = rotate AKIA1234 keys monthly
          backup_key = AKIA""" + "ZXCVBNMLKJHGFDSA" + """
          """

        `,
        solution: py`
          import re

          config = """region = ap-southeast-2
          key_id = AKIA""" + "QWERTYUIOPASDFGH" + """
          note = rotate AKIA1234 keys monthly
          backup_key = AKIA""" + "ZXCVBNMLKJHGFDSA" + """
          """
          flagged = [n for n, line in enumerate(config.splitlines(), start=1) if re.search(r"AKIA[0-9A-Z]{16}", line)]
        `,
        check: py`
          def check(ns, out, run, src):
              if ns.get("flagged") == [2, 3, 4]:
                  return "Line 3 only says AKIA1234, which is too short to be a key. Require exactly 16 characters after AKIA."
              if ns.get("flagged") == [1, 3]:
                  return "Number lines from 1: enumerate(..., start=1)."
              return H.vars(ns, src, run, {"flagged": [2, 4]})
        `
      },
      {
        id: "d3", title: "Mask a secret",
        text: "<p>Write <code>mask(secret)</code>: keep the first 4 characters and replace the rest with <code>*</code>, keeping the length. Strings of 4 characters or fewer become all stars.</p>",
        starter: py`
          def mask(secret):
              pass
        `,
        solution: py`
          def mask(secret):
              if len(secret) <= 4:
                  return "*" * len(secret)
              return secret[:4] + "*" * (len(secret) - 4)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "mask", [(("kc_live_abc123",), "kc_l**********"), (("hunter2",), "hunt***"), (("abcd",), "****"), (("xy",), "**"), (("",), "")])
        `
      }
    ],

    "py-122": [
      {
        id: "d1", title: "Which is newer?",
        text: "<p>Set <code>newer</code> to whichever of <code>a</code> and <code>b</code> is the newer version, comparing them as tuples of ints.</p>",
        starter: py`
          a = "2.9.1"
          b = "2.10.0"

        `,
        solution: py`
          a = "2.9.1"
          b = "2.10.0"


          def version_tuple(v):
              return tuple(int(x) for x in v.split("."))


          newer = a if version_tuple(a) > version_tuple(b) else b
        `,
        check: py`
          def check(ns, out, run, src):
              if ns.get("newer") == "2.9.1":
                  return "As strings \"2.9.1\" > \"2.10.0\", but 10 is bigger than 9. Compare tuples of ints."
              r = H.expect(ns, "newer", "2.10.0")
              if r is not True:
                  return r
              return H.alt(src, run, r"a\s*=\s*\"[^\"]*\"", 'a = "3.0.0"', {"newer": "3.0.0"}, "a = \"3.0.0\"")
        `
      },
      {
        id: "d2", title: "Find unpinned packages",
        text: "<p>Set <code>unpinned</code> to the sorted, lowercase names of packages in <code>reqs</code> that aren't pinned with <code>==</code>. Ignore blank lines and comments.</p>",
        starter: py`
          reqs = """# api service
          fastapi==0.110.0
          Uvicorn
          pydantic>=2.0

          httpx==0.27.0
          """

        `,
        solution: py`
          reqs = """# api service
          fastapi==0.110.0
          Uvicorn
          pydantic>=2.0

          httpx==0.27.0
          """
          unpinned = []
          for line in reqs.splitlines():
              line = line.split("#")[0].strip()
              if line and "==" not in line:
                  name = line.split(">")[0].split("<")[0].split("~")[0].strip()
                  unpinned.append(name.lower())
          unpinned.sort()
        `,
        check: py`
          def check(ns, out, run, src):
              got = ns.get("unpinned")
              if isinstance(got, list) and "pydantic>=2.0" in got:
                  return "pydantic>=2.0 is unpinned (a range, not ==), but the name is just pydantic. Cut the line at the > sign."
              return H.vars(ns, src, run, {"unpinned": ["pydantic", "uvicorn"]})
        `
      },
      {
        id: "d3", title: "Latest version",
        text: "<p>Set <code>latest</code> to the highest version in <code>versions</code>. <code>max()</code> takes a <code>key=</code> just like <code>sorted()</code>.</p>",
        starter: py`
          versions = ["1.9.0", "1.10.2", "1.2.11", "1.10.0"]

        `,
        solution: py`
          versions = ["1.9.0", "1.10.2", "1.2.11", "1.10.0"]
          latest = max(versions, key=lambda v: tuple(int(x) for x in v.split(".")))
        `,
        check: py`
          def check(ns, out, run, src):
              if ns.get("latest") == "1.9.0":
                  return "max() compared the strings. Give it key= a function that turns a version into a tuple of ints."
              return H.vars(ns, src, run, {"latest": "1.10.2"},
                            [(r"versions\s*=\s*\[[^\]]*\]", 'versions = ["0.9", "0.10", "0.8.7"]', {"latest": "0.10"}, "a different list")])
        `
      }
    ],

    "py-123": [
      {
        id: "d1", title: "Count the arguments",
        text: "<p>Print how many arguments were given, <b>not</b> counting the script name. With the Arguments box as it starts, that's <code>3</code>.</p>",
        argv: "--fast web-01 db-01",
        starter: py`
          import sys

        `,
        solution: py`
          import sys

          print(len(sys.argv) - 1)
        `,
        check: py`
          def check(ns, out, run, src):
              for argv, want in [("--fast web-01 db-01", "3"), ("", "0"), ("only-one", "1")]:
                  n, o, e = run(argv=argv)
                  if H.lines(o) != [want]:
                      return "With arguments \"" + argv + "\" expected " + want + ", got " + H.short(H.lines(o)) + ". sys.argv[0] is the script name."
              return True
        `
      },
      {
        id: "d2", title: "A --count option",
        text: "<p>Add an option <code>--count</code> (an int, default 1) and print <code>ping</code> that many times.</p>",
        argv: "--count 3",
        starter: py`
          import argparse

          parser = argparse.ArgumentParser(prog="pinger")

          args = parser.parse_args()
        `,
        solution: py`
          import argparse

          parser = argparse.ArgumentParser(prog="pinger")
          parser.add_argument("--count", type=int, default=1)
          args = parser.parse_args()
          for _ in range(args.count):
              print("ping")
        `,
        check: py`
          def check(ns, out, run, src):
              for argv, want in [("--count 3", 3), ("", 1), ("--count 5", 5)]:
                  n, o, e = run(argv=argv)
                  if e:
                      return "With arguments \"" + argv + "\" your code crashed: " + e[0].splitlines()[-1] + (" (add type=int)" if "TypeError" in e[1] else "")
                  if H.lines(o) != ["ping"] * want:
                      return "With arguments \"" + argv + "\" expected ping " + str(want) + " time(s), got " + H.short(H.lines(o)) + "."
              n, o, e = run(argv="--count two")
              if n.get("__exit_code__") != 2:
                  return "--count two should be rejected by argparse (exit code 2). Add type=int."
              return True
        `
      },
      {
        id: "d3", title: "A --verbose flag",
        text: "<p>Add a flag <code>--verbose</code> (also <code>-v</code>). Print <code>verbose</code> when it's given and <code>quiet</code> when it isn't.</p>",
        argv: "-v",
        starter: py`
          import argparse

          parser = argparse.ArgumentParser(prog="tool")

          args = parser.parse_args()
        `,
        solution: py`
          import argparse

          parser = argparse.ArgumentParser(prog="tool")
          parser.add_argument("-v", "--verbose", action="store_true")
          args = parser.parse_args()
          print("verbose" if args.verbose else "quiet")
        `,
        check: py`
          def check(ns, out, run, src):
              for argv, want in [("-v", "verbose"), ("--verbose", "verbose"), ("", "quiet")]:
                  n, o, e = run(argv=argv)
                  if H.lines(o) != [want]:
                      return "With arguments \"" + argv + "\" expected " + want + ", got " + H.short(H.lines(o) or (e[0].splitlines()[-1] if e else "nothing")) + ". add_argument(\"-v\", \"--verbose\", action=\"store_true\")."
              return True
        `
      }
    ],

    "py-124": [
      {
        id: "d1", title: "A setting with a default",
        text: "<p>Print the <code>AWS_REGION</code> environment variable, or <code>ap-southeast-2</code> if it isn't set.</p>",
        env: { AWS_REGION: "us-east-1" },
        starter: py`
          import os

        `,
        solution: py`
          import os

          print(os.environ.get("AWS_REGION", "ap-southeast-2"))
        `,
        check: py`
          def check(ns, out, run, src):
              for env, want in [({"AWS_REGION": "us-east-1"}, "us-east-1"), ({}, "ap-southeast-2"), ({"AWS_REGION": "eu-west-2"}, "eu-west-2")]:
                  n, o, e = run(env=env)
                  if e:
                      return "With " + (str(env) if env else "AWS_REGION not set") + " your code crashed: " + e[0].splitlines()[-1] + ". Use os.environ.get(name, default)."
                  if H.lines(o) != [want]:
                      return "With " + ("AWS_REGION=" + env["AWS_REGION"] if env else "AWS_REGION not set") + " expected " + want + ", got " + H.short(H.lines(o)) + "."
              return True
        `
      },
      {
        id: "d2", title: "Exit with a status",
        text: "<p><code>ERRORS</code> in the environment is a number (as text). Print <code>3 errors</code> and exit with code <code>1</code> if it's above 0; otherwise print <code>clean</code> and exit with code 0.</p>",
        env: { ERRORS: "3" },
        starter: py`
          import os
          import sys

        `,
        solution: py`
          import os
          import sys

          errors = int(os.environ.get("ERRORS", "0"))
          if errors > 0:
              print(f"{errors} errors")
              sys.exit(1)
          print("clean")
        `,
        check: py`
          def check(ns, out, run, src):
              for env, want, code in [({"ERRORS": "3"}, "3 errors", 1), ({"ERRORS": "0"}, "clean", 0), ({"ERRORS": "12"}, "12 errors", 1)]:
                  n, o, e = run(env=env)
                  if e and "TypeError" in e[1]:
                      return "Environment values are strings. Convert with int(...) before comparing."
                  if H.lines(o) != [want] or n.get("__exit_code__") != code:
                      return "With ERRORS=" + env["ERRORS"] + " expected to print " + want + " and exit with " + str(code) + "; got " + H.short(H.lines(o)) + " and exit code " + str(n.get("__exit_code__")) + "."
              return True
        `
      },
      {
        id: "d3", title: "A required variable",
        text: "<p>If <code>DATABASE_URL</code> isn't set, print <code>error: DATABASE_URL is required</code> to <b>stderr</b> and exit with code 2. Otherwise print <code>config OK</code>. Never print the URL: it contains a password.</p>",
        env: { DATABASE_URL: "postgres://app:s3cr3t@db.internal/app" },
        starter: py`
          import os
          import sys

        `,
        solution: py`
          import os
          import sys

          url = os.environ.get("DATABASE_URL")
          if not url:
              print("error: DATABASE_URL is required", file=sys.stderr)
              sys.exit(2)
          print("config OK")
        `,
        check: py`
          def check(ns, out, run, src):
              n, o, e = run(env={"DATABASE_URL": "postgres://app:s3cr3t@db.internal/app"})
              if "s3cr3t" in o:
                  return "Your output contains the password from DATABASE_URL. Never print connection strings."
              if H.lines(o) != ["config OK"] or n.get("__exit_code__") != 0:
                  return "With DATABASE_URL set, print config OK and finish normally."
              n, o, e = run(env={})
              if n.get("__exit_code__") != 2 or "error: DATABASE_URL is required" not in o:
                  return "Without DATABASE_URL, print error: DATABASE_URL is required (to sys.stderr) and sys.exit(2). Got exit code " + str(n.get("__exit_code__")) + "."
              return True
        `
      }
    ],

    "py-125": [
      {
        id: "d1", title: "A Server class",
        text: "<p>Write a class <code>Server</code> with attributes <code>name</code> and <code>port</code>, and a method <code>url()</code> returning <code>https://web-01:8443</code>.</p>",
        starter: py`
          class Server:
              pass


          web = Server("web-01", 8443)
          print(web.url())
        `,
        solution: py`
          class Server:
              def __init__(self, name, port):
                  self.name = name
                  self.port = port

              def url(self):
                  return f"https://{self.name}:{self.port}"


          web = Server("web-01", 8443)
          print(web.url())
        `,
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Server")
              if not isinstance(C, type):
                  return "I can't find a class called Server."
              try:
                  s = C("db-01", 5432)
                  got = (s.name, s.port, s.url())
              except Exception as e:
                  return "Server(\"db-01\", 5432) and its url() should work, but: " + type(e).__name__ + ": " + str(e)
              if got != ("db-01", 5432, "https://db-01:5432"):
                  return "For Server(\"db-01\", 5432), name/port/url() gave " + H.short(got) + ", expected ('db-01', 5432, 'https://db-01:5432')."
              return True
        `
      },
      {
        id: "d2", title: "Lock after 3 failures",
        text: "<p>Write a class <code>Account</code>: <code>Account(\"alice\")</code> starts with <code>failures = 0</code>; <code>fail()</code> adds 1; <code>locked()</code> returns <code>True</code> once there have been 3 or more failures.</p>",
        starter: py`
          class Account:
              pass
        `,
        solution: py`
          class Account:
              def __init__(self, user):
                  self.user = user
                  self.failures = 0

              def fail(self):
                  self.failures += 1

              def locked(self):
                  return self.failures >= 3
        `,
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Account")
              if not isinstance(C, type):
                  return "I can't find a class called Account."
              try:
                  a, b = C("alice"), C("bob")
                  if a.failures != 0:
                      return "A new Account should start with failures = 0."
                  states = []
                  for _ in range(3):
                      states.append(a.locked())
                      a.fail()
                  states.append(a.locked())
              except Exception as e:
                  return "Using Account crashed: " + type(e).__name__ + ": " + str(e)
              if states != [False, False, False, True]:
                  return "locked() before each of 3 fail() calls and after should be [False, False, False, True], got " + str(states) + "."
              if b.locked() or b.failures != 0:
                  return "bob's account changed when alice failed. Store failures on self, not on the class."
              return True
        `
      },
      {
        id: "d3", title: "Print a ticket",
        text: "<p>Give <code>Ticket</code> a <code>__str__</code> so <code>print(t)</code> shows <code>SEC-101 [open] Enable MFA for carol</code>.</p>",
        starter: py`
          class Ticket:
              def __init__(self, id, title, status="open"):
                  self.id = id
                  self.title = title
                  self.status = status


          t = Ticket("SEC-101", "Enable MFA for carol")
          print(t)
        `,
        solution: py`
          class Ticket:
              def __init__(self, id, title, status="open"):
                  self.id = id
                  self.title = title
                  self.status = status

              def __str__(self):
                  return f"{self.id} [{self.status}] {self.title}"


          t = Ticket("SEC-101", "Enable MFA for carol")
          print(t)
        `,
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Ticket")
              t = C("SEC-205", "Rotate deploy key", "closed")
              if "object at 0x" in str(t):
                  return "print still shows the default <... object at 0x...>. Add a __str__ method."
              if str(t) != "SEC-205 [closed] Rotate deploy key":
                  return "For Ticket(\"SEC-205\", \"Rotate deploy key\", \"closed\"), str() should be SEC-205 [closed] Rotate deploy key, got " + repr(str(t)) + "."
              return H.printed(out, ["SEC-101 [open] Enable MFA for carol"])
        `
      }
    ],

    "py-126": [
      {
        id: "d1", title: "Test a slug function",
        text: "<p>Write <code>test_slugify()</code> with asserts that catch a <code>slugify</code> that forgets to <b>lowercase</b>, and one that forgets to <b>strip</b> spaces at the ends.</p>",
        prelude: TESTS.prelude,
        starter: py`
          def slugify(name):
              return name.strip().lower().replace(" ", "-")


          def test_slugify():
              pass


          run_tests()
        `,
        solution: py`
          def slugify(name):
              return name.strip().lower().replace(" ", "-")


          def test_slugify():
              assert slugify("Web Server") == "web-server"
              assert slugify("  api gateway ") == "api-gateway"


          run_tests()
        `,
        check: py`
          def check(ns, out, run, src):
              import io, contextlib
              t = ns.get("test_slugify")
              if not callable(t):
                  return "I can't find test_slugify."
              good = ns["slugify"]
              def passes(impl):
                  ns["slugify"] = impl
                  try:
                      with contextlib.redirect_stdout(io.StringIO()):
                          t()
                      return True
                  except Exception:
                      return False
                  finally:
                      ns["slugify"] = good
              if not passes(good):
                  return "test_slugify fails against the correct slugify. Check your expected values."
              if passes(lambda n: n.strip().replace(" ", "-")):
                  return "test_slugify still passes when slugify doesn't lowercase. Test a name with capitals."
              if passes(lambda n: n.lower().replace(" ", "-")):
                  return "test_slugify still passes when slugify doesn't strip. Test a name with spaces at the ends."
              return True
        `
      },
      {
        id: "d2", title: "Test the rejection",
        text: "<p>Write <code>test_rejects_http()</code> using <code>pytest.raises(ValueError)</code>, so it catches a <code>require_https</code> that lets <code>http://</code> URLs through.</p>",
        prelude: TESTS.prelude,
        starter: py`
          import pytest


          def require_https(url):
              if not url.startswith("https://"):
                  raise ValueError("only https:// URLs are allowed: " + url)
              return url


          def test_rejects_http():
              pass


          run_tests()
        `,
        solution: py`
          import pytest


          def require_https(url):
              if not url.startswith("https://"):
                  raise ValueError("only https:// URLs are allowed: " + url)
              return url


          def test_rejects_http():
              with pytest.raises(ValueError):
                  require_https("http://api.kestrel.io")


          run_tests()
        `,
        check: py`
          def check(ns, out, run, src):
              import io, contextlib
              t = ns.get("test_rejects_http")
              if not callable(t):
                  return "I can't find test_rejects_http."
              good = ns["require_https"]
              def passes(impl):
                  ns["require_https"] = impl
                  try:
                      with contextlib.redirect_stdout(io.StringIO()):
                          t()
                      return True
                  except Exception:
                      return False
                  finally:
                      ns["require_https"] = good
              if not passes(good):
                  return "test_rejects_http fails against the correct require_https. Pass it an http:// URL inside pytest.raises(ValueError)."
              if passes(lambda url: url):
                  return "test_rejects_http still passes when require_https accepts everything. Use with pytest.raises(ValueError): require_https(\"http://...\")."
              return True
        `
      },
      {
        id: "d3", title: "Fix what the test found",
        text: "<p><code>test_percent</code> fails. Fix <code>percent</code> (not the test) so <code>run_tests()</code> reports it passing.</p>",
        prelude: TESTS.prelude,
        starter: py`
          def percent(part, total):
              return part // total * 100


          def test_percent():
              assert percent(1, 4) == 25.0
              assert percent(3, 3) == 100.0


          run_tests()
        `,
        solution: py`
          def percent(part, total):
              return part / total * 100


          def test_percent():
              assert percent(1, 4) == 25.0
              assert percent(3, 3) == 100.0


          run_tests()
        `,
        check: py`
          def check(ns, out, run, src):
              if "assert percent(1, 4) == 25.0" not in src:
                  return "Fix percent, not the test."
              r = H.func(ns, "percent", [((1, 4), 25.0), ((3, 3), 100.0), ((1, 8), 12.5), ((0, 5), 0.0)])
              if r is not True:
                  return r + " (// throws away the remainder; / keeps it)"
              if "1 passed" not in H.lines(out):
                  return "Keep run_tests() at the end; it should print 1 passed."
              return True
        `
      }
    ]
  };

  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
