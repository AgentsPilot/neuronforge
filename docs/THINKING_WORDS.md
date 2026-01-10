# Thinking Words

Display rotating status words while agents are processing, providing visual feedback that work is in progress. Words are organized by category and can be personalized based on user role.

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

### Direct Access

```typescript
import {
  THINKING_WORDS,           // Flat array (all 90 words)
  THINKING_WORDS_BY_CATEGORY, // Words organized by category
  getWordsForRole,          // Get word array for a role
  getWordsForCategories     // Get words for specific categories
} from '@/lib/ui/thinking-words';

// Get words for a role (general + role-specific)
const salesWords = getWordsForRole('sales'); // ~40 words

// Get words for specific categories
const techWords = getWordsForCategories(['data_analysis', 'problem_solving']);
```

## Word Categories

| Category | Count | Examples |
|----------|-------|----------|
| `general` | 16 | Thinking, Processing, Analyzing, Evaluating |
| `business` | 16 | Forecasting, Crunching numbers, Calculating ROI |
| `data_analysis` | 15 | Parsing data, Cross-referencing, Pattern matching |
| `planning` | 13 | Charting course, Prioritizing, Scoping |
| `problem_solving` | 8 | Troubleshooting, Debugging, Finding solutions |
| `communication` | 6 | Drafting response, Composing, Fine-tuning |
| `progress` | 8 | Almost there, Final checks, Wrapping up |
| `friendly` | 8 | On it, Brewing ideas, Digging in |

## Role → Category Mapping

Each role gets `general` + role-specific categories:

| Role | Categories |
|------|------------|
| `business_owner` | general + business, planning, progress |
| `manager` | general + planning, communication, progress |
| `consultant` | general + planning, problem_solving, data_analysis |
| `operations` | general + data_analysis, problem_solving, business |
| `sales` | general + business, communication, friendly |
| `marketing` | general + data_analysis, planning, friendly |
| `finance` | general + business, data_analysis |
| `other` | general + friendly, progress |

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

## API Reference

### Types

```typescript
type ThinkingCategory =
  | 'general' | 'business' | 'data_analysis' | 'planning'
  | 'problem_solving' | 'communication' | 'progress' | 'friendly';

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
| `getShuffledThinkingWords()` | Shuffled array (all words) |
| `getShuffledThinkingWordsForRole(role)` | Shuffled array for a role |
| `getWordsForRole(role)` | Get word array for a role |
| `getWordsForCategories(categories)` | Get words for specific categories |

### Constants

| Constant | Description |
|----------|-------------|
| `THINKING_WORDS` | Flat readonly array (all 90 words) |
| `THINKING_WORDS_BY_CATEGORY` | Words organized by category |
| `ROLE_CATEGORY_MAP` | Role → categories mapping |
