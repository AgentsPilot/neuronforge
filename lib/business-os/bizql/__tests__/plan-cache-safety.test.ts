/**
 * Plan-cache safety tests.
 *
 * A shared cache is the highest-leverage token win in this system and its most
 * dangerous component: an entry stored for one business is, by design, readable
 * by others. That is only acceptable because two properties hold, and these
 * tests exist to keep them holding.
 *
 *   1. Nothing tenant-specific is ever marked portable.
 *   2. What is cached is a query SHAPE — never a result, never rows.
 *
 * These run with no network and no database.
 */

import {
  cacheKey,
  dehydratePlan,
  isPlanPortable,
  normalizeUtterance,
  rehydratePlan,
} from '../cache/normalize';

describe('utterance normalisation', () => {
  it('collapses case, whitespace and trailing punctuation', () => {
    const a = normalizeUtterance('Who Owes Me Money?');
    const b = normalizeUtterance('who owes me   money');
    expect(a.normalized).toBe(b.normalized);
  });

  it('lifts numbers into slots so a family of questions shares one entry', () => {
    // The generalisation that makes the cache worth having: one planning call
    // answers "over $100", "over $250" and "over 1000".
    const a = normalizeUtterance('invoices over $100');
    const b = normalizeUtterance('invoices over $250');

    expect(a.normalized).toBe(b.normalized);
    expect(a.literals[0].value).toBe(100);
    expect(b.literals[0].value).toBe(250);
  });

  it('preserves non-Latin text so Hebrew and Spanish normalise too', () => {
    const result = normalizeUtterance('מי חייב לי כסף?');
    expect(result.normalized).toContain('חייב');
    expect(result.normalized).not.toContain('?');
  });

  it('does not collide questions that mean different things', () => {
    // Aggressive stemming would merge these, and a cache collision returns a
    // confidently wrong plan.
    const paid = normalizeUtterance('show me paid invoices');
    const unpaid = normalizeUtterance('show me unpaid invoices');
    expect(paid.normalized).not.toBe(unpaid.normalized);
  });

  describe('portability — what may be shared between tenants', () => {
    it('treats a generic question as portable', () => {
      expect(normalizeUtterance('which invoices are unpaid?').portable).toBe(true);
    });

    it('refuses to share an utterance containing an email address', () => {
      const result = normalizeUtterance('find the contact ofir@example.com');
      expect(result.portable).toBe(false);
      expect(result.unportableReasons).toContain('email');
      // It must also be scrubbed from the stored text, not merely flagged.
      expect(result.normalized).not.toContain('ofir@example.com');
    });

    it('refuses to share an utterance containing a row id', () => {
      const result = normalizeUtterance(
        'open invoice 3a4b7c40-9a1b-4334-beb3-66e9fc24b42d'
      );
      expect(result.portable).toBe(false);
      expect(result.unportableReasons).toContain('uuid');
    });

    it('refuses to share an utterance containing a phone number', () => {
      expect(normalizeUtterance('call +1 201 364 3030').portable).toBe(false);
    });
  });
});

describe('cache keys', () => {
  it('changes when the catalog changes, invalidating every entry at once', () => {
    const a = cacheKey('unpaid invoices', 'en', 'catalog-v1');
    const b = cacheKey('unpaid invoices', 'en', 'catalog-v2');
    expect(a).not.toBe(b);
  });

  it('separates languages, because the plan carries answer text', () => {
    const en = cacheKey('unpaid invoices', 'en', 'v1');
    const he = cacheKey('unpaid invoices', 'he', 'v1');
    expect(en).not.toBe(he);
  });

  it('is stable for the same inputs', () => {
    expect(cacheKey('x', 'en', 'v1')).toBe(cacheKey('x', 'en', 'v1'));
  });
});

describe('plan portability', () => {
  it('accepts a plan built only from catalog vocabulary', () => {
    const plan = {
      steps: [
        {
          id: 's1',
          op: 'find',
          entity: 'invoices',
          where: [{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }],
        },
      ],
    };
    expect(isPlanPortable(plan).portable).toBe(true);
  });

  it('rejects a plan that resolved a name into a row id', () => {
    // The subtle case: the QUESTION looked generic ("send Ofir his invoice"),
    // but the planner resolved it to a concrete row belonging to one tenant.
    const plan = {
      steps: [
        {
          id: 's1',
          op: 'find',
          entity: 'invoices',
          where: [
            { field: 'contact_id', op: 'eq', value: '36c2ab05-63b8-43ca-9cd2-8ad6a0c95cb9' },
          ],
        },
      ],
    };
    const result = isPlanPortable(plan);
    expect(result.portable).toBe(false);
    expect(result.reason).toMatch(/row id/);
  });

  it('rejects a plan containing an email address', () => {
    const plan = { steps: [{ where: [{ field: 'email', value: 'a@b.com' }] }] };
    expect(isPlanPortable(plan).portable).toBe(false);
  });

  it('rejects a plan referencing user_id', () => {
    const plan = { steps: [{ where: [{ field: 'user_id', value: 'x' }] }] };
    expect(isPlanPortable(plan).portable).toBe(false);
  });
});

describe('literal round-tripping', () => {
  it('restores the caller\'s own value into a shared plan shape', () => {
    const { literals } = normalizeUtterance('invoices over $100');

    const plan = {
      steps: [
        { id: 's1', op: 'find', entity: 'invoices', where: [{ field: 'amount', op: 'gt', value: 100 }] },
      ],
    };

    const stored = dehydratePlan(plan, literals);
    // The stored shape must not carry the original amount.
    expect(JSON.stringify(stored)).not.toContain('100');

    // A different asker supplies their own number.
    const { literals: other } = normalizeUtterance('invoices over $250');
    const restored = rehydratePlan(stored, other) as typeof plan;

    expect(restored.steps[0].where[0].value).toBe(250);
  });

  it('is a no-op when the utterance had no literals', () => {
    const plan = { steps: [{ id: 's1', op: 'find', entity: 'invoices' }] };
    expect(rehydratePlan(dehydratePlan(plan, []), [])).toEqual(plan);
  });

  it('never corrupts a plan, even if substitution goes wrong', () => {
    // dehydratePlan does textual substitution over JSON, so it must fail closed:
    // returning the original plan is always better than returning broken JSON.
    const plan = { steps: [{ id: 's1', op: 'find', entity: 'invoices' }] };
    const weird = [{ slot: '<number1>', kind: 'number' as const, value: '"' }];
    expect(() => dehydratePlan(plan, weird)).not.toThrow();
  });
});
