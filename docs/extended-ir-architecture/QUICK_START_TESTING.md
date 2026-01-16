# V6 Architecture - Quick Start Testing Guide

## Fixed: Test Page 404 Issue ✅

**Problem:** The test page at `/test-v6.html` was getting redirected to `/v2/test-v6.html` causing a 404.

**Solution:** Updated [middleware.ts](../../middleware.ts) to skip HTML files from V1/V2 routing logic.

**Change Made:**
```typescript
pathname.match(/\.(ico|png|jpg|jpeg|svg|gif|woff|woff2|ttf|eot|html)$/)
```

Now `.html` files are served directly from `/public` without redirection.

---

## Manual Testing (Browser)

### Access the Test Page

**URL:** http://localhost:3000/test-v6.html

### How to Use

1. **Step 1: Generate Workflow Plan**
   - Fill in the Enhanced Prompt sections:
     - Data Sources (e.g., `Read from Google Sheet "MyLeads" tab "Leads"`)
     - Actions (e.g., `Filter rows where stage = 4`)
     - Output Format (e.g., `Format as HTML table`)
     - Delivery (e.g., `Email to meiribarak@gmail.com`)
   - Click "Generate Plan"
   - Wait 10-30 seconds for LLM response
   - Review the natural language plan preview

2. **Step 2: Update Plan (Optional)**
   - Enter a correction message (e.g., `Change filter to use "status" column equals "qualified" instead`)
   - Click "Update Plan"
   - Review the updated plan and changes

3. **Step 3: Compile Workflow**
   - Click "Compile to PILOT_DSL"
   - Review the compiled workflow steps
   - Check compilation metadata (rule used, deterministic %, time)

### Expected Results

- ✅ Plan generation completes in <30 seconds
- ✅ Natural language plan shows clear, readable steps with emojis
- ✅ Plan updates apply corrections correctly
- ✅ Compilation completes in <100ms
- ✅ Workflow has deterministic steps (>70%)
- ✅ All JSON responses are valid

---

## Automated Testing (Jest)

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# Integration tests (E2E flow)
npm test lib/agentkit/v6/__tests__/integration

# Unit tests - IR Generator
npm test lib/agentkit/v6/generation/__tests__

# Unit tests - Compiler
npm test lib/agentkit/v6/compiler/__tests__

# Unit tests - Translator
npm test lib/agentkit/v6/translation/__tests__

# E2E API tests
npm test app/api/v6/__tests__

# Validation tests (already exist)
npm test lib/agentkit/v6/logical-ir/schemas/__tests__
```

### Test Coverage

- **100+ automated tests** across all V6 components
- **Integration tests:** 8 end-to-end workflows
- **Unit tests:** 74+ component tests
- **E2E API tests:** 18+ endpoint tests
- **Performance benchmarks:** IR gen <30s, compilation <100ms, translation <50ms

---

## API Testing (curl)

### Test Generate Workflow Plan

```bash
curl -X POST http://localhost:3000/api/v6/generate-workflow-plan \
  -H "Content-Type: application/json" \
  -d '{
    "enhancedPrompt": {
      "sections": {
        "data": ["Read from Google Sheet MyLeads tab Leads"],
        "actions": ["Filter rows where stage = 4"],
        "delivery": ["Email to meiribarak@gmail.com"]
      }
    },
    "modelProvider": "openai"
  }'
```

### Test Update Workflow Plan

```bash
curl -X POST http://localhost:3000/api/v6/update-workflow-plan \
  -H "Content-Type: application/json" \
  -d '{
    "correctionMessage": "Change filter to use status column",
    "currentIR": { <IR_FROM_GENERATE> }
  }'
```

### Test Compile Workflow

```bash
curl -X POST http://localhost:3000/api/v6/compile-workflow \
  -H "Content-Type: application/json" \
  -d '{
    "ir": { <IR_FROM_GENERATE_OR_UPDATE> }
  }'
```

---

## Environment Requirements

### Required Environment Variables

```bash
# For OpenAI (recommended for testing)
OPENAI_API_KEY=sk-...

# OR for Anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

### Server Must Be Running

```bash
npm run dev
```

Server will start on http://localhost:3000

---

## Troubleshooting

### Issue: Test page shows 404

**Solution:** Already fixed! The middleware now skips `.html` files.

### Issue: API returns validation errors

**Check:**
- Enhanced prompt has required `sections` object
- Sections include at least `data` and `delivery` arrays
- IR includes required fields: `ir_version`, `goal`, `data_sources`, `delivery`, `clarifications_required`

### Issue: LLM timeouts or errors

**Check:**
- Environment variables are set correctly
- API keys are valid
- Network connection is stable
- Try with different model provider (OpenAI vs Anthropic)

### Issue: Tests fail

**Check:**
- Server is running (`npm run dev`)
- Environment variables are set
- No port conflicts (default: 3000)
- Run tests one suite at a time to isolate issues

---

## Next Steps

1. ✅ **Manual Testing**
   - Open http://localhost:3000/test-v6.html
   - Test with real examples from your use cases
   - Verify UI/UX matches expectations

2. ✅ **Run Automated Tests**
   ```bash
   npm test
   ```

3. ✅ **API Testing**
   - Use curl commands above
   - Or use Postman/Insomnia

4. ✅ **Performance Validation**
   - Check timing in browser console
   - Verify compilation <100ms
   - Verify IR generation <30s

5. ✅ **Edge Case Testing**
   - Test with empty results
   - Test with complex workflows
   - Test with invalid inputs

---

## Quick Test Checklist

- [ ] Test page loads at http://localhost:3000/test-v6.html
- [ ] Generate plan from simple prompt (tabular → email)
- [ ] Update plan with correction
- [ ] Compile workflow successfully
- [ ] Check console logs for errors
- [ ] Verify deterministic compilation (>70%)
- [ ] Run automated tests (`npm test`)
- [ ] Test with AI operations (sentiment, classification)
- [ ] Test with grouping (per-group delivery)
- [ ] Test with complex multi-step workflows

---

**Status:** ✅ All testing infrastructure ready

**Test Page:** http://localhost:3000/test-v6.html

**Issue Fixed:** HTML files no longer redirected to /v2
