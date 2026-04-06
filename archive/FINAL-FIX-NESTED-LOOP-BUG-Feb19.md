# Final Fix: Nested Loop Variable Scope Bug (Feb 19, 2026)

**Status:** CRITICAL ENFORCEMENT ADDED ✅
**Target:** Fix Bug #1 - `{{current_attachment.message_id}}` scope error
**Approach:** Hybrid solution combining protocol positioning + concrete enforcement + specific bug pattern

---

## Problem Analysis

### Test Results After Moving Protocols to Line 1

**What worked:**
- ✅ **Bug #2 FIXED:** File field name validation worked (`attachment_content.data` instead of `extracted_text`)
- ✅ **Bug #3 & #4 MOSTLY FIXED:** AI metadata boundaries respected

**What didn't work:**
- ❌ **Bug #1 STILL PRESENT:** Scope error in nested loops persists

**Evidence:**
```json
// Step 7 in compiled workflow:
"params": {
  "message_id": "{{current_attachment.message_id}}",  // ❌ STILL WRONG!
  "attachment_id": "{{current_attachment.attachment_id}}"
}
```

### Root Cause

**The protocols were being READ but not APPLIED:**
- Protocol 2 exists at line 60
- Protocol 2 has 4-step validation process
- Example shows the EXACT wrong pattern: `{{current_attachment.message_id}}`
- **YET the LLM still generated this exact error!**

**Why?**
1. Protocol is too abstract ("determine source level", "trace hierarchy")
2. No specific enforcement for common patterns
3. No mention of the specific plugin action (`get_email_attachment`)
4. No explicit schema showing that attachment doesn't have `message_id`

---

## Solution Implemented: Triple Reinforcement

### Change #1: Strengthen Mandatory Validation Header

**Added to line 3-17:**

```markdown
**This prevents bugs where:**
- Variables reference non-existent fields
- **Wrong variable scopes are used in nested loops (e.g., using `current_attachment.message_id` when `message_id` belongs to `current_email`)**
- AI operations include metadata fields AI cannot generate
- Transform operations use wrong input types

**⚠️ SPECIAL ATTENTION REQUIRED:**
- **When working with nested loops (especially email→attachments), verify WHICH loop variable owns each field**
- **Common mistake:** Using `{{current_attachment.message_id}}` when it should be `{{current_email.message_id}}`
- **See Protocol 2 enforcement section for detailed examples**
```

**Why this works:**
- Mentions the EXACT bug pattern at the very top
- Uses the actual variable names (`current_attachment`, `current_email`)
- Points to enforcement section

---

### Change #2: Add Critical Enforcement Section After Protocol 2

**Added after line 110 (right after Protocol 2 example):**

```markdown
---

**🚨 CRITICAL ENFORCEMENT - Email/Attachment Nested Loops:**

**This is a COMMON BUG that you MUST avoid:**

When processing email attachments in nested loops (`loop_emails` → `loop_attachments`), operations inside the attachment loop that need the email's `message_id` MUST use `{{current_email.message_id}}`, NOT `{{current_attachment.message_id}}`.

**WHY:** Attachment objects do NOT have a `message_id` field. The `message_id` belongs to the EMAIL object (outer loop).

**Email schema (from google-mail.search_emails):**
```json
{
  "id": "string",           // ← THIS is message_id
  "threadId": "string",
  "subject": "string",
  "from": "string",
  "date": "string",
  "attachments": [          // ← Array of attachment objects
    {
      "filename": "string",
      "mimeType": "string",
      "attachment_id": "string",  // ← Note: attachment has attachment_id, NOT message_id
      "size": "number"
    }
  ]
}
```

**Common scenario:** Fetching attachment content using `google-mail.get_email_attachment` action

**❌ WRONG - This WILL FAIL:**
```json
{
  "step_id": "fetch_attachment_content",
  "plugin": "google-mail",
  "action": "get_email_attachment",
  "params": {
    "message_id": "{{current_attachment.message_id}}",        // ❌ WRONG! Field doesn't exist!
    "attachment_id": "{{current_attachment.attachment_id}}"
  }
}
```

**✅ CORRECT - Use outer loop variable:**
```json
{
  "step_id": "fetch_attachment_content",
  "plugin": "google-mail",
  "action": "get_email_attachment",
  "params": {
    "message_id": "{{current_email.message_id}}",            // ✅ CORRECT! From outer loop
    "attachment_id": "{{current_attachment.attachment_id}}"  // ✅ From current loop
  }
}
```

**Before generating ANY operation inside `loop_attachments`, ask yourself:**
1. Does this parameter need data from the EMAIL (outer loop)? → Use `{{current_email.FIELD}}`
2. Does this parameter need data from the ATTACHMENT (current loop)? → Use `{{current_attachment.FIELD}}`

**Fields that typically come from EMAIL (outer loop):**
- `message_id` (or `id`)
- `from`, `to`, `subject`, `date`
- `threadId`

**Fields that typically come from ATTACHMENT (current loop):**
- `attachment_id`
- `filename`
- `mimeType`
- `size`
```

**Why this works:**
- Shows the EXACT bug from the compiled workflow
- Shows the EXACT plugin action (`google-mail.get_email_attachment`)
- Shows the EXACT schema (attachment doesn't have `message_id`)
- Uses the ACTUAL variable names from the workflow
- Provides a decision tree ("ask yourself")

---

## Why This Approach Will Work

### Triple Reinforcement Strategy

**1. Top-level callout (lines 1-20):**
- Mentions the bug in the overview
- Uses actual variable names
- Points to enforcement section

**2. Protocol 2 (lines 60-110):**
- General principle and validation steps
- Abstract example showing pattern

**3. Critical Enforcement Section (NEW, after line 110):**
- **Concrete schema** showing attachment doesn't have `message_id`
- **Exact plugin action** that triggers this bug
- **Exact wrong code** from the actual workflow
- **Exact correct code** showing the fix
- **Decision tree** for every operation in attachment loop

### Psychological Impact on LLM

**Before (abstract protocol only):**
```
LLM reads: "Determine source level... trace hierarchy..."
LLM thinks: "Okay, general principle"
LLM generates: `{{current_attachment.message_id}}` (pattern-matches from context)
```

**After (triple reinforcement):**
```
LLM sees in header: "Common mistake: current_attachment.message_id"
LLM reads Protocol 2: "Trace data hierarchy..."
LLM sees enforcement: "🚨 CRITICAL: attachment doesn't have message_id - HERE IS THE SCHEMA"
LLM sees exact wrong code: "❌ WRONG - This WILL FAIL"
LLM sees exact correct code: "✅ CORRECT - Use current_email.message_id"
LLM generates: `{{current_email.message_id}}` ✅
```

---

## Comparison to Other Approaches

### Why Not Just "Blocking Checkpoints"?

**Option 2 (Blocking Checkpoints):** Require LLM to show validation work in comments

**Pros:**
- Forces explicit validation thinking
- Makes reasoning visible

**Cons:**
- **More complex prompt changes** (need to specify comment format)
- **Increases token usage** (validation comments in output)
- **Slows generation** (extra thinking step)
- **User constraint:** "Do not change it dramatically"

**Verdict:** Current approach is less disruptive and more targeted

---

### Why Not "Simplify to 3 Rules"?

**Option 3 (3 Absolute Rules):** Delete protocols, create 3 simple rules

**Pros:**
- Simpler prompt
- Easier to follow

**Cons:**
- **Violates user constraint:** "Do not delete the current"
- **Loses coverage** for other bug types (AI boundaries, file ops, transforms)
- **Less comprehensive**

**Verdict:** Current approach preserves all existing protocols while adding targeted fixes

---

### Why Current Approach (Option 1+) Is Best

**Hybrid: Protocol Positioning + Concrete Enforcement**

✅ **Preserves all existing content** (user constraint satisfied)
✅ **Targets specific bug pattern** (email/attachment nested loops)
✅ **Shows exact schema** (attachment doesn't have message_id)
✅ **Shows exact plugin action** (get_email_attachment)
✅ **Triple reinforcement** (header + protocol + enforcement)
✅ **Minimal disruption** (just additions, no deletions)
✅ **Scalable** (enforcement pattern can be replicated for other common bugs)

---

## Expected Impact

### Before This Fix

**LLM behavior:**
1. Reads abstract Protocol 2
2. Doesn't connect it to specific google-mail plugin
3. Pattern-matches from context
4. Generates `{{current_attachment.message_id}}`
5. ❌ Bug occurs

### After This Fix

**LLM behavior:**
1. Sees bug pattern in header: "current_attachment.message_id is wrong"
2. Reads Protocol 2 general principle
3. Sees Critical Enforcement section
4. Sees exact schema: attachment doesn't have message_id
5. Sees decision tree: "Is this from EMAIL or ATTACHMENT?"
6. Generates `{{current_email.message_id}}`
7. ✅ Bug prevented

### Success Criteria

**Next test should show:**
- ✅ `{{current_email.message_id}}` (not `current_attachment.message_id`)
- ✅ `{{current_email.from}}` for email sender
- ✅ `{{current_attachment.attachment_id}}` for attachment ID
- ✅ `{{current_attachment.filename}}` for filename

---

## Files Modified

### Main File

**[lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md](lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md)**

**Changes:**
1. **Lines 3-17:** Strengthened mandatory validation header with specific bug pattern
2. **Lines 111-177 (NEW):** Added Critical Enforcement section for email/attachment nested loops

**Total additions:** ~70 lines

### Backups Created

1. **formalization-system-v4-BACKUP-[timestamp]-before-enforcement.md** - Version before this fix

---

## Why This Is Different from Previous Attempts

### Attempt #1: Add Protocols at Line 54
**Result:** Protocols buried, might be skipped
**Outcome:** Bugs persisted

### Attempt #2: Strengthen Protocol 5 with "STOP" Language
**Result:** Transform bug fixed (Protocol 5 worked!)
**Outcome:** Partial success, but scope bug persisted

### Attempt #3: Move Protocols to Line 1
**Result:** Impossible to miss protocols
**Outcome:** File field bug fixed, AI metadata mostly fixed, BUT scope bug persisted

### Attempt #4 (THIS FIX): Add Concrete Enforcement with Exact Bug Pattern
**What's different:**
- Shows the EXACT schema (not just "check schema")
- Shows the EXACT plugin action (not just "plugin operations")
- Shows the EXACT wrong code from the actual workflow
- Uses the EXACT variable names from the workflow
- Provides a decision tree for every operation

**Why this should work:**
- LLM can't claim it didn't know attachment lacks message_id (schema is RIGHT THERE)
- LLM can't claim it didn't understand scope resolution (decision tree is RIGHT THERE)
- LLM can't claim the example is abstract (it's the EXACT code that failed)

---

## If This Still Fails

### Possible Reasons

1. **LLM is not reading enforcement section**
   - Unlikely - it's right after Protocol 2, which IS being read
   - Evidence: Bug #2 was fixed by Protocol 4

2. **LLM is reading but not understanding the schema**
   - Unlikely - schema is explicit and simple

3. **LLM is reading but still pattern-matching from other context**
   - Possible - if other examples in the prompt show similar patterns

### Next Options

**If bug persists after this fix:**

**Option A: Add enforcement to EVERY plugin documentation section**
- Repeat the schema and enforcement where google-mail plugin is documented
- Pro: Reinforces at point of use
- Con: Adds redundancy

**Option B: Add validation requirement to IR schema itself**
- Make scope validation part of the IR structure
- Require explicit scope annotation on every field reference
- Pro: Structural enforcement
- Con: Changes IR schema (bigger change)

**Option C: Post-generation validation step**
- Add a validation pass that checks all field references against schemas
- Reject IR if scope errors detected
- Pro: Catches errors before compilation
- Con: Adds extra step to pipeline

---

## Timeline

- **11:58 AM:** Initial Data Flow Reasoning Protocol inserted at line 54
- **5:24 PM:** Protocol 5 strengthened (transform bug fixed)
- **6:15 PM:** All bugs still present, protocols moved to line 1
- **6:45 PM:** Protocols at line 1 (Bug #2 fixed, Bug #1 persisted)
- **7:30 PM:** THIS FIX - Added concrete enforcement with exact bug pattern

---

## Next Step

**Test workflow regeneration with this enhanced prompt.**

**Expected result:**
```json
// Step 7 should now be:
{
  "plugin": "google-mail",
  "action": "get_email_attachment",
  "params": {
    "message_id": "{{current_email.message_id}}",            // ✅ FIXED!
    "attachment_id": "{{current_attachment.attachment_id}}"  // ✅ Correct!
  }
}
```

**If this works:** Bug #1 is FIXED, success rate should jump to 85-90%

**If this fails:** We know the LLM is fundamentally not connecting schemas to field references, and we need structural changes (Option B or C above)

---

## Key Learning

**Lesson:** Abstract principles aren't enough for LLMs.

**What works:**
- Concrete schemas (show the actual structure)
- Exact bug patterns (show the wrong code)
- Exact correct patterns (show the right code)
- Decision trees ("ask yourself")
- Triple reinforcement (header + protocol + enforcement)

**What doesn't work:**
- Abstract principles ("determine source level")
- Generic examples (not from actual workflow)
- Single mention (needs reinforcement)

**The difference:** Treat the LLM like a junior developer who needs to see EXACTLY what went wrong and EXACTLY how to fix it, not just general principles.
