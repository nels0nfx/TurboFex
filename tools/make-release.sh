#!/bin/sh
# Builds the public hosting ZIP from the committed files and CHECKS it before anything is published.
#   sh tools/make-release.sh [output.zip]      (default: ~/TurboFex-hosting.zip)
# If the ZIP holds a private file or lacks a file the bot needs, it is deleted and this script fails, so the
# "gh release create" step after it never runs.
out="${1:-$HOME/TurboFex-hosting.zip}"
rm -f "$out"
git archive --format=zip -o "$out" HEAD || exit 1
list=$(unzip -Z1 "$out") || { rm -f "$out"; exit 1; }

bad=$(printf '%s\n' "$list" | grep -E '(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|PROJECT_GUIDE\.md|removed\.txt|OWNER_PREFERENCES\.private\.md|session_id\.txt|config\.env|\.env)$|^(\.github|node_modules|session|data)/')
if [ -n "$bad" ]; then
  rm -f "$out"
  echo "STOP: the release ZIP would contain private files:"; printf '%s\n' "$bad"
  echo "Run: sh tools/protect-private.sh   then commit again."
  exit 1
fi
for f in index.js package.json update.json removed-files.txt core/boot.js core/updater.js whatsapp/connection.js; do
  printf '%s\n' "$list" | grep -qx "$f" || { rm -f "$out"; echo "STOP: $f is missing from the release ZIP."; exit 1; }
done
echo "Release ZIP ready and checked: $out ($(printf '%s\n' "$list" | wc -l) files, no private files)."
