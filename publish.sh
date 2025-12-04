#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

git add -A
git commit -m "Ascend manual update $(date +'%Y-%m-%d %H:%M:%S')" || true
git push origin main --force

echo "✅ Ascend portal updated and live at https://jacobeugenehenderson.github.io/ascend-portal/"