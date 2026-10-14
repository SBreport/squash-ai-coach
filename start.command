#!/bin/sh
# macOS: double-click in Finder. Serves repo root on 8780 and opens the app in Chrome.
cd "$(dirname "$0")" || exit 1
PORT=8780
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use:"; lsof -iTCP:$PORT -sTCP:LISTEN
  open -a "Google Chrome" "http://localhost:$PORT/app/" 2>/dev/null || open "http://localhost:$PORT/app/"
  exit 0
fi
(sleep 1; open -a "Google Chrome" "http://localhost:$PORT/app/" 2>/dev/null || open "http://localhost:$PORT/app/") &
python3 -m http.server $PORT
