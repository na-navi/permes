#!/bin/bash
# Deploy hermes.ts to pi extension directory
# Usage: ./deploy-hermes.sh

SOURCE="D:/data/Pi-Coding-Fun/presentarchLinux/pi-hermes/hermes.ts"
DEST="$HOME/.pi/agent/extensions/hermes.ts"

echo "Deploying hermes.ts..."
cp "$SOURCE" "$DEST"
echo "Deployed to $DEST"
echo "Run /reload in pi to apply changes."