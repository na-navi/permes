#!/usr/bin/env bash
set -euo pipefail

# Deploy hermes.ts to pi extension directory (Linux only)
# Usage: ./deploy-hermes.linux.sh

if [ "$(uname -s)" != "Linux" ]; then
  echo "This deploy script is Linux-only. Use manual install on this OS."
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE="$REPO_ROOT/permes.ts"
DEST="$HOME/.pi/agent/extensions/permes.ts"

mkdir -p "$(dirname "$DEST")"
cp "$SOURCE" "$DEST"
echo "Deployed to $DEST"
echo "Run /reload in pi to apply changes."
