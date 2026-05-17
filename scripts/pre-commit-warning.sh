#!/usr/bin/env bash
# pre-commit hook: warn if personal info leaks into tracked files
# Install: ln -s ../../scripts/pre-commit-warning.sh .git/hooks/pre-commit
set -euo pipefail

# --- Personal info patterns (add yours here) ---
ACCOUNT_NAMES="lyra-explorer Lyra"
PERSONAL_URLS="github.com/lyra-explorer"
LOCAL_PATHS="/home/claw /Users/claw"

# --- Files to check (staged files only) ---
STAGED=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
if [ -z "$STAGED" ]; then
  exit 0
fi

WARNINGS=""

for file in $STAGED; do
  # Skip binary files
  if file "$file" | grep -q "text"; then
    :
  else
    continue
  fi

  # Check account names
  for name in $ACCOUNT_NAMES; do
    if grep -q "$name" "$file" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  ⚠ $file: account name '$name' found"
    fi
  done

  # Check personal URLs
  for url in $PERSONAL_URLS; do
    if grep -q "$url" "$file" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  ⚠ $file: personal URL '$url' found"
    fi
  done

  # Check local paths
  for path in $LOCAL_PATHS; do
    if grep -q "$path" "$file" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  ⚠ $file: local path '$path' found"
    fi
  done
done

if [ -n "$WARNINGS" ]; then
  echo ""
  echo "⚠️  PERSONAL INFO WARNING — the following staged files contain personal info:"
  echo -e "$WARNINGS"
  echo ""
  echo "  These will be visible in public repos. Consider anonymizing before push."
  echo "  (This is a warning only — commit will proceed.)"
  echo ""
fi

exit 0
