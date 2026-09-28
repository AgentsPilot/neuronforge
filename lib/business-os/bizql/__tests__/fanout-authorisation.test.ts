/**
 * Contacting everyone has to have been asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * The fan-out rule has always said, in prose: "the find step MUST carry a filter
 * saying who. If the user did not say who, ask — never fall back to everyone.
 * 'send it to them' with no referent is a question, not an instruction to
 * contact every record you have."
 *
 * Nothing enforced it. Asked "send them a reminder" with no referent, the
 * planner produced exactly the banned shape: an unfiltered find, fanned out. The
 * only thing between that and the send was a human reading a recipient count on
 * an approval card, and a count of 100 looks plausible to someone who believes
 * "them" meant a subset.
 *
 * WHY A GROUNDING CHECK AND NOT A BAN
 *
 * "Email all my contacts" is a supported request — `send` is bulk-capable with a
 * ceiling of 100 precisely for it. So an unfiltered fan-out is not wrong in
 * itself; it is wrong when nobody asked for everyone. The licence has to be
 * traceable to the user's own words, which is the same shape as the guard that
 * stops a write inventing a required value.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

/** A fan-out whose source find carries `where`, or does not. */
const fanOut = (where: unknown[]): Plan =>
  ({
    steps: [
      { id: 's1', op: 'find', entity: 'contacts', where, select: ['id', 'email'] },
      {
        id: 's2',
        op: 'for_each',
        over: 's1',
        entity: 'contacts',
        action: 'send',
        params: { to: { $item: 'email' }, subject: 'Hello', body: 'Hello there' },
      },
    ],
    answer: { text: 'Sent to {s1.count} people.' },
  }) as unknown as Plan;

const STAGE = [{ field: 'stage', op: 'eq', value: 'customer' }];
const everyone = (p: string[]) => p.filter((x) => /fans out over EVERY/.test(x));

describe('an unfiltered fan-out', () => {
  it('is refused when the request named nobody', () => {
    const problems = validatePlan(fanOut([]), 'send them a reminder');
    expect(everyone(problems)).toHaveLength(1);
    expect(problems[0]).toMatch(/did not ask for everyone/);
  });

  it('is allowed when the request said everyone, in English', () => {
    expect(everyone(validatePlan(fanOut([]), 'email all my contacts'))).toHaveLength(0);
    expect(everyone(validatePlan(fanOut([]), 'send everyone a happy new year email'))).toHaveLength(0);
  });

  it('is allowed when the request said everyone, in Hebrew', () => {
    // This is an Israeli product: a guard that only reads English would refuse
    // the request it is meant to permit.
    expect(everyone(validatePlan(fanOut([]), 'שלח לכולם מייל שנה טובה'))).toHaveLength(0);
    expect(everyone(validatePlan(fanOut([]), 'שלח מייל לכל הלקוחות'))).toHaveLength(0);
  });

  it('is allowed when the request said everyone, in Spanish', () => {
    expect(everyone(validatePlan(fanOut([]), 'envía un correo a todos los clientes'))).toHaveLength(0);
  });
});

describe('a filtered fan-out', () => {
  it('is always allowed, whatever the wording', () => {
    // The filter IS the answer to "who", so nothing more is needed.
    expect(everyone(validatePlan(fanOut(STAGE), 'send them a reminder'))).toHaveLength(0);
    expect(everyone(validatePlan(fanOut(STAGE), 'remind the ones who have not paid'))).toHaveLength(0);
  });
});

describe('when no message is supplied', () => {
  it('does not refuse, because the check has nothing to read', () => {
    /*
     * The plan cache and some tooling validate without an utterance. Refusing
     * every fan-out there would fail closed on the wrong axis: the guard exists
     * to compare a plan against a request, and with no request there is no
     * comparison to make.
     */
    expect(everyone(validatePlan(fanOut([])))).toHaveLength(0);
  });
});
