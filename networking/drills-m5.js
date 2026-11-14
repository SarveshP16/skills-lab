/* sudo learn — Networking Module 5 practice drills (3 per lab, +5 XP each). Loaded after labs-m5.js and labs-m5b.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, N = window.NetCore, NH = window.NetLab.H, X = T.M5, C5 = N.cloud, ID = X.ID, HOST = X.HOST;
  var lines = T.lines, ran = NH.ran, outHas = NH.outHas, NOW = S.NOW, DAY = S.DAY;
  function cloud(sys) { N.cloudLab(sys); }
  function awsOut(r, re, fn) { return ran(r, /^\s*aws\b/, function (e) { return re.test(e.cmd) && e.exit === 0 && fn(e); }); }
  function lineIs(e, s) { return e.out.some(function (l) { return l.trim() === s; }); }
  function caSys(sys) {
    X.mtlsSys(sys);
    var kid = M2.hexOf("drill-ca", 16), now = sys.now, P = N.pki;
    M2.putRoot(sys, "/home/dev/pki/ca.key", P.keyText(kid, "ec256"), 384, 1000, 1000, now - 30 * DAY);
    M2.putRoot(sys, "/home/dev/pki/ca.crt", P.certText({ s: "CN = Kestrel Service CA", i: "CN = Kestrel Service CA", nb: now - 30 * DAY, na: now + 3600 * DAY, san: [], sn: "4A1F", key: "ec256", sig: "ecdsa-with-SHA256", ca: true, pk: kid, ik: kid }), 420, 1000, 1000, now - 30 * DAY);
    M2.putRoot(sys, "/home/dev/pki/ca.srl", "4A20\n", 420, 1000, 1000, now - 30 * DAY);
    M2.putRoot(sys, "/home/dev/pki/old.crt", P.certText({ s: "CN = old-svc", i: "CN = Kestrel Service CA", nb: now - 20 * DAY, na: now - 13 * DAY, san: [], sn: "4A20", key: "ec256", sig: "ecdsa-with-SHA256", ca: false, pk: M2.hexOf("old", 16), ik: kid }), 420, 1000, 1000, now - 20 * DAY);
  }

  var DRILLS = {
    "net-501": [
      { id: "d1", title: "Names and addresses", system: cloud, text: "<p>Print every instance's <b>Name</b> tag and private IP, as text (one instance per line).</p>", starter: "", solution: lines("aws ec2 describe-instances --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value, PrivateIpAddress]' --output text"),
        check: function (r) { return awsOut(r, /describe-instances/, function (e) { return outHas(e, /^web-1\s+10\.0\.11\.20$/) && outHas(e, /^db-1\s+10\.0\.21\.30$/); }) ? true : "--query with [Name tag, PrivateIpAddress] per instance and --output text."; } },
      { id: "d2", title: "Which route table?", system: cloud, text: "<p>Show the route table that subnet <b>app-a</b> (<code>" + ID.sub("app-a") + "</code>) uses, by filtering on the association.</p>", starter: "", solution: lines("aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=" + ID.sub("app-a")),
        check: function (r) { return awsOut(r, /describe-route-tables.*association\.subnet-id/, function (e) { return outHas(e, /kestrel-prod-private-a/) && !outHas(e, /kestrel-prod-public/); }) ? true : "--filters Name=association.subnet-id,Values=SUBNET-ID"; } },
      { id: "d3", title: "The NAT's address", system: cloud, text: "<p>Print only the NAT gateway's <b>public IP</b>.</p>", starter: "", solution: lines("aws ec2 describe-nat-gateways --query 'NatGateways[0].NatGatewayAddresses[0].PublicIp' --output text"),
        check: function (r) { return awsOut(r, /describe-nat-gateways/, function (e) { return lineIs(e, "192.0.2.10"); }) ? true : "Query NatGateways[0].NatGatewayAddresses[0].PublicIp, as text."; } }
    ],
    "net-502": [
      { id: "d1", title: "Open to the world", system: X.sgNaclSys, text: "<p>List the <b>names</b> of the security groups that allow something in from <code>0.0.0.0/0</code>, using a <code>--filters</code> filter.</p>", starter: "", solution: lines("aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 --query 'SecurityGroups[].GroupName' --output text"),
        check: function (r) { return awsOut(r, /describe-security-groups.*ip-permission\.cidr/, function (e) { var t = e.out.join(" "); return /kestrel-bastion/.test(t) && /kestrel-db/.test(t) && !/kestrel-web/.test(t); }) ? true : "--filters Name=ip-permission.cidr,Values=0.0.0.0/0 and the group names."; } },
      { id: "d2", title: "From a group", system: cloud, text: "<p>Allow HTTPS (443) into <code>kestrel-web</code> from the load balancer's security group (<code>" + ID.sg("alb") + "</code>).</p>", starter: "", solution: lines("aws ec2 authorize-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 443 --source-group " + ID.sg("alb")),
        check: function (r) { return X.sgOf(r, "web").rules.some(function (x) { return !x.egress && x.sg === ID.sg("alb") && x.from === 443; }) ? true : "authorize-security-group-ingress with --source-group."; } },
      { id: "d3", title: "Inbound only", system: X.sgNaclSys, text: "<p>Show only the <b>inbound</b> entries of the database subnets' network ACL (<code>" + C5.hid("acl", "db") + "</code>).</p>", starter: "", solution: lines("aws ec2 describe-network-acls --network-acl-ids " + C5.hid("acl", "db") + " --query 'NetworkAcls[0].Entries[?Egress==`false`]'"),
        check: function (r) { return awsOut(r, /describe-network-acls/, function (e) { return outHas(e, /"RuleNumber": 110/) && !outHas(e, /"Egress": true/); }) ? true : "A JMESPath filter on Egress: Entries[?Egress==`false`]."; } }
    ],
    "net-503": [
      { id: "d1", title: "Healthy?", system: cloud, text: "<p>Print each target's <b>ID and state</b>, one per line, as text.</p>", starter: "", solution: lines("aws elbv2 describe-target-health --target-group-arn " + ID.tg + " --query 'TargetHealthDescriptions[].[Target.Id, TargetHealth.State]' --output text"),
        check: function (r) { return awsOut(r, /describe-target-health/, function (e) { return e.out.filter(function (l) { return /^i-\S+\s+healthy$/.test(l); }).length === 2; }) ? true : "--query 'TargetHealthDescriptions[].[Target.Id, TargetHealth.State]' --output text"; } },
      { id: "d2", title: "Its name", system: cloud, text: "<p>Print only the load balancer's <b>DNS name</b>.</p>", starter: "", solution: lines("aws elbv2 describe-load-balancers --names kestrel-shop-alb --query 'LoadBalancers[0].DNSName' --output text"),
        check: function (r) { return awsOut(r, /describe-load-balancers/, function (e) { return lineIs(e, C5.ALB_DNS); }) ? true : "LoadBalancers[0].DNSName, as text."; } },
      { id: "d3", title: "Take one out", system: cloud, text: "<p>Deregister <b>web-2</b> from the target group, then show the site still answers through the load balancer.</p>", starter: "", solution: lines("aws elbv2 deregister-targets --target-group-arn " + ID.tg + " --targets Id=" + ID.web2, "curl -s http://" + C5.ALB_DNS + "/"),
        check: function (r) { if (C5.of(r.sys).tgs[0].targets.some(function (x) { return x.id === ID.web2; })) return "web-2 is still registered."; return ran(r, /\bcurl\b.*elb\.amazonaws\.com/, function (e) { return outHas(e, /served by web-1/); }) ? true : "Now curl the load balancer."; } }
    ],
    "net-504": [
      { id: "d1", title: "Localhost only", system: X.dockerSys, text: "<p>Run <code>nginx:1.27</code> as a container named <code>status</code>, publishing its port 80 on <b>127.0.0.1:8081 only</b>.</p>", starter: "", solution: lines("docker run -d --name status -p 127.0.0.1:8081:80 nginx:1.27"),
        check: function (r) { var c = N.docker.ctrByName(N.docker.dock(r.sys), "status"); if (!c || c.name !== "status") return "No container named status."; return c.ports.some(function (p) { return p.hostIp === "127.0.0.1" && p.hostPort === 8081 && p.ctrPort === 80; }) ? true : "-p 127.0.0.1:8081:80"; } },
      { id: "d2", title: "By name", system: X.dockerSys, text: "<p>Create a network <code>lab</code>, run <code>nginx:1.27</code> on it as <code>web</code>, and fetch <code>http://web/</code> from a throwaway <code>busybox:1.36</code> container on the same network.</p>", starter: "", solution: lines("docker network create lab", "docker run -d --name web --network lab nginx:1.27", "docker run --rm --network lab busybox:1.36 wget -qO- http://web/"),
        check: function (r) { return ran(r, /docker\s+run\b.*busybox/, function (e) { return outHas(e, /Welcome to nginx/); }) ? true : "docker run --rm --network lab busybox:1.36 wget -qO- http://web/"; } },
      { id: "d3", title: "What's published", system: X.dockerSys, text: "<p>Show the port mappings of the <code>api</code> container.</p>", starter: "", solution: lines("docker port api"),
        check: function (r) { return ran(r, /docker\s+(container\s+)?port\b/, function (e) { return outHas(e, /^8000\/tcp -> 0\.0\.0\.0:8000$/); }) ? true : "docker port api"; } }
    ],
    "net-505": [
      { id: "d1", title: "Rejected, per port", system: X.flowsA, text: "<p>Count the <b>REJECT</b> records per destination port, most first.</p>", starter: "", solution: lines("awk '$13 == \"REJECT\" {print $7}' " + X.FL_FILE + " | sort | uniq -c | sort -rn"),
        check: function (r) { return ran(r, /flows/, function (e) { return /REJECT/.test(e.cmd) && /uniq\s+-c/.test(e.cmd) && outHas(e, /^\s*\d+ 3389$/) && /^\s*(\d+)/.test(e.out[0] || "") && +/^\s*(\d+)/.exec(e.out[0])[1] >= +((/^\s*(\d+)/.exec(e.out[e.out.length - 1] || "") || [0, 0])[1]); }) ? true : "awk the 7th field of REJECT records, then sort | uniq -c | sort -rn."; } },
      { id: "d2", title: "How many?", system: X.flowsA, text: "<p>How many records mention the scanner <code>198.51.100.77</code>? Print just the number.</p>", starter: "", solution: lines("grep -c 198.51.100.77 " + X.FL_FILE),
        check: function (r) { return ran(r, /198\.51\.100\.77/, function (e) { return lineIs(e, "38"); }) ? true : "grep -c counts matching lines."; } },
      { id: "d3", title: "Count in CloudWatch", system: X.flowsA, text: "<p>Ask CloudWatch Logs how many flow log events mention <code>198.51.100.77</code> (<code>--query 'length(events)'</code>).</p>", starter: "", solution: lines("aws logs filter-log-events --log-group-name /kestrel/vpc-flow-logs --filter-pattern '198.51.100.77' --query 'length(events)'"),
        check: function (r) { return awsOut(r, /filter-log-events/, function (e) { return lineIs(e, "38"); }) ? true : "--filter-pattern with the address and --query 'length(events)'."; } }
    ],
    "net-506": [
      { id: "d1", title: "Read a certificate", system: X.mtlsSys, text: "<p>Show the subject, issuer and expiry date of <code>/etc/ssl/kestrel/payments.crt</code>.</p>", starter: "", solution: lines("openssl x509 -in /etc/ssl/kestrel/payments.crt -noout -subject -issuer -enddate"),
        check: function (r) { return ran(r, /openssl\s+x509/, function (e) { return outHas(e, /^subject=.*payments/) && outHas(e, /^issuer=/) && outHas(e, /^notAfter=/); }) ? true : "openssl x509 -in FILE -noout -subject -issuer -enddate"; } },
      { id: "d2", title: "Expired", system: caSys, text: "<p>Verify <code>~/pki/old.crt</code> against <code>~/pki/ca.crt</code>. Why does it fail?</p>", starter: "", solution: lines("openssl verify -CAfile ~/pki/ca.crt ~/pki/old.crt"),
        check: function (r) { return ran(r, /openssl\s+verify/, function (e) { return outHas(e, /certificate has expired/); }) ? true : "openssl verify -CAfile ~/pki/ca.crt ~/pki/old.crt"; } },
      { id: "d3", title: "One day only", system: caSys, text: "<p>With the CA in <code>~/pki</code> (key included), issue <code>~/pki/batch.crt</code> for <code>CN=batch-job</code>, valid for <b>1 day</b>.</p>", starter: "", solution: lines("cd ~/pki", "openssl req -new -newkey ec -nodes -keyout batch.key -out batch.csr -subj '/CN=batch-job'", "openssl x509 -req -in batch.csr -CA ca.crt -CAkey ca.key -CAserial ca.srl -out batch.crt -days 1"),
        check: function (r) { var ca = X.certAt(r, "/home/dev/pki/ca.crt"), c = X.certAt(r, "/home/dev/pki/batch.crt"); if (!c) return "No ~/pki/batch.crt yet."; if (!/CN = batch-job/.test(c.s)) return "CN=batch-job"; if (c.ik !== ca.pk) return "Sign it with the CA in ~/pki."; return c.na - c.nb <= DAY + 1000 ? true : "-days 1"; } }
    ],
    "net-507": [
      { id: "d1", title: "Detect or block?", system: X.egressSys, text: "<p>Show which mode ModSecurity's rule engine is in.</p>", starter: "", solution: lines("grep SecRuleEngine /etc/nginx/modsec/modsecurity.conf"),
        check: function (r) { return ran(r, /SecRuleEngine/, function (e) { return outHas(e, /^SecRuleEngine DetectionOnly/); }) ? true : "grep SecRuleEngine in /etc/nginx/modsec/modsecurity.conf"; } },
      { id: "d2", title: "Block XSS", system: X.egressSys, text: "<p>Turn blocking on, then show that <code>https://kestrel.example.com/search?q=%3Cscript%3Ealert(1)%3C/script%3E</code> gets <b>403</b>.</p>", starter: "", solution: lines("sudo sed -i 's/^SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/nginx/modsec/modsecurity.conf", "sudo systemctl reload nginx", "curl -s -o /dev/null -w '%{http_code}' 'https://kestrel.example.com/search?q=%3Cscript%3Ealert(1)%3C/script%3E'"),
        check: function (r) { return ran(r, /\bcurl\b.*%3Cscript/i, function (e) { return outHas(e, /\b403\b/); }) ? true : "SecRuleEngine On, reload nginx, then curl the XSS request."; } },
      { id: "d3", title: "Through the proxy", system: X.egressSys, text: "<p>From web-1, fetch <code>http://archive.ubuntu.com/ubuntu/</code> through the proxy (<code>10.0.2.50:3128</code>) and show the response headers.</p>", starter: "", solution: lines("aws ssm start-session --target " + ID.web1, "curl -sI -x http://10.0.2.50:3128 http://archive.ubuntu.com/ubuntu/", "exit"),
        check: function (r) { return ran(r, /\bcurl\b.*archive\.ubuntu\.com/, function (e) { return e.host === HOST.web1 && outHas(e, /^Via: 1\.1 proxy-1/); }) ? true : "On web-1: curl -sI -x http://10.0.2.50:3128 http://archive.ubuntu.com/ubuntu/"; } }
    ],
    "net-508": [
      { id: "d1", title: "Valid?", system: X.tfSys, text: "<p>Check the configuration in <code>~/infra/kestrel-network</code> is valid.</p>", starter: "", solution: lines("cd ~/infra/kestrel-network", "terraform validate"),
        check: function (r) { return ran(r, /terraform\s+(-chdir=\S+\s+)?validate/, function (e) { return outHas(e, /^Success! The configuration is valid\./); }) ? true : "terraform validate, in the directory."; } },
      { id: "d2", title: "One check", system: X.tfSys, text: "<p>Run Checkov on <code>~/infra/kestrel-network</code> for <b>CKV_AWS_24</b> only.</p>", starter: "", solution: lines("checkov -d ~/infra/kestrel-network --check CKV_AWS_24 --compact"),
        check: function (r) { return ran(r, /\bcheckov\b.*(--check|-c)\s+CKV_AWS_24/, function (e) { return outHas(e, /Failed checks: 1,/) && !outHas(e, /CKV_AWS_(23|25|260|277)/); }) ? true : "checkov -d DIR --check CKV_AWS_24"; } },
      { id: "d3", title: "What's managed", system: X.tfSys, text: "<p>List the resources Terraform manages in that directory (from its state).</p>", starter: "", solution: lines("cd ~/infra/kestrel-network", "terraform state list"),
        check: function (r) { return ran(r, /terraform\s+(-chdir=\S+\s+)?state\s+list/, function (e) { return outHas(e, /^aws_security_group\.db$/); }) ? true : "terraform state list"; } }
    ],
    "net-509": [
      { id: "d1", title: "Read the finding", system: X.capSys, text: "<p>Print the remote address from <code>~/incident/finding.json</code> with <code>jq -r</code>.</p>", starter: "", solution: lines("jq -r '.Service.Action.NetworkConnectionAction.RemoteIpDetails.IpAddressV4' ~/incident/finding.json"),
        check: function (r) { return ran(r, /\bjq\b/, function (e) { return lineIs(e, "198.51.100.23"); }) ? true : "jq -r '.Service.Action.NetworkConnectionAction.RemoteIpDetails.IpAddressV4'"; } },
      { id: "d2", title: "What runs there", system: X.capSys, text: "<p>Open a session on web-2 and find the process using the most CPU.</p>", starter: "", solution: lines("aws ssm start-session --target " + ID.web2, "ps aux --sort=-%cpu | head -3", "exit"),
        check: function (r) { return ran(r, /\b(ps|top)\b/, function (e) { return e.host === HOST.web2 && outHas(e, /kworkerds/); }) ? true : "On web-2: ps aux --sort=-%cpu | head"; } },
      { id: "d3", title: "Labelled evidence", system: X.capSys, text: "<p>Snapshot web-2's volume with a description that starts with <code>IR:</code>.</p>", starter: "", solution: lines("aws ec2 create-snapshot --volume-id vol-0" + M2.hexOf("vol:web-2", 16) + " --description 'IR: web-2 before analysis'"),
        check: function (r) { var c = C5.of(r.sys), w = C5.instNamed(c, "web-2"); return c.snapshots.some(function (s) { return s.VolumeId === w.vol && /^IR:/.test(s.Description); }) ? true : "aws ec2 create-snapshot --volume-id VOL --description 'IR: …'"; } }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id].map(function (d) { d.layer = d.layer || l.layer; return d; }); });
})();
