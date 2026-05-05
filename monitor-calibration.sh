#!/bin/bash

# Monitor calibration logs for Multi-Step Structural Detection
# Usage: ./monitor-calibration.sh

echo "🔍 Monitoring calibration logs for Multi-Step Structural Detection..."
echo "👉 Start a calibration in the UI and watch for logs below"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Follow the background task output and filter for relevant logs
tail -f /tmp/claude/-Users-yaelomer-Documents-neuronforge/tasks/bb19aa6.output 2>/dev/null | grep --line-buffered -E '(Layer 2 Enhanced|MultiStepDetector|multi-step|structural|missing_intermediate_flatten|insert_step|step2a|step4|DependencyPropagation|Comparing schemas|Action Mismatch|ActionMismatchDetector|wrong action|action replacement)' --color=always

# If background task output doesn't exist, fall back to checking for Next.js logs
if [ $? -ne 0 ]; then
  echo "Waiting for calibration logs..."
  tail -f .next/trace 2>/dev/null | grep --line-buffered -E '(Layer 2 Enhanced|MultiStepDetector|multi-step|structural)' --color=always || \
  echo "No log file found. Make sure the server is running."
fi
