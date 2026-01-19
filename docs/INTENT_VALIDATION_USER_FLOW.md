# Intent Validation User Flow - Complete Visualization

**Document Version:** 1.2
**Created:** 2026-01-18
**Updated:** 2026-01-19

---

## Context: Integration with Thread-Based Agent Creation

This document describes the **Intent Validation Flow** which runs **AFTER** the existing thread-based agent creation flow. The input to this flow is the **enhanced prompt** that the user has already approved.

### Prerequisites (Thread-Based Flow - Already Exists)

Before Intent Validation begins, the user has already completed:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THREAD-BASED FLOW (EXISTING)                             │
│                    See: V2_Thread-Based-Agent-Creation-Flow.md              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. USER ENTERS RAW PROMPT                                                  │
│     "Send each salesperson their Stage 4 leads daily"                       │
│          │                                                                  │
│          ▼                                                                  │
│  2. PHASE 1: ANALYSIS                                                       │
│     • Clarity score                                                         │
│     • Connected plugins detection                                           │
│     • Initial understanding                                                 │
│          │                                                                  │
│          ▼                                                                  │
│  3. PHASE 2: QUESTIONS (Conversational Q&A)                                 │
│     • "Which Google Sheet?" → User answers                                  │
│     • "What email subject?" → User answers                                  │
│     • Basic clarifications resolved through chat                            │
│          │                                                                  │
│          ▼                                                                  │
│  4. PHASE 3: ENHANCED PROMPT                                                │
│     • System generates enhanced_prompt with plan                            │
│     • Includes services_involved, workflow outline                          │
│          │                                                                  │
│          ▼                                                                  │
│  5. USER APPROVES ENHANCED PROMPT ✓                                         │
│     "Yes, this looks good!"                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Enhanced Prompt (approved)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INTENT VALIDATION FLOW (THIS DOCUMENT)                   │
│                    Starts here with the enhanced prompt                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What is the Enhanced Prompt?

The **enhanced prompt** is a structured JSON output from Phase 3. It contains:
- `plan_title` and `plan_description` - Summary of what the agent will do
- `sections` - Detailed breakdown: data, actions, output, delivery, processing_steps
- `specifics.services_involved` - Which plugins are needed (e.g., google-sheets, google-mail)
- `specifics.user_inputs_required` - Any remaining inputs needed from user
- `specifics.resolved_user_inputs` - Answers the user provided during Thread-Based Q&A

**Example Enhanced Prompt (actual structure):**
```json
{
  "plan_title": "High-Qualified Leads (Stage 4) Summary + End-User Email",
  "plan_description": "Reads leads from a Google Sheet, filters to Stage = 4...",
  "sections": {
    "data": [
      "- Read lead rows from the Google Sheet with ID '1pM8WbX...'.",
      "- Use the worksheet (tab) named 'Leads'.",
      "- Use these columns: Date, Lead Name, Company, Email, Phone, Stage, Notes, Sales Person."
    ],
    "actions": [
      "- Filter rows where 'Stage' column value equals '4'.",
      "- Build a summary table with specified columns.",
      "- Extract unique recipient emails from 'Sales Person' column."
    ],
    "output": [
      "- Generate an email-ready embedded table for filtered leads.",
      "- If no filtered leads exist, output 'none found' instead."
    ],
    "delivery": [
      "- Send one email to user at eomer3@gmail.com with the table.",
      "- Send one email to end users (Sales Person emails) with the table."
    ],
    "processing_steps": [
      "- Load all rows from 'Leads' tab.",
      "- Filter where Stage = 4.",
      "- Render as embedded table for email."
    ]
  },
  "specifics": {
    "services_involved": ["google-sheets", "google-mail"],
    "user_inputs_required": [
      "End-user email body text (or confirm default message)."
    ],
    "resolved_user_inputs": [
      { "key": "user_email", "value": "eomer3@gmail.com" },
      { "key": "spreadsheet_id", "value": "1pM8WbX..." },
      { "key": "sheet_tab_name", "value": "Leads" },
      { "key": "high_qualified_rule", "value": "Stage column = 4" },
      { "key": "recipient_email_column", "value": "Sales Person" },
      { "key": "end_user_email_subject", "value": "High-qualified leads (Stage 4) :" },
      { "key": "no_results_behavior", "value": "email user 'none found'" }
    ]
  }
}
```

This structured JSON is the **input** to the Intent Validation flow described below.

---

## Overview: Intent Validation After Enhanced Prompt Approval

The Intent Validation flow validates the enhanced prompt against real data and catches issues the LLM may have missed. Users are engaged at **ONE additional point** - the "Review & Customize" screen.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      INTENT VALIDATION PIPELINE                             │
│                      (Starts with Enhanced Prompt)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ENHANCED PROMPT (from Phase 3, user-approved)                              │
│  "Send daily email to each salesperson with Stage 4 leads from              │
│   Sales Pipeline 2026 sheet, using Sales Person Email column..."            │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ PHASE 1: SEMANTIC UNDERSTANDING                                      │   │
│  │ LLM analyzes enhanced prompt for assumptions and edge cases          │   │
│  │                                                                       │   │
│  │ Outputs:                                                              │   │
│  │ • remaining_clarifications[] ──────────────────────┐                 │   │
│  │   (usually minimal - most resolved in Thread-Based Q&A)      │                 │   │
│  │ • assumptions[]                                     │ Collected      │   │
│  │ • edge_cases[]                                      │ (not shown     │   │
│  │ • inferences[]                                      │  yet)          │   │
│  └─────────────────────────────────────────────────────│────────────────┘   │
│       │                                                │                    │
│       ▼                                                │                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 2: GROUNDING                                                   │   │
│  │ Validate assumptions against real data sources                       │   │
│  │                                                                       │   │
│  │ Outputs:                                                              │   │
│  │ • grounding_results[] (with confidence scores)      │                │   │
│  │ • grounding_errors[]                                │ Enriches       │   │
│  │ • validated_assumptions[]                           │ Phase 1        │   │
│  │ • EXPOSES: Fake validations ("not implemented")     │ data           │   │
│  │ • ENRICHES: any remaining clarifications            ▼                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 5-LAYER AMBIGUITY DETECTION                                          │   │
│  │                                                                       │   │
│  │ Analyzes grounded data to find what LLM MISSED:                      │   │
│  │ • Layer 1: Confidence mismatches (high claim, low grounding)         │   │
│  │ • Layer 2: Semantic patterns (loop intent, data visibility)          │   │
│  │ • Layer 3: Cross-assumption conflicts                                │   │
│  │ • Layer 4: Vague language                                            │   │
│  │ • Layer 5: Business logic risks (PII, irreversible)                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  🎯 SINGLE UI: Review & Customize Your Agent                          │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ REMAINING QUESTIONS (if any - usually minimal after Thread-Based Q&A)      │ │  │
│  │  │ • [Only shows questions not resolved in Phase 2]              │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ PLEASE CONFIRM (from 5-layer detection)                          │ │  │
│  │  │ • One email to all OR per person? ← pattern detected             │ │  │
│  │  │ • Data visibility? ← PII risk detected                           │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ ASSUMPTIONS (validated by grounding)                             │ │  │
│  │  │ ☑ Stage = 4  ☑ Use Sales Person Email column                     │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ EDGE CASES                                                       │ │  │
│  │  │ • No leads found → [Skip email ▼]                                │ │  │
│  │  │ • Missing email → [Send to me ▼]                                 │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
│  │  │ INPUT PARAMETERS & SCHEDULE (consolidated from current flow)     │ │  │
│  │  │ • Schedule: [Daily at 8:00 AM ▼]                                 │ │  │
│  │  │ • Notify me on: [Failure only ▼]                                 │ │  │
│  │  └──────────────────────────────────────────────────────────────────┘ │  │
│  │                                                                        │  │
│  │  [Create Agent]                                                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│       │                                                                     │
│       │ (Only after user approves)                                          │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 3: IR FORMALIZATION (with user's answers as constraints)       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ PHASE 4: COMPILATION (IR → PILOT_DSL)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ AGENT SAVED                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Merged Flow: Thread-Based + Intent Validation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE AGENT CREATION FLOW                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════  │
│  STAGE 1: THREAD-BASED FLOW (Existing - Clarify Intent)                 │
│  ════════════════════════════════════════════════════════════════════════  │
│                                                                             │
│  [Raw Prompt] → [Analysis] → [Q&A Chat] → [Enhanced Prompt] → [Approve]    │
│       │              │            │              │                │         │
│       │              │            │              │                │         │
│   User types     System       User answers   System creates   User says    │
│   request       analyzes     questions in   enhanced prompt   "Looks       │
│                              chat UI        with plan         good!"       │
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════  │
│  STAGE 2: INTENT VALIDATION (New - Validate & Confirm)                     │
│  ════════════════════════════════════════════════════════════════════════  │
│                                                                             │
│  [Enhanced Prompt] → [Semantic] → [Grounding] → [5-Layer] → [Review UI]   │
│         │                │             │            │            │          │
│         │                │             │            │            │          │
│   From Stage 1      Extract       Validate      Detect       User sees     │
│                   assumptions    against real   patterns,   assumptions,   │
│                   & edge cases   data sources   risks       edge cases     │
│                                                                             │
│  ════════════════════════════════════════════════════════════════════════  │
│  STAGE 3: GENERATION (After Review UI Approval)                            │
│  ════════════════════════════════════════════════════════════════════════  │
│                                                                             │
│  [IR Formalization] → [Compilation] → [Agent Saved] → [Navigate to Agent]  │
│          │                  │               │                │              │
│          │                  │               │                │              │
│    With user's        IR → DSL         Save to DB      Go to agent        │
│    confirmed                                            detail page        │
│    choices                                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## What Changes from Current Flow

| Current Thread-Based Flow | After Integration | Notes |
|-----------------|-------------------|-------|
| Phase 1: Analysis | ✅ Kept as-is | |
| Phase 2: Q&A Chat | ✅ Kept as-is | Basic clarifications |
| Phase 3: Enhanced Prompt | ✅ Kept as-is | User approves plan |
| Input Parameters (separate step) | 🔄 Merged into Review UI | Consolidated |
| Scheduling (separate step) | 🔄 Merged into Review UI | Consolidated |
| Agent Draft Review (separate step) | 🔄 Replaced by Review UI | More comprehensive |
| — | ✨ NEW: Semantic Understanding | Extract assumptions |
| — | ✨ NEW: Grounding | Validate against real data |
| — | ✨ NEW: 5-Layer Detection | Catch what LLM missed |
| — | ✨ NEW: Review & Customize UI | Single comprehensive review |
| Generate Agent | 🔄 Moved after Review UI | Run after all validation |

---

## Why This Integration Works

| Concern | How It's Addressed |
|---------|-------------------|
| **"More steps for user?"** | No - we consolidate multiple steps (input params, schedule, draft review) into ONE Review UI |
| **"Questions section redundant?"** | Mostly empty - Thread-Based Q&A already resolved basic clarifications; only shows grounding-discovered issues |
| **"What does Review UI add?"** | Surfaces hidden assumptions, catches patterns (loop intent), shows edge case handling, validates against real data |
| **"When does compilation happen?"** | AFTER user approves Review UI - no wasted work if user changes something |

---

## The Single UI: Review & Customize Your Agent

**When:** After Grounding + 5-layer detection (Stage 2 of merged flow)
**Input:** Enhanced prompt from Phase 3 (user already approved the plan)
**What:** Final validation before agent creation:
- Remaining questions (if any - usually minimal after Thread-Based Q&A)
- Critical confirmations (from 5-layer detection - catches what LLM missed)
- Assumptions (surfaced and validated by grounding)
- Edge cases (failure handling options)
- Input parameters & schedule (consolidated from current separate steps)

**Purpose:** Single comprehensive review before IR formalization and compilation

### What Gets Surfaced (All Sources Combined)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SOURCES FOR SINGLE UI                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  REMAINING QUESTIONS SECTION (usually minimal):                             │
│  ├── remaining_clarifications[] ─────────► Dropdowns with grounding options │
│  └── grounding-discovered ambiguities ───► Radio buttons                    │
│  Note: Most questions already answered in Phase 2 Q&A                   │
│                                                                             │
│  PLEASE CONFIRM SECTION (catches what LLM missed):                          │
│  ├── Layer 1: Confidence mismatches ─────► MUST answer radio               │
│  ├── Layer 2: Pattern detection ─────────► MUST answer radio               │
│  ├── Layer 5: Business risks ────────────► Warning + confirm               │
│  └── grounding_errors[] ─────────────────► Warning banner                  │
│                                                                             │
│  ASSUMPTIONS SECTION:                                                       │
│  ├── assumptions[] high confidence ──────► Collapsed (validated)           │
│  ├── assumptions[] medium confidence ────► Visible checkboxes              │
│  └── assumptions[] fake validation ──────► MUST CONFIRM (expanded)         │
│                                                                             │
│  EDGE CASES SECTION:                                                        │
│  ├── edge_cases[] ───────────────────────► Dropdowns with handling options │
│  └── inferences[user_overridable] ───────► Toggle on/off                   │
│                                                                             │
│  INPUT PARAMETERS & SCHEDULE SECTION (consolidated):                        │
│  ├── input_parameters[] ─────────────────► Form fields                     │
│  └── schedule_config ────────────────────► Schedule picker                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### UI Design: Single Unified Screen

```
┌────────────────────────────────────────────────────────────────────────────┐
│  📋 Review & Customize Your Agent                                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  📌 High-Qualified Leads (Stage 4) Summary + End-User Email                │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Reads leads from a Google Sheet, filters to Stage = 4, emails you   │ │
│  │ an embedded summary table, and sends one end-user email to the      │ │
│  │ Sales Person email addresses with the same embedded table.          │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  Services: 🔗 google-sheets  📧 google-mail                               │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ❓ REMAINING QUESTIONS (if any)                                           │
│  (only shows questions not resolved in Thread-Based Q&A, enriched by grounding)     │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  ✓ No additional questions - all clarifications resolved in chat          │
│                                                                            │
│  ─ OR (if grounding discovered new ambiguity) ─                           │
│                                                                            │
│  Found multiple "Stage" columns. Which one?                                │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ Stage (Column D)                                             ▼     │   │
│  ├────────────────────────────────────────────────────────────────────┤   │
│  │ 📊 Stage (Column D)  ← Values: 1, 2, 3, 4, 5                       │   │
│  │ 📊 Lead Stage (Column H)  ← Values: New, Qualified, Proposal...    │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ⚠️ PLEASE CONFIRM                                                         │
│  (from 5-layer detection: patterns + risks)                               │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 📨 HOW SHOULD LEADS BE SENT?                                         │ │
│  │                                                                       │ │
│  │ We detected you're grouping by "Sales Person" but sending ONE email. │ │
│  │                                                                       │ │
│  │   ○ ONE email to ALL salespeople                                     │ │
│  │     └─ Everyone sees everyone's leads                                │ │
│  │                                                                       │ │
│  │   ● ONE email PER salesperson ⭐ Recommended                          │ │
│  │     └─ Each person receives only their own leads                     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ 🔒 DATA VISIBILITY (PII detected)                                     │ │
│  │                                                                       │ │
│  │   ● Each salesperson sees ONLY their leads ⭐ Recommended             │ │
│  │   ○ Everyone sees ALL leads (data will be shared)                    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ✓ ASSUMPTIONS                                                  [Expand ▼]│
│  (validated by grounding)                                                  │
│────────────────────────────────────────────────────────────────────────────│
│  3 validated • Click to review                                            │
│                                                                            │
│  ┌ Expanded view ──────────────────────────────────────────────────────┐  │
│  │  ☑ "Stage 4" = exact match on Stage column                          │  │
│  │  ☑ Use "Sales Person Email" column for recipients                   │  │
│  │  ☑ Include all rows regardless of assigned owner                    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  ❓ EDGE CASES                                                             │
│  (what happens when things go wrong)                                       │
│────────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  No Stage 4 leads found:                                                   │
│  [Skip sending email entirely ▼]                                           │
│                                                                            │
│  Salesperson has no email in the sheet:                                    │
│  [Send their leads to me instead ▼]                                        │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                    [Create Agent]          │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Inline Editing Mode

**When:** User clicks "Edit Details" on Intent Confirmation
**Purpose:** Allow modifications without regenerating the entire workflow

### UI Design: Editable Summary

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│  ✏️ Edit Your Agent                                              [Cancel] │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. 📥 Fetch leads from Google Sheets                                      │
│     ┌────────────────────────────────────────────────────────────────────┐│
│     │                                                                     ││
│     │  Source:  [Sales Pipeline 2026 ▼] → ["Leads" tab ▼]                ││
│     │                                                                     ││
│     │  Filter:  [Stage ▼] [= ▼] [4 ✏️]                                   ││
│     │           [+ Add another filter]                                   ││
│     │                                                                     ││
│     └────────────────────────────────────────────────────────────────────┘│
│                                                                            │
│  2. 📧 Send email                                                          │
│     ┌────────────────────────────────────────────────────────────────────┐│
│     │                                                                     ││
│     │  Send:    [One email PER salesperson ▼]                            ││
│     │                                                                     ││
│     │  To:      [Sales Person email field ▼]                             ││
│     │                                                                     ││
│     │  Subject: [Your Stage 4 Leads for Today ✏️___________________]     ││
│     │                                                                     ││
│     │  Include: ☑ Lead Name  ☑ Company  ☑ Stage  ☑ Value  ☐ Notes       ││
│     │           [+ Add field]                                            ││
│     │                                                                     ││
│     └────────────────────────────────────────────────────────────────────┘│
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ASSUMPTIONS                                                               │
│  ─────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  ☑ "Stage 4" means the Stage column equals exactly "4"                    │
│  ☑ Each salesperson should see only their own leads                       │
│  ☑ Use the email in "Sales Person Email" column                           │
│  ☐ Include leads with no sales person assigned                            │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  EDGE CASE HANDLING                                                        │
│  ─────────────────────────────────────────────────────────────────────────│
│                                                                            │
│  When no leads match:        [Skip email entirely ▼]                       │
│  When salesperson has no email: [Send to me instead ▼]                    │
│  When filter returns error:  [Stop and notify me ▼]                       │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│           [Preview Changes]                    [💾 Save & Create Agent]   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Edit Types by Element

| Element | Edit Type | How It Works |
|---------|-----------|--------------|
| Data source | Dropdown | Select from connected sources |
| Filter field | Dropdown | Shows available columns |
| Filter value | Text input | Free text with suggestions |
| Delivery pattern | Dropdown | "One to all" / "One per person" |
| Recipient field | Dropdown | Email-type columns |
| Subject line | Text input | Free text |
| Fields to include | Checkboxes | Add/remove from table |
| Assumptions | Checkboxes | Enable/disable each |
| Edge cases | Dropdown | Pre-defined options |

---

## Complete UI Flow Summary (Thread-Based + Intent Validation)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                      COMPLETE USER JOURNEY                                  │
│                      (Thread-Based Flow + Intent Validation)                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ══════════════════════════════════════════════════════════════════════    │
│  STAGE 1: THREAD-BASED FLOW (Existing)                                  │
│  ══════════════════════════════════════════════════════════════════════    │
│                                                                             │
│  STEP 1: DESCRIBE                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ "Send each salesperson their Stage 4 leads daily"                    │   │
│  │ [Create Agent →]                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  STEP 2: CONNECT (if needed)                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔗 Connect Google Sheets                                             │   │
│  │ 🔗 Connect Gmail                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  STEP 3: Q&A CHAT (Phase 2)                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🤖 "Which Google Sheet contains your leads?"                         │   │
│  │ 👤 "Sales Pipeline 2026"                                             │   │
│  │                                                                       │   │
│  │ 🤖 "What subject line for the emails?"                               │   │
│  │ 👤 "Your Stage 4 Leads for Today"                                    │   │
│  │                                                                       │   │
│  │ 🤖 "Got it! Here's my understanding..."                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       ▼                                                                     │
│  STEP 4: ENHANCED PROMPT APPROVAL (Phase 3)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📝 Here's the plan:                                                  │   │
│  │                                                                       │   │
│  │ "Send a daily email to each salesperson with their Stage 4 leads    │   │
│  │  from Sales Pipeline 2026. Use Sales Person Email for recipients.   │   │
│  │  Subject: Your Stage 4 Leads for Today."                            │   │
│  │                                                                       │   │
│  │ [Looks good! ✓]  [Make changes]                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       │ User approves enhanced prompt                                       │
│       ▼                                                                     │
│  ══════════════════════════════════════════════════════════════════════    │
│  STAGE 2: INTENT VALIDATION (New)                                          │
│  ══════════════════════════════════════════════════════════════════════    │
│       │                                                                     │
│       │  [System processes: Semantic → Grounding → 5-Layer Detection]       │
│       ▼                                                                     │
│  STEP 5: REVIEW & CUSTOMIZE (Single UI - replaces input/schedule/review)   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 📋 Review & Customize Your Agent                                     │   │
│  │                                                                       │   │
│  │ 📌 High-Qualified Leads (Stage 4) Summary + End-User Email          │   │
│  │ "Reads leads from Google Sheet, filters to Stage = 4, emails..."    │   │
│  │                                                                       │   │
│  │ ✓ REMAINING QUESTIONS: None (all resolved in chat)                  │   │
│  │                                                                       │   │
│  │ ⚠️ PLEASE CONFIRM (5-layer detection found these):                   │   │
│  │   ○ ONE email to ALL salespeople                                     │   │
│  │   ● ONE email PER salesperson ⭐ Recommended                          │   │
│  │                                                                       │   │
│  │ ✓ ASSUMPTIONS: 3 validated  [Expand ▼]                               │   │
│  │                                                                       │   │
│  │ ❓ EDGE CASES:                                                        │   │
│  │   • No Stage 4 leads found → [Skip email ▼]                          │   │
│  │   • Salesperson has no email → [Send to me ▼]                        │   │
│  │                                                                       │   │
│  │ 📅 SCHEDULE & SETTINGS:                                              │   │
│  │   • Run: [Daily at 8:00 AM ▼]                                        │   │
│  │   • Notify me: [On failure only ▼]                                   │   │
│  │                                                                       │   │
│  │ [← Back]  [✏️ Edit Details]  [Create Agent]                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│       │                                                                     │
│       │  [System processes: IR Formalization → Compilation → Save]          │
│       ▼                                                                     │
│  ══════════════════════════════════════════════════════════════════════    │
│  STAGE 3: COMPLETION                                                       │
│  ══════════════════════════════════════════════════════════════════════    │
│                                                                             │
│  STEP 6: CREATED ✅                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ✅ Agent Created Successfully!                                        │   │
│  │                                                                       │   │
│  │ "Daily Stage 4 Lead Sender"                                          │   │
│  │                                                                       │   │
│  │ Scheduled: Daily at 8:00 AM                                          │   │
│  │ First run: Tomorrow                                                  │   │
│  │                                                                       │   │
│  │ [Run Now]  [View Agent]  [Create Another]                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### User Touchpoints Summary

| Step | User Action | What Happens |
|------|-------------|--------------|
| 1. Describe | Types raw prompt | System analyzes |
| 2. Connect | Connects services (if needed) | OAuth flow |
| 3. Q&A Chat | Answers clarifying questions | Phase 2 |
| 4. Approve Plan | Reviews enhanced prompt, clicks "Looks good!" | Phase 3 |
| 5. Review & Customize | Confirms patterns, assumptions, edge cases, schedule | **Intent Validation** |
| 6. Done | Views created agent | Navigate to detail |

**Note:** Steps 1-4 are the existing thread-based flow. Step 5 is the new Intent Validation UI that replaces the current separate input parameters, scheduling, and draft review steps.

---

## User Feedback Collection Points

This section describes **exactly when** user feedback is collected and what type of feedback is required.

### Feedback Collection Timeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WHEN IS USER FEEDBACK COLLECTED?                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  STAGE 1: THREAD-BASED FLOW                                                  │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ FEEDBACK POINT 1: Q&A Chat (Phase 2)                                │    │
│  │                                                                      │    │
│  │ WHEN: After analysis, before enhanced prompt                        │    │
│  │ TYPE: Conversational text responses                                 │    │
│  │ MANDATORY: Yes - must answer all questions to proceed               │    │
│  │ UI: Chat interface with text input                                  │    │
│  │                                                                      │    │
│  │ Examples:                                                            │    │
│  │ • "Which Google Sheet?" → User types: "Sales Pipeline 2026"         │    │
│  │ • "What email subject?" → User types: "Your Stage 4 Leads"          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ FEEDBACK POINT 2: Enhanced Prompt Approval (Phase 3)                │    │
│  │                                                                      │    │
│  │ WHEN: After Q&A, before Intent Validation                           │    │
│  │ TYPE: Binary approval (yes/no)                                      │    │
│  │ MANDATORY: Yes - must approve OR request changes                    │    │
│  │ UI: "Looks good!" button OR "Make changes" button                   │    │
│  │                                                                      │    │
│  │ If "Make changes" → returns to Q&A Chat for refinement              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       │ ← User approved enhanced prompt                                      │
│       ▼                                                                      │
│  STAGE 2: INTENT VALIDATION                                                  │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ NO FEEDBACK COLLECTED (System Processing)                           │    │
│  │                                                                      │    │
│  │ • Semantic Understanding → runs automatically                       │    │
│  │ • Grounding → runs automatically                                    │    │
│  │ • 5-Layer Detection → runs automatically                            │    │
│  │                                                                      │    │
│  │ User sees: Loading/progress indicator                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ FEEDBACK POINT 3: Review & Customize UI ⭐ MAIN FEEDBACK POINT       │    │
│  │                                                                      │    │
│  │ WHEN: After 5-Layer Detection completes                             │    │
│  │ TYPE: Structured inputs (see breakdown below)                       │    │
│  │ MANDATORY: Some items required, some optional (see details)         │    │
│  │ UI: Single screen with multiple sections                            │    │
│  │                                                                      │    │
│  │ This is where the 5-layer results are displayed and feedback        │    │
│  │ is collected through structured UI elements.                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       │ ← User clicks "Create Agent"                                         │
│       ▼                                                                      │
│  STAGE 3: GENERATION (No feedback - system processing)                       │
│  ─────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  • IR Formalization → runs with user's choices from Review UI               │
│  • Compilation → runs automatically                                          │
│  • Agent Saved → complete                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Review & Customize UI: Feedback Breakdown

The Review & Customize UI (Feedback Point 3) collects feedback through **structured inputs only** - no open text areas. Here's what requires feedback:

| Section | Feedback Required? | UI Element | Blocks "Create Agent"? |
|---------|-------------------|------------|------------------------|
| **REMAINING QUESTIONS** | **MANDATORY** if present | Dropdown/Radio | YES - must answer all |
| **PLEASE CONFIRM** | **MANDATORY** | Radio buttons | YES - must select option |
| **ASSUMPTIONS** | Optional | Checkboxes | NO - defaults are pre-selected |
| **EDGE CASES** | Optional | Dropdowns | NO - defaults are pre-selected |
| **SCHEDULE & SETTINGS** | Optional | Dropdowns/Pickers | NO - defaults are set |

### Mandatory Feedback Items (Blocks Proceeding)

The "Create Agent" button is **disabled** until these are resolved:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MANDATORY FEEDBACK (Must Answer)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. GROUNDING-DISCOVERED AMBIGUITIES                                         │
│     ─────────────────────────────────────────────────────────────────────── │
│     Source: Grounding found multiple matches or unclear references           │
│     UI: Dropdown with discovered options                                     │
│     Example: "Found 2 'Stage' columns - which one?"                          │
│              → [Stage (Column D)] [Lead Stage (Column H)]                    │
│                                                                              │
│  2. PLEASE CONFIRM ITEMS (from 5-Layer Detection)                            │
│     ─────────────────────────────────────────────────────────────────────── │
│     Source: 5-layer detection found patterns, risks, or conflicts            │
│     UI: Radio buttons (must select one)                                      │
│     Examples:                                                                │
│     • Loop intent: "One email to ALL" vs "One email PER person"             │
│     • PII risk: "Each sees only their data" vs "Everyone sees all"          │
│     • Confidence mismatch: Fake validation detected → must confirm          │
│                                                                              │
│  3. FAKE VALIDATION WARNINGS                                                 │
│     ─────────────────────────────────────────────────────────────────────── │
│     Source: Grounding returned "not implemented" but LLM claimed valid       │
│     UI: Expanded assumption with "I understand" checkbox                     │
│     Example: "Column validation not available - confirm this is correct?"   │
│              → [ ] I confirm this assumption is correct                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Optional Feedback Items (Defaults Pre-Selected)

These have reasonable defaults and don't block the user:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OPTIONAL FEEDBACK (Has Defaults)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. ASSUMPTIONS (High Confidence)                                            │
│     ─────────────────────────────────────────────────────────────────────── │
│     Default: Pre-checked (validated by grounding)                            │
│     UI: Collapsed section with expandable checkboxes                         │
│     User can: Uncheck to disable an assumption                               │
│                                                                              │
│  2. EDGE CASES                                                               │
│     ─────────────────────────────────────────────────────────────────────── │
│     Default: System-recommended option pre-selected                          │
│     UI: Dropdowns with handling options                                      │
│     User can: Change to different handling strategy                          │
│                                                                              │
│  3. SCHEDULE & SETTINGS                                                      │
│     ─────────────────────────────────────────────────────────────────────── │
│     Default: Inferred from prompt or system defaults                         │
│     UI: Schedule picker, notification toggles                                │
│     User can: Modify schedule, change notification preferences               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Summary: Feedback Flow

```
User Journey:

  Q&A Chat ──────────► Approve Plan ──────────► Review & Customize ──────────► Done
      │                     │                          │
      │                     │                          │
      ▼                     ▼                          ▼
  FEEDBACK 1            FEEDBACK 2                 FEEDBACK 3
  (Text chat)           (Yes/No)                   (Structured)
  MANDATORY             MANDATORY                  MIXED
                                                   │
                                                   ├── Mandatory: Ambiguities, Confirmations
                                                   └── Optional: Assumptions, Edge Cases, Schedule
```

**Key Insight:** After the enhanced prompt approval (Feedback Point 2), the user's next and final interaction is the Review & Customize UI (Feedback Point 3). This is where all the 5-layer detection results are displayed and user feedback is collected before agent creation.

---

## What Gets Caught in the Single UI

The unified "Review & Customize" screen catches everything in one place. Since the Thread-Based Q&A (Phase 2) already resolved basic clarifications, this UI focuses on **validation and confirmation** rather than basic questions.

### Remaining Questions Section (Usually Minimal)

**Source:** `remaining_clarifications[]` - questions that couldn't be resolved in Thread-Based Q&A, enriched by grounding

**Why minimal?** The Thread-Based Q&A already asked basic clarifying questions like "Which sheet?" and "What subject line?" Those answers are now part of the enhanced prompt.

**What shows here:** Only questions discovered during grounding that couldn't be anticipated earlier:

| Example | Why It's Asked | When It Appears |
|---------|----------------|-----------------|
| "Found 2 'Stage' columns - which one?" | Grounding discovered ambiguity | Grounding found multiple matches |
| "Email column has 5 empty rows - continue?" | Data quality issue | Grounding validated data |
| "Sheet has 10,000 rows - limit?" | Performance concern | Grounding checked data size |

**UI Pattern:** Often shows "✓ No additional questions" - only shows dropdowns when grounding discovered new ambiguities

### Please Confirm Section (LLM's Unknown Unknowns)

**Source:** 5-layer ambiguity detection

| Example | Detection Layer |
|---------|-----------------|
| "One email to all" vs "per person" | Layer 2: Loop intent pattern |
| Fake validation (confidence: 0.7) | Layer 1: Confidence mismatch |
| PII exposure risk | Layer 5: Business logic |
| "Recent" without timeframe | Layer 4: Vague language |
| Contradicting assumptions | Layer 3: Cross-assumption conflicts |

**UI Pattern:** Radio buttons with recommendations, must answer before proceeding

### Assumptions Section (Validated by Grounding)

**Source:** `assumptions[]` validated against real data

| Confidence | Display |
|------------|---------|
| High + validated | Collapsed (click to expand) |
| Medium confidence | Visible checkboxes |
| Fake validation detected | MUST CONFIRM (expanded) |

**UI Pattern:** Checkboxes, collapsed by default if validated

### Edge Cases Section

**Source:** `edge_cases[]` from semantic plan

| Example | UI |
|---------|----|
| No leads → send empty email? | Dropdown: Skip / Send anyway / Notify me |
| Missing email field | Dropdown: Skip row / Send to me / Stop agent |

**UI Pattern:** Dropdowns with pre-defined handling options

---

## Data Model: What Flows Through the Pipeline

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// INPUT: Enhanced Prompt from Phase 3 (user already approved)
// ═══════════════════════════════════════════════════════════════════════════

interface EnhancedPromptInput {
  plan_title: string;                         // "High-Qualified Leads (Stage 4) Summary + End-User Email"
  plan_description: string;                   // Summary of what agent does
  sections: {
    data: string[];                           // Data source specifications
    actions: string[];                        // What to do with the data
    output: string[];                         // What to produce
    delivery: string[];                       // How to deliver results
    processing_steps: string[];               // Step-by-step breakdown
  };
  specifics: {
    services_involved: string[];              // e.g., ["google-sheets", "google-mail"]
    user_inputs_required: string[];           // Remaining inputs needed (may be empty)
    resolved_user_inputs: ResolvedInput[];    // Answers from Thread-Based Q&A
  };
}

interface ResolvedInput {
  key: string;                                // e.g., "spreadsheet_id", "user_email"
  value: string;                              // The user's answer
}

// Example resolved_user_inputs:
// [
//   { "key": "user_email", "value": "eomer3@gmail.com" },
//   { "key": "spreadsheet_id", "value": "1pM8WbX..." },
//   { "key": "sheet_tab_name", "value": "Leads" },
//   { "key": "high_qualified_rule", "value": "Stage column = 4" },
//   { "key": "recipient_email_column", "value": "Sales Person" },
//   { "key": "end_user_email_subject", "value": "High-qualified leads (Stage 4) :" },
//   { "key": "no_results_behavior", "value": "email user 'none found'" }
// ]

// ═══════════════════════════════════════════════════════════════════════════
// INTENT VALIDATION PIPELINE OUTPUTS
// ═══════════════════════════════════════════════════════════════════════════

// After Intent Validation Phase 1 (Semantic Understanding)
interface SemanticUnderstandingOutput {
  understanding: Understanding;
  remaining_clarifications: string[];         // Usually empty - Thread-Based Q&A handled most
  assumptions: Assumption[];                  // → Review UI checkboxes
  inferences: Inference[];                    // → Review UI toggles
  edge_cases: EdgeCase[];                     // → Review UI dropdowns
}

// After Intent Validation Phase 2 (Grounding)
interface GroundingOutput {
  grounding_results: GroundingResult[];
  grounding_errors: GroundingError[];         // → Review UI warnings
  validated_assumptions: ValidatedAssumption[];
  grounding_discovered_ambiguities: Ambiguity[]; // New questions from grounding
  overall_confidence: number;                 // < 0.8 → show warning
}

// After 5-Layer Detection
interface AmbiguityReport {
  must_confirm: MustConfirmItem[];            // → Review UI PLEASE CONFIRM section
  should_review: ShouldReviewItem[];          // → Review UI expanded assumptions
  looks_good: LooksGoodItem[];                // → Review UI collapsed
  overall_confidence: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW UI COLLECTS USER DECISIONS
// ═══════════════════════════════════════════════════════════════════════════

interface ReviewUIDecisions {
  confirmed_patterns: Record<string, string>;  // e.g., { "delivery": "per_person" }
  approved_assumptions: string[];              // IDs of approved assumptions
  edge_case_handling: Record<string, string>;  // e.g., { "no_leads": "skip" }
  schedule_config: ScheduleConfig;             // Consolidated from current flow
  input_parameters: Record<string, any>;       // Consolidated from current flow
}

// ═══════════════════════════════════════════════════════════════════════════
// AFTER USER APPROVES REVIEW UI
// ═══════════════════════════════════════════════════════════════════════════

// After Intent Validation Phase 3 (IR Formalization) - runs after Review UI approval
interface IRFormalizationOutput {
  ir: DeclarativeLogicalIR;
  user_constraints: ReviewUIDecisions;        // User's choices from Review UI
  edge_cases: IREdgeCase[];
  delivery_rules: DeliveryRules;
}

// After Intent Validation Phase 4 (Compilation)
interface CompilationOutput {
  workflow: CompiledWorkflow;
  steps: WorkflowStep[];
  error_handlers: ErrorHandler[];
}
```

---

## Priority Ordering in Intent Confirmation

Items are shown in this order:

```
1. ⚠️ CRITICAL (Must Confirm)
   ├── Fake validations (behavior with "not implemented")
   ├── Pattern-detected issues (loop intent, data visibility)
   ├── Business logic risks (PII, irreversible actions)
   └── Grounding errors

2. 📝 SHOULD REVIEW (Visible, pre-checked)
   ├── Medium confidence assumptions
   ├── Vague language detected
   └── Cross-assumption conflicts

3. ✓ LOOKS GOOD (Collapsed)
   └── High confidence + validated assumptions

4. ❓ EDGE CASES (Always shown)
   ├── Empty result handling
   ├── Missing data handling
   └── Error scenarios
```

---

## Summary: Merged Thread-Based + Intent Validation Flow

### Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  THREAD-BASED (Existing)      │  INTENT VALIDATION (New)                    │
├───────────────────────────────┼─────────────────────────────────────────────┤
│  Raw Prompt                   │                                             │
│       ↓                       │                                             │
│  Phase 1: Analysis            │                                             │
│       ↓                       │                                             │
│  Phase 2: Q&A Chat            │                                             │
│       ↓                       │                                             │
│  Phase 3: Enhanced Prompt     │                                             │
│       ↓                       │                                             │
│  User Approves ───────────────┼──→ Semantic Understanding                   │
│                               │         ↓                                   │
│                               │    Grounding                                │
│                               │         ↓                                   │
│                               │    5-Layer Detection                        │
│                               │         ↓                                   │
│                               │    Review & Customize UI                    │
│                               │         ↓                                   │
│                               │    IR Formalization                         │
│                               │         ↓                                   │
│                               │    Compilation                              │
│                               │         ↓                                   │
│                               │    Agent Saved ✅                            │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### What Each Section Catches

| Section | Source | What It Catches |
|---------|--------|-----------------|
| **Remaining Questions** | Grounding-discovered ambiguities | Issues not anticipated in Thread-Based Q&A (usually empty) |
| **Please Confirm** | 5-layer detection | What LLM missed: patterns, risks, conflicts |
| **Assumptions** | `assumptions[]` + grounding | Validated beliefs, fake validations exposed |
| **Edge Cases** | `edge_cases[]` | Failure handling options |
| **Schedule & Settings** | Consolidated from current flow | Input params + schedule in one place |

### Key Benefits of This Integration

1. **No duplicate questions** - Thread-Based Q&A handles basic clarifications; Review UI handles validation
2. **Real data validation** - Grounding checks assumptions against actual connected data
3. **Catches what LLM missed** - 5-layer detection finds patterns, risks, conflicts
4. **Consolidates steps** - Replaces separate input params, scheduling, and draft review
5. **No wasted work** - IR formalization and compilation happen AFTER user approval

### What Changes for Users

| Before (Current) | After (With Intent Validation) |
|------------------|--------------------------------|
| Q&A Chat → Approve Plan → Input Params → Schedule → Draft Review → Create | Q&A Chat → Approve Plan → **Review & Customize** → Create |
| 5 interaction points after plan | 1 interaction point after plan |
| Assumptions hidden | Assumptions surfaced |
| Edge cases not shown | Edge cases with handling options |
| Patterns not detected | 5-layer detection catches issues |

**Result:** Intent mismatches caught **before** IR formalization or compilation begins. Users see everything in one comprehensive review screen.
