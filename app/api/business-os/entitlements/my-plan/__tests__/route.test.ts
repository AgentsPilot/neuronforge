/**
 * `GET /api/business-os/entitlements/my-plan` — the gate, the isolation, and the
 * two ways it can fail.
 *
 * ── The assertion that matters most ─────────────────────────────────────────
 * **The account resolved is the session's, and there is no way to ask for
 * another one.** This is the first entitlement data a non-admin can see, and the
 * usual shape — accept an id, then check it belongs to you — puts one comparison
 * between a customer and somebody else's plan.
 *
 * So the isolation here is structural rather than checked: the handler takes no
 * path parameter, no query string and no body. Two tests hold that, one on the
 * behaviour (a caller who asks for another account is ignored, not obeyed) and
 * one on the source (nothing reads `searchParams` or a body), because behaviour
 * alone would pass on a handler that read a parameter and then discarded it by
 * accident.
 *
 * ── Why there is no Zod schema to test ──────────────────────────────────────
 * Zod validates input. The absence of input is the property being protected, and
 * a schema for nothing would be a comment pretending to be a check.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

const CUSTOMER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SOMEBODY_ELSE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const state = {
  user: null as { id: string } | null,
  /** Which account id the service was asked about. The isolation assertion. */
  askedFor: [] as string[],
  snapshot: null as unknown,
  unavailable: false,
  throws: false,
};

jest.mock('@/lib/auth', () => ({
  getUser: async () => state.user,
}));

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshot: async (accountId: string) => {
      state.askedFor.push(accountId);
      if (state.throws) throw new Error('database on fire');
      return { resolution: state.snapshot, unavailable: state.unavailable, stale: false };
    },
  }),
}));

// The view builder is `server-only` and real here: this suite is about the
// route, and stubbing the thing that decides what a customer is told would make
// a green test say nothing about the endpoint.
import { GET } from '@/app/api/business-os/entitlements/my-plan/route';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const NOW = new Date('2026-09-27T00:00:00.000Z');

function resolutionFor(planId: string) {
  const config = readCodeConfig();
  return resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });
}

function request(url = 'https://example.test/api/business-os/entitlements/my-plan') {
  return new NextRequest(url);
}

/** Block and line comments removed, so a source guard reads code and not prose. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  state.user = { id: CUSTOMER };
  state.askedFor = [];
  state.snapshot = resolutionFor('basic');
  state.unavailable = false;
  state.throws = false;
});

describe('the gate', () => {
  it('401s an anonymous caller, and reads nothing', async () => {
    state.user = null;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ success: false, error: 'Unauthorized' });
    // Nothing was looked up. A 401 issued after the read has leaked the data and
    // satisfied its status code.
    expect(state.askedFor).toEqual([]);
  });

  it('does not require an admin — this is a customer route', async () => {
    // Stated as a test because the neighbouring entitlement endpoints are all
    // admin-only, and the reflex when copying one is to bring `requireAdmin`
    // along. A customer must be able to read their own plan.
    const response = await GET(request());

    expect(response.status).toBe(200);
  });
});

describe('tenant isolation', () => {
  it('resolves the SESSION account, whatever the URL says', async () => {
    const response = await GET(
      request(`https://example.test/api/business-os/entitlements/my-plan?accountId=${SOMEBODY_ELSE}&userId=${SOMEBODY_ELSE}`)
    );

    expect(response.status).toBe(200);
    expect(state.askedFor).toEqual([CUSTOMER]);
    expect(state.askedFor).not.toContain(SOMEBODY_ELSE);
  });

  it('ignores a body too, including on a GET that should not have one', async () => {
    const withBody = new NextRequest('https://example.test/api/business-os/entitlements/my-plan', {
      method: 'POST',
      body: JSON.stringify({ accountId: SOMEBODY_ELSE }),
      headers: { 'content-type': 'application/json' },
    });

    await GET(withBody);

    expect(state.askedFor).toEqual([CUSTOMER]);
  });

  it('the SOURCE never reads a parameter — so the day somebody adds one, this fails', async () => {
    // The behavioural tests above pass on a handler that reads `?accountId=` and
    // then happens not to use it. This is the property: there is nothing to read.
    //
    // Comments are stripped first. The route's own header explains that it reads
    // no `searchParams` and takes no `params`, and the first version of this test
    // failed it for saying so — a guard that punishes the explanation of the
    // rule it enforces teaches people to delete the explanation.
    const code = codeOnly(
      readFileSync(join(process.cwd(), 'app/api/business-os/entitlements/my-plan/route.ts'), 'utf8')
    );

    expect(code).not.toMatch(/searchParams/);
    expect(code).not.toMatch(/request\.json\(\)/);
    expect(code).not.toMatch(/\bparams\b/);

    // And the one id it does use comes from the verified session, THROUGH the
    // account seam (SA P-1). Both halves matter: the session is where the id may
    // come from, and `resolveAccountId` is how it becomes an account id. Passing
    // `user.id` straight to `getSnapshot` type-checks, because `AccountId` is
    // `string` — which is what shipped here before P-1, and what the widened
    // `accountSeam.guard` now catches for every caller in the product.
    expect(code).toMatch(/resolveAccountId\(user\.id\)/);
    expect(code).toMatch(/getSnapshot\(accountId\)/);
    expect(code).not.toMatch(/getSnapshot\(user\.id\)/);
  });

  /**
   * The headers (QA-1).
   *
   * The guard above forbade `searchParams`, a body and `params`, and said
   * **nothing about `request.headers.get(...)`**. QA replaced the gate with an
   * `x-user-id` fallback for callers with no session — a full auth bypass AND a
   * cross-tenant read — and all eleven tests stayed green.
   *
   * This is the `x-user-id` / body-`userId` class that PRs #80, #82 and #86
   * swept out of this repository. It is the door this codebase has actually been
   * breached through, and it arrived here on the first entitlement data a
   * non-admin can see.
   *
   * Written as an ALLOW-LIST of header names rather than a ban on `x-user-id`,
   * because the literal string is the least interesting part: `x-account-id`,
   * `x-tenant`, `authorization`, `x-impersonate` and whatever somebody invents
   * next are the same defect. Anything not on the list fails, so the rule does
   * not need to have anticipated the name.
   */
  const READABLE_HEADERS = [
    // Tracing only. It is copied into the log context and never influences a
    // decision, an id or a query.
    'x-correlation-id',
  ];

  it('reads NO header except the tracing one — an identity header is the bypass class', () => {
    const code = codeOnly(
      readFileSync(join(process.cwd(), 'app/api/business-os/entitlements/my-plan/route.ts'), 'utf8')
    );

    const namesRead = [...code.matchAll(/headers\.get\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((match) =>
      match[1].toLowerCase()
    );

    // Every header the handler reads must be declared above. If this fails,
    // either the header is tracing (add it here, and say so) or it is identity,
    // in which case the answer is no.
    expect(namesRead.filter((name) => !READABLE_HEADERS.includes(name))).toEqual([]);

    // Non-vacuity: it really does read the one it is allowed to, so an extractor
    // that matched nothing would not make this pass.
    expect(namesRead).toContain('x-correlation-id');

    // And no dynamic read, which would defeat the extractor entirely.
    expect(code).not.toMatch(/headers\.get\(\s*[^'"`\s)]/);
    expect(code).not.toMatch(/headers\.forEach|headers\.entries|\[\.\.\.request\.headers/);
  });

  it('the account id has exactly ONE source, and it is the verified session', () => {
    // The complement of the allow-list. A header could also reach the account id
    // indirectly — `resolveAccountId(headerId ?? user.id)` — which the list above
    // would catch by name, but this catches by shape whatever the name.
    const code = codeOnly(
      readFileSync(join(process.cwd(), 'app/api/business-os/entitlements/my-plan/route.ts'), 'utf8')
    );

    const calls = [...code.matchAll(/resolveAccountId\(([^)]*)\)/g)].map((match) => match[1].trim());

    expect(calls).toEqual(['user.id']);
    // No fallback around the session read either: `getUser() ?? something` is
    // how the gate stops being a gate.
    expect(code).not.toMatch(/getUser\(\)\s*(\?\?|\|\|)/);
    expect(code).toMatch(/if \(!user\)/);
  });

  it('both rules reject the mutation QA actually wrote', () => {
    // Negative controls. Two `not.toMatch` assertions and an allow-list all pass
    // happily on source that contains none of the shapes they describe, so the
    // rules are run against the bypass itself.
    const bypassed = `
      const user = await getUser();
      const headerId = request.headers.get('x-user-id');
      if (!user && !headerId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      const accountId = resolveAccountId(user?.id ?? headerId!);
    `;

    const namesRead = [...bypassed.matchAll(/headers\.get\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((match) =>
      match[1].toLowerCase()
    );
    expect(namesRead.filter((name) => !READABLE_HEADERS.includes(name))).toEqual(['x-user-id']);

    const calls = [...bypassed.matchAll(/resolveAccountId\(([^)]*)\)/g)].map((match) => match[1].trim());
    expect(calls).not.toEqual(['user.id']);

    // And a differently-named identity header is caught by the same rule, which
    // is the point of an allow-list.
    const renamed = bypassed.replace('x-user-id', 'x-account-id');
    const renamedNames = [...renamed.matchAll(/headers\.get\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((match) =>
      match[1].toLowerCase()
    );
    expect(renamedNames.filter((name) => !READABLE_HEADERS.includes(name))).toEqual(['x-account-id']);
  });

  it('a header-bearing request is ignored at RUNTIME too, not only in the source', async () => {
    // The source guard is the durable half; this is the behaviour today. A
    // caller who sends every identity header we have ever been breached through
    // still gets their own plan.
    const spoofed = new NextRequest('https://example.test/api/business-os/entitlements/my-plan', {
      headers: {
        'x-user-id': SOMEBODY_ELSE,
        'x-account-id': SOMEBODY_ELSE,
        'x-tenant-id': SOMEBODY_ELSE,
      },
    });

    const response = await GET(spoofed);

    expect(response.status).toBe(200);
    expect(state.askedFor).toEqual([CUSTOMER]);
  });

  it('and with NO session, a header cannot stand in for one', async () => {
    state.user = null;

    const spoofed = new NextRequest('https://example.test/api/business-os/entitlements/my-plan', {
      headers: { 'x-user-id': SOMEBODY_ELSE },
    });

    const response = await GET(spoofed);

    expect(response.status).toBe(401);
    expect(state.askedFor).toEqual([]);
  });

  it('the comment stripper leaves the handler behind — non-vacuity', () => {
    // A stripper that returned '' would make every assertion above pass.
    const code = codeOnly(
      readFileSync(join(process.cwd(), 'app/api/business-os/entitlements/my-plan/route.ts'), 'utf8')
    );

    expect(code).toMatch(/export async function GET/);
    expect(code).toMatch(/getUser\(\)/);
    // And it really did remove the prose that mentions the forbidden tokens.
    expect(code).not.toMatch(/tenant isolation property/i);
  });

  it('exports no write handler', async () => {
    // S-4a step 1 is read-only: no buying, no upgrading. A POST here would be
    // the first thing a reviewer of step 2 assumed was already wired up.
    // Not named `module`: Next forbids assigning that identifier, and ESLint
    // enforces it (`@next/next/no-assign-module-variable`).
    const handlers = await import('@/app/api/business-os/entitlements/my-plan/route');

    expect(handlers).not.toHaveProperty('POST');
    expect(handlers).not.toHaveProperty('PUT');
    expect(handlers).not.toHaveProperty('PATCH');
    expect(handlers).not.toHaveProperty('DELETE');
    // Non-vacuity: the GET it DOES export is there, so this is not asserting
    // about an empty object.
    expect(handlers).toHaveProperty('GET');
  });
});

describe('the answer', () => {
  it('returns the plan the resolver gave, formatted', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.name).toBe('Essentials');
    expect(body.data.included.length).toBeGreaterThan(0);
  });

  it('names chat like anything else, and describes no exclusions', async () => {
    // Chat used to be suppressed here too. It is in testing and available now, so
    // the payload carries it — and the rule that replaced the suppression is the
    // narrower one: no field on the wire enumerates what the customer LACKS.
    const response = await GET(request());
    const body = await response.json();

    const keys = Object.keys(body.data);
    for (const forbidden of ['withholds', 'excluded', 'excludes', 'notIncluded']) {
      expect(keys).not.toContain(forbidden);
    }

    // And the plan above is named with what it would add, which is a statement
    // about that plan rather than about this one.
    expect(body.data.nextPlanUp?.adds?.length ?? 0).toBeGreaterThan(0);
  });

  it('an unreadable plan is 200 with a reason, not a 500', async () => {
    // The customer's settings page should say "we could not load this" in place,
    // not fail to render. `unavailable` is the service's own word for it.
    state.snapshot = null;
    state.unavailable = true;

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('unavailable');
    expect(body.data.problem).toMatch(/could not load/i);
  });

  it('a thrown error is a 500 that leaks nothing in production', async () => {
    state.throws = true;
    const previous = process.env.NODE_ENV;
    // @ts-expect-error -- NODE_ENV is readonly in the types; the test needs it.
    process.env.NODE_ENV = 'production';

    try {
      const response = await GET(request());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/on fire/);
    } finally {
      // @ts-expect-error -- restoring the same readonly field.
      process.env.NODE_ENV = previous;
    }
  });
});
