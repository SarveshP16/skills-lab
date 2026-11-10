#!/usr/bin/env bash
# Assemble the single-file game from src/
set -e
cd "$(dirname "$0")"
{ cat src/shell.html; echo '<script>'; cat src/engine.js src/tools.js src/labs.js src/app.js; echo '</script>'; } > night-shift.html
echo "built night-shift.html ($(wc -c < night-shift.html) bytes)"
