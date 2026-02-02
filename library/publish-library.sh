#!/bin/bash
# Regenerate library manifest + thumbnails, then commit and push
set -e

cd "$(dirname "$0")"

echo "Scanning library (manifest only)..."
python3 generate-manifest.py --no-thumbs

echo ""
echo "Generating thumbnails (both sizes)..."
python3 generate-thumbs.py all

echo ""
echo "Checking for changes..."
if git diff --quiet library-manifest.json thumbs/ thumbs-lg/ && git diff --cached --quiet library-manifest.json thumbs/ thumbs-lg/; then
    echo "No changes to publish."
    exit 0
fi

echo ""
git status --short library-manifest.json thumbs/ thumbs-lg/

# Use argument as message, or prompt if interactive, or use default
if [ -n "$1" ]; then
    msg="$1"
elif [ -t 0 ]; then
    echo ""
    read -p "Commit message (or Enter for default): " msg
    if [ -z "$msg" ]; then
        msg="Update library assets"
    fi
else
    msg="Update library assets"
fi

git add library-manifest.json thumbs/ thumbs-lg/
git commit -m "$msg"
git push

echo ""
echo "Library published!"
