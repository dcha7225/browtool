#!/usr/bin/env bash
set -e

# Usage check
if [ -z "$1" ]; then
  echo "Usage: $0 <url>"
  exit 1
fi

URL="$1"

echo "Starting Playwright Python codegen for: $URL"
python3 -m browtool.record --url "$URL"
