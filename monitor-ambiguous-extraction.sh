#!/bin/bash

# Monitor calibration logs for ambiguous number extraction fix
# Usage: ./monitor-ambiguous-extraction.sh

echo "🔍 Monitoring for Ambiguous Number Extraction Fix"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👉 Start a calibration in the UI and watch for:"
echo "   - Competing matches detected"
echo "   - Confidence reduced (< 0.5)"
echo "   - Uncertain fields marked"
echo "   - LLM fallback triggered"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Follow calibration log and filter for relevant patterns
tail -f /tmp/nextjs-calibration.log 2>/dev/null | grep --line-buffered -E '(uncertainFields|confidence|LLM fallback|SchemaFieldExtractor|amount|competing|ambiguous|finalConfidence)' --color=always

# If log doesn't exist, wait for it
if [ $? -ne 0 ]; then
  echo "⏳ Waiting for calibration logs..."
  echo "   Log file: /tmp/nextjs-calibration.log"
  sleep 2
  tail -f /tmp/nextjs-calibration.log 2>/dev/null | grep --line-buffered -E '(uncertainFields|confidence|LLM fallback|SchemaFieldExtractor|amount)' --color=always || \
  echo "❌ No log file found. Server may not be running."
fi
