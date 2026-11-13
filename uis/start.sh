#!/bin/sh
set -eu

cd /app/uis/website
npm run dev -- --hostname 0.0.0.0 --port 3000 &
PID1=$!

cd /app/uis/backoffice
npm run dev -- --hostname 0.0.0.0 --port 3001 &
PID2=$!

trap 'kill $PID1 $PID2 2>/dev/null || true' EXIT
wait -n "$PID1" "$PID2"
