/**
 * GET /api/system/health — static liveness probe (SA Q6 / Q-B / Q-D, AC-15).
 *
 * Covers: 200 with exactly the `{ success, data: { status, timestamp } }` shape,
 * no error/env detail in the body, `force-dynamic` so the timestamp is per
 * request, and that no Supabase client is ever loaded.
 */

// Jest evaluates mock factories lazily, on the first import of the module.
// So this factory only throws if the route (or anything it imports) loads
// `@/lib/supabaseServer`. It is the "no service-role query" assertion, not
// dead setup.
jest.mock('@/lib/supabaseServer', () => {
  throw new Error('/api/system/health must not load @/lib/supabaseServer');
});

import { GET, dynamic } from '../route';

describe('GET /api/system/health', () => {
  it('returns 200 with the standard envelope and nothing else', async () => {
    const res = GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'success']);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['status', 'timestamp']);
    expect(body.data.status).toBe('ok');
  });

  it('returns a valid ISO timestamp', async () => {
    const body = await GET().json();
    const ts: string = body.data.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('exposes no error, details or environment information', async () => {
    const raw = JSON.stringify(await GET().json());
    for (const key of ['error', 'details', 'environment', 'database', 'hasSupabase']) {
      expect(raw).not.toContain(key);
    }
  });

  it('is force-dynamic so the timestamp is not frozen at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });
});
