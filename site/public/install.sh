#!/bin/sh
# just-Code installer — https://code.justapps.it
# Usage: curl -fsSL https://code.justapps.it/install.sh | sh
set -e
PKG="@justapps/just-code"
URL="https://code.justapps.it/latest.tgz"
o="$(printf '\033[38;2;242;84;27m')"; d="$(printf '\033[2m')"; r="$(printf '\033[0m')"

printf '%s▌%s just-Code installer\n\n' "$o" "$r"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20+ is required but was not found."
  echo "Install it from https://nodejs.org (or: brew install node / your package manager), then run this again."
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node.js $(node -v) found, but just-Code needs Node.js 20 or newer."
  exit 1
fi

install() { printf '%s→ npm install -g %s%s\n' "$d" "$1" "$r"; npm install -g "$1"; }
if ! install "$PKG"; then
  echo "npm registry install failed, trying the latest GitHub release…"
  if ! install "$URL"; then
    echo
    echo "Global install failed. If it is a permissions error, either:"
    echo "  • run:  sudo npm install -g $PKG"
    echo "  • or set a user prefix:  npm config set prefix ~/.npm-global  (and add ~/.npm-global/bin to PATH)"
    exit 1
  fi
fi
printf '\n%s✔%s installed. Run %sjust-code%s (or %sjc%s) inside a project, then type /login.\n' "$o" "$r" "$o" "$r" "$o" "$r"
