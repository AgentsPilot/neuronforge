/**
 * No two entities may answer to the same name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS WORTH A TEST
 *
 * The planner picks an entity from the vocabulary the catalog declares. When two
 * entities declare the SAME word, the question is unanswerable as asked and the
 * model picks one — silently, with a plausible number attached. There is no
 * error, and the reply looks exactly like a correct one.
 *
 * Found by measurement, not by anyone noticing:
 *
 *   תשלום / תשלומים   `installments` AND `transactions`. "כמה תשלומים יש לי"
 *                     was answered by whichever the model chose — five failures
 *                     in one sweep, in both directions.
 *   payment plan      `installments` AND `plans`, in all three languages. The
 *                     plan is the OFFER; an installment is one scheduled row of
 *                     it. "The total of my payment plans" resolved to the wrong
 *                     one.
 *
 * Both were pure declaration bugs: nothing in the code was wrong, and nothing
 * connected the two declarations until this test did.
 *
 * Aliases are included deliberately — the planner matches on them exactly as it
 * matches on labels, so a colliding alias is the same defect as a colliding
 * label.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG } from '../index';

type Claim = { form: string; entity: string };

function claims(): Claim[] {
  const out: Claim[] = [];

  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    const forms: string[] = [];

    for (const lang of ['en', 'he', 'es'] as const) {
      const one = entity.labels.one[lang];
      const many = entity.labels.many[lang];
      if (one) forms.push(one);
      if (many) forms.push(many);
    }
    for (const alias of entity.aliases ?? []) forms.push(alias);

    // Case-folded and trimmed: "Payments" and "payments" are the same claim to
    // a reader, and the planner is no stricter.
    for (const form of forms) out.push({ form: form.trim().toLowerCase(), entity: key });
  }

  return out;
}

describe('entity vocabulary', () => {
  it('is claimed by at most one entity per word', () => {
    const byForm = new Map<string, Set<string>>();

    for (const { form, entity } of claims()) {
      byForm.set(form, (byForm.get(form) ?? new Set()).add(entity));
    }

    const collisions = [...byForm.entries()]
      .filter(([, entities]) => entities.size > 1)
      .map(([form, entities]) => `"${form}" is claimed by ${[...entities].join(' and ')}`);

    expect(collisions).toEqual([]);
  });

  it('collected enough vocabulary to be meaningful', () => {
    // Guards against the catalog shape changing and this passing on an empty
    // set — the failure mode that makes a guard worse than no guard.
    expect(claims().length).toBeGreaterThan(100);
  });
});
