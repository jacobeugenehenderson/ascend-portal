#!/bin/bash
# Watch the library folders and regenerate manifest when files change
# Waits 5 seconds after last change before regenerating (debounce)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIBRARY_PATH="/Volumes/Today/Nordson/LIBRARY"
PUBLICATIONS_PATH="/Volumes/Today/Nordson/PUBLICATIONS"
DEBOUNCE=5

echo "Watching for changes in:"
echo "  - $LIBRARY_PATH"
echo "  - $PUBLICATIONS_PATH"
echo ""
echo "Will regenerate ${DEBOUNCE}s after last change."
echo "Press Ctrl+C to stop"
echo ""

LAST_RUN=0

fswatch -o --latency $DEBOUNCE "$LIBRARY_PATH" "$PUBLICATIONS_PATH" | while read count; do
  NOW=$(date +%s)
  echo "[$(date '+%H:%M:%S')] $count change(s) detected, regenerating manifest..."
  python3 "$SCRIPT_DIR/generate-manifest.py" --no-thumbs
  echo "[$(date '+%H:%M:%S')] Done - refresh browser to see changes"
  echo ""
done
