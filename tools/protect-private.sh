#!/bin/sh
# Keeps the owner's private AI files off GitHub. Safe to run any time, as often as you like.
#   sh tools/protect-private.sh            take them out of Git (your local copies stay), install the guards
#   sh tools/protect-private.sh --history  only LOOK: which old commits ever contained them (changes nothing)
# It never deletes a file from your phone and never rewrites Git history.
PRIVATE_RE='(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|PROJECT_GUIDE\.md|removed\.txt|OWNER_PREFERENCES\.private\.md)$'

git rev-parse --git-dir >/dev/null 2>&1 || { echo "Not inside a Git folder: nothing to protect."; exit 0; }
top=$(git rev-parse --show-toplevel) && cd "$top" || exit 1

if [ "$1" = "--history" ]; then
  echo "Commits that ever contained a private file (read only, nothing is changed):"
  found=0
  for c in $(git rev-list --all 2>/dev/null); do
    files=$(git ls-tree -r --name-only "$c" | grep -E "$PRIVATE_RE" | tr '\n' ' ')
    if [ -n "$files" ]; then found=$((found + 1)); echo "  $(git log -1 --format='%h %ad %s' --date=short "$c") -> $files"; fi
  done
  [ "$found" -eq 0 ] && echo "  none: these files were never committed." || echo "  $found commit(s). They stay in the old history until you decide to rewrite it (not done automatically)."
  exit 0
fi

# 1) make sure .gitignore lists them (it does in every ZIP, this is only a safety net)
touch .gitignore
for f in AGENTS.md CLAUDE.md GEMINI.md PROJECT_GUIDE.md removed.txt OWNER_PREFERENCES.private.md; do
  grep -qxF "$f" .gitignore || printf '%s\n' "$f" >> .gitignore
done

# 2) take every tracked copy (also nested ones) out of Git. "--cached" means the file on your phone is NOT touched.
n=0
for f in $(git ls-files | grep -E "$PRIVATE_RE"); do
  git rm --cached -f -q -- "$f" && n=$((n + 1))
done
[ "$n" -gt 0 ] && echo "Removed $n private file(s) from Git tracking (your local copies are untouched)."

# 3) guards inside .git/hooks: a future "git add -f" or an old habit can not put them back on GitHub
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
cat > "$hooks/pre-commit" <<'HOOK'
#!/bin/sh
# TurboFex: private AI files never go into a commit (installed by tools/protect-private.sh)
for f in $(git diff --cached --name-only --diff-filter=AM | grep -E '(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|PROJECT_GUIDE\.md|removed\.txt|OWNER_PREFERENCES\.private\.md)$'); do
  git rm --cached -f -q -- "$f"
  echo "TurboFex: left $f out of this commit (the file stays on your phone)."
done
exit 0
HOOK
cat > "$hooks/pre-push" <<'HOOK'
#!/bin/sh
# TurboFex: refuse to push a version that still contains a private AI file (installed by tools/protect-private.sh)
if git ls-tree -r --name-only HEAD | grep -qE '(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|PROJECT_GUIDE\.md|removed\.txt|OWNER_PREFERENCES\.private\.md)$'; then
  echo "TurboFex: STOP. A private AI file is in the version you are pushing. Run: sh tools/protect-private.sh  then commit again."
  exit 1
fi
exit 0
HOOK
chmod +x "$hooks/pre-commit" "$hooks/pre-push"
exit 0
