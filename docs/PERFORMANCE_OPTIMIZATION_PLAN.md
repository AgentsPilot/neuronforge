# Performance Optimization Plan

## Overview

This document tracks performance issues identified during navigation from `/v2/dashboard` to `/v2/sandbox/[agentId]` and their solutions.

**Analysis Date:** 2026-01-16
**Test Scenario:** Load v2/dashboard → Open agent → Navigate to sandbox page
**Test URL:** `http://localhost:3000/v2/sandbox/3b4c622c-703f-43f8-9074-e9eb0977bd1c`
**Total Time Observed:** ~3+ minutes (development mode)

---

## Timeline Summary

| Time | Event | Duration |
|------|-------|----------|
| 16:15:50 | Start compiling /v2/dashboard | 70.7s |
| 16:17:11 | Dashboard loads | 80,350ms total |
| 16:19:45 | Navigate to agent, compile begins | - |
| 16:19:54 | Start compiling /v2/sandbox/[agentId] | 19.3s |
| 16:20:35 | Sandbox page finally loads | ~45s from click |

---

## Issues Identified

### Bottleneck Analysis Table

| # | Priority | Issue | Duration | Impact | Root Cause | Solution | Effort | Status |
|---|----------|-------|----------|--------|------------|----------|--------|--------|
| 1 | 🟢 | Duplicate API calls to `/api/agents/.../executions` | 3 calls (3.6s + 1.1s + 3.8s = 8.5s) | **Both** | Component re-renders or multiple consumers | Dedupe with React Query/SWR cache or consolidate calls | **Easy** | ✅ Done |
| 2 | 🟢 | Duplicate calls to `/api/helpbot/page-contexts` & `/api/admin/helpbot-config` | 5s each, called twice (20s total) | **Both** | Same component mounted twice or re-render | Check component mounting, add request deduplication | **Easy** | ✅ Done |
| 3 | 🟢 | `/api/system-config` called separately for each key | 5.3s + 5.4s = 10.7s | **Both** | Two separate calls for `agent_sharing_reward_amount` and `tokens_per_pilot_credit` | Batch into single call with multiple keys | **Easy** | ✅ Done |
| 4 | 🟢 | Supabase auth check on every API call | 200-1,880ms per call | **Both** | `cache skip` - no caching of auth | Cache auth token validation for short period | **Easy** | ✅ Done |
| 5 | 🟡 | `/api/agents/.../memory/count` slow | 11-13s | **Both** | 4,145ms internal duration but 11s total - likely cold start + DB query | Add index, cache result, or lazy load | **Medium** | ✅ Done |
| 6 | 🟡 | `/api/agents/.../intensity` slow | 12.5s | **Both** | Multiple DB queries for weights + ranges | Cache AIS config (already shows 5-min cache, verify it works) | **Medium** | ✅ Done |
| 7 | 🟡 | `/api/plugins/user-status` highly variable | 1s - 49s | **Both** | Cold start, multiple DB queries, no caching | Add response caching, parallelize internal queries | **Medium** | ✅ Done |
| 8 | 🟡 | `/api/plugins/available` first call extremely slow | 87s first, then 584ms | **Dev only** | First compilation (33s) + cold DB/queries | Precompile during build, add caching | **Medium** | ⬜ TODO |
| 9 | 🔴 | Next.js dev compilation `/v2/dashboard` | 70.7s | **Dev only** | 1961 modules, dev mode JIT compilation | Split code/lazy load components, consider Turbopack | **Hard** | ⬜ TODO |
| 10 | 🔴 | Next.js dev compilation `/v2/sandbox/[agentId]` | 19.3s | **Dev only** | 2136 modules, dev mode JIT compilation | Same as above + shared module extraction | **Hard** | ⬜ TODO |
| 11 | 🔴 | EventEmitter memory leak warning | - | **Dev only** | 11 exit listeners added to process | Investigate listener cleanup in plugin system | **Hard** | ⬜ TODO |

### Impact Summary

| Impact | Count | Items |
|--------|-------|-------|
| **Both (Dev + Prod)** | 7 | #1, #2, #3, #4, #5, #6, #7 |
| **Dev only** | 4 | #8, #9, #10, #11 |

### Priority Legend

- 🟢 **Easy** - Quick win, can be done in < 1 hour
- 🟡 **Medium** - Requires investigation, 1-4 hours
- 🔴 **Hard** - Significant refactoring, 4+ hours

---

## Detailed Solutions

### Issue #1: Duplicate API calls to `/api/agents/.../executions`

**Problem:**
The executions endpoint is called 3 times during page load:
```
GET /api/agents/.../executions?includeTokens=true 200 in 3637ms  ← Main page
GET /api/agents/.../executions?includeTokens=true 200 in 1147ms  ← Duplicate (StrictMode)
GET /api/agents/.../executions?limit=1 200 in 3871ms             ← AgentIntensityCardV2
```

**Root Cause Analysis:**

| Call | Source | Location | Purpose |
|------|--------|----------|---------|
| `?includeTokens=true` | Agent detail page | `app/v2/agents/[id]/page.tsx:251` | Load execution history for display |
| `?includeTokens=true` (dup) | Same | React StrictMode double-mount | - |
| `?limit=1` | AgentIntensityCardV2 | `components/v2/agents/AgentIntensityCardV2.tsx:29` | Polls every 30s to detect new executions for AIS refresh |

**Why duplicates occur:**
1. `agentApi.getExecutions()` in `lib/client/agent-api.ts` doesn't use the existing `requestDeduplicator`
2. `AgentIntensityCardV2` fetches executions independently instead of receiving data from parent
3. React StrictMode in development causes components to mount twice

---

#### Solution A: Use Request Deduplication (Immediate Fix)

Wrap executions API calls with the existing `requestDeduplicator` utility.

**File to modify:** `lib/client/agent-api.ts`

**Changes:**

```typescript
// Add import at top
import { requestDeduplicator } from '@/lib/utils/request-deduplication'

// Modify getExecutions method
async getExecutions(agentId: string, userId: string, options?: { limit?: number; includeTokens?: boolean }): Promise<ApiResponse<Execution[]>> {
  const cacheKey = `executions-${agentId}-${options?.includeTokens || false}-${options?.limit || 'all'}`

  return requestDeduplicator.deduplicate(
    cacheKey,
    async () => {
      // ... existing fetch logic ...
    },
    5000 // 5 second cache TTL
  )
}
```

**Implementation checklist:**
- [ ] Import `requestDeduplicator` in `lib/client/agent-api.ts`
- [ ] Wrap `getExecutions` method with deduplication
- [ ] Test that duplicate calls are eliminated
- [ ] Verify cache invalidation works after agent runs

**Expected improvement:** Eliminates duplicate `?includeTokens=true` call (~1-4s saved)

---

#### Solution B: Eliminate Redundant Polling (Follow-up)

Have the parent page pass execution data to `AgentIntensityCardV2` instead of it fetching independently.

**Files to modify:**
- `components/v2/agents/AgentIntensityCardV2.tsx`
- `app/v2/agents/[id]/page.tsx`

**Changes to AgentIntensityCardV2:**

```typescript
interface AgentIntensityCardV2Props {
  agentId: string
  latestExecutionTime?: number  // NEW: Parent provides this
}

export function AgentIntensityCardV2({ agentId, latestExecutionTime }: AgentIntensityCardV2Props) {
  // Remove the polling useEffect that fetches executions (lines 24-56)
  // Use latestExecutionTime prop directly to trigger AIS refresh

  useEffect(() => {
    // Only fetch intensity, not executions
    fetchIntensity(latestExecutionTime > 0)
  }, [agentId, user?.id, latestExecutionTime])
}
```

**Changes to parent page:**

```typescript
// In app/v2/agents/[id]/page.tsx
// Pass latest execution time from already-fetched executions
<AgentIntensityCardV2
  agentId={agentId}
  latestExecutionTime={executions[0]?.started_at ? new Date(executions[0].started_at).getTime() : 0}
/>
```

**Implementation checklist:**
- [ ] Add `latestExecutionTime` prop to `AgentIntensityCardV2`
- [ ] Remove execution polling useEffect from `AgentIntensityCardV2`
- [ ] Update parent page to pass `latestExecutionTime`
- [ ] Test AIS score still refreshes after agent runs

**Expected improvement:** Eliminates `?limit=1` call entirely (~3-4s saved)

---

**Total expected savings:** ~5-8 seconds per page load

---

### Issue #2: Duplicate calls to helpbot APIs

**Problem:**
```
GET /api/helpbot/page-contexts 200 in 5052ms
GET /api/admin/helpbot-config 200 in 5060ms
GET /api/helpbot/page-contexts 200 in 1128ms  (duplicate)
GET /api/admin/helpbot-config 200 in 1287ms   (duplicate)
```

**Root Cause Analysis:**

| Call | Source | Location | Purpose |
|------|--------|----------|---------|
| `/api/helpbot/page-contexts` | HelpBot component | `components/v2/HelpBot.tsx:136` | Load page-specific help topics |
| `/api/admin/helpbot-config` | HelpBot component | `components/v2/HelpBot.tsx:161` | Load theme colors for bot UI |
| (duplicates) | Same | React StrictMode double-mount | - |

**Why duplicates occur:**
1. `HelpBot.tsx` fetches both APIs in a `useEffect` on mount (lines 133-187)
2. No client-side caching or request deduplication
3. React StrictMode causes double-mount in development
4. APIs have `export const dynamic = 'force-dynamic'` - no server-side caching
5. Data is static config that rarely changes - perfect candidate for long-term caching

**Architecture note:** The layout (`app/v2/layout.tsx`) correctly excludes HelpBot on pages that have their own (`/v2/agents/[id]/run`, `/v2/sandbox/[agentId]`), so this is not a double-include issue.

---

#### Solution A: Add Request Deduplication (Immediate Fix)

Wrap HelpBot API calls with `requestDeduplicator` using a long TTL since this is config data.

**File to modify:** `components/v2/HelpBot.tsx`

**Changes:**

```typescript
// Add import at top
import { requestDeduplicator } from '@/lib/utils/request-deduplication'

// In the useEffect (around line 133), modify the fetch functions:

async function loadPageContexts() {
  try {
    const result = await requestDeduplicator.deduplicate(
      'helpbot-page-contexts',
      async () => {
        const response = await fetch('/api/helpbot/page-contexts')
        return response.json()
      },
      300000 // 5 minute cache - config rarely changes
    )

    if (result.success && result.contexts) {
      // ... existing logic
    }
  } catch (error) {
    console.error('[HelpBot] Failed to load page contexts:', error)
    setContextsLoaded(true)
  }
}

async function loadThemeColors() {
  try {
    const result = await requestDeduplicator.deduplicate(
      'helpbot-theme-config',
      async () => {
        const response = await fetch('/api/admin/helpbot-config')
        return response.json()
      },
      300000 // 5 minute cache
    )

    if (result.success && result.config?.theme) {
      // ... existing logic
    }
  } catch (error) {
    console.error('[HelpBot] Failed to load theme colors:', error)
  } finally {
    setThemeLoaded(true)
  }
}
```

**Implementation checklist:**
- [ ] Import `requestDeduplicator` in `components/v2/HelpBot.tsx`
- [ ] Wrap `loadPageContexts()` with deduplication (5 min TTL)
- [ ] Wrap `loadThemeColors()` with deduplication (5 min TTL)
- [ ] Test that duplicate calls are eliminated
- [ ] Verify HelpBot still works correctly after config changes

**Expected improvement:** Eliminates duplicate calls (~6-10s saved on page load)

---

#### Solution B: Create HelpBot Context Provider (Follow-up)

Move HelpBot data fetching to a context provider at the layout level, so data is fetched once and shared across all HelpBot instances.

**Files to create/modify:**
- Create: `lib/contexts/HelpBotContext.tsx`
- Modify: `app/v2/layout.tsx`
- Modify: `components/v2/HelpBot.tsx`

**Benefits:**
- Single fetch for entire session
- Easier to manage cache invalidation
- Cleaner separation of concerns
- Data available to any component that needs it

**Implementation checklist:**
- [ ] Create `HelpBotProvider` context with page contexts and theme colors
- [ ] Fetch data once in provider (with deduplication)
- [ ] Wrap V2 layout with `HelpBotProvider`
- [ ] Update `HelpBot.tsx` to consume context instead of fetching
- [ ] Test across all pages with HelpBot

**Expected improvement:** Single fetch per session, instant subsequent loads

---

**Total expected savings:** ~6-10 seconds per page load

---

### Issue #3: Separate system-config calls

**Problem:**
```
GET /api/system-config?keys=agent_sharing_reward_amount 200 in 5346ms
GET /api/system-config?keys=tokens_per_pilot_credit 200 in 5469ms
```

**Root Cause Analysis:**

| Call | Source | Location | Purpose |
|------|--------|----------|---------|
| `?keys=tokens_per_pilot_credit` | `fetchTokensPerPilotCredit()` | `app/v2/agents/[id]/page.tsx:173` | Get token-to-credit conversion rate |
| `?keys=agent_sharing_reward_amount` | `fetchSharingRewardAmount()` | `app/v2/agents/[id]/page.tsx:181` | Get reward amount for sharing |

**Why separate calls occur:**
1. Two separate functions (`fetchTokensPerPilotCredit`, `fetchSharingRewardAmount`) are called independently in the same useEffect (lines 145-146)
2. The `systemConfigApi.getByKeys()` already supports multiple keys, but it's not being used that way
3. Each call incurs full network round-trip + DB query overhead

**The API already supports batching:** `?keys=key1,key2,key3` returns all values in one response.

---

#### Solution A: Batch Config Fetches (Immediate Fix)

Combine the two fetch functions into a single batched call.

**File to modify:** `app/v2/agents/[id]/page.tsx`

**Changes:**

```typescript
// Replace lines 145-146 and functions at 172-185 with:

// In useEffect (around line 144):
fetchAgentData()
fetchPageConfig()  // Single batched call
fetchShareRewardStatus()

// New combined function:
const fetchPageConfig = async () => {
  const result = await systemConfigApi.getByKeys([
    'tokens_per_pilot_credit',
    'agent_sharing_reward_amount'
  ])

  if (result.success && result.data) {
    // Tokens per credit
    const tokensValue = Number(result.data['tokens_per_pilot_credit'])
    if (tokensValue > 0 && tokensValue <= 1000) {
      setTokensPerPilotCredit(tokensValue)
    }

    // Sharing reward amount
    const rewardValue = Number(result.data['agent_sharing_reward_amount'])
    if (rewardValue) {
      setSharingRewardAmount(rewardValue)
    }
  }
}

// Remove: fetchTokensPerPilotCredit() and fetchSharingRewardAmount()
```

**Implementation checklist:**
- [ ] Create `fetchPageConfig()` function that batches both keys
- [ ] Remove `fetchTokensPerPilotCredit()` and `fetchSharingRewardAmount()` functions
- [ ] Update useEffect to call `fetchPageConfig()` instead
- [ ] Test that both values are still loaded correctly

**Expected improvement:** Eliminates one API call (~5s saved)

---

#### Solution B: Add Request Deduplication + Caching (Follow-up)

Add deduplication to `systemConfigApi` for all config calls with a longer TTL since config rarely changes.

**File to modify:** `lib/client/agent-api.ts`

**Changes:**

```typescript
// Add import
import { requestDeduplicator } from '@/lib/utils/request-deduplication'

// Modify getByKeys method
async getByKeys(keys: string[]): Promise<ApiResponse<Record<string, unknown>>> {
  const sortedKeys = [...keys].sort().join(',')
  const cacheKey = `system-config-${sortedKeys}`

  return requestDeduplicator.deduplicate(
    cacheKey,
    async () => {
      const response = await fetch(`/api/system-config?keys=${encodeURIComponent(sortedKeys)}`)
      const data = await response.json()

      if (!response.ok || data.error) {
        return { success: false, error: data.error || 'Failed to fetch config' }
      }

      return { success: true, data: data.data }
    },
    60000 // 1 minute cache - config rarely changes
  )
}
```

**Implementation checklist:**
- [ ] Import `requestDeduplicator` in `lib/client/agent-api.ts`
- [ ] Wrap `getByKeys()` with deduplication (1 min TTL)
- [ ] Normalize key order to improve cache hits
- [ ] Test config values are still accurate after changes

**Expected improvement:** Subsequent calls return instantly from cache

---

**Total expected savings:** ~5-10 seconds per page load

---

### Issue #4: Supabase auth not cached

**Problem:**
Every API call triggers a fresh auth check:
```
GET https://...supabase.../auth/v1/user 200 in 445ms (cache skip)
GET https://...supabase.../auth/v1/user 200 in 1880ms (cache skip)
```

**Root Cause Analysis:**

| Pattern | Location | Impact |
|---------|----------|--------|
| `createAuthenticatedServerClient()` + `getUser()` | `app/api/plugins/user-status/route.ts:68-69` | 200-1,880ms per call |
| Same pattern in 39+ API routes | Various API routes | Multiplied across all calls |

**Why this happens:**
1. `supabase.auth.getUser()` makes a fresh network call to Supabase's `/auth/v1/user` endpoint every time
2. This validates the JWT by calling Supabase - by design for security
3. No caching layer exists between API routes and Supabase auth
4. The `(cache skip)` in logs confirms the Supabase client isn't using any cache
5. With multiple API calls per page load, this adds up to several seconds

**Current auth patterns in codebase:**
- Some routes use `x-user-id` header (trusted, no validation) - fastest
- Some routes call `supabase.auth.getUser()` (validated, slow)
- Inconsistent approach across API routes

---

#### Solution A: Create Cached Auth Utility (Immediate Fix)

Create a cached wrapper around `getUser()` that caches the result for 30 seconds using the access token as the cache key.

**File to create:** `lib/server/cachedAuth.ts`

**Implementation:**

```typescript
// lib/server/cachedAuth.ts
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth'
import { User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Simple in-memory cache for auth results
const authCache = new Map<string, { user: User; timestamp: number }>()
const AUTH_CACHE_TTL = 30000 // 30 seconds

export async function getCachedUser(): Promise<User | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('sb-access-token')?.value

  if (!accessToken) {
    return null
  }

  // Check cache first
  const cached = authCache.get(accessToken)
  if (cached && Date.now() - cached.timestamp < AUTH_CACHE_TTL) {
    return cached.user
  }

  // Cache miss - validate with Supabase
  const supabase = await createAuthenticatedServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return null
  }

  // Cache the result
  authCache.set(accessToken, { user, timestamp: Date.now() })

  // Cleanup old entries periodically
  if (authCache.size > 1000) {
    const now = Date.now()
    for (const [key, value] of authCache.entries()) {
      if (now - value.timestamp > AUTH_CACHE_TTL) {
        authCache.delete(key)
      }
    }
  }

  return user
}
```

**Usage in API routes:**

```typescript
// Before:
const supabase = await createAuthenticatedServerClient()
const { data: { user }, error } = await supabase.auth.getUser()

// After:
import { getCachedUser } from '@/lib/server/cachedAuth'
const user = await getCachedUser()
```

**Implementation checklist:**
- [ ] Create `lib/server/cachedAuth.ts` with `getCachedUser()` function
- [ ] Update high-traffic API routes to use `getCachedUser()`:
  - [ ] `/api/plugins/user-status/route.ts`
  - [ ] `/api/agents/[id]/intensity/route.ts`
  - [ ] `/api/agents/[id]/memory/count/route.ts`
- [ ] Test that auth still works correctly
- [ ] Monitor cache hit rate in development

**Expected improvement:** Eliminates duplicate auth calls within 30s window (~200-1,880ms saved per cached call)

---

#### Solution B: Middleware-Based Auth (Follow-up)

Move auth validation to Next.js middleware, store validated user in request headers, so API routes don't need to call Supabase at all.

**Files to modify:**
- `middleware.ts`
- All API routes that need auth

**Changes to middleware:**

```typescript
// In middleware.ts - add auth validation
export async function middleware(request: NextRequest) {
  // ... existing routing logic ...

  // For API routes that need auth
  if (pathname.startsWith('/api') && !isPublicApiRoute(pathname)) {
    const supabase = createServerClient(...)
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      // Add user info to headers for API routes
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-authenticated-user-id', user.id)
      requestHeaders.set('x-authenticated-user-email', user.email || '')

      return NextResponse.next({
        request: { headers: requestHeaders }
      })
    }
  }

  return NextResponse.next()
}
```

**Changes to API routes:**

```typescript
// API routes read from headers instead of calling Supabase
function getAuthenticatedUser(request: NextRequest) {
  const userId = request.headers.get('x-authenticated-user-id')
  const email = request.headers.get('x-authenticated-user-email')

  if (!userId) return null
  return { id: userId, email }
}
```

**Implementation checklist:**
- [ ] Add auth validation to middleware for API routes
- [ ] Pass validated user via request headers
- [ ] Update API routes to read from headers
- [ ] Test auth flow end-to-end
- [ ] Handle edge cases (token refresh, logout)

**Expected improvement:** Single auth call per request (in middleware), all API routes get user instantly

---

#### Alternative: Use `getSession()` for Non-Critical Routes

For routes where security is less critical (read-only data, non-sensitive operations), use `getSession()` instead of `getUser()`. This validates the JWT locally without a network call.

```typescript
// Faster but less secure - JWT validated locally only
const { data: { session } } = await supabase.auth.getSession()
const user = session?.user
```

**Trade-off:** If the JWT is tampered with or revoked server-side, `getSession()` won't detect it. Only use for non-critical operations.

---

**Total expected savings:** ~1-5 seconds per page load (depending on number of API calls)

---

### Issue #5: Memory count endpoint slow

**Problem:**
```
[16:19:57.387] Memory count request received
[16:20:01.526] Memory count request completed
    duration: 4145ms (internal)
GET /api/agents/.../memory/count 200 in 11115ms (total)
```

**Root Cause Analysis:**

| Step | Location | Time |
|------|----------|------|
| Verify agent ownership | `agentRepository.findById()` | ~2s |
| Count memories | `memoryRepository.countByAgentId()` | ~4s |
| Total internal | | 4145ms |
| Total with cold start | | 11115ms |

**Why it's slow:**
1. Two sequential DB queries: agent ownership check + memory count
2. `run_memories` table may lack proper index on `agent_id`
3. Cold start overhead adds ~7 seconds (compilation)
4. No caching - every request hits the database

---

#### Solution A: Add Client-Side Caching (Immediate Fix)

Add request deduplication on the client side to avoid redundant calls.

**File to modify:** `lib/client/agent-api.ts`

```typescript
async getMemoryCount(agentId: string, userId: string): Promise<ApiResponse<number>> {
  const cacheKey = `memory-count-${agentId}`

  return requestDeduplicator.deduplicate(
    cacheKey,
    async () => {
      // existing fetch logic
    },
    30000 // 30 second cache - memory count doesn't change often
  )
}
```

**Implementation checklist:**
- [ ] Wrap `getMemoryCount` with `requestDeduplicator`
- [ ] Test that duplicate calls are eliminated

**Expected improvement:** Eliminates duplicate calls on page load

---

#### Solution B: Server-Side Response Caching (Follow-up)

Add in-memory caching on the API route, similar to `user-status` route.

**File to modify:** `app/api/agents/[id]/memory/count/route.ts`

```typescript
// Add at top of file
const memoryCountCache = new Map<string, { count: number; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute

// In GET handler, before DB queries:
const cached = memoryCountCache.get(agentId)
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return NextResponse.json({ success: true, count: cached.count })
}

// After getting count, cache it:
memoryCountCache.set(agentId, { count: count || 0, timestamp: Date.now() })
```

**Implementation checklist:**
- [ ] Add in-memory cache to route
- [ ] Add cache invalidation when memory is added/deleted
- [ ] Test cache hit/miss behavior

**Expected improvement:** Subsequent requests return in <10ms

---

**Total expected savings:** ~4-11 seconds per request (cached)

---

### Issue #6: Intensity endpoint slow

**Problem:**
```
GET /api/agents/.../intensity 200 in 12530ms
```

**Root Cause Analysis:**

| Query | Location | Purpose |
|-------|----------|---------|
| `agents` table | Line 66-70 | Verify ownership + get design data |
| `agent_intensity_metrics` | Line 81-85 | Get metrics |
| `token_usage` (creation) | Line 158-162 | Sum creation tokens |
| `AISConfigService.getExecutionWeights()` | Line 183 | Get weights from DB |
| `AISConfigService.getCreationWeights()` | Line 184 | Get weights from DB |
| `AISConfigService.getRanges()` | Line 204 | Get AIS ranges |
| `SystemConfigService.getRoutingConfig()` | Line 126 | Get routing config |

**Why it's slow:**
1. **7 sequential database queries** - none parallelized
2. AIS config queries (weights, ranges) should be cached but may not be
3. `token_usage` aggregation query can be slow without proper index
4. Cold start overhead adds compilation time

---

#### Solution A: Parallelize Independent Queries (Immediate Fix)

Use `Promise.all()` to run independent queries concurrently.

**File to modify:** `app/api/agents/[id]/intensity/route.ts`

```typescript
// In GET handler, after agent verification (line 78):

// Run independent queries in parallel
const [metrics, executionWeights, creationWeights, ranges, routingConfig] = await Promise.all([
  supabase.from('agent_intensity_metrics').select('*').eq('agent_id', agentId).single(),
  AISConfigService.getExecutionWeights(supabase),
  AISConfigService.getCreationWeights(supabase),
  AISConfigService.getRanges(supabase),
  SystemConfigService.getRoutingConfig(supabase),
])

// Then in buildIntensityBreakdown, pass the pre-fetched values instead of fetching again
```

**Implementation checklist:**
- [ ] Identify which queries are independent
- [ ] Wrap independent queries in `Promise.all()`
- [ ] Pass pre-fetched config to `buildIntensityBreakdown()`
- [ ] Test that intensity still calculates correctly

**Expected improvement:** ~50% reduction (queries run in parallel instead of sequential)

---

#### Solution B: Cache AIS Config Globally (Follow-up)

AIS weights and ranges rarely change - cache them at module level.

**File to modify:** `lib/services/AISConfigService.ts`

```typescript
// Add module-level cache
let cachedWeights: { execution: any; creation: any; timestamp: number } | null = null
let cachedRanges: { ranges: any; timestamp: number } | null = null
const CONFIG_CACHE_TTL = 300000 // 5 minutes

static async getExecutionWeights(supabase: SupabaseClient) {
  if (cachedWeights && Date.now() - cachedWeights.timestamp < CONFIG_CACHE_TTL) {
    return cachedWeights.execution
  }
  // ... fetch from DB
  cachedWeights = { execution: weights, creation: null, timestamp: Date.now() }
  return weights
}
```

**Implementation checklist:**
- [ ] Add module-level cache for weights
- [ ] Add module-level cache for ranges
- [ ] Add cache invalidation mechanism (optional admin endpoint)
- [ ] Test that config changes still take effect after TTL

**Expected improvement:** Config queries return instantly from cache

---

**Total expected savings:** ~6-10 seconds per request

---

### Issue #7: Plugin user-status variable performance

**Problem:**
```
Response times vary wildly: 1s to 49s depending on cold start state.
First call: 12,127ms
Subsequent: 741ms - 3,450ms
```

**Root Cause Analysis:**

| Step | Method | Sequential? |
|------|--------|-------------|
| Get plugin manager instance | `PluginManagerV2.getInstance()` | Yes - may involve init |
| Get connected plugins | `getConnectedPlugins(userId)` | Yes |
| Get expired plugin keys | `getActiveExpiredPluginKeys(userId)` | Yes |
| Get disconnected plugins | `getDisconnectedPlugins(userId)` | Yes |

**Why it's variable:**
1. `PluginManagerV2.getInstance()` may involve expensive initialization on first call
2. Three sequential plugin queries that could run in parallel
3. Route already has 30s response cache (`pluginStatusCache`) but not hitting it
4. Cold start adds compilation overhead

**Good news:** Route already has a `ResponseCache` class with 30s TTL (lines 14-57)

---

#### Solution A: Parallelize Plugin Queries (Immediate Fix)

The three plugin queries are independent and can run in parallel.

**File to modify:** `app/api/plugins/user-status/route.ts`

```typescript
// Replace sequential calls (lines 109-119) with parallel:

// Run all plugin queries in parallel
const [connectedPlugins, activeExpiredKeys] = await Promise.all([
  pluginManager.getConnectedPlugins(userId),
  pluginManager.getActiveExpiredPluginKeys(userId),
])

const connectedKeys = Object.keys(connectedPlugins)
const allActiveKeys = [...connectedKeys, ...activeExpiredKeys]

// This one depends on connectedKeys, so must be sequential
const disconnectedPlugins = await pluginManager.getDisconnectedPlugins(userId, allActiveKeys)
```

**Implementation checklist:**
- [ ] Wrap `getConnectedPlugins` and `getActiveExpiredPluginKeys` in `Promise.all()`
- [ ] Keep `getDisconnectedPlugins` sequential (depends on results)
- [ ] Test that plugin status still displays correctly

**Expected improvement:** ~30-40% reduction on uncached requests

---

#### Solution B: Extend Response Cache TTL (Follow-up)

Current cache is 30 seconds. Plugin connections don't change often - could extend to 2-5 minutes.

**File to modify:** `app/api/plugins/user-status/route.ts`

```typescript
// Change line 16 from:
private TTL = 30000; // 30 seconds

// To:
private TTL = 120000; // 2 minutes - plugin connections rarely change
```

**Implementation checklist:**
- [ ] Extend cache TTL to 2 minutes
- [ ] Add cache invalidation on connect/disconnect (in respective routes)
- [ ] Test that status updates after connecting a plugin

**Expected improvement:** Cache hits for 2 minutes instead of 30 seconds

---

**Total expected savings:** ~3-8 seconds on uncached requests

---

### Issue #8: `/api/plugins/available` first call extremely slow (Dev only)

**Problem:**
```
First call: 87,348ms (87 seconds!)
Subsequent calls: 584ms
```

**Root Cause Analysis:**

| Component | Time | Impact |
|-----------|------|--------|
| Next.js route compilation | ~33s | First request triggers JIT compilation |
| Plugin discovery/loading | ~30s | Scanning plugin definitions |
| Database queries | ~20s | Cold connection + queries |
| Total first call | ~87s | Dominated by compilation |

**Why it's slow:**
1. Route is not pre-compiled in development mode
2. Plugin definitions are loaded from filesystem on each cold start
3. No preloading/warming mechanism exists
4. Database connection pool starts cold

---

#### Solution A: Add Response Caching (Quick Win)

Add in-memory caching to the route similar to `user-status`.

**File to modify:** `app/api/plugins/available/route.ts`

```typescript
// Add at top of file
const availablePluginsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 300000; // 5 minutes - plugin list rarely changes

// In GET handler, before plugin loading:
const cacheKey = 'available-plugins';
const cached = availablePluginsCache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return NextResponse.json(cached.data);
}

// After building response:
availablePluginsCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
```

**Implementation checklist:**
- [ ] Add in-memory cache to route
- [ ] Set 5 minute TTL (plugin list is static)
- [ ] Add cache invalidation endpoint for admin use
- [ ] Test subsequent requests return from cache

**Expected improvement:** Subsequent requests return in <10ms (vs 584ms uncached)

---

#### Solution B: Preload Plugins at Startup (Follow-up)

Initialize plugin manager and cache plugins during server startup.

**Files to modify:**
- `lib/server/plugin-manager-v2.ts`
- `next.config.js` (instrumentation)

```typescript
// In instrumentation.ts (Next.js 13+)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Preload plugin manager on server start
    const { PluginManagerV2 } = await import('@/lib/server/plugin-manager-v2');
    await PluginManagerV2.getInstance();
    console.log('[Startup] Plugin manager preloaded');
  }
}
```

**Implementation checklist:**
- [ ] Create `instrumentation.ts` file
- [ ] Enable `instrumentationHook` in next.config.js
- [ ] Preload PluginManagerV2 during startup
- [ ] Verify plugins are cached before first request

**Expected improvement:** First request avoids plugin loading overhead (~30s saved)

---

**Total expected savings:** First call reduced from 87s to ~33s (compilation only)

---

### Issue #9: Next.js dev compilation `/v2/dashboard` slow (Dev only)

**Problem:**
```
✓ Compiled /v2/dashboard in 70.7s (1961 modules)
```

**Root Cause Analysis:**

| Factor | Impact |
|--------|--------|
| Module count | 1961 modules is significant |
| Webpack bundling | Dev mode doesn't optimize |
| No code splitting | All components loaded upfront |
| Heavy dependencies | Monaco editor, charts, etc. |

**Why it's slow:**
1. Dashboard imports many heavy components (charts, tables, etc.)
2. No dynamic imports for below-the-fold content
3. Development mode uses unoptimized webpack
4. Each page visit re-compiles if cache is cold

---

#### Solution A: Enable Turbopack (Quick Win)

Turbopack is Next.js's new bundler, significantly faster than Webpack.

**File to modify:** `package.json`

```json
{
  "scripts": {
    "dev": "next dev --turbo"
  }
}
```

**Implementation checklist:**
- [ ] Update dev script to use `--turbo` flag
- [ ] Test all pages work with Turbopack
- [ ] Document any compatibility issues
- [ ] Fall back to webpack if needed: `next dev` (no flag)

**Expected improvement:** 2-5x faster compilation (70s → 15-35s)

**Known limitations:**
- Some webpack plugins may not work
- Custom webpack config needs migration
- May have edge cases with certain imports

---

#### Solution B: Code Splitting with Dynamic Imports (Follow-up)

Lazy load heavy components that aren't needed immediately.

**Files to modify:** `app/v2/dashboard/page.tsx` and related components

```typescript
// Before: Static import
import { HeavyChartComponent } from '@/components/charts/HeavyChart';

// After: Dynamic import
import dynamic from 'next/dynamic';

const HeavyChartComponent = dynamic(
  () => import('@/components/charts/HeavyChart'),
  {
    loading: () => <ChartSkeleton />,
    ssr: false // Client-side only for interactive charts
  }
);
```

**Candidates for dynamic import:**
- [ ] Charts and graphs (recharts, etc.)
- [ ] Monaco editor (if used)
- [ ] Large data tables with sorting/filtering
- [ ] HelpBot component (not critical for initial load)
- [ ] Agent cards below the fold

**Implementation checklist:**
- [ ] Identify components >50KB in bundle
- [ ] Convert to dynamic imports with loading states
- [ ] Add proper skeleton loaders
- [ ] Verify functionality after lazy loading
- [ ] Measure bundle size reduction

**Expected improvement:** Initial bundle reduced by 30-50%, faster first paint

---

#### Solution C: Shared Module Extraction (Long-term)

Configure webpack to extract shared modules into common chunks.

**File to modify:** `next.config.js`

```javascript
module.exports = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          // Separate vendor chunk for large libraries
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
          // Common chunk for shared code
          common: {
            minChunks: 2,
            priority: -10,
            reuseExistingChunk: true,
          },
        },
      };
    }
    return config;
  },
};
```

**Implementation checklist:**
- [ ] Analyze bundle with `@next/bundle-analyzer`
- [ ] Configure splitChunks for vendor separation
- [ ] Test all routes still work
- [ ] Measure compilation time improvement

**Expected improvement:** Better caching, faster subsequent navigations

---

**Total expected savings:** 50-70% reduction in dev compilation time

---

### Issue #10: Next.js dev compilation `/v2/sandbox/[agentId]` slow (Dev only)

**Problem:**
```
✓ Compiled /v2/sandbox/[agentId] in 19.3s (2136 modules)
```

**Root Cause Analysis:**

| Factor | Impact |
|--------|--------|
| Module count | 2136 modules (more than dashboard!) |
| Monaco editor | Heavy code editor dependency |
| Real-time execution UI | Complex state management |
| Plugin integrations | Dynamic plugin loading |

**Why it's slow:**
1. Sandbox page has more modules than dashboard (2136 vs 1961)
2. Monaco editor alone is ~2MB+ of JavaScript
3. Real-time log streaming requires complex components
4. Plugin UI components loaded for all possible plugins

---

#### Solution A: Lazy Load Monaco Editor (High Impact)

Monaco editor is likely the largest dependency. Load it only when needed.

**File to modify:** Components using Monaco

```typescript
// Before
import Editor from '@monaco-editor/react';

// After
import dynamic from 'next/dynamic';

const Editor = dynamic(
  () => import('@monaco-editor/react'),
  {
    loading: () => <CodeEditorSkeleton />,
    ssr: false
  }
);
```

**Implementation checklist:**
- [ ] Identify all Monaco editor usages
- [ ] Convert to dynamic imports
- [ ] Create loading skeleton that matches editor dimensions
- [ ] Test editor functionality after lazy loading

**Expected improvement:** ~2MB reduction in initial bundle, faster first load

---

#### Solution B: Defer Non-Critical UI (Follow-up)

Load execution history, logs panel, and other secondary UI after main content.

```typescript
// In sandbox page
const [showSecondaryUI, setShowSecondaryUI] = useState(false);

useEffect(() => {
  // Load secondary UI after main content is interactive
  const timer = setTimeout(() => setShowSecondaryUI(true), 100);
  return () => clearTimeout(timer);
}, []);

return (
  <main>
    <AgentRunner /> {/* Critical - load immediately */}

    {showSecondaryUI && (
      <>
        <ExecutionHistory />
        <LogsPanel />
        <PluginStatus />
      </>
    )}
  </main>
);
```

**Implementation checklist:**
- [ ] Identify critical vs non-critical components
- [ ] Implement deferred loading pattern
- [ ] Add smooth transitions/skeletons
- [ ] Measure time-to-interactive improvement

**Expected improvement:** Faster perceived load time, better user experience

---

#### Solution C: Share Modules with Dashboard (Long-term)

Since both pages share many modules, configure webpack to reuse compiled chunks.

**Analysis needed:**
```bash
# Run bundle analyzer to see shared modules
ANALYZE=true npm run build
```

**Implementation checklist:**
- [ ] Run bundle analyzer on both routes
- [ ] Identify modules compiled twice
- [ ] Configure common chunk extraction
- [ ] Test navigation between dashboard and sandbox

**Expected improvement:** Second page load much faster (shared modules cached)

---

**Total expected savings:** Compilation time reduced from 19s to ~8-12s

---

### Issue #11: EventEmitter memory leak warning (Dev only)

**Problem:**
```
MaxListenersExceededWarning: Possible EventEmitter memory leak detected.
11 exit listeners added to [process]. Use emitter.setMaxListeners() to increase limit
```

**Root Cause Analysis:**

| Suspect | Location | Pattern |
|---------|----------|---------|
| Plugin manager | `lib/server/plugin-manager-v2.ts` | May add exit handlers on each getInstance() |
| Database connections | Supabase client | Connection cleanup handlers |
| File watchers | Next.js dev server | HMR file watching |
| Process handlers | Various | Graceful shutdown handlers |

**Why it happens:**
1. Something is adding `process.on('exit', ...)` handlers repeatedly
2. In development, hot module replacement causes re-initialization
3. Each re-init adds new listeners without removing old ones
4. After 11 listeners, Node.js warns about potential leak

---

#### Solution A: Diagnose the Source (First Step)

Run the dev server with trace-warnings to identify the exact location.

**Command:**
```bash
NODE_OPTIONS='--trace-warnings' npm run dev
```

This will show a stack trace pointing to exactly where the listeners are being added.

**Implementation checklist:**
- [ ] Run with `--trace-warnings` flag
- [ ] Capture the stack trace
- [ ] Identify the file/line adding listeners
- [ ] Document the source

**Expected outcome:** Know exactly which code to fix

---

#### Solution B: Singleton Pattern with Cleanup (If Plugin Manager)

If the plugin manager is the culprit, ensure proper singleton behavior with cleanup.

**File to modify:** `lib/server/plugin-manager-v2.ts`

```typescript
class PluginManagerV2 {
  private static instance: PluginManagerV2 | null = null;
  private static exitHandler: (() => void) | null = null;

  static async getInstance(): Promise<PluginManagerV2> {
    if (this.instance) {
      return this.instance;
    }

    this.instance = new PluginManagerV2();
    await this.instance.initialize();

    // Only add exit handler once
    if (!this.exitHandler) {
      this.exitHandler = () => {
        this.instance?.cleanup();
        this.instance = null;
      };
      process.on('exit', this.exitHandler);
    }

    return this.instance;
  }

  // For HMR in development
  static reset() {
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      this.exitHandler = null;
    }
    this.instance = null;
  }
}

// In development, handle HMR
if (process.env.NODE_ENV === 'development') {
  // @ts-ignore
  if (module.hot) {
    // @ts-ignore
    module.hot.dispose(() => {
      PluginManagerV2.reset();
    });
  }
}
```

**Implementation checklist:**
- [ ] Track exit handler at class level
- [ ] Only add handler if not already added
- [ ] Add reset() method for HMR
- [ ] Test that warning disappears

**Expected improvement:** Warning eliminated, cleaner process handling

---

#### Solution C: Increase Max Listeners (Temporary Workaround)

If the listeners are intentional, increase the limit to suppress the warning.

**File to modify:** Entry point or plugin manager

```typescript
// Only do this if listeners are intentional and properly cleaned up
process.setMaxListeners(20); // Increase from default 10
```

**⚠️ Warning:** This is a workaround, not a fix. Only use if:
- You've verified the listeners are intentional
- They're properly cleaned up on process exit
- The actual count is bounded (won't grow indefinitely)

**Implementation checklist:**
- [ ] Verify listeners are intentional
- [ ] Count actual number needed
- [ ] Set limit to actual need + small buffer
- [ ] Add comment explaining why

**Expected improvement:** Warning suppressed (but root cause not fixed)

---

**Recommended approach:**
1. First, run Solution A to diagnose
2. If plugin manager: implement Solution B
3. Only use Solution C as last resort

---

## Implementation Progress

| Date | Issue # | Changes Made | Result |
|------|---------|--------------|--------|
| 2026-01-17 | #1A | Added `requestDeduplicator` to `agentApi.getExecutions()` in `lib/client/agent-api.ts` | ✅ Implemented |
| 2026-01-17 | #2A | Added `requestDeduplicator` to HelpBot's `loadPageContexts()` and `loadThemeColors()` in `components/v2/HelpBot.tsx` | ✅ Implemented |
| 2026-01-17 | #3A | Combined `fetchTokensPerPilotCredit()` and `fetchSharingRewardAmount()` into single `fetchPageConfig()` in `app/v2/agents/[id]/page.tsx` | ✅ Implemented |
| 2026-01-17 | #4A | Created `lib/cachedAuth.ts` with `getCachedUser()`, updated `/api/plugins/user-status` to use it | ✅ Implemented |
| 2026-01-17 | #1B | Added `latestExecutionTime` prop to `AgentIntensityCardV2`, parent now passes execution time to avoid redundant `?limit=1` polling | ✅ Implemented |
| 2026-01-17 | #5A | Added `requestDeduplicator` to `agentApi.getMemoryCount()` with 30s cache TTL in `lib/client/agent-api.ts` | ✅ Implemented |
| 2026-01-17 | #6A | Parallelized queries in `/api/agents/[id]/intensity`: metrics+routingConfig in GET handler, and creationTokens+weights+ranges in buildIntensityBreakdown | ✅ Implemented |
| 2026-01-17 | #7A | Parallelized `getConnectedPlugins` and `getActiveExpiredPluginKeys` queries in `/api/plugins/user-status` using `Promise.all()` | ✅ Implemented |

---

## Measurement Methodology

To measure improvements, use the following process:

1. Clear browser cache and restart dev server
2. Navigate to `/v2/dashboard`
3. Wait for full load
4. Click on an agent to open details
5. Navigate to sandbox page
6. Record times from dev.log

**Key metrics to track:**
- Total page load time
- Individual API response times
- Number of duplicate requests
