# sudo learn

Hands-on labs for learning Python, PowerShell, Linux, Git & GitHub, Networking, DevOps and AppSec on the way to DevSecOps. Each lab is a "ticket" at a fictional company, Kestrel Cloud: you learn one idea, then use it to close the ticket.

**Play:** https://sarveshp16.github.io/skills-lab/

## Tracks

| # | Track | Status |
|---|-------|--------|
| 1 | Python | Complete: 4 modules, 32 labs, 4 capstone projects and 99 practice drills |
| 2 | PowerShell | Complete: 32 labs, 4 capstone projects and 108 practice drills, on a simulated PowerShell 7 (with simulated Windows GUI windows, scripts run like programs, Pester and PSScriptAnalyzer) |
| 3 | Linux | complete: 32 labs, 4 capstone projects and 108 practice drills, typed into a simulated Bash terminal on an Ubuntu 24.04 server with real services, packages, disks, a network and SSH to other servers; Module 3 writes scripts in an editor panel (getopts, trap, ShellCheck), Module 4 investigates a break-in and hardens the server (accounts, SUID, ufw, SSH, fail2ban, GPG, package integrity, CI) |
| 4 | Git & GitHub | Complete: 36 labs, 4 capstone projects and 108 practice drills, typed into a simulated Git 2.43 (real commit IDs, merges, conflicts, rebase) talking to a simulated GitHub (pull requests, reviews, branch protection, the gh CLI), with GitHub Actions running on simulated runners (matrix builds, caching, secrets, environments, releases) and Git security (gitleaks, filter-repo, signed commits, secret scanning, Dependabot, CodeQL, OIDC) |
| 5 | Networking | Complete: 48 labs in 5 modules (5 capstones, 144 drills) on a simulated company network around the Linux track's server. Module 1, Up the OSI stack: links and duplex, ARP and VLANs, subnets, IPv6, routing and NAT, TCP/UDP, TLS and certbot, DNS, HTTP. Module 2, Ports & traffic: the ports that matter and their banners, exposed infrastructure services, tcpdump capturing in the background while you work, the TCP handshake, tshark, ICMP and path MTU, DNS and DHCP on the wire, curl timings and mtr, reverse proxies and X-Forwarded-For. Module 3, Attacks & detection: clear-text passwords on the wire, scans and brute force with fail2ban, ARP spoofing and rogue DHCP, DNS cache poisoning, SYN floods and rate limits, Suricata rules, Zeek logs, and reconstructing an intrusion. Module 4, Defending the network: nmap from inside and from other vantage points (office and internet machines you SSH into), closing dangerous ports, ufw, nftables (counters, logging, handles, IPv6), segmentation with host firewalls, a bastion with ProxyJump, WireGuard, TLS versions and HSTS, SPF/DKIM/DMARC, DNSSEC and DNS over HTTPS. Module 5, Cloud networks & DevSecOps: a simulated AWS account with a subset of the real aws CLI (--query, --filters, --output) and Session Manager shells on its instances: VPCs and route tables, security groups vs network ACLs, a load balancer with health checks and Route 53 alias records, Docker networks and why published ports skip ufw (DOCKER-USER), VPC flow logs, mTLS with a private CA, egress through a Squid allowlist, ModSecurity and a CDN, Terraform and Checkov, and containing a compromised instance. A live network map, packet decoder and ports card sit above the terminal. |
| 6 | DevOps | Modules 1 to 4 open: 44 labs (4 capstones, 132 drills) of 52 planned in 5 modules. Module 1, Containers with Docker, on the Git track's laptop with a simulated Docker Engine 27: what containers isolate, running and debugging containers, images, tags vs digests and a private registry, writing Dockerfiles (real BuildKit-style builds with a layer cache, multi-stage builds, .dockerignore, build secrets and build-check warnings), volumes and bind mounts, configuration and secrets, Docker Compose with PostgreSQL and Redis, healthchecks and depends_on, Trivy scanning (vulnerabilities, secrets in old layers, Dockerfile checks), non-root and read-only containers, and a capstone that ships a two-process service with Compose secrets. A live panel above the terminal shows containers, image layers and the last build. Module 2, CI/CD pipelines, on simulated GitHub Actions runners, ghcr.io and Kestrel's deploy platform (kdeploy): pipeline design (parallel jobs, needs, pip and BuildKit caches, timeouts, concurrency), pushing commit-tagged images with a least-privilege GITHUB_TOKEN, pytest coverage gates and required status checks, Semgrep/Trivy/Gitleaks security gates and scanning images before they're pushed, semantic versions and release workflows, rolling, blue-green and canary deployments with automatic error-rate analysis, GitHub environments with secrets, approvals and a rollback workflow, cosign keyless signing, SBOM and SLSA provenance with an admission policy, a declarative Jenkinsfile on a simulated Jenkins (agents, parallel stages, credentials, jenkins-cli), Bamboo YAML Specs plans and deployment projects (requirements, artifacts, encrypted variables, releases, permissions), and a capstone that takes a commit from gates to a signed canary in production. The panel gains Pipeline and Environments tabs. Module 3, Infrastructure as code, on a simulated AWS account (S3, VPC, EC2, IAM, SSM, STS) with Terraform 1.10, Ansible 2.17, Vault 1.18, Checkov and ansible-lint: providers, plan and apply, in-place updates vs replacement, state and what secrets it holds, S3 state with locking, drift, import and moved blocks, validated variables, modules and for_each, a VPC with a hardened EC2 server, an IAM role and user_data, Ansible inventories, ad-hoc commands, playbooks, templates, handlers and idempotency, roles with group_vars, loops, conditions and tags, Vault KV, policies and AppRole, ansible-vault and SSM SecureStrings, Checkov fixes and reasoned suppressions, Terraform in GitHub Actions with OIDC (a read-only plan role on PRs, an apply role only the approved production environment can assume), and a capstone that builds Kestrel's staging environment from one repository. The panel gains Cloud and Hosts tabs. Module 4, Kubernetes, on a simulated k3s v1.31 cluster (kestrel-staging: a control plane and three workers, ingress-nginx, metrics-server, cert-manager, Kyverno and Argo CD) whose pods are real simulated containers pulled from ghcr.io: kubectl contexts, get/describe/logs/exec and debugging failed pods, Deployments with rolling updates and undo, Jobs and CronJobs, Services, cluster DNS, NodePort, LoadBalancer and Ingress with TLS, ConfigMaps and Secrets, liveness/readiness/startup probes, requests and limits, OOMKilled and a HorizontalPodAutoscaler under load, PersistentVolumeClaims and a PostgreSQL StatefulSet, Helm charts and Kustomize overlays, NetworkPolicies (ingress, egress, DNS), RBAC with ServiceAccounts and can-i, Pod Security Admission, Kyverno policies with keyless image-signature verification, trivy k8s, GitOps with Argo CD (auto-sync, self-heal, prune, production by pull request), and a capstone that ships the whole shop from Git. The panel gains Cluster, Workloads and Traffic tabs. Module 5 (observability) is planned in devops/outline.html. |
| 7 | AppSec & Security | outline published (appsec/): 5 modules, 46 labs planned (web basics & threat modeling, injection & XSS, auth & access control, API & LLM security, AppSec in the pipeline) on a simulated Kestrel Shop web app; labs not built yet |

## How it works

- Plain static HTML, CSS and JavaScript. There is no build step, so GitHub Pages serves the files as they are.
- Python labs run real CPython in the browser through [Pyodide](https://pyodide.org) (WebAssembly), inside a Web Worker so an infinite loop can be stopped.
- Progress, XP and your code are saved in the browser's `localStorage`, separately on each device.

## Run locally

```bash
python -m http.server 8770
```

Then open http://localhost:8770/. Opening the HTML files straight from disk won't work, because browsers block Web Workers on `file://` pages.

## Layout

```
index.html            home page: track picker, rank and XP
assets/css/base.css   shared colours, fonts and buttons
assets/css/lab.css    shared lab page layout (editor, console, terminal mode)
assets/js/progress.js shared progress store and track catalogue
assets/js/lab-app.js  shared lab page logic (tasks, hints, drills, XP; editor or terminal mode)
python/               Python track (Pyodide worker, lab content per module)
powershell/           PowerShell track (simulated PowerShell 7, Windows system and GUI windows, labs)
linux/                Linux track (simulated Bash on an Ubuntu server, terminal-first labs)
git/                  Git & GitHub track (simulated git on the same Bash engine, on a developer laptop)
networking/           Networking track (simulated network, tcpdump, TLS and DNS on the Linux engine; network map panel; outline.html has the full plan)
devops/               DevOps track (simulated Docker Engine, Compose and Trivy; CI/CD on simulated GitHub Actions, Jenkins, Bamboo and a deploy platform; IaC on a simulated AWS account with Terraform, Ansible, Vault and Checkov; a simulated Kubernetes cluster with kubectl, Helm, Kustomize, Kyverno and Argo CD; Docker/Pipeline/Cloud/Cluster panel; outline.html has the full plan)
appsec/               AppSec & Security track outline page (labs not built yet)
prototype/night-shift the earlier Linux/Networking/DevOps prototype, to be reused by later tracks
```
