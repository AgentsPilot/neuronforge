---
name: new-repository
description: Scaffolds a new repository class under lib/repositories/ following the project's data-access pattern — SupabaseClient injection, structured logging, RepositoryResult return shape, mandatory user_id filtering, soft-delete semantics, and singleton export. Use when the user asks to create, add, or scaffold a repository, data-access layer, or "DB wrapper" for a new entity.
---

# new-repository

Create a new repository class in `lib/repositories/`. Repositories are the **only** place in the codebase allowed to call Supabase directly — every API route, service, and component goes through them.

---

## Step 1 — Gather inputs

Ask before writing code:

| Input | Example | Notes |
|---|---|---|
| Entity name | `Workflow` | PascalCase singular |
| Table name | `workflows` | snake_case plural; must already exist in Supabase |
| Has soft delete? | yes / no | If yes, table must have `status` column with `'deleted'` value and `deleted_at` timestamp |
| Has status transitions? | yes / no | If yes, define them in `types.ts` (see `STATUS_TRANSITIONS` in `lib/repositories/types.ts`) |
| RLS bypass needed? | usually no | Default `supabaseServer` (service role) — document why if intentional |
| Methods needed | `findById`, `findAllByUser`, `create`, `update`, `softDelete` | Standard set; extend as needed |

If the table doesn't exist yet, **stop and tell the user** — don't generate a repository for a non-existent table.

---

## Step 2 — Add types

**File:** `lib/repositories/types.ts` (append)

```typescript
export interface <<Entity>> {
  id: string;
  user_id: string;
  // ... domain fields
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Create<<Entity>>Input {
  user_id: string;
  // ... fields required at creation
}

export interface Update<<Entity>>Input {
  // ... fields the caller may change (no user_id, no id)
}
```

The shared `RepositoryResult<T>` shape is already exported as `AgentRepositoryResult<T>` in `types.ts` — reuse it (or rename to `RepositoryResult<T>` if creating a new generic alias is cleaner).

---

## Step 3 — Create the repository file

**File:** `lib/repositories/<<Entity>>Repository.ts`

Use this template — it mirrors `AgentRepository.ts`, the canonical example:

```typescript
// lib/repositories/<<Entity>>Repository.ts
// Repository for managing <<entity>> persistence

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  <<Entity>>,
  Create<<Entity>>Input,
  Update<<Entity>>Input,
  AgentRepositoryResult as RepositoryResult,
} from './types';

export class <<Entity>>Repository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: '<<Entity>>Repository' });
  }

  // ============ Query Operations ============

  async findById(id: string, userId: string): Promise<RepositoryResult<<<Entity>>>> {
    try {
      const { data, error } = await this.supabase
        .from('<<table>>')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)        // mandatory
        .neq('status', 'deleted')     // omit if no soft delete
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  async findAllByUser(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<RepositoryResult<<<Entity>>[]>> {
    try {
      let query = this.supabase
        .from('<<table>>')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });

      if (options?.limit) query = query.limit(options.limit);
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // ============ CRUD Operations ============

  async create(input: Create<<Entity>>Input): Promise<RepositoryResult<<<Entity>>>> {
    const methodLogger = this.logger.child({ method: 'create', userId: input.user_id });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('<<table>>')
        .insert({ ...input })
        .select()
        .single();

      if (error) throw error;

      methodLogger.info(
        { id: data.id, duration: Date.now() - startTime },
        '<<Entity>> created'
      );
      return { data, error: null };
    } catch (error) {
      methodLogger.error(
        { err: error, duration: Date.now() - startTime },
        'Failed to create <<entity>>'
      );
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    input: Update<<Entity>>Input
  ): Promise<RepositoryResult<<<Entity>>>> {
    try {
      const { data, error } = await this.supabase
        .from('<<table>>')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .neq('status', 'deleted')
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // ============ Delete Operations (soft delete preferred) ============

  async softDelete(id: string, userId: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'softDelete', id, userId });

    try {
      const { error } = await this.supabase
        .from('<<table>>')
        .update({
          deleted_at: new Date().toISOString(),
          status: 'deleted',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .neq('status', 'deleted');

      if (error) throw error;
      methodLogger.info('<<Entity>> soft deleted');
      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to soft delete <<entity>>');
      return { data: false, error: error as Error };
    }
  }
}

// Singleton instance for convenience
export const <<entity>>Repository = new <<Entity>>Repository();
```

**Variations:**

- **No soft delete on the table** — drop the `.neq('status', 'deleted')` filters and the `softDelete` method; provide a `delete` method using `.delete()` instead.
- **Status transitions** — copy the `updateStatus` / `STATUS_TRANSITIONS` pattern from `AgentRepository.ts`, with the transitions defined in `types.ts`.
- **Service-role bypass needed** (e.g., admin queries) — pass `supabaseServer` explicitly and add a code comment: `// Intentionally bypasses RLS — admin-only context`.

---

## Step 4 — Export from the index

**File:** `lib/repositories/index.ts`

Add the class, singleton, and types to the exports. Pattern:

```typescript
export { <<Entity>>Repository, <<entity>>Repository } from './<<Entity>>Repository';

export type {
  <<Entity>>,
  Create<<Entity>>Input,
  Update<<Entity>>Input,
} from './types';
```

---

## Step 5 — Add the unit test

**File:** `lib/repositories/__tests__/<<Entity>>Repository.test.ts`

Per `CLAUDE.md`, repositories ship with a **unit test for each method**. Mock the `SupabaseClient` and inject it via the constructor (that's why the constructor takes one).

Minimum coverage:
- `findById` — found, not-found, wrong user (returns null because `.eq('user_id', ...)` filters it out)
- `findAllByUser` — empty, populated, with pagination
- `create` — success, supabase error
- `update` — success, soft-deleted record returns null
- `softDelete` — success, idempotent on already-deleted

---

## Step 6 — Final checklist

- [ ] Class file at `lib/repositories/<<Entity>>Repository.ts`
- [ ] Constructor accepts optional `SupabaseClient` (for tests)
- [ ] Every query includes `.eq('user_id', userId)` — no exceptions without a documented reason
- [ ] Every method returns `{ data, error }` — never throws to the caller
- [ ] Logger is `createLogger({ service: '<<Entity>>Repository' })` — no `console.log`
- [ ] Singleton exported at the bottom of the file
- [ ] Types added to `types.ts` and re-exported from `index.ts`
- [ ] Class exported from `index.ts` (both the class and the singleton)
- [ ] Unit tests cover each method's happy path + at least one error path
- [ ] **`'use client'` files do NOT import this repository** — repositories are server-only

---

## Anti-patterns to refuse

| ❌ Don't | ✅ Do |
|---|---|
| Skip `.eq('user_id', userId)` because "RLS will catch it" | Always include it. RLS is defence-in-depth, not the only line. |
| `throw error` from a repository method | Return `{ data: null, error }` — let the caller decide |
| Use `supabaseServer` without a comment explaining why | Default to it but document if you're intentionally bypassing user-scoped reads |
| Hard delete by default | Soft delete (status + deleted_at) is the project default |
| Import the repository in a `'use client'` component | Repositories are server-only — call them via an API route |
| Use `console.error('repo failed:', err)` | `this.logger.error({ err }, 'repo failed')` |
| Inline new query patterns instead of reusing helpers | If you find yourself repeating logic across repositories, extract it — but ask SA first per CLAUDE.md rule #7 |
