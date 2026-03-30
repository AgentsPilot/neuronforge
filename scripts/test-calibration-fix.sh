#!/bin/bash

echo "=== TESTING SCATTER-GATHER ERROR DETECTION & FIX ==="
echo ""
echo "This will:"
echo "1. Trigger a fresh calibration"
echo "2. Watch for scatter-gather error detection"
echo "3. Verify the fix is applied"
echo ""
echo "Press Ctrl+C to stop at any time"
echo ""

# Check if file_url exists before calibration
echo "=== BEFORE CALIBRATION ==="
npx tsx scripts/check-fix-applied.ts

echo ""
echo "=== STARTING CALIBRATION ==="
echo "Open http://localhost:3000/v2/sandbox/43ffbc8a-406d-4a43-9f3f-4e7554160eda"
echo "Click 'Start Calibration' button"
echo ""
echo "Monitoring progress..."
sleep 2

npx tsx scripts/watch-calibration-progress.ts
