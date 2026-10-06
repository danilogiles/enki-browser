#!/usr/bin/env bash
# Removes a user install of Enki Browser. Your profile (~/.config/enki-browser) is kept unless
# you pass --purge.
set -euo pipefail
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$HOME/.local/opt/enki-browser"
pkill -f "^$DEST/chromium/chrome" 2>/dev/null && sleep 1 || true
rm -f "$HOME/.local/bin/enki-browser" "$PREFIX/applications/enki-browser.desktop"
for size in 16 24 32 48 64 128 256 512; do rm -f "$PREFIX/icons/hicolor/${size}x${size}/apps/enki-browser.png"; done
rm -f "$PREFIX/icons/hicolor/scalable/apps/enki-browser.svg"
if [[ -f /etc/apparmor.d/enki-browser-user ]]; then
  echo "Removing the AppArmor profile (needs sudo)."
  sudo apparmor_parser -R /etc/apparmor.d/enki-browser-user 2>/dev/null || true
  sudo rm -f /etc/apparmor.d/enki-browser-user
fi
rm -rf "$DEST"
if [[ "${1:-}" == "--purge" ]]; then rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/enki-browser"; echo "Enki Browser and its profile removed."
else echo "Enki Browser removed. Your profile is kept in ${XDG_CONFIG_HOME:-$HOME/.config}/enki-browser (use --purge to delete it)."; fi
