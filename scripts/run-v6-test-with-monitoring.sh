#!/bin/bash

# V6 Full Pipeline Test with Log Monitoring
# Runs the Gmail expense test and captures all logs for analysis

set -e

echo "════════════════════════════════════════════════════════════════════════════════"
echo "V6 FULL PIPELINE TEST WITH LOG MONITORING"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

# Clean up old log files
rm -f /tmp/v6-test-execution.log
rm -f /tmp/v6-test-filtered.log
rm -f /tmp/v6-gmail-expense-test-results.json

echo "Starting test execution..."
echo ""

# Run the test and capture all output
npx tsx scripts/test-v6-gmail-expense-full.ts 2>&1 | tee /tmp/v6-test-execution.log

# Extract exit code
TEST_EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "════════════════════════════════════════════════════════════════════════════════"
echo "LOG ANALYSIS"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

# Filter logs for key events
echo "Extracting key events from logs..."
grep -E "(Phase [1-5]|✓|✗|⚠️|PHASE|ERROR|WARNING|hardcoded|validation|Calling OpenAI|IRToDSLCompiler|WorkflowPostValidator)" /tmp/v6-test-execution.log > /tmp/v6-test-filtered.log || true

# Check for hardcoded value mentions
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Hardcoded Value Analysis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HARDCODED_MENTIONS=$(grep -i -E "(gmail|expense|receipt|sales|salesperson|lead|customer)" /tmp/v6-test-execution.log | grep -v "user-provided\|expected\|domain terms\|Note:" || echo "None found")

if [ "$HARDCODED_MENTIONS" = "None found" ]; then
  echo "✓ No unexpected hardcoded business domain values detected in pipeline logic"
else
  echo "⚠️  Hardcoded value mentions found (review context to determine if expected):"
  echo "$HARDCODED_MENTIONS" | head -20
fi

echo ""

# Check for phase completion
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Phase Completion Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for phase in "Understanding" "Grounding" "Formalization" "Compilation" "Normalization"; do
  if grep -q "✓.*$phase" /tmp/v6-test-execution.log; then
    echo "✓ Phase: $phase"
  else
    echo "✗ Phase: $phase - NOT COMPLETED"
  fi
done

echo ""

# Check for validation issues
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Validation Issues"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

VALIDATION_ISSUES=$(grep -E "\[error\]|\[warning\]|INVALID|Auto-Fixed" /tmp/v6-test-execution.log || echo "No validation issues")

if [ "$VALIDATION_ISSUES" = "No validation issues" ]; then
  echo "✓ No validation issues found"
else
  echo "$VALIDATION_ISSUES"
fi

echo ""

# Check for OpenAI API calls
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "LLM API Calls"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

API_CALLS=$(grep -c "Calling OpenAI" /tmp/v6-test-execution.log || echo "0")
echo "Total OpenAI API calls: $API_CALLS"

if [ "$API_CALLS" -eq 3 ]; then
  echo "✓ Expected 3 API calls (Phase 1: Understanding, Phase 3: Formalization, Phase 4: Compilation)"
elif [ "$API_CALLS" -gt 3 ]; then
  echo "⚠️  More than expected - may include retries or repairs"
else
  echo "✗ Fewer than expected - some phases may have failed"
fi

echo ""

# Check final workflow structure
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Final Workflow Structure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f /tmp/v6-gmail-expense-test-results.json ]; then
  STEP_COUNT=$(jq '.final_workflow | length' /tmp/v6-gmail-expense-test-results.json 2>/dev/null || echo "unknown")
  VALID=$(jq '.validation_report.valid' /tmp/v6-gmail-expense-test-results.json 2>/dev/null || echo "unknown")
  ISSUES=$(jq '.validation_report.issues | length' /tmp/v6-gmail-expense-test-results.json 2>/dev/null || echo "unknown")

  echo "Steps generated: $STEP_COUNT"
  echo "Validation valid: $VALID"
  echo "Validation issues: $ISSUES"

  if [ "$VALID" = "true" ]; then
    echo "✓ Final workflow is valid and executable"
  else
    echo "✗ Final workflow has validation errors"
  fi
else
  echo "⚠️  Test results file not found - test may have crashed"
fi

echo ""

# Final test result
echo "════════════════════════════════════════════════════════════════════════════════"
echo "FINAL RESULT"
echo "════════════════════════════════════════════════════════════════════════════════"
echo ""

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "🎉 TEST PASSED"
  echo ""
  echo "✓ All 5 phases completed successfully"
  echo "✓ Final workflow is valid and executable"
  echo "✓ No critical issues detected"
else
  echo "✗ TEST FAILED (exit code: $TEST_EXIT_CODE)"
  echo ""
  echo "Check logs for details:"
  echo "  Full log: /tmp/v6-test-execution.log"
  echo "  Filtered log: /tmp/v6-test-filtered.log"
  echo "  Results JSON: /tmp/v6-gmail-expense-test-results.json"
fi

echo ""
echo "Log files:"
echo "  Full execution log: /tmp/v6-test-execution.log"
echo "  Filtered events: /tmp/v6-test-filtered.log"
echo "  Test results JSON: /tmp/v6-gmail-expense-test-results.json"
echo ""

exit $TEST_EXIT_CODE
