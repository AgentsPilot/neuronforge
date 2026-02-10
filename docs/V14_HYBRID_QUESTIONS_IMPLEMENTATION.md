# V14 Hybrid Questions - Implementation Tracker

**Status:** PHASE B IMPLEMENTATION COMPLETE - VERIFICATION PENDING
**Created:** 2026-02-05
**Delete when done:** Yes - remove this file once implementation is complete and verified.

---

## Goal

Create a new **v14 Workflow Agent Creation Prompt** that supports:
1. **Hybrid question types:** `select`, `multi_select`, and `text` in Phase 2
2. **"Other" fallback:** Every select/multi_select question offers an "Other (type your own answer)" escape hatch
3. **Structured answer format:** Phase 3 receives typed answer objects (not plain strings) for proper resolution

## Strategy

**Phase A.1:** ✅ Basic hybrid UI in test page (select buttons + text fallback)
**Phase A.2:** ✅ Structured answer objects + multi_select support + strict typing
**Phase A.3:** ✅ UI improvements (processing indicators, mini-cycle handling)
**Phase A.4:** ✅ V6 Review Mode feature flag (infrastructure complete)
**Phase B.1-B.4:** ✅ Production page + V6 single API (`generate-ir-semantic`, no review)
**Phase B.5:** Verification testing (pending)
**Phase B.6:** Thinking Words integration (processing indicators with rotating words)
**Phase C:** V6 Review Mode flag support (split API flow with `V6ReviewCustomizeUI`)

---

## Version History Reference

| Prompt Version | Question Type | Status |
|---------------|---------------|--------|
| v5-v6 | `type: "select"` with options | Archived |
| v7 | Mixed (select + text) | Archived |
| v8-v13 | `type: "text"` only (open-ended) | v13 is current production |
| **v14** | **Hybrid: select + multi_select + text, with "Other" fallback + structured answers** | **This implementation** |

---

## Structured Answer Format (v14 Prompt Requirement)

The v14 prompt expects Phase 3 to receive **structured answer objects**, not plain strings.

### Answer Types (Strict TypeScript)

```typescript
// For select questions (single choice)
interface StructuredSelectAnswer {
  answerType: 'select';
  mode: 'selected' | 'custom';
  selected?: string;   // The option.value when mode='selected'
  custom?: string;     // Free-text when mode='custom'
}

// For multi_select questions (multiple choices)
interface StructuredMultiSelectAnswer {
  answerType: 'multi_select';
  mode: 'selected' | 'custom';
  selected?: string[];  // Array of option.value when mode='selected'
  custom?: string;      // Free-text when mode='custom'
}

// Union type for all answer formats
type ClarificationAnswer = string | StructuredSelectAnswer | StructuredMultiSelectAnswer;

// State type for answers map
type ClarificationAnswersMap = Record<string, ClarificationAnswer>;
```

### Answer Format Examples

```json
// Select question - user picked an option
{ "answerType": "select", "mode": "selected", "selected": "google_sheet" }

// Select question - user typed custom answer
{ "answerType": "select", "mode": "custom", "custom": "I use Notion databases" }

// Multi-select question - user picked multiple options
{ "answerType": "multi_select", "mode": "selected", "selected": ["date", "vendor", "amount"] }

// Multi-select question - user typed custom answer
{ "answerType": "multi_select", "mode": "custom", "custom": "All columns plus a custom notes field" }

// Text question - plain string (unchanged)
"Match by vendor name and transaction date"
```

### Phase 3 Resolution Rule

When `mode: "selected"`, Phase 3 resolves `value` → `label` by looking up the option from Phase 2's `questionsSequence`. Example:
- Phase 2 option: `{ "value": "google_sheet", "label": "Google Sheet", "description": "..." }`
- Phase 3 answer: `{ "answerType": "select", "mode": "selected", "selected": "google_sheet" }`
- Phase 3 uses "Google Sheet" (the label) in the enhanced prompt

---

## Phase A.1: Basic Hybrid UI ✅ COMPLETE

### Files Changed

### Files Changed (A.1)

| # | File | Change | Status |
|---|------|--------|--------|
| 1 | `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt` | **NEW** - Hybrid question types + structured answer format | [x] |
| 2 | `app/api/agent-creation/init-thread/route.ts` | **1 line** - Point to v14 prompt | [x] |
| 3 | `app/test-plugins-v2/page.tsx` | **~80 lines** - Option buttons + handlers in Phase 2 question block | [x] |

> **Note:** A.1 implementation stores answers as plain strings (labels). A.2 upgrades to structured objects.

---

### Step 1: Create v14 Prompt File [x]

**File:** `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt`

Copy v13 verbatim, then modify **only the Phase 2 section**:

**A. Replace the question type rule:**

```
# v13 (current):
* Ask **only open-text questions** (`type: "text"`).

# v14 (new):
* For each question, choose the most appropriate type:
  - `type: "select"` when the answer can be chosen from a small, finite set of common
    options (e.g., output format, delivery method, matching strategy, frequency).
    Always set `allowCustom: true`. Include `value`, `label`, and optionally `description`.
  - `type: "text"` when the answer is inherently open-ended and cannot be meaningfully
    pre-populated (e.g., email addresses, detailed criteria, free-form descriptions).
  - When in doubt, prefer "select" -- it is faster for users and always has an "Other" fallback.
```

**B. Add select-specific generation rules (new bullet in Phase 2 behavior rules):**

```
* When generating `type: "select"` questions:
  - Include exactly 3-5 options per question.
  - Each option must have `value` (short, lowercase, snake_case) and `label` (concise, human-readable).
    Optionally include `description` for extra clarity.
  - Always set `allowCustom: true` on every select question.
```

**C. Update the Phase 2 output example** to show mixed `select` and `text` questions:

```json
{
  "questionsSequence": [
    {
      "id": "q1",
      "theme": "Inputs",
      "question": "Where is the authoritative expense data stored?",
      "type": "select",
      "options": [
        { "value": "google_sheet", "label": "Google Sheet", "description": "A spreadsheet in Google Sheets" },
        { "value": "excel_drive", "label": "Excel file in Google Drive", "description": "An .xlsx file stored in Drive" },
        { "value": "email_attachments", "label": "Email attachments", "description": "Receipts arrive as email attachments" }
      ],
      "allowCustom": true
    },
    {
      "id": "q2",
      "theme": "Processing",
      "question": "How should matches be determined (for example: exact totals, or date + vendor + amount)?",
      "type": "text"
    },
    {
      "id": "q3",
      "theme": "Outputs",
      "question": "What format should the final report be in?",
      "type": "select",
      "options": [
        { "value": "html_email", "label": "HTML table in email body" },
        { "value": "xlsx_attachment", "label": "Excel file attachment (.xlsx)" },
        { "value": "pdf_attachment", "label": "PDF attachment" },
        { "value": "google_sheet", "label": "Google Sheet (new or existing)" }
      ],
      "allowCustom": true
    },
    {
      "id": "q4",
      "theme": "Delivery",
      "question": "Who should receive the report? Please provide their email address.",
      "type": "text"
    }
  ]
}
```

---

### Step 2: Update Route Reference [x]

**File:** `app/api/agent-creation/init-thread/route.ts` (line 22)

```typescript
// FROM:
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v13-chatgpt";
// TO:
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v14-chatgpt";
```

---

### Step 3: Test Page - Hybrid Question Rendering [x]

**File:** `app/test-plugins-v2/page.tsx`

The current Phase 2 question block (lines ~3626-3686) renders a single textarea for every question. We modify this block to conditionally render option buttons for `type: "select"` questions while keeping the textarea for `type: "text"` questions.

#### 3a. Add state for custom input toggle [x]

Add one state variable near the other thread conversation state (~line 700):

```typescript
const [showCustomInput, setShowCustomInput] = useState(false)
```

Reset to `false` when `currentQuestionIndex` changes.

#### 3b. Add `handleOptionSelect` function [x]

Add near `handleAnswerSubmit` (~line 1560):

```typescript
const handleOptionSelect = (questionId: string, value: string, label: string) => {
  // Record answer using the label (human-readable for Phase 3)
  const updatedAnswers = { ...clarificationAnswers, [questionId]: label };
  setClarificationAnswers(updatedAnswers);

  // Add to conversation history
  setConversationHistory(prev => [...prev, {
    role: 'user',
    content: `Q: ${currentQuestions[currentQuestionIndex].question}\nA: ${label}`,
    data: null
  }]);

  // Reset custom input state
  setShowCustomInput(false);

  // Advance to next question or Phase 3 (same logic as handleAnswerSubmit)
  if (currentQuestionIndex < currentQuestions.length - 1) {
    setCurrentQuestionIndex(currentQuestionIndex + 1);
    setUserAnswer('');
  } else {
    setUserAnswer('');
    if (isInMiniCycle) {
      processMessage(3, updatedAnswers);
      setIsInMiniCycle(false);
      setMiniCyclePhase3(null);
    } else {
      processMessage(3, updatedAnswers);
    }
  }
};
```

#### 3c. Modify Phase 2 question JSX block [x]

Replace the input area inside the `{currentPhase === 2 && ...}` block (lines ~3648-3680) with conditional rendering:

```
IF question.type === 'select' AND question.options exists AND options.length > 0:
  -> Render option buttons (vertical list)
  -> Render "Other (type your own answer)" dashed button
  -> When "Other" clicked -> reveal textarea + Submit button
ELSE (type === 'text' or fallback):
  -> Render textarea + Submit button (current behavior, unchanged)
```

**Option button layout:**
- Vertical list of clickable buttons, each showing: numbered badge + label + optional description
- Styled with inline CSS (consistent with test page style - no Tailwind)
- Clicking a button calls `handleOptionSelect(questionId, value, label)`

**"Other" button:**
- Dashed border, full width, labeled "Other (type your own answer)"
- Clicking sets `showCustomInput = true`, revealing the textarea below
- User types freely and clicks "Submit Answer" (existing `handleAnswerSubmit` flow)

---

## Design Decisions (A.1)

1. ~~**Store label, not value**~~ → **SUPERSEDED by A.2:** Now stores structured answer objects
2. **Graceful degradation** - if LLM returns a select question with missing/empty options, it silently falls back to text-only textarea
3. **"Other" always available** - every select question has a dashed "Other" button that reveals the textarea
4. **Test page first** - validate the full flow in the debug/test UI before touching production code

---

## Phase A.2: Structured Answers + Multi-Select ✅ COMPLETE

### Why Structured Answers?

The v14 prompt expects Phase 3 to receive structured objects so it can:
1. Distinguish between "user selected an option" vs "user typed custom text"
2. Resolve `value` → `label` when `mode: "selected"` using Phase 2 question options
3. Handle `multi_select` answers (array of values)

### Files to Change (A.2)

| # | File | Change | Status |
|---|------|--------|--------|
| 1 | `components/agent-creation/types/agent-prompt-threads.ts` | Add `'multi_select'` to type union + structured answer types | [x] |
| 2 | `app/test-plugins-v2/page.tsx` | Update state types + handlers for structured answers + multi-select UI | [x] |

### No Changes Needed (A.2)

- `app/api/agent-creation/process-message/route.ts` - Already passes `clarification_answers` through without transformation (line 333). As long as frontend sends correct typed objects, it works.

---

### Step A.2.1: Update Type Definitions [x]

**File:** `components/agent-creation/types/agent-prompt-threads.ts`

**A. Add `multi_select` to question type union (line ~189):**

```typescript
// FROM:
type: 'select' | 'text' | 'email' | 'number';

// TO:
type: 'select' | 'multi_select' | 'text' | 'email' | 'number';
```

**B. Add structured answer interfaces (after `ClarificationOption` interface):**

```typescript
/**
 * Structured answer for single-select questions
 * Sent to Phase 3 to distinguish selected option vs custom text
 */
export interface StructuredSelectAnswer {
  answerType: 'select';
  mode: 'selected' | 'custom';
  selected?: string;   // option.value when mode='selected'
  custom?: string;     // free-text when mode='custom'
}

/**
 * Structured answer for multi-select questions
 * Sent to Phase 3 to distinguish selected options vs custom text
 */
export interface StructuredMultiSelectAnswer {
  answerType: 'multi_select';
  mode: 'selected' | 'custom';
  selected?: string[];  // array of option.value when mode='selected'
  custom?: string;      // free-text when mode='custom'
}

/**
 * Union type for all clarification answer formats
 * - string: plain text answer (for type='text' questions)
 * - StructuredSelectAnswer: for type='select' questions
 * - StructuredMultiSelectAnswer: for type='multi_select' questions
 */
export type ClarificationAnswer = string | StructuredSelectAnswer | StructuredMultiSelectAnswer;
```

**C. Update ProcessMessageRequest to use strict type (line ~122):**

```typescript
// FROM:
clarification_answers?: Record<string, any>;

// TO:
clarification_answers?: Record<string, ClarificationAnswer>;
```

**D. Update ThreadMetadata to use strict type (line ~39):**

```typescript
// FROM:
clarification_answers?: Record<string, any>;

// TO:
clarification_answers?: Record<string, ClarificationAnswer>;
```

---

### Step A.2.2: Update Test Page State & Handlers [x]

**File:** `app/test-plugins-v2/page.tsx`

**A. Import new types:**

```typescript
import type {
  ClarificationAnswer,
  StructuredSelectAnswer,
  StructuredMultiSelectAnswer
} from '@/components/agent-creation/types/agent-prompt-threads';
```

**B. Update state type (~line 700):**

```typescript
// FROM:
const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});

// TO:
const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, ClarificationAnswer>>({});
```

**C. Add multi-select tracking state:**

```typescript
// Track selected options for multi_select questions (reset when question changes)
const [selectedMultiOptions, setSelectedMultiOptions] = useState<string[]>([]);
```

**D. Update `handleOptionSelect` for structured answers (~line 1611):**

```typescript
const handleOptionSelect = (questionId: string, value: string, label: string) => {
  // Create structured answer object
  const answer: StructuredSelectAnswer = {
    answerType: 'select',
    mode: 'selected',
    selected: value  // Store the value, Phase 3 resolves to label
  };

  const updatedAnswers = { ...clarificationAnswers, [questionId]: answer };
  setClarificationAnswers(updatedAnswers);

  // Add to conversation history (show label for readability)
  setConversationHistory(prev => [...prev, {
    role: 'user',
    content: `Q: ${currentQuestions[currentQuestionIndex].question}\nA: ${label}`,
    data: null
  }]);

  // Reset states
  setShowCustomInput(false);
  setSelectedMultiOptions([]);

  // Advance to next question or Phase 3
  if (currentQuestionIndex < currentQuestions.length - 1) {
    setCurrentQuestionIndex(currentQuestionIndex + 1);
    setUserAnswer('');
  } else {
    setUserAnswer('');
    if (isInMiniCycle) {
      processMessage(3, updatedAnswers);
      setIsInMiniCycle(false);
      setMiniCyclePhase3(null);
    } else {
      processMessage(3, updatedAnswers);
    }
  }
};
```

**E. Add `handleMultiSelectToggle` function:**

```typescript
const handleMultiSelectToggle = (value: string) => {
  setSelectedMultiOptions(prev =>
    prev.includes(value)
      ? prev.filter(v => v !== value)
      : [...prev, value]
  );
};
```

**F. Add `handleMultiSelectSubmit` function:**

```typescript
const handleMultiSelectSubmit = () => {
  const currentQuestion = currentQuestions[currentQuestionIndex];
  const questionId = currentQuestion.id;

  // Create structured answer object
  const answer: StructuredMultiSelectAnswer = {
    answerType: 'multi_select',
    mode: 'selected',
    selected: selectedMultiOptions
  };

  const updatedAnswers = { ...clarificationAnswers, [questionId]: answer };
  setClarificationAnswers(updatedAnswers);

  // Build display labels for conversation history
  const selectedLabels = selectedMultiOptions.map(val => {
    const opt = currentQuestion.options?.find(o =>
      (typeof o === 'object' ? o.value : o) === val
    );
    return opt ? (typeof opt === 'object' ? opt.label : opt) : val;
  });

  setConversationHistory(prev => [...prev, {
    role: 'user',
    content: `Q: ${currentQuestion.question}\nA: ${selectedLabels.join(', ')}`,
    data: null
  }]);

  // Reset states
  setShowCustomInput(false);
  setSelectedMultiOptions([]);

  // Advance to next question or Phase 3
  if (currentQuestionIndex < currentQuestions.length - 1) {
    setCurrentQuestionIndex(currentQuestionIndex + 1);
    setUserAnswer('');
  } else {
    setUserAnswer('');
    if (isInMiniCycle) {
      processMessage(3, updatedAnswers);
      setIsInMiniCycle(false);
      setMiniCyclePhase3(null);
    } else {
      processMessage(3, updatedAnswers);
    }
  }
};
```

**G. Update `handleAnswerSubmit` for custom/text answers:**

```typescript
const handleAnswerSubmit = () => {
  const currentQuestion = currentQuestions[currentQuestionIndex];
  const questionId = currentQuestion.id;
  let answer: ClarificationAnswer;

  // Determine answer format based on question type
  if (currentQuestion.type === 'select') {
    answer = {
      answerType: 'select',
      mode: 'custom',
      custom: userAnswer
    } as StructuredSelectAnswer;
  } else if (currentQuestion.type === 'multi_select') {
    answer = {
      answerType: 'multi_select',
      mode: 'custom',
      custom: userAnswer
    } as StructuredMultiSelectAnswer;
  } else {
    // Plain text for text/email/number questions
    answer = userAnswer;
  }

  const updatedAnswers = { ...clarificationAnswers, [questionId]: answer };
  setClarificationAnswers(updatedAnswers);

  // ... rest of existing handleAnswerSubmit logic
};
```

---

### Step A.2.3: Add Multi-Select UI [x]

**File:** `app/test-plugins-v2/page.tsx`

In the Phase 2 question JSX block, add a third branch for `multi_select`:

```jsx
{currentQuestions[currentQuestionIndex].type === 'multi_select' &&
 currentQuestions[currentQuestionIndex].options?.length > 0 ? (
  <>
    {/* Checkbox-style option buttons */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
      {currentQuestions[currentQuestionIndex].options.map((opt, i) => {
        const optValue = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? opt.label : opt;
        const optDescription = typeof opt === 'object' ? opt.description : undefined;
        const isSelected = selectedMultiOptions.includes(optValue);

        return (
          <button
            key={optValue}
            onClick={() => handleMultiSelectToggle(optValue)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              border: isSelected ? '2px solid #00d4ff' : '2px solid #444',
              borderRadius: '8px',
              background: isSelected ? 'rgba(0, 212, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              color: '#fff'
            }}
          >
            {/* Checkbox indicator */}
            <span style={{
              width: '20px',
              height: '20px',
              border: '2px solid #00d4ff',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isSelected ? '#00d4ff' : 'transparent'
            }}>
              {isSelected && '✓'}
            </span>
            <div>
              <strong>{optLabel}</strong>
              {optDescription && <span style={{ color: '#888', marginLeft: '8px' }}>— {optDescription}</span>}
            </div>
          </button>
        );
      })}
    </div>

    {/* Submit selected options button */}
    {selectedMultiOptions.length > 0 && !showCustomInput && (
      <button
        onClick={handleMultiSelectSubmit}
        style={{
          padding: '10px 20px',
          background: '#00d4ff',
          color: '#000',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          marginBottom: '12px',
          width: '100%'
        }}
      >
        Submit ({selectedMultiOptions.length} selected)
      </button>
    )}

    {/* "Other" button */}
    <button
      onClick={() => { setShowCustomInput(true); setSelectedMultiOptions([]); }}
      style={{
        border: '2px dashed #666',
        background: 'transparent',
        color: '#aaa',
        padding: '12px',
        borderRadius: '8px',
        cursor: 'pointer',
        width: '100%'
      }}
    >
      ✏️ Other (type your own answer)
    </button>

    {/* Custom input textarea */}
    {showCustomInput && (
      <>
        <textarea
          value={userAnswer}
          onChange={(e) => setUserAnswer(e.target.value)}
          placeholder="Type your answer..."
          style={{ /* existing styles */ }}
        />
        <button onClick={handleAnswerSubmit} disabled={!userAnswer.trim()}>
          Submit Answer
        </button>
      </>
    )}
  </>
) : /* ... existing select and text branches */ }

---

## Verification Checklist (Test Page)

### A.1 Basic Hybrid UI ✅
- [x] Go to `/test-plugins-v2` -> Tab 3: Thread Conversation
- [x] Phase 2 returns `select` and `text` questions
- [x] Select questions: option buttons appear
- [x] Select questions: clicking option advances to next question
- [x] Select questions: "Other" reveals textarea
- [x] Text questions: textarea appears as before

### A.2 Structured Answers + Multi-Select ✅
- [x] `ClarificationAnswer` type exported from types file
- [x] `clarificationAnswers` state uses strict `Record<string, ClarificationAnswer>` type
- [x] Select answer sends structured object: `{ answerType: "select", mode: "selected", selected: "value" }`
- [x] Select "Other" sends: `{ answerType: "select", mode: "custom", custom: "..." }`
- [x] Multi-select UI: checkboxes allow multiple selections
- [x] Multi-select answer sends: `{ answerType: "multi_select", mode: "selected", selected: ["v1","v2"] }`
- [x] Multi-select "Other" sends: `{ answerType: "multi_select", mode: "custom", custom: "..." }`
- [x] Text questions still send plain strings
- [x] Phase 3 correctly resolves `value` → `label` for selected answers
- [x] No `any` types in client-to-server answer flow

### A.3 UI Improvements ✅ COMPLETE
- [x] Processing indicator: overlay with spinner shown during Phase 2 answer submission
- [x] Processing indicator: loading card shown during Phase 3 transition ("Generating Enhanced Prompt...")
- [x] Mini-cycle: hide enhanced prompt UI when entering mini-cycle (enhanced prompt kept in conversation history for debugging)

**Implementation details:**
- Phase 2 question box: added `position: relative` and processing overlay with spinner when `isLoading` is true
- Phase 3 transition: added loading card between Phase 2 completion and enhanced prompt display
- Mini-cycle: added `!isInMiniCycle` condition to enhanced prompt display: `{currentPhase === 3 && enhancedPrompt && !isInMiniCycle && (...}`

---

## Phase B: Production Page (V6 Single API Flow)

Port hybrid questions UI to `app/v2/agents/new/page.tsx` using **V6 single API flow**.

**Environment:**
- `NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true`
- `NEXT_PUBLIC_USE_V6_REVIEW_MODE` ignored (hardcoded to single API)

**API:** `/api/v6/generate-ir-semantic` (all 5 phases in one call, no review UI)

**Goal:** Full end-to-end testing: hybrid questions → V6 single API → agent creation

### B.1: State & Type Updates

| # | Task | Status |
|---|------|--------|
| 1 | Import `ClarificationAnswer`, `StructuredSelectAnswer`, `StructuredMultiSelectAnswer` types | [x] |
| 2 | Add `questionMetadataRef` to store full question objects (needed for options lookup) | [x] (uses `questionsSequence` in state) |
| 3 | Update `clarificationAnswers` state to `Record<string, ClarificationAnswer>` | [x] |
| 4 | Add `selectedMultiOptions` state for multi-select checkbox tracking | [x] |
| 5 | Add `showCustomInput` state for "Other" textarea toggle | [x] |

### B.2: Handler Functions

| # | Task | Status |
|---|------|--------|
| 1 | Add `handleOptionSelect(questionId, value, label)` for single-select | [x] (`answerSelectOption`) |
| 2 | Add `handleMultiSelectToggle(value)` for checkbox toggle | [x] (`toggleMultiSelectOption`) |
| 3 | Add `handleMultiSelectSubmit()` for submitting multi-select answers | [x] (`submitMultiSelectAnswer`) |
| 4 | Update existing answer submit handler for structured custom/text answers | [x] (`submitCustomAnswer`) |

### B.3: UI Rendering

| # | Task | Status |
|---|------|--------|
| 1 | Render option buttons for `type: "select"` questions | [x] |
| 2 | Render checkbox buttons for `type: "multi_select"` questions | [x] |
| 3 | Add "Submit (N selected)" button for multi-select | [x] ("Done (N selected)") |
| 4 | Add "Other (type your own)" dashed button with textarea reveal | [x] |
| 5 | Keep textarea-only for `type: "text"` questions (unchanged) | [x] |
| 6 | Use V2 design system CSS variables (`--v2-surface`, `--v2-border`, cyan accents) | [x] |

### B.4: V6 Single API Integration

| # | Task | Status |
|---|------|--------|
| 1 | Import `useV6AgentGeneration` from featureFlags | [x] (already imported) |
| 2 | When `useV6=true`: call `/api/v6/generate-ir-semantic` (single API, no review) | [x] (already in `handleAgentApproval`) |
| 3 | Handle V6 API response and proceed to agent creation | [x] (already implemented) |
| 4 | Ignore `useV6ReviewMode` flag (hardcoded to single API for Phase B) | [x] (code doesn't check it) |

### B.5: Verification (V6 Single API)

| # | Task | Status |
|---|------|--------|
| 1 | Select questions: option buttons appear and clicking advances | [ ] |
| 2 | Multi-select questions: checkboxes work, submit sends array | [ ] |
| 3 | "Other" button reveals textarea for custom input | [ ] |
| 4 | Text questions: textarea appears as before | [ ] |
| 5 | Structured answers flow correctly | [ ] |
| 6 | V6 single API (`generate-ir-semantic`) executes all 5 phases | [ ] |
| 7 | Agent creation works end-to-end | [ ] |
| 8 | No `any` types in production answer flow | [ ] |

### B.6: Thinking Words Integration (Processing Indicators)

Enhance the typing indicator to show rotating "thinking words" instead of static messages, providing visual feedback that work is in progress.

**Reference:** [THINKING_WORDS.md](./THINKING_WORDS.md)

**Approach:** Create a `ThinkingWordsIndicator` component that alternates between the context message and role-personalized thinking words.

#### Architecture

```
components/v2/
└── ThinkingWordsIndicator.tsx  ← New component

lib/ui/
├── thinking-words-dictionary.json  ← Word dictionary (already exists)
├── thinking-words-loader.ts        ← Singleton loader (already exists)
└── thinking-words.ts               ← Public API (already exists)
```

#### Component Design

```tsx
// components/v2/ThinkingWordsIndicator.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { createThinkingWordCyclerForRole } from '@/lib/ui/thinking-words';

interface ThinkingWordsIndicatorProps {
  contextMessage?: string;  // Static context ("Analyzing your request...")
  userRole?: string;        // User role for personalized words
  intervalMs?: number;      // Rotation interval (default 2500ms)
}

export function ThinkingWordsIndicator({
  contextMessage,
  userRole = 'other',
  intervalMs = 2500
}: ThinkingWordsIndicatorProps) {
  const [displayText, setDisplayText] = useState(contextMessage || 'Thinking');
  const cycleRef = useRef(0);

  useEffect(() => {
    const getNextWord = createThinkingWordCyclerForRole(userRole as any);

    const interval = setInterval(() => {
      cycleRef.current++;

      if (contextMessage) {
        // Alternate: context → word → context → word...
        if (cycleRef.current % 2 === 0) {
          setDisplayText(contextMessage);
        } else {
          setDisplayText(getNextWord());
        }
      } else {
        // No context, just cycle thinking words
        setDisplayText(getNextWord());
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [contextMessage, userRole, intervalMs]);

  return (
    <span className="text-sm text-[var(--v2-text-secondary)] font-medium">
      {displayText}
    </span>
  );
}
```

#### Integration Point

**File:** `app/v2/agents/new/page.tsx` line ~2126

**Before:**
```tsx
<span className="text-sm text-[var(--v2-text-secondary)] font-medium">{message.content}</span>
```

**After:**
```tsx
<ThinkingWordsIndicator contextMessage={message.content} userRole={user?.role} />
```

#### Example Rotation

```
"Analyzing your request..." → "Thinking" → "Analyzing your request..."
→ "Crunching numbers" → "Analyzing your request..." → "On it" → ...
```

#### Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Create `components/v2/ThinkingWordsIndicator.tsx` component | [ ] |
| 2 | Import component in `app/v2/agents/new/page.tsx` | [ ] |
| 3 | Replace static text in typing indicator with component | [ ] |
| 4 | Pass `user?.role` for role-personalized words | [ ] |
| 5 | Verify rotation works during all processing phases | [ ] |

#### Benefits

| Benefit | Description |
|---------|-------------|
| **No call-site changes** | All existing `addTypingIndicator('...')` calls work unchanged |
| **Role-personalized** | Uses `userRole` to show relevant thinking words |
| **Context preserved** | Alternates between context message and thinking words |
| **Clean unmount** | Interval cleared automatically when typing indicator removed |

---

## Phase C: V6 Review Mode Flag Support

Add `useV6ReviewMode` flag support for split API flow with Review UI.

**Environment:**
- `NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true`
- `NEXT_PUBLIC_USE_V6_REVIEW_MODE=true` (enables split API flow)

**Split API Flow:**
1. `/api/v6/generate-semantic-grounded` (P1+P2+Ambiguity Detection)
2. `V6ReviewCustomizeUI` (user reviews and makes decisions)
3. `/api/v6/compile-with-decisions` (P3+P4+P5)

### C.1: Flag Integration

| # | Task | Status |
|---|------|--------|
| 1 | Import `useV6ReviewMode` from featureFlags | [ ] |
| 2 | When `useV6=true && useReviewMode=true`: use split API flow | [ ] |
| 3 | When `useV6=true && useReviewMode=false`: use single API (Phase B behavior) | [ ] |

### C.2: Split API Flow Implementation

| # | Task | Status |
|---|------|--------|
| 1 | Call `/api/v6/generate-semantic-grounded` first | [ ] |
| 2 | Show `V6ReviewCustomizeUI` for user review | [ ] |
| 3 | After user decisions, call `/api/v6/compile-with-decisions` | [ ] |
| 4 | Proceed to agent creation with compiled result | [ ] |

### C.3: Verification (V6 Review Mode)

| # | Task | Status |
|---|------|--------|
| 1 | `useReviewMode=true`: split API flow executes correctly | [ ] |
| 2 | `useReviewMode=false`: single API flow (Phase B) still works | [ ] |
| 3 | V6ReviewCustomizeUI displays ambiguities and collects decisions | [ ] |
| 4 | Hybrid questions work correctly in both V6 modes | [ ] |
| 5 | Agent creation works end-to-end in both modes | [ ] |

---

## Strict Typing Enforcement

**IMPORTANT:** No `any` types allowed in the client → server answer flow.

| Location | Current | Required |
|----------|---------|----------|
| `ThreadMetadata.clarification_answers` | `Record<string, any>` | `Record<string, ClarificationAnswer>` |
| `ProcessMessageRequest.clarification_answers` | `Record<string, any>` | `Record<string, ClarificationAnswer>` |
| Test page `clarificationAnswers` state | `Record<string, string>` | `Record<string, ClarificationAnswer>` |
| Production page answer state | `Record<string, string>` | `Record<string, ClarificationAnswer>` |

---

## Phase A.4: V6 Review Mode Feature Flag [x] COMPLETE

### Background

V6 agent generation supports two API flows:
1. **Split API flow** (2 calls with Review UI): User reviews ambiguities and makes decisions before final compilation
2. **Single API flow** (1 call, no review): Direct generation without user review step

This feature flag controls which flow the client uses.

### Feature Flag Definition

| Attribute | Value |
|-----------|-------|
| **Environment Variable** | `NEXT_PUBLIC_USE_V6_REVIEW_MODE` |
| **Function Name** | `useV6ReviewMode()` |
| **Scope** | Client-side (`NEXT_PUBLIC_` prefix) |
| **Default** | `true` (split API flow with Review UI) |
| **Active Routes** | `/v2/agents/new`, `/test-plugins-v2` |

### Values

| Value | Behavior |
|-------|----------|
| `true` / `1` / omit | **Split API flow with Review UI** (default) |
| `false` / `0` | **Single API flow** (no review) |

### API Flow Comparison

**When `true` (Review Mode enabled):**
1. `/api/v6/generate-semantic-grounded` → Phase 1 + Phase 2 + Ambiguity Detection
2. User reviews in `V6ReviewCustomizeUI` → makes decisions on ambiguities
3. `/api/v6/compile-with-decisions` → Phase 3 + Phase 4 + Phase 5

**When `false` (Review Mode disabled):**
1. `/api/v6/generate-ir-semantic` → All 5 phases in one call (no user review)

### Files to Change

| # | File | Change | Status |
|---|------|--------|--------|
| 1 | `lib/utils/featureFlags.ts` | Add `useV6ReviewMode()` function | [x] |
| 2 | `lib/utils/__tests__/featureFlags.test.ts` | Add test cases | [x] |
| 3 | `.env.example` | Add `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | [x] |
| 4 | `docs/feature_flags.md` | Add documentation section | [x] |
| 5 | `app/test-plugins-v2/page.tsx` | Use flag to choose API flow | [ ] |
| 6 | `app/v2/agents/new/page.tsx` | Use flag to choose API flow (Phase B) | [ ] |

### Implementation

**Step 1: Add function to `lib/utils/featureFlags.ts`**

```typescript
/**
 * Check if V6 Review Mode is enabled
 *
 * When enabled, V6 agent generation uses split API flow with user review UI:
 * - API 1: generate-semantic-grounded (P1+P2+Detection)
 * - Review UI: User reviews ambiguities and makes decisions
 * - API 2: compile-with-decisions (P3+P4+P5)
 *
 * When disabled, uses single API flow (generate-ir-semantic) without review.
 *
 * @returns {boolean} True if review mode enabled, false for direct generation
 */
export function useV6ReviewMode(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;

  // Default to TRUE (review mode enabled by default)
  if (!flag || flag.trim() === '') {
    return true;
  }

  const normalizedFlag = flag.trim().toLowerCase();

  if (normalizedFlag === 'false' || normalizedFlag === '0') {
    return false;
  }

  if (normalizedFlag === 'true' || normalizedFlag === '1') {
    return true;
  }

  return true; // Default to true for unrecognized values
}
```

**Step 2: Add to `getFeatureFlags()` aggregator**

```typescript
export function getFeatureFlags() {
  return {
    useV6AgentGeneration: useV6AgentGeneration(),
    useV6ReviewMode: useV6ReviewMode(),  // Add here
    useEnhancedTechnicalWorkflowReview: useEnhancedTechnicalWorkflowReview(),
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
  };
}
```

**Step 3: Client usage pattern**

```typescript
import { useV6AgentGeneration, useV6ReviewMode } from '@/lib/utils/featureFlags';

const useV6 = useV6AgentGeneration();
const useReviewMode = useV6ReviewMode();

if (useV6) {
  if (useReviewMode) {
    // Split API flow with Review UI
    const grounded = await fetch('/api/v6/generate-semantic-grounded', ...);
    // Show V6ReviewCustomizeUI for user decisions
    const compiled = await fetch('/api/v6/compile-with-decisions', ...);
  } else {
    // Single API flow (no review)
    const result = await fetch('/api/v6/generate-ir-semantic', ...);
  }
}
```

### Verification Checklist

- [x] `useV6ReviewMode()` function added to featureFlags.ts
- [x] Function added to `getFeatureFlags()` aggregator
- [x] Test cases added for all input values (true, false, 1, 0, empty, undefined)
- [x] `.env.example` updated with new variable
- [x] `docs/feature_flags.md` updated with documentation section
- [ ] Test page uses flag to choose API flow (pending - not part of this task)
- [x] Flag defaults to `true` when not set

---

## Known Bugs (To Fix Later)

### BUG: `memoryRepository` not implemented — Memory count API crashes

- **File:** `app/api/agents/[id]/memory/count/route.ts:51`
- **Error:** `TypeError: Cannot read properties of undefined (reading 'countByAgentId')`
- **Cause:** Line 6 imports `memoryRepository` from `@/lib/repositories`, but it was never created. The repository doesn't exist in `lib/repositories/`.
- **Impact:** After agent creation, the agent detail page calls `/api/agents/[id]/memory/count` which returns 500. Non-blocking for agent creation itself.
- **Fix:** Create `MemoryRepository` class in `lib/repositories/` with a `countByAgentId()` method, export it from the repositories index.
- **Priority:** Low — pre-existing bug, not related to V14 changes.

---

**Last Updated:** 2026-02-08 - Phase B implementation complete (B.1-B.4), added B.6 Thinking Words integration plan
