#!/bin/bash

echo "=== MONITORING CALIBRATION LOGS ==="
echo "Press Ctrl+C to stop"
echo ""
echo "Looking for:"
echo "  1. Batch calibration started"
echo "  2. Pre-flight fixes"
echo "  3. Step outputs scanning"
echo "  4. Scatter-gather error detection"
echo "  5. Parameter rename fixes"
echo ""
echo "-----------------------------------"
echo ""

# Monitor the dev server output and filter for calibration-related logs
tail -f -n 0 <(npm run dev 2>&1) | grep --line-buffered -E \
  "Starting batch calibration|"\
"Pre-flight|"\
"Scanning step outputs|"\
"outputStepIds|"\
"Detected scatter-gather|"\
"Auto-applied: parameter_rename|"\
"Batch calibration mode: included all|"\
"flatten field|"\
"iteration|"\
"Validation scan results|"\
"Issue classification"
