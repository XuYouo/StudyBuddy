#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

# Project-only runtime; leave the system Node and other projects untouched.
node_version=$(cat .node-version)
architecture=$(uname -m)
if [[ "$architecture" == x86_64 ]]; then architecture=x64; fi
runtime="${STUDYBUDDY_NODE_HOME:-$HOME/.local/share/studybuddy/node-v${node_version}-darwin-${architecture}}"
if [[ -x "$runtime/bin/node" ]]; then export PATH="$runtime/bin:$PATH"; fi
if [[ "$(uname -s)" != Darwin ]]; then echo 'This installer requires macOS.' >&2; exit 1; fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || major === 22 && minor < 22) process.exit(1)'
if [[ ! -d node_modules ]]; then npm ci; fi
npm run desktop:build -- --dir
app_directory=mac
if [[ "$architecture" == arm64 ]]; then app_directory=mac-arm64; fi
app="release/desktop/$app_directory/StudyBuddy.app"
/usr/bin/codesign --verify --deep --strict "$app"
if [[ "${1:-}" == --build-only ]]; then exit 0; fi

destination="/Applications/StudyBuddy.app"
if /usr/bin/pgrep -f '^/Applications/StudyBuddy.app/Contents/MacOS/StudyBuddy' >/dev/null; then
  echo 'Quit StudyBuddy normally, then run ./dev.local.sh again. Your work has not been interrupted.' >&2
  exit 1
fi
if [[ -e "$destination" ]]; then
  backup="$HOME/Library/Application Support/StudyBuddy/Build Backups/StudyBuddy-$(date +%Y%m%d-%H%M%S).app"
  mkdir -p "$(dirname "$backup")"
  mv "$destination" "$backup"
  echo "Previous app saved to $backup"
fi
ditto "$app" "$destination"
/usr/bin/codesign --verify --deep --strict "$destination"
echo "Installed $destination"
open "$destination"
