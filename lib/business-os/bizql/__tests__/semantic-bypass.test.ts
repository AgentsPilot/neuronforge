/**
 * A declared grouping may not be bypassed with a literal nobody said.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG
 *
 *   "¿qué facturas están sin pagar?"  ->  status eq "overdue"
 *
 * Every existing check passed it, because `overdue` IS a stored value. But
 * `invoices.status` declares `unpaid: ['sent','overdue']`, so the answer silently
 * omitted every invoice that was sent and not yet late. A wrong figure about
 * money owed, stated confidently.
 *
 * WHY A CHECK AND NOT A RULE
 *
 * The planner already has the rule in prose. Measured twice this session: prose
 * does not carry this class. A rule naming a bug with its own example scored 0/3;
 * typing the schema against a wrong shape moved the repair rate from 45% to 58%.
 * What works is a closed vocabulary to pick from — `entity`, `action` and `op`
 * are enums and are almost always right. This is that, for one field.
 *
 * It does not forbid the literal. "Show me overdue invoices" is a real request
 * and `overdue` is the right filter for it. It forbids the literal when the user
 * did not say it, which is the only case where the declared grouping was meant.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { isSoftProblem, validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const find = (where: unknown[]): Plan =>
  ({
    steps: [{ id: 's1', op: 'find', entity: 'invoices', where }],
    answer: { text: 'You have {s1.count} invoices.' },
  }) as unknown as Plan;

const status = (value: unknown) => [{ field: 'status', op: 'eq', value }];

/** Only the problems this check raises, so unrelated rules cannot mask a result. */
const bypass = (problems: string[]) => problems.filter((p) => /declared grouping was bypassed/.test(p));

describe('filtering a grouped field by one of its values', () => {
  it('is refused when the request never named that value', () => {
    const problems = bypass(validatePlan(find(status('overdue')), '¿qué facturas están sin pagar?'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/\{"\$semantic":"unpaid"\}/);
  });

  it('is allowed when the request named it in English', () => {
    expect(bypass(validatePlan(find(status('overdue')), 'show me overdue invoices'))).toHaveLength(0);
  });

  it('is allowed when the request named its label in Spanish, inflected', () => {
    // enumLabels.overdue.es is "vencida"; the user wrote "vencidas". Refusing
    // that would refuse someone naming the status correctly in their own
    // language, which is why this matches on a token PREFIX.
    expect(bypass(validatePlan(find(status('overdue')), 'muéstrame facturas vencidas'))).toHaveLength(0);
  });

  it('is allowed when the request named its label in Hebrew', () => {
    expect(bypass(validatePlan(find(status('overdue')), 'אילו חשבוניות באיחור'))).toHaveLength(0);
  });

  it('is allowed through one leading Hebrew particle', () => {
    // "שבאיחור" carries a prefix; the label is "באיחור". Same rule the row
    // resolver follows for "לאופיר".
    expect(bypass(validatePlan(find(status('overdue')), 'חשבוניות שבאיחור'))).toHaveLength(0);
  });

  it('does NOT read "paid" as said because the request contains "unpaid"', () => {
    /*
     * THE FALSE POSITIVE THAT DECIDED THE IMPLEMENTATION.
     *
     * `isGroundedIn` was the obvious helper to reuse and is a SUBSTRING test, so
     * it reports "paid" as grounded in "unpaid invoices" — letting through a
     * filter that means the opposite of the request. Token-prefix matching is
     * what refuses it: the token "unpaid" does not start with "paid".
     */
    const problems = bypass(validatePlan(find(status('paid')), 'which invoices are unpaid?'));
    expect(problems).toHaveLength(1);
  });

  it('flags a value nested inside and/or', () => {
    const nested = find([{ and: [{ field: 'status', op: 'eq', value: 'overdue' }] }]);
    expect(bypass(validatePlan(nested, 'what is still owed?'))).toHaveLength(1);
  });

  it('flags each unnamed value in an `in` list', () => {
    const problems = bypass(validatePlan(find([{ field: 'status', op: 'in', value: ['sent', 'overdue'] }]), 'what is still owed?'));
    expect(problems).toHaveLength(2);
  });
});

describe('what it leaves alone', () => {
  it('a NEGATIVE filter, which excludes a value rather than picking one', () => {
    /*
     * `status neq "paid"` is a different intent from picking one value instead of
     * the grouping. Asked "any invoices past their due date?" the planner wrote
     * exactly that; refusing it exhausted the repair rounds and killed the turn,
     * so the user got nothing instead of a broader answer than ideal.
     */
    const plan = find([{ field: 'status', op: 'neq', value: 'paid' }]);
    expect(bypass(validatePlan(plan, 'any invoices past their due date?'))).toHaveLength(0);
  });

  it('is SOFT, so a model that will not comply still ships an answer', () => {
    const problems = bypass(validatePlan(find(status('overdue')), '¿qué facturas están sin pagar?'));
    expect(problems).toHaveLength(1);
    expect(isSoftProblem(problems[0])).toBe(true);
  });

  it('a semantic term, which is the shape being encouraged', () => {
    expect(bypass(validatePlan(find(status({ $semantic: 'unpaid' })), '¿qué facturas están sin pagar?'))).toHaveLength(0);
  });

  it('a field with no declared groupings', () => {
    // Nothing better to offer, so refusing its literals would refuse the only
    // vocabulary available.
    const plan = find([{ field: 'invoice_number', op: 'eq', value: 'INV-00002' }]);
    expect(bypass(validatePlan(plan, 'mark that one paid'))).toHaveLength(0);
  });

  it('a value that is not a stored value at all, which another check owns', () => {
    const problems = validatePlan(find(status('archived')), 'show me archived invoices');
    expect(bypass(problems)).toHaveLength(0);
    expect(problems.some((p) => /not a valid value/.test(p))).toBe(true);
  });

  it('every plan validated without a message', () => {
    /*
     * Saved plans, tapped alternatives and the eval harness all validate with no
     * utterance. All three are legitimate, and none is a turn someone just
     * typed, so there is nothing to compare against.
     */
    expect(bypass(validatePlan(find(status('overdue'))))).toHaveLength(0);
  });
});

describe('a grouping that was asked for and dropped', () => {
  /*
   * The other half, and the more dangerous one.
   *
   *   "how much money am I owed in total?"  ->  sum(total) over invoices, where []
   *
   * Every invoice ever raised, paid and cancelled included, reported as what the
   * business is owed. Nothing objected, because no literal was wrong: the filter
   * was simply absent, and an absent filter looks like a plan about everything.
   *
   * So the QUESTION is what decides it. `invoices.status` declares cue words for
   * `unpaid`, and those words never reach the prompt — they exist only for this
   * check, which is what keeps them from becoming the dead example strings the
   * catalog rejected synonyms over.
   */
  const total = (where: unknown[]): Plan =>
    ({
      steps: [{ id: 's1', op: 'compute', entity: 'invoices', agg: { fn: 'sum', field: 'total' }, where }],
      answer: { text: 'You are owed {s1.value}.' },
    }) as unknown as Plan;

  const dropped = (problems: string[]) =>
    problems.filter((p) => /grouping was asked for and dropped/.test(p));

  it('is flagged when the request says owed and nothing filters status', () => {
    const problems = dropped(validatePlan(total([]), 'how much money am I owed in total?'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/\{"\$semantic":"unpaid"\}/);
  });

  it('is flagged in Hebrew and Spanish too', () => {
    expect(dropped(validatePlan(total([]), 'כמה סך הכול אופיר חייב לי?'))).toHaveLength(1);
    expect(dropped(validatePlan(total([]), '¿cuánto me deben en total?'))).toHaveLength(1);
  });

  it('is flagged when some OTHER field is filtered but not this one', () => {
    // The contact was pinned down and the status was not, which is exactly the
    // "how much does Ofir owe me" failure: it summed everything he was ever
    // invoiced.
    const byPerson = total([
      { relation: 'contact', quantifier: 'any', where: [{ field: 'first_name', op: 'eq', value: 'Ofir' }] },
    ]);
    expect(dropped(validatePlan(byPerson, 'how much does Ofir owe me in total?'))).toHaveLength(1);
  });

  it('is silent once the status IS filtered, by term or by literal', () => {
    const byTerm = total([{ field: 'status', op: 'eq', value: { $semantic: 'unpaid' } }]);
    expect(dropped(validatePlan(byTerm, 'how much am I owed?'))).toHaveLength(0);

    const byLiteral = total([{ field: 'status', op: 'in', value: ['sent', 'overdue'] }]);
    expect(dropped(validatePlan(byLiteral, 'how much am I owed?'))).toHaveLength(0);
  });

  it('is silent when the question asks about no grouping at all', () => {
    // "How much have I invoiced" is genuinely about every invoice, and a check
    // that fired here would buy a wasted repair round on a correct plan.
    expect(dropped(validatePlan(total([]), 'how much have I invoiced in total?'))).toHaveLength(0);
    expect(dropped(validatePlan(total([]), 'what is my total revenue?'))).toHaveLength(0);
  });

  it('is SOFT, so a stubborn plan still answers', () => {
    const problems = dropped(validatePlan(total([]), 'how much am I owed?'));
    expect(isSoftProblem(problems[0])).toBe(true);
  });

  it('never fires without a message', () => {
    expect(dropped(validatePlan(total([])))).toHaveLength(0);
  });
});
