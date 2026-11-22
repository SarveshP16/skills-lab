/* sudo learn — DevOps Module 3: a simulated Terraform v1.10 with the hashicorp/aws (and random, vault) providers.
   Configuration is real HCL (iac-hcl.js); resources are planned against the simulated AWS account (iac-aws.js)
   with a refresh, a diff against the provider schema (forces replacement, known after apply, sensitive values),
   and applied in dependency order. State is Terraform's JSON v4, kept locally or in S3 with a lock (S3 lockfile
   or DynamoDB). Supports variables and tfvars, locals, outputs, count and for_each, local and registry modules,
   data sources, lifecycle, moved and import blocks, -target, -replace, -refresh-only, saved plans, state and
   import commands, fmt and validate. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, CI = root.CI, G = root.GitCore, IAC = root.IAC;
  var out = U.out, errl = U.errl;
  var TfErr = IAC.TfErr, UNK = IAC.UNK, isUnk = IAC.isUnk, deepUnk = IAC.deepUnk, box = IAC.box;
  function keys(o) { return o ? Object.keys(o) : []; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o, function (k, v) { return v === UNK ? "\u0000UNK" : v; }), function (k, v) { return v === "\u0000UNK" ? UNK : v; }); }
  var VERSION = "1.10.5";
  IAC.TF_VERSION = VERSION;
  function now(sys) { return G.clock(CI.homeSys(sys)); }

  /* ================================================================== provider schemas
     "name:flags=default": r required, o optional, c computed, f forces replacement, s sensitive, S set (order
     doesn't matter), j JSON (compared as JSON). Blocks: {name: {spec, max, comp}} */
  function spec(str) {
    var o = {};
    str.trim().split(/\s+/).forEach(function (t) { var m = /^(\w+):([a-zA-Z]+)(?:=(.*))?$/.exec(t); if (!m) throw new Error("bad spec " + t); var f = m[2]; o[m[1]] = { r: f.indexOf("r") >= 0, o: f.indexOf("o") >= 0, c: f.indexOf("c") >= 0, f: f.indexOf("f") >= 0, s: f.indexOf("s") >= 0, set: f.indexOf("S") >= 0, json: f.indexOf("j") >= 0, def: m[3] === undefined ? undefined : JSON.parse(m[3].replace(/~/g, " ")) }; });
    return o;
  }
  var TAGS = " tags:o tags_all:c";
  var RULE = spec("from_port:r to_port:r protocol:r cidr_blocks:oS ipv6_cidr_blocks:oS prefix_list_ids:oS security_groups:oS self:o=false description:o");
  var SCHEMA = {
    aws_s3_bucket: { a: spec("bucket:ocf bucket_prefix:of force_destroy:o=false object_lock_enabled:ocf id:c arn:c region:c bucket_domain_name:c bucket_regional_domain_name:c hosted_zone_id:c" + TAGS), short: "S3 Bucket" },
    aws_s3_bucket_versioning: { a: spec("bucket:rf expected_bucket_owner:of id:c"), b: { versioning_configuration: { a: spec("status:r mfa_delete:oc"), max: 1, req: true } }, short: "S3 Bucket Versioning" },
    aws_s3_bucket_server_side_encryption_configuration: { a: spec("bucket:rf expected_bucket_owner:of id:c"), b: { rule: { a: spec("bucket_key_enabled:o"), req: true, b: { apply_server_side_encryption_by_default: { a: spec("sse_algorithm:r kms_master_key_id:o"), max: 1 } } } }, short: "S3 Bucket Server-side Encryption Configuration" },
    aws_s3_bucket_public_access_block: { a: spec("bucket:rf block_public_acls:o=false block_public_policy:o=false ignore_public_acls:o=false restrict_public_buckets:o=false id:c"), short: "S3 Bucket Public Access Block" },
    aws_s3_bucket_logging: { a: spec("bucket:rf target_bucket:r target_prefix:r id:c"), short: "S3 Bucket Logging" },
    aws_s3_bucket_policy: { a: spec("bucket:rf policy:rj id:c"), short: "S3 Bucket Policy" },
    aws_vpc: { a: spec("cidr_block:ocf enable_dns_hostnames:oc enable_dns_support:o=true instance_tenancy:o=\"default\" id:c arn:c default_security_group_id:c main_route_table_id:c default_route_table_id:c owner_id:c" + TAGS), short: "EC2 VPC" },
    aws_subnet: { a: spec("vpc_id:rf cidr_block:of availability_zone:ocf map_public_ip_on_launch:o=false id:c arn:c owner_id:c" + TAGS), short: "EC2 Subnet" },
    aws_internet_gateway: { a: spec("vpc_id:o id:c arn:c owner_id:c" + TAGS), short: "EC2 Internet Gateway" },
    aws_eip: { a: spec("domain:oc instance:o id:c public_ip:c allocation_id:c" + TAGS), short: "EC2 EIP" },
    aws_nat_gateway: { a: spec("allocation_id:of subnet_id:rf connectivity_type:of=\"public\" id:c public_ip:c private_ip:c" + TAGS), short: "EC2 NAT Gateway", slow: 92 },
    aws_route_table: { a: spec("vpc_id:rf id:c arn:c owner_id:c" + TAGS), b: { route: { a: spec("cidr_block:o gateway_id:o nat_gateway_id:o"), set: true, attr: true } }, short: "Route Table" },
    aws_route_table_association: { a: spec("subnet_id:of gateway_id:of route_table_id:r id:c"), short: "Route Table Association" },
    aws_security_group: { a: spec("name:ocf name_prefix:of description:of=\"Managed~by~Terraform\" vpc_id:ocf revoke_rules_on_delete:o=false id:c arn:c owner_id:c" + TAGS), b: { ingress: { a: RULE, set: true, attr: true, comp: true }, egress: { a: RULE, set: true, attr: true, comp: true } }, short: "Security Group" },
    aws_vpc_security_group_ingress_rule: { a: spec("security_group_id:rf cidr_ipv4:o cidr_ipv6:o from_port:o to_port:o ip_protocol:r description:o referenced_security_group_id:o prefix_list_id:o id:c arn:c security_group_rule_id:c" + TAGS), short: "VPC Security Group Ingress Rule" },
    aws_vpc_security_group_egress_rule: { a: spec("security_group_id:rf cidr_ipv4:o cidr_ipv6:o from_port:o to_port:o ip_protocol:r description:o referenced_security_group_id:o prefix_list_id:o id:c arn:c security_group_rule_id:c" + TAGS), short: "VPC Security Group Egress Rule" },
    aws_key_pair: { a: spec("key_name:ocf key_name_prefix:of public_key:rf id:c arn:c fingerprint:c key_pair_id:c key_type:c" + TAGS), short: "EC2 Key Pair" },
    aws_instance: { a: spec("ami:rf instance_type:r subnet_id:ocf vpc_security_group_ids:ocS key_name:ocf associate_public_ip_address:ocf iam_instance_profile:o user_data:o user_data_replace_on_change:o=false monitoring:oc ebs_optimized:oc availability_zone:ocf id:c arn:c private_ip:oc public_ip:c private_dns:c public_dns:c instance_state:c primary_network_interface_id:c" + TAGS),
      b: { metadata_options: { a: spec("http_endpoint:oc http_tokens:oc http_put_response_hop_limit:oc instance_metadata_tags:oc"), max: 1, comp: true }, root_block_device: { a: spec("volume_size:oc volume_type:oc encrypted:oc delete_on_termination:o=true kms_key_id:oc iops:oc throughput:oc volume_id:c device_name:c"), max: 1, comp: true } }, short: "EC2 Instance", slow: 12 },
    aws_iam_role: { a: spec("name:ocf name_prefix:of assume_role_policy:rj description:o path:of=\"/\" max_session_duration:o=3600 force_detach_policies:o=false id:c arn:c unique_id:c create_date:c" + TAGS), short: "IAM Role" },
    aws_iam_role_policy: { a: spec("name:ocf role:rf policy:rj id:c"), short: "IAM Role Policy" },
    aws_iam_role_policy_attachment: { a: spec("role:rf policy_arn:rf id:c"), short: "IAM Role Policy Attachment" },
    aws_iam_instance_profile: { a: spec("name:ocf role:o path:of=\"/\" id:c arn:c unique_id:c create_date:c" + TAGS), short: "IAM Instance Profile" },
    aws_iam_openid_connect_provider: { a: spec("url:rf client_id_list:rS thumbprint_list:ocS id:c arn:c" + TAGS), short: "IAM OIDC Provider" },
    aws_ssm_parameter: { a: spec("name:rf type:r value:ocs insecure_value:oc description:o key_id:oc overwrite:o tier:oc data_type:oc allowed_pattern:o id:c arn:c version:c" + TAGS), short: "SSM Parameter" },
    aws_dynamodb_table: { a: spec("name:rf billing_mode:o=\"PROVISIONED\" hash_key:rf read_capacity:oc write_capacity:oc deletion_protection_enabled:o=false id:c arn:c" + TAGS), b: { attribute: { a: spec("name:r type:r"), set: true, req: true }, point_in_time_recovery: { a: spec("enabled:r"), max: 1, comp: true }, server_side_encryption: { a: spec("enabled:r kms_key_arn:oc"), max: 1, comp: true } }, short: "DynamoDB Table", slow: 7 },
    aws_kms_key: { a: spec("description:oc enable_key_rotation:o=false deletion_window_in_days:o key_usage:oc policy:ocj id:c arn:c key_id:c" + TAGS), short: "KMS Key" },
    aws_kms_alias: { a: spec("name:of target_key_id:r id:c arn:c target_key_arn:c"), short: "KMS Alias" },
    aws_cloudwatch_log_group: { a: spec("name:of retention_in_days:o=0 kms_key_id:o id:c arn:c" + TAGS), short: "CloudWatch Logs Log Group" },
    aws_flow_log: { a: spec("vpc_id:of subnet_id:of traffic_type:of log_destination:of log_destination_type:of=\"cloud-watch-logs\" iam_role_arn:of id:c arn:c" + TAGS), short: "Flow Log" },
    random_password: { a: spec("length:rf special:of=true upper:of=true lower:of=true numeric:of=true override_special:of min_special:of=0 result:cs bcrypt_hash:cs id:c"), provider: "random" },
    random_id: { a: spec("byte_length:rf prefix:of hex:c b64_url:c b64_std:c dec:c id:c"), provider: "random" },
    random_pet: { a: spec("length:of=2 prefix:of separator:of=\"-\" id:c"), provider: "random" }
  };
  var DATA = {
    aws_ami: { a: spec("most_recent:o=false owners:o name_regex:o id:c image_id:c name:c arn:c creation_date:c owner_id:c architecture:c"), b: { filter: { a: spec("name:r values:r"), set: true } } },
    aws_caller_identity: { a: spec("id:c account_id:c arn:c user_id:c") },
    aws_region: { a: spec("name:oc id:c description:c endpoint:c") },
    aws_availability_zones: { a: spec("state:o id:c names:c zone_ids:c") },
    aws_ssm_parameter: { a: spec("name:r with_decryption:o=true id:c arn:c type:c value:cs insecure_value:c version:c") },
    aws_iam_policy_document: { a: spec("version:o=\"2012-10-17\" id:c json:c minified_json:c"), b: { statement: { a: spec("sid:o effect:o=\"Allow\" actions:o not_actions:o resources:o not_resources:o"), b: { principals: { a: spec("type:r identifiers:r") }, condition: { a: spec("test:r variable:r values:r") } } } } },
    aws_vpc: { a: spec("default:o id:oc cidr_block:oc arn:c" + TAGS), b: { filter: { a: spec("name:r values:r") } } },
    aws_iam_openid_connect_provider: { a: spec("url:o arn:oc id:c client_id_list:c thumbprint_list:c") },
    vault_kv_secret_v2: { a: spec("mount:r name:r version:o id:c path:c data:cs data_json:cs created_time:c"), provider: "vault" }
  };
  IAC.SCHEMA = SCHEMA; IAC.DATA_SCHEMA = DATA;
  var PROVIDERS = { aws: { src: "hashicorp/aws", versions: ["4.67.0", "5.79.0", "5.80.0"] }, random: { src: "hashicorp/random", versions: ["3.6.2", "3.6.3"] }, vault: { src: "hashicorp/vault", versions: ["4.4.0", "4.5.0"] }, local: { src: "hashicorp/local", versions: ["2.5.2"] } };
  function provOf(type) { return (SCHEMA[type] || DATA[type] || {}).provider || type.split("_")[0]; }
  function provAddr(p) { return "provider[\"registry.terraform.io/" + (PROVIDERS[p] ? PROVIDERS[p].src : "hashicorp/" + p) + "\"]"; }

  /* ================================================================== registry modules (bundled) */
  var REGISTRY = {
    "terraform-aws-modules/vpc/aws": { version: "5.16.0", files: {
      "variables.tf": "variable \"name\" {\n  type    = string\n  default = \"\"\n}\nvariable \"cidr\" {\n  type    = string\n  default = \"10.0.0.0/16\"\n}\nvariable \"azs\" {\n  type    = list(string)\n  default = []\n}\nvariable \"public_subnets\" {\n  type    = list(string)\n  default = []\n}\nvariable \"private_subnets\" {\n  type    = list(string)\n  default = []\n}\nvariable \"enable_dns_hostnames\" {\n  type    = bool\n  default = true\n}\nvariable \"map_public_ip_on_launch\" {\n  type    = bool\n  default = false\n}\nvariable \"tags\" {\n  type    = map(string)\n  default = {}\n}\n",
      "main.tf": "resource \"aws_vpc\" \"this\" {\n  cidr_block           = var.cidr\n  enable_dns_hostnames = var.enable_dns_hostnames\n  tags                 = merge({ Name = var.name }, var.tags)\n}\n\nresource \"aws_internet_gateway\" \"this\" {\n  count  = length(var.public_subnets) > 0 ? 1 : 0\n  vpc_id = aws_vpc.this.id\n  tags   = merge({ Name = var.name }, var.tags)\n}\n\nresource \"aws_subnet\" \"public\" {\n  count                   = length(var.public_subnets)\n  vpc_id                  = aws_vpc.this.id\n  cidr_block              = var.public_subnets[count.index]\n  availability_zone       = element(var.azs, count.index)\n  map_public_ip_on_launch = var.map_public_ip_on_launch\n  tags                    = merge({ Name = \"${var.name}-public-${element(var.azs, count.index)}\" }, var.tags)\n}\n\nresource \"aws_subnet\" \"private\" {\n  count             = length(var.private_subnets)\n  vpc_id            = aws_vpc.this.id\n  cidr_block        = var.private_subnets[count.index]\n  availability_zone = element(var.azs, count.index)\n  tags              = merge({ Name = \"${var.name}-private-${element(var.azs, count.index)}\" }, var.tags)\n}\n\nresource \"aws_route_table\" \"public\" {\n  count  = length(var.public_subnets) > 0 ? 1 : 0\n  vpc_id = aws_vpc.this.id\n  route {\n    cidr_block = \"0.0.0.0/0\"\n    gateway_id = aws_internet_gateway.this[0].id\n  }\n  tags = merge({ Name = \"${var.name}-public\" }, var.tags)\n}\n\nresource \"aws_route_table_association\" \"public\" {\n  count          = length(var.public_subnets)\n  subnet_id      = aws_subnet.public[count.index].id\n  route_table_id = aws_route_table.public[0].id\n}\n",
      "outputs.tf": "output \"vpc_id\" {\n  value = aws_vpc.this.id\n}\noutput \"vpc_cidr_block\" {\n  value = aws_vpc.this.cidr_block\n}\noutput \"public_subnets\" {\n  value = aws_subnet.public[*].id\n}\noutput \"private_subnets\" {\n  value = aws_subnet.private[*].id\n}\n" } }
  };
  IAC.REGISTRY = REGISTRY;

  /* ================================================================== files */
  function fsOf(sess) {
    return {
      read: function (p) { var r = S.readFile(sess, p); return r.error ? null : r.content; },
      list: function (d) { var n = root.Dk.fsNode(sess.sys, d); return n && n.type === "d" ? keys(n.children).sort() : null; },
      isDir: function (d) { var n = root.Dk.fsNode(sess.sys, d); return !!n && n.type === "d"; },
      write: function (p, c, mode) { var dir = p.replace(/\/[^/]*$/, ""); S.mkdirs(sess.sys, dir, 493, sess.uid, sess.gid); S.put(sess.sys, p, c, mode || 420, sess.uid, sess.gid); },
      rm: function (p) { var n = root.Dk.fsNode(sess.sys, p.replace(/\/[^/]*$/, "")); if (n && n.children) delete n.children[p.split("/").pop()]; }
    };
  }
  function norm(p) { return S.normAbs(p); }

  /* ================================================================== configuration */
  function loadConfig(fs, dir, isRoot) {
    var names = (fs.list(dir) || []).filter(function (f) { return /\.tf$/.test(f); });
    var cfg = { dir: dir, files: {}, vars: {}, locals: {}, outputs: {}, resources: [], modules: [], providers: [], required: {}, backend: null, moved: [], imports: [], errors: [], defaultTags: {} };
    if (!names.length) { cfg.empty = true; return cfg; }
    names.forEach(function (f) {
      var src = fs.read(dir + "/" + f) || "", ast;
      try { ast = IAC.parseHcl(src, f); } catch (e) { if (e instanceof TfErr) { cfg.errors.push(e); return; } throw e; }
      cfg.files[f] = src;
      ast.blocks.forEach(function (b) {
        var at = { file: f, line: b.line, src: src };
        function lbl(n, what) { if (b.labels.length !== n) { cfg.errors.push(new TfErr("Missing name for " + what, "All " + what + " blocks must have " + n + " label" + (n > 1 ? "s" : "") + ".", at)); return false; } return true; }
        if (b.type === "variable") { if (!lbl(1, "variable")) return; if (cfg.vars[b.labels[0]]) cfg.errors.push(new TfErr("Duplicate variable declaration", "A variable named \"" + b.labels[0] + "\" was already declared.", at)); cfg.vars[b.labels[0]] = { name: b.labels[0], b: b, at: at, sensitive: !!(b.attrs.sensitive && b.attrs.sensitive.v), type: b.attrs.type, def: b.attrs["default"], validations: b.blocks.filter(function (x) { return x.type === "validation"; }) }; }
        else if (b.type === "locals") keys(b.attrs).forEach(function (k) { if (cfg.locals[k]) cfg.errors.push(new TfErr("Duplicate local value definition", "A local value named \"" + k + "\" was already defined.", Object.assign({}, at, { line: b.attrs[k].line }))); cfg.locals[k] = { e: b.attrs[k], at: Object.assign({}, at, { line: b.attrs[k].line }) }; });
        else if (b.type === "output") { if (!lbl(1, "output")) return; cfg.outputs[b.labels[0]] = { name: b.labels[0], b: b, at: at, sensitive: !!(b.attrs.sensitive && b.attrs.sensitive.v) }; if (!b.attrs.value) cfg.errors.push(new TfErr("Missing required argument", "The argument \"value\" is required, but no definition was found.", at)); }
        else if (b.type === "resource" || b.type === "data") {
          if (!lbl(2, b.type === "resource" ? "resource" : "data")) return;
          var mode = b.type === "resource" ? "managed" : "data", type = b.labels[0], name = b.labels[1];
          if (cfg.resources.some(function (r) { return r.mode === mode && r.type === type && r.name === name; })) { cfg.errors.push(new TfErr("Duplicate " + (mode === "managed" ? "resource" : "data") + " \"" + type + "\" configuration", "A " + (mode === "managed" ? "" : "data ") + type + " " + (mode === "managed" ? "resource" : "resource") + " named \"" + name + "\" was already declared. " + (mode === "managed" ? "Resource" : "Data resource") + " names must be unique per type in each module.", at)); return; }
          var lc = b.blocks.filter(function (x) { return x.type === "lifecycle"; })[0];
          cfg.resources.push({ mode: mode, type: type, name: name, b: b, at: at, file: f, count: b.attrs.count || null, for_each: b.attrs.for_each || null, depends_on: b.attrs.depends_on || null, lifecycle: lc || null, ctx: (mode === "managed" ? "in resource" : "in data") + " \"" + type + "\" \"" + name + "\"" });
        }
        else if (b.type === "module") { if (!lbl(1, "module")) return; cfg.modules.push({ name: b.labels[0], b: b, at: at, source: b.attrs.source ? b.attrs.source.v : null, version: b.attrs.version ? b.attrs.version.v : null, count: b.attrs.count || null, for_each: b.attrs.for_each || null }); if (!b.attrs.source) cfg.errors.push(new TfErr("Missing required argument", "The argument \"source\" is required, but no definition was found.", at)); }
        else if (b.type === "provider") { cfg.providers.push({ name: b.labels[0], b: b, at: at }); var dt = b.blocks.filter(function (x) { return x.type === "default_tags"; })[0]; if (dt && dt.attrs.tags) cfg.defaultTagsExpr = dt.attrs.tags; }
        else if (b.type === "terraform") {
          b.blocks.forEach(function (x) {
            if (x.type === "required_providers") keys(x.attrs).forEach(function (k) { var e = x.attrs[k]; var o = {}; if (e.k === "obj") e.props.forEach(function (p) { o[p.key.v] = p.val.v; }); else if (e.k === "lit") o.version = e.v; cfg.required[k] = o; });
            else if (x.type === "backend") { var bc = {}; keys(x.attrs).forEach(function (k) { bc[k] = x.attrs[k].v !== undefined ? x.attrs[k].v : (x.attrs[k].k === "tuple" ? x.attrs[k].items.map(function (i) { return i.v; }) : null); if (x.attrs[k].k !== "lit") cfg.errors.push(new TfErr("Variables not allowed", "Variables may not be used here.", Object.assign({}, at, { line: x.attrs[k].line }))); }); cfg.backend = { type: x.labels[0], config: bc, at: Object.assign({}, at, { line: x.line }) }; }
            else if (x.type === "cloud") cfg.errors.push(new TfErr("Unsupported block type", "This lab's Terraform uses an s3 backend, not HCP Terraform (cloud block).", at));
          });
          if (b.attrs.required_version) cfg.requiredVersion = b.attrs.required_version.v;
        }
        else if (b.type === "moved") cfg.moved.push({ from: b.attrs.from, to: b.attrs.to, at: at });
        else if (b.type === "import") cfg.imports.push({ to: b.attrs.to, id: b.attrs.id, at: at });
        else if (b.type === "check" || b.type === "removed") { /* accepted */ }
        else cfg.errors.push(new TfErr("Unsupported block type", "Blocks of type \"" + b.type + "\" are not expected here.", at));
      });
    });
    return cfg;
  }
  IAC.loadConfig = loadConfig;
  function exprText(e) {
    if (!e) return "";
    if (e.k === "ref") return e.n;
    if (e.k === "get") return exprText(e.o) + "." + e.a;
    if (e.k === "idx") return exprText(e.o) + "[" + (e.i.k === "lit" ? JSON.stringify(e.i.v) : exprText(e.i)) + "]";
    return "";
  }
  IAC.exprText = exprText;

  /* ---------------- static validation: arguments, blocks and references */
  function suggest(n, list) { var best = null, bd = 99; list.forEach(function (k) { var d = lev(n, k); if (d < bd && d <= Math.max(2, Math.floor(k.length / 3))) { bd = d; best = k; } }); return best; }
  function lev(a, b) { var m = [], i, j; for (i = 0; i <= a.length; i++) { m[i] = [i]; } for (j = 0; j <= b.length; j++) m[0][j] = j; for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)); return m[a.length][b.length]; }
  var META = { count: 1, for_each: 1, depends_on: 1, provider: 1, lifecycle: 1, provisioner: 1, connection: 1 };
  function checkBody(r, sch, body, errs, path) {
    keys(body.attrs).forEach(function (k) {
      if (!path && META[k]) return;
      var a = sch.a[k];
      if (!a || (a.c && !a.o && !a.r)) {
        var isBlock = sch.b && sch.b[k];
        if (isBlock && sch.b[k].attr) return;
        var sg = suggest(k, keys(sch.a).filter(function (x) { return sch.a[x].o || sch.a[x].r; }));
        errs.push(new TfErr(a ? "Invalid or unknown key" : "Unsupported argument", a ? "The argument \"" + k + "\" is computed: it's set by AWS, you can't set it in the configuration." : isBlock ? "An argument named \"" + k + "\" is not expected here. Did you mean to define a block of type \"" + k + "\"?" : "An argument named \"" + k + "\" is not expected here." + (sg ? " Did you mean \"" + sg + "\"?" : ""), Object.assign({}, r.at, { line: body.attrs[k].line, ctx: r.ctx })));
      }
    });
    keys(sch.a).forEach(function (k) { if (sch.a[k].r && !(k in body.attrs)) errs.push(new TfErr("Missing required argument", "The argument \"" + k + "\" is required, but no definition was found.", Object.assign({}, r.at, { line: body.line || r.at.line, ctx: r.ctx }))); });
    body.blocks.forEach(function (x) {
      if (!path && (x.type === "lifecycle" || x.type === "provisioner" || x.type === "connection" || x.type === "dynamic")) return;
      var bs = sch.b && sch.b[x.type];
      if (!bs) { errs.push(new TfErr("Unsupported block type", "Blocks of type \"" + x.type + "\" are not expected here." + (sch.a[x.type] ? " Did you mean to define argument \"" + x.type + "\"? If so, use the equals sign to assign it a value." : ""), Object.assign({}, r.at, { line: x.line, ctx: r.ctx }))); return; }
      checkBody(r, bs, x, errs, (path || "") + x.type + ".");
    });
    if (sch.b) keys(sch.b).forEach(function (k) {
      var n = body.blocks.filter(function (x) { return x.type === k; }).length;
      if (sch.b[k].max && n > sch.b[k].max) errs.push(new TfErr("Too many " + k + " blocks", "No more than " + sch.b[k].max + " \"" + k + "\" blocks are allowed", Object.assign({}, r.at, { ctx: r.ctx })));
      if (sch.b[k].req && !n && !(k in body.attrs)) errs.push(new TfErr("Insufficient " + k + " blocks", "At least 1 \"" + k + "\" blocks are required.", Object.assign({}, r.at, { line: body.line || r.at.line, ctx: r.ctx })));
    });
  }
  function validate(cfg, fs, rootDir) {
    var errs = cfg.errors.slice();
    var resNames = {}, dataNames = {};
    cfg.resources.forEach(function (r) { (r.mode === "managed" ? resNames : dataNames)[r.type + "." + r.name] = r; });
    cfg.resources.forEach(function (r) {
      var sch = (r.mode === "managed" ? SCHEMA : DATA)[r.type];
      if (!sch) { var sg = suggest(r.type, keys(r.mode === "managed" ? SCHEMA : DATA)); errs.push(new TfErr("Invalid " + (r.mode === "managed" ? "resource" : "data source") + " type", "The provider hashicorp/" + provOf(r.type) + " does not support " + (r.mode === "managed" ? "resource" : "data source") + " type \"" + r.type + "\"." + (sg ? "\n\nDid you mean \"" + sg + "\"?" : ""), Object.assign({}, r.at, { ctx: r.ctx }))); return; }
      checkBody(r, sch, r.b, errs, "");
      if (r.count && r.for_each) errs.push(new TfErr("Invalid combination of \"count\" and \"for_each\"", "The \"count\" and \"for_each\" meta-arguments are mutually-exclusive, only one should be used to be explicit about the number of resources to be created.", Object.assign({}, r.at, { ctx: r.ctx })));
    });
    // references
    function checkRefs(list, at, ctxLabel, hasCount, hasEach) {
      list.forEach(function (rf) {
        var n = rf[0], a2 = Object.assign({}, at, { ctx: ctxLabel });
        if (n === "var") { if (rf[1] && !cfg.vars[rf[1]]) errs.push(new TfErr("Reference to undeclared input variable", "An input variable with the name \"" + rf[1] + "\" has not been declared." + (suggest(rf[1], keys(cfg.vars)) ? " Did you mean \"" + suggest(rf[1], keys(cfg.vars)) + "\"?" : " This variable can be declared with a variable \"" + rf[1] + "\" {} block."), a2)); }
        else if (n === "local") { if (rf[1] && !cfg.locals[rf[1]]) errs.push(new TfErr("Reference to undeclared local value", "A local value with the name \"" + rf[1] + "\" has not been declared." + (suggest(rf[1], keys(cfg.locals)) ? " Did you mean \"" + suggest(rf[1], keys(cfg.locals)) + "\"?" : ""), a2)); }
        else if (n === "data") { if (rf[2] && !dataNames[rf[1] + "." + rf[2]]) errs.push(new TfErr("Reference to undeclared resource", "A data resource \"" + rf[1] + "\" \"" + rf[2] + "\" has not been declared in the root module.", a2)); }
        else if (n === "module") { if (rf[1] && !cfg.modules.some(function (m) { return m.name === rf[1]; })) errs.push(new TfErr("Reference to undeclared module", "No module call named \"" + rf[1] + "\" is declared in the root module.", a2)); }
        else if (n === "count") { if (!hasCount) errs.push(new TfErr("Reference to \"count\" in non-counted context", "The \"count\" object can only be used in \"module\", \"resource\", and \"data\" blocks, and only when the \"count\" argument is set.", a2)); }
        else if (n === "each") { if (!hasEach) errs.push(new TfErr("Reference to \"each\" in context without for_each", "The \"each\" object can be used only in \"module\" or \"resource\" blocks, and only when the \"for_each\" argument is set.", a2)); }
        else if (n === "path" || n === "terraform" || n === "self") { /* ok */ }
        else if (/_/.test(n) && rf[1]) { if (!resNames[n + "." + rf[1]]) { var cands = keys(resNames).filter(function (k) { return k.split(".")[0] === n; }).map(function (k) { return k.split(".")[1]; }); var sg2 = suggest(rf[1], cands); errs.push(new TfErr("Reference to undeclared resource", "A managed resource \"" + n + "\" \"" + rf[1] + "\" has not been declared in the root module." + (sg2 ? " Did you mean \"" + sg2 + "\"?" : ""), a2)); } }
        else if (!/_/.test(n)) errs.push(new TfErr("Invalid reference", "A reference to a resource type must be followed by at least one attribute access, specifying the resource name.", a2));
      });
    }
    cfg.resources.forEach(function (r) {
      keys(r.b.attrs).forEach(function (k) { if (k === "depends_on") return; checkRefs(IAC.refs(r.b.attrs[k]), Object.assign({}, r.at, { line: r.b.attrs[k].line }), r.ctx, !!r.count, !!r.for_each); });
      (function walk(b) { b.blocks.forEach(function (x) { if (x.type === "lifecycle") return; keys(x.attrs).forEach(function (k) { checkRefs(IAC.refs(x.attrs[k]), Object.assign({}, r.at, { line: x.attrs[k].line }), r.ctx, !!r.count, !!r.for_each); }); walk(x); }); })(r.b);
    });
    keys(cfg.locals).forEach(function (k) { checkRefs(IAC.refs(cfg.locals[k].e), cfg.locals[k].at, null, false, false); });
    keys(cfg.outputs).forEach(function (k) { var o = cfg.outputs[k]; if (o.b.attrs.value) checkRefs(IAC.refs(o.b.attrs.value), Object.assign({}, o.at, { line: o.b.attrs.value.line }), "in output \"" + k + "\"", false, false); });
    cfg.modules.forEach(function (m) { keys(m.b.attrs).forEach(function (k) { if (k === "source" || k === "version") return; checkRefs(IAC.refs(m.b.attrs[k]), Object.assign({}, m.at, { line: m.b.attrs[k].line }), "in module \"" + m.name + "\"", !!m.count, !!m.for_each); }); });
    return errs;
  }
  IAC.validateConfig = validate;

  /* ================================================================== state */
  function emptyState() { return { version: 4, terraform_version: VERSION, serial: 0, lineage: null, outputs: {}, resources: [], check_results: null }; }
  // flatten to {addr: {mode, type, name, module, key, attrs, deps, sens}} and back
  function addrOf(mod, mode, type, name, key) { return (mod ? mod + "." : "") + (mode === "data" ? "data." : "") + type + "." + name + (key === undefined || key === null ? "" : "[" + (typeof key === "number" ? key : JSON.stringify(key)) + "]"); }
  IAC.addrOf = addrOf;
  // "module.a[\"x\"].aws_s3_bucket.this[0]" → {module: 'module.a["x"]', mode, type, name, key}
  function parseAddr(a) {
    var parts = [], cur = "", depth = 0, q = false;
    for (var i = 0; i < a.length; i++) { var ch = a.charAt(i); if (ch === "\"") q = !q; if (!q && ch === "[") depth++; if (!q && ch === "]") depth--; if (ch === "." && !q && depth === 0) { parts.push(cur); cur = ""; } else cur += ch; }
    parts.push(cur);
    var mod = [], k = 0;
    while (parts[k] === "module" && k + 1 < parts.length) { mod.push("module." + parts[k + 1]); k += 2; }
    var mode = parts[k] === "data" ? "data" : "managed"; if (mode === "data") k++;
    var type = parts[k], last = parts[k + 1] || "", km = /^([^\[]+)(?:\[(.*)\])?$/.exec(last);
    var key = km && km[2] !== undefined ? JSON.parse(km[2]) : null;
    return { module: mod.join("."), mode: mode, type: type, name: km ? km[1] : last, key: key };
  }
  IAC.parseAddr = parseAddr;
  function flat(st) {
    var f = {};
    (st.resources || []).forEach(function (r) { r.instances.forEach(function (i) { var a = addrOf(r.module || "", r.mode, r.type, r.name, i.index_key); f[a] = { mode: r.mode, type: r.type, name: r.name, module: r.module || "", key: i.index_key, attrs: i.attributes, deps: i.dependencies || [], sens: i.sensitive_attributes || [], provider: r.provider }; }); });
    return f;
  }
  IAC.flatState = flat;
  function unflat(f, base) {
    var st = clone(base), groups = {};
    st.resources = [];
    keys(f).forEach(function (a) {
      var x = f[a], gk = (x.module || "") + "|" + x.mode + "|" + x.type + "|" + x.name;
      if (!groups[gk]) { groups[gk] = { mode: x.mode, type: x.type, name: x.name, provider: x.provider || provAddr(provOf(x.type)), instances: [] }; if (x.module) groups[gk].module = x.module; st.resources.push(groups[gk]); groups[gk] = groups[gk]; }
      var inst = { schema_version: 0, attributes: x.attrs, sensitive_attributes: x.sens || [], private: "bnVsbA==" };
      if (x.key !== undefined && x.key !== null) inst = Object.assign({ index_key: x.key }, inst);
      if (x.deps && x.deps.length) inst.dependencies = x.deps;
      groups[gk].instances.push(inst);
    });
    st.resources.forEach(function (r) { r.instances.sort(function (a, b) { return typeof a.index_key === "number" ? a.index_key - b.index_key : String(a.index_key || "").localeCompare(String(b.index_key || "")); }); });
    return st;
  }

  /* ---------------- backends */
  function backendOf(ctx) {
    var sess = ctx.sess, fs = ctx.fs, dir = ctx.dir, A = IAC.aws(sess.sys);
    var saved = fs.read(dir + "/.terraform/terraform.tfstate"), bk = saved ? JSON.parse(saved).backend : null;
    if (!bk || bk.type === "local") {
      var path = dir + "/" + ((bk && bk.config && bk.config.path) || "terraform.tfstate");
      return { type: "local", desc: "local", read: function () { var t = fs.read(path); return t ? JSON.parse(t) : null; }, write: function (st) { var old = fs.read(path); if (old) fs.write(path + ".backup", old, 420); fs.write(path, JSON.stringify(st, null, 2) + "\n", 420); }, lock: function () { return null; }, unlock: function () {} };
    }
    var c = bk.config, b = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === c.bucket; });
    var id = IAC.identityOf(sess);
    function check(action, res) { if (!id || id.error) throw new TfErr("No valid credential sources found", "Please see https://registry.terraform.io/providers/hashicorp/aws/latest/docs#authentication-and-configuration for more information about providing credentials.\n\nError: failed to refresh cached credentials, no EC2 IMDS role found, operation error ec2imds: GetMetadata, request canceled, context deadline exceeded"); if (!IAC.allowed(id, action)) throw new TfErr("Error acquiring the state lock", "Error message: operation error S3: PutObject, https response error StatusCode: 403, RequestID: " + M2.hexOf("rq" + action, 16).toUpperCase() + ", api error AccessDenied: User: " + id.arn + " is not authorized to perform: " + action + " on resource: \"arn:aws:s3:::" + c.bucket + "/" + res + "\" because no identity-based policy allows the " + action + " action"); }
    var lockKey = c.key + ".tflock";
    return {
      type: "s3", desc: c.bucket + "/" + c.key,
      read: function () { if (!b) return null; var o = (b.objects || {})[c.key]; return o ? JSON.parse(o.body) : null; },
      write: function (st) { if (!b) return; check("s3:PutObject", c.key); (b.objects = b.objects || {})[c.key] = { body: JSON.stringify(st, null, 2) + "\n", t: now(sess.sys) }; },
      lock: function (op) {
        if (!b) return null;
        var info = { ID: M2.hexOf("lock" + now(sess.sys) + op, 8) + "-" + M2.hexOf("l2" + op, 4) + "-" + M2.hexOf("l3", 4) + "-" + M2.hexOf("l4", 4) + "-" + M2.hexOf("l5" + now(sess.sys), 12), Operation: op, Info: "", Who: (sess.user || "dev") + "@" + sess.sys.host, Version: VERSION, Created: new Date(now(sess.sys) * 1000).toISOString().replace("T", " ").replace("Z", "") + "123456789 +0000 UTC", Path: c.bucket + "/" + c.key };
        if (c.use_lockfile) {
          check("s3:PutObject", lockKey);
          var cur = (b.objects || {})[lockKey];
          if (cur) { var li = JSON.parse(cur.body); throw lockErr("operation error S3: PutObject, https response error StatusCode: 412, RequestID: " + M2.hexOf("rq412", 16).toUpperCase() + ", HostID: " + M2.hexOf("host", 40) + ", api error PreconditionFailed: At least one of the pre-conditions you specified did not hold", li); }
          (b.objects = b.objects || {})[lockKey] = { body: JSON.stringify(info), t: now(sess.sys) };
          return info;
        }
        if (c.dynamodb_table) {
          var t = IAC.find(A, "aws_dynamodb_table", function (x) { return x.name === c.dynamodb_table; });
          if (!t) throw new TfErr("Error acquiring the state lock", "Error message: operation error DynamoDB: PutItem, https response error StatusCode: 400, RequestID: " + M2.hexOf("rqddb", 32).toUpperCase() + ", ResourceNotFoundException: Requested resource not found");
          if (!IAC.allowed(id, "dynamodb:PutItem")) throw new TfErr("Error acquiring the state lock", "Error message: operation error DynamoDB: PutItem, https response error StatusCode: 400, api error AccessDeniedException: User: " + id.arn + " is not authorized to perform: dynamodb:PutItem on resource: " + t.arn);
          var lid = c.bucket + "/" + c.key;
          t.items = t.items || {};
          if (t.items[lid]) throw lockErr("operation error DynamoDB: PutItem, https response error StatusCode: 400, RequestID: " + M2.hexOf("rqcc", 32).toUpperCase() + ", ConditionalCheckFailedException: The conditional request failed", JSON.parse(t.items[lid].Info));
          t.items[lid] = { LockID: lid, Info: JSON.stringify(info) };
          return info;
        }
        return null;
      },
      unlock: function () { if (!b) return; if (c.use_lockfile && b.objects) delete b.objects[lockKey]; if (c.dynamodb_table) { var t2 = IAC.find(A, "aws_dynamodb_table", function (x) { return x.name === c.dynamodb_table; }); if (t2 && t2.items) delete t2.items[c.bucket + "/" + c.key]; } },
      forceUnlock: function (lid) { if (!b) return false; if (c.use_lockfile) { var cur = (b.objects || {})[lockKey]; if (!cur || JSON.parse(cur.body).ID !== lid) return false; delete b.objects[lockKey]; return true; } var t3 = IAC.find(A, "aws_dynamodb_table", function (x) { return x.name === c.dynamodb_table; }); var k = c.bucket + "/" + c.key; if (!t3 || !t3.items || !t3.items[k] || JSON.parse(t3.items[k].Info).ID !== lid) return false; delete t3.items[k]; return true; }
    };
  }
  function lockErr(msg, li) {
    return new TfErr("Error acquiring the state lock", "Error message: " + msg + "\nLock Info:\n  ID:        " + li.ID + "\n  Path:      " + li.Path + "\n  Operation: " + li.Operation + "\n  Who:       " + li.Who + "\n  Version:   " + li.Version + "\n  Created:   " + li.Created + "\n  Info:      " + (li.Info || "") + "\n\n\nTerraform acquires a state lock to protect the state from being written\nby multiple users at the same time. Please resolve the issue above and try\nagain. For most commands, you can disable locking with the \"-lock=false\"\nflag, but this is not recommended.");
  }
  // A colleague's crashed apply left a lock behind (lab setup)
  IAC.staleLock = function (sys, bucket, key, who, mode, table) {
    var A = IAC.aws(sys), info = { ID: "4b1c8e2f-9a7d-4f3e-b6a1-" + M2.hexOf("stale" + bucket + key, 12), Operation: "OperationTypeApply", Info: "", Who: who, Version: "1.10.3", Created: "2026-11-20 16:42:10.481326117 +0000 UTC", Path: bucket + "/" + key };
    if (mode === "dynamodb") { var t = IAC.find(A, "aws_dynamodb_table", function (x) { return x.name === table; }); t.items = t.items || {}; t.items[bucket + "/" + key] = { LockID: bucket + "/" + key, Info: JSON.stringify(info) }; }
    else { var b = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === bucket; }); (b.objects = b.objects || {})[key + ".tflock"] = { body: JSON.stringify(info), t: 0 }; }
    return info.ID;
  };

  /* ================================================================== provider: what AWS does */
  function ApiErr(msg) { this.msg = msg; }
  function rqid(s) { var h = M2.hexOf("rq" + s, 32); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32); }
  function apiFail(svc, op, code, status, msg) { return new ApiErr("operation error " + svc + ": " + op + ", https response error StatusCode: " + status + ", RequestID: " + rqid(op + msg) + ", " + (code ? "api error " + code + ": " : "") + msg); }
  function bucketName(o) { return o.bucket; }
  var PROV = {
    aws_s3_bucket: {
      verb: "S3 Bucket", idOf: bucketName,
      create: function (A, o, ctx) {
        if (!o.bucket) o.bucket = (o.bucket_prefix || "terraform-") + "2026" + M2.hexOf("bkt" + A.seq++, 18);
        if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(o.bucket)) throw apiFail("S3", "CreateBucket", "InvalidBucketName", 400, "The specified bucket is not valid.");
        if (A.taken[o.bucket] || IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === o.bucket; })) throw apiFail("S3", "CreateBucket", "BucketAlreadyExists", 409, "");
        o.id = o.bucket; o.arn = "arn:aws:s3:::" + o.bucket; o.region = A.region; o.bucket_domain_name = o.bucket + ".s3.amazonaws.com"; o.bucket_regional_domain_name = o.bucket + ".s3." + A.region + ".amazonaws.com"; o.hosted_zone_id = "Z1BKCTXD74EZPE"; o.object_lock_enabled = !!o.object_lock_enabled;
        return o;
      },
      del: function (A, o) { var b = IAC.find(A, "aws_s3_bucket", function (x) { return x.id === o.id; }); if (b && keys(b.objects || {}).length && !o.force_destroy) throw apiFail("S3", "DeleteBucket", "BucketNotEmpty", 409, "The bucket you tried to delete is not empty"); }
    },
    aws_s3_bucket_versioning: { verb: "S3 Bucket Versioning", idOf: bucketName, create: function (A, o) { needBucket(A, o.bucket, "PutBucketVersioning"); o.id = o.bucket; if (!/^(Enabled|Suspended|Disabled)$/.test(o.versioning_configuration[0].status)) throw apiFail("S3", "PutBucketVersioning", "MalformedXML", 400, "The XML you provided was not well-formed or did not validate against our published schema"); o.versioning_configuration[0].mfa_delete = o.versioning_configuration[0].mfa_delete || ""; return o; } },
    aws_s3_bucket_server_side_encryption_configuration: { verb: "S3 Bucket Server-side Encryption Configuration", idOf: bucketName, create: function (A, o) { needBucket(A, o.bucket, "PutBucketEncryption"); o.id = o.bucket; return o; } },
    aws_s3_bucket_public_access_block: { verb: "S3 Bucket Public Access Block", idOf: bucketName, create: function (A, o) { needBucket(A, o.bucket, "PutPublicAccessBlock"); o.id = o.bucket; return o; } },
    aws_s3_bucket_logging: { verb: "S3 Bucket Logging", idOf: bucketName, create: function (A, o) { needBucket(A, o.bucket, "PutBucketLogging"); needBucket(A, o.target_bucket, "PutBucketLogging"); o.id = o.bucket; return o; } },
    aws_s3_bucket_policy: { verb: "S3 Bucket Policy", idOf: bucketName, create: function (A, o) { needBucket(A, o.bucket, "PutBucketPolicy"); var pab = IAC.find(A, "aws_s3_bucket_public_access_block", function (x) { return x.bucket === o.bucket; }); if (pab && pab.block_public_policy && /"\*"|"AWS"\s*:\s*"\*"/.test(o.policy)) throw apiFail("S3", "PutBucketPolicy", "AccessDenied", 403, "User: " + IAC.laptopIdentity.arn + " is not authorized to perform: s3:PutBucketPolicy on resource: \"arn:aws:s3:::" + o.bucket + "\" because public policies are blocked by the BlockPublicPolicy block public access setting."); o.id = o.bucket; return o; } },
    aws_vpc: { verb: "EC2 VPC", create: function (A, o) { if (!IAC.validCidr(o.cidr_block)) throw apiFail("EC2", "CreateVpc", "InvalidParameterValue", 400, "Value (" + o.cidr_block + ") for parameter cidrBlock is invalid. This is not a valid CIDR block."); var p = +o.cidr_block.split("/")[1]; if (p < 16 || p > 28) throw apiFail("EC2", "CreateVpc", "InvalidVpc.Range", 400, "The CIDR '" + o.cidr_block + "' is invalid."); o.id = IAC.newId(A, "vpc", o.cidr_block); o.arn = IAC.arn("ec2", "vpc/" + o.id); o.owner_id = A.account; o.default_security_group_id = IAC.newId(A, "sg", o.id); o.main_route_table_id = IAC.newId(A, "rtb", o.id); o.default_route_table_id = o.main_route_table_id; if (o.enable_dns_hostnames == null) o.enable_dns_hostnames = false; return o; } },
    aws_subnet: { verb: "EC2 Subnet", create: function (A, o) { var v = IAC.find(A, "aws_vpc", function (x) { return x.id === o.vpc_id; }); if (!v) throw apiFail("EC2", "CreateSubnet", "InvalidVpcID.NotFound", 400, "The vpc ID '" + o.vpc_id + "' does not exist"); if (!IAC.validCidr(o.cidr_block) || !IAC.inCidr(o.cidr_block.split("/")[0], v.cidr_block) || +o.cidr_block.split("/")[1] < +v.cidr_block.split("/")[1]) throw apiFail("EC2", "CreateSubnet", "InvalidSubnet.Range", 400, "The CIDR '" + o.cidr_block + "' is invalid."); var clash = IAC.all(A, "aws_subnet").filter(function (s) { return s.vpc_id === o.vpc_id && (IAC.inCidr(s.cidr_block.split("/")[0], o.cidr_block) || IAC.inCidr(o.cidr_block.split("/")[0], s.cidr_block)); })[0]; if (clash) throw apiFail("EC2", "CreateSubnet", "InvalidSubnet.Conflict", 400, "The CIDR '" + o.cidr_block + "' conflicts with another subnet"); if (o.availability_zone && IAC.AZS.indexOf(o.availability_zone) < 0) throw apiFail("EC2", "CreateSubnet", "InvalidParameterValue", 400, "Value (" + o.availability_zone + ") for parameter availabilityZone is invalid. Subnets can currently only be created in the following availability zones: " + IAC.AZS.join(", ") + "."); o.availability_zone = o.availability_zone || IAC.AZS[A.seq % 3]; o.id = IAC.newId(A, "subnet", o.cidr_block); o.arn = IAC.arn("ec2", "subnet/" + o.id); o.owner_id = A.account; return o; } },
    aws_internet_gateway: { verb: "EC2 Internet Gateway", create: function (A, o) { o.id = IAC.newId(A, "igw", o.vpc_id || "x"); o.arn = IAC.arn("ec2", "internet-gateway/" + o.id); o.owner_id = A.account; return o; } },
    aws_eip: { verb: "EC2 EIP", create: function (A, o) { o.allocation_id = IAC.newId(A, "eipalloc", "e"); o.id = o.allocation_id; o.public_ip = IAC.allocPublicIp(A); o.domain = o.domain || "vpc"; return o; } },
    aws_nat_gateway: { verb: "EC2 NAT Gateway", create: function (A, o) { o.id = IAC.newId(A, "nat", o.subnet_id); o.public_ip = IAC.allocPublicIp(A); var s = IAC.find(A, "aws_subnet", function (x) { return x.id === o.subnet_id; }); o.private_ip = s ? IAC.allocPrivateIp(A, s) : "10.0.0.5"; return o; } },
    aws_route_table: { verb: "Route Table", create: function (A, o) { o.id = IAC.newId(A, "rtb", o.vpc_id); o.arn = IAC.arn("ec2", "route-table/" + o.id); o.owner_id = A.account; (o.route || []).forEach(function (r) { if (r.gateway_id && !/^igw-|^local$/.test(r.gateway_id)) throw apiFail("EC2", "CreateRoute", "InvalidGatewayID.NotFound", 400, "The gateway ID '" + r.gateway_id + "' does not exist"); }); return o; } },
    aws_route_table_association: { verb: "Route Table Association", create: function (A, o) { if (IAC.find(A, "aws_route_table_association", function (x) { return x.subnet_id && x.subnet_id === o.subnet_id; })) throw apiFail("EC2", "AssociateRouteTable", "Resource.AlreadyAssociated", 400, "the specified association for route table " + o.route_table_id + " conflicts with an existing association"); o.id = IAC.newId(A, "rtbassoc", o.subnet_id); return o; } },
    aws_security_group: { verb: "Security Group", create: function (A, o) { if (!o.name) o.name = (o.name_prefix || "terraform-") + "2026" + M2.hexOf("sgn" + A.seq, 18); if (IAC.find(A, "aws_security_group", function (x) { return x.name === o.name && x.vpc_id === o.vpc_id; })) throw apiFail("EC2", "CreateSecurityGroup", "InvalidGroup.Duplicate", 400, "The security group '" + o.name + "' already exists for VPC '" + o.vpc_id + "'"); o.id = IAC.newId(A, "sg", o.name); o.arn = IAC.arn("ec2", "security-group/" + o.id); o.owner_id = A.account; o.ingress = o.ingress || []; o.egress = o.egress || []; return o; } },
    aws_vpc_security_group_ingress_rule: { verb: "VPC Security Group Ingress Rule", create: function (A, o) { if (!IAC.find(A, "aws_security_group", function (x) { return x.id === o.security_group_id; })) throw apiFail("EC2", "AuthorizeSecurityGroupIngress", "InvalidGroup.NotFound", 400, "The security group '" + o.security_group_id + "' does not exist"); o.id = IAC.newId(A, "sgr", o.security_group_id + o.from_port + o.cidr_ipv4); o.security_group_rule_id = o.id; o.arn = IAC.arn("ec2", "security-group-rule/" + o.id); return o; } },
    aws_vpc_security_group_egress_rule: { verb: "VPC Security Group Egress Rule", create: function (A, o) { o.id = IAC.newId(A, "sgr", o.security_group_id + "e" + o.from_port); o.security_group_rule_id = o.id; o.arn = IAC.arn("ec2", "security-group-rule/" + o.id); return o; } },
    aws_key_pair: { verb: "EC2 Key Pair", create: function (A, o) { if (!/^ssh-(ed25519|rsa) /.test(String(o.public_key || ""))) throw apiFail("EC2", "ImportKeyPair", "InvalidKey.Format", 400, "Key is not in valid OpenSSH public key format"); o.key_name = o.key_name || (o.key_name_prefix || "terraform-") + "2026" + M2.hexOf("kp" + A.seq, 18); o.id = o.key_name; o.key_pair_id = IAC.newId(A, "key", o.key_name); o.arn = IAC.arn("ec2", "key-pair/" + o.key_name); o.fingerprint = M2.hexOf("fp" + o.public_key, 43); o.key_type = /ed25519/.test(o.public_key) ? "ed25519" : "rsa"; return o; } },
    aws_instance: {
      verb: "EC2 Instance",
      create: function (A, o) {
        if (!IAC.AMIS.some(function (x) { return x.id === o.ami; })) throw apiFail("EC2", "RunInstances", "InvalidAMIID.NotFound", 400, "The image id '[" + o.ami + "]' does not exist");
        if (!IAC.INSTANCE_TYPES[o.instance_type]) throw apiFail("EC2", "RunInstances", "InvalidParameterValue", 400, "Invalid value '" + o.instance_type + "' for InstanceType.");
        var s = IAC.find(A, "aws_subnet", function (x) { return x.id === o.subnet_id; }) || IAC.all(A, "aws_subnet")[0];
        if (!s) throw apiFail("EC2", "RunInstances", "VPCIdNotSpecified", 400, "No default VPC for this user. GroupName is only supported for EC2-Classic and default VPC.");
        if (o.key_name && !IAC.find(A, "aws_key_pair", function (x) { return x.key_name === o.key_name; })) throw apiFail("EC2", "RunInstances", "InvalidKeyPair.NotFound", 400, "The key pair '" + o.key_name + "' does not exist");
        (o.vpc_security_group_ids || []).forEach(function (g) { if (!IAC.find(A, "aws_security_group", function (x) { return x.id === g; })) throw apiFail("EC2", "RunInstances", "InvalidGroup.NotFound", 400, "The security group '" + g + "' does not exist in VPC '" + s.vpc_id + "'"); });
        if (o.iam_instance_profile && !IAC.find(A, "aws_iam_instance_profile", function (x) { return x.name === o.iam_instance_profile; })) throw apiFail("EC2", "RunInstances", "InvalidParameterValue", 400, "Value (" + o.iam_instance_profile + ") for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name");
        o.subnet_id = s.id; o.vpc_id = s.vpc_id; o.availability_zone = s.availability_zone;
        if (!o.vpc_security_group_ids || !o.vpc_security_group_ids.length) { var v = IAC.find(A, "aws_vpc", function (x) { return x.id === s.vpc_id; }); o.vpc_security_group_ids = [v ? v.default_security_group_id : "sg-0default"]; }
        o.id = IAC.newId(A, "i", o.ami + o.subnet_id); o.arn = IAC.arn("ec2", "instance/" + o.id);
        o.private_ip = o.private_ip || IAC.allocPrivateIp(A, s); o.private_dns = "ip-" + o.private_ip.replace(/\./g, "-") + "." + A.region + ".compute.internal";
        var pub = o.associate_public_ip_address != null ? o.associate_public_ip_address : !!s.map_public_ip_on_launch;
        o.associate_public_ip_address = pub; o.public_ip = pub ? IAC.allocPublicIp(A, o) : ""; o.public_dns = pub ? "ec2-" + o.public_ip.replace(/\./g, "-") + "." + A.region + ".compute.amazonaws.com" : "";
        o.instance_state = "running"; o.primary_network_interface_id = IAC.newId(A, "eni", o.id); o.monitoring = !!o.monitoring; o.ebs_optimized = !!o.ebs_optimized;
        var mo = (o.metadata_options && o.metadata_options[0]) || {}; o.metadata_options = [{ http_endpoint: mo.http_endpoint || "enabled", http_tokens: mo.http_tokens || "optional", http_put_response_hop_limit: mo.http_put_response_hop_limit || 1, instance_metadata_tags: mo.instance_metadata_tags || "disabled" }];
        var rb = (o.root_block_device && o.root_block_device[0]) || {}; o.root_block_device = [{ volume_size: rb.volume_size || 8, volume_type: rb.volume_type || "gp3", encrypted: !!rb.encrypted, delete_on_termination: rb.delete_on_termination !== false, kms_key_id: rb.encrypted ? (rb.kms_key_id || IAC.arn("kms", "key/" + M2.hexOf("ebskey", 8) + "-aws-ebs")) : "", iops: 3000, throughput: 125, volume_id: IAC.newId(A, "vol", o.id), device_name: "/dev/sda1" }];
        o.created = A.clockNow || 0;
        return o;
      },
      update: function (A, o, prior) { ["id", "arn", "private_ip", "public_ip", "private_dns", "public_dns", "instance_state", "primary_network_interface_id", "vpc_id", "subnet_id", "availability_zone", "created"].forEach(function (k) { if (o[k] === undefined || isUnk(o[k])) o[k] = prior[k]; }); A.machines && delete A.machines[o.id]; return o; },
      del: function (A, o) { delete A.machines[o.id]; }
    },
    aws_iam_role: { verb: "IAM Role", create: function (A, o) { o.name = o.name || (o.name_prefix || "terraform-") + "2026" + M2.hexOf("rl" + A.seq, 18); try { JSON.parse(o.assume_role_policy); } catch (e) { throw apiFail("IAM", "CreateRole", "MalformedPolicyDocument", 400, "This policy contains invalid Json"); } if (IAC.find(A, "aws_iam_role", function (x) { return x.name === o.name; })) throw apiFail("IAM", "CreateRole", "EntityAlreadyExists", 409, "Role with name " + o.name + " already exists."); o.id = o.name; o.arn = "arn:aws:iam::" + A.account + ":role" + (o.path || "/") + o.name; o.unique_id = "AROA" + M2.hashChars("role" + o.name, 17, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"); o.create_date = new Date((A.clockNow || 0) * 1000).toISOString().replace(/\.\d+Z$/, "Z"); return o; } },
    aws_iam_role_policy: { verb: "IAM Role Policy", create: function (A, o) { o.name = o.name || "terraform-2026" + M2.hexOf("rp" + A.seq, 18); o.id = o.role + ":" + o.name; return o; } },
    aws_iam_role_policy_attachment: { verb: "IAM Role Policy Attachment", create: function (A, o) { if (!IAC.find(A, "aws_iam_role", function (x) { return x.name === o.role; })) throw apiFail("IAM", "AttachRolePolicy", "NoSuchEntity", 404, "The role with name " + o.role + " cannot be found."); o.id = o.role + "-" + M2.hexOf("rpa" + o.policy_arn, 26); return o; } },
    aws_iam_instance_profile: { verb: "IAM Instance Profile", create: function (A, o) { o.name = o.name || "terraform-2026" + M2.hexOf("ip" + A.seq, 18); o.id = o.name; o.arn = "arn:aws:iam::" + A.account + ":instance-profile/" + o.name; o.unique_id = "AIPA" + M2.hashChars("ip" + o.name, 17, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"); o.create_date = new Date(0).toISOString(); return o; } },
    aws_iam_openid_connect_provider: { verb: "IAM OIDC Provider", create: function (A, o) { o.arn = "arn:aws:iam::" + A.account + ":oidc-provider/" + o.url.replace(/^https:\/\//, ""); o.id = o.arn; o.thumbprint_list = o.thumbprint_list && o.thumbprint_list.length ? o.thumbprint_list : ["6938fd4d98bab03faadb97b34396831e3780aea1"]; return o; } },
    aws_ssm_parameter: { verb: "SSM Parameter", create: function (A, o) { if (["String", "StringList", "SecureString"].indexOf(o.type) < 0) throw apiFail("SSM", "PutParameter", "ValidationException", 400, "1 validation error detected: Value '" + o.type + "' at 'type' failed to satisfy constraint: Member must satisfy enum value set: [SecureString, StringList, String]"); if (!o.overwrite && IAC.find(A, "aws_ssm_parameter", function (x) { return x.name === o.name && !x.__managed; })) throw apiFail("SSM", "PutParameter", "ParameterAlreadyExists", 400, "The parameter already exists. To overwrite this request value, set the overwrite option in the request to true."); o.id = o.name; o.arn = IAC.arn("ssm", "parameter" + (o.name.charAt(0) === "/" ? "" : "/") + o.name); o.version = 1; o.tier = o.tier || "Standard"; o.data_type = o.data_type || "text"; o.key_id = o.type === "SecureString" ? (o.key_id || "alias/aws/ssm") : ""; if (o.value == null && o.insecure_value != null) o.value = o.insecure_value; return o; }, update: function (A, o, prior) { o.version = (prior.version || 1) + 1; return o; } },
    aws_dynamodb_table: { verb: "DynamoDB Table", create: function (A, o) { if (o.billing_mode === "PROVISIONED" && (!o.read_capacity || !o.write_capacity)) throw new ApiErr("creating AWS DynamoDB Table (" + o.name + "): read_capacity and write_capacity must be set when billing_mode is \"PROVISIONED\""); if (!(o.attribute || []).some(function (a) { return a.name === o.hash_key; })) throw new ApiErr("all indexes must match a defined attribute. Unmatched indexes: [" + o.hash_key + "]"); o.id = o.name; o.arn = IAC.arn("dynamodb", "table/" + o.name); o.read_capacity = o.read_capacity || 0; o.write_capacity = o.write_capacity || 0; o.point_in_time_recovery = o.point_in_time_recovery && o.point_in_time_recovery.length ? o.point_in_time_recovery : [{ enabled: false }]; o.server_side_encryption = o.server_side_encryption && o.server_side_encryption.length ? o.server_side_encryption : []; return o; } },
    aws_kms_key: { verb: "KMS Key", create: function (A, o) { o.key_id = M2.hexOf("kms" + A.seq++, 8) + "-" + M2.hexOf("k2" + A.seq, 4) + "-" + M2.hexOf("k3" + A.seq, 4) + "-" + M2.hexOf("k4" + A.seq, 4) + "-" + M2.hexOf("k5" + A.seq, 12); o.id = o.key_id; o.arn = IAC.arn("kms", "key/" + o.key_id); o.key_usage = o.key_usage || "ENCRYPT_DECRYPT"; o.description = o.description || ""; o.policy = o.policy || JSON.stringify({ Version: "2012-10-17", Id: "key-default-1", Statement: [{ Sid: "Enable IAM User Permissions", Effect: "Allow", Principal: { AWS: "arn:aws:iam::" + A.account + ":root" }, Action: "kms:*", Resource: "*" }] }); return o; } },
    aws_kms_alias: { verb: "KMS Alias", create: function (A, o) { if (!/^alias\//.test(o.name || "")) throw apiFail("KMS", "CreateAlias", "ValidationException", 400, "Alias must start with the prefix \"alias/\"."); o.id = o.name; o.arn = IAC.arn("kms", o.name); var k = IAC.find(A, "aws_kms_key", function (x) { return x.key_id === o.target_key_id || x.arn === o.target_key_id; }); o.target_key_arn = k ? k.arn : ""; return o; } },
    aws_cloudwatch_log_group: { verb: "CloudWatch Logs Log Group", create: function (A, o) { o.id = o.name; o.arn = IAC.arn("logs", "log-group:" + o.name); return o; } },
    aws_flow_log: { verb: "Flow Log", create: function (A, o) { o.id = IAC.newId(A, "fl", o.vpc_id || o.subnet_id); o.arn = IAC.arn("ec2", "vpc-flow-log/" + o.id); return o; } },
    random_password: { verb: "random password", local: true, create: function (A, o) { var cs = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789" + (o.special === false ? "" : (o.override_special || "!#$%&*()-_=+[]{}<>:?")); o.result = M2.hashChars("pw" + A.seq++ + o.length, o.length, cs); o.bcrypt_hash = "$2a$10$" + M2.hashChars("bc" + o.result, 53, "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"); o.id = "none"; return o; } },
    random_id: { verb: "random id", local: true, create: function (A, o) { o.hex = M2.hexOf("rid" + A.seq++, o.byte_length * 2); o.id = o.hex; o.b64_url = o.hex; o.b64_std = o.hex; o.dec = String(parseInt(o.hex.slice(0, 10), 16)); return o; } },
    random_pet: { verb: "random pet", local: true, create: function (A, o) { var W = ["brave", "calm", "eager", "fond", "kind", "lucky", "proud", "witty"], N = ["otter", "lynx", "heron", "kestrel", "badger", "marten", "wren", "fox"]; var k = A.seq++; o.id = (o.prefix ? o.prefix + o.separator : "") + W[k % 8] + o.separator + N[(k * 3) % 8]; return o; } }
  };
  IAC.PROV = PROV;
  // which API action a change needs (for the caller's permissions)
  var SVC = { s3: "s3", vpc: "ec2", subnet: "ec2", internet: "ec2", route: "ec2", security: "ec2", instance: "ec2", key: "ec2", eip: "ec2", nat: "ec2", iam: "iam", ssm: "ssm", dynamodb: "dynamodb", kms: "kms", cloudwatch: "logs", flow: "ec2" };
  function apiAction(type, verb) {
    var t = type.replace(/^aws_/, ""), svc = SVC[t.split("_")[0]] || "ec2";
    var noun = { aws_s3_bucket: "Bucket", aws_instance: "Instances", aws_security_group: "SecurityGroup", aws_vpc: "Vpc", aws_subnet: "Subnet", aws_iam_role: "Role", aws_ssm_parameter: "Parameter", aws_dynamodb_table: "Table", aws_key_pair: "KeyPair" }[type] || t.split("_").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join("");
    var v = verb === "create" ? (svc === "ec2" && type === "aws_instance" ? "Run" : svc === "ssm" ? "Put" : "Create") : verb === "update" ? (svc === "s3" ? "Put" : "Modify") : (type === "aws_instance" ? "Terminate" : "Delete");
    return svc + ":" + v + noun;
  }
  function permit(sess, type, verb, name) {
    if (PROV[type] && PROV[type].local) return null;
    var id = IAC.identityOf(sess) || IAC.laptopIdentity;
    if (id.error) return apiFail(type.indexOf("aws_s3") === 0 ? "S3" : "EC2", apiAction(type, verb).split(":")[1], id.error, 403, id.msg);
    var act = apiAction(type, verb);
    if (IAC.allowed(id, act)) return null;
    var res = type.indexOf("aws_s3") === 0 ? "arn:aws:s3:::" + name : "arn:aws:" + act.split(":")[0] + ":eu-west-1:" + IAC.ACCOUNT + ":*";
    return apiFail(act.split(":")[0].toUpperCase() === "S3" ? "S3" : act.split(":")[0].toUpperCase(), act.split(":")[1], "AccessDenied", 403, "User: " + id.arn + " is not authorized to perform: " + act + " on resource: \"" + res + "\" because no identity-based policy allows the " + act + " action");
  }
  function needBucket(A, name, op) { if (!IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === name; })) throw apiFail("S3", op, "NoSuchBucket", 404, "The specified bucket does not exist"); }
  // data sources
  function readData(type, o, sess, A) {
    if (type === "aws_caller_identity") { var id = IAC.identityOf(sess) || IAC.laptopIdentity; return { id: A.account, account_id: A.account, arn: id.arn, user_id: id.userId || "AROA" + "SAMPLE" }; }
    if (type === "aws_region") return { id: A.region, name: A.region, description: "Europe (Ireland)", endpoint: "ec2." + A.region + ".amazonaws.com" };
    if (type === "aws_availability_zones") return { id: A.region, names: IAC.AZS.slice(), zone_ids: ["euw1-az1", "euw1-az2", "euw1-az3"], state: o.state || null };
    if (type === "aws_ami") {
      var list = IAC.AMIS.filter(function (x) { return !o.owners || !o.owners.length || o.owners.indexOf(x.owner) >= 0 || (o.owners.indexOf("amazon") >= 0 && x.owner === "137112412989"); });
      (o.filter || []).forEach(function (f) { list = list.filter(function (x) { var v = f.name === "name" ? x.name : f.name === "architecture" ? "x86_64" : f.name === "virtualization-type" ? "hvm" : f.name === "image-id" ? x.id : "x"; return f.values.some(function (p) { return new RegExp("^" + String(p).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(v); }); }); });
      if (o.name_regex) list = list.filter(function (x) { return new RegExp(o.name_regex).test(x.name); });
      if (!list.length) throw new ApiErr("Your query returned no results. Please change your search criteria and try again.");
      if (list.length > 1 && !o.most_recent) throw new ApiErr("Your query returned more than one result. Please try a more specific search criteria, or set `most_recent` attribute to true.");
      var a = list.slice().sort(function (x, y) { return x.created < y.created ? 1 : -1; })[0];
      return { id: a.id, image_id: a.id, name: a.name, arn: IAC.arn("ec2", "image/" + a.id), creation_date: a.created, owner_id: a.owner, architecture: "x86_64" };
    }
    if (type === "aws_ssm_parameter") { var pr = IAC.find(A, "aws_ssm_parameter", function (x) { return x.name === o.name; }); if (!pr) throw new ApiErr("reading SSM Parameter (" + o.name + "): couldn't find resource"); if (!IAC.allowed(IAC.identityOf(sess) || IAC.laptopIdentity, "ssm:GetParameter")) throw new ApiErr("reading SSM Parameter (" + o.name + "): AccessDenied"); return { id: pr.name, arn: pr.arn, type: pr.type, value: pr.value, insecure_value: pr.type === "SecureString" ? null : pr.value, version: pr.version }; }
    if (type === "aws_iam_policy_document") {
      var doc = { Version: o.version || "2012-10-17", Statement: (o.statement || []).map(function (s) { var x = {}; if (s.sid) x.Sid = s.sid; x.Effect = s.effect || "Allow"; if (s.actions) x.Action = s.actions.length === 1 ? s.actions[0] : s.actions.slice().sort(); if (s.not_actions) x.NotAction = s.not_actions; if (s.resources) x.Resource = s.resources.length === 1 ? s.resources[0] : s.resources.slice().sort(); (s.principals || []).forEach(function (p) { x.Principal = x.Principal || {}; x.Principal[p.type] = p.identifiers.length === 1 ? p.identifiers[0] : p.identifiers; }); (s.condition || []).forEach(function (c) { x.Condition = x.Condition || {}; x.Condition[c.test] = x.Condition[c.test] || {}; x.Condition[c.test][c.variable] = c.values.length === 1 ? c.values[0] : c.values; }); return x; }) };
      var js = JSON.stringify(doc, null, 2);
      return { id: String(Math.abs(parseInt(M2.hexOf("pd" + js, 8), 16))), json: js, minified_json: JSON.stringify(doc), version: doc.Version };
    }
    if (type === "aws_vpc") { var v = IAC.all(A, "aws_vpc").filter(function (x) { return (!o.id || x.id === o.id) && (!o.default || x.is_default) && (!o.cidr_block || x.cidr_block === o.cidr_block) && (!o.tags || keys(o.tags).every(function (k) { return (x.tags || {})[k] === o.tags[k]; })); })[0]; if (!v) throw new ApiErr("no matching EC2 VPC found"); return { id: v.id, cidr_block: v.cidr_block, arn: v.arn, tags: v.tags || {}, default: !!v.is_default }; }
    if (type === "aws_iam_openid_connect_provider") { var p = IAC.all(A, "aws_iam_openid_connect_provider").filter(function (x) { return (!o.url || x.url === o.url) && (!o.arn || x.arn === o.arn); })[0]; if (!p) throw new ApiErr("finding IAM OIDC Provider: empty result"); return { id: p.arn, arn: p.arn, url: p.url, client_id_list: p.client_id_list, thumbprint_list: p.thumbprint_list }; }
    if (type === "vault_kv_secret_v2") { if (!IAC.vaultRead) throw new ApiErr("vault provider is not configured"); var r = IAC.vaultRead(sess, o.mount, o.name); if (r.error) throw new ApiErr(r.error); return { id: o.mount + "/data/" + o.name, path: o.mount + "/data/" + o.name, data: r.data, data_json: JSON.stringify(r.data), created_time: r.created }; }
    throw new ApiErr("data source " + type + " is not supported in this lab");
  }

  /* ================================================================== values: normalising and comparing */
  function setNorm(v) { if (!Array.isArray(v)) return v; return v.slice().sort(function (a, b) { var x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; }); }
  function jsonNorm(v) { if (typeof v !== "string") return v; try { return JSON.stringify(sortKeys(JSON.parse(v))); } catch (e) { return v; } }
  function sortKeys(o) { if (Array.isArray(o)) return o.map(sortKeys); if (o && typeof o === "object") { var r = {}; keys(o).sort().forEach(function (k) { r[k] = sortKeys(o[k]); }); return r; } return o; }
  function same(a, b, f) { if (isUnk(a) || isUnk(b)) return a === b; if (f && f.set) { a = setNorm(a || []); b = setNorm(b || []); } if (f && f.json) { a = jsonNorm(a); b = jsonNorm(b); } return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  // convert a configured value to the schema's expectation (numbers from strings, etc.)
  function coerce(v, f) { if (v === null || v === undefined || isUnk(v)) return v; if (f && f.set && Array.isArray(v)) return v; return v; }

  /* ================================================================== the run: evaluating a configuration */
  // A module instance: config + its own variables. Values of resources come from rc (plan or apply)
  function Mod(rc, cfg, path, inputs, parentCtx) {
    this.rc = rc; this.cfg = cfg; this.path = path; this.prefix = path.length ? path.map(function (p) { return "module." + p; }).join(".") : ""; this.inputs = inputs; this.memo = {}; this.busy = {}; this.children = {};
  }
  Mod.prototype = {
    at: function (at, ctxLabel) { return { file: (this.path.length ? this.cfg.dirRel + "/" : "") + at.file, line: at.line, src: at.src, ctx: ctxLabel }; },
    ctx: function (at, ctxLabel, extra) {
      var self = this, c = { at: this.at(at, ctxLabel), sens: false, moduleDir: this.cfg.dir, readFile: this.rc.fs.read, refs: [] };
      c.resolve = function (n, e, cc) { return self.resolve(n, e, cc || c, extra || {}); };
      return c;
    },
    evalIn: function (e, at, ctxLabel, extra) { var c = this.ctx(at, ctxLabel, extra); var v = IAC.evalExpr(e, c); return { v: v, sens: c.sens }; },
    once: function (key, fn) {
      if (key in this.memo) return this.memo[key];
      if (this.busy[key]) throw new TfErr("Cycle: " + key, "Terraform found a cycle: these blocks refer to each other, so neither can be evaluated first.");
      this.busy[key] = true; try { this.memo[key] = fn(); } finally { delete this.busy[key]; }
      return this.memo[key];
    },
    resolve: function (n, e, c, extra) {
      var self = this;
      if (n === "count") { if (extra.count == null) throw IAC.evalErr(c, "Reference to \"count\" in non-counted context", "The \"count\" object can only be used in \"module\", \"resource\", and \"data\" blocks, and only when the \"count\" argument is set.", e); return { index: extra.count }; }
      if (n === "each") { if (extra.each == null) throw IAC.evalErr(c, "Reference to \"each\" in context without for_each", "The \"each\" object can be used only in \"module\" or \"resource\" blocks, and only when the \"for_each\" argument is set.", e); return extra.each; }
      if (n === "self") return extra.self || {};
      if (n === "path") return { module: this.cfg.dir, root: this.rc.dir, cwd: this.rc.dir };
      if (n === "terraform") return { workspace: "default" };
      if (n === "var") { var o = {}; keys(this.cfg.vars).forEach(function (k) { Object.defineProperty(o, k, { enumerable: true, get: function () { var vv = self.varVal(k); if (vv.sens) c.sens = true; return vv.v; } }); }); return o; }
      if (n === "local") { var l = {}; keys(this.cfg.locals).forEach(function (k) { Object.defineProperty(l, k, { enumerable: true, get: function () { var lv = self.localVal(k); if (lv.sens) c.sens = true; return lv.v; } }); }); return l; }
      if (n === "module") { var m = {}; this.cfg.modules.forEach(function (mc) { Object.defineProperty(m, mc.name, { enumerable: true, get: function () { var mv = self.moduleVal(mc); if (mv.sens) c.sens = true; return mv.v; } }); }); return m; }
      if (n === "data") { var d = {}; this.cfg.resources.filter(function (r) { return r.mode === "data"; }).forEach(function (r) { d[r.type] = d[r.type] || {}; Object.defineProperty(d[r.type], r.name, { enumerable: true, get: function () { return self.resVal(r); } }); }); return d; }
      var t = {}; var any = false;
      this.cfg.resources.filter(function (r) { return r.mode === "managed" && r.type === n; }).forEach(function (r) { any = true; Object.defineProperty(t, r.name, { enumerable: true, get: function () { return self.resVal(r); } }); });
      if (!any) throw IAC.evalErr(c, "Reference to undeclared resource", "A managed resource \"" + n + "\" has not been declared in the root module.", e);
      return t;
    },
    varVal: function (k) {
      var self = this;
      return this.once("var." + k, function () {
        var vd = self.cfg.vars[k], v, src = self.inputs ? self.inputs[k] : undefined, sens = vd.sensitive;
        if (src !== undefined) { v = src.v; if (src.sens) sens = true; }
        else if (vd.def) v = IAC.evalExpr(vd.def, self.ctx(vd.at, null));
        else if (self.path.length) throw new TfErr("Missing required argument", "The argument \"" + k + "\" is required, but no definition was found.", self.parentAt);
        else throw new TfErr("No value for required variable", "The root module input variable \"" + k + "\" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.", { file: vd.at.file, line: vd.at.line, src: vd.at.src });
        v = convertVar(v, vd, self);
        vd.validations.forEach(function (vb) {
          if (!vb.attrs.condition) return;
          var c = self.ctx(vd.at, null); var orig = c.resolve; c.resolve = function (n, e, cc) { if (n === "var") { var o = {}; o[k] = v; return o; } return orig(n, e, cc); };
          var ok = IAC.evalExpr(vb.attrs.condition, c);
          if (ok === false) { var msg = vb.attrs.error_message ? IAC.evalExpr(vb.attrs.error_message, self.ctx(vd.at, null)) : "Invalid value."; throw new TfErr("Invalid value for variable", "    ├────────────────\n    │ var." + k + " is " + (sens ? "(sensitive value)" : renderVal(v, 0)) + "\n\n" + msg + "\n\nThis was checked by the validation rule at " + vd.at.file + ":" + vb.line + ",3-13.", { file: vd.at.file, line: vb.attrs.condition.line, src: vd.at.src }); }
        });
        return { v: v, sens: sens };
      });
    },
    localVal: function (k) { var self = this; return this.once("local." + k, function () { var L = self.cfg.locals[k]; var r = self.evalIn(L.e, L.at, null); return r; }); },
    moduleVal: function (mc) {
      var self = this;
      return this.once("module." + mc.name, function () {
        var keysList = self.expand(mc, "module \"" + mc.name + "\"");
        var mk = function (key) {
          var child = self.child(mc, key);
          var o = {}, anySens = false;
          keys(child.cfg.outputs).forEach(function (on) { Object.defineProperty(o, on, { enumerable: true, get: function () { var ov = child.outputVal(on); return ov.v; } }); });
          return o;
        };
        if (keysList.kind === "single") return { v: mk(null), sens: false };
        if (keysList.kind === "count") return { v: keysList.keys.map(mk), sens: false };
        var mm = {}; keysList.keys.forEach(function (k2) { mm[k2] = mk(k2); }); return { v: mm, sens: false };
      });
    },
    child: function (mc, key) {
      var id = mc.name + (key === null || key === undefined ? "" : "[" + JSON.stringify(key) + "]");
      if (this.children[id]) return this.children[id];
      var self = this, rc = this.rc;
      var src = mc.source, dir, rel;
      if (/^\.\.?\//.test(src)) { dir = norm(this.cfg.dir + "/" + src); rel = src.replace(/^\.\//, ""); }
      else { var info = readModulesJson(rc.fs, rc.dir); var mk = this.path.concat([mc.name]).join("."); if (!info[mk]) throw new TfErr("Module not installed", "This module is not yet installed. Run \"terraform init\" to install all modules required by this configuration.", this.at(mc.at)); dir = rc.dir + "/" + info[mk].Dir; rel = info[mk].Dir; }
      var ccfg = loadConfig(rc.fs, dir);
      if (ccfg.empty) throw new TfErr("Unreadable module directory", "Unable to evaluate directory symlink: lstat " + src + ": no such file or directory", this.at(mc.at));
      ccfg.dirRel = rel;
      var verr = validate(ccfg); if (verr.length) throw verr[0];
      var inputs = {}, extra = key === null || key === undefined ? {} : typeof key === "number" ? { count: key } : { each: { key: key, value: self.moduleEachVal(mc, key) } };
      keys(mc.b.attrs).forEach(function (k) {
        if (k === "source" || k === "version" || k === "count" || k === "for_each" || k === "depends_on" || k === "providers") return;
        if (!ccfg.vars[k]) throw new TfErr("Unsupported argument", "An argument named \"" + k + "\" is not expected here.", Object.assign(self.at(mc.at), { line: mc.b.attrs[k].line }));
        var r = self.evalIn(mc.b.attrs[k], Object.assign({}, mc.at, { line: mc.b.attrs[k].line }), "in module \"" + mc.name + "\"", extra);
        inputs[k] = r;
      });
      var m = new Mod(rc, ccfg, this.path.concat([mc.name + (key === null || key === undefined ? "" : "[" + (typeof key === "number" ? key : JSON.stringify(key)) + "]")]), inputs);
      m.parentAt = this.at(mc.at);
      this.children[id] = m;
      rc.mods.push(m);
      return m;
    },
    moduleEachVal: function (mc, key) { var fe = this.evalIn(mc.for_each, mc.at, "in module").v; return Array.isArray(fe) ? key : fe[key]; },
    outputVal: function (k) {
      var self = this;
      return this.once("output." + k, function () {
        var o = self.cfg.outputs[k]; var r = self.evalIn(o.b.attrs.value, Object.assign({}, o.at, { line: o.b.attrs.value.line }), null);
        if (!self.path.length && r.sens && !o.sensitive) throw new TfErr("Output refers to sensitive values", "To reduce the risk of accidentally exporting sensitive data that was\nintended to be only internal, Terraform requires that any root module\noutput containing sensitive data be explicitly marked as sensitive, to\nconfirm your intent.\n\nIf you do intend to export this data, annotate the output value as\nsensitive by adding the following argument:\n    sensitive = true", { file: o.at.file, line: o.at.line, src: o.at.src });
        return { v: r.v, sens: r.sens || o.sensitive };
      });
    },
    // count / for_each → {kind, keys}
    expand: function (r, label) {
      var self = this;
      if (r.count) { var cv = this.evalIn(r.count, Object.assign({}, r.at, { line: r.count.line }), label).v; if (isUnk(cv)) throw new TfErr("Invalid count argument", "The \"count\" value depends on resource attributes that cannot be determined\nuntil apply, so Terraform cannot predict how many instances will be created.\nTo work around this, use the -target argument to first apply only the\nresources that the count depends on.", this.at(Object.assign({}, r.at, { line: r.count.line }), label)); if (typeof cv !== "number" || cv < 0) throw new TfErr("Invalid count argument", "The given \"count\" argument value is unsuitable: must be a whole number, greater than or equal to zero.", this.at(Object.assign({}, r.at, { line: r.count.line }), label)); var ks = []; for (var i = 0; i < cv; i++) ks.push(i); return { kind: "count", keys: ks }; }
      if (r.for_each) { var fe = this.evalIn(r.for_each, Object.assign({}, r.at, { line: r.for_each.line }), label); if (isUnk(fe.v) || (Array.isArray(fe.v) && fe.v.some(isUnk))) throw new TfErr("Invalid for_each argument", "The \"for_each\" map includes keys derived from resource attributes that cannot be determined until apply, and so Terraform cannot determine the full set of keys that will identify the instances of this resource.", this.at(Object.assign({}, r.at, { line: r.for_each.line }), label)); if (fe.sens) throw new TfErr("Invalid for_each argument", "Sensitive values, or values derived from sensitive values, cannot be used as for_each arguments. If used, the sensitive value could be exposed as a resource instance key.", this.at(Object.assign({}, r.at, { line: r.for_each.line }), label)); var v = fe.v; if (Array.isArray(v)) { if (v.some(function (x) { return typeof x !== "string"; })) throw new TfErr("Invalid for_each argument", "The given \"for_each\" argument value is unsuitable: the \"for_each\" argument must be a map, or set of strings, and you have provided a value of type tuple.", this.at(Object.assign({}, r.at, { line: r.for_each.line }), label)); return { kind: "each", keys: IAC.FN.toset(v), set: true, val: v }; } return { kind: "each", keys: keys(v || {}).sort(), val: v }; }
      return { kind: "single", keys: [null] };
    },
    resVal: function (r) {
      var self = this;
      return this.once("res." + r.mode + "." + r.type + "." + r.name, function () {
        var ex = self.expand(r, r.ctx), mk = function (key) { var a = addrOf(self.prefix, r.mode, r.type, r.name, key); var inst = self.rc.instanceValue(self, r, key, ex, a); return inst; };
        if (ex.kind === "single") return mk(null);
        if (ex.kind === "count") { var l = ex.keys.map(mk); Object.defineProperty(l, "__resAddr", { value: r.type + "." + r.name }); return l; }
        var mm = {}; ex.keys.forEach(function (k) { mm[k] = mk(k); }); return mm;
      });
    }
  };
  function readModulesJson(fs, dir) { var t = fs.read(dir + "/.terraform/modules/modules.json"); var o = {}; if (t) JSON.parse(t).Modules.forEach(function (m) { o[m.Key] = m; }); return o; }
  function convertVar(v, vd, mod) {
    var t = vd.type ? (vd.type.k === "ref" ? vd.type.n : vd.type.k === "call" ? vd.type.n + "(" + (vd.type.args[0] && (vd.type.args[0].n || "")) + ")" : "") : "any";
    function bad(need) { return new TfErr("Invalid value for input variable", "The given value is not suitable for var." + vd.name + " declared at " + vd.at.file + ":" + vd.at.line + ",1-" + (13 + vd.name.length) + ": " + need + ".", null); }
    if (v === null || v === undefined || isUnk(v)) return v;
    if (t === "number") { if (typeof v === "number") return v; if (/^-?\d+(\.\d+)?$/.test(String(v))) return +v; throw bad("a number is required"); }
    if (t === "bool") { if (typeof v === "boolean") return v; if (v === "true" || v === "false") return v === "true"; throw bad("a bool is required"); }
    if (t === "string") { if (typeof v === "object") throw bad("string required"); return String(v); }
    if (/^(list|set)\(/.test(t)) { if (!Array.isArray(v)) throw bad("list of " + t.replace(/^\w+\(|\)$/g, "") + " required"); return /^set/.test(t) ? IAC.FN.toset(v) : v; }
    if (/^map\(/.test(t)) { if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("map of " + t.replace(/^map\(|\)$/g, "") + " required"); return v; }
    return v;
  }

  /* ---------------- the plan for one resource instance */
  function evalBlock(mod, r, sch, body, extra, prior, sensOut, path) {
    var o = {}, unkAny = false;
    keys(sch.a).forEach(function (k) {
      var f = sch.a[k], e = body.attrs[k];
      if (e) {
        var ctx = mod.ctx(Object.assign({}, r.at, { line: e.line }), r.ctx, extra); var v = IAC.evalExpr(e, ctx);
        if (ctx.sens || f.s) sensOut[(path || "") + k] = true;
        o[k] = coerce(v, f);
      } else if (f.c && !f.r) o[k] = prior && prior[k] !== undefined ? prior[k] : (f.o && f.def !== undefined ? f.def : UNK);
      else o[k] = f.def !== undefined ? f.def : null;
    });
    if (sch.b) keys(sch.b).forEach(function (bn) {
      var bs = sch.b[bn], list = body.blocks.filter(function (x) { return x.type === bn; });
      if (!list.length && body.attrs[bn]) { var ctx2 = mod.ctx(Object.assign({}, r.at, { line: body.attrs[bn].line }), r.ctx, extra); o[bn] = IAC.evalExpr(body.attrs[bn], ctx2); return; }
      if (!list.length) { o[bn] = bs.comp ? (prior && prior[bn] !== undefined ? prior[bn] : UNK) : []; return; }
      o[bn] = list.map(function (b, i) { return evalBlock(mod, r, bs, b, extra, prior && prior[bn] && prior[bn][i], sensOut, (path || "") + bn + "."); });
      if (bs.comp && prior && prior[bn] && prior[bn][0]) o[bn] = o[bn].map(function (x, i) { var p = prior[bn][i] || {}; keys(x).forEach(function (k) { if (isUnk(x[k]) && p[k] !== undefined) x[k] = p[k]; }); return x; });
    });
    return o;
  }
  // The Run: plan or apply over a working directory
  function Run(o) {
    this.sess = o.sess; this.fs = o.fs; this.dir = o.dir; this.A = IAC.aws(o.sess.sys); this.state = o.state; this.prior = flat(o.state); this.refreshed = o.refreshed || this.prior; this.phase = "plan";
    this.changes = {}; this.mods = []; this.dataVals = {}; this.order = []; this.opts = o.opts || {}; this.applied = {}; this.warnings = [];
    this.defaultTags = o.defaultTags || {};
  }
  Run.prototype.instanceValue = function (mod, r, key, ex, addr) {
    var rc = this;
    var sch = (r.mode === "managed" ? SCHEMA : DATA)[r.type];
    var extra = ex.kind === "count" ? { count: key } : ex.kind === "each" ? { each: { key: key, value: ex.set ? key : ex.val[key] } } : {};
    if (rc.phase === "apply" && rc.applied[addr]) return exposed(rc.applied[addr].attrs, rc.applied[addr].sensMap, r.type);
    if (rc.phase === "apply" && rc.changes[addr] && rc.changes[addr].action === "noop") return exposed(rc.changes[addr].after, rc.changes[addr].sensMap, r.type);
    if (r.mode === "data") {
      if (rc.dataVals[addr]) return rc.dataVals[addr];
      var sensD = {}, cfg = evalBlock(mod, r, sch, r.b, extra, null, sensD);
      var val;
      var cfgUnknown = keys(r.b.attrs).some(function (k) { return k in sch.a && deepUnk(cfg[k]); }) || keys(sch.b || {}).some(function (k) { return r.b.blocks.some(function (x) { return x.type === k; }) && deepUnk(cfg[k]); });
      keys(cfg).forEach(function (k) { if (isUnk(cfg[k]) && !(k in r.b.attrs)) cfg[k] = null; });
      if (cfgUnknown) { val = {}; keys(sch.a).forEach(function (k) { val[k] = cfg[k] !== undefined && cfg[k] !== null && !isUnk(cfg[k]) && !sch.a[k].c ? cfg[k] : UNK; }); rc.changes[addr] = { addr: addr, action: "read", mod: mod, r: r, key: key, after: val, deferred: true, extra: extra }; }
      else {
        try { val = Object.assign({}, cfg, readData(r.type, cfg, rc.sess, rc.A)); }
        catch (e) { if (e instanceof ApiErr) throw new TfErr(e.msg.indexOf("operation error") === 0 ? "reading " + r.type : e.msg, e.msg.indexOf("operation error") === 0 ? e.msg : "", Object.assign(mod.at(r.at), { ctx: r.ctx, file: r.at.file, line: r.at.line })); throw e; }
        rc.reads = rc.reads || []; rc.reads.push({ addr: addr, id: val.id });
      }
      keys(sch.a).forEach(function (k) { if (sch.a[k].s) sensD[k] = true; });
      var ex2 = exposed(val, sensD, r.type);
      rc.dataVals[addr] = ex2;
      return ex2;
    }
    var prior = rc.refreshed[addr] ? rc.refreshed[addr].attrs : null;
    var sensMap = {};
    var desired = evalBlock(mod, r, sch, r.b, extra, prior, sensMap);
    keys(sch.a).forEach(function (k) { if (sch.a[k].s) sensMap[k] = true; });
    if ("tags_all" in sch.a) { var dt = rc.defaultTags || {}; desired.tags_all = deepUnk(desired.tags) ? UNK : Object.assign({}, dt, desired.tags || {}); if (!keys(desired.tags_all).length && !desired.tags) desired.tags_all = {}; }
    var lc = r.lifecycle, ign = lc && lc.attrs.ignore_changes ? (lc.attrs.ignore_changes.k === "tuple" ? lc.attrs.ignore_changes.items.map(function (x) { return x.k === "ref" ? x.n : IAC.exprText(x); }) : lc.attrs.ignore_changes.k === "ref" && lc.attrs.ignore_changes.n === "all" ? ["*"] : []) : [];
    var action, forces = [], changed = [];
    var forceReplace = (rc.opts.replace || []).indexOf(addr) >= 0;
    if (!prior) action = "create";
    else {
      keys(sch.a).concat(keys(sch.b || {})).forEach(function (k) {
        var f = sch.a[k] || sch.b[k]; if (!f) return;
        if (sch.a[k] && sch.a[k].c && !sch.a[k].o && !sch.a[k].r && k !== "tags_all") return;
        if (ign.indexOf(k) >= 0 || ign.indexOf("*") >= 0) { desired[k] = prior[k]; return; }
        if (k === "tags_all" && ign.indexOf("tags") >= 0) { desired[k] = prior[k]; return; }
        var d = desired[k], p = prior[k];
        if (isUnk(d) && sch.b && sch.b[k] && sch.b[k].comp) return;
        if (sch.b && sch.b[k] && !sch.b[k].comp && (d == null || (Array.isArray(d) && !d.length)) && (p == null || (Array.isArray(p) && !p.length))) return;
        if (!same(d, p, sch.a[k] || { set: sch.b[k].set })) { changed.push(k); if (sch.a[k] && sch.a[k].f) forces.push(k); }
      });
      if (r.type === "aws_instance" && changed.indexOf("user_data") >= 0 && desired.user_data_replace_on_change) forces.push("user_data");
      action = forceReplace || forces.length ? "replace" : changed.length ? "update" : "noop";
    }
    var after = {};
    keys(sch.a).concat(keys(sch.b || {})).forEach(function (k) { var f = sch.a[k]; after[k] = desired[k]; if (f && f.c && !f.o && !f.r && k !== "tags_all") after[k] = action === "update" || action === "noop" ? prior[k] : (k === "id" && r.type.indexOf("aws_s3_bucket") === 0 && desired.bucket && !isUnk(desired.bucket) && r.type !== "aws_s3_bucket" ? desired.bucket : UNK); });
    if (action === "noop") after = Object.assign({}, prior, desired, { tags_all: desired.tags_all !== undefined ? desired.tags_all : prior.tags_all }), keys(sch.a).forEach(function (k) { if (isUnk(after[k])) after[k] = prior[k]; });
    var deps = IAC.bodyRefs(r.b).map(function (x) { return depAddr(mod, x); }).filter(Boolean);
    if (r.depends_on && r.depends_on.k === "tuple") r.depends_on.items.forEach(function (x) { var t = IAC.exprText(x); var d2 = depAddr(mod, t.split(".")); if (d2) deps.push(d2); });
    rc.changes[addr] = { addr: addr, movedFrom: rc.refreshed[addr] && rc.refreshed[addr].movedFrom, action: action, before: prior, after: after, changed: changed, forces: forceReplace ? [] : forces, requested: forceReplace, mod: mod, r: r, key: key, extra: extra, sensMap: sensMap, deps: dedupe(deps), lifecycle: lc };
    return exposed(after, sensMap, r.type);
  };
  function dedupe(l) { return l.filter(function (x, i) { return l.indexOf(x) === i; }); }
  function depAddr(mod, rf) {
    var p = mod.prefix ? mod.prefix + "." : "";
    if (rf[0] === "data" && rf[2]) return p + "data." + rf[1] + "." + rf[2];
    if (rf[0] === "module" && rf[1]) return p + "module." + rf[1];
    if (/_/.test(rf[0]) && rf[1] && ["var", "local", "count", "each", "path", "self", "terraform"].indexOf(rf[0]) < 0) return p + rf[0] + "." + rf[1];
    return null;
  }
  function exposed(attrs, sensMap, type) {
    var o = {}; keys(attrs || {}).forEach(function (k) { o[k] = attrs[k]; });
    Object.defineProperty(o, "__sensAttrs", { value: sensMap || {} }); Object.defineProperty(o, "__kind", { value: type });
    return o;
  }

  /* ---------------- plan over the whole configuration */
  function planAll(rc, cfg) {
    var root = new Mod(rc, cfg, [], rc.inputs);
    rc.root = root; rc.mods = [root];
    // moved blocks: rename prior state addresses before diffing
    cfg.moved.forEach(function (mv) { var from = IAC.exprText(mv.from), to = IAC.exprText(mv.to); keys(rc.refreshed).forEach(function (a) { if (a === from || a.indexOf(from + "[") === 0) { var na = to + a.slice(from.length); if (!rc.refreshed[na]) { var pa = parseAddr(na); rc.refreshed[na] = Object.assign({}, rc.refreshed[a], { module: pa.module, name: pa.name, type: pa.type, key: pa.key, movedFrom: a }); delete rc.refreshed[a]; (rc.moved = rc.moved || []).push({ from: a, to: na }); } } }); });
    // import blocks
    cfg.imports.forEach(function (im) {
      var to = IAC.exprText(im.to), idv = IAC.evalExpr(im.id, root.ctx(im.at, null));
      if (rc.refreshed[to]) return;
      var type = to.replace(/\[.*$/, "").split(".").slice(-2)[0];
      var obj = IAC.find(rc.A, type, function (x) { return x.id === idv; });
      if (!obj) throw new TfErr("Cannot import non-existent remote object", "While attempting to import an existing object to \"" + to + "\", the provider detected that no object exists with the given id. Only pre-existing objects can be imported; check that the id is correct and that it is associated with the provider's configured region or endpoint, or use \"terraform apply\" to create a new remote object for this resource.", { file: im.at.file, line: im.at.line, src: im.at.src });
      rc.refreshed[to] = { mode: "managed", type: type, name: to.replace(/\[.*$/, "").split(".").pop(), module: "", key: null, attrs: clone(obj), deps: [] };
      (rc.imported = rc.imported || {})[to] = idv;
    });
    var walk = function (mod) {
      mod.cfg.resources.forEach(function (r) { mod.resVal(r); });
      mod.cfg.modules.forEach(function (mc) { mod.moduleVal(mc); var ex = mod.expand(mc, "module"); ex.keys.forEach(function (k) { walk(mod.child(mc, k)); }); });
      keys(mod.cfg.outputs).forEach(function (k) { mod.outputVal(k); });
      keys(mod.cfg.locals).forEach(function (k) { mod.localVal(k); });
    };
    walk(root);
    // orphans: in state, not in configuration → destroy
    keys(rc.refreshed).forEach(function (a) { var s = rc.refreshed[a]; if (s.mode !== "managed" || rc.changes[a]) return; rc.changes[a] = { addr: a, action: "delete", before: s.attrs, after: null, r: { type: s.type, name: s.name }, orphan: true, deps: s.deps || [], st: s }; });
    // targeting
    if (rc.opts.target && rc.opts.target.length) {
      var keep = {};
      var addDeps = function (a) { if (keep[a]) return; keep[a] = true; var c = rc.changes[a]; (c && c.deps || []).forEach(function (d) { keys(rc.changes).forEach(function (x) { if (x === d || x.indexOf(d + "[") === 0 || x.indexOf(d + ".") === 0) addDeps(x); }); }); };
      rc.opts.target.forEach(function (t) { keys(rc.changes).forEach(function (a) { if (a === t || a.indexOf(t + "[") === 0 || a.indexOf(t + ".") === 0) addDeps(a); }); });
      keys(rc.changes).forEach(function (a) { if (!keep[a]) delete rc.changes[a]; });
    }
    if (rc.opts.destroy) keys(rc.changes).forEach(function (a) { var c = rc.changes[a]; if (c.r && rc.refreshed[a] && c.action !== "read") { c.action = "delete"; c.after = null; } else delete rc.changes[a]; });
    keys(rc.changes).forEach(function (a) { var c = rc.changes[a]; if (rc.imported && rc.imported[a]) c.importId = rc.imported[a]; if ((c.action === "delete" || c.action === "replace") && c.lifecycle) { var pd = c.lifecycle.attrs.prevent_destroy; if (pd && pd.v === true) throw new TfErr("Instance cannot be destroyed", "Resource " + a + " has lifecycle.prevent_destroy set, but the plan calls for this resource to be destroyed. To avoid this error and continue with the plan, either disable lifecycle.prevent_destroy or reduce the scope of the plan using the -target option.", Object.assign({}, c.r.at, { line: c.lifecycle.line, ctx: c.r.ctx })); } });
    // outputs
    rc.outputs = {};
    keys(cfg.outputs).forEach(function (k) { rc.outputs[k] = root.outputVal(k); });
  }

  /* ================================================================== rendering values the way Terraform does */
  function q(s) { return JSON.stringify(s); }
  function sp(n) { return new Array(n + 1).join(" "); }
  // unsigned: items at ind+step, closing bracket at ind (state show, outputs)
  function renderVal(v, ind, sensitive, step) {
    step = step || 2;
    if (sensitive) return "(sensitive value)";
    if (isUnk(v)) return "(known after apply)";
    if (v === null || v === undefined) return "null";
    if (typeof v === "string") { if (/\n./.test(v)) return "<<-EOT\n" + v.replace(/\n$/, "").split("\n").map(function (l) { return sp(ind + step) + l; }).join("\n") + "\n" + sp(ind) + "EOT"; return q(v); }
    if (typeof v !== "object") return String(v);
    if (Array.isArray(v)) { if (!v.length) return "[]"; return "[\n" + v.map(function (x) { return sp(ind + step) + renderVal(x, ind + step, false, step) + ","; }).join("\n") + "\n" + sp(ind) + "]"; }
    var ks = keys(v).filter(function (k) { return k.indexOf("__") !== 0; }).sort(); if (!ks.length) return "{}";
    var w = Math.max.apply(null, ks.map(function (k) { return q(k).length; }));
    return "{\n" + ks.map(function (k) { return sp(ind + step) + q(k) + sp(w - q(k).length + 1) + "= " + renderVal(v[k], ind + step, false, step); }).join("\n") + "\n" + sp(ind) + "}";
  }
  // signed (plans): the value's line has its sign at column col; nested items get the same sign
  function renderSigned(v, col, sign, sensitive, obj) {
    if (sensitive || isUnk(v) || v === null || v === undefined || typeof v !== "object") return renderVal(v, col + 2, sensitive, 4);
    if (Array.isArray(v)) { if (!v.length) return "[]"; return "[\n" + v.map(function (x) { return sp(col + 4) + sign + " " + renderSigned(x, col + 4, sign, false, obj) + ","; }).join("\n") + "\n" + sp(col + 2) + "]"; }
    var ks = keys(v).filter(function (k) { return k.indexOf("__") !== 0 && !(obj && (v[k] === null || v[k] === "" || (Array.isArray(v[k]) && !v[k].length) || v[k] === false && k === "self")); }).sort(); if (!ks.length) return "{}";
    var kn = function (k) { return obj ? k : q(k); };
    var w = Math.max.apply(null, ks.map(function (k) { return kn(k).length; }));
    return "{\n" + ks.map(function (k) { return sp(col + 4) + sign + " " + kn(k) + sp(w - kn(k).length + 1) + "= " + renderSigned(v[k], col + 4, sign, false, false); }).join("\n") + "\n" + sp(col + 2) + "}";
  }
  function renderListDiff(b, a, col) {
    var L = [], un = 0;
    (b || []).forEach(function (x) { if (!(a || []).some(function (y) { return same(x, y); })) L.push(sp(col + 4) + "- " + renderSigned(x, col + 4, "-") + ","); else un++; });
    (a || []).forEach(function (x) { if (!(b || []).some(function (y) { return same(x, y); })) L.push(sp(col + 4) + "+ " + renderSigned(x, col + 4, "+") + ","); });
    if (un) L.push(sp(col + 6) + "# (" + un + " unchanged element" + (un > 1 ? "s" : "") + " hidden)");
    return "[\n" + L.join("\n") + "\n" + sp(col + 2) + "]";
  }
  IAC.renderVal = renderVal;
  function fmtKey(k) { return /^[A-Za-z_][\w-]*$/.test(k) ? k : q(k); }
  function sym(a) { return { create: "+", "delete": "-", update: "~", replace: "-/+", read: "<=", noop: " " }[a]; }
  // the body of a resource in a plan (create: all values; update: changed ones)
  function renderBody(c, ind) {
    var sch = (c.r && (SCHEMA[c.r.type] || DATA[c.r.type])) || SCHEMA[c.st && c.st.type] || { a: {} }, L = [], pad = new Array(ind + 1).join(" ");
    var before = c.before || {}, after = c.after || {}, act = c.action, hidden = 0, hiddenB = 0;
    var names = keys(sch.a).filter(function (k) { return !(sch.b && sch.b[k] && sch.b[k].attr && Array.isArray(after[k] || before[k])); });
    var rows = [];
    names.forEach(function (k) {
      var f = sch.a[k], a = after[k], b = before[k], sens = (c.sensMap || {})[k] || f.s;
      if (act === "create" || act === "read") { if (a === null || a === undefined || (Array.isArray(a) && !a.length && !(sch.b && sch.b[k])) || (typeof a === "object" && !Array.isArray(a) && a && !isUnk(a) && !keys(a).length)) return; rows.push(["+", k, renderSigned(a, ind, "+", sens)]); return; }
      if (act === "delete") { if (b === null || b === undefined || b === "" || (Array.isArray(b) && !b.length) || (b && typeof b === "object" && !Array.isArray(b) && !keys(b).length)) return; rows.push(["-", k, renderSigned(b, ind, "-", sens) + " -> null"]); return; }
      var ch = !same(a, b, f);
      if (k === "id" && b) { rows.push([" ", k, renderVal(b, ind + 4)]); return; }
      if (!ch) { if (k === "name" || k === "bucket" || k === "tags") { if (b !== null && b !== undefined && !(typeof b === "object" && !keys(b).length)) { rows.push([" ", k, renderVal(b, ind + 4, sens)]); return; } } if (b !== null && b !== undefined && b !== "") hidden++; return; }
      if (isUnk(a) && act === "replace" && f.c) { rows.push(["~", k, renderVal(b, ind + 4, sens) + " -> (known after apply)"]); return; }
      if ((b === null || b === undefined) && !isUnk(a)) { rows.push(["+", k, renderSigned(a, ind, "+", sens)]); return; }
      if (a === null || a === undefined) { rows.push(["-", k, renderSigned(b, ind, "-", sens) + " -> null"]); return; }
      if (!sens && Array.isArray(a) && Array.isArray(b)) { rows.push(["~", k, renderListDiff(b, a, ind)]); return; }
      if (!sens && a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) && !isUnk(a)) { rows.push(["~", k, renderMapDiff(b, a, ind)]); return; }
      rows.push(["~", k, renderVal(b, ind + 4, sens) + " -> " + renderVal(a, ind + 4, sens) + ((c.forces || []).indexOf(k) >= 0 ? " # forces replacement" : "")]);
    });
    rows.sort(function (x, y) { return x[1] < y[1] ? -1 : 1; });
    var w = Math.max.apply(null, [0].concat(rows.map(function (r) { return r[1].length; })));
    rows.forEach(function (r) { L.push(pad + r[0] + " " + r[1] + new Array(w - r[1].length + 2).join(" ") + "= " + r[2]); });
    if (sch.b) keys(sch.b).forEach(function (bn) {
      var bs = sch.b[bn], a = after[bn], b = before[bn];
      if (act === "create" && isUnk(a)) { L.push(pad + "+ " + bn + " (known after apply)"); return; }
      var al = Array.isArray(a) ? a : [], bl = Array.isArray(b) ? b : [];
      if ((act === "update" || act === "replace") && same(a, b, { set: bs.set })) { if (bl.length) hiddenB += bl.length; return; }
      if (act === "update" || act === "replace") {
        if (bs.attr) { var un2 = al.filter(function (x) { return bl.some(function (y) { return same(x, y); }); }).length; L.push(pad + "~ " + bn + " = [\n" + bl.filter(function (x) { return !al.some(function (y) { return same(x, y); }); }).map(function (x) { return pad + "    - " + renderSigned(x, ind + 4, "-", false, true) + ","; }).concat(al.filter(function (x) { return !bl.some(function (y) { return same(x, y); }); }).map(function (x) { return pad + "    + " + renderSigned(x, ind + 4, "+", false, true) + ","; })).join("\n") + (un2 ? "\n" + pad + "      # (" + un2 + " unchanged element" + (un2 > 1 ? "s" : "") + " hidden)" : "") + "\n" + pad + "  ]"); return; }
        al.forEach(function (x, i) { var y = bl[i]; if (y && same(x, y)) { hiddenB++; return; } L.push(pad + (y ? "~ " : "+ ") + bn + " {"); var sub = { action: y ? "update" : "create", before: y || {}, after: x, r: null, sensMap: {} }; L.push(renderNested(bs, sub, ind + 4)); L.push(pad + "  }"); });
        bl.slice(al.length).forEach(function (y) { L.push(pad + "- " + bn + " {"); L.push(renderNested(bs, { action: "delete", before: y, after: {} }, ind + 4)); L.push(pad + "  }"); });
        return;
      }
      var list = act === "delete" ? bl : al, s = act === "delete" ? "-" : "+";
      if (bs.attr && !list.length) return;
      if (bs.attr && act === "create") { L.push(pad + "+ " + bn + " = " + renderSigned(list, ind, "+", false, true)); return; }
      list.forEach(function (x) { L.push(pad + s + " " + bn + " {"); L.push(renderNested(bs, { action: act === "delete" ? "delete" : "create", before: act === "delete" ? x : {}, after: act === "delete" ? {} : x }, ind + 4)); L.push(pad + "  }"); });
    });
    if (hidden) L.push(pad + "  # (" + hidden + " unchanged attribute" + (hidden > 1 ? "s" : "") + " hidden)");
    if (hiddenB) L.push(pad + "  # (" + hiddenB + " unchanged block" + (hiddenB > 1 ? "s" : "") + " hidden)");
    return L.filter(function (x) { return x !== ""; }).join("\n");
  }
  function renderNested(bs, c, ind) { var fake = { r: null, action: c.action, before: c.before, after: c.after, sensMap: {} }; var saveSch = { a: bs.a, b: bs.b }; return renderWith(saveSch, fake, ind); }
  function renderWith(sch, c, ind) { var tmpType = "__nested" + ind; SCHEMA[tmpType] = sch; c.r = { type: tmpType }; try { return renderBody(c, ind); } finally { delete SCHEMA[tmpType]; } }
  function renderMapDiff(b, a, col) {
    var ks = dedupe(keys(b).concat(keys(a))).sort(), L = [], w = Math.max.apply(null, ks.map(function (k) { return q(k).length; })), un = 0;
    ks.forEach(function (k) { var kk = q(k) + sp(w - q(k).length + 1); if (!(k in b)) L.push(sp(col + 4) + "+ " + kk + "= " + renderSigned(a[k], col + 4, "+")); else if (!(k in a)) L.push(sp(col + 4) + "- " + kk + "= " + renderSigned(b[k], col + 4, "-") + " -> null"); else if (!same(a[k], b[k])) L.push(sp(col + 4) + "~ " + kk + "= " + renderVal(b[k], col + 6) + " -> " + renderVal(a[k], col + 6)); else un++; });
    if (un) L.push(sp(col + 6) + "# (" + un + " unchanged element" + (un > 1 ? "s" : "") + " hidden)");
    return "{\n" + L.join("\n") + "\n" + sp(col + 2) + "}";
  }
  function resHeader(c) {
    var a = c.addr, t = c.r ? c.r.type : c.st.type, n = (c.r ? c.r.name : c.st.name), mode = /(^|\.)data\./.test(a) ? "data" : "resource";
    var why = { create: c.importId ? " will be imported" : " will be created", "delete": c.orphan ? " will be destroyed\n  # (because " + a.replace(/\[.*\]$/, "") + " is not in configuration)" : " will be destroyed", update: " will be updated in-place", replace: c.requested ? " will be replaced, as requested" : " must be replaced", read: " will be read during apply\n  # (config refers to values not yet known)" }[c.action];
    if (c.importId && c.action === "update") why = " will be updated in-place\n  # (imported from \"" + c.importId + "\")";
    if (c.importId && c.action === "noop") why = " will be imported\n    resource \"" + t + "\" \"" + n + "\" {";
    var lines = ["  # " + a + why];
    if (c.movedFrom) lines[0] = "  # " + c.movedFrom + " has moved to " + a + (c.action === "noop" ? "" : "\n  # " + a + why);
    var openSym = sym(c.action);
    lines.push((openSym.length === 3 ? openSym : "  " + openSym) + " " + (mode === "data" ? "data" : "resource") + " \"" + t + "\" \"" + n + "\" {");
    return lines.join("\n");
  }
  function renderPlan(rc, o) {
    var L = [], ch = keys(rc.changes).map(function (a) { return rc.changes[a]; }).filter(function (c) { return c.action !== "noop" || c.importId || c.movedFrom; });
    ch.sort(function (a, b) { return a.addr < b.addr ? -1 : 1; });
    var syms = {}; ch.forEach(function (c) { syms[c.action === "noop" ? "import" : c.action] = 1; });
    var outCh = keys(rc.outputs || {}).filter(function (k) { var prev = (rc.state.outputs || {})[k]; var v = rc.outputs[k]; return !prev || !same(prev.value, v.v) || isUnk(v.v); });
    var removedOuts = keys(rc.state.outputs || {}).filter(function (k) { return !(k in (rc.outputs || {})); });
    var counts = { add: 0, change: 0, destroy: 0, imp: 0 };
    ch.forEach(function (c) { if (c.action === "create") counts.add++; if (c.action === "update") counts.change++; if (c.action === "delete") counts.destroy++; if (c.action === "replace") { counts.add++; counts.destroy++; } if (c.importId) counts.imp++; });
    if (!ch.filter(function (c) { return c.action !== "read" || true; }).length && !outCh.length && !removedOuts.length) return { text: null, counts: counts, any: false };
    if (ch.length) {
      L.push("Terraform used the selected providers to generate the following execution", "plan. Resource actions are indicated with the following symbols:");
      if (syms.create) L.push("  + create"); if (syms.update) L.push("  ~ update in-place"); if (syms["delete"]) L.push("  - destroy"); if (syms.replace) L.push("-/+ destroy and then create replacement"); if (syms.read) L.push(" <= read (data resources)");
      L.push("", "Terraform will perform the following actions:", "");
      ch.forEach(function (c) {
        if (c.action === "noop" && c.movedFrom && !c.importId) { L.push("  # " + c.movedFrom + " has moved to " + c.addr, "    resource \"" + c.r.type + "\" \"" + c.r.name + "\" {", "        id = " + q(c.after.id), "        # (" + (keys(c.after).length - 1) + " unchanged attributes hidden)", "    }", ""); return; }
        if (c.action === "noop" && c.importId) { L.push("  # " + c.addr + " will be imported", "    resource \"" + c.r.type + "\" \"" + c.r.name + "\" {"); L.push(renderBody({ r: c.r, action: "update", before: c.before, after: c.after, sensMap: c.sensMap }, 8)); L.push("    }", ""); return; }
        L.push(resHeader(c)); L.push(renderBody(c, 6)); L.push("    }", "");
      });
      var s = "Plan: " + (counts.imp ? counts.imp + " to import, " : "") + counts.add + " to add, " + counts.change + " to change, " + counts.destroy + " to destroy.";
      L.push(s);
    }
    if (outCh.length || removedOuts.length) {
      L.push("", "Changes to Outputs:");
      var w = Math.max.apply(null, outCh.concat(removedOuts).map(function (k) { return k.length; }));
      outCh.forEach(function (k) { var prev = (rc.state.outputs || {})[k], v = rc.outputs[k]; var pad = new Array(w - k.length + 2).join(" "); L.push(prev ? "  ~ " + k + pad + "= " + renderVal(prev.value, 4, prev.sensitive) + " -> " + renderVal(v.v, 4, v.sens) : "  + " + k + pad + "= " + renderSigned(v.v, 2, "+", v.sens)); });
      removedOuts.forEach(function (k) { L.push("  - " + k + new Array(w - k.length + 2).join(" ") + "= " + renderVal(rc.state.outputs[k].value, 4, rc.state.outputs[k].sensitive) + " -> null"); });
    }
    return { text: L.join("\n"), counts: counts, any: true, resChanges: ch.length };
  }
  IAC.renderPlan = renderPlan;

  /* ================================================================== refresh (with drift) */
  function refresh(sess, state, io, quiet) {
    var A = IAC.aws(sess.sys), f = flat(state), refreshed = {}, drift = [];
    keys(f).forEach(function (a) {
      var s = f[a];
      if (s.mode === "data") return;
      if (!quiet) out(io, a + ": Refreshing state... [id=" + s.attrs.id + "]\n");
      if (PROV[s.type] && PROV[s.type].local) { refreshed[a] = s; return; }
      var real = IAC.bag(A, s.type)[s.attrs.id];
      if (!real && PROV[s.type] && PROV[s.type].idOf) real = IAC.find(A, s.type, function (x) { return x.id === s.attrs.id; });
      if (!real) { drift.push({ addr: a, gone: true, st: s }); return; }
      var sch = SCHEMA[s.type], cur = clone(real); delete cur.__managed; delete cur.objects; delete cur.items; delete cur.created; delete cur.is_default;
      var diffs = keys(sch ? sch.a : {}).concat(keys((sch && sch.b) || {})).filter(function (k) { var fl = (sch.a[k] || { set: sch.b[k].set }); return !same(cur[k], s.attrs[k], fl) && !(cur[k] == null && (s.attrs[k] == null || s.attrs[k] === "" || (Array.isArray(s.attrs[k]) && !s.attrs[k].length))); });
      if (diffs.length) drift.push({ addr: a, attrs: diffs, before: s.attrs, after: cur, st: s });
      refreshed[a] = Object.assign({}, s, { attrs: Object.assign({}, s.attrs, cur) });
    });
    return { refreshed: refreshed, drift: drift };
  }
  function renderDrift(drift, refreshOnly) {
    if (!drift.length) return "";
    var L = ["", "Note: Objects have changed outside of Terraform", "", "Terraform detected the following changes made outside of Terraform since the", "last \"terraform apply\" which may have affected this plan:", ""];
    drift.forEach(function (d) {
      if (d.gone) { L.push("  # " + d.addr + " has been deleted", "  - resource \"" + d.st.type + "\" \"" + d.st.name + "\" {", "      - id = " + q(d.st.attrs.id) + " -> null", "        # (" + (keys(d.st.attrs).length - 1) + " unchanged attributes hidden)", "    }", ""); return; }
      L.push("  # " + d.addr + " has changed", "  ~ resource \"" + d.st.type + "\" \"" + d.st.name + "\" {");
      L.push(renderBody({ r: { type: d.st.type, name: d.st.name }, action: "update", before: d.before, after: d.after, sensMap: {} }, 6));
      L.push("    }", "");
    });
    if (!refreshOnly) L.push("", "Unless you have made equivalent changes to your configuration, or ignored the", "relevant attributes using ignore_changes, the following plan may include", "actions to undo or respond to these changes.");
    else L.push("", "This is a refresh-only plan, so Terraform will not take any actions to undo", "these. If you were expecting these changes then you can apply this plan to", "record the updated values in the Terraform state without changing any remote", "objects.");
    L.push("", "─────────────────────────────────────────────────────────────────────────────", "");
    return L.join("\n");
  }

  /* ================================================================== apply */
  function topo(changes) {
    var addrs = keys(changes), done = {}, order = [], visiting = {};
    function base(a) { return a.replace(/\[[^\]]*\]$/, ""); }
    function visit(a) {
      if (done[a]) return; if (visiting[a]) return; visiting[a] = true;
      var c = changes[a];
      (c.deps || []).forEach(function (d) { addrs.forEach(function (x) { if (x !== a && (x === d || base(x) === d || x.indexOf(d + ".") === 0)) visit(x); }); });
      // things inside a module depend on the module's inputs
      var m = /^(module\.[^.]+(?:\[[^\]]*\])?)\./.exec(a);
      if (m) addrs.forEach(function (x) { if (x !== a && c.mod && c.mod.parentDeps && c.mod.parentDeps.indexOf(x) >= 0) visit(x); });
      done[a] = true; delete visiting[a]; order.push(a);
    }
    addrs.forEach(visit);
    return order;
  }
  function applyRun(rc, cfg, io, label) {
    var A = rc.A, sess = rc.sess, f = rc.refreshed, n = { add: 0, change: 0, destroy: 0, imp: 0 }, failed = null, secs = 0;
    A.clockNow = now(sess.sys);
    var stateFlat = {}; keys(f).forEach(function (a) { stateFlat[a] = f[a]; });
    keys(rc.dataVals).forEach(function () {});
    var order = topo(rc.changes);
    var deletes = order.filter(function (a) { return rc.changes[a].action === "delete"; }).reverse();
    var rest = order.filter(function (a) { return rc.changes[a].action !== "delete"; });
    rc.phase = "apply";
    function fail(c, msg) {
      var r = c.r || {}, at = r.at || {};
      errl(io, box([new TfErr(msg.summary, msg.detail + "\n\n  with " + c.addr + ",\n  on " + (at.file || "main.tf") + " line " + (at.line || 1) + ", " + (r.ctx || "in resource \"" + r.type + "\" \"" + r.name + "\"") + ":\n  " + String(at.line || 1).padStart(2) + ": " + String((at.src || "").split("\n")[(at.line || 1) - 1] || "").replace(/\s+$/, ""), null)]).replace(/\n│ \n│ \n/, "\n│ \n"));
      failed = c;
    }
    function verbOf(t) { return (PROV[t] && PROV[t].verb) || SCHEMA[t] && SCHEMA[t].short || t; }
    function doDelete(c) {
      var t = c.r ? c.r.type : c.st.type, before = c.before, P = PROV[t] || {};
      out(io, c.addr + ": Destroying... [id=" + before.id + "]\n");
      try { var pd = permit(sess, t, "delete", before.id); if (pd) throw pd; if (P.del) P.del(A, before); } catch (e) { if (e instanceof ApiErr) { fail(c, { summary: "deleting " + verbOf(t) + " (" + before.id + "): " + e.msg.split(",")[0], detail: e.msg }); return false; } throw e; }
      if (!P.local) delete IAC.bag(A, t)[before.id];
      delete stateFlat[c.addr]; n.destroy++;
      var d = t === "aws_instance" ? 31 : 1; secs += d; if (d > 10) out(io, c.addr + ": Still destroying... [id=" + before.id + ", 10s elapsed]\n" + c.addr + ": Still destroying... [id=" + before.id + ", 20s elapsed]\n" + c.addr + ": Still destroying... [id=" + before.id + ", 30s elapsed]\n");
      out(io, c.addr + ": Destruction complete after " + d + "s\n");
      IAC.ev(sess.sys, { kind: "tf-destroy", addr: c.addr, type: t, id: before.id });
      return true;
    }
    for (var i = 0; i < deletes.length && !failed; i++) doDelete(rc.changes[deletes[i]]);
    for (var j = 0; j < rest.length && !failed; j++) {
      var a = rest[j], c = rc.changes[a];
      if (c.action === "noop" && !c.importId) continue;
      if (c.action === "read") { try { var cfgv = evalBlock(c.mod, c.r, DATA[c.r.type], c.r.b, c.extra || {}, null, {}); keys(cfgv).forEach(function (k) { if (isUnk(cfgv[k])) cfgv[k] = null; }); var val = Object.assign({}, cfgv, readData(c.r.type, cfgv, sess, A)); delete c.mod.memo["res.data." + c.r.type + "." + c.r.name]; rc.dataVals[a] = exposed(val, {}, c.r.type); out(io, a + ": Reading...\n" + a + ": Read complete after 0s [id=" + val.id + "]\n"); } catch (e) { if (e instanceof ApiErr) { fail(c, { summary: "reading " + c.r.type, detail: e.msg }); break; } throw e; } continue; }
      // re-evaluate now that dependencies have real values
      rc.mods.forEach(function (m) { m.memo = {}; });
      var cur = rc.changes[a]; rc.changes[a] = c;
      var sensMap = {}, desired;
      var extraNow = c.extra || {};
      try {
        if (c.r.for_each) { var ex2 = c.mod.expand(c.r, c.r.ctx); extraNow = { each: { key: c.key, value: ex2.set ? c.key : ex2.val[c.key] } }; }
        desired = evalBlock(c.mod, c.r, SCHEMA[c.r.type], c.r.b, extraNow, c.before, sensMap);
      }
      catch (e) { if (e instanceof TfErr) { errl(io, box([e])); failed = c; break; } throw e; }
      if ("tags_all" in SCHEMA[c.r.type].a) desired.tags_all = Object.assign({}, rc.defaultTags || {}, desired.tags || {});
      keys(desired).forEach(function (k) { if (isUnk(desired[k])) desired[k] = undefined; else desired[k] = scrub(desired[k], c.before && c.before[k]); });
      var P = PROV[c.r.type] || { create: function (A2, o) { o.id = IAC.newId(A2, "res", c.addr); return o; } }, t = c.r.type, verb = verbOf(t);
      if (c.importId && c.action === "noop") { stateFlat[a] = Object.assign({}, f[a], { attrs: c.before }); n.imp++; out(io, a + ": Importing... [id=" + c.importId + "]\n" + a + ": Import complete [id=" + c.importId + "]\n"); IAC.ev(sess.sys, { kind: "tf-import", addr: a, type: t, id: c.importId }); continue; }
      if (c.importId) { n.imp++; out(io, a + ": Importing... [id=" + c.importId + "]\n" + a + ": Import complete [id=" + c.importId + "]\n"); }
      if (c.action === "replace") {
        var cbd = c.lifecycle && c.lifecycle.attrs.create_before_destroy && c.lifecycle.attrs.create_before_destroy.v === true;
        if (!cbd) { if (!doDelete({ addr: a, r: c.r, before: c.before })) break; n.destroy--; n.destroy++; }
      }
      try {
        var obj;
        var deny = permit(sess, t, c.action === "update" ? "update" : "create", desired.bucket || desired.name || c.before && c.before.id || "");
        if (deny) { if (c.action === "update") out(io, a + ": Modifying... [id=" + c.before.id + "]\n"); else out(io, a + ": Creating...\n"); throw deny; }
        if (c.action === "update") {
          out(io, a + ": Modifying... [id=" + c.before.id + "]\n");
          obj = Object.assign({}, c.before, desired);
          if (P.update) obj = P.update(A, obj, c.before);
          if (!P.local) { var bagT = IAC.bag(A, t); bagT[c.before.id] = clone(obj); }
          n.change++; secs++;
          out(io, a + ": Modifications complete after 1s [id=" + obj.id + "]\n");
          IAC.ev(sess.sys, { kind: "tf-update", addr: a, type: t, id: obj.id, changed: c.changed });
        } else {
          out(io, a + ": Creating...\n");
          obj = P.create(A, clone(desired), rc);
          if (!P.local) IAC.bag(A, t)[obj.id] = clone(obj);
          var d = (SCHEMA[t] && SCHEMA[t].slow) || (t === "aws_s3_bucket" ? 2 : 1);
          for (var s2 = 10; s2 < d; s2 += 10) out(io, a + ": Still creating... [" + s2 + "s elapsed]\n");
          secs += d; n.add++;
          out(io, a + ": Creation complete after " + d + "s [id=" + obj.id + "]\n");
          if (c.action === "replace") { n.destroy++; if (c.lifecycle && c.lifecycle.attrs.create_before_destroy && c.lifecycle.attrs.create_before_destroy.v === true) { out(io, a + " (deposed object " + M2.hexOf("dp" + a, 8) + "): Destroying... [id=" + c.before.id + "]\n"); delete IAC.bag(A, t)[c.before.id]; out(io, a + " (deposed object " + M2.hexOf("dp" + a, 8) + "): Destruction complete after 1s\n"); } }
          IAC.ev(sess.sys, { kind: "tf-create", addr: a, type: t, id: obj.id });
        }
        var sch = SCHEMA[t], st = {}; keys(sch.a).forEach(function (k) { st[k] = obj[k] === undefined ? null : obj[k]; }); keys(sch.b || {}).forEach(function (k) { st[k] = obj[k] === undefined ? [] : obj[k]; });
        var sensList = keys(sensMap).filter(function (k) { return k.indexOf(".") < 0; }).map(function (k) { return [{ type: "get_attr", value: k }]; });
        stateFlat[a] = { mode: "managed", type: t, name: c.r.name, module: c.mod.prefix || "", key: c.key, attrs: st, deps: c.deps, sens: sensList, provider: provAddr(provOf(t)) };
        rc.applied[a] = { attrs: st, sensMap: sensMap };
      } catch (e) {
        if (e instanceof ApiErr) { var what = c.action === "update" ? "updating" : "creating"; var nm = desired.bucket || desired.name || desired.cidr_block || desired.key_name || ""; fail(c, { summary: what + " " + verb + (nm && !isUnk(nm) ? " (" + nm + ")" : "") + ": " + (e.msg.indexOf("operation error") === 0 ? e.msg.replace(/^operation error [^,]+, https response error StatusCode: (\d+), RequestID: [^,]+, (api error )?/, "") : e.msg), detail: e.msg.indexOf("operation error") === 0 ? e.msg : "" }); failed.summaryOnly = true; break; }
        throw e;
      }
    }
    // outputs
    var outs = {};
    if (!failed) { rc.mods.forEach(function (m) { m.memo = {}; }); keys(cfg.outputs).forEach(function (k) { var o = rc.root.outputVal(k); outs[k] = { value: o.v, type: tfType(o.v) }; if (o.sens) outs[k].sensitive = true; }); }
    else outs = rc.state.outputs || {};
    keys(rc.dataVals).forEach(function (a) { var dv = rc.dataVals[a]; var parts = a.replace(/\[.*$/, "").split("."); var di = parts.indexOf("data"); var plain = {}; keys(dv).forEach(function (k) { plain[k] = isUnk(dv[k]) ? null : dv[k]; }); stateFlat[a] = { mode: "data", type: parts[di + 1], name: parts[di + 2], module: parts.slice(0, di).join("."), key: null, attrs: plain, deps: [], provider: provAddr(provOf(parts[di + 1])) }; });
    return { flat: stateFlat, outputs: outs, n: n, failed: failed };
  }
  // unknown leaves inside nested values: keep what was there before, else empty
  function scrub(v, prior) {
    if (isUnk(v)) return prior !== undefined && !isUnk(prior) ? prior : "";
    if (Array.isArray(v)) return v.map(function (x, i) { return scrub(x, Array.isArray(prior) ? prior[i] : undefined); });
    if (v && typeof v === "object") { var o = {}; keys(v).forEach(function (k) { o[k] = scrub(v[k], prior && typeof prior === "object" ? prior[k] : undefined); }); return o; }
    return v;
  }
  function tfType(v) { if (typeof v === "string") return "string"; if (typeof v === "number") return "number"; if (typeof v === "boolean") return "bool"; if (Array.isArray(v)) return ["tuple", v.map(tfType)]; if (v && typeof v === "object") { var o = {}; keys(v).forEach(function (k) { o[k] = tfType(v[k]); }); return ["object", o]; } return "dynamic"; }

  /* ================================================================== the CLI */
  function parseArgs(a) {
    var o = { vars: [], varFiles: [], target: [], replace: [], pos: [] };
    a.forEach(function (x) {
      var m = /^-{1,2}([\w-]+)(?:=(.*))?$/.exec(x);
      if (!m) { o.pos.push(x); return; }
      var k = m[1], v = m[2] === undefined ? true : m[2];
      if (k === "var") o.vars.push(v); else if (k === "var-file") o.varFiles.push(v); else if (k === "target") o.target.push(v); else if (k === "replace") o.replace.push(v); else if (k === "backend-config") (o.backendConfig = o.backendConfig || []).push(v); else o[k] = v;
    });
    return o;
  }
  // -var a=b takes the next word: normalise "-var" "x=1" to "-var=x=1"
  function joinFlagArgs(a) { var r = []; for (var i = 0; i < a.length; i++) { if (/^-(var|var-file|target|replace|out|chdir|backend-config|state|lock-timeout)$/.test(a[i]) && i + 1 < a.length) { r.push(a[i] + "=" + a[i + 1]); i++; } else r.push(a[i]); } return r; }
  function inputs(rc, cfg, o, fs, dir, sess) {
    var vals = {};
    keys(cfg.vars).forEach(function (k) { var e = S.getVar(sess, "TF_VAR_" + k); if (e != null && e !== "") vals[k] = { v: e, src: "env" }; });
    function tfvars(path, explicit) { var t = fs.read(path); if (t == null) { if (explicit) throw new TfErr("Failed to read variables file", "Given variables file " + path.replace(dir + "/", "") + " does not exist.", null); return; } var ast; ast = IAC.parseHcl(t, path.replace(dir + "/", "")); keys(ast.attrs).forEach(function (k) { if (!cfg.vars[k]) { rc.warnings.push(new TfErr("Value for undeclared variable", "The root module does not declare a variable named \"" + k + "\" but a value was found in file \"" + path.replace(dir + "/", "") + "\". If you meant to use this value, add a \"variable\" block to the configuration.\n\nTo silence these warnings, use TF_VAR_... environment variables to provide certain \"global\" settings to all configurations in your organization. To reduce the verbosity of these warnings, use the -compact-warnings option.", null)); return; } vals[k] = { v: IAC.evalExpr(ast.attrs[k], { resolve: function () { throw new TfErr("Variables not allowed", "Variables may not be used here.", { file: path.replace(dir + "/", ""), line: ast.attrs[k].line, src: t }); } }), src: path }; }); }
    tfvars(dir + "/terraform.tfvars", false);
    (fs.list(dir) || []).filter(function (f2) { return /\.auto\.tfvars$/.test(f2); }).forEach(function (f2) { tfvars(dir + "/" + f2, false); });
    o.varFiles.forEach(function (vf) { tfvars(vf.charAt(0) === "/" ? vf : dir + "/" + vf, true); });
    o.vars.forEach(function (kv) {
      var i = kv.indexOf("="); if (i < 0) throw new TfErr("Invalid -var option", "The given -var option \"" + kv + "\" is not correctly specified. Must be a variable name and value separated by an equals sign, like -var=\"key=value\".", null);
      var k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!cfg.vars[k]) throw new TfErr("Value for undeclared variable", "A variable named \"" + k + "\" was assigned on the command line, but the root module does not declare a variable of that name. To use this value, add a \"variable\" block to the configuration.", null);
      if (/^[\[{]/.test(v.trim())) { try { v = IAC.evalExpr(IAC.parseExpr(v, "<value for var." + k + ">", 1), { resolve: function () { return null; } }); } catch (e) { /* keep string */ } }
      vals[k] = { v: v, src: "cli" };
    });
    var res = {}; keys(vals).forEach(function (k) { res[k] = { v: vals[k].v, sens: !!cfg.vars[k].sensitive }; });
    return res;
  }
  function initState(fs, dir) { var t = fs.read(dir + "/.terraform/terraform.tfstate"); return t ? JSON.parse(t) : null; }
  function providersNeeded(cfg, fs) {
    var need = {};
    keys(cfg.required).forEach(function (k) { need[k] = cfg.required[k]; });
    cfg.resources.forEach(function (r) { var p = provOf(r.type); if (!need[p]) need[p] = { source: PROVIDERS[p] ? PROVIDERS[p].src : "hashicorp/" + p }; });
    return need;
  }
  function pickVersion(p, constraint) {
    var vs = (PROVIDERS[p] || { versions: ["1.0.0"] }).versions.slice().reverse();
    if (!constraint) return vs[0];
    var cs = String(constraint).split(",").map(function (s) { return s.trim(); });
    function cmp(a, b) { var x = a.split(".").map(Number), y = b.split(".").map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
    return vs.filter(function (v) { return cs.every(function (c) { var m = /^(~>|>=|<=|>|<|=|!=)?\s*([\d.]+)$/.exec(c); if (!m) return true; var op = m[1] || "=", t = m[2]; if (op === "~>") { var parts = t.split("."); var lower = t, upper = parts.length === 2 ? (+parts[0] + 1) + ".0.0" : parts[0] + "." + (+parts[1] + 1) + ".0"; return cmp(v, lower) >= 0 && cmp(v, upper) < 0; } var r = cmp(v, t); return { "=": r === 0, "!=": r !== 0, ">": r > 0, ">=": r >= 0, "<": r < 0, "<=": r <= 0 }[op]; }); })[0] || null;
  }
  function tfLock(fs, dir) { var t = fs.read(dir + "/.terraform.lock.hcl"); var m = {}, re = /provider "registry\.terraform\.io\/([\w-]+)\/([\w-]+)" \{\s*\n\s*version\s*=\s*"([^"]+)"/g, x; while (t && (x = re.exec(t))) m[x[2]] = x[3]; return m; }

  CMDS.terraform = function (args, io, sess) {
    var a = joinFlagArgs(args.slice(1)), sys = sess.sys;
    var chdir = a.filter(function (x) { return /^-chdir=/.test(x); })[0]; if (chdir) a = a.filter(function (x) { return x !== chdir; });
    var dir = norm(chdir ? (chdir.slice(7).charAt(0) === "/" ? chdir.slice(7) : sess.cwd + "/" + chdir.slice(7)) : sess.cwd), fs = fsOf(sess);
    var sub = a[0], rest = a.slice(1), o = parseArgs(rest);
    if (!sub || sub === "-help" || sub === "--help" || sub === "help") { out(io, "Usage: terraform [global options] <subcommand> [args]\n\nThe available commands for execution are listed below.\nThe primary workflow commands are given first, followed by\nless common or more advanced commands.\n\nMain commands:\n  init          Prepare your working directory for other commands\n  validate      Check whether the configuration is valid\n  plan          Show changes required by the current configuration\n  apply         Create or update infrastructure\n  destroy       Destroy previously-created infrastructure\n\nAll other commands:\n  fmt           Reformat your configuration in the standard style\n  force-unlock  Release a stuck lock on the current workspace\n  import        Associate existing infrastructure with a Terraform resource\n  output        Show output values from your root module\n  providers     Show the providers required for this configuration\n  show          Show the current state or a saved plan\n  state         Advanced state management\n  version       Show the current Terraform version\n\nGlobal options (use these before the subcommand, if any):\n  -chdir=DIR    Switch to a different working directory before executing the\n                given subcommand.\n"); return sub ? 0 : 127; }
    if (sub === "version" || sub === "-version" || sub === "-v") { var lk = tfLock(fs, dir); out(io, "Terraform v" + VERSION + "\non linux_amd64\n" + keys(lk).map(function (p) { return "+ provider registry.terraform.io/hashicorp/" + p + " v" + lk[p] + "\n"; }).join("")); return 0; }
    try {
      if (sub === "fmt") return tfFmt(io, fs, dir, o);
      var cfg = loadConfig(fs, dir, true);
      if (sub === "init") return tfInit(io, sess, fs, dir, cfg, o);
      if (cfg.empty && sub !== "state" && sub !== "output" && sub !== "show" && sub !== "force-unlock") { errl(io, box([new TfErr("No configuration files", sub === "plan" || sub === "apply" ? (sub === "plan" ? "Plan" : "Apply") + " requires configuration to be present. Planning without a configuration would mark everything for destruction, which is normally not what is desired. If you would like to destroy everything, run plan with the -destroy option. Otherwise, create a Terraform configuration file (.tf file) and try again." : "The directory " + dir + " contains no Terraform configuration files.")])); return 1; }
      var verrs = validate(cfg, fs, dir);
      if (sub === "validate") { if (verrs.length) { errl(io, box(verrs)); return 1; } if (o.json) { out(io, JSON.stringify({ format_version: "1.0", valid: true, error_count: 0, warning_count: 0, diagnostics: [] }, null, 2) + "\n"); return 0; } out(io, "Success! The configuration is valid.\n\n"); return 0; }
      if (verrs.length && sub !== "state" && sub !== "output" && sub !== "force-unlock") { errl(io, box(verrs)); return 1; }
      // initialised?
      var ist = initState(fs, dir), need = providersNeeded(cfg, fs), lock = tfLock(fs, dir);
      if (["plan", "apply", "destroy", "import", "refresh", "output", "show", "state", "force-unlock", "providers"].indexOf(sub) >= 0) {
        var missing = keys(need).filter(function (p) { return !lock[p] || !fs.isDir(dir + "/.terraform/providers"); });
        if (missing.length && sub !== "output" && sub !== "show" && sub !== "state") { errl(io, box([new TfErr("Inconsistent dependency lock file", "The following dependency selections recorded in the lock file are inconsistent with the current configuration:\n" + missing.map(function (p) { return "  - provider registry.terraform.io/" + (PROVIDERS[p] ? PROVIDERS[p].src : "hashicorp/" + p) + ": required by this configuration but no version is selected"; }).join("\n") + "\n\nTo make the initial dependency selections that will initialize the dependency lock file, run:\n  terraform init")])); return 1; }
        var wantBk = cfg.backend ? cfg.backend.type : "local", haveBk = ist && ist.backend ? ist.backend.type : "local";
        if (wantBk !== haveBk || (cfg.backend && ist && ist.backend && JSON.stringify(cfg.backend.config) !== JSON.stringify(ist.backend.config))) { errl(io, box([new TfErr("Backend initialization required, please run \"terraform init\"", "Reason: " + (haveBk === "local" ? "Initial configuration of the requested backend \"" + wantBk + "\"" : "Backend configuration block has changed") + "\n\nThe \"backend\" is the interface that Terraform uses to store state,\nperform operations, etc. If this message is showing up, it means that the\nTerraform configuration you're using is using a custom configuration for\nthe Terraform backend.\n\nChanges to backend configurations require reinitialization. This allows\nTerraform to set up the new configuration, copy existing state, etc. Please run\n\"terraform init\" with either the \"-reconfigure\" or \"-migrate-state\" flags to\nuse the current configuration.\n\nIf the change reason above is incorrect, please verify your configuration\nhasn't changed and try again. At this point, no changes to your existing\nconfiguration or state have been made.")])); return 1; }
        var modsNeeded = cfg.modules.filter(function (m) { return !/^\.\.?\//.test(m.source || "./"); }), mj = readModulesJson(fs, dir);
        var notInst = cfg.modules.filter(function (m) { return !mj[m.name]; })[0];
        if (notInst && sub !== "output" && sub !== "show" && sub !== "state") { errl(io, box([new TfErr("Module not installed", "This module is not yet installed. Run \"terraform init\" to install all modules required by this configuration.", Object.assign({}, notInst.at))])); return 1; }
        void modsNeeded;
      }
      var ctx = { sess: sess, fs: fs, dir: dir };
      var bk = backendOf(ctx);
      if (sub === "output") return tfOutput(io, bk, o);
      if (sub === "show") return tfShow(io, sess, fs, dir, bk, o);
      if (sub === "state") return tfState(io, sess, fs, dir, bk, rest, o);
      if (sub === "force-unlock") { var lid = o.pos[0]; if (!lid) { errl(io, "Usage: terraform [global options] force-unlock LOCK_ID\n"); return 1; } if (!o.force && !/^yes$/m.test(io.stdin || "")) { out(io, "Do you really want to force-unlock?\n  Terraform will remove the lock on the remote state.\n  This will allow local Terraform commands to modify this state, even though it\n  may still be in use. Only 'yes' will be accepted to confirm.\n\n  Enter a value: \n"); if (io.note) io.note("(The lab can't type 'yes' for you: add -force, or pipe it in: echo yes | terraform force-unlock ID.)"); errl(io, "force-unlock cancelled.\n"); return 1; } if (!bk.forceUnlock || !bk.forceUnlock(lid)) { errl(io, box([new TfErr("Failed to unlock state", "failed to retrieve lock info for lock ID \"" + lid + "\": no lock with that ID")])); return 1; } out(io, "Terraform state has been successfully unlocked!\n\nThe state has been unlocked, and Terraform commands should now be able to\nobtain a new lock on the remote state.\n"); IAC.ev(sys, { kind: "tf-unlock", id: lid }); return 0; }
      if (sub === "providers") { out(io, "\nProviders required by configuration:\n.\n" + keys(need).map(function (p) { return "├── provider[registry.terraform.io/" + (PROVIDERS[p] ? PROVIDERS[p].src : "hashicorp/" + p) + "]" + (need[p].version ? " " + need[p].version : ""); }).join("\n") + "\n\nProviders required by state:\n\n" + "    provider[registry.terraform.io/hashicorp/aws]\n\n"); return 0; }
      if (sub === "import") return tfImport(io, sess, fs, dir, cfg, bk, o);
      if (sub === "plan" || sub === "apply" || sub === "destroy" || sub === "refresh") return tfPlanApply(io, sess, fs, dir, cfg, bk, o, sub);
      errl(io, "Terraform has no command named \"" + sub + "\".\n\nTo see all of Terraform's top-level commands, run:\n  terraform -help\n\n"); return 1;
    } catch (e) {
      if (e instanceof TfErr) { errl(io, box([e])); return 1; }
      throw e;
    }
  };

  function tfFmt(io, fs, dir, o) {
    var files = [], target = o.pos[0] ? norm(o.pos[0].charAt(0) === "/" ? o.pos[0] : dir + "/" + o.pos[0]) : dir;
    (function walk(d, rel) { (fs.list(d) || []).forEach(function (f) { if (f === ".terraform") return; var p = d + "/" + f; if (fs.isDir(p)) { if (o.recursive) walk(p, rel + f + "/"); return; } if (/\.(tf|tfvars)$/.test(f)) files.push({ p: p, rel: rel + f }); }); })(target, "");
    if (!fs.isDir(target) && /\.tf(vars)?$/.test(target)) files = [{ p: target, rel: o.pos[0] }];
    var changed = [], code = 0;
    files.forEach(function (f) { var t = fs.read(f.p), n; try { IAC.parseHcl(t, f.rel); n = IAC.fmt(t); } catch (e) { if (e instanceof TfErr) { errl(io, box([e])); code = 2; return; } throw e; } if (n !== t) { changed.push(f.rel); if (o.diff) out(io, "--- old/" + f.rel + "\n+++ new/" + f.rel + "\n" + G.unifiedBody(t, n, 3).lines.map(function (x) { return x.t; }).join("\n") + "\n"); if (!o.check) fs.write(f.p, n); } });
    if (code) return code;
    if (o.list !== "false") changed.forEach(function (f) { out(io, f + "\n"); });
    return o.check && changed.length ? 3 : 0;
  }

  function tfInit(io, sess, fs, dir, cfg, o) {
    var A = IAC.aws(sess.sys);
    if (cfg.empty) { out(io, "Terraform initialized in an empty directory!\n\nThe directory has no Terraform configuration files. You may begin working\nwith Terraform immediately by creating Terraform configuration files.\n"); return 0; }
    var errs = cfg.errors.slice(); if (errs.length) { out(io, "\n"); errl(io, box(errs)); return 1; }
    var ist = initState(fs, dir), prevBk = ist && ist.backend ? ist.backend : { type: "local", config: {} };
    var bkCfg = cfg.backend ? { type: cfg.backend.type, config: Object.assign({}, cfg.backend.config) } : { type: "local", config: {} };
    (o.backendConfig || []).forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) bkCfg.config[kv.slice(0, i)] = kv.slice(i + 1).replace(/^"|"$/g, ""); });
    out(io, "Initializing the backend...\n");
    var changed = JSON.stringify(prevBk) !== JSON.stringify(bkCfg);
    if (bkCfg.type === "s3") {
      var c = bkCfg.config, b = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === c.bucket; });
      var miss = ["bucket", "key", "region"].filter(function (k) { return !c[k]; });
      if (miss.length) { errl(io, box([new TfErr("Missing Required Value", "The attribute \"" + miss[0] + "\" is required by the backend.\n\nRefer to the backend documentation for additional information which attributes are required.", cfg.backend.at)])); return 1; }
      if (c.dynamodb_table) out(io, "");
      if (!b) { errl(io, box([new TfErr("Failed to get existing workspaces: S3 bucket \"" + c.bucket + "\" does not exist.", "The referenced S3 bucket must have been previously created. If the S3 bucket\nwas created within the last minute, please wait for a minute or two and try\nagain.\n\nError: operation error S3: ListObjectsV2, https response error StatusCode: 404, RequestID: " + M2.hexOf("rq404", 16).toUpperCase() + ", HostID: " + M2.hexOf("host404", 40) + ", api error NoSuchBucket: The specified bucket does not exist")])); return 1; }
      var id = IAC.identityOf(sess);
      if (!id) { errl(io, box([new TfErr("No valid credential sources found", "Please see https://registry.terraform.io/providers/hashicorp/aws/latest/docs#authentication-and-configuration\nfor more information about providing credentials.\n\nError: failed to refresh cached credentials, no EC2 IMDS role found, operation\nerror ec2imds: GetMetadata, request canceled, context deadline exceeded")])); return 1; }
      if (id.error || !IAC.allowed(id, "s3:ListBucket")) { errl(io, box([new TfErr("Failed to get existing workspaces: Unable to list objects in S3 bucket \"" + c.bucket + "\"", "operation error S3: ListObjectsV2, https response error StatusCode: 403, api error AccessDenied: Access Denied")])); return 1; }
      if (c.dynamodb_table && !c.use_lockfile) out(io, "");
    }
    if (changed && prevBk.type !== bkCfg.type) {
      var oldLocal = prevBk.type === "local" ? fs.read(dir + "/" + ((prevBk.config && prevBk.config.path) || "terraform.tfstate")) : null;
      var oldState = oldLocal ? JSON.parse(oldLocal) : null;
      if (bkCfg.type === "s3" && oldState && (oldState.resources || []).length) {
        var c2 = bkCfg.config, b2 = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === c2.bucket; });
        var remote = b2 && b2.objects && b2.objects[c2.key];
        if (!o["migrate-state"] && ist && ist.backend && ist.backend.type !== "local") { errl(io, box([new TfErr("Backend configuration changed", "A change in the backend configuration has been detected, which may require migrating existing state.\n\nIf you wish to attempt automatic migration of the state, use \"terraform init -migrate-state\".\nIf you wish to store the current configuration with no changes to the state, use \"terraform init -reconfigure\".")])); return 1; }
        var yes = o["force-copy"] || /^yes$/m.test(io.stdin || "");
        if (!o.reconfigure) {
          out(io, "Do you want to copy existing state to the new backend?\n  Pre-existing state was found while migrating the previous \"local\" backend to the\n  newly configured \"s3\" backend. " + (remote ? "An existing non-empty state already exists in\n  the new backend." : "No existing state was found in the newly\n  configured \"s3\" backend.") + " Do you want to copy this state to the new \"s3\"\n  backend? Enter \"yes\" to copy and \"no\" to start with an empty state.\n\n  Enter a value: " + (yes ? "yes" : "") + "\n\n");
          if (!yes) { if (io.note) io.note("(The lab can't type 'yes' for you: use terraform init -migrate-state -force-copy, or echo yes | terraform init -migrate-state.)"); errl(io, box([new TfErr("Migration aborted by user.", "")])); return 1; }
          (b2.objects = b2.objects || {})[c2.key] = { body: JSON.stringify(oldState, null, 2) + "\n", t: now(sess.sys) };
          fs.rm(dir + "/" + ((prevBk.config && prevBk.config.path) || "terraform.tfstate"));
          fs.write(dir + "/terraform.tfstate.backup", oldLocal);
          IAC.ev(sess.sys, { kind: "tf-migrate", to: c2.bucket + "/" + c2.key });
        }
      }
      if (bkCfg.type === "s3") out(io, "\nSuccessfully configured the backend \"s3\"! Terraform will automatically\nuse this backend unless the backend configuration changes.\n");
      if (bkCfg.type === "local" && prevBk.type === "s3") { var c3 = prevBk.config, b3 = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === c3.bucket; }); var rt = b3 && b3.objects && b3.objects[c3.key]; if (rt && !o["migrate-state"] && !o.reconfigure) { errl(io, box([new TfErr("Backend configuration changed", "A change in the backend configuration has been detected, which may require migrating existing state.\n\nIf you wish to attempt automatic migration of the state, use \"terraform init -migrate-state\".\nIf you wish to store the current configuration with no changes to the state, use \"terraform init -reconfigure\".")])); return 1; } if (rt && o["migrate-state"]) fs.write(dir + "/terraform.tfstate", rt.body); out(io, "\nSuccessfully unset the backend \"s3\". Terraform will now operate locally.\n"); }
    } else if (changed && bkCfg.type === "s3" && !o.reconfigure && !o["migrate-state"] && ist && ist.backend) { errl(io, box([new TfErr("Backend configuration changed", "A change in the backend configuration has been detected, which may require migrating existing state.\n\nIf you wish to attempt automatic migration of the state, use \"terraform init -migrate-state\".\nIf you wish to store the current configuration with no changes to the state, use \"terraform init -reconfigure\".")])); return 1; }
    fs.write(dir + "/.terraform/terraform.tfstate", JSON.stringify({ version: 3, terraform_version: VERSION, backend: bkCfg }, null, 2) + "\n");
    // modules
    var mods = [];
    (function collect(c, prefix, base) { c.modules.forEach(function (m) { var key = prefix.concat([m.name]).join("."); if (/^\.\.?\//.test(m.source || "")) { var d = norm(base + "/" + m.source); var cc = loadConfig(fs, d); mods.push({ Key: key, Source: m.source, Dir: d.replace(dir + "/", ""), local: true, name: m.name }); if (!cc.empty) collect(cc, prefix.concat([m.name]), d); else mods[mods.length - 1].missing = true; } else { var reg = REGISTRY[m.source]; mods.push({ Key: key, Source: "registry.terraform.io/" + m.source, Version: reg ? reg.version : null, Dir: ".terraform/modules/" + key, reg: reg, name: m.name, src: m.source, want: m.version }); } }); })(cfg, [], dir);
    if (mods.length) {
      out(io, "Initializing modules...\n");
      for (var i = 0; i < mods.length; i++) {
        var m = mods[i];
        if (m.local) { if (m.missing) { errl(io, box([new TfErr("Unreadable module directory", "Unable to evaluate directory symlink: lstat " + m.Source + ": no such file or directory")])); return 1; } out(io, "- " + m.Key + " in " + m.Dir + "\n"); continue; }
        if (!m.reg) { errl(io, box([new TfErr("Module not found", "The module address \"" + m.src + "\" could not be resolved.\n\nIf you intended this as a path relative to the current module, use \"./" + m.src + "\" instead. The \"./\" prefix indicates that the address is a relative filesystem path.")])); return 1; }
        if (m.want && !pickVersionStr(m.reg.version, m.want)) { errl(io, box([new TfErr("Unresolvable module version constraint", "There is no available version of module \"" + m.name + "\" (registry.terraform.io/" + m.src + ") which matches the given version constraint. The newest available version is " + m.reg.version + ".")])); return 1; }
        out(io, "Downloading registry.terraform.io/" + m.src + " " + m.reg.version + " for " + m.Key + "...\n- " + m.Key + " in " + m.Dir + "\n");
        keys(m.reg.files).forEach(function (f) { fs.write(dir + "/" + m.Dir + "/" + f, m.reg.files[f]); });
      }
      fs.write(dir + "/.terraform/modules/modules.json", JSON.stringify({ Modules: [{ Key: "", Source: "", Dir: "." }].concat(mods.map(function (m2) { var x = { Key: m2.Key, Source: m2.Source, Dir: m2.Dir }; if (m2.Version) x.Version = m2.Version; return x; })) }) + "\n");
    }
    // providers
    out(io, "Initializing provider plugins...\n");
    var need = providersNeeded(cfg, fs), lock = tfLock(fs, dir), lines = [], hashes = {};
    var subMods = mods.filter(function (m3) { return !m3.missing; }).map(function (m3) { return loadConfig(fs, dir + "/" + m3.Dir); });
    subMods.forEach(function (sc) { var n2 = providersNeeded(sc, fs); keys(n2).forEach(function (p) { if (!need[p]) need[p] = n2[p]; }); });
    var pins = {};
    var picks = {};
    var ks = keys(need).sort();
    for (var j = 0; j < ks.length; j++) {
      var p = ks[j], con = need[p].version || null, src = PROVIDERS[p] ? PROVIDERS[p].src : "hashicorp/" + p;
      if (!PROVIDERS[p]) { errl(io, box([new TfErr("Failed to query available provider packages", "Could not retrieve the list of available versions for provider " + src + ": provider registry registry.terraform.io does not have a provider named registry.terraform.io/" + src)])); return 1; }
      if (lock[p] && !o.upgrade) { if (con && !pickVersionStr(lock[p], con)) { errl(io, box([new TfErr("Failed to query available provider packages", "Could not retrieve the list of available versions for provider " + src + ": locked provider registry.terraform.io/" + src + " " + lock[p] + " does not match configured version constraint " + con + "; must use terraform init -upgrade to allow selection of new versions")])); return 1; } out(io, "- Reusing previous version of " + src + " from the dependency lock file\n"); picks[p] = lock[p]; out(io, "- Using previously-installed " + src + " v" + lock[p] + "\n"); continue; }
      var v = pickVersion(p, con);
      if (!v) { errl(io, box([new TfErr("Failed to query available provider packages", "Could not retrieve the list of available versions for provider " + src + ": no available releases match the given constraints " + con)])); return 1; }
      out(io, "- Finding " + (con ? src + " versions matching \"" + con + "\"" : "latest version of " + src) + "...\n");
      out(io, "- Installing " + src + " v" + v + "...\n- Installed " + src + " v" + v + " (signed by HashiCorp)\n");
      picks[p] = v;
    }
    void pins; void hashes; void lines;
    var created = !fs.read(dir + "/.terraform.lock.hcl");
    fs.write(dir + "/.terraform.lock.hcl", "# This file is maintained automatically by \"terraform init\".\n# Manual edits may be lost in future updates.\n\n" + keys(picks).sort().map(function (p2) { return "provider \"registry.terraform.io/" + PROVIDERS[p2].src + "\" {\n  version     = \"" + picks[p2] + "\"\n" + (need[p2].version ? "  constraints = \"" + need[p2].version + "\"\n" : "") + "  hashes = [\n    \"h1:" + M2.hashChars("h1" + p2 + picks[p2], 43, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "=\",\n    \"zh:" + M2.hexOf("zh" + p2 + picks[p2], 64) + "\",\n  ]\n}\n"; }).join("\n"));
    keys(picks).forEach(function (p3) { fs.write(dir + "/.terraform/providers/registry.terraform.io/" + PROVIDERS[p3].src + "/" + picks[p3] + "/linux_amd64/terraform-provider-" + p3 + "_v" + picks[p3] + "_x5", "\x7fELF provider", 493); });
    if (created) out(io, "Terraform has created a lock file .terraform.lock.hcl to record the provider\nselections it made above. Include this file in your version control repository\nso that Terraform can guarantee to make the same selections by default when\nyou run \"terraform init\" in the future.\n");
    out(io, "\nTerraform has been successfully initialized!\n\nYou may now begin working with Terraform. Try running \"terraform plan\" to see\nany changes that are required for your infrastructure. All Terraform commands\nshould now work.\n\nIf you ever set or change modules or backend configuration for Terraform,\nrerun this command to reinitialize your working directory. If you forget, other\ncommands will detect it and remind you to do so if necessary.\n");
    IAC.ev(sess.sys, { kind: "tf-init", dir: dir });
    return 0;
  }
  function pickVersionStr(have, con) { var save = PROVIDERS.__tmp = { versions: [have] }; var r = pickVersion("__tmp", con); delete PROVIDERS.__tmp; void save; return r; }

  function loadState(bk) { var st = bk.read(); if (!st) { st = emptyState(); st.lineage = null; } return st; }
  function saveState(bk, st, sess) { if (!st.lineage) st.lineage = M2.hexOf("lineage" + now(sess.sys), 8) + "-" + M2.hexOf("lin2", 4) + "-" + M2.hexOf("lin3", 4) + "-" + M2.hexOf("lin4", 4) + "-" + M2.hexOf("lin5" + now(sess.sys), 12); st.serial = (st.serial || 0) + 1; st.terraform_version = VERSION; bk.write(st); }
  function withLock(bk, o, op, fn) { if (o.lock === "false") return fn(); var info = bk.lock(op); try { return fn(); } finally { if (info) bk.unlock(); } }
  function defaultTagsOf(cfg, sess, fs, dir) { if (!cfg.defaultTagsExpr) return {}; try { return IAC.evalExpr(cfg.defaultTagsExpr, { resolve: function (n) { if (n === "var") { var o = {}; keys(cfg.vars).forEach(function (k) { if (cfg.vars[k].def) o[k] = IAC.evalExpr(cfg.vars[k].def, { resolve: function () { return {}; } }); }); return o; } return {}; } }) || {}; } catch (e) { return {}; } }

  function tfPlanApply(io, sess, fs, dir, cfg, bk, o, sub) {
    var isApply = sub === "apply" || sub === "destroy", A = IAC.aws(sess.sys);
    if (sub === "destroy") o.destroy = true;
    if (sub === "refresh") { o["refresh-only"] = true; o["auto-approve"] = true; isApply = true; }
    var planFile = isApply && o.pos[0] ? (o.pos[0].charAt(0) === "/" ? o.pos[0] : dir + "/" + o.pos[0]) : null, saved = null;
    if (planFile) { var pt = fs.read(planFile); if (pt == null) { errl(io, box([new TfErr("Failed to load \"" + o.pos[0] + "\" as a plan file", "Error: stat " + o.pos[0] + ": no such file or directory")])); return 1; } if (!/^PK\u0003\u0004/.test(pt)) { errl(io, box([new TfErr("Failed to load \"" + o.pos[0] + "\" as a plan file", "Error: zip: not a valid zip file")])); return 1; } saved = JSON.parse(pt.slice(4)); o = Object.assign(o, saved.opts, { "auto-approve": true }); }
    var label = o.destroy ? "OperationTypeApply" : isApply ? "OperationTypeApply" : "OperationTypePlan";
    var code = 0;
    try {
      withLock(bk, o, label, function () {
        var state = loadState(bk);
        if (saved && saved.serial !== state.serial) throw new TfErr("Saved plan is stale", "The given plan file can no longer be applied because the state was changed by\nanother operation after the plan was created.");
        var rc = new Run({ sess: sess, fs: fs, dir: dir, state: state, opts: o, defaultTags: defaultTagsOf(cfg, sess, fs, dir) });
        rc.inputs = inputs(rc, cfg, o, fs, dir, sess);
        var rf = o.refresh === "false" ? { refreshed: flat(state), drift: [] } : refresh(sess, state, io, !!saved);
        rc.refreshed = rf.refreshed;
        // drift that matters: shown before the plan
        planAll(rc, cfg);
        (rc.reads || []).forEach(function (rd) { if (!saved) out(io, rd.addr + ": Reading...\n" + rd.addr + ": Read complete after 0s [id=" + rd.id + "]\n"); });
        if (rc.warnings.length) errl(io, box(rc.warnings, true));
        var refreshOnly = !!o["refresh-only"];
        if (refreshOnly) {
          if (rf.drift.length) out(io, renderDrift(rf.drift, true));
          else out(io, "\nNo changes. Your infrastructure still matches the configuration.\n\nTerraform has checked that the real remote objects still match the result of\nyour most recent changes, and found no differences.\n");
          if (!isApply) { if (o["detailed-exitcode"] && rf.drift.length) code = 2; return; }
          if (!rf.drift.length) { out(io, "\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.\n"); return; }
          if (!o["auto-approve"] && !confirm(io, "Would you like to update the Terraform state to reflect these detected changes?\n  Terraform will write these changes to the state without modifying any real\n  infrastructure.\n  There is no undo. Only 'yes' will be accepted to confirm.")) { code = 1; return; }
          var nf = {}; keys(rf.refreshed).forEach(function (a) { nf[a] = rf.refreshed[a]; });
          var ns = unflat(nf, state); saveState(bk, ns, sess);
          out(io, "\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.\n");
          IAC.ev(sess.sys, { kind: "tf-refresh" });
          return;
        }
        var visibleDrift = rf.drift.filter(function (d) { var c = rc.changes[d.addr]; return d.gone || (c && c.action !== "noop") || !c; });
        if (!saved) out(io, renderDrift(visibleDrift, false));
        var pr = renderPlan(rc, o);
        if (o.target.length && !saved) errl(io, box([new TfErr("Resource targeting is in effect", "You are creating a plan with the -target option, which means that the result\nof this plan may not represent all of the changes requested by the current\nconfiguration.\n\nThe -target option is not for routine use, and is provided only for\nexceptional situations such as recovering from errors or mistakes, or when\nTerraform specifically suggests to use it as part of an error message.")], true));
        if (!pr.any) {
          if (!saved) out(io, "\nNo changes. " + (o.destroy ? "No objects need to be destroyed.\n\nEither you have not created any objects yet or the existing objects were\nalready deleted outside of Terraform.\n" : "Your infrastructure matches the configuration.\n\nTerraform has compared your real infrastructure against your configuration\nand found no differences, so no changes are needed.\n"));
          if (isApply) { if (rf.drift.length) { var ns0 = unflat(rf.refreshed, state); state = ns0; } out(io, "\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.\n"); if (keys(cfg.outputs).length && !o.destroy) { var st2 = state; st2.outputs = {}; keys(rc.outputs).forEach(function (k) { st2.outputs[k] = { value: rc.outputs[k].v, type: tfType(rc.outputs[k].v) }; if (rc.outputs[k].sens) st2.outputs[k].sensitive = true; }); saveState(bk, st2, sess); out(io, "\nOutputs:\n\n" + renderOutputs(st2.outputs)); } }
          if (!isApply && o.out) writePlan(fs, dir, o, state, rc);
          return;
        }
        if (!saved) out(io, "\n" + pr.text + "\n");
        if (!isApply) {
          if (o.out) { writePlan(fs, dir, o, state, rc); out(io, "\n─────────────────────────────────────────────────────────────────────────────\n\nSaved the plan to: " + o.out + "\n\nTo perform exactly these actions, run the following command to apply:\n    terraform apply \"" + o.out + "\"\n"); }
          else out(io, "\n─────────────────────────────────────────────────────────────────────────────\n\nNote: You didn't use the -out option to save this plan, so Terraform can't\nguarantee to take exactly these actions if you run \"terraform apply\" now.\n");
          if (o["detailed-exitcode"]) code = 2;
          IAC.ev(sess.sys, { kind: "tf-plan", add: pr.counts.add, change: pr.counts.change, destroy: pr.counts.destroy, dir: dir });
          A.lastPlan = { dir: dir, changes: keys(rc.changes).map(function (k) { var c = rc.changes[k]; return { addr: k, action: c.action, type: c.r ? c.r.type : c.st.type }; }).filter(function (c) { return c.action !== "noop" && c.action !== "read"; }), t: now(sess.sys), cmd: CI.homeSys(sess.sys).cmdIndex };
          return;
        }
        if (!o["auto-approve"]) { if (!confirm(io, o.destroy ? "Do you really want to destroy all resources?\n  Terraform will destroy all your managed infrastructure, as shown above.\n  There is no undo. Only 'yes' will be accepted to confirm." : "Do you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only 'yes' will be accepted to approve.")) { code = 1; return; } }
        out(io, "\n");
        var res = applyRun(rc, cfg, io, label);
        var ns2 = unflat(res.flat, state); ns2.outputs = res.outputs;
        saveState(bk, ns2, sess);
        IAC.syncNet(sess.sys);
        A.lastPlan = null;
        if (res.failed) { code = 1; IAC.ev(sess.sys, { kind: "tf-apply-failed", dir: dir }); return; }
        out(io, "\n" + (o.destroy ? "Destroy" : "Apply") + " complete! Resources: " + (res.n.imp ? res.n.imp + " imported, " : "") + (o.destroy ? res.n.destroy + " destroyed.\n" : res.n.add + " added, " + res.n.change + " changed, " + res.n.destroy + " destroyed.\n"));
        if (keys(res.outputs).length && !o.destroy) out(io, "\nOutputs:\n\n" + renderOutputs(res.outputs));
        IAC.ev(sess.sys, { kind: o.destroy ? "tf-destroy-all" : "tf-apply", add: res.n.add, change: res.n.change, destroy: res.n.destroy, dir: dir });
      });
    } catch (e) { if (e instanceof TfErr) { errl(io, box([e])); return 1; } throw e; }
    function confirm(io2, text) {
      out(io2, "\n" + text + "\n\n  Enter a value: ");
      if (/^yes$/m.test(io2.stdin || "")) { out(io2, "yes\n"); return true; }
      out(io2, "\n"); if (io2.note) io2.note("(The lab can't type 'yes' for you. Use -auto-approve, pipe it in (echo yes | terraform " + sub + "), or save a plan with -out and apply that file.)");
      errl(io2, "\n" + (sub === "destroy" ? "Destroy" : "Apply") + " cancelled.\n");
      return false;
    }
    return code;
  }
  function writePlan(fs, dir, o, state, rc) { var p = o.out.charAt(0) === "/" ? o.out : dir + "/" + o.out; fs.write(p, "PK\u0003\u0004" + JSON.stringify({ serial: state.serial, opts: { vars: o.vars, varFiles: o.varFiles, target: o.target, replace: o.replace, destroy: !!o.destroy, "refresh-only": !!o["refresh-only"] }, changes: keys(rc.changes).filter(function (a) { return rc.changes[a].action !== "noop"; }).map(function (a) { return { addr: a, action: rc.changes[a].action }; }) }), 420); }
  function renderOutputs(outs) { var ks = keys(outs).sort(), w = Math.max.apply(null, [0].concat(ks.map(function (k) { return k.length; }))); return ks.map(function (k) { return k + new Array(w - k.length + 2).join(" ") + "= " + (outs[k].sensitive ? "<sensitive>" : renderVal(outs[k].value, 0, false, 2)) + "\n"; }).join(""); }
  IAC.renderOutputs = renderOutputs;
  function tfOutput(io, bk, o) {
    var st = loadState(bk), outs = st.outputs || {}, name = o.pos[0];
    if (!keys(outs).length && !name) { errl(io, box([new TfErr("No outputs found", "The state file either has no outputs defined, or all the defined outputs are\nempty. Please define an output in your configuration with the `output`\nkeyword and run `terraform refresh` for it to become available. If you are\nusing interpolation, please verify the interpolated value is not empty. You\ncan use the `terraform console` command to assist.")], true)); return 0; }
    if (name) { if (!outs[name]) { errl(io, box([new TfErr("Output \"" + name + "\" not found", "The output variable requested could not be found in the state file. If you\nrecently added this to your configuration, be sure to run `terraform apply`,\nsince the state won't be updated with new output variables until that command\nis run.")])); return 1; } var v = outs[name].value; if (o.raw) { if (typeof v === "object" && v !== null) { errl(io, box([new TfErr("Unsupported value for raw output", "The -raw option only supports strings, numbers, and boolean values, but output value \"" + name + "\" is " + (Array.isArray(v) ? "tuple" : "object") + ".\n\nUse the -json option for machine-readable representations of output values that have complex types.")])); return 1; } out(io, String(v)); return 0; } if (o.json) { out(io, JSON.stringify(v) + "\n"); return 0; } out(io, renderVal(v, 0) + "\n"); return 0; }
    if (o.json) { var j = {}; keys(outs).forEach(function (k) { j[k] = { sensitive: !!outs[k].sensitive, type: outs[k].type, value: outs[k].value }; }); out(io, JSON.stringify(j, null, 2) + "\n"); return 0; }
    out(io, renderOutputs(outs)); return 0;
  }
  function renderStateRes(x, a) {
    var L = ["# " + a + ":", (x.mode === "data" ? "data" : "resource") + " \"" + x.type + "\" \"" + x.name + "\" {"];
    var sch = (x.mode === "data" ? DATA : SCHEMA)[x.type] || { a: {} }, ks = keys(x.attrs).filter(function (k) { var v = x.attrs[k]; return v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(sch.b && sch.b[k] && !sch.b[k].attr) && !(v && typeof v === "object" && !Array.isArray(v) && !keys(v).length); }).sort();
    var sens = (x.sens || []).map(function (p) { return p[0] && p[0].value; });
    var w = Math.max.apply(null, [0].concat(ks.map(function (k) { return k.length; })));
    ks.forEach(function (k) { L.push("    " + k + new Array(w - k.length + 2).join(" ") + "= " + (sens.indexOf(k) >= 0 || (sch.a[k] && sch.a[k].s) ? "(sensitive value)" : renderVal(x.attrs[k], 4, false, 4))); });
    if (sch.b) keys(sch.b).forEach(function (bn) { if (sch.b[bn].attr) return; (x.attrs[bn] || []).forEach(function (b) { L.push("", "    " + bn + " {"); var bk = keys(b).filter(function (k) { return b[k] !== null && b[k] !== "" && !(Array.isArray(b[k]) && !b[k].length); }).sort(); var w2 = Math.max.apply(null, [0].concat(bk.map(function (k) { return k.length; }))); bk.forEach(function (k) { L.push("        " + k + new Array(w2 - k.length + 2).join(" ") + "= " + renderVal(b[k], 8, false, 4)); }); L.push("    }"); }); });
    L.push("}");
    return L.join("\n");
  }
  function tfShow(io, sess, fs, dir, bk, o) {
    if (o.pos[0]) { var pt = fs.read(o.pos[0].charAt(0) === "/" ? o.pos[0] : dir + "/" + o.pos[0]); if (pt == null || !/^PK/.test(pt)) { errl(io, box([new TfErr("Failed to read the given file as a state or plan file", "State read error: Error loading statefile: open " + o.pos[0] + ": no such file or directory")])); return 1; } var p = JSON.parse(pt.slice(4)); if (o.json) { out(io, JSON.stringify({ format_version: "1.2", terraform_version: VERSION, resource_changes: p.changes.map(function (c) { return { address: c.addr, change: { actions: c.action === "replace" ? ["delete", "create"] : [c.action] } }; }) }) + "\n"); return 0; } out(io, "\nTerraform will perform the following actions:\n\n" + p.changes.map(function (c) { return "  # " + c.addr + " will be " + { create: "created", update: "updated in-place", "delete": "destroyed", replace: "replaced" }[c.action]; }).join("\n") + "\n"); return 0; }
    var st = loadState(bk), f = flat(st);
    if (!keys(f).length) { out(io, "No state.\n"); return 0; }
    if (o.json) { out(io, JSON.stringify({ format_version: "1.0", terraform_version: VERSION, values: { root_module: { resources: keys(f).map(function (a) { return { address: a, mode: f[a].mode, type: f[a].type, name: f[a].name, values: f[a].attrs }; }) } } }) + "\n"); return 0; }
    out(io, keys(f).map(function (a) { return renderStateRes(f[a], a); }).join("\n\n") + "\n" + (keys(st.outputs || {}).length ? "\n\nOutputs:\n\n" + renderOutputs(st.outputs) : ""));
    return 0;
  }
  function tfState(io, sess, fs, dir, bk, rest, o) {
    var sub = rest[0], args = o.pos.slice(1);
    if (!sub) { out(io, "Usage: terraform [global options] state <subcommand> [options] [args]\n\n  This command has subcommands for advanced state management.\n\nSubcommands:\n    list                List resources in the state\n    mv                  Move an item in the state\n    pull                Pull current state and output to stdout\n    push                Update remote state from a local state file\n    rm                  Remove instances from the state\n    show                Show a resource in the state\n"); return 0; }
    var st = loadState(bk), f = flat(st);
    if (sub === "list") { var ks = keys(f).sort(function (x, y) { var mx = /^module./.test(x), my = /^module./.test(y); if (mx !== my) return mx ? 1 : -1; var dx = x.replace(/^data./, ""), dy = y.replace(/^data./, ""); return dx < dy ? -1 : dx > dy ? 1 : 0; }).filter(function (a) { return !args.length || args.some(function (p) { return a === p || a.indexOf(p + "[") === 0 || a.indexOf(p + ".") === 0; }); }); out(io, ks.map(function (a) { return a + "\n"; }).join("")); return 0; }
    if (sub === "show") { var a = args[0]; if (!a || !f[a]) { errl(io, box([new TfErr("No instance found for the given address!", "This command requires that the address references one specific instance.\nTo view the available instances, use \"terraform state list\". Please modify\nthe address to reference a specific instance.")])); return 1; } out(io, renderStateRes(f[a], a) + "\n"); return 0; }
    if (sub === "pull") { out(io, JSON.stringify(st, null, 2) + "\n"); return 0; }
    if (sub === "mv" || sub === "rm") {
      var code = 0;
      withLock(bk, o, "OperationTypeInvalid", function () {
        if (sub === "mv") {
          var from = args[0], to = args[1];
          if (!from || !to) { errl(io, "Usage: terraform [global options] state mv [options] SOURCE DESTINATION\n"); code = 1; return; }
          var moved = keys(f).filter(function (x) { return x === from || x.indexOf(from + "[") === 0; });
          if (!moved.length) { errl(io, box([new TfErr("Invalid source address", "Cannot move " + from + ": does not match anything in the current state.")])); code = 1; return; }
          if (f[to]) { errl(io, box([new TfErr("Invalid target address", "Cannot move to " + to + ": there is already a resource instance at that address in the current state.")])); code = 1; return; }
          moved.forEach(function (x) { var nx = to + x.slice(from.length), y = f[x], pa = parseAddr(nx); f[nx] = Object.assign({}, y, { name: pa.name, type: pa.type, module: pa.module, key: pa.key }); delete f[x]; });
          saveState(bk, Object.assign(unflat(f, st), { outputs: st.outputs }), sess);
          out(io, "Move \"" + from + "\" to \"" + to + "\"\nSuccessfully moved " + moved.length + " object(s).\n");
          IAC.ev(sess.sys, { kind: "tf-state-mv", from: from, to: to });
        } else {
          if (!args.length) { errl(io, "Usage: terraform [global options] state rm [options] ADDRESS...\n"); code = 1; return; }
          var n = 0;
          args.forEach(function (p) { keys(f).forEach(function (x) { if (x === p || x.indexOf(p + "[") === 0) { delete f[x]; n++; out(io, "Removed " + x + "\n"); } }); });
          if (!n) { errl(io, box([new TfErr("Invalid target address", "No matching objects found. To view the available instances, use \"terraform\nstate list\". Please modify the address to reference a specific instance.")])); code = 1; return; }
          saveState(bk, Object.assign(unflat(f, st), { outputs: st.outputs }), sess);
          out(io, "Successfully removed " + n + " resource instance(s).\n");
          IAC.ev(sess.sys, { kind: "tf-state-rm", addrs: args });
        }
      });
      return code;
    }
    errl(io, "Terraform has no state subcommand named \"" + sub + "\".\n"); return 1;
  }
  function tfImport(io, sess, fs, dir, cfg, bk, o) {
    var addr = o.pos[0], id = o.pos[1];
    if (!addr || !id) { errl(io, box([new TfErr("Wrong number of arguments", "The import command expects two arguments: the address to import into and\nthe ID of the remote object.")])); return 1; }
    var base = addr.replace(/\[.*$/, ""), parts = base.split("."), type = parts[parts.length - 2], name = parts[parts.length - 1];
    var rcfg = cfg.resources.filter(function (r) { return r.mode === "managed" && r.type === type && r.name === name; })[0];
    if (!rcfg) { errl(io, box([new TfErr("resource address \"" + addr + "\" does not exist in the configuration.", "Before importing this resource, please create its configuration in the root module. For example:\n\nresource \"" + type + "\" \"" + name + "\" {\n  # (resource arguments)\n}")])); return 1; }
    var code = 0;
    withLock(bk, o, "OperationTypeImport", function () {
      var st = loadState(bk), f = flat(st), A = IAC.aws(sess.sys);
      if (f[addr]) { errl(io, box([new TfErr("Resource already managed by Terraform", "Terraform is already managing a remote object for " + addr + ". To import to this address you must first remove the existing object from the state.")])); code = 1; return; }
      out(io, addr + ": Importing from ID \"" + id + "\"...\n");
      var obj = IAC.find(A, type, function (x) { return x.id === id; });
      if (!obj) { errl(io, box([new TfErr("Cannot import non-existent remote object", "While attempting to import an existing object to \"" + addr + "\", the provider detected that no object exists with the given id. Only pre-existing objects can be imported; check that the id is correct and that it is associated with the provider's configured region or endpoint, or use \"terraform apply\" to create a new remote object for this resource.")])); code = 1; return; }
      out(io, addr + ": Import prepared!\n  Prepared " + type + " for import\n" + addr + ": Refreshing state... [id=" + id + "]\n");
      var sch = SCHEMA[type], at = {}; keys(sch.a).forEach(function (k) { at[k] = obj[k] === undefined ? null : clone(obj[k]); }); keys(sch.b || {}).forEach(function (k) { at[k] = obj[k] || []; });
      f[addr] = { mode: "managed", type: type, name: name, module: "", key: addr.indexOf("[") > 0 ? JSON.parse(addr.slice(addr.indexOf("[") + 1, -1)) : null, attrs: at, deps: [], provider: provAddr(provOf(type)) };
      saveState(bk, Object.assign(unflat(f, st), { outputs: st.outputs }), sess);
      out(io, "\nImport successful!\n\nThe resources that were imported are shown above. These resources are now in\nyour Terraform state and will henceforth be managed by Terraform.\n\n");
      IAC.ev(sess.sys, { kind: "tf-import", addr: addr, type: type, id: id });
    });
    return code;
  }

  /* ================================================================== helpers for labs */
  // State of a working directory as {addr: {...}} (reads the configured backend)
  IAC.stateOf = function (sys, dir, user) {
    var sess = S.newSession(sys, { user: user || "dev" }); sess.cwd = dir;
    var fs = fsOf(sess), bk = backendOf({ sess: sess, fs: fs, dir: dir });
    var st = bk.read(); return st ? { raw: st, flat: flat(st), backend: bk.type } : null;
  };
  IAC.stateFromS3 = function (sys, bucket, key) { var A = IAC.aws(sys), b = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === bucket; }); var o = b && b.objects && b.objects[key]; return o ? { raw: JSON.parse(o.body), flat: flat(JSON.parse(o.body)) } : null; };
  // Make cloud objects directly (lab setup) — same code path as Terraform's create
  IAC.make = function (sys, type, attrs) {
    var A = IAC.aws(sys), sch = SCHEMA[type], o = {};
    keys(sch.a).forEach(function (k) { o[k] = attrs[k] !== undefined ? attrs[k] : (sch.a[k].def !== undefined ? sch.a[k].def : null); });
    keys(sch.b || {}).forEach(function (k) { o[k] = attrs[k] || (sch.b[k].comp ? undefined : []); });
    if (o.tags && !o.tags_all) o.tags_all = clone(o.tags); if (!o.tags) { o.tags = null; o.tags_all = {}; }
    A.clockNow = now(sys);
    var r = PROV[type].create(A, o, null);
    keys(sch.a).forEach(function (k) { if (r[k] === undefined) r[k] = null; });
    IAC.bag(A, type)[r.id] = r;
    return r;
  };
  // Seed a state file that matches cloud objects (lab setup): {addr: obj}
  IAC.seedState = function (sys, dir, objs, o) {
    o = o || {};
    var f = {};
    keys(objs).forEach(function (a) { var obj = objs[a], parts = a.replace(/\[.*$/, "").split("."); var type = parts[parts.length - 2], name = parts[parts.length - 1]; var sch = SCHEMA[type], at = {}; keys(sch.a).forEach(function (k) { at[k] = obj[k] === undefined ? null : clone(obj[k]); }); keys(sch.b || {}).forEach(function (k) { at[k] = obj[k] || []; }); var km = /\[(.*)\]$/.exec(a); f[a] = { mode: "managed", type: type, name: name, module: parts.slice(0, -2).join("."), key: km ? JSON.parse(km[1]) : null, attrs: at, deps: [], provider: provAddr(provOf(type)) }; });
    var st = unflat(f, emptyState()); st.serial = o.serial || 4; st.lineage = "8a1f6c2e-" + M2.hexOf("seedlin" + dir, 4) + "-4c1e-9b0d-" + M2.hexOf("seedlin2" + dir, 12); st.outputs = o.outputs || {};
    var body = JSON.stringify(st, null, 2) + "\n";
    if (o.bucket) { var A = IAC.aws(sys), b = IAC.find(A, "aws_s3_bucket", function (x) { return x.bucket === o.bucket; }); (b.objects = b.objects || {})[o.key] = { body: body, t: 0 }; }
    else { S.mkdirs(sys, dir, 493, o.uid || 1000, o.uid || 1000); S.put(sys, dir + "/" + (o.file || "terraform.tfstate"), body, 420, o.uid || 1000, o.uid || 1000); }
    return st;
  };
})(typeof window !== "undefined" ? window : globalThis);
