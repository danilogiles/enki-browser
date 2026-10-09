#!/usr/bin/env bash
# Installs the .deb on a clean system and proves it works: apt resolves every dependency, the
# browser starts and renders a page through the installed command, and removal cleans up.
# Runs as root in a fresh container:  docker run --rm -v "$PWD/out:/out:ro" ubuntu:24.04 bash test/linux-deb.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
deb="$(ls /out/enki-browser_*_amd64.deb | head -n1)"
apt-get update -qq >/dev/null
apt-get install -y -qq "$deb" >/dev/null
echo "PASS apt installs $(basename "$deb") with every dependency resolved"

test -x /usr/bin/enki-browser && test -f /usr/share/applications/enki-browser.desktop \
  && test -f /usr/share/icons/hicolor/256x256/apps/enki-browser.png && grep -q userns /etc/apparmor.d/enki-browser \
  && echo "PASS command, menu entry, icon and AppArmor profile are installed"

missing="$(ldd /opt/enki-browser/chromium/chrome | grep 'not found' || true)"
[[ -z "$missing" ]] && echo "PASS no shared library is missing" || { echo "FAIL missing: $missing"; exit 1; }

# A library can be present yet be the wrong one (Ubuntu 24.04 once satisfied libasound2 with an
# ALSA stand-in lacking symbols), so actually run the browser. Root in a container: no sandbox.
out="$(HOME=/tmp timeout 90 enki-browser --headless=new --no-sandbox --disable-gpu --dump-dom 'data:text/html,<h1>enki-ok</h1>' 2>&1 || true)"
if grep -q '<h1>enki-ok</h1>' <<<"$out"; then echo "PASS the installed browser starts and renders a page"
else echo "FAIL the browser did not render:"; grep -m5 -E "error|Error|undefined symbol" <<<"$out" || head -5 <<<"$out"; exit 1; fi

# "Make default" in Chromium's settings runs xdg-settings with $CHROME_DESKTOP: the launcher names
# Enki's own menu entry, and xdg-settings accepts it as the default browser.
grep -q '^export CHROME_DESKTOP=enki-browser.desktop$' /opt/enki-browser/enki-browser \
  && echo "PASS the launcher tells Chromium its menu entry (CHROME_DESKTOP=enki-browser.desktop)" \
  || { echo "FAIL CHROME_DESKTOP is not exported by /opt/enki-browser/enki-browser"; exit 1; }
apt-get install -y -qq --no-install-recommends xdg-utils >/dev/null
mkdir -p /tmp/xdg-home
got="$(HOME=/tmp/xdg-home env -u BROWSER sh -c 'xdg-settings set default-web-browser enki-browser.desktop && xdg-settings get default-web-browser' 2>&1 || true)"
[[ "$got" == "enki-browser.desktop" ]] && echo "PASS xdg-settings makes enki-browser.desktop the default browser" \
  || { echo "FAIL xdg-settings answered: $got"; exit 1; }

apt-get remove -y -qq enki-browser >/dev/null
[[ ! -e /opt/enki-browser && ! -e /usr/bin/enki-browser ]] && echo "PASS apt removes it cleanly"
