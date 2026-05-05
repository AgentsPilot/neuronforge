#!/bin/bash
# Real-time calibration monitoring script
# Filters and highlights important calibration events

echo "🔍 Monitoring calibration logs in real-time..."
echo "📍 Log file: /tmp/nextjs-calibration.log"
echo "⏱️  Press Ctrl+C to stop"
echo ""
echo "======================================"
echo "LEGEND:"
echo "  🔄 Loop iteration"
echo "  ✅ Fixes applied"
echo "  ⚠️  Fixes skipped"
echo "  🚫 Issues detected"
echo "  🎯 Final validation"
echo "  ⛔ Loop exit"
echo "======================================"
echo ""

tail -f /tmp/nextjs-calibration.log | grep --line-buffered -E \
  "(Auto-calibration iteration|fixesThisRound|fixesSkipped|SKIPPED|Final validation|Found auto-fixable issues|calibration complete|exiting loop|CONVERGENCE FAILURE|transformationProposals|Injecting transformation)" | \
while IFS= read -r line; do
  # Color coding
  if echo "$line" | grep -q "iteration"; then
    echo "🔄 $line"
  elif echo "$line" | grep -q "fixesThisRound.*[1-9]"; then
    echo "✅ $line"
  elif echo "$line" | grep -q "fixesSkipped.*[1-9]"; then
    echo "⚠️  $line"
  elif echo "$line" | grep -q "SKIPPED"; then
    echo "⚠️  $line"
  elif echo "$line" | grep -q "Final validation"; then
    echo "🎯 $line"
  elif echo "$line" | grep -q "exiting loop\|complete"; then
    echo "⛔ $line"
  elif echo "$line" | grep -q "CONVERGENCE FAILURE"; then
    echo "🔴 $line"
  elif echo "$line" | grep -q "transformation"; then
    echo "🔧 $line"
  else
    echo "🚫 $line"
  fi
done
