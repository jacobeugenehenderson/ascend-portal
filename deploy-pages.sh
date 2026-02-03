#!/bin/bash
# Deploy to Cloudflare Pages
# Temporarily moves local symlinks outside repo so they aren't deployed

set -e

REPO_DIR="/Volumes/Today/ascend-portal"
ASSETS_DIR="$REPO_DIR/library/assets"
TEMP_DIR="/tmp/ascend-assets-backup"

cleanup() {
    echo "==> Restoring local asset symlinks..."
    if [ -d "$TEMP_DIR" ]; then
        mv "$TEMP_DIR" "$ASSETS_DIR"
        echo "    Restored."
    fi
}

# Always restore on exit (success or failure)
trap cleanup EXIT

echo "==> Temporarily moving local asset symlinks out of repo..."
if [ -d "$ASSETS_DIR" ]; then
    mv "$ASSETS_DIR" "$TEMP_DIR"
fi

echo "==> Deploying to Cloudflare Pages..."
wrangler pages deploy "$REPO_DIR" \
    --project-name ascend-portal \
    --branch main \
    --commit-dirty=true

echo "==> Done!"
