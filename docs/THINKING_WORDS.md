# Thinking Words

Display rotating status words while agents are processing, providing visual feedback that work is in progress. Words are loaded from a JSON dictionary and can be personalized based on user role.

## Architecture

```
lib/ui/
├── thinking-words-dictionary.json  ← Edit this to add/modify words (no code changes)
├── thinking-words-loader.ts        ← Singleton loader
└── thinking-words.ts               ← Public API
```

## Adding/Modifying Words

Edit `thinking-words-dictionary.json` directly:

```json
{
  "categories": {
    "business": {
      "description": "Business/SMB domain",
      "words": [
        "Forecasting",
        "Crunching numbers",
        "Your new word here"
      ]
    }
  },
  "roleMapping": {
    "sales": ["business", "communication", "friendly"]
  }
}
```

After editing, rebuild the app to pick up changes.

### Special-purpose categories (`excludeFromGeneric`)

By default every category contributes to the **generic word pool** read by `getAllWords()` / `getRandomThinkingWord()` / `createThinkingWordCycler()` / `getShuffledThinkingWords()` / the exported `THINKING_WORDS` constant. That's the right behavior for short rotating status words.

For copy that must **not** leak into the generic pool — e.g. full sentences used by a specific feature — set `excludeFromGeneric: true` on the category. The loader skips flagged categories when building `allWords`; the category is still reachable **explicitly** via `getWordsForCategory(name)` / `getWordsForCategories([name])`.

```json
{
  "categories": {
    "clarification_hints": {
      "description": "Phase 2 single-question inter-question hints (full sentences).",
      "excludeFromGeneric": true,
      "words": [
        "A few more details to refine your agent.",
        "Let's narrow this down a bit more."
      ]
    }
  }
}
```

Use this for any category that (a) contains long-form copy not suitable for the generic rotating-status pool, OR (b) is owned by a specific feature and should only be reached through an explicit call. Special-purpose categories should also be left out of `roleMapping`.

## Usage

### Role-Based Words (Recommended)

```typescript
import { createThinkingWordCyclerForRole } from '@/lib/ui/thinking-words';

// Create a cycler for a specific user role
const getNextWord = createThinkingWordCyclerForRole('sales');

// Each call returns the next word from general + sales-relevant categories
setInterval(() => {
  setStatus(getNextWord()); // "Thinking" → "Crunching numbers" → "On it" → ...
}, 2000);
```

### Random Word for Role

```typescript
import { getRandomThinkingWordForRole } from '@/lib/ui/thinking-words';

const status = getRandomThinkingWordForRole('finance'); // "Calculating ROI"
```

### Generic (All Words)

```typescript
import { getRandomThinkingWord, createThinkingWordCycler } from '@/lib/ui/thinking-words';

// Random word from all categories
const status = getRandomThinkingWord(); // "Analyzing"

// Sequential cycling through all words
const getNextWord = createThinkingWordCycler();
```

### Direct Loader Access

```typescript
import { getThinkingWordsLoader } from '@/lib/ui/thinking-words';

const loader = getThinkingWordsLoader();

// Get dictionary version
loader.getVersion(); // "1.0"

// Get all category names
loader.getCategoryNames(); // ["general", "business", ...]

// Get category description
loader.getCategoryDescription('business'); // "Business/SMB domain"

// Get word count
loader.getTotalWordCount(); // 90
loader.getCategoryWordCount('general'); // 16
```

## Word Categories

| Category | Description | Count | Notes |
|----------|-------------|-------|-------|
| `general` | Universal words - always included for all roles | 16 | |
| `business` | Business/SMB domain | 16 | |
| `data_analysis` | Data & analysis operations | 15 | |
| `planning` | Planning & strategy | 13 | |
| `problem_solving` | Problem solving & debugging | 8 | |
| `communication` | Communication & collaboration | 6 | |
| `progress` | Progress indicators | 8 | |
| `friendly` | Friendly/casual tone | 8 | |
| `long_wait` | Humorous messages for long processing times | 5 | |
| `clarification_hints` | Phase 2 single-question inter-question hints (full sentences). Used by `/v2/agents/new` between clarification questions to soften the tone for non-technical users. | 10 | **Special-purpose** — `excludeFromGeneric: true`. Excluded from the generic word pool / random / cycler helpers. Reachable only via explicit `getWordsForCategory('clarification_hints')` / `getWordsForCategories(['clarification_hints'])`. Not in any role mapping. |

## Role → Category Mapping

Each role gets `general` (always) + role-specific categories:

| Role | Additional Categories |
|------|----------------------|
| `business_owner` | business, planning, progress |
| `manager` | planning, communication, progress |
| `consultant` | planning, problem_solving, data_analysis |
| `operations` | data_analysis, problem_solving, business |
| `sales` | business, communication, friendly |
| `marketing` | data_analysis, planning, friendly |
| `finance` | business, data_analysis |
| `other` | friendly, progress |

## React Example

```tsx
import { useState, useEffect } from 'react';
import { createThinkingWordCyclerForRole } from '@/lib/ui/thinking-words';
import type { UserRole } from '@/components/onboarding/hooks/useOnboarding';

interface Props {
  isProcessing: boolean;
  userRole?: UserRole;
}

function ThinkingIndicator({ isProcessing, userRole = 'other' }: Props) {
  const [word, setWord] = useState('Processing');

  useEffect(() => {
    if (!isProcessing) return;

    const getNext = createThinkingWordCyclerForRole(userRole);
    setWord(getNext());

    const interval = setInterval(() => setWord(getNext()), 2000);
    return () => clearInterval(interval);
  }, [isProcessing, userRole]);

  if (!isProcessing) return null;

  return <span className="animate-pulse">{word}...</span>;
}
```

### Timed Cycler (Long Operations)

For operations that take 20-120s (e.g. V6 agent generation), use `createTimedThinkingWordCycler()` which automatically progresses through word categories based on elapsed time:

- **0-15s**: General/friendly ("Thinking", "On it")
- **15-30s**: Domain words ("Parsing data", "Mapping out")
- **30-45s**: Progress words ("Almost there", "Fine-tuning")
- **45s+**: Humorous long-wait ("Brewing extra coffee for the team...")

```typescript
import { createTimedThinkingWordCycler } from '@/lib/ui/thinking-words';

const getNextWord = createTimedThinkingWordCycler();
const interval = setInterval(() => {
  updateStatus(getNextWord() + '...');
}, 4000);

// Cleanup when done
clearInterval(interval);
```

**Note:** `long_wait` is excluded from role mappings — it only activates via the timed cycler, never in generic role-based cycling.

## API Reference

### Types

```typescript
type ThinkingCategory =
  | 'general' | 'business' | 'data_analysis' | 'planning'
  | 'problem_solving' | 'communication' | 'progress' | 'friendly'
  | 'long_wait'
  | 'clarification_hints'; // special-purpose, excludeFromGeneric

type UserRole =
  | 'business_owner' | 'manager' | 'consultant' | 'operations'
  | 'sales' | 'marketing' | 'finance' | 'other';
```

### Functions

| Function | Description |
|----------|-------------|
| `getRandomThinkingWord()` | Random word from all categories |
| `getRandomThinkingWordForRole(role)` | Random word for a specific role |
| `createThinkingWordCycler()` | Sequential cycler (all words) |
| `createThinkingWordCyclerForRole(role)` | Sequential cycler for a role |
| `createTimedThinkingWordCycler(role?)` | Time-aware cycler with phase progression |
| `getShuffledThinkingWords()` | Shuffled array (all words) |
| `getShuffledThinkingWordsForRole(role)` | Shuffled array for a role |
| `getWordsForRole(role)` | Get word array for a role |
| `getWordsForCategories(categories)` | Get words for specific categories |
| `getThinkingWordsLoader()` | Get the singleton loader instance |
| `resetThinkingWordsLoader()` | Reset the loader (for testing) |

### Loader Methods

| Method | Description |
|--------|-------------|
| `getVersion()` | Dictionary version string |
| `getCategoryNames()` | List of all category names |
| `getCategoryDescription(cat)` | Description for a category |
| `getWordsForCategory(cat)` | Words for a single category (returns the words even for `excludeFromGeneric` categories — this is the explicit path that bypasses the pool exclusion) |
| `getAllWords()` | Flat array of all words **except** those in `excludeFromGeneric` categories (the "generic pool") |
| `getCategoriesForRole(role)` | Categories mapped to a role |
| `getWordsForRole(role)` | Words for a role (general + role-specific). Categories not present in `roleMapping` — including `excludeFromGeneric` ones — are never included here. |
| `getTotalWordCount()` | Total number of words in the generic pool (excludes `excludeFromGeneric` categories) |
| `getCategoryWordCount(cat)` | Word count for a single category (returns the count even for `excludeFromGeneric` categories) |

### Constants (Backward Compatibility)

| Constant | Description |
|----------|-------------|
| `THINKING_WORDS` | Flat readonly array of the generic pool (excludes `excludeFromGeneric` categories) |
| `THINKING_WORDS_BY_CATEGORY` | Words organized by category (includes ALL categories — this is the by-category map, not the generic pool) |
| `ROLE_CATEGORY_MAP` | Role → categories mapping |

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-30 | Added `clarification_hints` category + `excludeFromGeneric` flag (E3 / E3.5 of the V2 Agent Creation Phase 2 single-question feature) | New `clarification_hints` category (10 full-sentence phrases) used by `/v2/agents/new` between Phase 2 clarification questions; new `excludeFromGeneric: true` flag on `CategoryDefinition` keeps the category out of the generic word pool while keeping it reachable via `getWordsForCategory`/`getWordsForCategories`. See `docs/workplans/v2-agent-creation-phase2-single-question-workplan.md` § E3 / E3.5. |
