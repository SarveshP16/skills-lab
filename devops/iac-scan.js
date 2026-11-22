/* sudo learn — DevOps Module 3: scanning infrastructure as code. A simulated Checkov 3.2 for Terraform (a set of
   real CKV_AWS/CKV2_AWS checks evaluated on the HCL, `#checkov:skip=ID:reason` suppressions, cli/compact/json/
   sarif/github_failed_only output, --check/--skip-check/--soft-fail) and ansible-lint 24 (fqcn, name, no-changed-
   when, command-instead-of-module, risky-file-permissions, yaml[truthy], package-latest, risky-shell-pipe,
   no-free-form; `# noqa` and .ansible-lint skip_list; production profile summary). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, IAC = root.IAC, Y = root.DevYaml;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  var UNK = IAC.UNK;

  /* ================================================================== a lenient evaluator for static analysis */
  function staticEnv(cfg) {
    var vars = {}; keys(cfg.vars).forEach(function (k) { var d = cfg.vars[k].def; try { vars[k] = d ? IAC.evalExpr(d, { resolve: function () { return UNK; } }) : UNK; } catch (e) { vars[k] = UNK; } });
    var memo = {}, busy = {};
    function resolve(n) {
      if (n === "var") return vars;
      if (n === "local") { var l = {}; keys(cfg.locals).forEach(function (k) { Object.defineProperty(l, k, { enumerable: true, get: function () { if (k in memo) return memo[k]; if (busy[k]) return UNK; busy[k] = 1; try { memo[k] = IAC.evalExpr(cfg.locals[k].e, ctx); } catch (e) { memo[k] = UNK; } delete busy[k]; return memo[k]; } }); }); return l; }
      return new Proxy({}, { get: function (t, k) { if (k === "__sensAttrs" || k === "__kind") return undefined; return new Proxy({ __ref: n + "." + String(k) }, { get: function (t2, k2) { if (k2 === "__ref") return t2.__ref; if (k2 === "__sensAttrs" || k2 === "__kind") return undefined; return { __ref: n + "." + String(k) + "." + String(k2) }; }, has: function () { return true; } }); }, has: function () { return true; } });
    }
    var ctx = { resolve: resolve, at: null };
    return function (e) { if (!e) return undefined; try { return IAC.evalExpr(e, ctx); } catch (x) { return UNK; } };
  }
  function attr(r, ev, name) { return r.b.attrs[name] ? ev(r.b.attrs[name]) : undefined; }
  function blocks(r, name) { return r.b.blocks.filter(function (b) { return b.type === name; }); }
  function battr(b, ev, name) { return b && b.attrs[name] ? ev(b.attrs[name]) : undefined; }
  // does resource s reference resource r (e.g. aws_s3_bucket_versioning.bucket = aws_s3_bucket.notes.id)?
  function refersTo(s, r, field) { var e = s.b.attrs[field || "bucket"]; if (!e) return false; return IAC.refs(e).some(function (x) { return x[0] === r.type && x[1] === r.name; }) || (r.b.attrs.bucket && e.k === "lit" && r.b.attrs.bucket.k === "lit" && e.v === r.b.attrs.bucket.v); }
  function pick(cfg, type) { return cfg.resources.filter(function (x) { return x.mode === "managed" && x.type === type; }); }
  function openTo(ev, b) { var cidr = battr(b, ev, "cidr_blocks"); return Array.isArray(cidr) && cidr.indexOf("0.0.0.0/0") >= 0; }
  function covers(ev, b, port) { var f = battr(b, ev, "from_port"), t = battr(b, ev, "to_port"), p = battr(b, ev, "protocol"); if (p === "-1" || p === -1) return true; return +f <= port && +t >= port; }
  var DOCS = "https://docs.prismacloud.io/en/enterprise-edition/policy-reference/aws-policies/";
  var CHECKS = [
    { id: "CKV_AWS_18", t: "aws_s3_bucket", n: "Ensure the S3 bucket has access logging enabled", g: "s3-policies/s3-13-enable-logging", f: function (r, ev, cfg) { return pick(cfg, "aws_s3_bucket_logging").some(function (s) { return refersTo(s, r); }); } },
    { id: "CKV_AWS_21", t: "aws_s3_bucket", n: "Ensure all data stored in the S3 bucket have versioning enabled", g: "s3-policies/s3-16-enable-versioning", f: function (r, ev, cfg) { return pick(cfg, "aws_s3_bucket_versioning").some(function (s) { var vc = blocks(s, "versioning_configuration")[0]; return refersTo(s, r) && battr(vc, ev, "status") === "Enabled"; }); } },
    { id: "CKV_AWS_145", t: "aws_s3_bucket", n: "Ensure that S3 buckets are encrypted with KMS by default", g: "s3-policies/ensure-that-s3-buckets-are-encrypted-with-kms-by-default", f: function (r, ev, cfg) { return pick(cfg, "aws_s3_bucket_server_side_encryption_configuration").some(function (s) { if (!refersTo(s, r)) return false; return s.b.blocks.some(function (rb) { return rb.type === "rule" && rb.blocks.some(function (d) { return d.type === "apply_server_side_encryption_by_default" && battr(d, ev, "sse_algorithm") === "aws:kms"; }); }); }); } },
    { id: "CKV2_AWS_6", t: "aws_s3_bucket", n: "Ensure that S3 bucket has a Public Access block", g: "s3-policies/s3-bucket-should-have-public-access-blocks-defaults-to-false-if-the-public-access-block-is-not-attached", f: function (r, ev, cfg) { return pick(cfg, "aws_s3_bucket_public_access_block").some(function (s) { return refersTo(s, r) && ["block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"].every(function (k) { return attr(s, ev, k) === true; }); }); } },
    { id: "CKV2_AWS_62", t: "aws_s3_bucket", n: "Ensure S3 buckets should have event notifications enabled", g: "s3-policies/bc-aws-2-62", f: function () { return false; } },
    { id: "CKV_AWS_144", t: "aws_s3_bucket", n: "Ensure that S3 bucket has cross-region replication enabled", g: "s3-policies/ensure-that-s3-bucket-has-cross-region-replication-enabled", f: function () { return false; } },
    { id: "CKV2_AWS_61", t: "aws_s3_bucket", n: "Ensure that an S3 bucket has a lifecycle configuration", g: "s3-policies/bc-aws-2-61", f: function () { return false; } },
    { id: "CKV_AWS_53", t: "aws_s3_bucket_public_access_block", n: "Ensure S3 bucket has block public ACLS enabled", g: "s3-policies/bc-aws-s3-19", f: function (r, ev) { return attr(r, ev, "block_public_acls") === true; } },
    { id: "CKV_AWS_54", t: "aws_s3_bucket_public_access_block", n: "Ensure S3 bucket has block public policy enabled", g: "s3-policies/bc-aws-s3-20", f: function (r, ev) { return attr(r, ev, "block_public_policy") === true; } },
    { id: "CKV_AWS_55", t: "aws_s3_bucket_public_access_block", n: "Ensure S3 bucket has ignore public ACLs enabled", g: "s3-policies/bc-aws-s3-21", f: function (r, ev) { return attr(r, ev, "ignore_public_acls") === true; } },
    { id: "CKV_AWS_56", t: "aws_s3_bucket_public_access_block", n: "Ensure S3 bucket has 'restrict_public_buckets' enabled", g: "s3-policies/bc-aws-s3-22", f: function (r, ev) { return attr(r, ev, "restrict_public_buckets") === true; } },
    { id: "CKV_AWS_24", t: "aws_security_group", n: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 22", g: "networking-policies/networking-1-port-security", f: function (r, ev) { return !blocks(r, "ingress").some(function (b) { return openTo(ev, b) && covers(ev, b, 22); }); } },
    { id: "CKV_AWS_25", t: "aws_security_group", n: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 3389", g: "networking-policies/networking-2", f: function (r, ev) { return !blocks(r, "ingress").some(function (b) { return openTo(ev, b) && covers(ev, b, 3389); }); } },
    { id: "CKV_AWS_260", t: "aws_security_group", n: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 80", g: "networking-policies/ensure-aws-security-groups-do-not-allow-ingress-from-00000-to-port-80", f: function (r, ev) { return !blocks(r, "ingress").some(function (b) { return openTo(ev, b) && covers(ev, b, 80); }); } },
    { id: "CKV_AWS_23", t: "aws_security_group", n: "Ensure every security group and rule has a description", g: "networking-policies/networking-31", f: function (r, ev) { var d = attr(r, ev, "description"); if (!d || d === UNK) return false; return blocks(r, "ingress").concat(blocks(r, "egress")).every(function (b) { return !!battr(b, ev, "description"); }); } },
    { id: "CKV_AWS_382", t: "aws_security_group", n: "Ensure no security groups allow egress from 0.0.0.0:0 to port -1", g: "networking-policies/bc-aws-382", f: function (r, ev) { return !blocks(r, "egress").some(function (b) { return openTo(ev, b) && String(battr(b, ev, "protocol")) === "-1"; }); } },
    { id: "CKV_AWS_24", t: "aws_vpc_security_group_ingress_rule", n: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 22", g: "networking-policies/networking-1-port-security", f: function (r, ev) { var c = attr(r, ev, "cidr_ipv4"), f = attr(r, ev, "from_port"), t = attr(r, ev, "to_port"), p = attr(r, ev, "ip_protocol"); return !(c === "0.0.0.0/0" && (String(p) === "-1" || (+f <= 22 && +t >= 22))); } },
    { id: "CKV_AWS_79", t: "aws_instance", n: "Ensure Instance Metadata Service Version 1 is not enabled", g: "general-policies/bc-aws-general-31", f: function (r, ev) { var m = blocks(r, "metadata_options")[0]; return !!m && (battr(m, ev, "http_tokens") === "required" || battr(m, ev, "http_endpoint") === "disabled"); } },
    { id: "CKV_AWS_8", t: "aws_instance", n: "Ensure all data stored in the Launch configuration or instance Elastic Blocks Store is securely encrypted", g: "general-policies/general-13", f: function (r, ev) { var rb = blocks(r, "root_block_device")[0]; return !!rb && battr(rb, ev, "encrypted") === true; } },
    { id: "CKV_AWS_126", t: "aws_instance", n: "Ensure that detailed monitoring is enabled for EC2 instances", g: "logging-policies/ensure-that-detailed-monitoring-is-enabled-for-ec2-instances", f: function (r, ev) { return attr(r, ev, "monitoring") === true; } },
    { id: "CKV_AWS_135", t: "aws_instance", n: "Ensure that EC2 is EBS optimized", g: "general-policies/ensure-that-ec2-is-ebs-optimized", f: function (r, ev) { return attr(r, ev, "ebs_optimized") === true; } },
    { id: "CKV_AWS_88", t: "aws_instance", n: "EC2 instance should not have public IP.", g: "public-policies/public-12", f: function (r, ev) { return attr(r, ev, "associate_public_ip_address") !== true; } },
    { id: "CKV2_AWS_41", t: "aws_instance", n: "Ensure an IAM role is attached to EC2 instance", g: "iam-policies/ensure-an-iam-role-is-attached-to-ec2-instance", f: function (r) { return !!r.b.attrs.iam_instance_profile; } },
    { id: "CKV_AWS_337", t: "aws_ssm_parameter", n: "Ensure SSM parameters are using KMS CMK", g: "general-policies/bc-aws-337", f: function (r, ev) { return !!r.b.attrs.key_id; } },
    { id: "CKV2_AWS_34", t: "aws_ssm_parameter", n: "AWS SSM Parameter should be Encrypted", g: "general-policies/bc-aws-2-34", f: function (r, ev) { return attr(r, ev, "type") === "SecureString"; } },
    { id: "CKV2_AWS_11", t: "aws_vpc", n: "Ensure VPC flow logging is enabled in all VPCs", g: "logging-policies/logging-9-enable-vpc-flow-logging", f: function (r, ev, cfg) { return pick(cfg, "aws_flow_log").some(function (s) { return refersTo(s, r, "vpc_id"); }); } },
    { id: "CKV2_AWS_12", t: "aws_vpc", n: "Ensure the default security group of every VPC restricts all traffic", g: "networking-policies/networking-4", f: function (r, ev, cfg) { return cfg.resources.some(function (s) { return s.type === "aws_default_security_group" && refersTo(s, r, "vpc_id"); }); } },
    { id: "CKV_AWS_28", t: "aws_dynamodb_table", n: "Ensure DynamoDB point in time recovery (backup) is enabled", g: "general-policies/general-6", f: function (r, ev) { var p = blocks(r, "point_in_time_recovery")[0]; return !!p && battr(p, ev, "enabled") === true; } },
    { id: "CKV_AWS_119", t: "aws_dynamodb_table", n: "Ensure DynamoDB Tables are encrypted using a KMS Customer Managed CMK", g: "general-policies/ensure-that-dynamodb-tables-are-encrypted", f: function (r, ev) { var p = blocks(r, "server_side_encryption")[0]; return !!p && battr(p, ev, "enabled") === true && !!p.attrs.kms_key_arn; } },
    { id: "CKV_AWS_7", t: "aws_kms_key", n: "Ensure rotation for customer created CMKs is enabled", g: "logging-policies/logging-8", f: function (r, ev) { return attr(r, ev, "enable_key_rotation") === true; } },
    { id: "CKV_AWS_274", t: "aws_iam_role_policy_attachment", n: "Disallow IAM roles, users, and groups from using the AWS AdministratorAccess policy", g: "iam-policies/bc-aws-274", f: function (r, ev) { return !/AdministratorAccess$/.test(String(attr(r, ev, "policy_arn"))); } },
    { id: "CKV_AWS_358", t: "aws_iam_role", n: "Ensure AWS GitHub Actions OIDC authorization policies only allow safe claims", g: "iam-policies/bc-aws-358", f: function (r, ev, cfg) {
      var pol = attr(r, ev, "assume_role_policy"), txt = typeof pol === "string" ? pol : "";
      if (!txt) { var docs = cfg.resources.filter(function (d) { return d.mode === "data" && d.type === "aws_iam_policy_document" && IAC.refs(r.b.attrs.assume_role_policy || { k: "lit" }).some(function (x) { return x[1] === "aws_iam_policy_document" && x[2] === d.name; }); }); if (!docs.length) return true; txt = docs.map(function (d) { return JSON.stringify(d.b.blocks.map(function (s) { return s.blocks.map(function (c) { return { test: battr(c, ev, "test"), variable: battr(c, ev, "variable"), values: battr(c, ev, "values") }; }); })); }).join(" "); }
      if (!/token\.actions\.githubusercontent\.com/.test(txt)) return true;
      var subs = (txt.match(/"repo:[^"]*"/g) || []).map(function (x) { return x.replace(/"/g, ""); });
      if (!/token\.actions\.githubusercontent\.com:sub/.test(txt)) return false;
      return subs.length > 0 && subs.every(function (s) { return /^repo:[\w.-]+\/[\w.-]+:/.test(s) && !/^repo:[^/]*\*|^repo:[\w.-]+\/\*/.test(s); });
    } },
    { id: "CKV_AWS_355", t: "aws_iam_role_policy", n: "Ensure no IAM policies documents allow \"*\" as a statement's resource for restrictable actions", g: "iam-policies/bc-aws-355", f: function (r, ev) { var p = String(attr(r, ev, "policy") || ""); try { var d = JSON.parse(p); return ![].concat(d.Statement || []).some(function (s) { return s.Effect !== "Deny" && [].concat(s.Resource || []).indexOf("*") >= 0 && [].concat(s.Action || []).some(function (a) { return /:\*$|^\*$/.test(a) || !/^(s3:ListAllMyBuckets|sts:GetCallerIdentity|ec2:Describe)/.test(a); }); }); } catch (e) { return !/"Resource"\s*:\s*"\*"/.test(p); } } }
  ];
  IAC.CHECKOV = CHECKS;
  function skipsOf(r, src) {
    var lines = String(src).split("\n").slice(r.b.line - 1, r.b.end), out2 = {};
    lines.forEach(function (l) { var m = /#\s*checkov:skip=([\w_]+)(?::(.*))?$/.exec(l); if (m) out2[m[1]] = (m[2] || "").trim(); });
    return out2;
  }
  function scanTf(fs, dir, o) {
    var cfg = IAC.loadConfig(fs, dir), results = [], ev = staticEnv(cfg);
    cfg.resources.forEach(function (r) {
      if (r.mode !== "managed") return;
      var skips = skipsOf(r, cfg.files[r.file]);
      CHECKS.forEach(function (c) {
        if (c.t !== r.type) return;
        if (o.check && o.check.indexOf(c.id) < 0) return;
        if (o.skip && o.skip.indexOf(c.id) >= 0) return;
        var res = { id: c.id, name: c.n, resource: r.type + "." + r.name, file: "/" + r.file, lines: [r.b.line, r.b.end], guide: DOCS + c.g, src: cfg.files[r.file], r: r };
        if (c.id in skips) { res.result = "SKIPPED"; res.reason = skips[c.id] || "No comment provided"; }
        else { var ok; try { ok = c.f(r, ev, cfg); } catch (e) { ok = true; } res.result = ok ? "PASSED" : "FAILED"; }
        results.push(res);
      });
    });
    return { cfg: cfg, results: results };
  }
  IAC.checkovScan = scanTf;
  var BANNER = "\n       _               _\n   ___| |__   ___  ___| | _______   __\n  / __| '_ \\ / _ \\/ __| |/ / _ \\ \\ / /\n | (__| | | |  __/ (__|   < (_) \\ V /\n  \\___|_| |_|\\___|\\___|_|\\_\\___/ \\_/\n\nBy Prisma Cloud | version: 3.2.290 \n\n";
  CMDS.checkov = function (args, io, sess) {
    var a = args.slice(1), o = { dirs: [], files: [], check: null, skip: null, output: "cli" };
    for (var i = 0; i < a.length; i++) {
      var x = a[i], nx = function () { return a[++i]; };
      if (x === "-d" || x === "--directory") o.dirs.push(nx()); else if (x === "-f" || x === "--file") o.files.push(nx());
      else if (x === "--check" || x === "-c") o.check = nx().split(","); else if (x === "--skip-check") o.skip = nx().split(",");
      else if (x === "-o" || x === "--output") o.output = nx(); else if (x === "--compact") o.compact = true; else if (x === "--quiet") o.quiet = true; else if (x === "--soft-fail") o.soft = true;
      else if (x === "--framework") o.framework = nx(); else if (x === "--version" || x === "-v") { out(io, "3.2.290\n"); return 0; } else if (x === "--download-external-modules") nx();
      else if (/^--/.test(x)) { var eq = x.indexOf("="); if (eq > 0) { var k = x.slice(2, eq), v = x.slice(eq + 1); if (k === "check") o.check = v.split(","); else if (k === "skip-check") o.skip = v.split(","); else if (k === "output") o.output = v; else if (k === "framework") o.framework = v; } }
    }
    if (!o.dirs.length && !o.files.length) { errl(io, "usage: checkov [-h] [-v] [--support] [-d DIRECTORY] [-f FILE] [--skip-path SKIP_PATH] ...\ncheckov: error: one of the arguments -d/--directory -f/--file is required (or use --docker-image / --repo-id)"); return 2; }
    if (o.framework && !/terraform|all/.test(o.framework)) { out(io, BANNER); return 0; }
    var fs = { read: function (p) { var r = S.readFile(sess, p); return r.error ? null : r.content; }, list: function (d) { var n = root.Dk.fsNode(sess.sys, d); return n && n.type === "d" ? keys(n.children).sort() : null; }, isDir: function (d) { var n = root.Dk.fsNode(sess.sys, d); return !!n && n.type === "d"; } };
    var dirs = o.dirs.map(function (d) { return S.normAbs(d.charAt(0) === "/" ? d : sess.cwd + "/" + d); });
    // -d also scans subfolders that hold .tf files (modules)
    var all = [];
    dirs.forEach(function (d) { (function walk(p) { var l = fs.list(p) || []; if (l.some(function (f) { return /\.tf$/.test(f); })) all.push(p); l.forEach(function (f) { if (f !== ".terraform" && f.charAt(0) !== "." && fs.isDir(p + "/" + f)) walk(p + "/" + f); }); })(d); });
    o.files.forEach(function (f) { all.push(S.normAbs((f.charAt(0) === "/" ? f : sess.cwd + "/" + f)).replace(/\/[^/]*$/, "")); });
    var results = [];
    all.forEach(function (d) { var r; try { r = scanTf(fs, d, o); } catch (e) { if (e instanceof IAC.TfErr) return; throw e; } var rel = d === dirs[0] ? "" : d.replace((dirs[0] || sess.cwd) + "/", "") + "/"; r.results.forEach(function (x) { if (o.files.length && !o.files.some(function (f) { return f.split("/").pop() === x.file.slice(1); })) return; x.file = "/" + rel + x.file.slice(1); results.push(x); }); });
    var P = results.filter(function (r) { return r.result === "PASSED"; }), F = results.filter(function (r) { return r.result === "FAILED"; }), K = results.filter(function (r) { return r.result === "SKIPPED"; });
    IAC.ev(sess.sys, { kind: "checkov", failed: F.length, passed: P.length, skipped: K.length, dir: dirs[0] || sess.cwd, ids: F.map(function (f) { return f.id + " " + f.resource; }) });
    var code = F.length && !o.soft ? 1 : 0;
    if (o.output === "json") { out(io, JSON.stringify({ check_type: "terraform", results: { passed_checks: P.map(js), failed_checks: F.map(js), skipped_checks: K.map(js), parsing_errors: [] }, summary: { passed: P.length, failed: F.length, skipped: K.length, parsing_errors: 0, resource_count: results.map(function (r) { return r.resource; }).filter(function (x, i, l) { return l.indexOf(x) === i; }).length, checkov_version: "3.2.290" } }, null, 4) + "\n"); return code; }
    if (o.output === "sarif") { out(io, JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "Checkov", version: "3.2.290" } }, results: F.map(function (f) { return { ruleId: f.id, level: "error", message: { text: f.name }, locations: [{ physicalLocation: { artifactLocation: { uri: f.file.slice(1) }, region: { startLine: f.lines[0], endLine: f.lines[1] } } }] }; }) }] }, null, 2) + "\n"); if (S.writeFile) S.writeFile(sess, sess.cwd + "/results.sarif", "", false); return code; }
    if (o.output === "github_failed_only") { out(io, "## terraform scan results:\n\n| check_id | file | resource | check_name | guideline |\n|----------|------|----------|------------|-----------|\n" + F.map(function (f) { return "| " + f.id + " | " + f.file + " | " + f.resource + " | " + f.name + " | " + f.guide + " |"; }).join("\n") + "\n\n---\n"); return code; }
    out(io, BANNER + (results.length ? "terraform scan results:\n\nPassed checks: " + P.length + ", Failed checks: " + F.length + ", Skipped checks: " + K.length + "\n\n" : ""));
    results.forEach(function (r) {
      if (o.quiet && r.result !== "FAILED") return;
      out(io, "Check: " + r.id + ": \"" + r.name + "\"\n\t" + r.result + " for resource: " + r.resource + "\n" + (r.result === "SKIPPED" ? "\tSuppress comment: " + r.reason + "\n" : "") + "\tFile: " + r.file + ":" + r.lines[0] + "-" + r.lines[1] + "\n\tGuide: " + r.guide + "\n");
      if (r.result === "FAILED" && !o.compact) { var src = String(r.src).split("\n"); out(io, "\n" + src.slice(r.lines[0] - 1, r.lines[1]).map(function (l, i) { return "\t\t" + (r.lines[0] + i) + " | " + l; }).join("\n") + "\n\n"); }
    });
    return code;
    function js(r) { return { check_id: r.id, check_name: r.name, check_result: { result: r.result, suppress_comment: r.reason }, file_path: r.file, file_line_range: r.lines, resource: r.resource, guideline: r.guide }; }
  };

  /* ================================================================== ansible-lint */
  var LINT = { "fqcn[action-core]": "formatting", "fqcn[action]": "formatting", "name[missing]": "idiom", "name[casing]": "idiom", "no-changed-when": "command-shell idempotency", "command-instead-of-module": "command-shell idiom", "risky-file-permissions": "unpredictability", "yaml[truthy]": "formatting yaml", "package-latest": "idempotency", "risky-shell-pipe": "command-shell", "no-free-form": "syntax risk", "syntax-check[specific]": "core unskippable" };
  var PROFILE = { "fqcn[action-core]": "production", "fqcn[action]": "production", "name[missing]": "basic", "name[casing]": "moderate", "no-changed-when": "shared", "command-instead-of-module": "basic", "risky-file-permissions": "safety", "yaml[truthy]": "basic", "package-latest": "safety", "risky-shell-pipe": "safety", "no-free-form": "basic" };
  var CMD_MODULES = { "apt-get": "apt", apt: "apt", yum: "yum", systemctl: "systemd", service: "service", "git": "git", chmod: "file", chown: "file", mkdir: "file", rm: "file", wget: "get_url", curl: "get_url", useradd: "user", ufw: "community.general.ufw" };
  function lintFile(text, file, skip) {
    var y; try { y = Y.parse(String(text).replace(/:\s*!vault\s*\|(-?)\s*\n/g, ": |$1\n")); } catch (e) { return [{ rule: "syntax-check[specific]", file: file, line: e.line || 1, msg: "Failed to load YAML file", detail: e.message || "" }]; }
    var lines = String(text).split("\n"), found = [], used = {};
    function lineOf(re, from) { for (var i = from || 0; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; }
    function noqa(i, rule) { var l = lines[i] || ""; var m = /#\s*noqa(?::\s*([\w\[\]\-, ]+))?/.exec(l); return !!m && (!m[1] || m[1].split(/[\s,]+/).indexOf(rule) >= 0 || m[1].split(/[\s,]+/).indexOf(rule.replace(/\[.*$/, "")) >= 0); }
    function add(rule, i, msg, detail) { if (skip.indexOf(rule) >= 0 || skip.indexOf(rule.replace(/\[.*$/, "")) >= 0 || noqa(i, rule)) return; found.push({ rule: rule, file: file, line: i + 1, msg: msg, detail: detail }); }
    lines.forEach(function (l, i) { var m = /^\s*[\w_]+:\s+(yes|no|Yes|No|True|False|on|off)\s*(#.*)?$/.exec(l); if (m) add("yaml[truthy]", i, "Truthy value should be one of [false, true]"); });
    var cursor = 0;
    function walkTasks(list) {
      (list || []).forEach(function (t) {
        if (!t || typeof t !== "object") return;
        if (t.block) { walkTasks(t.block); walkTasks(t.rescue); walkTasks(t.always); return; }
        var mod = keys(t).filter(function (k) { return IAC.ANSIBLE_TASK_KEYS.indexOf(k) < 0; })[0];
        if (!mod) return;
        var ln = t.name ? lineOf(new RegExp("name:\\s*[\"']?" + String(t.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), cursor) : lineOf(new RegExp("^\\s*-?\\s*" + mod.replace(/\./g, "\\.") + ":"), cursor);
        if (ln < 0) ln = cursor; cursor = ln + 1;
        var modLine = lineOf(new RegExp("^\\s*-?\\s*" + mod.replace(/\./g, "\\.") + ":"), ln); if (modLine < 0) modLine = ln;
        var short = mod.replace(/^ansible\.(builtin|legacy)\./, "");
        if (!t.name) add("name[missing]", ln, "All tasks should be named.", "Task/Handler: " + mod + (typeof t[mod] === "string" ? " " + t[mod] : ""));
        else if (/^[a-z]/.test(t.name)) add("name[casing]", ln, "All names should start with an uppercase letter.", "Task/Handler: " + t.name);
        if (IAC.ANSIBLE_MODULES[mod] && !/\./.test(mod)) add("fqcn[action-core]", modLine, "Use FQCN for builtin module actions (" + mod + ").", "Use `ansible.builtin." + mod + "` or `ansible.legacy." + mod + "` instead.");
        if (typeof t[mod] === "string" && /=/.test(t[mod]) && !/^(command|shell|raw)$/.test(short)) add("no-free-form", modLine, "Avoid using free-form when calling module actions. (" + mod + ")");
        if (/^(command|shell)$/.test(short)) {
          var cmd = typeof t[mod] === "string" ? t[mod] : (t[mod] && (t[mod].cmd || t[mod]._raw_params)) || "";
          var first = String(cmd).trim().split(/\s+/)[0].replace(/^sudo$/, String(cmd).trim().split(/\s+/)[1] || "");
          if (CMD_MODULES[first]) add("command-instead-of-module", modLine, first + " used in place of " + CMD_MODULES[first] + " module", "Task/Handler: " + (t.name || cmd));
          if (t.changed_when === undefined && !(t[mod] && (t[mod].creates || t[mod].removes)) && !t.register) add("no-changed-when", ln, "Commands should not change things if nothing needs doing.", "Task/Handler: " + (t.name || cmd));
          if (short === "shell" && /\|/.test(cmd) && !/pipefail/.test(cmd)) add("risky-shell-pipe", modLine, "Shells that use pipes should set the pipefail option.", "Task/Handler: " + (t.name || cmd));
        }
        if (/^(copy|template|file|lineinfile)$/.test(short) && t[mod] && typeof t[mod] === "object" && t[mod].mode === undefined && (short !== "file" || /directory|touch/.test(t[mod].state || ""))) add("risky-file-permissions", ln, "File permissions unset or incorrect.", "Task/Handler: " + (t.name || mod));
        if (/^(apt|package|yum|dnf)$/.test(short) && t[mod] && t[mod].state === "latest") add("package-latest", ln, "Package installs should not use latest.", "Task/Handler: " + (t.name || mod));
      });
    }
    if (Array.isArray(y)) {
      if (y.some(function (p) { return p && (p.hosts || p.import_playbook); })) y.forEach(function (p) { if (p) { walkTasks(p.pre_tasks); walkTasks(p.tasks); walkTasks(p.post_tasks); walkTasks(p.handlers); } });
      else walkTasks(y);
    }
    void used;
    return found;
  }
  IAC.ansibleLint = lintFile;
  CMDS.ansiblelint = function (args, io, sess) {
    var a = args.slice(1);
    if (a.indexOf("--version") >= 0) { out(io, "ansible-lint 24.10.0 using ansible-core:2.17.6 ansible-compat:24.10.0 ruamel-yaml:0.18.6 ruamel-yaml-clib:0.2.12\n"); return 0; }
    var fs = { read: function (p) { var r = S.readFile(sess, p); return r.error ? null : r.content; }, list: function (d) { var n = root.Dk.fsNode(sess.sys, d); return n && n.type === "d" ? keys(n.children).sort() : null; }, isDir: function (d) { var n = root.Dk.fsNode(sess.sys, d); return !!n && n.type === "d"; } };
    var cfgT = fs.read(sess.cwd + "/.ansible-lint") || fs.read(sess.cwd + "/.config/ansible-lint.yml"), skip = [];
    if (cfgT) { try { var c = Y.parse(cfgT) || {}; skip = [].concat(c.skip_list || [], c.warn_list || []); } catch (e) { /* ignore */ } }
    var targets = a.filter(function (x) { return !/^-/.test(x); }), files = [];
    function addDir(d, rel) { (fs.list(d) || []).forEach(function (f) { var p = d + "/" + f; if (f.charAt(0) === "." || /^(group_vars|host_vars|files|templates|defaults|vars|meta)$/.test(f)) return; if (fs.isDir(p)) addDir(p, rel + f + "/"); else if (/\.ya?ml$/.test(f) && !/^(ansible\.cfg|inventory)/.test(f) && !/aws_ec2\.ya?ml$/.test(f)) files.push({ p: p, rel: rel + f }); }); }
    if (!targets.length) addDir(sess.cwd, "");
    else targets.forEach(function (t) { var p = S.normAbs(t.charAt(0) === "/" ? t : sess.cwd + "/" + t); if (fs.isDir(p)) addDir(p, t.replace(/\/?$/, "/")); else files.push({ p: p, rel: t }); });
    var found = [];
    files.forEach(function (f) { var t = fs.read(f.p); if (t == null) return; if (/^\$ANSIBLE_VAULT/.test(t)) return; found = found.concat(lintFile(t, f.rel, skip)); });
    IAC.ev(sess.sys, { kind: "ansible-lint", failures: found.length, files: files.length, rules: found.map(function (f) { return f.rule; }) });
    if (!found.length) { out(io, "\nPassed: 0 failure(s), 0 warning(s) on " + files.length + " files. Last profile that met the validation criteria was 'production'.\n"); return 0; }
    errl(io, "WARNING  Listing " + found.length + " violation(s) that are fatal");
    found.forEach(function (f) { out(io, f.rule + ": " + f.msg + "\n" + f.file + ":" + f.line + (f.detail ? " " + f.detail : "") + "\n\n"); });
    out(io, "Read documentation for instructions on how to ignore specific rule violations.\n\n");
    var counts = {}; found.forEach(function (f) { counts[f.rule] = (counts[f.rule] || 0) + 1; });
    out(io, "                    Rule Violation Summary                    \n count tag                       profile    rule associated tags \n" + keys(counts).map(function (r) { return ("      " + counts[r]).slice(-6) + " " + (r + new Array(26).join(" ")).slice(0, 25) + " " + ((PROFILE[r] || "min") + "          ").slice(0, 10) + " " + (LINT[r] || ""); }).join("\n") + "\n\n");
    var order = ["min", "basic", "moderate", "safety", "shared", "production"], worst = found.map(function (f) { return order.indexOf(PROFILE[f.rule] || "min"); }).reduce(function (m, x) { return Math.min(m, x); }, 99);
    out(io, "Failed: " + found.length + " failure(s), 0 warning(s) on " + files.length + " files. " + (worst > 0 ? "Last profile that met the validation criteria was '" + order[worst - 1] + "'." : "") + "\n");
    return 2;
  };
})(typeof window !== "undefined" ? window : globalThis);
