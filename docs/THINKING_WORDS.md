# Thinking Words

Display rotating status words while agents are processing, providing visual feedback that work is in progress.

## Usage

### Random Word (Simple)

```typescript
import { getRandomThinkingWord } from '@/lib/ui/thinking-words';

// Display a random word each time
const status = getRandomThinkingWord(); // "Analyzing"
```

### Sequential Cycling (Recommended for UI)

```typescript
import { createThinkingWordCycler } from '@/lib/ui/thinking-words';

const getNextWord = createThinkingWordCycler();

// Each call returns the next word in sequence
setInterval(() => {
  setStatus(getNextWord()); // "Thinking" → "Processing" → "Analyzing" → ...
}, 2000);
```

### Shuffled List (Non-repetitive)

```typescript
import { getShuffledThinkingWords } from '@/lib/ui/thinking-words';

const words = getShuffledThinkingWords();
// Iterate through without repetition until exhausted
```

### Direct Array Access

```typescript
import { THINKING_WORDS } from '@/lib/ui/thinking-words';

// Access the full readonly array (95 words)
console.log(THINKING_WORDS.length); // 95
```

## Word Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| General | Universal processing states | Thinking, Processing, Evaluating |
| Business/SMB | Domain-relevant terms | Forecasting, Crunching numbers, Calculating ROI |
| Data & Analysis | Technical operations | Parsing data, Cross-referencing, Pattern matching |
| Planning | Strategy-focused | Charting course, Prioritizing, Scoping |
| Problem Solving | Debugging/resolution | Troubleshooting, Finding solutions |
| Progress | Near-completion states | Almost there, Final checks, Wrapping up |
| Friendly | Casual tone | On it, Brewing ideas, Digging in |

## React Example

```tsx
import { useState, useEffect } from 'react';
import { createThinkingWordCycler } from '@/lib/ui/thinking-words';

function ThinkingIndicator({ isProcessing }: { isProcessing: boolean }) {
  const [word, setWord] = useState('Processing');

  useEffect(() => {
    if (!isProcessing) return;

    const getNext = createThinkingWordCycler();
    setWord(getNext());

    const interval = setInterval(() => setWord(getNext()), 2000);
    return () => clearInterval(interval);
  }, [isProcessing]);

  if (!isProcessing) return null;

  return <span className="animate-pulse">{word}...</span>;
}
```