#!/bin/bash
# Quick manifest refresh (no thumbnail regeneration)
cd "$(dirname "$0")"
python3 generate-manifest.py --no-thumbs
echo "Manifest refreshed!"
