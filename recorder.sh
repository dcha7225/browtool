#!/usr/bin/env bash
set -e

# Usage check
if [ -z "$1" ]; then
  echo "Usage: $0 <url>"
  exit 1
fi

URL="$1"
OUTPUT_FILE="temp.ts"

echo "Starting Playwright codegen for: $URL"
echo "Saving output to: $OUTPUT_FILE"

npx playwright codegen "$URL" -o "$OUTPUT_FILE"
