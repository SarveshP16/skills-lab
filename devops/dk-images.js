/* sudo learn — DevOps track: the Docker world's raw material. Base images are real layered file systems (each
   layer is a map of paths, shared between images the way real layers are), the public registry (docker.io) and
   Kestrel's private one (registry.kestrel.io), and small package indexes for pip, npm, apt and apk so builds
   install real-looking files (dist-info folders, dpkg status entries) that the vulnerability scanner reads back.
   Everything is deterministic: IDs and digests are hashes of names, so replaying the same commands gives the
   same machine. Exposes window.Dk (extended by dk-engine.js, dk-build.js, dk-compose.js and dk-trivy.js). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2;
  var Dk = root.Dk = root.Dk || {};
  var DAY = S.DAY, NOW = S.NOW;
  var MB = 1e6, KB = 1e3;

  function hex(seed, n) { return M2.hexOf(String(seed), n || 64); }
  function sha(seed) { return "sha256:" + hex(seed, 64); }
  Dk.hex = hex; Dk.sha = sha;

  /* ---------------- sizes and times the way the docker CLI prints them */
  function human(bytes) {
    if (bytes < 1000) return Math.round(bytes) + "B";
    var u = ["kB", "MB", "GB", "TB"], v = bytes / 1000, k = 0;
    while (v >= 1000 && k < u.length - 1) { v /= 1000; k++; }
    var s = v >= 100 ? String(Math.round(v)) : v >= 10 ? (Math.round(v * 10) / 10).toString() : (Math.round(v * 100) / 100).toString();
    return s + u[k];
  }
  // docker's "About a minute ago" style
  function ago(secs) {
    secs = Math.max(0, Math.round(secs));
    if (secs < 1) return "Less than a second";
    if (secs < 60) return secs + " second" + (secs === 1 ? "" : "s");
    var m = Math.round(secs / 60);
    if (secs < 90) return "About a minute";
    if (m < 60) return m + " minutes";
    var h = Math.round(secs / 3600);
    if (secs < 5400) return "About an hour";
    if (h < 48) return h + " hours";
    var d = Math.round(secs / 86400);
    if (d < 14) return d + " days";
    if (d < 60) return Math.round(d / 7) + " weeks";
    if (d < 730) return Math.round(d / 30) + " months";
    return Math.round(d / 365) + " years";
  }
  Dk.human = human; Dk.ago = ago;

  /* ---------------- layers: { id, files: {path: entry}, size, by } ; entry {t:"f"|"d"|"l"|"wh", c, m, u, g, sz} */
  function F(c, m, u, g, sz) { var e = { t: "f", c: c == null ? "" : String(c), m: m == null ? 420 : m, u: u || 0, g: g || 0 }; if (sz != null) e.sz = sz; return e; }
  function Dd(m, u, g) { return { t: "d", m: m == null ? 493 : m, u: u || 0, g: g || 0 }; }
  function Ln(to) { return { t: "l", to: to }; }
  function bin(impl) { return F("\x7fELF:" + impl + " (simulated binary)\n", 493, 0, 0, 40 * KB); }
  Dk.F = F; Dk.Dd = Dd; Dk.Ln = Ln; Dk.bin = bin;

  var COREUTILS = ["ls", "cat", "echo", "env", "id", "whoami", "mkdir", "rm", "rmdir", "cp", "mv", "touch", "chmod", "chown", "chgrp", "ln", "head", "tail", "wc", "sort", "uniq", "cut", "tr", "sleep", "date", "uname", "pwd", "du", "stat", "basename", "dirname", "tee", "printf", "true", "false", "test", "[", "xargs", "seq", "yes", "nproc", "md5sum", "sha256sum", "base64", "mktemp", "realpath", "readlink", "expr", "timeout", "nohup", "printenv"];
  var TOOLS = ["grep", "sed", "find", "tar", "gzip", "gunzip", "zcat", "hostname", "which", "kill", "mount", "diff"];
  function passwd(rows) { return rows.join("\n") + "\n"; }
  var DEB_PASSWD = ["root:x:0:0:root:/root:/bin/bash", "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin", "bin:x:2:2:bin:/bin:/usr/sbin/nologin", "sys:x:3:3:sys:/dev:/usr/sbin/nologin", "sync:x:4:65534:sync:/bin:/bin/sync", "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin", "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin"];
  var DEB_GROUP = ["root:x:0:", "daemon:x:1:", "bin:x:2:", "sys:x:3:", "adm:x:4:", "tty:x:5:", "www-data:x:33:", "staff:x:50:", "users:x:100:", "nogroup:x:65534:"];
  var ALP_PASSWD = ["root:x:0:0:root:/root:/bin/sh", "bin:x:1:1:bin:/bin:/sbin/nologin", "daemon:x:2:2:daemon:/sbin:/sbin/nologin", "nobody:x:65534:65534:nobody:/:/sbin/nologin"];
  var ALP_GROUP = ["root:x:0:root", "bin:x:1:root,bin,daemon", "daemon:x:2:root,bin,daemon", "wheel:x:10:root", "nogroup:x:65533:", "nobody:x:65534:"];
  function shadowFor(rows) { return rows.map(function (r) { return r.split(":")[0] + ":*:20000:0:99999:7:::"; }).join("\n") + "\n"; }

  // dpkg status / apk installed databases: what the scanner reads
  function dpkgStatus(pkgs) { return pkgs.map(function (p) { return "Package: " + p[0] + "\nStatus: install ok installed\nArchitecture: amd64\nVersion: " + p[1] + "\n"; }).join("\n"); }
  function apkInstalled(pkgs) { return pkgs.map(function (p) { return "P:" + p[0] + "\nV:" + p[1] + "\n"; }).join("\n"); }
  function parseDpkg(text) { var out = []; String(text || "").split(/\n\n+/).forEach(function (b) { var n = /^Package: (.+)$/m.exec(b), v = /^Version: (.+)$/m.exec(b); if (n && v) out.push([n[1], v[1]]); }); return out; }
  function parseApk(text) { var out = []; String(text || "").split(/\n\n+/).forEach(function (b) { var n = /^P:(.+)$/m.exec(b), v = /^V:(.+)$/m.exec(b); if (n && v) out.push([n[1], v[1]]); }); return out; }
  Dk.dpkgStatus = dpkgStatus; Dk.apkInstalled = apkInstalled; Dk.parseDpkg = parseDpkg; Dk.parseApk = parseApk;

  var DEB_SLIM_PKGS = [["base-files", "12.4+deb12u8"], ["bash", "5.2.15-2+b7"], ["coreutils", "9.1-1"], ["dpkg", "1.21.22"], ["apt", "2.6.1"], ["libc6", "2.36-9+deb12u9"], ["libssl3", "3.0.15-1~deb12u1"], ["zlib1g", "1:1.2.13.dfsg-1"], ["perl-base", "5.36.0-7+deb12u1"], ["login", "1:4.13+dfsg1-1+b1"], ["passwd", "1:4.13+dfsg1-1+b1"], ["tar", "1.34+dfsg-1.2+deb12u1"], ["gzip", "1.12-1"], ["sed", "4.9-1"], ["grep", "3.8-5"], ["libsystemd0", "252.31-1~deb12u1"], ["tzdata", "2024b-0+deb12u1"], ["ca-certificates", "20230311"]];
  // an image built twenty months ago: same Debian release, older package builds
  var DEB_OLD_PKGS = [["base-files", "12.4+deb12u2"], ["bash", "5.2.15-2+b2"], ["coreutils", "9.1-1"], ["dpkg", "1.21.22"], ["apt", "2.6.1"], ["libc6", "2.36-9+deb12u1"], ["libssl3", "3.0.11-1~deb12u1"], ["zlib1g", "1:1.2.13.dfsg-1"], ["perl-base", "5.36.0-7"], ["login", "1:4.13+dfsg1-1"], ["passwd", "1:4.13+dfsg1-1"], ["tar", "1.34+dfsg-1.2"], ["curl", "7.88.1-10+deb12u1"], ["libcurl4", "7.88.1-10+deb12u1"], ["git", "1:2.39.2-1.1"], ["openssh-client", "1:9.2p1-2"], ["libexpat1", "2.5.0-1"], ["libaom3", "3.6.0-1"], ["gcc-12", "12.2.0-14"], ["make", "4.3-4.1"], ["wget", "1.21.3-1+b2"], ["procps", "2:4.0.2-3"]];
  var DEB_FULL_PKGS = DEB_SLIM_PKGS.concat([["curl", "7.88.1-10+deb12u8"], ["libcurl4", "7.88.1-10+deb12u8"], ["git", "1:2.39.5-0+deb12u1"], ["openssh-client", "1:9.2p1-2+deb12u3"], ["libexpat1", "2.5.0-1+deb12u1"], ["libaom3", "3.6.0-1+deb12u1"], ["gcc-12", "12.2.0-14"], ["make", "4.3-4.1"], ["wget", "1.21.3-1+b2"], ["procps", "2:4.0.2-3"]]);
  var ALPINE_PKGS = [["alpine-baselayout", "3.6.5-r0"], ["busybox", "1.36.1-r29"], ["musl", "1.2.5-r0"], ["libcrypto3", "3.3.2-r1"], ["libssl3", "3.3.2-r1"], ["zlib", "1.3.1-r1"], ["apk-tools", "2.14.4-r1"], ["ca-certificates-bundle", "20240705-r0"]];

  function debRoot(o) {
    var f = {};
    ["/bin", "/sbin", "/lib", "/usr", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/local", "/usr/local/bin", "/usr/local/lib", "/usr/share", "/etc", "/home", "/opt", "/srv", "/var", "/var/lib", "/var/log", "/var/cache", "/run", "/mnt", "/media", "/proc", "/sys", "/dev"].forEach(function (d) { f[d] = Dd(); });
    f["/root"] = Dd(448); f["/tmp"] = Dd(1023); f["/var/tmp"] = Dd(1023);
    f["/dev/null"] = { t: "f", c: "", m: 438, special: "null" };
    var bins = COREUTILS.concat(TOOLS).concat(o.extraBins || []);
    bins.forEach(function (b) { f["/usr/bin/" + b] = bin(b); });
    f["/usr/bin/bash"] = bin("bash"); f["/usr/bin/sh"] = bin("sh"); f["/bin/sh"] = bin("sh"); f["/bin/bash"] = bin("bash");
    f["/usr/bin/apt-get"] = bin("dkapt"); f["/usr/bin/apt"] = bin("dkapt"); f["/usr/bin/dpkg"] = bin("dkdpkg");
    f["/usr/sbin/useradd"] = bin("dkuseradd"); f["/usr/sbin/groupadd"] = bin("dkgroupadd"); f["/usr/sbin/adduser"] = bin("dkadduser"); f["/usr/sbin/addgroup"] = bin("dkaddgroup");
    (o.extraSbin || []).forEach(function (b) { f["/usr/sbin/" + b[0]] = bin(b[1]); });
    f["/etc/os-release"] = F(o.osRelease);
    f["/etc/debian_version"] = F(o.debVersion + "\n");
    f["/etc/passwd"] = F(passwd(DEB_PASSWD)); f["/etc/group"] = F(passwd(DEB_GROUP)); f["/etc/shadow"] = F(shadowFor(DEB_PASSWD), 416, 0, 42);
    f["/etc/skel"] = Dd(); f["/etc/skel/.bashrc"] = F("# ~/.bashrc\n");
    f["/root/.bashrc"] = F("# ~/.bashrc: executed by bash(1) for non-login shells.\n");
    f["/var/lib/dpkg"] = Dd(); f["/var/lib/dpkg/status"] = F(dpkgStatus(o.pkgs));
    f["/var/lib/apt"] = Dd(); f["/var/lib/apt/lists"] = Dd();
    return f;
  }
  var BOOKWORM_OS = "PRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\nNAME=\"Debian GNU/Linux\"\nVERSION_ID=\"12\"\nVERSION=\"12 (bookworm)\"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL=\"https://www.debian.org/\"\n";
  var UBUNTU_OS = "PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nVERSION=\"24.04.1 LTS (Noble Numbat)\"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\n";
  function alpineRoot(pkgs) {
    var f = {};
    ["/bin", "/sbin", "/lib", "/usr", "/usr/bin", "/usr/sbin", "/usr/lib", "/usr/local", "/usr/local/bin", "/usr/local/lib", "/usr/share", "/etc", "/home", "/opt", "/srv", "/var", "/var/lib", "/var/log", "/var/cache", "/run", "/mnt", "/media", "/proc", "/sys", "/dev", "/lib/apk", "/lib/apk/db", "/etc/apk"].forEach(function (d) { f[d] = Dd(); });
    f["/root"] = Dd(448); f["/tmp"] = Dd(1023);
    f["/dev/null"] = { t: "f", c: "", m: 438, special: "null" };
    f["/bin/busybox"] = bin("busybox");
    COREUTILS.concat(TOOLS).concat(["sh", "ash", "vi", "less", "more", "top"]).forEach(function (b) { f["/bin/" + b] = bin(b === "ash" ? "sh" : b === "top" ? "dkps" : b); });
    f["/bin/ps"] = bin("dkps"); f["/usr/bin/wget"] = bin("dkwget"); f["/usr/bin/nc"] = bin("dknc");
    f["/sbin/apk"] = bin("dkapk"); f["/usr/sbin/adduser"] = bin("dkadduser"); f["/usr/sbin/addgroup"] = bin("dkaddgroup");
    f["/etc/os-release"] = F("NAME=\"Alpine Linux\"\nID=alpine\nVERSION_ID=3.20.3\nPRETTY_NAME=\"Alpine Linux v3.20\"\nHOME_URL=\"https://alpinelinux.org/\"\nBUG_REPORT_URL=\"https://gitlab.alpinelinux.org/alpine/aports/-/issues\"\n");
    f["/etc/alpine-release"] = F("3.20.3\n");
    f["/etc/passwd"] = F(passwd(ALP_PASSWD)); f["/etc/group"] = F(passwd(ALP_GROUP)); f["/etc/shadow"] = F(shadowFor(ALP_PASSWD), 416, 0, 42);
    f["/etc/apk/repositories"] = F("https://dl-cdn.alpinelinux.org/alpine/v3.20/main\nhttps://dl-cdn.alpinelinux.org/alpine/v3.20/community\n");
    f["/lib/apk/db/installed"] = F(apkInstalled(pkgs || ALPINE_PKGS));
    return f;
  }

  /* ---------------- the layer table: shared layers are shared objects */
  var LAYERS = {};
  function layer(key, by, size, files, created) { LAYERS[key] = { id: sha("layer:" + key), key: key, by: by, size: size, files: files || {}, created: created }; return LAYERS[key]; }
  Dk.LAYERS = LAYERS;
  var T_BOOK = NOW - 26 * DAY, T_OLD = NOW - 610 * DAY;
  layer("debian-slim", "# debian.sh --arch 'amd64' out/ 'bookworm' '@1730073600'", 74.8 * MB, debRoot({ osRelease: BOOKWORM_OS, debVersion: "12.8", pkgs: DEB_SLIM_PKGS }), T_BOOK);
  layer("debian-full", "# debian.sh --arch 'amd64' out/ 'bookworm' '@1730073600'", 116.5 * MB, debRoot({ osRelease: BOOKWORM_OS, debVersion: "12.8", pkgs: DEB_FULL_PKGS, extraBins: ["curl", "wget", "git", "gcc", "make", "ssh", "perl"], extraSbin: [] }), T_BOOK);
  (function () { var f = LAYERS["debian-full"].files; f["/usr/bin/curl"] = bin("dkcurl"); f["/usr/bin/wget"] = bin("dkwget"); f["/usr/bin/ps"] = bin("dkps"); f["/bin/ps"] = bin("dkps"); f["/usr/bin/gcc"] = bin("dkgcc"); f["/usr/bin/git"] = bin("dkgit"); f["/usr/bin/ssh"] = bin("dkssh"); f["/usr/bin/perl"] = bin("dkperl"); f["/usr/bin/make"] = bin("dkmake"); })();
  layer("debian-old", "# debian.sh --arch 'amd64' out/ 'bookworm' '@1694649600'", 116.4 * MB, debRoot({ osRelease: BOOKWORM_OS, debVersion: "12.1", pkgs: DEB_OLD_PKGS, extraBins: [] }), T_OLD);
  (function () { var f = LAYERS["debian-old"].files; f["/usr/bin/curl"] = bin("dkcurl"); f["/usr/bin/wget"] = bin("dkwget"); f["/usr/bin/ps"] = bin("dkps"); f["/bin/ps"] = bin("dkps"); f["/usr/bin/gcc"] = bin("dkgcc"); f["/usr/bin/git"] = bin("dkgit"); f["/usr/bin/ssh"] = bin("dkssh"); })();
  layer("buildpack", "/bin/sh -c set -eux; apt-get update; apt-get install -y --no-install-recommends autoconf automake bzip2 dpkg-dev file g++ gcc imagemagick libbz2-dev libc6-dev libcurl4-openssl-dev ...", 588 * MB, {}, T_BOOK);
  layer("buildpack-old", "/bin/sh -c set -eux; apt-get update; apt-get install -y --no-install-recommends autoconf automake bzip2 dpkg-dev file g++ gcc imagemagick libbz2-dev libc6-dev libcurl4-openssl-dev ...", 586 * MB, {}, T_OLD);
  layer("ubuntu", "/bin/sh -c #(nop) ADD file:6df775300d76441aa33f31b22c1afce8dfe35c8ffbc14ef27c27009235b12a95 in / ", 78.1 * MB, debRoot({ osRelease: UBUNTU_OS, debVersion: "trixie/sid", pkgs: [["base-files", "13ubuntu10.1"], ["bash", "5.2.21-2ubuntu4"], ["coreutils", "9.4-3ubuntu6"], ["libc6", "2.39-0ubuntu8.3"], ["zlib1g", "1:1.3.dfsg-3.1ubuntu2.1"], ["perl-base", "5.38.2-3.2build2"]] }), NOW - 40 * DAY);
  layer("alpine", "ADD alpine-minirootfs-3.20.3-x86_64.tar.gz / # buildkit", 7.8 * MB, alpineRoot(), NOW - 70 * DAY);
  layer("busybox", "BusyBox 1.36.1 (glibc), Debian 12", 4.27 * MB, (function () { var f = alpineRoot([]); delete f["/sbin/apk"]; delete f["/lib/apk/db/installed"]; f["/etc/os-release"] = F("NAME=\"BusyBox\"\n"); return f; })(), NOW - 400 * DAY);
  layer("hello", "COPY hello / # buildkit", 13.3 * KB, { "/hello": bin("dkhello") }, NOW - 560 * DAY);

  // Python on top of Debian or Alpine
  function pyFiles(ver, prefix, alpine) {
    var mm = ver.split(".").slice(0, 2).join("."), f = {};
    var b = (prefix || "/usr/local") + "/bin/", lib = (prefix || "/usr/local") + "/lib/python" + mm;
    f[b + "python" + mm] = bin("dkpython"); f[b + "python3"] = bin("dkpython"); f[b + "python"] = bin("dkpython");
    f[b + "pip"] = bin("dkpip"); f[b + "pip3"] = bin("dkpip"); f[b + "pip" + mm] = bin("dkpip");
    f[lib] = Dd(); f[lib + "/os.py"] = F("# Python " + ver + " standard library\n"); f[lib + "/site-packages"] = Dd();
    var pipV = mm === "3.9" ? "23.0.1" : "24.3.1";
    f[lib + "/site-packages/pip"] = Dd(); f[lib + "/site-packages/pip-" + pipV + ".dist-info"] = Dd();
    f[lib + "/site-packages/pip-" + pipV + ".dist-info/METADATA"] = F("Metadata-Version: 2.1\nName: pip\nVersion: " + pipV + "\n");
    if (mm === "3.9") { f[lib + "/site-packages/setuptools"] = Dd(); f[lib + "/site-packages/setuptools-58.1.0.dist-info"] = Dd(); f[lib + "/site-packages/setuptools-58.1.0.dist-info/METADATA"] = F("Metadata-Version: 2.1\nName: setuptools\nVersion: 58.1.0\n"); }
    if (alpine) f["/lib/apk/db/installed"] = F(apkInstalled(ALPINE_PKGS.concat([["python3-deps", "0"]]).filter(function (p) { return p[0] !== "python3-deps"; })));
    return f;
  }
  layer("py312-env", "ENV PYTHON_VERSION=3.12.7", 0, {}, T_BOOK);
  layer("py312", "RUN /bin/sh -c set -eux; wget -O python.tar.xz \"https://www.python.org/ftp/python/3.12.7/Python-3.12.7.tar.xz\"; ... make install # buildkit", 50.4 * MB, pyFiles("3.12.7"), T_BOOK);
  layer("py312-full", "RUN /bin/sh -c set -eux; wget -O python.tar.xz \"https://www.python.org/ftp/python/3.12.7/Python-3.12.7.tar.xz\"; ... make install # buildkit", 61.4 * MB, pyFiles("3.12.7"), T_BOOK);
  layer("py312-alpine", "RUN /bin/sh -c set -eux; apk add --no-cache --virtual .build-deps ... ; make install # buildkit", 49.8 * MB, pyFiles("3.12.7", null, true), NOW - 26 * DAY);
  layer("py39", "RUN /bin/sh -c set -eux; wget -O python.tar.xz \"https://www.python.org/ftp/python/3.9.18/Python-3.9.18.tar.xz\"; ... make install # buildkit", 58.9 * MB, pyFiles("3.9.18"), T_OLD);
  // nginx on Debian slim and on Alpine
  function nginxFiles(alpine) {
    var f = {};
    f["/usr/sbin/nginx"] = bin("dknginx");
    f["/docker-entrypoint.sh"] = F("#!/bin/sh\n# vim:sw=4:ts=4:et\nset -e\n# (runs /docker-entrypoint.d/*.sh, then execs \"$@\")\nexec \"$@\"\n", 509);
    f["/docker-entrypoint.d"] = Dd();
    f["/etc/nginx"] = Dd(); f["/etc/nginx/conf.d"] = Dd();
    f["/etc/nginx/nginx.conf"] = F("user  nginx;\nworker_processes  auto;\n\nerror_log  /var/log/nginx/error.log notice;\npid        /var/run/nginx.pid;\n\nevents {\n    worker_connections  1024;\n}\n\nhttp {\n    include       /etc/nginx/mime.types;\n    default_type  application/octet-stream;\n    access_log  /var/log/nginx/access.log  main;\n    sendfile        on;\n    keepalive_timeout  65;\n    include /etc/nginx/conf.d/*.conf;\n}\n");
    f["/etc/nginx/conf.d/default.conf"] = F("server {\n    listen       80;\n    listen  [::]:80;\n    server_name  localhost;\n\n    location / {\n        root   /usr/share/nginx/html;\n        index  index.html index.htm;\n    }\n\n    error_page   500 502 503 504  /50x.html;\n    location = /50x.html {\n        root   /usr/share/nginx/html;\n    }\n}\n");
    f["/etc/nginx/mime.types"] = F("types {\n    text/html html htm;\n    text/css css;\n    application/javascript js;\n    application/json json;\n}\n");
    f["/usr/share/nginx"] = Dd(); f["/usr/share/nginx/html"] = Dd();
    f["/usr/share/nginx/html/index.html"] = F("<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and working.</p>\n</body>\n</html>\n");
    f["/usr/share/nginx/html/50x.html"] = F("<!DOCTYPE html>\n<html>\n<head>\n<title>Error</title>\n</head>\n<body>\n<h1>An error occurred.</h1>\n</body>\n</html>\n");
    f["/var/log/nginx"] = Dd(); f["/var/log/nginx/access.log"] = Ln("/dev/stdout"); f["/var/log/nginx/error.log"] = Ln("/dev/stderr");
    f["/var/cache/nginx"] = Dd();
    f["/etc/passwd"] = F(passwd((alpine ? ALP_PASSWD : DEB_PASSWD).concat(["nginx:x:101:101:nginx user:/nonexistent:/bin/false"])));
    f["/etc/group"] = F(passwd((alpine ? ALP_GROUP : DEB_GROUP).concat(["nginx:x:101:nginx"])));
    if (!alpine) f["/var/lib/dpkg/status"] = F(dpkgStatus(DEB_SLIM_PKGS.concat([["nginx", "1.27.2-1~bookworm"], ["libxml2", "2.9.14+dfsg-1.3~deb12u1"]])));
    else f["/lib/apk/db/installed"] = F(apkInstalled(ALPINE_PKGS.concat([["nginx", "1.27.2-r1"], ["pcre2", "10.43-r0"]])));
    return f;
  }
  layer("nginx", "RUN /bin/sh -c set -x && groupadd --system --gid 101 nginx && ... apt-get install --no-install-recommends --no-install-suggests -y nginx=1.27.2-1~bookworm # buildkit", 117 * MB, nginxFiles(false), NOW - 25 * DAY);
  layer("nginx-alpine", "RUN /bin/sh -c set -x && addgroup -g 101 -S nginx && ... apk add --no-cache nginx=1.27.2-r1 # buildkit", 40.1 * MB, nginxFiles(true), NOW - 25 * DAY);
  // Redis and PostgreSQL (Alpine)
  layer("redis", "RUN /bin/sh -c set -eux; apk add --no-cache --virtual .build-deps ... make install # buildkit", 37.6 * MB, (function () { var f = {}; f["/usr/local/bin/redis-server"] = bin("dkredis"); f["/usr/local/bin/redis-cli"] = bin("dkrediscli"); f["/usr/local/bin/docker-entrypoint.sh"] = F("#!/bin/sh\nset -e\nexec \"$@\"\n", 509); f["/data"] = Dd(493, 999, 1000); f["/etc/passwd"] = F(passwd(ALP_PASSWD.concat(["redis:x:999:1000:Linux User,,,:/home/redis:/sbin/nologin"]))); f["/etc/group"] = F(passwd(ALP_GROUP.concat(["redis:x:1000:redis"]))); return f; })(), NOW - 30 * DAY);
  layer("postgres", "RUN /bin/sh -c set -eux; apk add --no-cache --virtual .build-deps ... make install-world # buildkit", 268 * MB, (function () { var f = {}; ["postgres", "pg_ctl", "initdb"].forEach(function (b) { f["/usr/local/bin/" + b] = bin("dkpostgres"); }); f["/usr/local/bin/psql"] = bin("dkpsql"); f["/usr/local/bin/pg_isready"] = bin("dkpgisready"); f["/usr/local/bin/pg_dump"] = bin("dkpgdump"); f["/usr/local/bin/docker-entrypoint.sh"] = F("#!/usr/bin/env bash\nset -Eeo pipefail\n# initialises $PGDATA on first start, then execs postgres\n", 509); f["/var/lib/postgresql"] = Dd(493, 70, 70); f["/var/lib/postgresql/data"] = Dd(448, 70, 70); f["/docker-entrypoint-initdb.d"] = Dd(); f["/etc/passwd"] = F(passwd(ALP_PASSWD.concat(["postgres:x:70:70:PostgreSQL user:/var/lib/postgresql:/bin/sh"]))); f["/etc/group"] = F(passwd(ALP_GROUP.concat(["postgres:x:70:"]))); return f; })(), NOW - 30 * DAY);
  // Node.js
  function nodeFiles() { var f = {}; f["/usr/local/bin/node"] = bin("dknode"); f["/usr/local/bin/npm"] = bin("dknpm"); f["/usr/local/bin/npx"] = bin("dknpm"); f["/usr/local/lib/node_modules"] = Dd(); f["/usr/local/lib/node_modules/npm"] = Dd(); f["/usr/local/lib/node_modules/npm/package.json"] = F("{\"name\":\"npm\",\"version\":\"10.8.2\"}\n"); f["/etc/passwd"] = F(passwd(ALP_PASSWD.concat(["node:x:1000:1000::/home/node:/bin/sh"]))); f["/home/node"] = Dd(493, 1000, 1000); return f; }
  layer("node20-alpine", "RUN /bin/sh -c addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node && ... # buildkit", 127 * MB, nodeFiles(), NOW - 20 * DAY);
  layer("node20", "RUN /bin/sh -c groupadd --gid 1000 node && useradd --uid 1000 --gid node --shell /bin/bash --create-home node && ... # buildkit", 191 * MB, (function () { var f = nodeFiles(); f["/etc/passwd"] = F(passwd(DEB_PASSWD.concat(["node:x:1000:1000::/home/node:/bin/bash"]))); return f; })(), NOW - 20 * DAY);
  layer("trivy", "COPY trivy /usr/local/bin/trivy # buildkit", 160 * MB, { "/usr/local/bin/trivy": bin("trivy") }, NOW - 30 * DAY);

  /* ---------------- base images: layers + config. hist: [created_by, size?] rows for docker history */
  var PATHV = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  var BASES = {};
  function base(name, o) { BASES[name] = o; return o; }
  base("debian:bookworm-slim", { layers: ["debian-slim"], env: ["PATH=" + PATHV], cmd: ["bash"], os: "debian 12.8", aliases: ["debian:12-slim"] });
  base("debian:bookworm", { layers: ["debian-full"], env: ["PATH=" + PATHV], cmd: ["bash"], os: "debian 12.8", aliases: ["debian:12", "debian:latest"] });
  base("ubuntu:24.04", { layers: ["ubuntu"], env: ["PATH=" + PATHV], cmd: ["/bin/bash"], os: "ubuntu 24.04", aliases: ["ubuntu:latest", "ubuntu:noble"] });
  base("alpine:3.20", { layers: ["alpine"], env: ["PATH=" + PATHV], cmd: ["/bin/sh"], os: "alpine 3.20.3", aliases: ["alpine:latest", "alpine:3.20.3", "alpine:3"] });
  base("busybox:1.36", { layers: ["busybox"], env: ["PATH=" + PATHV], cmd: ["sh"], os: "busybox", aliases: ["busybox:latest"] });
  base("hello-world:latest", { layers: ["hello"], env: ["PATH=" + PATHV], cmd: ["/hello"], os: "", aliases: [] });
  base("python:3.12-slim", { layers: ["debian-slim", "py312"], env: ["PATH=" + PATHV, "LANG=C.UTF-8", "GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305", "PYTHON_VERSION=3.12.7", "PYTHON_SHA256=24887b92e2afd4a2ac602419ad4b596372f67ac9b077190f459aba390faf5550"], cmd: ["python3"], os: "debian 12.8", aliases: ["python:3.12-slim-bookworm", "python:3-slim"] });
  base("python:3.12", { layers: ["debian-full", "buildpack", "py312-full"], env: ["PATH=" + PATHV, "LANG=C.UTF-8", "PYTHON_VERSION=3.12.7"], cmd: ["python3"], os: "debian 12.8", aliases: ["python:3.12-bookworm", "python:3", "python:latest"] });
  base("python:3.12-alpine", { layers: ["alpine", "py312-alpine"], env: ["PATH=" + PATHV, "LANG=C.UTF-8", "PYTHON_VERSION=3.12.7"], cmd: ["python3"], os: "alpine 3.20.3", aliases: ["python:3.12-alpine3.20", "python:3-alpine"] });
  base("python:3.9", { layers: ["debian-old", "buildpack-old", "py39"], env: ["PATH=" + PATHV, "LANG=C.UTF-8", "PYTHON_VERSION=3.9.18"], cmd: ["python3"], os: "debian 12.1", aliases: ["python:3.9-bookworm"], created: T_OLD });
  base("nginx:1.27", { layers: ["debian-slim", "nginx"], env: ["PATH=" + PATHV, "NGINX_VERSION=1.27.2", "NJS_VERSION=0.8.6", "PKG_RELEASE=1~bookworm"], entrypoint: ["/docker-entrypoint.sh"], cmd: ["nginx", "-g", "daemon off;"], expose: ["80/tcp"], stopSignal: "SIGQUIT", os: "debian 12.8", aliases: ["nginx:latest", "nginx:1.27.2", "nginx:mainline"] });
  base("nginx:1.27-alpine", { layers: ["alpine", "nginx-alpine"], env: ["PATH=" + PATHV, "NGINX_VERSION=1.27.2", "PKG_RELEASE=1"], entrypoint: ["/docker-entrypoint.sh"], cmd: ["nginx", "-g", "daemon off;"], expose: ["80/tcp"], stopSignal: "SIGQUIT", os: "alpine 3.20.3", aliases: ["nginx:alpine", "nginx:1.27.2-alpine"] });
  base("redis:7.4-alpine", { layers: ["alpine", "redis"], env: ["PATH=" + PATHV, "REDIS_VERSION=7.4.1"], entrypoint: ["docker-entrypoint.sh"], cmd: ["redis-server"], expose: ["6379/tcp"], workdir: "/data", volumes: ["/data"], os: "alpine 3.20.3", aliases: ["redis:7-alpine", "redis:alpine", "redis:7.4.1-alpine"] });
  base("postgres:16-alpine", { layers: ["alpine", "postgres"], env: ["PATH=" + PATHV + ":/usr/local/pgsql/bin", "PG_MAJOR=16", "PG_VERSION=16.4", "PGDATA=/var/lib/postgresql/data"], entrypoint: ["docker-entrypoint.sh"], cmd: ["postgres"], expose: ["5432/tcp"], volumes: ["/var/lib/postgresql/data"], stopSignal: "SIGINT", os: "alpine 3.20.3", aliases: ["postgres:16.4-alpine", "postgres:alpine"] });
  base("node:20-alpine", { layers: ["alpine", "node20-alpine"], env: ["PATH=" + PATHV, "NODE_VERSION=20.18.0", "YARN_VERSION=1.22.22"], entrypoint: ["docker-entrypoint.sh"], cmd: ["node"], os: "alpine 3.20.3", aliases: ["node:20.18-alpine", "node:lts-alpine"] });
  base("node:20", { layers: ["debian-full", "buildpack", "node20"], env: ["PATH=" + PATHV, "NODE_VERSION=20.18.0"], entrypoint: ["docker-entrypoint.sh"], cmd: ["node"], os: "debian 12.8", aliases: ["node:lts", "node:20-bookworm"] });
  base("aquasec/trivy:0.57.0", { layers: ["alpine", "trivy"], env: ["PATH=" + PATHV], entrypoint: ["trivy"], cmd: [], os: "alpine 3.20.3", aliases: ["aquasec/trivy:latest"] });
  Dk.BASES = BASES;

  /* ---------------- image references: [registry/]repo[:tag][@digest] */
  function parseRef(ref) {
    ref = String(ref || "");
    var digest = null, m = /^(.*)@(sha256:[0-9a-f]{64})$/.exec(ref);
    if (m) { ref = m[1]; digest = m[2]; }
    var tag = null, slash = ref.lastIndexOf("/"), colon = ref.lastIndexOf(":");
    if (colon > slash) { tag = ref.slice(colon + 1); ref = ref.slice(0, colon); }
    var parts = ref.split("/"), registry = "docker.io";
    if (parts.length > 1 && (/[.:]/.test(parts[0]) || parts[0] === "localhost")) registry = parts.shift();
    var repo = parts.join("/");
    if (registry === "docker.io" && repo.indexOf("/") < 0) repo = "library/" + repo;
    if (!tag && !digest) tag = "latest";
    return { registry: registry, repo: repo, tag: tag, digest: digest, valid: /^[a-z0-9]+([._\-\/][a-z0-9]+)*$/.test(repo) && (!tag || /^[\w][\w.-]{0,127}$/.test(tag)) };
  }
  // the short name docker prints: python:3.12-slim, registry.kestrel.io/kestrel/worker:2.4.0
  function shortName(p) {
    var repo = p.registry === "docker.io" ? p.repo.replace(/^library\//, "") : p.registry + "/" + p.repo;
    return repo + (p.tag ? ":" + p.tag : "");
  }
  function repoName(p) { return p.registry === "docker.io" ? p.repo.replace(/^library\//, "") : p.registry + "/" + p.repo; }
  function fullName(p) { return (p.registry === "docker.io" ? "docker.io/" : p.registry + "/") + p.repo + (p.tag ? ":" + p.tag : ""); }
  Dk.parseRef = parseRef; Dk.shortName = shortName; Dk.repoName = repoName; Dk.fullName = fullName;

  /* ---------------- images from base definitions */
  function cfgOf(b) {
    return { Env: (b.env || []).slice(), Cmd: b.cmd ? b.cmd.slice() : null, Entrypoint: b.entrypoint ? b.entrypoint.slice() : null, WorkingDir: b.workdir || "", User: b.user || "", ExposedPorts: (b.expose || []).reduce(function (o, p) { o[p] = {}; return o; }, {}), Volumes: (b.volumes || []).reduce(function (o, p) { o[p] = {}; return o; }, {}), Labels: Object.assign({}, b.labels || {}), Healthcheck: b.healthcheck || null, StopSignal: b.stopSignal || null };
  }
  function historyOf(b, layers) {
    var rows = [];
    layers.forEach(function (L) { rows.push({ by: L.by, size: L.size, created: L.created, empty: L.size === 0 && !Object.keys(L.files).length }); });
    (b.env || []).forEach(function (e) { rows.push({ by: "ENV " + e, size: 0, empty: true, created: layers[layers.length - 1].created }); });
    if (b.workdir) rows.push({ by: "WORKDIR " + b.workdir, size: 0, empty: true, created: layers[layers.length - 1].created });
    (b.expose || []).forEach(function (p) { rows.push({ by: "EXPOSE map[" + p + ":{}]", size: 0, empty: true, created: layers[layers.length - 1].created }); });
    if (b.entrypoint) rows.push({ by: "ENTRYPOINT " + JSON.stringify(b.entrypoint), size: 0, empty: true, created: layers[layers.length - 1].created });
    rows.push({ by: "CMD " + JSON.stringify(b.cmd || []), size: 0, empty: true, created: layers[layers.length - 1].created });
    return rows.filter(function (r) { return !(r.empty && /^# debian|^ADD alpine/.test(r.by)); });
  }
  // An image object (what the daemon stores). Registry definitions and builds both produce these.
  function makeImage(o) {
    var size = o.layers.reduce(function (s, L) { return s + L.size; }, 0);
    var id = o.id || sha("image:" + o.layers.map(function (L) { return L.id; }).join(",") + JSON.stringify(o.cfg));
    return { id: id, layers: o.layers, cfg: o.cfg, history: o.history, created: o.created || NOW - 10 * DAY, size: size, os: o.os || "", tags: [], digests: {}, built: !!o.built, stages: o.stages || null, buildArgs: o.buildArgs || null };
  }
  function imageFromBase(name) {
    var b = BASES[name]; if (!b) return null;
    var layers = b.layers.map(function (k) { return LAYERS[k]; });
    return makeImage({ id: sha("base-image:" + name), layers: layers, cfg: cfgOf(b), history: historyOf(b, layers), created: b.created || layers[layers.length - 1].created, os: b.os });
  }
  Dk.makeImage = makeImage; Dk.imageFromBase = imageFromBase; Dk.cfgOf = cfgOf;

  /* ---------------- registries. reg.repos["library/python"].tags["3.12-slim"] = digest; manifests[digest] = image */
  function newRegistries() {
    var regs = { "docker.io": { name: "docker.io", public: true, repos: {}, manifests: {} } };
    Object.keys(BASES).forEach(function (n) {
      var img = imageFromBase(n), p = parseRef(n), dg = sha("manifest:" + n);
      var reg = regs["docker.io"], r = reg.repos[p.repo] = reg.repos[p.repo] || { tags: {}, pushes: [] };
      reg.manifests[dg] = img; r.tags[p.tag] = dg;
      (BASES[n].aliases || []).forEach(function (a) { var pa = parseRef(a); var ra = reg.repos[pa.repo] = reg.repos[pa.repo] || { tags: {}, pushes: [] }; ra.tags[pa.tag] = dg; });
    });
    regs["ghcr.io"] = { name: "ghcr.io", public: false, custom: true, repos: {}, manifests: {}, sigs: {}, atts: {} };
    regs["registry.kestrel.io"] = { name: "registry.kestrel.io", public: false, repos: {}, manifests: {}, users: { dev: { token: Dk.registryToken(), namespaces: ["dev", "kestrel"], push: ["dev"] } } };
    return regs;
  }
  // Put an image in a registry under repo:tag (lab setup and docker push both use this).
  function publish(regs, ref, img) {
    var p = parseRef(ref), reg = regs[p.registry];
    if (!reg) reg = regs[p.registry] = { name: p.registry, public: true, repos: {}, manifests: {} };
    var dg = sha("manifest:" + img.id + ":" + p.registry);
    reg.manifests[dg] = img;
    var r = reg.repos[p.repo] = reg.repos[p.repo] || { tags: {}, pushes: [] };
    r.tags[p.tag || "latest"] = dg;
    return dg;
  }
  Dk.newRegistries = newRegistries; Dk.publish = publish;
  // The token in ~/.kestrel/registry-token, assembled from parts so the repo never holds a token-shaped string.
  Dk.registryToken = function () { return ["kcr", "dev", hex("kestrel-registry-dev", 24)].join("_"); };

  /* ---------------- package indexes */
  // pip: name -> {versions: {ver: {deps: [[name, ver]], size}}, latest, mod (import name)}
  var PIP = {};
  function pkg(name, mod, latest, versions) { PIP[name] = { name: name, mod: mod, latest: latest, versions: versions }; }
  pkg("flask", "flask", "3.1.1", { "2.2.2": { deps: [["werkzeug", "2.2.2"], ["jinja2", "3.1.2"], ["itsdangerous", "2.1.2"], ["click", "8.1.3"]], size: 0.3 * MB }, "3.0.3": { deps: [["werkzeug", "3.0.6"], ["jinja2", "3.1.6"], ["itsdangerous", "2.2.0"], ["click", "8.1.8"], ["blinker", "1.9.0"]], size: 0.3 * MB }, "3.1.1": { deps: [["werkzeug", "3.1.3"], ["jinja2", "3.1.6"], ["itsdangerous", "2.2.0"], ["click", "8.1.8"], ["blinker", "1.9.0"]], size: 0.3 * MB } });
  pkg("werkzeug", "werkzeug", "3.1.3", { "2.2.2": { deps: [["markupsafe", "2.1.1"]], size: 0.9 * MB }, "3.0.6": { deps: [["markupsafe", "3.0.2"]], size: 0.9 * MB }, "3.1.3": { deps: [["markupsafe", "3.0.2"]], size: 0.9 * MB } });
  pkg("jinja2", "jinja2", "3.1.6", { "3.1.2": { deps: [["markupsafe", "2.1.1"]], size: 0.6 * MB }, "3.1.6": { deps: [["markupsafe", "3.0.2"]], size: 0.6 * MB } });
  pkg("markupsafe", "markupsafe", "3.0.2", { "2.1.1": { deps: [], size: 0.05 * MB }, "3.0.2": { deps: [], size: 0.05 * MB } });
  pkg("itsdangerous", "itsdangerous", "2.2.0", { "2.1.2": { deps: [], size: 0.06 * MB }, "2.2.0": { deps: [], size: 0.06 * MB } });
  pkg("click", "click", "8.1.8", { "8.1.3": { deps: [], size: 0.4 * MB }, "8.1.8": { deps: [], size: 0.4 * MB } });
  pkg("blinker", "blinker", "1.9.0", { "1.9.0": { deps: [], size: 0.03 * MB } });
  pkg("gunicorn", "gunicorn", "23.0.0", { "20.1.0": { deps: [], size: 0.4 * MB }, "21.2.0": { deps: [["packaging", "24.2"]], size: 0.4 * MB }, "23.0.0": { deps: [["packaging", "24.2"]], size: 0.4 * MB } });
  pkg("packaging", "packaging", "24.2", { "24.2": { deps: [], size: 0.2 * MB } });
  pkg("requests", "requests", "2.32.4", { "2.25.0": { deps: [["urllib3", "1.26.5"], ["idna", "2.10"], ["chardet", "3.0.4"], ["certifi", "2020.12.5"]], size: 0.2 * MB }, "2.32.4": { deps: [["urllib3", "2.5.0"], ["idna", "3.10"], ["charset-normalizer", "3.4.2"], ["certifi", "2025.6.15"]], size: 0.2 * MB } });
  pkg("urllib3", "urllib3", "2.5.0", { "1.26.5": { deps: [], size: 0.5 * MB }, "2.5.0": { deps: [], size: 0.5 * MB } });
  pkg("idna", "idna", "3.10", { "2.10": { deps: [], size: 0.3 * MB }, "3.10": { deps: [], size: 0.3 * MB } });
  pkg("chardet", "chardet", "3.0.4", { "3.0.4": { deps: [], size: 0.9 * MB } });
  pkg("charset-normalizer", "charset_normalizer", "3.4.2", { "3.4.2": { deps: [], size: 0.6 * MB } });
  pkg("certifi", "certifi", "2025.6.15", { "2020.12.5": { deps: [], size: 0.3 * MB }, "2025.6.15": { deps: [], size: 0.3 * MB } });
  pkg("redis", "redis", "5.2.1", { "5.2.1": { deps: [], size: 1.2 * MB } });
  pkg("psycopg", "psycopg", "3.2.9", { "3.2.9": { deps: [["typing-extensions", "4.12.2"]], size: 0.8 * MB } });
  pkg("psycopg-binary", "psycopg_binary", "3.2.9", { "3.2.9": { deps: [], size: 12.4 * MB } });
  pkg("typing-extensions", "typing_extensions", "4.12.2", { "4.12.2": { deps: [], size: 0.1 * MB } });
  pkg("pyyaml", "yaml", "6.0.2", { "5.3.1": { deps: [], size: 0.7 * MB }, "6.0.2": { deps: [], size: 0.7 * MB } });
  pkg("pytest", "pytest", "8.3.3", { "8.3.3": { deps: [["packaging", "24.2"]], size: 1.4 * MB } });
  Dk.PIP = PIP;
  // Package name normalisation (PEP 503) and the import names that come from them.
  Dk.pipNorm = function (n) { return String(n).toLowerCase().replace(/[-_.]+/g, "-"); };

  // apt (Debian/Ubuntu images) and apk (Alpine): name -> {ver, size, bins: [[path, impl]], deps}
  var APT = {
    curl: { ver: "7.88.1-10+deb12u8", size: 1.1 * MB, bins: [["/usr/bin/curl", "dkcurl"]], deps: ["libcurl4"], rec: ["ca-certificates"] },
    libcurl4: { ver: "7.88.1-10+deb12u8", size: 2.6 * MB, bins: [] },
    wget: { ver: "1.21.3-1+b2", size: 3.6 * MB, bins: [["/usr/bin/wget", "dkwget"]] },
    procps: { ver: "2:4.0.2-3", size: 2.2 * MB, bins: [["/usr/bin/ps", "dkps"], ["/usr/bin/top", "dkps"]] },
    "ca-certificates": { ver: "20230311", size: 0.4 * MB, bins: [] },
    "build-essential": { ver: "12.9", size: 228 * MB, bins: [["/usr/bin/gcc", "dkgcc"], ["/usr/bin/make", "dkmake"]], deps: ["gcc-12", "make", "libc6-dev"] },
    "gcc-12": { ver: "12.2.0-14", size: 0, bins: [] }, make: { ver: "4.3-4.1", size: 0, bins: [] }, "libc6-dev": { ver: "2.36-9+deb12u9", size: 0, bins: [] },
    "libpq-dev": { ver: "15.8-0+deb12u1", size: 9.8 * MB, bins: [["/usr/bin/pg_config", "dkpgconfig"]] },
    git: { ver: "1:2.39.5-0+deb12u1", size: 31 * MB, bins: [["/usr/bin/git", "dkgit"]] },
    "iputils-ping": { ver: "3:20221126-1+deb12u1", size: 0.2 * MB, bins: [["/usr/bin/ping", "dkping"]] },
    tini: { ver: "0.19.0-1", size: 0.8 * MB, bins: [["/usr/bin/tini", "dktini"]] },
    vim: { ver: "2:9.0.1378-2", size: 38 * MB, bins: [["/usr/bin/vim", "vim"]], rec: ["vim-runtime"] }, "vim-runtime": { ver: "2:9.0.1378-2", size: 33 * MB, bins: [] }
  };
  var APK = {
    curl: { ver: "8.11.0-r2", size: 0.6 * MB, bins: [["/usr/bin/curl", "dkcurl"]] },
    bash: { ver: "5.2.26-r0", size: 1.6 * MB, bins: [["/bin/bash", "bash"]] },
    tini: { ver: "0.19.0-r3", size: 0.04 * MB, bins: [["/sbin/tini", "dktini"]] },
    "build-base": { ver: "0.5-r3", size: 180 * MB, bins: [["/usr/bin/gcc", "dkgcc"], ["/usr/bin/make", "dkmake"]] },
    "postgresql-dev": { ver: "16.6-r0", size: 18 * MB, bins: [["/usr/bin/pg_config", "dkpgconfig"]] },
    git: { ver: "2.45.2-r0", size: 14 * MB, bins: [["/usr/bin/git", "dkgit"]] },
    procps: { ver: "4.0.4-r0", size: 0.6 * MB, bins: [["/bin/ps", "dkps"]] }
  };
  Dk.APT = APT; Dk.APK = APK;

  // npm packages for the status page (sizes are what lands in node_modules)
  Dk.NPM = {
    vite: { ver: "5.4.10", size: 41 * MB, bin: "vite" }, react: { ver: "18.3.1", size: 0.3 * MB }, "react-dom": { ver: "18.3.1", size: 4.5 * MB },
    "@vitejs/plugin-react": { ver: "4.3.3", size: 120 * MB }, express: { ver: "4.21.1", size: 2.2 * MB }, typescript: { ver: "5.6.3", size: 23 * MB }, eslint: { ver: "9.14.0", size: 18 * MB }
  };

  /* ---------------- file-map helpers (layers are maps of absolute paths) */
  function parentDirs(p) { var out = [], s = p.split("/").filter(Boolean); for (var i = 1; i < s.length; i++) out.push("/" + s.slice(0, i).join("/")); return out; }
  // Merge layers, top wins; whiteouts delete a path and everything under it.
  function merge(layers) {
    var m = {};
    layers.forEach(function (L) {
      Object.keys(L.files).sort().forEach(function (p) {
        var e = L.files[p];
        if (e.t === "wh") { delete m[p]; var pre = p + "/"; Object.keys(m).forEach(function (q) { if (q.indexOf(pre) === 0) delete m[q]; }); return; }
        if (e.t === "d" && m[p] && m[p].t === "d") { m[p] = e; return; }
        if (e.t !== "d" && m[p] && m[p].t === "d") { var pre2 = p + "/"; Object.keys(m).forEach(function (q) { if (q.indexOf(pre2) === 0) delete m[q]; }); }
        m[p] = e;
      });
    });
    return m;
  }
  function entrySize(e) { return e.t === "f" ? (e.sz != null ? e.sz : e.c.length) : 0; }
  function mapSize(files) { return Object.keys(files).reduce(function (s, p) { return s + entrySize(files[p]); }, 0); }
  Dk.merge = merge; Dk.entrySize = entrySize; Dk.mapSize = mapSize; Dk.parentDirs = parentDirs;

  // Build a ShEngine file tree from a merged map.
  function treeFrom(map, mtime) {
    var rootN = S.dirNode(493, 0, 0, mtime);
    var paths = Object.keys(map).sort(function (a, b) { return a.split("/").length - b.split("/").length || (a < b ? -1 : 1); });
    paths.forEach(function (p) {
      if (p === "/") return;
      var e = map[p], segs = p.split("/").filter(Boolean), d = rootN;
      for (var i = 0; i < segs.length - 1; i++) {
        var c = d.children[segs[i]];
        if (!c || c.type !== "d") c = d.children[segs[i]] = S.dirNode(493, 0, 0, mtime);
        d = c;
      }
      var name = segs[segs.length - 1];
      if (e.t === "d") { var ex = d.children[name]; if (ex && ex.type === "d") { ex.mode = e.m; ex.uid = e.u || 0; ex.gid = e.g || 0; } else d.children[name] = S.dirNode(e.m, e.u || 0, e.g || 0, e.mt || mtime); }
      else if (e.t === "l") d.children[name] = S.linkNode(e.to);
      else { var n = S.fileNode(e.c, e.m, e.u || 0, e.g || 0, e.mt || mtime); if (e.sz != null) n.size = e.sz; if (e.special) n.special = e.special; d.children[name] = n; }
    });
    return rootN;
  }
  // The other way: a tree (or a subtree at prefix) back to a map.
  function mapFrom(node, prefix, out) {
    out = out || {};
    var base = prefix === "/" ? "" : prefix;
    Object.keys(node.children || {}).forEach(function (k) {
      var n = node.children[k], p = base + "/" + k;
      if (n.type === "d") { out[p] = { t: "d", m: n.mode, u: n.uid, g: n.gid }; mapFrom(n, p, out); }
      else if (n.type === "l") out[p] = { t: "l", to: n.target };
      else { var e = { t: "f", c: n.content, m: n.mode, u: n.uid, g: n.gid }; if (n.size != null) e.sz = n.size; if (n.special) e.special = n.special; out[p] = e; }
    });
    return out;
  }
  function sameEntry(a, b) { return a.t === b.t && a.c === b.c && a.m === b.m && (a.u || 0) === (b.u || 0) && (a.g || 0) === (b.g || 0) && a.to === b.to && a.sz === b.sz; }
  // What changed between two maps, as a layer's file map (with whiteouts for deletions).
  function diff(before, after) {
    var ch = {};
    Object.keys(after).forEach(function (p) { if (!before[p] || !sameEntry(before[p], after[p])) ch[p] = after[p]; });
    Object.keys(before).forEach(function (p) {
      if (after[p]) return;
      var par = parentDirs(p);
      for (var i = 0; i < par.length; i++) if (!after[par[i]] && before[par[i]]) return; // a parent is already whited out
      ch[p] = { t: "wh" };
    });
    return ch;
  }
  Dk.treeFrom = treeFrom; Dk.mapFrom = mapFrom; Dk.diff = diff; Dk.sameEntry = sameEntry;
  Dk.MB = MB; Dk.KB = KB; Dk.PATHV = PATHV;
})(typeof window !== "undefined" ? window : globalThis);
