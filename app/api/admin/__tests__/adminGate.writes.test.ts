/**
 * Slice 1 — every anonymous WRITE and destructive ACTION under /api/admin is
 * admin-only.
 *
 * ── What this proves, and why the denial assertions are the point ──────────
 * Before this slice, 21 of the 22 handlers below accepted a **fully anonymous**
 * request. Anyone on the internet who knew a URL could rewrite platform-wide
 * pricing tiers, credit rewards, model-routing weights and system limits;
 * trigger a bulk background job; mutate stored agent memory; and re-send
 * platform communications. The 22nd (`settings/admin-users`) accepted any
 * signed-in customer — and one of its two handlers is a GET that WRITES.
 *
 * A happy-path test would have passed on all of that. So the load-bearing
 * assertions here are the four denial cases, and in particular the one that
 * checks **nothing happened before the gate**: `mockTablesTouched` must be
 * empty on every denial. A route that returns 403 *after* running its query has
 * satisfied its status code and leaked its data anyway.
 *
 * ── The four denial cases, and why each exists ─────────────────────────────
 *   1. signed out                → 401  (FR-4)
 *   2. signed in, not an admin   → 403  (FR-4)
 *   3. the admin check THROWS    → 403, never 500 — fail closed (FR-3)
 *   4. the auth lookup THROWS    → 401, never 500 — fail closed (FR-3)
 *
 * Cases 3 and 4 matter more than they look. `components/admin/AdminCalibrationTrigger.tsx`
 * probes an admin route and hides itself on 401/403; if a failing admin check
 * produced a 500 instead, that component would render for non-admins. The
 * gate's contract is that it never converts an authorization outcome into a
 * server error.
 *
 * ── Deliberately NOT tested here ───────────────────────────────────────────
 * Handler behaviour beyond the gate. Slice 1 changes only who may enter; the
 * bodies are untouched, and slice 1L (logging conformance) uses this file
 * UNCHANGED as its regression oracle. If a test here needs editing in 1L, 1L
 * changed control flow and is no longer a logging-only diff.
 *
 * @see docs/workplans/admin-authz-unification.md — Slice 1
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }),
  },
}));

/** Every logger call made during a request, so denials can be inspected (FR-6). */
const loggedArgs: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...args: unknown[]) => {
      loggedArgs.push(...args);
    };
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/**
 * Tables touched, in order. THE assertion of this file: on a denial this must
 * be empty, proving the gate ran before any data access (FR-5).
 */
const mockTablesTouched: string[] = [];

/** A PostgREST-ish builder that accepts any chain and resolves empty. */
const builder = (): unknown =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null, count: 0 });
        }
        return () => builder();
      },
    }
  );

const fakeClient = () => ({
  from: (table: string) => {
    mockTablesTouched.push(table);
    return builder();
  },
  rpc: (fn: string) => {
    mockTablesTouched.push(`rpc:${fn}`);
    return builder();
  },
  auth: {
    admin: {
      listUsers: () => {
        mockTablesTouched.push('auth.admin.listUsers');
        return Promise.resolve({ data: { users: [] }, error: null });
      },
    },
  },
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: fakeClient() }));

/*
 * `lib/supabaseAdmin` THROWS at module load when `SUPABASE_URL` is unset, and
 * six admin routes import it at module scope (boost-packs, execution-tiers,
 * storage-tiers among them). The repo's Jest setup stubs
 * `NEXT_PUBLIC_SUPABASE_URL` but not `SUPABASE_URL`.
 *
 * Mocked rather than papered over with an env stub, because this test's whole
 * claim is "no data access happened" — a real client here could not make that
 * claim, and a half-configured one would make the failure mode depend on which
 * env vars the machine happens to carry.
 */
jest.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: fakeClient(),
  getSupabaseAdmin: () => fakeClient(),
  default: fakeClient(),
}));

// Services some routes reach for. Each records a touch, so "nothing happened
// before the gate" covers more than raw table access.
jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getInstance: () => ({
      get: () => {
        mockTablesTouched.push('SystemConfigService.get');
        return Promise.resolve(null);
      },
      set: () => {
        mockTablesTouched.push('SystemConfigService.set');
        return Promise.resolve();
      },
    }),
  },
}));
jest.mock('@/lib/services/EmbeddingService', () => ({
  EmbeddingService: {
    getInstance: () => ({
      backfill: () => {
        mockTablesTouched.push('EmbeddingService.backfill');
        return Promise.resolve({ processed: 0 });
      },
    }),
  },
}));

// ───────────────────────────────────────────────────────────────────────────

import * as agentGenerationConfig from '../agent-generation-config/route';
import * as aisConfig from '../ais-config/route';
import * as aisWeights from '../ais-weights/route';
import * as aisWeightsCombined from '../ais-weights/combined/route';
import * as aisWeightsCreation from '../ais-weights/creation/route';
import * as backfillEmbeddings from '../backfill-embeddings/route';
import * as boostPacks from '../boost-packs/route';
import * as calculatorConfig from '../calculator-config/route';
import * as executionTiers from '../execution-tiers/route';
import * as helpbotConfig from '../helpbot-config/route';
import * as memoryConfig from '../memory-config/route';
import * as memoryConsolidation from '../memory-consolidation/route';
import * as messagesById from '../messages/[id]/route';
import * as messagesReplay from '../messages/[id]/replay/route';
import * as migrateLabels from '../migrate-labels/route';
import * as onboardingConfig from '../onboarding-config/route';
import * as orchestrationConfig from '../orchestration-config/route';
import * as rewardConfig from '../reward-config/route';
import * as adminUsersSettings from '../settings/admin-users/route';
import * as storageTiers from '../storage-tiers/route';
import * as systemLimits from '../system-limits/route';
import * as uiConfig from '../ui-config/route';
import * as userEmails from '../user-emails/route';

// ── Slices 2 + 3 (2026-09-21) — the reads ─────────────────────────────────
import * as adminUsersList from '../users/route';
import * as userStats from '../users/[id]/stats/route';
import * as onboardingUsers from '../onboarding-users/route';
import * as platformUsers from '../settings/platform-users/route';
import * as tokenUsage from '../token-usage/route';
import * as tokenUsageDrill from '../token-usage/drill-down/route';
import * as tokenUsageStats from '../token-usage/stats/route';
import * as dashboard from '../dashboard/route';
import * as executionStats from '../execution-stats/route';
import * as storageStats from '../storage-stats/route';
import * as adminMessages from '../messages/route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };
const MSG_CTX = { params: { id: '99999999-9999-4999-8999-999999999999' } };
const TARGET_USER = '99999999-9999-4999-8999-999999999999';

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });

/**
 * Every handler slice 1 gates. The full list is the point — a route missing
 * from here is a route nobody proved.
 */
const CASES: Array<{ name: string; call: () => Promise<Response> }> = [
  // ── D1 — platform configuration writes (16 files) ────────────────────────
  { name: 'PUT /api/admin/agent-generation-config', call: () => agentGenerationConfig.PUT(req('/api/admin/agent-generation-config', 'PUT', { config: {} })) },
  { name: 'POST /api/admin/ais-config', call: () => aisConfig.POST(req('/api/admin/ais-config', 'POST', { action: 'x' })) },
  { name: 'PUT /api/admin/ais-weights', call: () => aisWeights.PUT(req('/api/admin/ais-weights', 'PUT', { weights: {} })) },
  { name: 'PUT /api/admin/ais-weights/combined', call: () => aisWeightsCombined.PUT(req('/api/admin/ais-weights/combined', 'PUT', { weights: {} })) },
  { name: 'PUT /api/admin/ais-weights/creation', call: () => aisWeightsCreation.PUT(req('/api/admin/ais-weights/creation', 'PUT', { weights: {} })) },
  { name: 'POST /api/admin/boost-packs', call: () => boostPacks.POST(req('/api/admin/boost-packs', 'POST', {})) },
  { name: 'PUT /api/admin/boost-packs', call: () => boostPacks.PUT(req('/api/admin/boost-packs', 'PUT', {})) },
  { name: 'DELETE /api/admin/boost-packs', call: () => boostPacks.DELETE(req('/api/admin/boost-packs?id=1', 'DELETE')) },
  { name: 'PUT /api/admin/calculator-config', call: () => calculatorConfig.PUT(req('/api/admin/calculator-config', 'PUT', { updates: {} })) },
  { name: 'POST /api/admin/execution-tiers', call: () => executionTiers.POST(req('/api/admin/execution-tiers', 'POST', {})) },
  { name: 'PUT /api/admin/execution-tiers', call: () => executionTiers.PUT(req('/api/admin/execution-tiers', 'PUT', {})) },
  { name: 'DELETE /api/admin/execution-tiers', call: () => executionTiers.DELETE(req('/api/admin/execution-tiers?configKey=k', 'DELETE')) },
  { name: 'PUT /api/admin/helpbot-config', call: () => helpbotConfig.PUT(req('/api/admin/helpbot-config', 'PUT', { config: {} })) },
  { name: 'PUT /api/admin/memory-config', call: () => memoryConfig.PUT(req('/api/admin/memory-config', 'PUT', { config: {} })) },
  { name: 'PUT /api/admin/onboarding-config', call: () => onboardingConfig.PUT(req('/api/admin/onboarding-config', 'PUT', { config: {} })) },
  { name: 'PUT /api/admin/orchestration-config', call: () => orchestrationConfig.PUT(req('/api/admin/orchestration-config', 'PUT', { config: {} })) },
  { name: 'POST /api/admin/reward-config', call: () => rewardConfig.POST(req('/api/admin/reward-config', 'POST', { action: 'x' })) },
  { name: 'POST /api/admin/storage-tiers', call: () => storageTiers.POST(req('/api/admin/storage-tiers', 'POST', {})) },
  { name: 'PUT /api/admin/storage-tiers', call: () => storageTiers.PUT(req('/api/admin/storage-tiers', 'PUT', {})) },
  { name: 'DELETE /api/admin/storage-tiers', call: () => storageTiers.DELETE(req('/api/admin/storage-tiers?configKey=k', 'DELETE')) },
  { name: 'PUT /api/admin/system-limits', call: () => systemLimits.PUT(req('/api/admin/system-limits', 'PUT', { limits: {} })) },
  { name: 'POST /api/admin/ui-config', call: () => uiConfig.POST(req('/api/admin/ui-config', 'POST', { action: 'x', data: {} })) },

  // ── D2 — destructive / operational actions (5 files) ─────────────────────
  // Highest urgency: irreversible or expensive, and `replay` can send
  // communications on the platform's behalf to real recipients.
  { name: 'POST /api/admin/backfill-embeddings', call: () => backfillEmbeddings.POST(req('/api/admin/backfill-embeddings', 'POST', { target: 'both' })) },
  { name: 'POST /api/admin/memory-consolidation', call: () => memoryConsolidation.POST(req('/api/admin/memory-consolidation', 'POST', {})) },
  { name: 'PATCH /api/admin/messages/[id]', call: () => messagesById.PATCH(req('/api/admin/messages/x', 'PATCH', { status: 'read' }), MSG_CTX) },
  { name: 'DELETE /api/admin/messages/[id]', call: () => messagesById.DELETE(req('/api/admin/messages/x', 'DELETE'), MSG_CTX) },
  { name: 'POST /api/admin/messages/[id]/replay', call: () => messagesReplay.POST(req('/api/admin/messages/x/replay', 'POST', {}), MSG_CTX) },
  { name: 'POST /api/admin/migrate-labels', call: () => migrateLabels.POST(req('/api/admin/migrate-labels', 'POST')) },

  // ── Category C — the write hidden behind a GET (finding N-1) ─────────────
  // Its GET upserts the caller in as `super_admin` with the service role when
  // the list is empty. It is gated in the WRITE slice because it is a write.
  { name: 'GET /api/admin/settings/admin-users (writes!)', call: () => adminUsersSettings.GET(req('/api/admin/settings/admin-users', 'GET')) },
  { name: 'POST /api/admin/settings/admin-users', call: () => adminUsersSettings.POST(req('/api/admin/settings/admin-users', 'POST', { action: 'add', email: 'x@y.z' })) },

  // ── Gated ahead of slice 2, on its own branch ────────────────────────────
  // `user-emails` is a READ shaped as a POST, so it was sorted into the read
  // slice — and slice 2 is parked. Until its gate, an ANONYMOUS caller could
  // POST a list of user ids and receive their EMAIL ADDRESSES, read with the
  // service role. It is a gated handler now, so it is proven here like any
  // other: four denial cases, each asserting nothing was touched.
  { name: 'POST /api/admin/user-emails', call: () => userEmails.POST(req('/api/admin/user-emails', 'POST', { userIds: ['11111111-1111-4111-8111-111111111111'] })) },

  // ── SLICE 2 (2026-09-21) — cross-tenant reads ───────────────────────────
  // The sensitive set. Until these gates, an ANONYMOUS caller could read every
  // platform user, any named user's usage, per-user LLM spend, platform-wide
  // operating metrics and the message log. The "touched nothing" assertion
  // matters more here than on the writes: the whole harm IS the query running.
  { name: 'GET /api/admin/users', call: () => adminUsersList.GET(req('/api/admin/users?page=1', 'GET')) },
  { name: 'HEAD /api/admin/users', call: () => adminUsersList.HEAD() },
  { name: 'GET /api/admin/users/[id]/stats', call: () => userStats.GET(req(`/api/admin/users/${TARGET_USER}/stats`, 'GET'), { params: Promise.resolve({ id: TARGET_USER }) }) },
  { name: 'GET /api/admin/onboarding-users', call: () => onboardingUsers.GET(req('/api/admin/onboarding-users?filter=all', 'GET')) },
  { name: 'GET /api/admin/settings/platform-users', call: () => platformUsers.GET(req('/api/admin/settings/platform-users?search=', 'GET')) },
  { name: 'GET /api/admin/token-usage', call: () => tokenUsage.GET(req('/api/admin/token-usage', 'GET')) },
  { name: 'HEAD /api/admin/token-usage', call: () => tokenUsage.HEAD() },
  { name: 'GET /api/admin/token-usage/drill-down', call: () => tokenUsageDrill.GET(req('/api/admin/token-usage/drill-down?period=30d', 'GET')) },
  { name: 'GET /api/admin/token-usage/stats', call: () => tokenUsageStats.GET(req('/api/admin/token-usage/stats', 'GET')) },
  { name: 'GET /api/admin/dashboard', call: () => dashboard.GET(req('/api/admin/dashboard?period=7d', 'GET')) },
  { name: 'HEAD /api/admin/dashboard', call: () => dashboard.HEAD() },
  { name: 'GET /api/admin/execution-stats', call: () => executionStats.GET() },
  { name: 'GET /api/admin/storage-stats', call: () => storageStats.GET() },
  { name: 'GET /api/admin/messages', call: () => adminMessages.GET(req('/api/admin/messages?page=1', 'GET')) },

  // ── SLICE 2 (2026-09-21) — internal-config reads ────────────────────────
  // Lower blast radius than the cross-tenant set — internal tuning, not
  // customer data — but anonymous all the same. Their write verbs were gated
  // in slice 1; this closes the read side of the SAME files.
  { name: 'GET /api/admin/agent-generation-config', call: () => agentGenerationConfig.GET() },
  { name: 'GET /api/admin/ais-config', call: () => aisConfig.GET() },
  { name: 'GET /api/admin/backfill-embeddings', call: () => backfillEmbeddings.GET() },
  { name: 'GET /api/admin/helpbot-config', call: () => helpbotConfig.GET() },
  { name: 'GET /api/admin/memory-config', call: () => memoryConfig.GET() },
  { name: 'GET /api/admin/memory-consolidation', call: () => memoryConsolidation.GET() },
  { name: 'GET /api/admin/onboarding-config', call: () => onboardingConfig.GET() },
  { name: 'GET /api/admin/orchestration-config', call: () => orchestrationConfig.GET() },
  { name: 'GET /api/admin/ui-config', call: () => uiConfig.GET() },

  // ── SLICE 3 (2026-09-21) — catalogue reads ──────────────────────────────
  // `reward-config` GET is the one that had LIVE CUSTOMER CALLERS. Its gate
  // and the replacement projection (`GET /api/rewards/agent-sharing`) ship in
  // the same commit, so no customer screen is stranded. The other three were
  // confirmed to have only admin-page callers.
  { name: 'GET /api/admin/reward-config', call: () => rewardConfig.GET(req('/api/admin/reward-config', 'GET')) },
  { name: 'GET /api/admin/boost-packs', call: () => boostPacks.GET(req('/api/admin/boost-packs', 'GET')) },
  { name: 'GET /api/admin/execution-tiers', call: () => executionTiers.GET() },
  { name: 'GET /api/admin/storage-tiers', call: () => storageTiers.GET() },
];

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  mockTablesTouched.length = 0;
  loggedArgs.length = 0;
});

describe('slice 1 — anonymous writes and destructive actions are refused', () => {
  it('covers every handler the slice gates', () => {
    // A route quietly dropped from this list is a route nobody proved. The
    // count is asserted so deleting a case is a visible, deliberate act.
    //
    // 30 from slice 1
    //  + 1  `user-emails#POST`, gated ahead of slice 2 on its own branch
    //  + 23 slice 2 (14 cross-tenant reads incl. 3 HEAD probes, 9 internal-config GETs)
    //  + 4  slice 3 catalogue GETs
    //  = 58, which is every admin handler now on the canonical gate EXCEPT the
    // 3 category-A system-config routes (covered by their own suites) and the 7
    // correct-but-inline copies (slice 4, still parked).
    expect(CASES).toHaveLength(58);
  });

  describe.each(CASES)('$name', ({ call }) => {
    it('401 when signed out, and touches nothing', async () => {
      mockGetUser.mockResolvedValue(null);

      const res = await call();

      expect(res.status).toBe(401);
      expect(mockTablesTouched).toEqual([]);
      expect(mockIsAdmin).not.toHaveBeenCalled();
    });

    it('403 for a signed-in non-admin, and touches nothing', async () => {
      mockGetUser.mockResolvedValue(CUSTOMER);
      mockIsAdmin.mockResolvedValue(false);

      const res = await call();

      expect(res.status).toBe(403);
      expect(mockTablesTouched).toEqual([]);
    });

    it('403 (not 500) when the admin check throws — fails closed', async () => {
      // A check that cannot answer is a "no". If this produced a 500, the
      // self-gating admin UI (AdminCalibrationTrigger) would stop hiding itself.
      mockGetUser.mockResolvedValue(CUSTOMER);
      mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));

      const res = await call();

      expect(res.status).toBe(403);
      expect(mockTablesTouched).toEqual([]);
    });

    it('401 (not 500) when the auth lookup throws — fails closed', async () => {
      mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));

      const res = await call();

      expect(res.status).toBe(401);
      expect(mockTablesTouched).toEqual([]);
    });

    it('lets a real admin through to the handler', async () => {
      // Proves the gate can PASS. Without this the denial assertions could all
      // be green because the route is broken rather than because it is gated.
      mockGetUser.mockResolvedValue(ADMIN);
      mockIsAdmin.mockResolvedValue(true);

      const res = await call();

      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe('denials leak nothing (FR-6, NFR-Security)', () => {
    it('no response body and no log line carries an email address', async () => {
      mockGetUser.mockResolvedValue(CUSTOMER);
      mockIsAdmin.mockResolvedValue(false);

      for (const { call } of CASES) {
        loggedArgs.length = 0;
        const res = await call();
        const body = await res.text();

        // The denial must not echo who the caller is, nor who the admins are.
        expect(body).not.toContain(CUSTOMER.email);
        expect(body).not.toContain(ADMIN.email);
        expect(body.toLowerCase()).not.toContain('admin_users');

        const logged = JSON.stringify(loggedArgs);
        expect(logged).not.toContain(CUSTOMER.email);
        expect(logged).not.toContain('@');
      }
    });

    it('the denial body is the same shape for anonymous and non-admin callers', async () => {
      // Denial responses must reveal nothing about whether the resource exists
      // or who the admins are.
      const { call } = CASES[0];

      mockGetUser.mockResolvedValue(null);
      const anon = await (await call()).json();

      mockGetUser.mockResolvedValue(CUSTOMER);
      mockIsAdmin.mockResolvedValue(false);
      const nonAdmin = await (await call()).json();

      expect(Object.keys(anon).sort()).toEqual(Object.keys(nonAdmin).sort());
      expect(anon.success).toBe(false);
      expect(nonAdmin.success).toBe(false);
    });
  });
});
