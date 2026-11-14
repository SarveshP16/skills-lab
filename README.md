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
| 6 | DevOps | outline published (devops/): 5 modules, 49 labs planned (Docker, CI/CD in GitHub Actions and Bamboo, Terraform & Ansible, Kubernetes, observability); labs not built yet |
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
devops/               DevOps track outline page (labs not built yet)
appsec/               AppSec & Security track outline page (labs not built yet)
prototype/night-shift the earlier Linux/Networking/DevOps prototype, to be reused by later tracks
```
