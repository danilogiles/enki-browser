#!/usr/bin/env bash
# One-line install of the latest Enki Browser for Linux, for the current user:
#   curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash
# Downloads the newest release's tar.gz, checks it against its published SHA-256, and runs its
# install.sh. Nothing is installed if the checksum does not match.
set -euo pipefail
REPO="danilogiles/enki-browser"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# The newest release (pre-releases included) that has a Linux build; no jq needed.
url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=10" \
  | grep -o '"browser_download_url": *"[^"]*-linux-x64\.tar\.gz"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[[ -n "$url" ]] || { echo "No Linux release of Enki Browser found." >&2; exit 1; }

echo "Downloading $url"
curl -fL --progress-bar "$url" -o "$tmp/enki-browser.tar.gz"
curl -fsSL "$url.sha256" -o "$tmp/enki-browser.tar.gz.sha256"
expected="$(cut -d' ' -f1 "$tmp/enki-browser.tar.gz.sha256")"
actual="$(sha256sum "$tmp/enki-browser.tar.gz" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "Checksum mismatch: expected $expected, got $actual. Nothing installed." >&2; exit 1; }
echo "Checksum verified."

tar -xzf "$tmp/enki-browser.tar.gz" -C "$tmp"
"$tmp/enki-browser/install.sh" "$@"
