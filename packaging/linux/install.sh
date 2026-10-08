#!/usr/bin/env bash
# Installs Enki Browser for the current user, no root needed:
#   ~/.local/opt/enki-browser        the browser
#   ~/.local/bin/enki-browser        command
#   ~/.local/share/applications      menu entry; icons under ~/.local/share/icons
#
#   ./install.sh              install or upgrade (your profile is kept)
#   ./install.sh --apparmor   also install the AppArmor profile Ubuntu 23.10+ needs (asks for sudo)
set -euo pipefail
SRC="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$HOME/.local/opt/enki-browser"
BIN="$HOME/.local/bin"

if [[ "$SRC" != "$DEST" ]]; then
  pkill -f "^$DEST/chromium/chrome" 2>/dev/null && sleep 1 || true
  rm -rf "$DEST.new"
  mkdir -p "$(dirname "$DEST")"
  cp -a "$SRC" "$DEST.new"
  rm -rf "$DEST"
  mv "$DEST.new" "$DEST"
fi

mkdir -p "$BIN" "$PREFIX/applications"
ln -sf "$DEST/enki-browser" "$BIN/enki-browser"
sed "s#@EXEC@#$DEST/enki-browser#g" "$DEST/enki-browser.desktop" > "$PREFIX/applications/enki-browser.desktop"
for size in 16 24 32 48 64 128 256 512; do
  mkdir -p "$PREFIX/icons/hicolor/${size}x${size}/apps"
  cp "$DEST/icons/enki-browser-$size.png" "$PREFIX/icons/hicolor/${size}x${size}/apps/enki-browser.png"
done
mkdir -p "$PREFIX/icons/hicolor/scalable/apps"
cp "$DEST/icons/enki-browser.svg" "$PREFIX/icons/hicolor/scalable/apps/enki-browser.svg"
command -v update-desktop-database >/dev/null && update-desktop-database "$PREFIX/applications" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$PREFIX/icons/hicolor" 2>/dev/null || true

# Ubuntu 23.10+ blocks the user namespaces Chromium's sandbox needs unless an AppArmor profile
# allows them. Installing one needs root, so it is opt-in here (the .deb does it automatically).
needs_apparmor=0
if [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" == "1" ]]; then needs_apparmor=1; fi
if [[ "${1:-}" == "--apparmor" ]]; then
  sed "s#@CHROME@#$DEST/chromium/chrome#" "$DEST/apparmor-profile" | sudo tee /etc/apparmor.d/enki-browser-user >/dev/null
  sudo apparmor_parser -r /etc/apparmor.d/enki-browser-user
  needs_apparmor=0
  echo "AppArmor profile installed."
fi

echo "Enki Browser $(sed -n 's/.*"enkiBrowser": *"\([^"]*\)".*/\1/p' "$DEST/version.json") installed. Open it from your menu or run: enki-browser"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "(Add $BIN to your PATH to use the enki-browser command.)" ;; esac
if [[ "$needs_apparmor" == "1" ]]; then
  echo
  echo "This system restricts the sandbox Chromium needs (Ubuntu 23.10+). Run once:"
  echo "  $DEST/install.sh --apparmor"
  echo "or install the .deb package instead, which sets this up for you."
fi
