/**
 * `config.mapping` is applied, in both the shapes this codebase emits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COST
 *
 * The spreadsheet importer ran daily from 1 November. It read the owner's sheet
 * every time, filed ZERO contacts, and reported `completed` on every run. The
 * owner's columns were right, their data was right, and no surface anywhere
 * said otherwise — the agents card showed a green tick and a next-run time.
 *
 * The committed plan's mapping step emits:
 *
 *   { operation: 'map', config: { mapping: { email: 'D', first_name: 'B' } } }
 *
 * `transformMap` knew `field_mapping`, `column_index`, `field_path`, `field`,
 * `fields`, `custom_code` and `expression`. None of them is `mapping`, so it
 * reached the standard fallback — which does `const mapping = config || {}`
 * and treats the WHOLE config as the template. Each item therefore came out as
 *
 *   { mapping: { email: 'D', phone: 'E', first_name: 'B' } }
 *
 * one key, literally named `mapping`, holding the spec nobody applied. The next
 * step — "skip a row with no address" — found no `email` and skipped every row.
 *
 * Silent by construction: nothing threw, nothing was logged, and the only
 * evidence was an empty CRM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY BOTH SHAPES
 *
 * `WorkflowValidator` reads `config.mapping` as an ARRAY of `{source, target}`
 * while committed plans write it as an OBJECT. Three parts of one feature
 * disagreed about one field. Normalising both onto `field_mapping` is what
 * stops them drifting again — there is one implementation, and it is the tested
 * one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { StepExecutor } from '@/lib/pilot/StepExecutor';

/**
 * A context stub, because the UNRECOGNISED-shape path reaches the old fallback
 * and that fallback clones the context to resolve `{{…}}` expressions.
 *
 * Only the three members it touches. A fuller fake would invite assertions
 * about machinery this file is not testing.
 */
const context = () => {
  const ctx: Record<string, unknown> = {
    clone: () => ctx,
    setVariable: () => undefined,
    resolveVariable: (expr: string) => expr,
  };
  return ctx;
};

/** `transformMap` is private; this file is a unit test of exactly that unit. */
const mapWith = (data: unknown[], config: unknown): unknown => {
  const executor = new (StepExecutor as unknown as new (...args: unknown[]) => unknown)() as {
    transformMap(d: unknown[], c: unknown, ctx: unknown): unknown;
  };
  return executor.transformMap(data, config, context());
};

/**
 * The owner's sheet, keyed by column letter — what `rows_to_objects` produces
 * immediately before the mapping step. Two real rows from the live account.
 */
const ROWS = [
  { A: '26-11-25', B: 'Person3', C: 'Crimson Ventures', D: 'person3@company.net', E: '508889999' },
  { A: '26-11-25', B: 'Person4', C: 'Delta Dynamics', D: 'person4@example.com', E: '5055522222' },
];

/** Exactly what the committed `import_leads_from_sheet` plan writes. */
const PLAN_CONFIG = { mapping: { email: 'D', phone: 'E', first_name: 'B' } };

describe('the committed plan shape', () => {
  it('produces people with the fields the next step looks for', () => {
    /*
     * THE BUG, AS ONE ASSERTION. Before this, every item came out as
     * `{ mapping: … }` — no `email`, so the downstream conditional skipped the
     * whole sheet and the run reported success.
     */
    const people = mapWith(ROWS, PLAN_CONFIG) as Record<string, string>[];

    expect(people).toEqual([
      { email: 'person3@company.net', phone: '508889999', first_name: 'Person3' },
      { email: 'person4@example.com', phone: '5055522222', first_name: 'Person4' },
    ]);
  });

  it('never emits the alias key itself', () => {
    /* `{ mapping: … }` reaching a downstream step is the signature of the
       fall-through this fixes. */
    const people = mapWith(ROWS, PLAN_CONFIG) as Record<string, unknown>[];

    for (const person of people) {
      expect(Object.keys(person)).not.toContain('mapping');
    }
  });

  it('gives every row an address, which is what the skip step reads', () => {
    const people = mapWith(ROWS, PLAN_CONFIG) as { email?: string }[];

    expect(people.filter(p => p.email).length).toBe(ROWS.length);
  });
});

describe('the validator shape', () => {
  it('reads an array of source/target entries the same way', () => {
    const people = mapWith(ROWS, {
      mapping: [
        { source: 'D', target: 'email' },
        { source: 'B', target: 'first_name' },
      ],
    }) as Record<string, string>[];

    expect(people).toEqual([
      { email: 'person3@company.net', first_name: 'Person3' },
      { email: 'person4@example.com', first_name: 'Person4' },
    ]);
  });
});

describe('what the alias must not disturb', () => {
  it('leaves an explicit field_mapping alone', () => {
    /* A plan that already speaks the supported shape must be untouched —
       the alias is a translation, never an override. */
    const people = mapWith(ROWS, {
      field_mapping: { email: 'D' },
      mapping: { email: 'B' },
    }) as Record<string, string>[];

    expect(people[0]).toEqual({ email: 'person3@company.net' });
  });

  it('ignores a mapping whose values are not field names', () => {
    /*
     * A nested object under `mapping` is some other idea wearing the same key.
     * Guessing at it is how a contact gets filed under somebody else's address,
     * which is the one failure in this agent that reaches real people.
     */
    const out = mapWith(ROWS, { mapping: { email: { from: 'D' } } }) as unknown[];

    expect(out).not.toEqual([{ email: 'person3@company.net' }, { email: 'person4@example.com' }]);
  });

  it('ignores an empty mapping rather than emitting empty people', () => {
    const out = mapWith(ROWS, { mapping: {} }) as unknown[];

    expect(out).not.toEqual([{}, {}]);
  });
});
