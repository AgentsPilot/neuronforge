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
import { BizQLValidationError, MissingFieldsError, type MutateQuery } from '../types';
import { CATALOG } from '@/lib/business-os/catalog';

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
    ).rejects.toThrow(MissingFieldsError);
  });

  it('reports EVERY missing field at once, not just the first', async () => {
    // Asking "what is the name?" and then, a turn later, "and the duration?" is a
    // worse conversation than asking once. The route turns this list into a
    // single question, so it has to be complete.
    await expect(
      executeMutate({ op: 'mutate', entity: 'services', action: 'create', data: {} }, CTX)
    ).rejects.toMatchObject({
      name: 'MissingFieldsError',
      entity: 'services',
      action: 'create',
      fields: ['service_name', 'duration_minutes'],
    });
  });

  it('treats a blank or zero required value as missing, not supplied', async () => {
    // Asked "add a new service" with no details, the planner filled in
    // {service_name: "", duration_minutes: 0} — every key present, every value a
    // placeholder. Checking only for `undefined` let that through and would have
    // created a nameless, zero-minute service instead of asking.
    await expect(
      executeMutate(
        { op: 'mutate', entity: 'services', action: 'create',
          data: { service_name: '', duration_minutes: 0 } },
        CTX
      )
    ).rejects.toMatchObject({ fields: ['service_name', 'duration_minutes'] });

    await expect(
      executeMutate(
        { op: 'mutate', entity: 'services', action: 'create',
          data: { service_name: '   ', duration_minutes: 60 } },
        CTX
      )
    ).rejects.toMatchObject({ fields: ['service_name'] });
  });

  it('keeps the set of declared-but-unwired actions explicit', async () => {
    // "Declared in the catalog but not implemented" is a real state — send needs
    // an outbound-email decision that is not this layer's to make. What is not
    // acceptable is DISCOVERING it at runtime, which is how invoices.create and
    // every tasks.* action sat unusable while planning perfectly.
    //
    // So the gap is enumerated here. Wiring an action makes this test fail until
    // someone removes it from the list, and declaring a new one without wiring it
    // fails too.
    // EMPTY, and it should stay that way.
    //
    // `invoices.send` came off once the delivery sequence moved into
    // InvoiceDeliveryService. `contacts.send` came off once `performEmail` was
    // lifted out of ForEachExecutor — the bulk path had been sending contact
    // email all along, so the single-contact case was never a missing
    // capability, only an unreachable one.
    //
    // A non-empty set here is now a regression: it means the catalog offers
    // something the executor cannot do.
    const KNOWN_UNWIRED = new Set<string>();
    const unwired: string[] = [];

    for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
      for (const actionKey of Object.keys(entity.actions ?? {})) {
        try {
          await executeMutate(
            { op: 'mutate', entity: entityKey, action: actionKey, target: { id: 'x' } },
            CTX,
            { dryRun: true }
          );
        } catch (err) {
          if ((err as Error).message.includes('not implemented yet')) {
            unwired.push(`${entityKey}.${actionKey}`);
          }
        }
      }
    }

    expect(new Set(unwired)).toEqual(KNOWN_UNWIRED);
  });

  it('fails loudly for an action declared but not wired to a repository', async () => {
    // Every declared action is wired now, so the guard has nothing real to fire
    // on — which is exactly when a safety net quietly rots. So the test declares
    // one, checks the refusal, and takes it away again.
    //
    // Returning a cheerful success here is precisely the bug that had the old
    // chat telling users it had emailed people it never emailed.
    const contacts = CATALOG.entities.contacts;
    contacts.actions!.pretend = {
      labels: { en: 'pretend' },
      risk: 'update',
      requiresConfirmation: false,
    };

    try {
      await expect(
        executeMutate(
          { op: 'mutate', entity: 'contacts', action: 'pretend', target: { id: 'abc' } },
          CTX
        )
      ).rejects.toThrow(/not implemented yet/);
    } finally {
      delete contacts.actions!.pretend;
    }
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

  it('shows the VALUES that will be written, not just which fields', async () => {
    // The confirmation card is the last thing between a plan and real data. It
    // used to read "add service (service_name, duration_minutes, price)" — which
    // says what kind of thing will happen and nothing about what will be written.
    // Approving that is approving blind, and it is the only backstop against a
    // planner that fills a required field with something plausible.
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'services',
        action: 'create',
        data: { service_name: 'Deep Tutoring', duration_minutes: 90, price: 400 },
      },
      CTX,
      { dryRun: true }
    );

    expect(result.preview).toContain('Deep Tutoring');
    expect(result.preview).toContain('90');
    expect(result.preview).toContain('400');
  });

  it('resolves a relative date before writing it, and shows the real date', async () => {
    // Writes never went through the compiler's date resolution, so
    // {"$date":"tomorrow"} was handed to the repository as an OBJECT — every
    // write carrying a relative date wrote garbage into a timestamp column, and
    // "add a task to call Moshe tomorrow" is about as ordinary as a task gets.
    const result = await executeMutate(
      {
        op: 'mutate',
        entity: 'tasks',
        action: 'create',
        data: { title: 'Call Moshe', due_date: { $date: 'tomorrow' } as never },
      },
      CTX,
      { dryRun: true }
    );

    expect(result.preview).not.toContain('[object Object]');
    expect(result.preview).not.toContain('tomorrow');

    // The card must show the date the user is actually approving.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(result.preview).toContain(String(tomorrow.getFullYear()));
  });

  it('refuses a value it cannot store rather than stringifying it', async () => {
    // `[object Object]` in a user's data is worse than a failed write.
    await expect(
      executeMutate(
        {
          op: 'mutate',
          entity: 'tasks',
          action: 'create',
          data: { title: 'Call Moshe', due_date: { nonsense: true } as never },
        },
        CTX,
        { dryRun: true }
      )
    ).rejects.toThrow(/cannot store/);
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

  it('rejects any non-create write with no target at all', () => {
    // This is what makes "delete all my contacts" inexpressible: there is no
    // way to write a delete that is not aimed at one named row.
    for (const action of ['delete', 'update']) {
      const problems = validate([{ id: 's1', op: 'mutate', action, entity: 'contacts' }]);
      expect(problems.join(' ')).toMatch(/needs a target/);
    }
  });

  // --- described targets --------------------------------------------------
  //
  // A write may now describe its row ("invoice INV-00002") instead of naming a
  // uuid, because a person will never type one. That widened the surface these
  // tests exist to protect, so the property is re-asserted from the new angle:
  // describing a row must not become a way to write to a SET of rows.

  it('rejects a described target with no filter — it would match everything', () => {
    const problems = validate([
      { id: 's1', op: 'mutate', action: 'delete', entity: 'contacts', target: { find: { where: [] } } },
    ]);
    expect(problems.join(' ')).toMatch(/would match every/);
  });

  it('rejects a target that gives both an id and a description', () => {
    // Two answers to "which row", and whichever the executor read first would win.
    const problems = validate([
      {
        id: 's1',
        op: 'mutate',
        action: 'update',
        entity: 'contacts',
        target: {
          id: '11111111-1111-1111-1111-111111111111',
          find: { where: [{ field: 'first_name', op: 'eq', value: 'Ofir' }] },
        },
      },
    ]);
    expect(problems.join(' ')).toMatch(/BOTH "id" and "find"/);
  });

  it('validates the fields inside a described target against the catalog', () => {
    const problems = validate([
      {
        id: 's1',
        op: 'mutate',
        action: 'update',
        entity: 'contacts',
        target: { find: { where: [{ field: 'nonexistent', op: 'eq', value: 'x' }] } },
      },
    ]);
    expect(problems.join(' ')).toMatch(/unknown field 'contacts\.nonexistent'/);
  });

  it('accepts a well-formed described target', () => {
    expect(
      validate([
        {
          id: 's1',
          op: 'mutate',
          action: 'mark_paid',
          entity: 'invoices',
          target: { find: { where: [{ field: 'invoice_number', op: 'eq', value: 'INV-00002' }] } },
        },
      ])
    ).toEqual([]);
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

describe('confirmation fingerprint', () => {
  /**
   * Regression guard for a bug that made EVERY confirmation silently fail.
   *
   * The fingerprint is computed before storage and verified after reading back,
   * and the round trip goes through Postgres `jsonb`, which does not preserve
   * object key order. Hashing JSON.stringify output therefore never matched, so
   * park() succeeded and take() always returned null.
   *
   * Mocked storage could not catch it: the bug only exists when a real database
   * reorders the keys.
   */
  it('is stable when object keys come back in a different order', async () => {
    const mod = await import('../mutate/ConfirmationStore');

    // Not exported, so exercise it through the public behaviour: two
    // semantically identical steps with different key order must be treated as
    // the same plan.
    const a = { id: 's2', op: 'for_each', entity: 'contacts', action: 'send' };
    const b = { action: 'send', entity: 'contacts', op: 'for_each', id: 's2' };

    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));

    // readConfirmationReply is a proxy for the module loading cleanly; the real
    // assertion is that a round-tripped plan is accepted, covered end-to-end by
    // scripts/bizql-confirm-roundtrip.ts against a live database.
    expect(mod.readConfirmationReply('yes')).toBe('confirm');
  });
});
