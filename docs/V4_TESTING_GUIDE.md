# V4 Testing Guide

## How to Test V4 OpenAI 3-Stage Architecture

### Quick Start

V4 is now integrated into the agent creation flow with a feature flag!

### Method 1: URL Parameter (Easiest)

Add `?useV4=true` to your agent creation URL:

```
http://localhost:3000/v2/agents/new?useV4=true
```

### Method 2: LocalStorage (Persistent)

Open browser console and run:

```javascript
localStorage.setItem('useV4', 'true')
```

Then reload the page. V4 will be used for all agent creations until you clear it:

```javascript
localStorage.removeItem('useV4')
```

### Method 3: Direct API Call (For Debugging)

```bash
curl -X POST http://localhost:3000/api/generate-agent-v4 \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create an agent that reads my Gmail inbox for emails with expense in the subject, extracts expense details from attachments using AI, and sends me a summary",
    "userId": "your-user-id",
    "connectedPlugins": ["google-mail"],
    "connectedPluginData": [{
      "key": "google-mail",
      "displayName": "Google Mail",
      "capabilities": ["read_email", "send_email", "search_emails"],
      "category": "communication"
    }]
  }'
```

---

## What to Test

### 1. Basic Workflow Generation

**Test**: Simple email summarization

**Prompt**:
```
Read my recent emails and summarize them
```

**Expected Output**:
- Agent with workflow_steps containing:
  - Step 1: `type: "action"`, `plugin: "google-mail"`, `action: "search_emails"`
  - Step 2: `type: "ai_processing"`, prompt about summarization

**Check**:
- Console logs show "===== STAGE 1: LLM STEP PLAN ====="
- Console logs show "===== STAGE 2: DETERMINISTIC DSL BUILDER ====="
- Agent has all required fields: `agent_name`, `workflow_steps`, `required_inputs`, etc.

### 2. Complex Workflow (Original Failure Case)

**Test**: Expense attachment workflow

**Prompt**:
```
Check my Gmail inbox for emails with "expense" in subject.
Extract expense details from email attachments using AI.
Create a table with date, vendor, amount, expense type.
Send me the results.
```

**Expected Output**:
- Multiple workflow steps
- AI processing step for extraction
- Proper parameter mapping
- No schema errors

**Success Criteria**:
- Generates valid PILOT_DSL_SCHEMA
- All required fields present
- No "Invalid schema" errors

### 3. Multi-Plugin Workflow

**Test**: Gmail + HubSpot integration

**Prompt**:
```
Read emails from potential clients in Gmail.
Create HubSpot contacts for each sender.
Send a confirmation email.
```

**Expected Output**:
- Steps using both `google-mail` and `hubspot` plugins
- Proper action resolution for each plugin
- Correct parameter references between steps

### 4. Edge Cases

**Test Ambiguous Actions**:

**Prompt**:
```
Filter my contacts
```

**Expected**:
- Should detect ambiguity (search vs filter vs update)
- Return warnings in response
- Still generate workflow with best guess

---

## Debugging

### Check Console Logs

Look for these log patterns:

```
[V4 Generator] ===== STAGE 1: LLM STEP PLAN =====
[V4 Generator] Step plan extracted: { goal: "...", stepsCount: 3, steps: [...] }

[V4 Generator] ===== STAGE 2: DETERMINISTIC DSL BUILDER =====
[DSL Builder] Building DSL from 3 steps
[DSL Builder] Step 1: Resolved plugin: google-mail, action: search_emails

[V4 Generator] ===== SUCCESS: PILOT_DSL_SCHEMA GENERATED =====
```

### Check Response Structure

The v4 API should return:

```json
{
  "success": true,
  "agentId": "...",
  "sessionId": "...",
  "agent": {
    "agent_name": "...",
    "workflow_steps": [...],
    "required_inputs": [...],
    "suggested_plugins": [...],
    ...
  },
  "extraction_details": {
    "version": "v4",
    "architecture": "openai-3-stage"
  }
}
```

### Common Issues

**Issue**: "enhancedPrompt is required"
**Fix**: V4 API now calls enhance-prompt automatically. Make sure you're sending `prompt`, not `enhancedPrompt`.

**Issue**: "Plugin not found"
**Fix**: Ensure `connectedPluginData` includes plugin metadata with capabilities.

**Issue**: "No valid steps found in LLM output"
**Fix**: Check Stage 1 LLM output. It should return numbered steps like "1. Do X using plugin.action"

---

## Comparing V3 vs V4

### Side-by-Side Test

1. Create agent with v3 (default):
   ```
   http://localhost:3000/v2/agents/new
   ```

2. Create same agent with v4:
   ```
   http://localhost:3000/v2/agents/new?useV4=true
   ```

3. Compare:
   - **Success Rate**: Did it generate a valid agent?
   - **Workflow Quality**: Are the steps correct?
   - **Performance**: Check console for timing (v4 should be faster)
   - **Token Usage**: Check analytics (v4 should use fewer tokens)

### Metrics to Track

| Metric | V3 Baseline | V4 Target | How to Check |
|--------|-------------|-----------|--------------|
| Success Rate | 10-30% | 95%+ | Did agent generation succeed? |
| Token Usage | 18,000 | <2,000 | Check console logs |
| Latency | 8-12s | <5s | Check network tab |
| Schema Errors | Common | Rare | Check for "Invalid schema" errors |

---

## Test Scenarios

### Scenario 1: Email Workflows

```
✅ "Summarize my recent emails"
✅ "Find emails from john@example.com and reply"
✅ "Search for expense emails and extract details"
✅ "Read unread emails from last week"
```

### Scenario 2: CRM Workflows

```
✅ "Create HubSpot contact for each new lead"
✅ "Update contact properties based on email activity"
✅ "Search HubSpot for contacts and send them emails"
```

### Scenario 3: Multi-Step AI Processing

```
✅ "Read documents, extract key points, create summary"
✅ "Analyze customer feedback and categorize by sentiment"
✅ "Extract data from images and save to spreadsheet"
```

### Scenario 4: Complex Integrations

```
✅ "Read Gmail, create HubSpot contact, send Slack notification"
✅ "Search emails, extract data, write to Google Sheets"
✅ "Monitor inbox, categorize emails, update CRM"
```

---

## Success Checklist

Before marking v4 as production-ready:

- [ ] All test scenarios pass
- [ ] Success rate >90% on 50+ prompts
- [ ] No hardcoded plugin names in generated workflows
- [ ] All PILOT_DSL_SCHEMA required fields present
- [ ] Token usage <2,000 per generation
- [ ] Latency <5s per generation
- [ ] Proper error handling for ambiguities
- [ ] Works with ANY connected plugin

---

## Rollout Plan

### Phase 1: Internal Testing (Current)
- Test with `?useV4=true` flag
- Fix any bugs found
- Validate against test scenarios

### Phase 2: Beta Testing
- Enable for 5% of users via A/B test
- Monitor success rates
- Collect feedback

### Phase 3: Gradual Rollout
- 25% → 50% → 100% traffic
- Compare metrics with v3
- Monitor error rates

### Phase 4: Full Production
- Make v4 the default
- Deprecate v3
- Remove feature flag

---

## Need Help?

**Check logs**:
- Browser console for frontend errors
- Terminal/server logs for backend errors

**Common fixes**:
- Clear localStorage: `localStorage.clear()`
- Restart dev server
- Check OpenAI API key is set

**Report issues**:
- Include console logs
- Include full prompt and response
- Note which stage failed (1, 2, or 3)
