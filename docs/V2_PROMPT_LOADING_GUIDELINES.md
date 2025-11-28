# Prompt Loading Guidelines

This document describes how LLM prompts should be managed across the codebase.

---

## Overview

All LLM prompts must be stored as external text files and loaded using the `PromptLoader` utility class. This approach ensures:

- **Separation of concerns**: Prompt content is decoupled from application logic
- **Maintainability**: Prompts can be updated without code changes
- **Versioning**: Easy to track prompt iterations
- **Consistency**: Single pattern across all services

---

## File Location

All prompt templates must be stored in:

```
app/api/prompt-templates/
```

---

## Naming Convention

**Recommended format:**

```
[ServiceName]-[Version]-[TargetLLM].txt
```

| Component | Description | Example |
|-----------|-------------|---------|
| `ServiceName` | Descriptive name of the service or feature | `Workflow-Agent-Creation-Prompt` |
| `Version` | Version identifier (recommended) | `v10` |
| `TargetLLM` | Target LLM provider | `chatgpt`, `claude`, `gemini` |

**Examples:**
- `Workflow-Agent-Creation-Prompt-v10-chatgpt.txt`
- `Code-Review-Assistant-v2-claude.txt`
- `Data-Analysis-Helper-v1-chatgpt.txt`

---

## Usage

### 1. Import the PromptLoader

```typescript
import { PromptLoader } from '@/app/api/types/PromptLoader';
```

### 2. Define the Template Name

Define the template filename as a constant at the top of your file:

```typescript
const aiPromptTemplate = "MyService-Prompt-v1-chatgpt";
```

### 3. Load the Prompt

```typescript
const promptLoader = new PromptLoader(aiPromptTemplate);
const systemPrompt = promptLoader.getPrompt();
```

> **Note:** The `.txt` extension is added automatically if not provided.

---

## Dynamic Placeholders

Use `replaceKeywords()` to inject dynamic values into your prompt template.

### Supported Placeholder Formats

- Double braces: `{{keyword}}`
- Single braces: `{keyword}`

### Template Example

```text
You are an assistant helping {{user_name}}.
Your role is {role}.
```

### Code Example

```typescript
const promptLoader = new PromptLoader("MyService-Prompt-v1-chatgpt");
const customizedPrompt = promptLoader.replaceKeywords({
  user_name: "Alice",
  role: "technical advisor"
});
```

### Output

```text
You are an assistant helping Alice.
Your role is technical advisor.
```

---

## Complete Example

```typescript
import { PromptLoader } from '@/app/api/types/PromptLoader';

const aiPromptTemplate = "MyService-Prompt-v1-chatgpt";

export async function POST(request: Request) {
  // Load prompt
  const promptLoader = new PromptLoader(aiPromptTemplate);

  // Option A: Get raw prompt
  const systemPrompt = promptLoader.getPrompt();

  // Option B: Get prompt with dynamic values
  const customizedPrompt = promptLoader.replaceKeywords({
    user_name: "Alice",
    context: "data analysis"
  });

  // Use the prompt with your LLM provider...
}
```

---

## Version Recommendation

When iterating on prompts:

1. **Create a new version** rather than modifying existing ones
2. **Update the constant** in your code to point to the new version
3. **Keep previous versions** for rollback capability

```typescript
// Before
const aiPromptTemplate = "MyService-Prompt-v1-chatgpt";

// After iteration
const aiPromptTemplate = "MyService-Prompt-v2-chatgpt";
```

---

## Reference Implementation

See [init-thread/route.ts](../app/api/agent-creation/init-thread/route.ts) for a complete implementation example.