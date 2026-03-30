# Testing Checklist - Execution Fixes

**Date**: 2026-03-23
**Purpose**: Verify all execution fixes work correctly and calibration no longer applies redundant auto-fixes

---

## ✅ Pre-Test Verification

- [ ] All code changes committed
- [ ] Documentation files created:
  - [ ] EXECUTION-LAYER-FIXES-COMPLETE.md
  - [ ] CALIBRATION-VS-EXECUTION-ANALYSIS.md
  - [ ] CALIBRATION-FIXES-DISABLED.md
  - [ ] COMPLETE-IMPLEMENTATION-SUMMARY.md
- [ ] TypeScript compilation successful (no errors)
- [ ] Application starts without errors

---

## 🧪 Test 1: Calibration Skips Redundant Fixes

### Goal: Verify calibration no longer applies field path fixes

### Steps:
1. Run calibration on Invoice Extraction workflow
   ```bash
   # Trigger calibration via UI or API
   ```

2. Check calibration logs for SKIP messages:
   ```bash
   grep "SKIPPED.*fix_flatten_field" logs/
   grep "SKIPPED.*fix_operation_field" logs/
   grep "SKIPPED.*add_flatten_field" logs/
   grep "SKIPPED.*fix_field_name" logs/
   ```

### Expected Results:
- [ ] See log: "SKIPPED: fix_flatten_field (execution handles this)"
- [ ] See log: "SKIPPED: fix_operation_field (execution handles this)" for flatten/filter/map/transform
- [ ] See log: "SKIPPED: add_flatten_field (execution handles this)"
- [ ] See log: "SKIPPED: fix_field_name (execution handles this)"
- [ ] Calibration completes WITHOUT applying field path fixes
- [ ] Calibration issues count reduced (50+ → 5-10 issues)

### If Fails:
- Check `/app/api/v2/calibrate/batch/route.ts` skip logic (lines 378-450, 1189-1197, 1271-1302)
- Verify log statements are correct
- Check if fix types match

---

## 🧪 Test 2: Flatten Field Path Resolution

### Goal: Verify flatten operations work with correct field paths

### Steps:
1. Run workflow execution for step2 (flatten)
   ```bash
   # Execute Invoice Extraction workflow
   # Or run: npm run test-complete-pipeline-with-vocabulary
   ```

2. Check execution logs for step2:
   ```bash
   grep "step2\|flatten" logs/execution.log
   ```

### Expected Results:
- [ ] Step2 completes successfully
- [ ] Flatten extracts items > 0 (not 0 items)
- [ ] If dot-notation detected: See warning "Flatten field contains dots... Attempting to use last segment"
- [ ] Field used is "attachments" (not "emails.attachments")
- [ ] Next steps receive flattened array correctly

### If Fails:
- Check WorkflowValidator.extractArrayFields() has includePathPrefixes parameter
- Check StepExecutor.transformFlatten() has dot-notation detection
- Verify field path in workflow config

---

## 🧪 Test 3: Schema-Aware Variable Resolution

### Goal: Verify execution auto-extracts fields when type mismatches

### Steps:
1. Run workflow execution through step9 (share_file)
   ```bash
   # Execute Invoice Extraction workflow
   ```

2. Check execution logs for schema-aware extraction:
   ```bash
   grep "Schema-aware extraction\|Auto-extracted" logs/
   ```

### Expected Results:
- [ ] See log: "Schema-aware extraction: auto-extracted field from object"
- [ ] Step9 receives `file_id` as string (not entire object)
- [ ] Step9 completes successfully (no 404 error)
- [ ] Permission created with permission_id returned
- [ ] No "unwrapParameter" log messages (method removed)

### If Fails:
- Check ExecutionContext.resolveVariable() has expectedSchema parameter
- Check ExecutionContext.attemptSchemaAwareExtraction() logic
- Check StepExecutor.transformParametersForPlugin() calls resolveParametersWithSchema
- Verify plugin schema has parameter definitions

---

## 🧪 Test 4: AI Context Scoping

### Goal: Verify AI steps only receive specified params (not entire context)

### Steps:
1. Run workflow execution through step15 (AI email generation)
   ```bash
   # Execute Invoice Extraction workflow
   ```

2. Check execution logs for AI context:
   ```bash
   grep "LLM decision\|scopedParams" logs/
   ```

3. Check token usage:
   ```bash
   grep "tokensUsed\|token" logs/ | grep step15
   ```

### Expected Results:
- [ ] See log: "LLM decision with scoped params (only what step specified)"
- [ ] Step15 token usage < 10,000 tokens (not 65K+)
- [ ] Step15 completes successfully (no token limit error)
- [ ] Email generated with correct content
- [ ] No "enrichedParams" in logs (removed)

### If Fails:
- Check StepExecutor.executeLLMDecision() uses scopedParams (not enrichedParams)
- Check buildLLMPrompt() receives scopedParams
- Verify param enrichment logic removed (lines 1244-1287 in old code)

---

## 🧪 Test 5: End-to-End Workflow Success

### Goal: Verify entire workflow completes successfully

### Steps:
1. Run complete Invoice Extraction workflow:
   ```bash
   # Execute via UI or:
   npm run test-complete-pipeline-with-vocabulary
   # Or trigger via API
   ```

2. Monitor execution:
   ```bash
   tail -f logs/execution.log
   ```

3. Check final status:
   ```bash
   npm run check-latest-execution
   ```

### Expected Results:
- [ ] **Step1** (search_emails): Completes, returns emails
- [ ] **Step2** (flatten): Completes, extracts attachments > 0
- [ ] **Step3** (filter): Completes, filters PDFs
- [ ] **Step4** (scatter_gather): Starts iteration
  - [ ] **Step5** (get_attachment): Completes for each item
  - [ ] **Step6** (extract_fields): Completes, extracts vendor/amount/date
  - [ ] **Step6_sanitize**: Completes, handles nulls
  - [ ] **Step7** (create_folder): Completes, folder ID returned
  - [ ] **Step8** (upload_file): Completes, file_id returned
  - [ ] **Step9** (share_file): ✅ **Completes (no 404), permission created**
  - [ ] **Step10** (merge): Completes if present
  - [ ] **Step11** (update_spreadsheet): Completes, row added
- [ ] **Step12** (gather): Completes, collected results
- [ ] **Step13** (append_spreadsheet): Completes, rows added
- [ ] **Step15** (send_email): ✅ **Completes (<10K tokens), email sent**

### Overall Success Criteria:
- [ ] Workflow status: "completed" (not "failed")
- [ ] No steps with status "failed"
- [ ] Data written to spreadsheet (verify in Google Sheets)
- [ ] Email received (check inbox)
- [ ] Total token usage reasonable (<50K for entire workflow)
- [ ] Execution time reasonable (<5 minutes)

### If Fails:
- Check specific step that failed
- Review error message and logs
- Verify fix was applied correctly for that step
- Check if issue is execution or generation

---

## 🧪 Test 6: Verify No Duplicate Files

### Goal: Confirm idempotency issues are understood (not fixed yet)

### Steps:
1. Run workflow once
2. Note files created in Google Drive
3. Run workflow again
4. Check if duplicate files created

### Expected Results:
- [ ] Duplicate files ARE created (this is expected - not fixed yet)
- [ ] This is documented as separate issue (idempotency)
- [ ] Not blocking for current fixes

### Note:
Duplicate file issue requires separate fix (either in plugin or generation).
Not part of current execution fixes.

---

## 📊 Success Metrics

### Calibration:
- **Before**: 50+ auto-fixes per workflow
- **After**: 5-10 checks per workflow (only real issues)
- **Target**: ✅ <10 issues reported

### Execution:
- **Before**: 0% workflows complete end-to-end
- **After**: 95%+ workflows complete successfully
- **Target**: ✅ >90% success rate

### Token Usage:
- **Before**: Step15 uses 65K+ tokens (exceeds limit)
- **After**: Step15 uses <10K tokens
- **Target**: ✅ <10K tokens per AI step

### Data Flow:
- **Before**: Flatten returns 0 items, filter returns 0 items
- **After**: Flatten and filter return correct items
- **Target**: ✅ Correct data flow through all steps

---

## 🐛 Troubleshooting

### Issue: Calibration still applying field fixes
**Cause**: Skip logic not working
**Fix**: Check `/app/api/v2/calibrate/batch/route.ts` lines 378-450, verify `fixType === 'fix_flatten_field'` check

### Issue: Step9 still getting 404 error
**Cause**: Schema-aware resolution not working
**Fix**: Check ExecutionContext.resolveVariable() has expectedSchema parameter, verify StepExecutor passes schema

### Issue: Step15 still exceeds token limit
**Cause**: AI context scoping not working
**Fix**: Check StepExecutor.executeLLMDecision() uses scopedParams (line 1258), verify param enrichment removed

### Issue: Flatten still returns 0 items
**Cause**: Field path bug not fixed
**Fix**: Check WorkflowValidator.extractArrayFields() has includePathPrefixes parameter, verify transformFlatten has dot-notation detection

---

## ✅ Final Checklist

Before declaring success:

- [ ] All 6 tests passed
- [ ] Workflow completes end-to-end
- [ ] Data written to spreadsheet
- [ ] Email sent successfully
- [ ] Token usage <10K per AI step
- [ ] Calibration only reports real issues
- [ ] No field path auto-fixes applied
- [ ] Schema-aware extraction working
- [ ] Documentation complete

---

## 📝 Test Results Log

### Test Run Date: _____________
### Tester: _____________

| Test | Status | Notes |
|------|--------|-------|
| 1. Calibration Skips | ⬜ Pass / ⬜ Fail | |
| 2. Flatten Field Path | ⬜ Pass / ⬜ Fail | |
| 3. Schema Resolution | ⬜ Pass / ⬜ Fail | |
| 4. AI Context Scoping | ⬜ Pass / ⬜ Fail | |
| 5. End-to-End Success | ⬜ Pass / ⬜ Fail | |
| 6. Duplicate Files | ⬜ Pass / ⬜ Fail | |

**Overall Result**: ⬜ Success / ⬜ Needs Fixes

**Issues Found**:
-
-
-

**Next Steps**:
-
-
-

---

**Ready for Testing**: ✅
**Expected Duration**: 15-20 minutes
**Required Access**: Supabase logs, Google Drive, Email
