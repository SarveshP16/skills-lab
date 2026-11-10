# sudo learn

Hands-on labs for learning Python, PowerShell, Linux, Git & GitHub, Networking, DevOps and AppSec on the way to DevSecOps. Each lab is a "ticket" at a fictional company, Kestrel Cloud: you learn one idea, then use it to close the ticket.

**Play:** https://sarveshp16.github.io/skills-lab/

## Tracks

| # | Track | Status |
|---|-------|--------|
| 1 | Python | Complete: 4 modules, 32 labs, 4 capstone projects and 99 practice drills |
| 2 | PowerShell | Module 1 open: 9 labs, a capstone project and 30 practice drills (34 labs planned), on a simulated PowerShell 7 |
| 3 | Linux | planned |
| 4 | Git & GitHub | planned |
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
assets/js/progress.js shared progress store and track catalogue
python/               Python track (page, UI, Pyodide worker, lab content per module)
prototype/night-shift the earlier Linux/Networking/DevOps prototype, to be reused by later tracks
```
