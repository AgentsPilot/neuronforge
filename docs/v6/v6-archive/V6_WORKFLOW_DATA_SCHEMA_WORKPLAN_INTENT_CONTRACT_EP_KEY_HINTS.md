# V6 Workflow Data Schema — Enhanced Prompt Key Hints for IntentContract

> **Status**: In Progress — Phases 1-4 Complete, Phase 5 (E2E Testing) Pending
> **Date**: 2026-03-15
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplan**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md)
> **Addresses**: O8 (Config value validation — user-provided config values may contain invalid plugin-native syntax)

---

## Problem Statement

O8 from the parent workplan identifies a gap: **user-provided config values reach plugins as raw natural language** instead of plugin-native syntax.

Example — the user says *"find invoices and expense bills with PDF attachments from the last 24 hours"*. This becomes:

```json
"resolved_user_inputs": [
  { "key": "email_filter_criteria", "value": "invoices, expenses, bills with PDF attachments" },
  { "key": "scan_time_window", "value": "last 24 hours" }
]
```

These values eventually flow to the Gmail `search_emails` action's `query` parameter, which expects Gmail search syntax: `subject:(Invoice OR Expenses OR Bill) has:attachment filename:pdf newer_than:1d`. Four problems:

1. **No plugin association** — the key `email_filter_criteria` has no signal telling the V6 Phase 1 LLM which plugin or action it relates to.
2. **No syntax translation** — even if the association were known, nothing translates the natural-language value to plugin-native syntax.
3. **No value composition** — related inputs (`email_filter_criteria` + `scan_time_window`) should compose into a single `query` parameter, but they exist as independent config entries.
4. **No parameter-level awareness** — the thread-based LLM (Phases 2-3) doesn't see parameter types or constraints when asking clarification questions. It doesn't know that Google Sheets `range` expects a **single** sheet tab name (string), so it accepts `"Invoices, Expenses"` as two candidates instead of asking the user to pick one. This results in missing or ambiguous config values that the Phase 1 LLM cannot resolve (e.g., `sheet_tab_name` declared with no default).

---

## Root Cause Analysis

### The Data Flow

```
Thread-Based Enhanced Prompt Flow (OpenAI Thread, Phases 1-3)
    Phase 2: Asks clarification questions ("What emails?", "What time window?")
    Phase 3: Produces resolved_user_inputs with generic keys
        ↓
V6 Pipeline Phase 1: IntentContract Generation (LLM)
    Receives resolved_user_inputs via buildVocabularyInjection()
    Must map generic keys to plugin parameters
    Must translate values to plugin-native syntax
        ↓
V6 Pipeline Phases 2-4: Deterministic binding, IR, compilation
    Config values reach plugins as-is
```

### Why the V6 Phase 1 LLM Struggles

The Phase 1 LLM receives two pieces of information **separately** with no instruction to connect them:

**From vocabulary (O6):** Plugin parameter definitions with syntax hints:
```
* query: string — Search query (supports Gmail search operators like 'from:', 'subject:', 'in:', etc.)
```

**From enhanced prompt:** User-provided values with generic keys:
```
- email_filter_criteria: "invoices, expenses, bills with PDF attachments"
- scan_time_window: "last 24 hours"
```

The LLM must make **three inference leaps** with no explicit signal:
1. Which plugin does `email_filter_criteria` belong to? (Gmail)
2. Which parameter does it map to? (`query`)
3. How to translate the value to native syntax + compose with `scan_time_window`

Meanwhile, the thread-based LLM (upstream) lacks parameter-level detail, so it cannot constrain user answers to match parameter types — producing multi-value answers where single values are needed.

---

## Design: Plugin-Capability Key Prefixes from Enhanced Prompt

### Core Idea

Teach the thread-based enhanced prompt flow (Phases 2-3) to prefix `resolved_user_inputs` keys with `{plugin}__{capability}__`, creating explicit associations between user values and target plugin actions.

Instead of:
```json
{ "key": "email_filter_criteria", "value": "invoices, expenses, bills with PDF attachments" }
{ "key": "scan_time_window", "value": "last 24 hours" }
{ "key": "recipient_email", "value": "boss@company.com" }
{ "key": "target_sheet_name", "value": "Monthly Report" }
```

The enhanced prompt produces:
```json
{ "key": "gmail__search__filter_criteria", "value": "invoices, expenses, bills with PDF attachments" }
{ "key": "gmail__search__time_window", "value": "last 24 hours" }
{ "key": "gmail__send__recipient", "value": "boss@company.com" }
{ "key": "google_sheets__create__sheet_name", "value": "Monthly Report" }
```

### Key Format Convention

```
{plugin_key}__{capability}__{param_name}
```

- `plugin_key` — from connected plugins (e.g., `gmail`, `google_sheets`, `slack`)
- `capability` — the action's capability string from the plugin definition (e.g., `search`, `send_message`, `create`)
- `param_name` — descriptive, machine-friendly name for the value
- Delimiter: double underscore `__` (unambiguous — plugin keys use single `_`, capability names use single `_`)

### Handling Same Plugin Used Twice

When a workflow uses the same plugin for multiple actions (e.g., Gmail for search + send), the capability segment disambiguates:

```json
{ "key": "gmail__search__filter_criteria", "value": "invoices with PDF attachments" }
{ "key": "gmail__search__time_window", "value": "last 24 hours" }
{ "key": "gmail__send_message__recipient", "value": "boss@company.com" }
{ "key": "gmail__send_message__subject", "value": "Daily Invoice Summary" }
```

The V6 Phase 1 LLM instantly knows `gmail__search__*` keys relate to the search step and `gmail__send_message__*` keys relate to the send step.

### Why This Requires an Action Summary in the Thread-Based Prompt

**Today**, the thread-based flow (Phases 1-3) receives plugin info via `toShortLLMContext()`:

```typescript
// IPluginContext — what the thread-based LLM sees today
{
  key: "google_mail",
  displayName: "Gmail",
  context: "Use for all Gmail email-related tasks...",
  category: "email",
  capabilities: ["search_emails", "send_email", "read_email", "create_draft", "download_attachment"]
}
```

It sees **action names** (via `getActionNames()`) but **not** their domain/capability pairs or descriptions. The LLM cannot produce `gmail__search__` prefixes if it doesn't know that `search_emails` maps to capability `search`.

**We need to inject a compact action summary** into the thread-based flow — just enough for the LLM to associate each clarification answer with a specific plugin + capability pair.

### Proposed Action Summary Format

A lightweight structure added to the `available_services` context, scoped to `connected_services` only. Each action includes its **key input parameters** with types so the thread-based LLM can constrain clarification questions to match parameter expectations:

```
PLUGIN ACTION REFERENCE:
- google_mail (gmail):
    search_emails [email/search]: Search for emails in the user's Gmail account
      params: query (string), max_results (number), include_attachments (boolean)
    send_email [email/send_message]: Send an email from the user's Gmail account
      params: to (string[]), subject (string), html_body (string)
    read_email [email/read]: Read a specific email by ID
      params: message_id (string)
    create_draft [email/create_draft]: Create an email draft
      params: to (string[]), subject (string), body (string)
    download_attachment [email/download]: Download email attachments
      params: message_id (string), attachment_id (string)
- google_sheets (google_sheets):
    append_rows [table/create]: Append rows to a Google Sheet
      params: spreadsheet_id (string), range (string — single sheet tab name), values (array)
    read_sheet [table/read]: Read data from a Google Sheet
      params: spreadsheet_id (string), range (string — single sheet tab name or cell range)
- google_drive (google_drive):
    get_or_create_folder [storage/create]: Get or create a folder in Google Drive
      params: folder_name (string), parent_folder_id (string)
    upload_file [storage/upload]: Upload a file to Google Drive
      params: file_content (string), file_name (string), folder_id (string)
```

Each action line: `{action_name} [{domain}/{capability}]: {description}`
Each params line: key input parameters with types and constraints

**Why include parameters:** The thread-based LLM uses parameter types to constrain clarification answers. For example, seeing `range (string — single sheet tab name)` tells the LLM to ask *"Which sheet tab?"* (expecting one value) rather than *"What sheet names?"* (accepting a list). This prevents ambiguous multi-value answers that downstream phases cannot resolve.

**Token cost:** ~50-80 tokens per plugin (including params). For 3-4 plugins, this adds ~200-300 tokens — still negligible in the context of a multi-phase thread.

---

## Why This Approach (Design Decision Record)

### Options Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A: Plugin-capability key prefixes from enhanced prompt** | Thread-based LLM prefixes `resolved_user_inputs` keys with `plugin__capability__`. Requires injecting action summary into thread context. | **Selected** |
| **B: Deterministic post-processing mapper** | After Phase 3, a deterministic step renames generic keys to prefixed format using pattern matching. | **Rejected** — mapping `email_filter_criteria` → `gmail__search__query` requires semantic understanding. Keyword heuristics are fragile; an LLM call defeats the purpose. |
| **C: Per-plugin query builders** | Post-compilation deterministic transform per plugin that converts semantic intent to native syntax. | **Deferred** — correct but high effort (one builder per plugin). May complement Option A later. |
| **D: Phase 1 LLM does all the work** | Rely entirely on the V6 Phase 1 LLM to match and translate using vocabulary hints. | **Rejected alone** — three inference leaps with no explicit signal makes this unreliable. Works well as a complement to Option A. |

### Why Option A Wins

1. **The thread-based LLM already has the semantic context** — it's actively reasoning about *"the user wants to search Gmail for invoices"* while generating Phase 2 questions and Phase 3 outputs. The plugin+capability association is already implicit in its reasoning; we just need to encode it in the key name.

2. **Reduces Phase 1 LLM cognitive load** — instead of three inference leaps (which plugin? which action? translate value), the Phase 1 LLM only needs to do one: translate the value to native syntax. The prefix gives the plugin+action association for free.

3. **Enables value translation without plugin changes** — once the Phase 1 LLM sees `gmail__search__filter_criteria: "invoices with PDF"` alongside the vocabulary entry `query: string — Gmail search syntax`, a prompt instruction is sufficient to trigger translation and composition. No new `examples` or `syntax_guide` fields needed on plugin definitions — the existing vocabulary descriptions carry the necessary syntax hints.

4. **Low implementation cost** — action summaries are already available in plugin definitions. The thread-based prompt (v13) needs a new section + updated `resolved_user_inputs` rules. No new infrastructure.

5. **Backward compatible** — existing `resolved_user_inputs` without prefixes continue to work. The V6 pipeline can check for `__` delimiters and fall back to current behavior for non-prefixed keys.

### Value Translation — No Plugin Changes Required

Option A solves the **association problem** (which config belongs to which plugin action). The **value translation problem** (natural language → plugin-native syntax) is solved by leveraging what already exists:

The vocabulary extraction (O6) already surfaces parameter descriptions with syntax hints:
```
* query: string — Search query (supports Gmail search operators like 'from:', 'subject:', 'in:', etc.)
```

Once the prefix tells the Phase 1 LLM *which* parameter a config maps to, a prompt instruction is sufficient to trigger translation — no `examples` or `syntax_guide` fields needed on plugin definitions. If a specific plugin parameter has a weak description, the fix is to improve that description, not to add new infrastructure.

The translation and composition rules are implemented in Phase 3 (section 3b) below.

### Value Composition

Related config entries under the same `plugin__capability__` prefix may need to compose into a single plugin parameter. For example:
- `gmail__search__filter_criteria` + `gmail__search__time_window` → single `query` parameter with value `subject:(Invoice OR Bill) has:attachment filename:pdf newer_than:1d`

The grouping provided by the prefix makes this visible to the Phase 1 LLM. An explicit composition instruction in the Phase 1 prompt (Phase 3, section 3b) ensures the LLM acts on it.

### Scope

O8 addresses four sub-problems via the action summary + key prefix approach:

1. **Association** — which config → which plugin action (solved by `plugin__capability__` prefix)
2. **Translation** — natural language → plugin-native syntax (solved by Phase 1 prompt rule + vocabulary descriptions)
3. **Composition** — multiple related inputs → single parameter (solved by Phase 1 prompt rule + grouping)
4. **Parameter-aware questions** — preventing ambiguous/multi-value answers upstream (solved by including key parameter hints with types in the action summary, so the thread-based LLM constrains clarification questions to match expected parameter formats)

Sub-problem 4 specifically prevents cases like `sheet_tab_name` — where the thread-based LLM accepted two candidates (`"Invoices, Expenses"`) instead of asking for a single concrete value, resulting in a missing config downstream.

---

## Current State — What Exists Today

| Component | Current State | What Changes |
|-----------|---------------|--------------|
| **V6 vocabulary injection** (`buildVocabularyInjection()` in `intent-system-prompt-v2.ts`) | Displays `resolved_user_inputs` under "USER CONFIGURATION" with key/value pairs. No prefix-aware parsing. | Parse `plugin__capability__` prefixes to group configs under target actions. Add translation, composition, and config key rules. **(Phase 1)** |
| **Plugin context in thread** (`toShortLLMContext()` in `PluginDefinitionContext`) | Returns `key`, `displayName`, `context`, `category`, `capabilities` (action names only). No domain/capability pairs. No action descriptions. No parameter types. | Add `toActionSummaryContext()` with domain/capability pairs, descriptions, and key parameter hints. **(Phase 2)** |
| **process-message route** (`app/api/agent-creation/process-message/route.ts`) | Passes `available_services` as `toShortLLMContext()` output. Builds user message per phase. | Include enriched action summary in Phase 1-3 messages. **(Phase 3)** |
| **Thread system prompt** (`Workflow-Agent-Creation-Prompt-v13-chatgpt.txt`) | Produces generic `resolved_user_inputs` keys (e.g., `email_filter_criteria`). No awareness of domain/capability pairs. | New key naming rules with `plugin__capability__` prefix. Parameter-aware clarification questions. **(Phase 4)** |
| **Phase 3 validation** (`phase3-schema.ts`) | Validates `resolved_user_inputs` as `[{ key: string, value: string }]`. | No schema change needed — keys are still strings. |

---

## Implementation Workplan

> **Implementation strategy:** Consumer-first. We build and test the V6 pipeline's ability to consume prefixed keys (Phase 1) before building the producer that generates them (Phases 2-4). This lets us validate the V6 side with simulated prefixed inputs before touching the thread-based flow.

### Phase 1: Update V6 Vocabulary Injection to Parse Prefixed Keys

**Goal:** Make `buildVocabularyInjection()` prefix-aware so the Phase 1 LLM sees configs grouped by plugin action. Add translation and composition prompt rules.

**File:** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`

**Why first:** This is the consumer of prefixed keys. We can test it immediately by providing simulated prefixed `resolved_user_inputs` in the existing test script — no thread-based flow changes needed yet.

**Changes:** See Phase 3 (V6 Vocabulary Injection) section below for full details (sections 3a, 3b, 3c).

**Validation:** Update `scripts/test-complete-pipeline-with-vocabulary.ts` to use prefixed `resolved_user_inputs` keys. Run the pipeline and verify:
- Grouped display in vocabulary injection output
- Phase 1 LLM produces correct clean config keys
- Phase 1 LLM translates values to plugin-native syntax
- Phase 1 LLM composes related entries into single parameters

**Status:** ✅ Done (2026-03-16)

**Implementation Notes:**
- `buildVocabularyInjection()` refactored into three functions: dispatcher (prefix detection), `buildGroupedUserContext()` (prefixed path), `buildFlatUserContext()` (backward-compatible path)
- `parsePrefixedKey()` helper parses `plugin__capability__param` format, handles edge cases (param names containing `__`)
- Grouped path renders 3 rules (CONFIG KEY, VALUE TRANSLATION, VALUE COMPOSITION) + grouped display
- Flat path preserves original O7 behavior with `CRITICAL CONFIG KEY RULE`
- Validated with `scripts/test-ep-key-hints-validation.ts` (3 tests: prefixed, non-prefixed, mixed)
- Test JSON (`scripts/test-intent-contract-generation-enhanced-prompt.json`) updated with prefixed keys

---

### Phase 2: Enrich Plugin Context for Thread-Based Flow

**Goal:** Give the thread-based LLM visibility into plugin action domain/capability pairs, descriptions, and key parameter hints.

**File:** `lib/types/plugin-definition-context.ts`

**Changes:**
- Add new method `toActionSummaryContext()` to `PluginDefinitionContext` that returns a compact action summary with key parameter hints:
  ```typescript
  interface ActionParamHint {
    name: string              // e.g., "query", "range"
    type: string              // e.g., "string", "number", "string[]"
    constraint?: string       // e.g., "single sheet tab name" — optional human-readable constraint
  }

  interface ActionSummaryEntry {
    action_name: string       // e.g., "search_emails"
    domain: string            // e.g., "email"
    capability: string        // e.g., "search"
    description: string       // e.g., "Search for emails in the user's Gmail account"
    key_params: ActionParamHint[]  // key input parameters with types
  }

  interface PluginActionSummary {
    key: string               // e.g., "google_mail"
    displayName: string       // e.g., "Gmail"
    actions: ActionSummaryEntry[]
  }
  ```
- Extract `domain` and `capability` from each `ActionDefinition` in the plugin definition
- Extract key input parameters from each action's `input_schema` — include `name`, `type`, and an optional `constraint` derived from the parameter description (e.g., `"single sheet tab name"` from `"Sheet tab name or cell range"`)
- Include only actions that have both `domain` and `capability` defined
- Limit to **required + commonly-used** parameters per action (cap at ~5) to keep token cost manageable

**Status:** ✅ Done (2026-03-16)

**Implementation Notes:**
- Added `toActionSummaryContext()` (structured) and `toActionSummaryText()` (formatted text) to `PluginDefinitionContext`
- Exported `ActionParamHint`, `ActionSummaryEntry`, `PluginActionSummary` interfaces
- Parameters sorted required-first, capped at 5 per action
- Constraints extracted from description parentheticals or enum values
- Validated with `scripts/test-action-summary.ts` against Gmail, Sheets, Drive plugins

---

### Phase 3: Inject Action Summary into Thread-Based Flow

**Goal:** Pass action summary to the thread-based LLM alongside existing `available_services`.

**File:** `app/api/agent-creation/process-message/route.ts`

**Changes:**
- After building `user_available_services` (line ~198-215), also build action summaries for connected plugins
- Add action summary as a new field in the Phase 1 user message:
  ```typescript
  userMessage = {
    phase: 1,
    user_prompt,
    user_context: mergedUserContext,
    analysis: null,
    connected_services: user_connected_services,
    available_services: user_available_services,
    plugin_action_summary: actionSummaries  // NEW
  };
  ```
- Include `plugin_action_summary` in Phase 2 and Phase 3 messages as well, so the LLM has consistent context across all phases

**Status:** ✅ Done (2026-03-16)

**Implementation Notes:**
- Added `plugin_action_summary_text` variable built from connected plugins' `toActionSummaryText()`
- Scoped to `user_connected_services` only (not all available plugins) for token efficiency
- Injected into Phase 1, 2, and 3 user messages as `plugin_action_summary` field

---

### Phase 4: Update Thread System Prompt (v14)

**Goal:** Teach the thread-based LLM to use `plugin__capability__` prefixed keys in `resolved_user_inputs`, and to ask parameter-aware clarification questions.

**File:** `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v13-chatgpt.txt` → create `v14` version

**Changes:**

**4a. Add action summary awareness section:**
```
## PLUGIN ACTION REFERENCE

When `plugin_action_summary` is provided in the input, it maps each connected plugin
to its available actions with domain/capability pairs:

  {action_name} [{domain}/{capability}]: {description}

Use these domain/capability pairs when prefixing resolved_user_inputs keys (see below).
```

**4b. Update `resolved_user_inputs` key naming rules in Phase 3:**

Current rule (v13):
```
For each label removed, append an entry to resolved_user_inputs:
  { "key": "<machine_friendly_key>", "value": "<resolved_value>" }
```

New rule (v14):
```
For each label removed, append an entry to resolved_user_inputs with a
plugin-capability-prefixed key:

  { "key": "{plugin_key}__{capability}__{param_name}", "value": "<resolved_value>" }

Where:
- {plugin_key} is the plugin's key from connected_services (e.g., "gmail", "google_sheets")
- {capability} is the action's capability string from plugin_action_summary (e.g., "search", "send_message", "create")
- {param_name} is a machine-friendly name for the value (e.g., "filter_criteria", "recipient")
- Use double underscore (__) as delimiter

Examples:
  { "key": "gmail__search__filter_criteria", "value": "invoices with PDF attachments" }
  { "key": "gmail__search__time_window", "value": "last 24 hours" }
  { "key": "gmail__send_message__recipient", "value": "boss@company.com" }
  { "key": "google_sheets__create__sheet_name", "value": "Monthly Report" }

If the same plugin is used for multiple actions (e.g., Gmail for search AND send),
use the specific capability to disambiguate which action each config relates to.

For resource identifiers (folder names, sheet names, tab names), use the capability
of the action that will consume them:
  { "key": "google_sheets__read__sheet_name", "value": "Master Customer Tracker" }
  { "key": "google_sheets__read__tab_name", "value": "Active Customers" }
  { "key": "google_drive__search__folder_name", "value": "New Onboarding Docs" }

If plugin_action_summary is not available (backward compatibility), fall back to
the current generic key format: { "key": "<machine_friendly_key>", "value": "..." }
```

**4c. Update Phase 2 clarification question generation:**

Add guidance for the LLM to frame clarification questions with awareness of which plugin action and parameter type they relate to. This improves question quality, prevents ambiguous multi-value answers, and makes it easier to assign the correct prefix when the answer is resolved:

```
When generating clarification questions:
1. Consider which plugin action the answer will feed into — this helps you
   assign the correct plugin__capability__ prefix when resolving in Phase 3.
2. Use the parameter types from plugin_action_summary to constrain the expected
   answer format. For example:
   - If a parameter is "string" (single value), ask for ONE specific value,
     not a list of candidates.
   - If a parameter is "string[]" (array), a list is acceptable.
   - If a parameter has a constraint (e.g., "single sheet tab name"),
     phrase the question to elicit that specific format.

Example:
  BAD:  "What sheet names would you like to use?" → "Invoices, Expenses" (ambiguous)
  GOOD: "Which single sheet tab should rows be appended to?" → "Invoices" (concrete)
```

**4d. Update all examples in the prompt template** to use prefixed keys.

**4e. Update init-thread route** to reference the new v14 prompt template:
```typescript
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v14-chatgpt";
```

**Status:** ✅ Done (2026-03-16)

**Implementation Notes:**
- Created `Workflow-Agent-Creation-Prompt-v14-chatgpt.txt` from v13 base
- Added "Plugin Action Reference (EP Key Hints)" section with `plugin_action_summary` awareness
- Added "resolved_user_inputs Key Naming" section with `plugin__capability__param` prefix rules + examples + fallback
- Updated Phase 2 behavior rules with parameter-aware question guidance (BAD/GOOD examples)
- Updated Phase 3 resolved_user_inputs rules to reference prefix naming section
- Updated all resource identifier examples to show prefixed keys when `plugin_action_summary` available
- Updated `init-thread/route.ts` to reference v14 template

---

### Phase 1 Detail: V6 Vocabulary Injection Changes

> This section provides the full specification for Phase 1 above.

**File:** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`

**Changes:**

**1a. Parse `plugin__capability__` prefixes** in the user context section of `buildVocabularyInjection()`:

Current output:
```
**USER CONFIGURATION (resolved inputs):**
**Other Configuration Values:**
  - email_filter_criteria: invoices, expenses, bills with PDF attachments
  - scan_time_window: last 24 hours
  - recipient_email: boss@company.com
```

New output (when prefixed keys detected):
```
**USER CONFIGURATION (resolved inputs, grouped by plugin action):**

  gmail / search:
    - filter_criteria: "invoices, expenses, bills with PDF attachments"
    - time_window: "last 24 hours"

  gmail / send_message:
    - recipient: "boss@company.com"
    - subject: "Daily Invoice Summary"

  google_sheets / create:
    - sheet_name: "Monthly Report"
```

**1b. Update Phase 1 LLM instructions** — add three rules for the Phase 1 LLM when processing grouped configs:

**Config key rule** — the Phase 1 LLM reads the prefix for association context but declares a **clean config key** matching the plugin parameter name from vocabulary. This keeps IntentContract keys short and maintains O7 alignment:

```
CONFIG KEY RULE:
The plugin__capability__ prefix on resolved_user_inputs tells you which plugin
action each config value belongs to. Use this to:
1. Match the config to the correct IntentStep (by domain/capability)
2. Declare a clean config key that matches the plugin parameter name from
   the vocabulary (e.g., "gmail_search_query", not "gmail__search__filter_criteria")

This ensures config keys stay aligned with the vocabulary and the O7 merge logic.
```

**Value translation rule** — instruct the Phase 1 LLM to translate natural-language values to plugin-native syntax using the parameter descriptions already present in the vocabulary:

```
VALUE TRANSLATION RULE:
When declaring a config value that targets a plugin parameter, check the
parameter's description in the PLUGIN VOCABULARY section. If the description
indicates a specific syntax (e.g., "supports Gmail search operators like
'from:', 'subject:', 'in:'"), translate the user's natural-language value
to that syntax.

Example:
  Input:  gmail / search / filter_criteria: "invoices with PDF attachments"
  Vocab:  query: string — Search query (supports Gmail search operators...)
  Output: config default = "subject:(Invoice OR Expenses OR Bill) has:attachment filename:pdf"
```

**Value composition rule** — instruct the Phase 1 LLM to compose related config entries that map to a single plugin parameter:

```
VALUE COMPOSITION RULE:
When multiple resolved_user_inputs share the same plugin/capability group,
check if they map to a single plugin parameter. If so, compose them into
one config entry whose value combines the information from all related inputs.

Example:
  Input:  gmail / search / filter_criteria: "invoices with PDF attachments"
          gmail / search / time_window: "last 24 hours"
  Vocab:  query: string — Search query (supports Gmail search operators...)
  Output: single config "gmail_search_query" with default =
          "subject:(Invoice OR Expenses OR Bill) has:attachment filename:pdf newer_than:1d"
          (time_window composed into the query using Gmail's newer_than operator)
```

**1c. Backward compatibility** — if keys don't contain `__`, fall back to current behavior (flat list, no grouping).

**Status:** ✅ Done (2026-03-16) — see Phase 1 implementation notes above

---

### Phase 5: End-to-End Testing

**Goal:** Validate the full flow from thread-based enhanced prompt through IntentContract generation.

**File:** `scripts/test-complete-pipeline-with-vocabulary.ts` (extend existing test)

**Test cases:**

| # | Scenario | Phase | Expected Result |
|---|----------|-------|----------------|
| T1 | Prefixed keys parsed and grouped | 1 | `buildVocabularyInjection()` groups configs by plugin/capability |
| T2 | Value translation via vocabulary hints | 1 | Phase 1 LLM translates `"invoices with PDF"` → `subject:(Invoice OR Bill) has:attachment filename:pdf` |
| T3 | Value composition (same group → single param) | 1 | `filter_criteria` + `time_window` → single `gmail_search_query` with composed value |
| T4 | Backward compatibility — no prefix | 1 | Generic keys still work, flat list display, no grouping |
| T5 | Clean config keys in IntentContract | 1 | Config keys match vocabulary parameter names, not full prefixed keys |
| T6 | Single plugin (Gmail search only) | 5 | Thread LLM produces `gmail__search__filter_criteria`, `gmail__search__time_window` |
| T7 | Same plugin, two actions (Gmail search + send) | 5 | `gmail__search__*` and `gmail__send_message__*` correctly separated |
| T8 | Multiple plugins (Gmail + Sheets + Drive) | 5 | Each key prefixed with correct plugin and capability |
| T9 | Single-value parameter (e.g., sheet tab name) | 5 | Thread LLM asks for one concrete value, resolved value is a single string |
| T10 | Parameter-aware question quality | 5 | Clarification questions constrain answer format (e.g., "Which single sheet tab?") |

**Status:** ⬜ Todo

---

## Implementation Order and Dependencies

**Strategy: Consumer-first** — validate the V6 pipeline's ability to consume prefixed keys before building the thread-based producer.

```
Phase 1: V6 Vocabulary Injection (consumer)
    Update buildVocabularyInjection() to parse prefixed keys
    Add translation, composition, and config key rules to Phase 1 LLM prompt
    Test with simulated prefixed resolved_user_inputs (T1-T5)
    ↓  (validates consumer works before building producer)
Phase 2: Enrich PluginDefinitionContext
    Add toActionSummaryContext() with domain/capability + parameter hints
    ↓
Phase 3: Inject action summary into process-message route
    ↓  (depends on Phase 2)
Phase 4: Create v14 prompt template
    Prefixed key rules + parameter-aware clarification questions
    ↓  (depends on Phase 2 + Phase 3 — LLM needs action summary to generate prefixes)
Phase 5: End-to-end testing (T6-T10)
    Full flow from thread-based prompt through IntentContract generation
```

**Phase 1 is independently testable** — use the existing test script with manually prefixed `resolved_user_inputs`. This gives early validation before touching the thread-based flow.

**Phases 2 and 3** can be developed together. **Phase 4** (prompt engineering) is the most critical for the thread-based side — it determines whether the LLM consistently generates correct prefixes and asks parameter-aware questions.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Thread-based LLM inconsistently applies prefixes | Clear examples in prompt + validation in Phase 3 Zod schema (optional: warn if keys lack `__` delimiter) |
| Action summary bloats thread context | Only include connected plugins (not all available), ~200-300 tokens for 3-4 plugins (including params). Cap at ~5 params per action. |
| Capability strings change across plugin versions | Capabilities come from plugin definitions — stable. If changed, vocabulary and thread context update together. |
| Backward compatibility with existing enhanced prompts | Fallback to generic key behavior when no `__` delimiter detected |
| Some user inputs don't map to any plugin (e.g., general preferences) | Allow non-prefixed keys for plugin-agnostic config (e.g., `report_format: "PDF"`) |

---

## Success Criteria

1. Phase 3 `resolved_user_inputs` consistently uses `plugin__capability__param` format for plugin-related config values
2. V6 Phase 1 LLM correctly maps prefixed configs to corresponding IntentContract steps
3. Config keys in IntentContract use clean names matching vocabulary parameter names (O7 alignment maintained)
4. Phase 1 LLM translates natural-language values to plugin-native syntax using vocabulary descriptions (no plugin definition changes)
5. Phase 1 LLM composes related config entries (same plugin/capability group) into single parameters where appropriate
6. Thread-based LLM asks parameter-aware clarification questions (single value for string params, not lists)
7. No missing config values caused by ambiguous multi-value answers (e.g., `sheet_tab_name` resolves to a single tab)
8. No regression in enhanced prompt quality for workflows without V6 pipeline
9. Token cost increase in thread context < 300 tokens

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-15 | Initial draft | Design doc + workplan for O8 resolution via enhanced prompt key hints |
| 2026-03-15 | Review amendments | Added value translation rule (vocabulary-based, no plugin changes), value composition rule, clean config key rule (O7 alignment), scope note |
| 2026-03-15 | Parameter hints addition | Extended action summary with key parameter hints (name, type, constraint) to solve `sheet_tab_name` missing-value issue. Updated Phase 2 interface, Phase 4c question guidance, action summary format, scope, tests T9/T10, success criteria 6-7 |
| 2026-03-15 | Reordered phases | Consumer-first strategy: Phase 1 = V6 vocabulary injection (testable with simulated inputs), Phases 2-4 = thread-based producer, Phase 5 = E2E. Renumbered all phases and sub-sections accordingly. |
| 2026-03-16 | Phase 1 implemented | `buildVocabularyInjection()` refactored with `parsePrefixedKey()`, `buildGroupedUserContext()`, `buildFlatUserContext()`. Validated with 3-test script. Test JSON updated with prefixed keys. |
| 2026-03-16 | Phases 2-4 implemented | Phase 2: `toActionSummaryContext()` + `toActionSummaryText()` on PluginDefinitionContext. Phase 3: action summary injected into process-message phases 1-3. Phase 4: v14 prompt template with prefix rules, parameter-aware questions, updated examples. |
