# User Context for LLM Personalization

This document describes the `lib/user-context` module, which provides utilities for building and managing user context to personalize LLM interactions.

## Overview

User context allows LLMs to personalize responses based on who the user is. This includes their name, email, role, company, and domain. By providing this context, agents can tailor their language, suggestions, and outputs to be more relevant.

## Location

```
lib/user-context/
├── index.ts      # Barrel export
├── types.ts      # UserContext type definition
└── builders.ts   # Context building utilities
```

## Type Definition

```typescript
interface UserContext {
  full_name?: string;  // User's display name
  email?: string;      // User's email address
  role?: string;       // User's role (admin, user, viewer)
  company?: string;    // User's company/organization
  domain?: string;     // User's business domain (e.g., "marketing", "engineering")
}
```

## Available Functions

### `buildUserContextFromAuth(user: User): UserContext`

Builds user context from Supabase auth metadata. This is the **fast path** - no database call required.

**Use when:** You need user context quickly and auth metadata is sufficient.

```typescript
import { getUser } from '@/lib/auth';
import { buildUserContextFromAuth } from '@/lib/user-context';

const user = await getUser();
const userContext = buildUserContextFromAuth(user);
```

### `buildUserContextFromProfile(user: User): Promise<UserContext>`

Builds enriched user context by fetching from the `profiles` table. This is the **complete path** - makes a database call to get the full profile.

**Use when:** You need the most accurate/complete user data and can tolerate a DB query.

```typescript
import { getUser } from '@/lib/auth';
import { buildUserContextFromProfile } from '@/lib/user-context';

const user = await getUser();
const userContext = await buildUserContextFromProfile(user);
```

### `mergeUserContext(serverContext, clientContext?): UserContext`

Merges server-side context with optional client-provided overrides. Client values take priority when provided.

**Use when:** The client can send additional context (e.g., from a form) that should override server defaults.

```typescript
import { mergeUserContext } from '@/lib/user-context';

const serverContext = buildUserContextFromAuth(user);
const finalContext = mergeUserContext(serverContext, request.user_context);
```

## Usage Patterns

### Pattern 1: Basic LLM Call (Fast Path)

For most LLM calls where you just need basic user context:

```typescript
import { getUser } from '@/lib/auth';
import { buildUserContextFromAuth } from '@/lib/user-context';

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return unauthorized();

  const userContext = buildUserContextFromAuth(user);

  // Include in your LLM message
  const messages = [
    {
      role: 'system',
      content: `You are helping ${userContext.full_name} from ${userContext.company}...`
    },
    // ... rest of messages
  ];

  const completion = await provider.chatCompletion({ messages });
}
```

### Pattern 2: With Client Overrides

When the client may provide additional context:

```typescript
import { getUser } from '@/lib/auth';
import { buildUserContextFromAuth, mergeUserContext } from '@/lib/user-context';

export async function POST(request: NextRequest) {
  const user = await getUser();
  const body = await request.json();

  const serverContext = buildUserContextFromAuth(user);
  const userContext = mergeUserContext(serverContext, body.user_context);

  // userContext now has client overrides applied
}
```

### Pattern 3: Full Profile Data

When you need complete profile information:

```typescript
import { getUser } from '@/lib/auth';
import { buildUserContextFromProfile } from '@/lib/user-context';

export async function POST(request: NextRequest) {
  const user = await getUser();

  // This makes a DB call to fetch the full profile
  const userContext = await buildUserContextFromProfile(user);

  // userContext has the most up-to-date profile data
}
```

### Pattern 4: Structured LLM Input

For agent creation or workflows that expect structured input:

```typescript
import { buildUserContextFromAuth, mergeUserContext } from '@/lib/user-context';

const serverContext = buildUserContextFromAuth(user);
const userContext = mergeUserContext(serverContext, request.user_context);

const userMessage = {
  phase: 1,
  user_prompt: request.prompt,
  user_context: userContext,  // Include as structured field
  connected_services: services
};

await provider.addMessageToThread(threadId, {
  role: 'user',
  content: JSON.stringify(userMessage)
});
```

## Data Sources

| Field       | Auth Metadata          | Profiles Table |
|-------------|------------------------|----------------|
| full_name   | `user_metadata.full_name` or `user_metadata.name` | `profiles.full_name` |
| email       | `user.email`           | N/A (from auth) |
| role        | `user_metadata.role`   | `profiles.role` |
| company     | `user_metadata.company`| `profiles.company` |
| domain      | `user_metadata.domain` | N/A |

**Note:** `buildUserContextFromProfile` prefers profile table values over auth metadata for `full_name`, `role`, and `company`.

## Backward Compatibility

The `UserContext` type is re-exported from `components/agent-creation/types/agent-prompt-threads.ts` for backward compatibility. Existing imports continue to work:

```typescript
// Both of these work:
import type { UserContext } from '@/lib/user-context';
import type { UserContext } from '@/components/agent-creation/types/agent-prompt-threads';
```

## When to Include User Context

Include user context in LLM calls when:

- Personalizing greetings or responses
- Tailoring suggestions to the user's role or company
- Agent creation flows (required for all phases)
- Workflow generation where user domain matters
- Any feature that benefits from knowing who the user is

## Example: Refactoring Existing Code

Before (inline context building):
```typescript
const serverUserContext = {
  full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
  email: user.email || '',
  role: user.user_metadata?.role || '',
  company: user.user_metadata?.company || '',
  domain: user.user_metadata?.domain || ''
};
const mergedUserContext = { ...serverUserContext, ...user_context };
```

After (using the module):
```typescript
import { buildUserContextFromAuth, mergeUserContext } from '@/lib/user-context';

const serverContext = buildUserContextFromAuth(user);
const userContext = mergeUserContext(serverContext, user_context);
```
