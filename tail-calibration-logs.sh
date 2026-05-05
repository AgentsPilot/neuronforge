#!/bin/bash

# Tail recent calibration logs from the dev server
# Since Pino outputs JSON, we need to parse it

echo "🔍 Searching for recent calibration logs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# The dev server typically writes to stdout, so check the running process
# PID of next dev
PID=$(ps aux | grep "next dev" | grep -v grep | awk '{print $2}')

if [ -z "$PID" ]; then
  echo "❌ Next.js dev server not running"
  exit 1
fi

echo "✅ Found Next.js dev server (PID: $PID)"
echo ""
echo "Calibration-related logs from server console:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if there's a log file
if [ -f ".next/trace" ]; then
  echo "Checking .next/trace for calibration activity..."
  tail -1000 .next/trace | grep -i "calibrat" | tail -20
fi

echo ""
echo "💡 To see live logs, the dev server console should show:"
echo "   - [Layer 2 Enhanced] messages"
echo "   - [MultiStepDetector] messages" 
echo "   - Calibration loop iterations"
echo ""
echo "📝 If you don't see logs, you may need to:"
echo "   1. Check the terminal where 'npm run dev' is running"
echo "   2. Run a calibration in the UI"
echo "   3. The logs appear in real-time in that terminal"
