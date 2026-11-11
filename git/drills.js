/* sudo learn — Git Module 1 practice drills (3 per lab, +5 XP each). Terminal drills: type commands; checked as you go. */
(function () {
  "use strict";
  var T = window.GIT_TRACK, G = window.GitCore, GL = window.GitLab, B = T.B, lines = T.lines;
  var HOME = B.HOME;
  function repo(r, n) { return GL.H.repo(r, n); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function out(e) { return e.out.join("\n"); }
  function put(sys, p, t, mode) { G.putFile(sys, HOME + "/" + p, t, mode || 436, 1000, 1000); }
  function simple(path, steps, extra) { return function (sys) { G.build(sys, HOME + "/" + path, Object.assign({ steps: steps }, extra || {})); }; }
  var NOTES = [
    { msg: "Add notes", by: "dev", at: "2026-11-02 10:00", files: { "notes.md": "# Notes\n\n- learn git\n" } },
    { msg: "Add todo", by: "dev", at: "2026-11-05 11:00", files: { "todo.txt": "buy coffee\n" } }
  ];

  var DRILLS = {
    "gt-101": [
      {
        id: "d1", title: "One repo, another email",
        text: "<p><code>~/side-project</code> is a repository for a hobby project. Make commits <b>in that repository only</b> use the email <code>dev@personal.example</code>, without changing your global email.</p>",
        system: simple("side-project", NOTES), starter: "",
        solution: lines("cd ~/side-project", "git config user.email dev@personal.example", "git config user.email", "git config --global user.email"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "~/side-project should stay a repository.";
          var local = G.parseConfig(r.read("~/side-project/.git/config") || "").filter(function (e) { return e.key === "user.email"; })[0];
          if (!local || local.value !== "dev@personal.example") return "Set user.email inside ~/side-project without --global (that writes .git/config).";
          return /dev@kestrel\.io/.test(r.read("~/.gitconfig") || "") ? true : "Your global email changed. It should still be dev@kestrel.io.";
        }
      },
      {
        id: "d2", title: "Look inside .git",
        text: "<p>In <code>~/side-project</code>, list what's inside the <code>.git</code> folder, then print the file that says which branch you're on.</p>",
        system: simple("side-project", NOTES), starter: "",
        solution: lines("cd ~/side-project", "ls .git", "cat .git/HEAD"),
        check: function (r) {
          if (!ran(r, /^\s*ls\b.*\.git/, function (e) { return /HEAD/.test(out(e)) && /objects/.test(out(e)); })) return "List the .git folder with ls.";
          return ran(r, /^\s*cat\b.*\.git\/HEAD/, function (e) { return /ref: refs\/heads\/main/.test(out(e)); }) ? true : "Print .git/HEAD: it holds the name of the current branch.";
        }
      },
      {
        id: "d3", title: "A repo in a new folder",
        text: "<p>Create a new repository in a new folder <code>~/scratch</code> in one command, with its first branch named <code>trunk</code> (just for this repository).</p>",
        starter: "", solution: lines("git init -b trunk scratch", "cd scratch", "git status"),
        check: function (r) {
          var v = repo(r, "scratch"); if (!v) return "Create ~/scratch as a repository: git init can take a folder name.";
          return v.head().branch === "trunk" ? true : "Its branch should be trunk: git init has an option for the initial branch name (-b).";
        }
      }
    ],
    "gt-102": [
      {
        id: "d1", title: "Everything at once",
        text: "<p><code>~/site</code> is a new repository with three files. Stage all of them in one command and commit with the message <code>Add site</code>.</p>",
        system: function (sys) { G.initRepo(sys, HOME + "/site", 1000, 1000, "main"); put(sys, "site/index.html", "<h1>Hi</h1>\n"); put(sys, "site/style.css", "h1 { color: teal; }\n"); put(sys, "site/app.js", "console.log('hi');\n"); },
        starter: "", solution: lines("cd ~/site", "git add .", 'git commit -m "Add site"', "git log --stat"),
        check: function (r) {
          var v = repo(r, "site"); if (!v) return "Work in ~/site.";
          var f = Object.keys(v.files("HEAD")).sort().join(",");
          if (f !== "app.js,index.html,style.css") return "The commit should contain all three files (git add .).";
          return v.commit("HEAD").subject === "Add site" ? true : "Use the message: Add site";
        }
      },
      {
        id: "d2", title: "Skip the staging step",
        text: "<p>In <code>~/side-project</code>, change <code>todo.txt</code> (add a line, any line) and commit it <b>without</b> running <code>git add</code>.</p>",
        system: simple("side-project", NOTES), starter: "",
        solution: lines("cd ~/side-project", 'echo "water plants" >> todo.txt', 'git commit -am "Update todo"'),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (ran(r, /git\s+add\b/)) return "Do it without git add: git commit has an option that stages tracked files for you.";
          return v.log("HEAD").length === 3 && (v.file("HEAD", "todo.txt") || "").split("\n").length > 2 ? true : "Commit your change to todo.txt with git commit -a (-am \"message\").";
        }
      },
      {
        id: "d3", title: "Subject and body",
        text: "<p>In <code>~/side-project</code>, add a file <code>ideas.md</code> and commit it with a two-part message: the subject <code>Add ideas list</code> and a body paragraph explaining why (any text).</p>",
        system: simple("side-project", NOTES), starter: "",
        solution: lines("cd ~/side-project", 'echo "- a git game" > ideas.md', "git add ideas.md", 'git commit -m "Add ideas list" -m "Somewhere to park ideas so they stop cluttering todo.txt."', "git log -1"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          var c = v.commit("HEAD");
          if (!v.files("HEAD")["ideas.md"]) return "Commit ideas.md.";
          if (c.subject !== "Add ideas list") return "The subject (first line) should be: Add ideas list";
          return /\n\n\S/.test(c.message) ? true : "Add a body: a second -m gives a separate paragraph.";
        }
      }
    ],
    "gt-103": [
      {
        id: "d1", title: "A file's whole story",
        text: "<p>In <code>~/kestrel-web</code>, show every change ever made to <code>deploy.sh</code>, with the diffs.</p>",
        system: function (sys) { G.build(sys, B.WEB, { steps: B.webSteps(0) }); }, starter: "",
        solution: lines("cd ~/kestrel-web", "git log -p -- deploy.sh"),
        check: function (r) { return ran(r, /git\s+log\b/, function (e) { var t = out(e); return /Add deploy script/.test(t) && /keep 5 releases/.test(t) && /^\+REL=/m.test(t) && !/Enable gzip/.test(t); }) ? true : "git log -p limited to deploy.sh (put the path after --) shows both commits that changed it, with their diffs."; }
      },
      {
        id: "d2", title: "Your own format",
        text: "<p>In <code>~/kestrel-web</code>, print one line per commit in the form <code>SHORT-ID AUTHOR: SUBJECT</code>, e.g. <code>3f9c2ab Ben Okoro: Add landing page</code>.</p>",
        system: function (sys) { G.build(sys, B.WEB, { steps: B.webSteps(0) }); }, starter: "",
        solution: lines("cd ~/kestrel-web", 'git log --format="%h %an: %s"'),
        check: function (r) {
          var v = repo(r, "kestrel-web"); if (!v) return "Work in ~/kestrel-web.";
          var want = v.log("HEAD").map(function (c) { return c.sha.slice(0, 7) + " " + c.author.name + ": " + c.subject; });
          return ran(r, /git\s+log\b/, function (e) { return JSON.stringify(e.out) === JSON.stringify(want); }) ? true : "Use --format with placeholders: %h (short ID), %an (author name), %s (subject).";
        }
      },
      {
        id: "d3", title: "A file in the past",
        text: "<p>Print <code>nginx/kestrel.conf</code> exactly as it was in the commit <b>before</b> the latest one that changed it (the one before <i>Raise proxy timeout</i>).</p>",
        system: function (sys) { G.build(sys, B.WEB, { steps: B.webSteps(0) }); }, starter: "",
        solution: lines("cd ~/kestrel-web", "git log --oneline -- nginx/kestrel.conf", "git show HEAD~4:nginx/kestrel.conf"),
        check: function (r) {
          var want = B.NGX("30s", true, true).replace(/\n$/, "").split("\n");
          return ran(r, /git\s+show\b.*:/, function (e) { return JSON.stringify(e.out) === JSON.stringify(want); }) ? true : "git show COMMIT:PATH prints a file at a commit. The version you want still has proxy_read_timeout 30s and gzip on.";
        }
      }
    ],
    "gt-104": [
      {
        id: "d1", title: "Ignore build output",
        text: "<p>In <code>~/app</code>, make Git ignore the <code>dist/</code> folder and every <code>*.tmp</code> file, then commit the <code>.gitignore</code>.</p>",
        system: function (sys) { G.build(sys, HOME + "/app", { steps: [{ msg: "Initial", by: "dev", files: { "src/main.js": "console.log(1)\n" } }] }); put(sys, "app/dist/bundle.js", "x\n"); put(sys, "app/src/cache.tmp", "x\n"); put(sys, "app/notes.tmp", "x\n"); },
        starter: "", solution: lines("cd ~/app", "printf 'dist/\\n*.tmp\\n' > .gitignore", "git status", "git add .gitignore", 'git commit -m "Ignore build output"'),
        check: function (r) {
          var v = repo(r, "app"); if (!v) return "Work in ~/app.";
          if (!v.ignored("dist/bundle.js") || !v.ignored("src/cache.tmp") || !v.ignored("notes.tmp")) return "dist/ and all *.tmp files should be ignored.";
          if (v.ignored("src/main.js")) return "Don't ignore src/main.js.";
          return v.files("HEAD")[".gitignore"] ? true : "Commit the .gitignore.";
        }
      },
      {
        id: "d2", title: "Already tracked",
        text: "<p><code>~/app</code> tracks <code>debug.log</code> by mistake. Stop tracking it (keep the file), ignore <code>*.log</code>, and commit.</p>",
        system: function (sys) { G.build(sys, HOME + "/app", { steps: [{ msg: "Initial", by: "dev", files: { "src/main.js": "console.log(1)\n", "debug.log": "debug output\n" } }] }); },
        starter: "", solution: lines("cd ~/app", "git rm --cached debug.log", 'echo "*.log" > .gitignore', "git add .gitignore", 'git commit -m "Stop tracking debug.log"'),
        check: function (r) {
          var v = repo(r, "app"); if (!v) return "Work in ~/app.";
          if (v.files("HEAD")["debug.log"]) return "debug.log is still in the latest commit: git rm --cached, then commit.";
          if (!r.exists("~/app/debug.log")) return "Keep debug.log on disk (--cached).";
          return v.ignored("debug.log") ? true : "Ignore *.log.";
        }
      },
      {
        id: "d3", title: "Which rule?",
        text: "<p><code>~/app</code> has two <code>.gitignore</code> files. Find out which file and line ignores <code>app/cache/data.bin</code>.</p>",
        system: function (sys) { G.build(sys, HOME + "/app", { steps: [{ msg: "Initial", by: "dev", files: { ".gitignore": "*.log\n.env\n", "app/.gitignore": "# generated\ncache/\n", "app/main.py": "print(1)\n" } }] }); put(sys, "app/app/cache/data.bin", "x\n"); },
        starter: "", solution: lines("cd ~/app", "git check-ignore -v app/cache/data.bin"),
        check: function (r) { return ran(r, /git\s+check-ignore\b/, function (e) { return /app\/\.gitignore:2:cache\//.test(out(e)); }) ? true : "git check-ignore -v PATH shows the file, line number and pattern."; }
      }
    ],
    "gt-105": [
      {
        id: "d1", title: "Squash two commits",
        text: "<p>Your last two commits in <code>~/side-project</code> are <i>wip 1</i> and <i>wip 2</i>. Turn them into a single commit called <code>Add reading list</code> (same files, one commit).</p>",
        system: simple("side-project", NOTES.concat([{ msg: "wip 1", by: "dev", files: { "reading.md": "- Pro Git\n" } }, { msg: "wip 2", by: "dev", files: { "reading.md": "- Pro Git\n- The Phoenix Project\n" } }])), starter: "",
        solution: lines("cd ~/side-project", "git reset --soft HEAD~2", "git status", 'git commit -m "Add reading list"', "git log --oneline"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          var subj = v.log("HEAD").map(function (c) { return c.subject; });
          if (subj.some(function (s) { return /^wip/.test(s); })) return "The wip commits are still in the history.";
          if (subj[0] !== "Add reading list" || subj.length !== 3) return "There should be one new commit, Add reading list, on top of Add todo.";
          return /Phoenix/.test(v.file("HEAD", "reading.md") || "") ? true : "The commit should contain the final reading.md.";
        }
      },
      {
        id: "d2", title: "Throw away local commits",
        text: "<p>The last two commits in <code>~/side-project</code> were a bad experiment that nobody else has. Remove them completely: files and commits.</p>",
        system: simple("side-project", NOTES.concat([{ msg: "Experiment: rewrite notes", by: "dev", files: { "notes.md": "???\n" } }, { msg: "Experiment: more", by: "dev", files: { "junk.txt": "x\n" } }])), starter: "",
        solution: lines("cd ~/side-project", "git log --oneline", "git reset --hard HEAD~2", "git status"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (v.commit("HEAD").subject !== "Add todo") return "main should end at \"Add todo\" again.";
          if (r.exists("~/side-project/junk.txt") || /\?\?\?/.test(r.read("~/side-project/notes.md") || "")) return "The experiment's files are still there: use --hard.";
          return true;
        }
      },
      {
        id: "d3", title: "Bring a deleted file back",
        text: "<p>Someone ran <code>rm notes.md</code> in <code>~/side-project</code>. Get it back from the last commit.</p>",
        system: function (sys) { simple("side-project", NOTES)(sys); G.removePath(sys, HOME + "/side-project/notes.md"); }, starter: "",
        solution: lines("cd ~/side-project", "git status", "git restore notes.md"),
        check: function (r) { return /learn git/.test(r.read("~/side-project/notes.md") || "") ? true : "git status shows notes.md as deleted; git restore brings it back."; }
      }
    ],
    "gt-106": [
      {
        id: "d1", title: "Branch from the past",
        text: "<p>In <code>~/kestrel-web</code>, create a branch <code>try/old-css</code> starting at the commit <b>Make the header sticky</b> (without switching to it).</p>",
        system: function (sys) { G.build(sys, B.WEB, { steps: B.webSteps(0) }); }, starter: "",
        solution: lines("cd ~/kestrel-web", "git log --oneline --grep=sticky", "git branch try/old-css HEAD~8", "git branch -v"),
        check: function (r) {
          var v = repo(r, "kestrel-web"); if (!v) return "Work in ~/kestrel-web.";
          var t = v.commit("try/old-css");
          if (!t) return "Create the branch try/old-css (git branch NAME START).";
          if (t.subject !== "Make the header sticky") return "try/old-css points at \"" + t.subject + "\", not at Make the header sticky.";
          return v.branch() === "main" ? true : "Stay on main (git branch creates without switching).";
        }
      },
      {
        id: "d2", title: "Not fully merged",
        text: "<p><code>~/side-project</code> has a branch <code>idea</code> with one commit that was never merged. Git refuses <code>git branch -d idea</code>; delete it anyway.</p>",
        system: simple("side-project", NOTES.concat([{ branch: "idea", from: "main" }, { msg: "Half an idea", by: "dev", files: { "idea.txt": "?\n" } }, { checkout: "main" }])), starter: "",
        solution: lines("cd ~/side-project", "git branch -d idea", "git branch -D idea", "git branch"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (v.branches().indexOf("idea") >= 0) return "idea still exists. -d refuses unmerged work; -D forces it.";
          return ran(r, /git\s+branch\s+-d\s+idea/, function (e) { return e.exit !== 0; }) ? true : "First see Git refuse with -d (it protects unmerged work), then force it with -D.";
        }
      },
      {
        id: "d3", title: "Always a merge commit",
        text: "<p>In <code>~/side-project</code>, merge the branch <code>docs</code> into <code>main</code> with a merge commit, even though a fast-forward is possible.</p>",
        system: simple("side-project", NOTES.concat([{ branch: "docs", from: "main" }, { msg: "Add docs", by: "dev", files: { "docs.md": "# Docs\n" } }, { checkout: "main" }])), starter: "",
        solution: lines("cd ~/side-project", 'git merge --no-ff docs -m "Merge branch \'docs\'"', "git log --oneline --graph"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          var c = v.commit("main");
          return c && c.parents.length === 2 && c.parents[1] === v.sha("docs") ? true : "main should end with a merge commit whose second parent is docs (git merge --no-ff).";
        }
      }
    ],
    "gt-107": [
      {
        id: "d1", title: "Take theirs",
        text: "<p>In <code>~/side-project</code>, merging <code>update-todo</code> into <code>main</code> conflicts on <code>todo.txt</code>. The branch's version is the right one: resolve by taking it whole, and finish the merge.</p>",
        system: simple("side-project", NOTES.concat([{ branch: "update-todo", from: "main" }, { msg: "Rewrite todo", by: "ana", files: { "todo.txt": "buy oat milk\nbook dentist\n" } }, { checkout: "main" }, { msg: "Coffee", by: "dev", files: { "todo.txt": "buy decaf\n" } }])), starter: "",
        solution: lines("cd ~/side-project", "git merge update-todo", "git checkout --theirs todo.txt", "git add todo.txt", "git commit --no-edit"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (v.merging()) return "Finish the merge (git add, then git commit).";
          if (!v.isAncestor("update-todo", "main")) return "Merge update-todo into main.";
          return v.file("main", "todo.txt") === "buy oat milk\nbook dentist\n" ? true : "todo.txt should be exactly the update-todo version (git checkout --theirs todo.txt).";
        }
      },
      {
        id: "d2", title: "Find the markers",
        text: "<p>Start merging <code>update-todo</code> into <code>main</code> in <code>~/side-project</code>, then find every line in the repository that still has a conflict marker, with its line number. Abort the merge afterwards.</p>",
        system: simple("side-project", NOTES.concat([{ branch: "update-todo", from: "main" }, { msg: "Rewrite todo", by: "ana", files: { "todo.txt": "buy oat milk\n" } }, { checkout: "main" }, { msg: "Coffee", by: "dev", files: { "todo.txt": "buy decaf\n" } }])), starter: "",
        solution: lines("cd ~/side-project", "git merge update-todo", "grep -rn '^<<<<<<<\\|^>>>>>>>' --exclude-dir=.git .", "git merge --abort"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (!ran(r, /grep\b/, function (e) { return /todo\.txt:1:<<<<<<< HEAD/.test(out(e)); })) return "Search for the markers with grep -n (recursively, so it works in any repository).";
          return !v.merging() ? true : "Abort the merge at the end.";
        }
      },
      {
        id: "d3", title: "See the original too",
        text: "<p>Make Git show the <b>original</b> version between the conflict markers too (the <code>diff3</code> style), for every repository. Then merge <code>update-todo</code> in <code>~/side-project</code> and look at <code>todo.txt</code>.</p>",
        system: simple("side-project", NOTES.concat([{ branch: "update-todo", from: "main" }, { msg: "Rewrite todo", by: "ana", files: { "todo.txt": "buy oat milk\n" } }, { checkout: "main" }, { msg: "Coffee", by: "dev", files: { "todo.txt": "buy decaf\n" } }])), starter: "",
        solution: lines("git config --global merge.conflictStyle diff3", "cd ~/side-project", "git merge update-todo", "cat todo.txt"),
        check: function (r) {
          if (!/conflictstyle\s*=\s*diff3/i.test(r.read("~/.gitconfig") || "")) return "Set merge.conflictStyle to diff3 in your global config.";
          return ran(r, /^\s*(cat|less|head)\b.*todo\.txt/, function (e) { return /\|\|\|\|\|\|\| merged common ancestors/.test(out(e)) && /buy coffee/.test(out(e)); }) ? true : "Merge update-todo, then cat todo.txt: you should see a ||||||| section with the original line.";
        }
      }
    ],
    "gt-108": [
      {
        id: "d1", title: "The older stash",
        text: "<p><code>~/side-project</code> has two stashes. Bring back the <b>older</b> one only (it adds <code>plans.md</code>), leaving the newer one in the list.</p>",
        system: function (sys) {
          simple("side-project", NOTES)(sys);
          var R = HOME + "/side-project", s = window.ShEngine.newSession(sys); s.cwd = R;
          window.ShEngine.runLine(Object.assign(s, { histLines: [], term: [], userStack: [] }), 'echo "- plan A" > plans.md && git add plans.md && git stash -m "plans" && echo "x" >> todo.txt && git stash -m "todo tweak"');
        },
        starter: "", solution: lines("cd ~/side-project", "git stash list", "git stash show stash@{1}", "git stash pop stash@{1}", "git stash list"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          if (!r.exists("~/side-project/plans.md")) return "plans.md isn't back yet. The older stash is stash@{1}.";
          var left = v.stashes();
          return left.length === 1 && /todo tweak/.test(left[0].msg) ? true : "Only the \"todo tweak\" stash should be left (pop or apply+drop stash@{1}).";
        }
      },
      {
        id: "d2", title: "Fix a wrong tag",
        text: "<p>In <code>~/side-project</code>, the tag <code>v0.1</code> was put on the wrong commit (<i>Add notes</i>). Move it to the latest commit, as an annotated tag with the message <code>First version</code>.</p>",
        system: simple("side-project", NOTES.concat([{ tag: "v0.1", on: "main~1" }])), starter: "",
        solution: lines("cd ~/side-project", "git tag -d v0.1", 'git tag -a v0.1 -m "First version"', "git show v0.1 --stat"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          var t = v.tag("v0.1"); if (!t) return "v0.1 should exist (delete it, then create it again).";
          if (t.target !== v.sha("main")) return "v0.1 should point at the latest commit.";
          return t.annotated && /First version/.test(t.message) ? true : "Make it annotated with the message First version.";
        }
      },
      {
        id: "d3", title: "Name this build",
        text: "<p>In <code>~/kestrel-web</code> (tagged <code>v1.2.0</code> a while ago), print the version name <code>git describe</code> gives the current commit.</p>",
        system: function (sys) { var st = B.webSteps(0); G.build(sys, B.WEB, { steps: st.slice(0, 9).concat([{ tag: "v1.2.0", msg: "Kestrel web 1.2.0", by: "maya" }]).concat(st.slice(9)) }); },
        starter: "", solution: lines("cd ~/kestrel-web", "git describe"),
        check: function (r) { return ran(r, /git\s+describe/, function (e) { return /^v1\.2\.0-5-g[0-9a-f]{7}$/.test(out(e)); }) ? true : "Run git describe in ~/kestrel-web."; }
      }
    ],
    "gt-109": [
      {
        id: "d1", title: "Blame a range, with emails",
        text: "<p>In <code>~/kestrel-api</code>, show who last changed lines 1 to 4 of <code>app/upload.py</code>, with each author's <b>email</b> instead of their name.</p>",
        system: B.detectiveSys(0), starter: "", solution: lines("cd ~/kestrel-api", "git blame -L 1,4 -e app/upload.py"),
        check: function (r) { return ran(r, /git\s+blame\b/, function (e) { return e.out.length === 4 && /<[^>]+@kestrel\.io>/.test(e.out[0]) && /MAX_UPLOAD_MB/.test(out(e)); }) ? true : "git blame -L 1,4 with -e (show email)."; }
      },
      {
        id: "d2", title: "Search with a pattern",
        text: "<p>In <code>~/kestrel-api</code>, list the commits that added or removed any line matching <code>MAX_[A-Z_]+ = </code> (any constant assignment), one per line.</p>",
        system: B.detectiveSys(0), starter: "", solution: lines("cd ~/kestrel-api", 'git log -G "MAX_[A-Z_]+ = " --oneline'),
        check: function (r) {
          var v = repo(r, "kestrel-api"); if (!v) return "Work in ~/kestrel-api.";
          var want = v.log("HEAD").filter(function (c) { return /Add upload endpoint|Add auth module|Add upload check script|Refactor auth helpers|Upload: stream large files/.test(c.subject); });
          return ran(r, /git\s+log\b.*-G/, function (e) { return want.every(function (c) { return out(e).indexOf(c.sha.slice(0, 7)) >= 0; }) && e.out.length === want.length; }) ? true : "-G takes a regular expression (-S takes plain text).";
        }
      },
      {
        id: "d3", title: "Bisect by hand",
        text: "<p>In <code>~/kestrel-api</code>, find the first bad commit for the upload check <b>without</b> <code>bisect run</code>: test each commit yourself with <code>./tests/check_upload.sh</code> and answer <code>git bisect good</code> or <code>bad</code>. Then reset.</p>",
        system: B.detectiveSys(0), starter: "",
        solution: lines("cd ~/kestrel-api", "git bisect start", "git bisect bad", "git bisect good v1.0", "./tests/check_upload.sh", "git bisect good", "./tests/check_upload.sh", "git bisect bad", "./tests/check_upload.sh", "git bisect bad", "./tests/check_upload.sh", "git bisect bad", "git bisect reset"),
        check: function (r) {
          var v = repo(r, "kestrel-api"); if (!v) return "Work in ~/kestrel-api.";
          if (ran(r, /git\s+bisect\s+run/)) return "Do it by hand this time (no bisect run).";
          if (!ran(r, /git\s+bisect\s+(good|bad)/, function (e) { return /is the first bad commit/.test(out(e)) && /Upload: stream large files/.test(out(e)); })) return "Keep testing and answering good/bad until Git names the first bad commit.";
          return !v.bisecting() ? true : "Finish with git bisect reset.";
        }
      }
    ],
    "gt-110": [
      {
        id: "d1", title: "Committed on the wrong branch",
        text: "<p>You made one commit, <i>Add dark mode</i>, on <code>main</code> in <code>~/side-project</code>. Move it to a new branch <code>feature/dark</code>, and put <code>main</code> back where it was.</p>",
        system: simple("side-project", NOTES.concat([{ msg: "Add dark mode", by: "dev", files: { "dark.css": "body { background: #111; }\n" } }])), starter: "",
        solution: lines("cd ~/side-project", "git branch feature/dark", "git reset --hard HEAD~1", "git log --oneline --all --graph"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          var f = v.commit("feature/dark");
          if (!f || f.subject !== "Add dark mode") return "feature/dark should point at the Add dark mode commit.";
          return v.commit("main").subject === "Add todo" && !r.exists("~/side-project/dark.css") ? true : "main should end at Add todo again, with a clean working tree.";
        }
      },
      {
        id: "d2", title: "Undo a reset",
        text: "<p>Oops: someone ran <code>git reset --hard HEAD~2</code> in <code>~/side-project</code> and two good commits vanished from <code>main</code>. Find them in the reflog and bring <code>main</code> back to where it was.</p>",
        system: function (sys) {
          simple("side-project", NOTES.concat([{ msg: "Add reading list", by: "dev", files: { "reading.md": "- Pro Git\n" } }, { msg: "Add podcast list", by: "dev", files: { "podcasts.md": "- Git Minutes\n" } }]))(sys);
          var s = window.ShEngine.newSession(sys); s.cwd = HOME + "/side-project";
          window.ShEngine.runLine(Object.assign(s, { histLines: [], term: [], userStack: [] }), "git reset --hard HEAD~2");
        },
        starter: "", solution: lines("cd ~/side-project", "git reflog", "git reset --hard HEAD@{1}", "git log --oneline"),
        check: function (r) {
          var v = repo(r, "side-project"); if (!v) return "Work in ~/side-project.";
          return v.commit("main").subject === "Add podcast list" && r.exists("~/side-project/podcasts.md") ? true : "git reflog lists where HEAD was before the reset; git reset --hard to that entry.";
        }
      },
      {
        id: "d3", title: "Clean up untracked junk",
        text: "<p><code>~/app</code> has untracked junk: <code>tmp/</code> (a folder) and <code>out.txt</code>. Preview what <code>git clean</code> would delete, then delete both. Tracked files and ignored files stay.</p>",
        system: function (sys) { G.build(sys, HOME + "/app", { steps: [{ msg: "Initial", by: "dev", files: { "src/main.js": "console.log(1)\n", ".gitignore": ".env\n" } }] }); put(sys, "app/tmp/a.txt", "x\n"); put(sys, "app/out.txt", "x\n"); put(sys, "app/.env", "KEY=1\n"); },
        starter: "", solution: lines("cd ~/app", "git clean -n -d", "git clean -f -d", "git status"),
        check: function (r) {
          if (!ran(r, /git\s+clean\b.*(-n|--dry-run)/)) return "Preview first with git clean -n (add -d to include folders).";
          if (r.exists("~/app/tmp/a.txt") || r.exists("~/app/out.txt")) return "tmp/ and out.txt should be gone (git clean -f -d).";
          return r.exists("~/app/.env") && r.exists("~/app/src/main.js") ? true : "Ignored and tracked files should stay (don't use -x).";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
