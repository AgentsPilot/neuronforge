/**
 * Every committed plan is checked against the grammar it will actually be read
 * with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MISTAKE THIS EXISTS TO STOP
 *
 * All three plans asked for `order_by: [{ field, direction: 'asc' }]`. The key
 * is `dir` (`bizql/types.ts` SortSpec), so `direction` was not a sort — it was
 * an ignored property, and every plan ran unordered. Nothing failed: a query
 * with no sort returns rows in whatever order Postgres hands back.
 *
 * It is not cosmetic. Each find carries a `limit`, and the plugin caps fan-out
 * on top of it, so the sort decides WHICH clients an agent reaches on a
 * backlog. "Oldest debt first" silently became "whichever twenty".
 *
 * The same class of silence covers field names: a predicate naming a field the
 * catalog does not declare is a planning error, not a runtime one, and these
 * plans never go through the planner that would catch it.
 *
 * Asserted against the catalog rather than by executing, so it runs offline and
 * fails on the plan rather than on a live account that happens to hold no rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG } from '@/lib/business-os/catalog';
import { AUTOMATION_AGENTS } from '../catalog';
import { planInputs } from '../install';

type Step = Record<string, any>;

/** Every step, including the ones nested inside a scatter. */
function flatten(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.scatter?.steps) out.push(...flatten(step.scatter.steps));
  }
  return out;
}

/** The entity a `find_x` / `send_x` action names, per the plugin's own split. */
function entityOf(action: string): string | undefined {
  return Object.keys(CATALOG.entities).find(key => action.endsWith(`_${key}`));
}

/**
 * Field keys a `where` or `order_by` may legally name.
 *
 * `fields` AND `derived` both, because a predicate cannot tell them apart —
 * `has_bookings` and `is_current_version` live under `derived` and every plan
 * here filters on one. Reading only `fields` rejected three valid plans.
 */
function fieldsOf(entityKey: string): Set<string> {
  const entity = CATALOG.entities[entityKey] as any;
  return new Set([...Object.keys(entity?.fields ?? {}), ...Object.keys(entity?.derived ?? {})]);
}

/** Field predicates only — flattened out of and/or/not. */
function fieldPredicates(where: any[]): any[] {
  const out: any[] = [];
  for (const p of where ?? []) {
    if (!p || typeof p !== 'object') continue;
    if (Array.isArray(p.or)) out.push(...fieldPredicates(p.or));
    else if (Array.isArray(p.and)) out.push(...fieldPredicates(p.and));
    else if (p.not) out.push(...fieldPredicates([p.not]));
    /* A relation predicate's inner `where` names fields of the TARGET entity,
       not this one — checked separately, against that entity. */
    else if (p.relation) continue;
    else if (p.field) out.push(p);
  }
  return out;
}

/** Relation predicates, with the entity each one hops into. */
function relationPredicates(where: any[]): any[] {
  const out: any[] = [];
  for (const p of where ?? []) {
    if (!p || typeof p !== 'object') continue;
    if (Array.isArray(p.or)) out.push(...relationPredicates(p.or));
    else if (Array.isArray(p.and)) out.push(...relationPredicates(p.and));
    else if (p.not) out.push(...relationPredicates([p.not]));
    else if (p.relation) out.push(p);
  }
  return out;
}

describe.each(AUTOMATION_AGENTS.map(a => [a.id, a] as const))('%s', (_id, automation) => {
  const steps = flatten(automation.steps as Step[]);
  const finds = steps.filter(s => typeof s.action === 'string' && s.action.startsWith('find_'));

  it('sorts with the key BizQL reads, not one it ignores', () => {
    for (const step of finds) {
      for (const sort of step.params?.order_by ?? []) {
        /* `dir`, per SortSpec. `direction` is the spelling that read as sorted
           and was not. */
        expect(`${step.action}:${JSON.stringify(sort)}`).toContain('"dir"');
        expect(['asc', 'desc']).toContain(sort.dir);
      }
    }
  });

  it('sorts the oldest first wherever it serves a capped list', () => {
    /*
     * Every one of these finds is a backlog with a limit under it. Newest-first
     * would mean the client who has waited longest is the one never reached —
     * the opposite of what the owner was promised.
     */
    for (const step of finds) {
      const sorts = step.params?.order_by ?? [];
      expect(`${step.action}:sorted`).toBe(`${step.action}:${sorts.length ? 'sorted' : 'UNSORTED'}`);
      for (const sort of sorts) expect(sort.dir).toBe('asc');
    }
  });

  it('names only fields the catalog declares', () => {
    for (const step of finds) {
      const entityKey = entityOf(step.action);
      /* Named rather than asserted truthy, so a plan calling an action no
         entity owns says WHICH action in the failure. */
      expect(`${step.action} → ${entityKey ?? 'NO SUCH ENTITY'}`).not.toContain('NO SUCH ENTITY');

      const known = fieldsOf(entityKey!);
      const named = [
        ...fieldPredicates(step.params?.filters ?? []).map(p => p.field),
        ...(step.params?.order_by ?? []).map((s: any) => s.field),
      ];

      for (const field of named) {
        /* The field name travels in the message, so a failure says which one
           rather than just `false`. */
        expect(`${entityKey}.${known.has(field) ? field : `${field} — NOT IN CATALOG`}`).toBe(
          `${entityKey}.${field}`
        );
      }
    }
  });

  it('hops only to relations that exist, and names their fields correctly', () => {
    /*
     * The other half of the field check, and the half the first version
     * skipped entirely.
     *
     * A relation predicate (`{relation: 'bookings', quantifier: 'none',
     * where: [...]}`) is how a plan asks about a contact's bookings without
     * leaving the contact. Its inner fields belong to the TARGET entity, so
     * checking them against the outer one would reject every valid hop — and
     * skipping them, which is what happened, lets `start_tyme` through in the
     * one filter whose whole job is excluding people who already rebooked.
     * Getting that wrong writes "we have not seen you in six months" to
     * somebody who is booked in for Tuesday.
     */
    for (const step of finds) {
      const entityKey = entityOf(step.action)!;
      const relations = (CATALOG.entities[entityKey] as any)?.relations ?? {};

      for (const p of relationPredicates(step.params?.filters ?? [])) {
        const target = relations[p.relation]?.target;
        expect(`${entityKey} → ${target ? p.relation : `${p.relation} — NO SUCH RELATION`}`).toBe(
          `${entityKey} → ${p.relation}`
        );

        expect(['any', 'none']).toContain(p.quantifier);

        const known = fieldsOf(target);
        for (const inner of fieldPredicates(p.where ?? [])) {
          expect(`${target}.${known.has(inner.field) ? inner.field : `${inner.field} — NOT IN CATALOG`}`)
            .toBe(`${target}.${inner.field}`);
        }
      }
    }
  });

  it('uses no operator BizQL does not have', () => {
    const OPS = new Set([
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in',
      'contains', 'starts_with', 'between', 'is_null', 'is_not_null', 'overlaps',
    ]);
    const VALUELESS = new Set(['is_null', 'is_not_null']);

    for (const step of finds) {
      const inner = relationPredicates(step.params?.filters ?? []).flatMap((r: any) =>
        fieldPredicates(r.where ?? [])
      );

      for (const p of [...fieldPredicates(step.params?.filters ?? []), ...inner]) {
        expect(`${p.field} ${p.op}`).toBe(`${p.field} ${OPS.has(p.op) ? p.op : `${p.op} — NOT AN OPERATOR`}`);
        /* A valueless op given a value, or a value-taking op given none, both
           fail validation at run time — which for a cron means silently, at
           3am, on somebody's account. */
        expect(`${p.field} ${p.op} has value: ${'value' in p}`).toBe(
          `${p.field} ${p.op} has value: ${!VALUELESS.has(p.op)}`
        );
      }
    }
  });
});

/**
 * One agent, one rule that cost a live near-miss.
 *
 * Kept apart from the grammar checks above because it is not about grammar:
 * both spellings below are valid BizQL and the plan ran fine with only the
 * first. It was simply wrong about people.
 */
describe('win_back_quiet_clients knows what quiet means', () => {
  const plan = AUTOMATION_AGENTS.find(a => a.id === 'win_back_quiet_clients')!;
  const find = (plan.steps as any[])[0];
  const hops = (find.params.filters as any[]).filter(p => p.relation === 'bookings');

  it('tests the appointment hour AND when the booking was made', () => {
    /*
     * A booking for a non-scheduled service — a course, a package, anything
     * that is not an hour in the diary — has NO `start_time`. Against the hour
     * alone it reads as ancient, so a client who had bought something nine
     * days earlier came back on the live account's lapsed list. They would
     * have been sent "here's an easy way back" a week after buying.
     */
    expect(hops.map(h => h.where[0].field).sort()).toEqual(['created_at', 'start_time']);
  });

  it('and leaves somebody alone on EITHER kind of recent booking', () => {
    /*
     * The two SIX-MONTH hops are `none`: nothing recent either way. One of
     * them as `any` would invert the rule for half the population without
     * changing a field name.
     *
     * The third hop, added with the owner's stop rule, is deliberately `any` —
     * it is the floor, not the ceiling. Somebody whose last booking predates
     * the owner's limit has left, and a warm note about coming back reads as a
     * cold mailshot. Matched on the offset so the two cannot be confused.
     */
    const sixMonth = hops.filter(h => JSON.stringify(h.where).includes('"months":-6'));

    expect(sixMonth).toHaveLength(2);
    for (const hop of sixMonth) expect(hop.quantifier).toBe('none');

    const floor = hops.filter(h => JSON.stringify(h.where).includes('stop_after_days'));
    expect(floor).toHaveLength(1);
    expect(floor[0].quantifier).toBe('any');
  });
});

/**
 * A booking with no date is still a booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking for a NON-SCHEDULED service — a course, a package, anything that is
 * not an hour in the diary — carries no `start_time` at all. Any rule that asks
 * "when were they last here" by the appointment hour alone cannot see those
 * people.
 *
 * It has now bitten twice. In `win_back_quiet_clients` it made a client who had
 * bought something nine days earlier look lapsed. In `rebook_quiet_clients` it
 * did the opposite: a client whose only booking was a dateless course was too
 * old for this agent and too recent for the win-back, so NOBODY would ever have
 * written to him.
 *
 * So both agents test recency two ways, and this pins it for both.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('recency is never judged by the appointment hour alone', () => {
  /** Every date field named inside a `bookings` hop, however nested. */
  function hopFields(where: any[]): string[] {
    const out: string[] = [];
    for (const p of where ?? []) {
      if (!p || typeof p !== 'object') continue;
      if (Array.isArray(p.or)) out.push(...hopFields(p.or));
      else if (Array.isArray(p.and)) out.push(...hopFields(p.and));
      else if (p.field) out.push(p.field);
    }
    return out;
  }

  it.each(['rebook_quiet_clients', 'win_back_quiet_clients'])('%s', id => {
    const plan = AUTOMATION_AGENTS.find(a => a.id === id)!;
    const find = (plan.steps as any[])[0];

    /*
     * Every hop that asks "when were they last here", by whichever bound —
     * the fixed six months that separates the two agents, and the owner's own
     * stop rule. Each must read the appointment hour AND the booking date, or
     * a dateless course is invisible to it.
     */
    const recency = (find.params.filters as any[]).filter(p => {
      if (p.relation !== 'bookings') return false;
      const inner = JSON.stringify(p.where ?? []);
      return inner.includes('"months":-6') || inner.includes('stop_after_days');
    });

    expect(recency.length).toBeGreaterThan(0);

    /*
     * The UNION, because the two agents express it in different shapes and
     * both are correct. `win_back` needs nothing recent either way, so it uses
     * two separate `none` hops with one field each. `rebook` needs something
     * recent by either measure, so it uses one `any` hop with an OR inside.
     * What matters is that neither field is missing from the pair.
     */
    const fields = new Set(recency.flatMap(h => hopFields(h.where)));

    expect([...fields].sort()).toEqual(['created_at', 'start_time']);
  });
});

/**
 * One person who cannot be written to must not stop the rest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every one of these plans fans out over people and sends to each. In
 * PRODUCTION mode `ParallelExecutor` re-throws a failing scatter item and
 * aborts the whole run unless `scatter.continueOnError` is set.
 *
 * Per-person refusals are ordinary here, not exceptional. Somebody
 * unsubscribed since the last run and `marketingGate` now refuses them; an
 * address bounces; the transport errors. None of that is a reason to stop
 * writing to the other fourteen.
 *
 * And the ordering makes it permanent rather than occasional: every find is
 * `dir: 'asc'`, oldest first, so the person who cannot be reached sits at the
 * TOP of the list and blocks everybody behind them on every run, for good.
 *
 * The gather phase already filters error objects out of the results, so the
 * run still reports what actually went and what did not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('a fan-out survives one bad recipient', () => {
  it.each(AUTOMATION_AGENTS.map(a => [a.id, a] as const))('%s', (_id, automation) => {
    const scatters = (automation.steps as any[]).filter(step => step.scatter);

    /* Every one of these agents sends per person, so every one has a scatter. */
    expect(scatters.length).toBeGreaterThan(0);

    for (const step of scatters) {
      expect(`${step.step_id}: continueOnError=${step.scatter.continueOnError}`).toBe(
        `${step.step_id}: continueOnError=true`
      );
    }
  });
});

/**
 * Every variable a plan spends, the runtime supplies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Plans now carry `{{stop_after_days}}` in their filters, resolved from
 * `agent_config` by `planInputs` and handed to the pilot as `inputValues`.
 *
 * An unresolved one does NOT degrade: the date resolver is given the literal
 * string `"{{stop_after_days}}"` as a day offset and throws `RangeError:
 * Invalid time value` on the very first step. Loud is right — a silent
 * fallback would quietly chase for the wrong length of time — but it means a
 * runner that forgets the inputs breaks every agent at once.
 *
 * Found while probing: a script that read a plan's filters straight out of the
 * file, without substituting, died exactly that way. The runner is not written
 * yet, so this is the thing that will tell whoever writes it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the runtime supplies every variable the plans spend', () => {
  it.each(AUTOMATION_AGENTS.map(a => [a.id, a] as const))('%s', (_id, automation) => {
    const used = new Set(
      [...JSON.stringify(automation.steps).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])
    );

    /* Scatter item variables are bound by the executor, not by the runner. */
    const bound = new Set(
      (automation.steps as any[])
        .filter(s => s.scatter?.itemVariable)
        .map(s => s.scatter.itemVariable as string)
    );

    /* Step outputs are bound by the steps before them. */
    for (const step of automation.steps as any[]) {
      if (step.output_variable) bound.add(step.output_variable);
      for (const inner of step.scatter?.steps ?? []) {
        if (inner.output_variable) bound.add(inner.output_variable);
      }
    }

    const supplied = new Set(Object.keys(planInputs(automation, null)));

    for (const variable of used) {
      /* `{{a.b}}` reads a field off a bound object; only the root matters. */
      const root = variable.split('.')[0];
      if (bound.has(root)) continue;

      expect(`${automation.id} spends {{${variable}}}, supplied: ${supplied.has(root)}`).toBe(
        `${automation.id} spends {{${variable}}}, supplied: true`
      );
    }
  });
});
