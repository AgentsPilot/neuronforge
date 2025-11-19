# AgentPilot Onboarding & Prompt Ideas Specification

**Title:** Onboarding + Free Pilot Tokens + Prompt Idea Generator
**Audience:** Developer Implementation Reference
**Owner:** AgentPilot Platform
**Last Updated:** 2025-11-18

---

## Goal

Implement a complete onboarding flow where:
- **Onboarding collects 3 simple answers with ZERO LLM calls**
- After registration, user automatically receives **20,834 Pilot Tokens**
- Free tokens can be used for:
  - Generating personalized prompt ideas
  - Running the full Agent Creation pipeline
- User can copy or auto-use chosen prompt ideas in existing Agent Creation chat

**IMPORTANT:** Do NOT change existing Agent Creation orchestrator/pipeline. This spec ONLY adds:
1. Lightweight onboarding data capture
2. Free token allocation after registration
3. Post-registration "Prompt Ideas" generator and UI
4. Wiring from prompt ideas into existing creation chat

---

## New Behavior Summary

### 1. Registration Token Grant
When a user completes registration:
- System automatically allocates **20,834 Pilot Tokens**
- Tokens can be used for:
  - Prompt Idea Generator LLM calls
  - Full Agent Creation pipeline (clarifications, enhanced prompt, generate-agent, refinements, test runs)

### 2. No-LLM Onboarding
Onboarding runs with **no LLM calls** and stores three answers:
- `onboarding_goal`
- `preferred_mode`
- `user_role`

### 3. Post-Onboarding Experience
After onboarding, user can:
- Generate personalized prompt ideas (using free tokens)
- Start creating their first agent using those ideas

### 4. Token Exhaustion
Only after user exhausts free tokens, show pricing and ask for paid top-up.

---

## High-Level Flow

```
[1] User signs up → registration success
[2] Immediately allocate 20,834 Pilot Tokens
[3] Show 3-question onboarding (no LLM calls)
[4] Store onboarding answers in DB
[5] After onboarding, call Prompt Idea Generator (LLM) using free tokens
[6] LLM returns 3–5 natural-language prompt ideas + mode hint
[7] UI shows prompt ideas with "Copy" / "Use this idea" buttons
[8] User picks a prompt:
    - Copy and paste manually into Agent Creation chat, OR
    - Auto-open Agent Creation with prompt prefilled
[9] Existing Agent Creation flow runs as-is:
    - Clarification Questions
    - Enhanced Prompt
    - generate-agent
    - Input & Output schema generation
    - Plugin suggestions/usage
    - Review & save
[10] User refines and tests agent using remaining free tokens
[11] When tokens near zero/exhausted → show upgrade/credit purchase options
```

---

## Pilot Tokens & LLM Token Relation

### Platform Assumptions
- **1 Pilot Token ≈ 10 raw LLM tokens** (input + output combined)
- **Registration grant: 20,834 Pilot Tokens**
  - Corresponds to ≈ 208,340 raw LLM tokens

### Token Usage Coverage
This grant is enough to:
- Run Prompt Idea Generator several times
- Run Agent Creation pipeline for at least one full agent
- Perform multiple refinement/test runs depending on complexity

### Token Management Functions
```typescript
allocateInitialPilotTokens(userId: string, amount = 20834)
deductPilotTokens(userId: string, estimatedCost: number)
getRemainingPilotTokens(userId: string): number
```

---

## Onboarding (No LLM, No Token Use)

The onboarding is **purely form-based** and must NOT trigger any LLM calls.

### Question 1: User Goal (Main Intent)

**UI Text:**
> "What do you want your AI to help you with first?"

**Type:** Multiline text
**Expected:** 1–3 sentences
**Examples (placeholder only):**
- "Summarize my last 10 emails every morning."
- "Help me keep track of client follow-ups."
- "Give me a daily digest of important business updates."
- "Summarize Zoom recordings for each lesson."

**Store as:** `onboarding_goal: string`

---

### Question 2: Preferred AI Behavior (Mode Hint)

**UI Text:**
> "How should your AI work?"

**Options (buttons/cards):**
- Help me only when I ask → `"on_demand"`
- Do things automatically for me → `"scheduled"`
- Watch things and alert me → `"monitor"`
- Not sure yet — guide me → `"guided"`

**Store as:** `preferred_mode: "on_demand" | "scheduled" | "monitor" | "guided"`

---

### Question 3: User Role (Context)

**UI Text:**
> "What best describes your role?"

**Options:**
- Business owner → `"business_owner"`
- Manager → `"manager"`
- Consultant → `"consultant"`
- Operations → `"operations"`
- Sales → `"sales"`
- Marketing → `"marketing"`
- Finance → `"finance"`
- Other → `"other"`

**Store as:** `user_role: string` (normalized)

---

### Data Model

**Table:** `user_onboarding`

```sql
CREATE TABLE user_onboarding (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  onboarding_goal TEXT NOT NULL,
  preferred_mode TEXT NOT NULL,
  user_role TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Onboarding completes after saving these values. No LLM calls allowed in this step.**

---

## Initial Token Grant

### When to Allocate
**Event:** User registration success (email/password, OAuth, etc.)

**Action:**
```typescript
async function onUserRegistered(userId: string) {
  await allocateInitialPilotTokens(userId, 20834);
}
```

### Where Tokens Can Be Used
These initial 20,834 Pilot Tokens can be used for:

1. **Prompt Idea Generator LLM calls**
2. **Full Agent Creation pipeline calls:**
   - Clarification question generation
   - Enhanced prompt generation
   - Agent generation (prompt + schemas + plugin usage)
   - Agent test runs (sandbox)
   - Later refinements of prompt/schema

Token usage should be deducted via existing metering system.

---

## Prompt Idea Generator (Post-Onboarding LLM Call)

### Trigger Options

**Option A:** Immediately after onboarding, show:
> "We've created some AI agent ideas for you based on your answers"

**Option B:** Show "Generate Ideas" button; call LLM when clicked

**Both options:** Use tokens from user's balance (20,834). Block or downgrade if 0 tokens.

---

### Input to LLM

```json
{
  "onboarding_goal": "<string>",
  "preferred_mode": "on_demand | scheduled | monitor | guided",
  "user_role": "<normalized string>",
  "connected_plugins": ["gmail", "outlook", "hubspot"] // optional
}
```

**Example:**
```json
{
  "onboarding_goal": "I want to get a summary of my last 10 emails every morning.",
  "preferred_mode": "scheduled",
  "user_role": "operations",
  "connected_plugins": ["gmail"]
}
```

---

### Task Definition for LLM

**Claude's job:**
- Generate **3 to 5 natural-language prompt ideas**
- Each prompt describes an agent the user might want to create
- Prompts must be ready to paste into Agent Creation chat
- Respect user's goal, behavior, role, and optional plugins

**Strict constraints:**

**DO NOT generate:**
- Schemas
- JSON
- Workflow steps
- Plugin choices
- Orchestrator logic
- Model selection

**DO NOT:**
- Mention internal concepts (AgentPilot, tokens, LLM, etc.)
- Reference pricing or credits

**Only produce human-readable prompts like:**
> "Create an agent that summarizes my last 10 emails every morning and highlights urgent messages and action items."

---

### Output Format (STRICT)

```json
{
  "recommended_prompts": [
    "string prompt 1",
    "string prompt 2",
    "string prompt 3"
  ],
  "mode_hint": "on_demand | scheduled | monitor | guided"
}
```

**Rules:**
- `recommended_prompts`:
  - 3–5 items
  - Each is a complete, single-sentence or short-paragraph natural-language description
  - No JSON, no bullet lists, no code

- `mode_hint`:
  - Must be one of: `"on_demand" | "scheduled" | "monitor" | "guided"`
  - Normally equals `preferred_mode`, unless goal clearly implies different one

**No other keys allowed at top level.**

---

## UI for Prompt Ideas

### Display

**Title:**
> "Here are some AI agent ideas based on what you shared"

**For each `recommended_prompt`:**
- Render in a card or list item
- Show text clearly
- Buttons:
  - **Copy** – copies prompt to clipboard
  - **Use this idea** – jumps into Agent Creation with prompt prefilled

**Optional label based on `mode_hint`:**
- "Good for daily automation" if `mode_hint === "scheduled"`
- "Best for alerts" if `mode_hint === "monitor"`

---

### Behavior

**Copy:**
- Copies prompt to clipboard
- User can manually paste into Agent Creation chat later

**Use this idea:**
- Redirects/opens Agent Creation page
- Prefills chat input box with chosen prompt
- Optionally sets default agent mode based on `mode_hint`

**No agent is created at this point.**
**No schema, workflow, or plugin is set yet.**

---

## Handoff Into Existing Agent Creation Flow

After user chooses a prompt, they go to existing Agent Creation UI.

**Current pipeline continues exactly as today:**

1. User has prompt in Agent Creation chat
2. When submitted:
   - **Step 1:** Clarification Questions (LLM)
   - **Step 2:** Enhanced Prompt/plan (LLM)
   - **Step 3:** Generate Agent:
     - user_prompt / system_prompt
     - input_schema
     - output_schema
     - plugin suggestions/usage
     - agent metadata
3. User reviews & confirms agent
4. Agent stored in Supabase
5. User can run tests in sandbox and refine

**All LLM calls deduct from same Pilot Token balance (started at 20,834).**

---

## Token Usage & Thresholds

### Consumption Rules

**Every LLM call charges against Pilot Token balance:**
- Prompt Idea Generator
- Clarification Questions
- Enhanced Prompt
- generate-agent
- Sandbox runs

**Deduction strategy:**
- Estimate cost based on model pricing
- Deduct safe upper-bound before call, OR
- Deduct actual usage after call (if telemetry available)

---

### Low / Zero Tokens UX

**When `getRemainingPilotTokens(userId)` is low or zero:**

**At 0 tokens:**
- Show modal before LLM call:
  > "You've used your free pilot tokens. To keep building and running agents, add more credits."

**At low threshold:**
- Show gentle banner:
  > "You're running low on pilot tokens. You can top up anytime in Billing."

**Only block LLM operations when at 0 or below strict minimum threshold.**

---

## What Claude Must NOT Change

When implementing this spec, **DO NOT:**

### Modify or Redesign:
- Existing Agent Creation orchestrator
- generate-agent endpoint logic (prompt → schemas → plugins)
- Clarification Questions system
- Enhanced Prompt/plan generator
- Plugin strategy registry and implementations

### Introduce:
- New agent template object types
- New workflow DSLs
- New schema formats beyond what exists

### Decide:
- Pricing or billing policies
- Which plugins are enabled/available

---

## Claude's Responsibilities

**Strictly limited to:**

1. Add/adjust onboarding data structures & UI (3 questions, no LLM)
2. Add initial token grant logic (20,834 Pilot Tokens on registration)
3. Implement Prompt Idea Generator backend endpoint and system prompt
4. Implement Prompt Ideas display UI and "Copy/Use this idea" actions
5. Wire chosen prompt into existing Agent Creation chat

---

## Implementation Summary

### On Registration:
- Immediately grant **20,834 Pilot Tokens**

### Onboarding:
- Ask 3 simple questions (goal, mode, role)
- Store in `user_onboarding`
- **No LLM calls**

### Prompt Idea Generator:
- After onboarding, use free tokens to call LLM once
- Input: `onboarding_goal`, `preferred_mode`, `user_role`, optional `connected_plugins`
- Output: `{ "recommended_prompts": [...], "mode_hint": "..." }`

### UI:
- Show 3–5 prompts
- Allow user to copy or use prompt
- If "Use", open Agent Creation with prompt prefilled

### Agent Creation:
- Continue with existing flow funded by remaining free tokens:
  - Clarification → Enhanced Prompt → generate-agent

### When Tokens Low/Empty:
- Show pricing and upsell for more Pilot Tokens

---

## Current Implementation Status

### ✅ Completed:
- 4-step onboarding UI (Profile, Goal, Trigger, Role)
- TriggerStep component for mode selection
- Simplified RoleStep without mode selection
- Non-technical language throughout
- Prompt Ideas page and card components
- Backend API for prompt generation

### ⚠️ Needs Adjustment:
- **Question 2 (Mode)** currently asks "When should your agent work?" but spec requires "How should your AI work?" with different options
- **Question 3 (Role)** currently uses `admin/user/viewer` but spec requires role context (business_owner, manager, etc.)
- Need to align UI text and options with exact spec requirements

---

## Next Steps

1. Update TriggerStep to match spec Question 2 exactly
2. Update RoleStep to match spec Question 3 exactly (role context, not access level)
3. Verify onboarding data is stored correctly in `user_onboarding` table
4. Ensure token grant happens on registration
5. Test complete flow end-to-end
