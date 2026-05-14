---
name: new-api-route
description: Scaffolds a new Next.js API route under app/api/ using the canonical AgentPilot pattern — getUser auth, Zod validation, repository-pattern data access, structured Pino logging with correlation IDs, non-blocking AuditTrailService, and consistent error responses. Use when the user asks to create, add, or scaffold an API route, endpoint, or `/api/...` handler.
---

# new-api-route

Scaffold a new Next.js App Router API route that follows the project standards in `CLAUDE.md`.

> **Important:** Many existing routes in `app/api/` predate the current standards (raw Supabase clients, `console.log`, no Zod, no correlation IDs). **Do not copy them.** Use the template in this skill as the source of truth.

---

## Step 1 — Gather inputs

Before writing any code, confirm the following with the user. Ask only what isn't already obvious from their request:

| Input | Example | Notes |
|---|---|---|
| Resource path | `agents/[id]/duplicate` | kebab-case directories; `[param]` for dynamic segments |
| HTTP methods | `POST`, `GET`, `PUT`, `DELETE` | One file can export multiple |
| Entity / repository | `AgentRepository` | Must already exist in `lib/repositories/` — if not, recommend creating one first |
| Request body shape | `{ name: string, prompt: string }` | Used to build the Zod schema |
| Audit action name | `AGENT_DUPLICATED` | SCREAMING_SNAKE_CASE; omit if no state change |
| Auth model | user-scoped (default) / admin-only / public | Admin-only routes also need a role check; public routes skip `getUser` |

If the matching repository doesn't exist, **stop and tell the user** — don't fall back to direct Supabase calls in the route.

---

## Step 2 — Create the route file

**Path:** `app/api/<resource-path>/route.ts`

Use this template. Replace placeholders marked `<<...>>`. Delete handlers you don't need.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { <<EntityRepository>> } from '@/lib/repositories/<<EntityRepository>>';

const logger = createLogger({ module: '<<RouteName>>API' });
const auditTrail = AuditTrailService.getInstance();

const <<methodName>>Schema = z.object({
  // <<fields>>
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validated = <<methodName>>Schema.parse(body);

    requestLogger.info({ userId: user.id }, '<<RouteName>> request received');

    const repo = new <<EntityRepository>>();
    const { data, error } = await repo.<<method>>(validated, user.id);

    if (error) {
      requestLogger.error({ err: error, userId: user.id }, '<<RouteName>> failed');
      return NextResponse.json(
        { success: false, error: 'Failed to <<action>>' },
        { status: 500 }
      );
    }

    auditTrail.log({
      action: '<<AUDIT_ACTION>>',
      entityType: '<<entity>>',
      entityId: data!.id,
      userId: user.id,
      resourceName: data!.name,
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true, data });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, '<<RouteName>> request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : undefined,
      },
      { status: 500 }
    );
  }
}
```

### Variations

- **Dynamic route param:** signature becomes `(request: NextRequest, { params }: { params: { id: string } })`. Validate the param with a separate `z.string().uuid()` check before using it.
- **GET / list:** skip the body parse and Zod (use `request.nextUrl.searchParams` + a query schema). No audit log unless the read itself is sensitive.
- **Admin-only:** after `getUser()`, also check `user.app_metadata?.role === 'admin'` and return 403 otherwise.
- **Public route (e.g. webhooks):** skip `getUser`, but verify a signature/secret. Document why RLS is bypassed.

---

## Step 3 — Add the integration test

**Path:** `app/api/<resource-path>/__tests__/route.test.ts`

Per `CLAUDE.md`, every new API route ships with at minimum:
1. Happy path (200/201 with valid body and auth)
2. Auth failure (401 with no user)
3. Invalid input (400 with a body that fails Zod)

Mock `getUser`, the repository, and `AuditTrailService.getInstance().log` (return `Promise.resolve()`).

---

## Step 4 — Final checklist

Before reporting the task done, verify:

- [ ] File at `app/api/<resource-path>/route.ts` exists with the template above
- [ ] No `console.log` / `console.error` — only `requestLogger`
- [ ] No direct `supabase.from(...)` — all DB access via the repository
- [ ] Repository call passes `user.id` so the `.eq('user_id', userId)` filter is applied
- [ ] Zod schema validates the full body before any business logic runs
- [ ] Audit log uses `.catch()` (non-blocking) — never `await` it in the success path
- [ ] Error response uses `process.env.NODE_ENV === 'development'` guard for details
- [ ] Integration test covers happy path + 401 + 400
- [ ] `npm run lint` passes (TypeScript errors are ignored by `next.config.js` but **must still be fixed**)

---

## Anti-patterns to refuse

If the user asks for any of these, push back and offer the correct alternative:

| ❌ Anti-pattern | ✅ Correct |
|---|---|
| `import { createServerClient } from '@supabase/ssr'` directly in the route | Use the repository |
| `console.log('[API]', ...)` | `requestLogger.info({...}, 'message')` |
| `if (!body.name) return ... 400` (manual validation) | Zod schema with `.parse()` |
| `await auditTrail.log(...)` blocking the response | `.catch()` non-blocking |
| Returning raw `error.message` to client in production | Guard with `NODE_ENV === 'development'` |
| Skipping `.eq('user_id', userId)` because "it's just a read" | Always filter by user unless `supabaseServer` is intentional and documented |
