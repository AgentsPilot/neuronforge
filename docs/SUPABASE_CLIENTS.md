# Supabase Client Guide

This project has 4 Supabase client files, each designed for specific use cases. Using the wrong client can cause build errors, security issues, or unexpected behavior.

## Quick Reference

| File | Where to Use | RLS | Auth | Key Used |
|------|--------------|-----|------|----------|
| `supabaseClient.ts` | Client components | Yes | User session | Anon key |
| `supabaseServerAuth.ts` | API routes needing user auth | Yes | Cookie-based | Anon key |
| `supabaseServer.ts` | Repositories, background jobs | **Bypassed** | None | Service role |
| `supabaseAdmin.ts` | Admin operations | **Bypassed** | None | Service role |

## Detailed Usage

### 1. `supabaseClient.ts` - Browser Client

**When to use:**
- React components with `'use client'` directive
- Any client-side data fetching
- User-initiated actions in the browser

**Characteristics:**
- Uses `createBrowserClient` from `@supabase/ssr`
- Respects Row Level Security (RLS)
- User must be authenticated for protected data
- Safe to expose (uses anon key)

**Example:**
```typescript
'use client'
import { supabase } from '@/lib/supabaseClient'

// In a React component
const { data, error } = await supabase
  .from('agents')
  .select('*')
  .eq('user_id', userId)
```

---

### 2. `supabaseServerAuth.ts` - Authenticated Server Client

**When to use:**
- API routes that need to identify the logged-in user
- Server-side operations that should respect user permissions
- Any route where you need `cookies()` from `next/headers`

**Characteristics:**
- Uses `createServerClient` from `@supabase/ssr`
- Reads auth session from cookies
- Respects Row Level Security (RLS)
- **CANNOT be imported by client components** (uses `next/headers`)

**Example:**
```typescript
// app/api/my-route/route.ts
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'

export async function GET() {
  const supabase = await createAuthenticatedServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Query respects RLS - user can only see their own data
  const { data } = await supabase.from('agents').select('*')
  return Response.json(data)
}
```

---

### 3. `supabaseServer.ts` - Service Role Server Client

**When to use:**
- Repository classes (data access layer)
- Background jobs and scheduled tasks
- Operations that need to bypass RLS
- Code that may be transitively imported by client components

**Characteristics:**
- Uses service role key (bypasses RLS)
- No user authentication
- **Safe to import in files used by client components** (no `next/headers`)
- Use with caution - can access/modify any data

**Example:**
```typescript
// lib/repositories/AgentRepository.ts
import { supabaseServer } from '@/lib/supabaseServer'

// Bypass RLS - must manually filter by user_id
const { data } = await supabaseServer
  .from('agents')
  .select('*')
  .eq('user_id', userId) // IMPORTANT: Always filter manually!
```

---

### 4. `supabaseAdmin.ts` - Admin Client with Validation

**When to use:**
- Admin-only operations
- Scripts and migrations
- Operations requiring strict environment validation

**Characteristics:**
- Uses service role key (bypasses RLS)
- Includes environment variable validation
- Throws errors if env vars are missing
- Disables auto-refresh and session persistence

**Example:**
```typescript
// Admin operations only
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Will throw if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing
const { data } = await supabaseAdmin
  .from('system_config')
  .select('*')
```

---

## Decision Tree

```
Need Supabase client?
│
├─ Client component ('use client')?
│  └─ YES → supabaseClient.ts
│
├─ API route needing current user?
│  └─ YES → supabaseServerAuth.ts
│
├─ Repository / background job?
│  └─ YES → supabaseServer.ts
│
└─ Admin operation with env validation?
   └─ YES → supabaseAdmin.ts
```

## Common Mistakes

### Build Error: "next/headers" in client component
```
Error: You're importing a component that needs next/headers
```
**Cause:** Client component imports something that transitively imports `supabaseServerAuth.ts`
**Fix:** Use `supabaseServer.ts` instead, or refactor to use API routes

### RLS blocks data access
**Cause:** Using `supabaseClient.ts` or `supabaseServerAuth.ts` without proper auth
**Fix:** Ensure user is authenticated, or use service role client for admin operations

### Security: Exposing service role key
**Cause:** Using `supabaseServer.ts` or `supabaseAdmin.ts` in client-side code
**Fix:** These should only run server-side. Check for `'use client'` directive.

## Environment Variables

| Variable | Used By | Exposure |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | All clients | Public (safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client, ServerAuth | Public (safe) |
| `SUPABASE_URL` | Admin | Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server, Admin | Server only (secret!) |