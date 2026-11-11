# sudo learn

Hands-on labs for learning Python, PowerShell, Linux, Git & GitHub, Networking, DevOps and AppSec on the way to DevSecOps. Each lab is a "ticket" at a fictional company, Kestrel Cloud: you learn one idea, then use it to close the ticket.

**Play:** https://sarveshp16.github.io/skills-lab/

## Tracks

| # | Track | Status |
|---|-------|--------|
| 1 | Python | Complete: 4 modules, 32 labs, 4 capstone projects and 99 practice drills |
| 2 | PowerShell | Complete: 32 labs, 4 capstone projects and 108 practice drills, on a simulated PowerShell 7 (with simulated Windows GUI windows, scripts run like programs, Pester and PSScriptAnalyzer) |
| 3 | Linux | Modules 1-2 open: 17 labs, 2 capstone projects and 57 practice drills (36 labs planned), typed into a simulated Bash terminal on an Ubuntu 24.04 server with real services, packages, disks, a network and SSH to other servers |
| 4 | Git & GitHub | Module 1 open: 9 labs, a capstone project and 30 practice drills (36 labs planned), typed into a simulated Git 2.43 (real commit IDs, merges, conflicts, stash, bisect) with an editor panel for resolving conflicts |
| 5 | Networking | planned |
| 6 | DevOps | planned |
| 7 | AppSec & Security | planned |

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
prototype/night-shift the earlier Linux/Networking/DevOps prototype, to be reused by later tracks
```
