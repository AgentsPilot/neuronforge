/**
 * The pill's CALLER — where all three of its safety guarantees actually live.
 *
 * `planBadgeFor` was already well covered; this was the gap (QA-10). While the
 * read was a private function inside `app/business-os/layout.tsx` it could not be
 * called without rendering a layout, and **two mutations to it passed a green
 * suite of 29 tests**:
 *
 *   - replacing the `catch`'s `return null` with a fallback label — a wrong plan
 *     name in the chrome of every screen, whenever the database hiccupped;
 *   - dropping the session check so the account id became the literal
 *     `'anonymous'` — a read for an account nobody owns, which resolves to nothing
 *     today and to somebody else's plan the day an id collides.
 *
 * Both are caught below. The point is not that they were likely; it is that the
 * three sentences the module's header promises were not held by anything.
 */

const state = {
  user: null as { id: string } | null,
  /** Which id the service was asked about. The seam assertion. */
  askedFor: [] as string[],
  snapshot: null as unknown,
  throws: null as string | null,
};

jest.mock('@/lib/auth', () => ({
  getUser: async () => {
    if (state.throws === 'getUser') throw new Error('auth exploded');
    return state.user;
  },
}));

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshot: async (accountId: string) => {
      state.askedFor.push(accountId);
      if (state.throws === 'getSnapshot') throw new Error('database on fire');
      return { resolution: state.snapshot, unavailable: false, stale: false };
    },
  }),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { readPlanBadge } from '@/lib/business-os/entitlements/readPlanBadge';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';

const CUSTOMER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const NOW = new Date('2026-09-27T00:00:00.000Z');

function championResolution() {
  const config = readCodeConfig();
  return resolveEntitlements({
    config,
    account: previewAccountFor(config, 'champion', NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });
}

beforeEach(() => {
  state.user = { id: CUSTOMER };
  state.askedFor = [];
  state.snapshot = championResolution();
  state.throws = null;
});

describe('guarantee 1 — no session, no pill', () => {
  it('returns null and reads nothing at all', async () => {
    state.user = null;

    expect(await readPlanBadge()).toBeNull();
    // The mutation this catches: a fallback id. Nothing was looked up, so no
    // account was invented to look it up for.
    expect(state.askedFor).toEqual([]);
  });

  it('never substitutes a placeholder account id', async () => {
    // Stated separately because it is the specific mutation QA wrote: an
    // `'anonymous'` default resolves to nothing today, and to another tenant's
    // plan the day an id collides. There is no id to collide with if none is made.
    state.user = null;

    await readPlanBadge();

    expect(state.askedFor).not.toContain('anonymous');
    expect(state.askedFor).toHaveLength(0);
  });
});

describe('guarantee 2 — a failed read renders nothing, never a fallback', () => {
  it('a throwing snapshot returns null', async () => {
    state.throws = 'getSnapshot';

    expect(await readPlanBadge()).toBeNull();
  });

  it('a throwing session check returns null too', async () => {
    // The other side of the `try`. An auth failure must not take the whole layout
    // down either: the chrome renders, without a pill.
    state.throws = 'getUser';

    expect(await readPlanBadge()).toBeNull();
  });

  it('and it is NULL, not a label — the mutation QA wrote', async () => {
    // A fallback like `{ label: 'Founding Partner', … }` in the catch would put a
    // wrong plan name on every screen whenever the database hiccupped. `null` is
    // the only safe answer, because a decorative label is not worth a claim about
    // what somebody is paying for.
    state.throws = 'getSnapshot';
    const badge = await readPlanBadge();

    expect(badge).toBeNull();
    expect(badge).not.toEqual(expect.objectContaining({ label: expect.any(String) }));
  });
});

describe('guarantee 3 — the id goes through the account seam', () => {
  it('asks about the session account, resolved through the seam', async () => {
    const badge = await readPlanBadge();

    expect(state.askedFor).toEqual([CUSTOMER]);
    // Happy path, so the assertion above is not passing on a null answer.
    expect(badge?.label).toBe('Founding Partner');
  });

  it('the SOURCE calls resolveAccountId rather than passing user.id straight in', async () => {
    // `AccountId` is `string`, so the seam cannot be enforced by the compiler.
    // `accountSeam.guard` enforces it product-wide; this pins it here too, beside
    // the behaviour, because this is the file somebody edits.
    const source = readFileSync(
      join(process.cwd(), 'lib/business-os/entitlements/readPlanBadge.ts'),
      'utf8'
    );

    expect(source).toMatch(/resolveAccountId\(user\.id\)/);
    expect(source).not.toMatch(/getSnapshot\(user\.id\)/);
  });

  it('a non-champion session gets no pill, through the same path', async () => {
    // The read succeeded, the seam was used, and the answer is still nothing — so
    // "returns null" above is about failure, not about the pill never appearing.
    const config = readCodeConfig();
    state.snapshot = resolveEntitlements({
      config,
      account: previewAccountFor(config, 'basic', NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });

    expect(await readPlanBadge()).toBeNull();
    expect(state.askedFor).toEqual([CUSTOMER]);
  });
});

