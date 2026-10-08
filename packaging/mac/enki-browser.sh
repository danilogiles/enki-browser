#!/bin/bash
# Enki Browser for macOS: starts the bundled Chromium with Enki Browser's own profile, the built-in
# extensions and the privacy switches (the Windows counterpart is launcher/Launcher.cs, the Linux
# one packaging/linux/enki-browser). The app's main executable (launcher.c) runs it from
# Contents/Resources/enki/.
#
# It execs Chromium, so the browser keeps the app's process: macOS sees one app, the Dock shows
# Enki's icon, and links opened from other apps reach the running browser. Written for the bash 3.2
# that macOS ships (no readlink -f, no mapfile, the "+" idiom for empty arrays under set -u).
set -euo pipefail
CONTENTS="$(cd "$(dirname "$0")/../.." && pwd)"
ENKI="$CONTENTS/Resources/enki"
SUPPORT="$HOME/Library/Application Support"
DATA="${ENKI_BROWSER_USER_DATA:-$SUPPORT/Enki Browser}"
mkdir -p "$DATA"

# First-run defaults (Enki as the search engine, Enki and Shields pinned, third-party cookies
# blocked…). Chromium for macOS reads them from one fixed place only, its own folder —
# ~/Library/Application Support/Chromium/Chromium Initial Preferences — whatever --user-data-dir
# says, and only when a profile is created. So for a new profile the file is put there, left while
# Chromium starts and reads it, and then removed. A file already there belongs to someone else (an
# administrator, or a Chromium the user has): it is never replaced or removed.
if [[ ! -e "$DATA/Local State" ]]; then
  CHROMIUM_DIR="$SUPPORT/Chromium"
  INITIAL="$CHROMIUM_DIR/Chromium Initial Preferences"
  if [[ ! -e "$INITIAL" ]]; then
    MADE_DIR=0
    [[ -d "$CHROMIUM_DIR" ]] || { mkdir -p "$CHROMIUM_DIR"; MADE_DIR=1; }
    cp "$ENKI/initial_preferences" "$INITIAL"
    (
      sleep 60
      cmp -s "$ENKI/initial_preferences" "$INITIAL" && rm -f "$INITIAL"
      [[ "$MADE_DIR" == 1 ]] && rmdir "$CHROMIUM_DIR" 2>/dev/null
    ) </dev/null >/dev/null 2>&1 &
    disown || true
  fi
fi

# Chromium writes generated files (the blocker's indexed rule sets) into an unpacked extension's
# folder, and the app bundle must stay as signed. So the extensions are copied once per build into
# the profile folder and loaded from there.
EXT_DIR="$DATA/Built-in Extensions"
STAMP="$(grep -o '"builtAt": *"[^"]*"' "$ENKI/version.json" || true)"
if [[ "$(cat "$EXT_DIR/.enki-build" 2>/dev/null || true)" != "$STAMP" ]]; then
  rm -rf "$EXT_DIR"
  mkdir -p "$EXT_DIR"
  cp -R "$ENKI/extensions/." "$EXT_DIR/"
  printf '%s' "$STAMP" > "$EXT_DIR/.enki-build"
fi
EXTENSIONS=""
for dir in "$EXT_DIR"/*/; do EXTENSIONS="${EXTENSIONS:+$EXTENSIONS,}${dir%/}"; done

FLAGS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "${line//[[:space:]]/}" || "$line" == \#* ]] && continue
  FLAGS+=("$line")
done < "$ENKI/config/flags.txt"

# "Continue where you left off", as people expect a browser to reopen, unless the profile has a
# choice of its own in Settings → On startup (see RestoreByDefault in launcher/Launcher.cs: the
# setting is MAC-protected, so it is passed as a switch rather than written into the profile).
RESTORE=()
if [[ -f "$DATA/Local State" ]]; then
  PROFILE="$(grep -o '"last_active_profiles":\["[^"]*"' "$DATA/Local State" | sed 's/.*\["//; s/"$//' || true)"
  [[ -n "$PROFILE" ]] || PROFILE="$(grep -o '"last_used":"[^"]*"' "$DATA/Local State" | sed 's/.*:"//; s/"$//' || true)"
  [[ -n "$PROFILE" && "$PROFILE" != */* ]] || PROFILE=Default
  for a in "$@"; do
    case "$a" in
      --profile-directory=*) PROFILE="${a#--profile-directory=}" ;;
      --restore-last-session|--incognito|--app*) PROFILE="" ; break ;;
    esac
  done
  # A choice is a number; the same name also appears with a string value, as a MAC under
  # protection.macs, in every profile, so the name alone is not a choice.
  if [[ -n "$PROFILE" ]] && ! grep -qsE '"restore_on_startup": ?[0-9]' "$DATA/$PROFILE/Preferences" "$DATA/$PROFILE/Secure Preferences"; then
    RESTORE=(--restore-last-session)
  fi
fi

exec "$CONTENTS/MacOS/Chromium" \
  --user-data-dir="$DATA" \
  --load-extension="$EXTENSIONS" \
  ${RESTORE[@]+"${RESTORE[@]}"} \
  ${FLAGS[@]+"${FLAGS[@]}"} \
  "$@"
