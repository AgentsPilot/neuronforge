#!/bin/bash
# Checkpoint D — run V6 pipeline across all 10 regression scenarios
#
# Validates WP-15 (nested NestedFieldSpec grammar + recursive builder walk).
# For each scenario, generates a fresh phase0-4 output under
# `output-cp-d/` (preserving CP-C and original `output/` for comparison).
#
# After this completes, sweep dev.log files for these signals:
#   - "[DataSchemaBuilder] Step ... field ... declared as ... without"
#     (WP-15 fallback firing — should be 0 if LLM adopts the new grammar)
#   - "validateSchemaDepth" or auto-repair signals from IRFormalizer.ts
#     (WORKPLAN.md task 7.3 retirement gate)
# Plus run W5 measurement on output-cp-d:
#   npx tsx --env-file=.env.local scripts/measure-redundant-ai-steps.ts \
#     --output-subdir output-cp-d
#
# Usage: bash scripts/run-cp-d-all-scenarios.sh

set -u

SCENARIOS=(
  "aliexpress-delivery-tracker"
  "complaint-email-logger"
  "contract-enddate-summary"
  "expense-invoice-email-scanner"
  "gantt-urgent-tasks"
  "gmail-urgency-flagging"
  "leads-email-summary"
  "leads-per-salesperson-email"
  "orders-po-extractor-xlsx"
  "po-monitor-supplier-confirmation"
)

SCENARIOS_ROOT="tests/v6-regression/scenarios"
LOG_DIR="/tmp/cp-d-logs"
mkdir -p "$LOG_DIR"

REPORT_FILE="/tmp/cp-d-report.txt"
> "$REPORT_FILE"

printf "Checkpoint D — running V6 pipeline for %d scenarios (WP-15 verification)\n" "${#SCENARIOS[@]}" | tee -a "$REPORT_FILE"
printf "Logs: %s\n\n" "$LOG_DIR" | tee -a "$REPORT_FILE"

START_TIME=$(date +%s)
SUCCESS_COUNT=0
FAIL_COUNT=0

for i in "${!SCENARIOS[@]}"; do
  SCENARIO="${SCENARIOS[$i]}"
  N=$((i + 1))
  PROMPT_FILE="$SCENARIOS_ROOT/$SCENARIO/enhanced-prompt.json"
  OUTPUT_DIR="$SCENARIOS_ROOT/$SCENARIO/output-cp-d"
  LOG_FILE="$LOG_DIR/$SCENARIO.log"

  if [ ! -f "$PROMPT_FILE" ]; then
    printf "[%2d/10] %s ❌ MISSING enhanced-prompt.json\n" "$N" "$SCENARIO" | tee -a "$REPORT_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  # Resume: skip scenarios that already have a complete phase4 output
  if [ -f "$OUTPUT_DIR/phase4-pilot-dsl-steps.json" ]; then
    printf "[%2d/10] %s ⏭  already done (skipping)\n" "$N" "$SCENARIO" | tee -a "$REPORT_FILE"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    continue
  fi

  mkdir -p "$OUTPUT_DIR"
  SCEN_START=$(date +%s)

  printf "[%2d/10] %s ... " "$N" "$SCENARIO"

  npx tsx --env-file=.env.local scripts/test-complete-pipeline-with-vocabulary.ts \
    "$PROMPT_FILE" \
    --output-dir "$OUTPUT_DIR" \
    > "$LOG_FILE" 2>&1

  EXIT_CODE=$?
  SCEN_END=$(date +%s)
  DURATION=$((SCEN_END - SCEN_START))

  if [ $EXIT_CODE -eq 0 ] && [ -f "$OUTPUT_DIR/phase4-pilot-dsl-steps.json" ]; then
    printf "✅ %ds\n" "$DURATION"
    printf "[%2d/10] %s ✅ %ds\n" "$N" "$SCENARIO" "$DURATION" >> "$REPORT_FILE"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    LAST_ERR=$(tail -3 "$LOG_FILE" | head -2 | tr '\n' ' ' | head -c 200)
    printf "❌ exit=%d (%ds) — %s\n" "$EXIT_CODE" "$DURATION" "$LAST_ERR"
    printf "[%2d/10] %s ❌ exit=%d (%ds) — %s\n" "$N" "$SCENARIO" "$EXIT_CODE" "$DURATION" "$LAST_ERR" >> "$REPORT_FILE"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

printf "\n=== CP-D SUMMARY ===\n" | tee -a "$REPORT_FILE"
printf "Success: %d / %d\n" "$SUCCESS_COUNT" "${#SCENARIOS[@]}" | tee -a "$REPORT_FILE"
printf "Failed:  %d / %d\n" "$FAIL_COUNT" "${#SCENARIOS[@]}" | tee -a "$REPORT_FILE"
printf "Total time: %d:%02d\n" "$((TOTAL_DURATION / 60))" "$((TOTAL_DURATION % 60))" | tee -a "$REPORT_FILE"
printf "\nFull report: %s\n" "$REPORT_FILE"
printf "Per-scenario logs: %s\n" "$LOG_DIR"
