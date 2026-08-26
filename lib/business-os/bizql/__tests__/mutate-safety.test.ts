/**
 * Write-safety tests.
 *
 * Reads can be generic because the worst case is wrong rows coming back. Writes
 * cannot: an LLM-authored write that slips past its guards is not recoverable by
 * re-running the query. These tests pin the guards.
 *
 * No database and no network — every assertion is about what the executor
 * refuses, or about what a dry run does NOT do.
 */

import { executeMutate, requiresConfirmation } from '../mutate/MutateExecutor';
import { normalizePlan, validatePlan } from '../planner/validatePlan';
import { readConfirmationReply } from '../mutate/ConfirmationStore';
import { BizQLValidationError, type MutateQuery } from '../types';

const CTX = { userId: '11111111-1111-1111-1111-111111111111', consumer: 'test' as const };

describe('mutate — what it refuses', () => {
  it('rejects an unknown entity', async () => {
    await expect(
      executeMutate({ op: 'mutate', entity: 'auth_users', action: 'delete' }, CTX)
    ).rejects.toThrow(/unknown entity/);
  });

  it('rejects an action the catalog does not declare', async () => {
    // The catalog is the whole permission surface: if an action is not declared,
    // it does not exist, however plausible it sounds.
    await expect(
      executeMutate({ op: 'mutate', entity: 'contacts', action: 'merge' }, CTX)
    ).rejects.toThrow(/no action 'merge'/);
  });

  it('rejects writing a field that is not marked writable', async () => {
    await expect(
      executeMutate(
        {
          op: 'mutate',
          entity: 'contacts',
          action: 'update',
          target: { id: 'abc' },
          data: { created_at: '2020-01-01' },
        },
        CTX
      )
    ).rejects.toThrow(/not writable/);
  });

  it('rejects a field that is not in the catalog at all', async () => {
    await expect(
      executeMutate(
        {
          op: 'mutate',
          entity: 'contacts',
          action: 'update',
          target: { id: 'abc' },
          data: { is_admin: true } as never,
        },
        CTX
      )
    ).rejects.toThrow(/unknown field/);
  });

  it('refuses an update with no target id rather than affecting everything', async () => {
    // The catastrophic case: an UPDATE whose WHERE clause went missing.
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'contacts', action: 'update', data: { first_name: 'X' } },
        CTX
      )
    ).rejects.toThrow(/explicit target id/);
  });

  it('refuses a delete with no target id', async () => {
    await expect(
      executeMutate({ op: 'mutate', entity: 'contacts', action: 'delete' }, CTX)
    ).rejects.toThrow(/explicit target id/);
  });

  it('refuses a create that is missing a required field', async () => {
    await expect(
      executeMutate({ op: 'mutate', entity: 'contacts', action: 'create', data: {} }, CTX)
    ).rejects.toThrow(/requires 'first_name'/);
  });

  it('fails loudly for an action declared but not wired to a repository', async () => {
    // invoices.send is in the catalog but has no handler yet. Returning a
    // cheerful success here is precisely the bug that had the old chat telling
    // users it had emailed people it never emailed.
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'invoices', action: 'send', target: { id: 'abc' } },
        CTX
      )
    ).rejects.toThrow(/not implemented yet/);
  });
});

describe('mutate — dry run', () => {
  /**
   * The confirmation flow is only trustworthy if previewing is genuinely
   * side-effect free. These assert the dry-run path never reaches a repository:
   * each would throw or write if it did, and instead returns applied:false.
   */
  it('previews a delete without performing it', async () => {
    const result = await executeMutate(
      { op: 'mutate', entity: 'contacts', action: 'delete', target: { id: 'abc' } },
      CTX,
      { dryRun: true }
    );

    expect(result.applied).toBe(false);
    expect(result.preview).toBeTruthy();
  });

  it('previews an update without performing it', async () => {
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'contacts',
        action: 'update',
        target: { id: 'abc' },
        data: { first_name: 'Ofir' },
      },
      CTX,
      { dryRun: true }
    );

    expect(result.applied).toBe(false);
  });

  it('still validates while previewing, so bad plans fail before the user sees them', async () => {
    await expect(
      executeMutate(
        {
          op: 'mutate',
          entity: 'contacts',
          action: 'update',
          target: { id: 'abc' },
          data: { created_at: 'x' },
        },
        CTX,
        { dryRun: true }
      )
    ).rejects.toThrow(BizQLValidationError);
  });

  it('describes the effect in the user\'s language', async () => {
    const result = await executeMutate(
      { op: 'mutate', entity: 'contacts', action: 'delete', target: { id: 'abc' } },
      CTX,
      { dryRun: true, language: 'he' }
    );

    expect(result.preview).toContain('מחק');
  });
});

describe('confirmation policy', () => {
  it('requires confirmation for a delete', () => {
    expect(
      requiresConfirmation({ op: 'mutate', entity: 'contacts', action: 'delete' })
    ).toBe(true);
  });

  it('requires confirmation for an outbound send', () => {
    expect(
      requiresConfirmation({ op: 'mutate', entity: 'invoices', action: 'send' })
    ).toBe(true);
  });

  it('does not demand confirmation for a low-risk update', () => {
    expect(
      requiresConfirmation({ op: 'mutate', entity: 'contacts', action: 'update' })
    ).toBe(false);
  });

  it('fails safe: an unknown action requires confirmation', () => {
    // Convenience must never win over safety on a write path.
    expect(
      requiresConfirmation({ op: 'mutate', entity: 'contacts', action: 'whatever' })
    ).toBe(true);
  });
});

describe('reading a confirmation reply', () => {
  it('recognises affirmation across languages', () => {
    for (const reply of ['yes', 'Yes', 'ok', 'go ahead', 'כן', 'sí', 'confirm']) {
      expect(readConfirmationReply(reply)).toBe('confirm');
    }
  });

  it('recognises refusal across languages', () => {
    for (const reply of ['no', 'cancel', 'stop', 'לא', 'ביטול', 'cancelar']) {
      expect(readConfirmationReply(reply)).toBe('cancel');
    }
  });

  it('reads "no, cancel that" as refusal rather than affirmation', () => {
    // Order matters in the matcher: a reply containing both must deny.
    expect(readConfirmationReply('no, cancel that')).toBe('cancel');
  });

  it('treats anything ambiguous as NOT approval', () => {
    // The important asymmetry: an unclear reply must never authorise a write.
    for (const reply of ['maybe', 'what does that mean?', 'show me first', 'hmm']) {
      expect(readConfirmationReply(reply)).toBe('unrelated');
    }
  });
});

describe('plan validation for writes', () => {
  const validate = (steps: unknown[]) =>
    validatePlan({ steps } as Parameters<typeof validatePlan>[0]);

  it('rejects an unrecognised op instead of silently skipping it', () => {
    // The bug this pins: the planner emitted {"op":"create"} rather than
    // {"op":"mutate","action":"create"}. Validation passed, the step was then
    // filtered out as "not a mutate", and the turn became a silent no-op that
    // reported success. An op we do not understand must be an error.
    const problems = validate([
      { id: 's1', op: 'create', entity: 'contacts', data: { first_name: 'X' } },
    ]);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/unknown op 'create'/);
    // The message must show the correct shape, or the repair pass cannot fix it.
    expect(problems[0]).toMatch(/"op":"mutate"/);
  });

  it('rejects a mutate with no action', () => {
    expect(validate([{ id: 's1', op: 'mutate', entity: 'contacts' }])[0]).toMatch(
      /needs an "action"/
    );
  });

  it('rejects an action the entity does not declare', () => {
    expect(
      validate([{ id: 's1', op: 'mutate', action: 'merge', entity: 'contacts' }])[0]
    ).toMatch(/no action 'merge'/);
  });

  it('rejects any non-create write without an explicit target id', () => {
    // This is what makes "delete all my contacts" inexpressible: there is no
    // way to write a delete that is not aimed at one named row.
    for (const action of ['delete', 'update']) {
      const problems = validate([{ id: 's1', op: 'mutate', action, entity: 'contacts' }]);
      expect(problems.join(' ')).toMatch(/needs target\.id/);
    }
  });

  it('rejects writing a non-writable field', () => {
    expect(
      validate([
        {
          id: 's1',
          op: 'mutate',
          action: 'update',
          entity: 'contacts',
          target: { id: 'x' },
          data: { created_at: 'y' },
        },
      ]).join(' ')
    ).toMatch(/not writable/);
  });

  it('refuses a fabricated step reference as a target id', () => {
    // Asked to "delete all my contacts", the planner produced
    // target.id = "s1.rows.id" — a reference to another step's rows. No such
    // feature exists, so it would pass confirmation and then misfire. This is
    // what makes bulk deletion genuinely inexpressible rather than just awkward.
    const problems = validate([
      { id: 's1', op: 'find', entity: 'contacts' },
      { id: 's2', op: 'mutate', action: 'delete', entity: 'contacts', target: { id: 's1.rows.id' } },
    ]);

    expect(problems.join(' ')).toMatch(/not a reference to another step/);
  });

  it('refuses a target id that is not a real row id', () => {
    expect(
      validate([
        { id: 's1', op: 'mutate', action: 'delete', entity: 'contacts', target: { id: 'all' } },
      ]).join(' ')
    ).toMatch(/is not a row id/);
  });

  it('lifts an operator that arrived as a key', () => {
    // Observed from gpt-4o-mini: {"field":"amount","gt":100} instead of
    // {"field":"amount","op":"gt","value":100}. Unambiguous, so normalise it
    // rather than spending a repair pass.
    const plan = {
      steps: [
        { id: 's1', op: 'find', entity: 'invoices', where: [{ field: 'amount', gt: 100 }] },
      ],
    } as never;

    normalizePlan(plan);
    expect(validatePlan(plan)).toEqual([]);

    const where = (plan as unknown as { steps: Array<{ where: unknown[] }> }).steps[0].where[0];
    expect(where).toEqual({ field: 'amount', op: 'gt', value: 100 });
  });

  it('defaults a missing operator to eq when a value is present', () => {
    const plan = {
      steps: [
        {
          id: 's1',
          op: 'find',
          entity: 'invoices',
          where: [{ field: 'status', value: { $semantic: 'unpaid' } }],
        },
      ],
    } as never;

    normalizePlan(plan);
    expect(validatePlan(plan)).toEqual([]);
  });

  it('normalises inside a relation predicate, not just at the top level', () => {
    const plan = {
      steps: [
        {
          id: 's1',
          op: 'find',
          entity: 'contacts',
          where: [
            {
              relation: 'invoices',
              quantifier: 'any',
              where: [{ field: 'amount', gt: 100 }, { field: 'status', value: { $semantic: 'unpaid' } }],
            },
          ],
        },
      ],
    } as never;

    normalizePlan(plan);
    expect(validatePlan(plan)).toEqual([]);
  });

  it('accepts a well-formed create', () => {
    expect(
      validate([
        { id: 's1', op: 'mutate', action: 'create', entity: 'contacts', data: { first_name: 'Dana' } },
      ])
    ).toEqual([]);
  });

  it('accepts a well-formed targeted update', () => {
    expect(
      validate([
        {
          id: 's1',
          op: 'mutate',
          action: 'update',
          entity: 'contacts',
          target: { id: '36c2ab05-63b8-43ca-9cd2-8ad6a0c95cb9' },
          data: { phone: '050-1234567' },
        },
      ])
    ).toEqual([]);
  });
});
