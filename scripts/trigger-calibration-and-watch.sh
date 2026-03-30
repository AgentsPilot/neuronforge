#!/bin/bash

# Get the agent ID
AGENT_ID="43ffbc8a-406d-4a43-9f3f-4e7554160eda"

echo "=== TRIGGERING BATCH CALIBRATION ==="
echo "Agent ID: $AGENT_ID"
echo ""

# Trigger calibration via API (assumes dev server is running on localhost:3000)
curl -X POST "http://localhost:3000/api/v2/calibrate/batch" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$AGENT_ID\"}" \
  2>&1 | head -100 &

CURL_PID=$!

echo "Calibration API request sent (PID: $CURL_PID)"
echo ""
echo "Waiting 3 seconds for calibration to start..."
sleep 3

echo ""
echo "=== WATCHING CALIBRATION PROGRESS ==="
npx tsx scripts/watch-calibration-progress.ts
