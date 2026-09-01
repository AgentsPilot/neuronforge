/**
 * A count must be a count of the noun the sentence uses.
 *
 * Asked "כמה לקוחות יש חשבוניות פתוחות", the planner counted INVOICES and wrote
 * "יש לך {s1.value} לקוחות" — two unpaid invoices from one person, reported as
 * two clients. Everything typechecked: the entity is real, the filter is right,
 * the number is a genuine count. It counts the wrong thing.
 *
 * Catchable without any understanding of language, because the catalog names
 * every entity in all three — `contacts.labels.many.he` IS "לקוחות".
 */

import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const countInvoices = (text: string, agg: Record<string, unknown> = {}): Plan =>
  ({
    steps: [
      {
        id: 's1',
        op: 'compute',
        entity: 'invoices',
        agg: { fn: 'count', field: 'id', ...agg },
      },
    ],
    answer: { text },
  }) as unknown as Plan;

// validatePlan returns the problems array directly.
const problemsFor = (plan: Plan): string[] => validatePlan(plan);

describe('a count whose sentence names a different thing', () => {
  it('is refused in Hebrew', () => {
    const problems = problemsFor(countInvoices('יש לך {s1.value} לקוחות עם חשבוניות פתוחות.'));
    // The sentence says לקוחות, the step counts invoice rows.
    expect(problems.join(' ')).toMatch(/counts 'contacts' but the step counts 'invoices'/);
  });

  it('is refused in English and Spanish too', () => {
    expect(problemsFor(countInvoices('You have {s1.value} clients who owe you.')).join(' ')).toMatch(
      /counts 'contacts'/
    );
    expect(problemsFor(countInvoices('Tienes {s1.value} clientes.')).join(' ')).toMatch(
      /counts 'contacts'/
    );
  });

  it('suggests both correct forms', () => {
    const problems = problemsFor(countInvoices('יש לך {s1.value} לקוחות.')).join(' ');
    expect(problems).toContain('quantifier');       // query contacts instead
    expect(problems).toContain('distinct');          // or count distinct contact_id
  });
});

describe('what it must NOT refuse', () => {
  it('allows a count that names what it counted', () => {
    expect(problemsFor(countInvoices('יש לך {s1.value} חשבוניות פתוחות.'))).toEqual([]);
  });

  it('allows a sentence mentioning both, led by the thing counted', () => {
    // "2 invoices from 1 client" is a correct and useful sentence.
    expect(problemsFor(countInvoices('{s1.value} חשבוניות פתוחות מלקוחות שלך.'))).toEqual([]);
  });

  it('allows counting distinct clients, which IS counting clients', () => {
    const plan = countInvoices('יש לך {s1.value} לקוחות.', {
      field: 'contact_id',
      distinct: true,
    });
    expect(problemsFor(plan)).toEqual([]);
  });

  it('leaves sums alone — a total is not a count of nouns', () => {
    const plan = {
      steps: [
        { id: 's1', op: 'compute', entity: 'invoices', agg: { fn: 'sum', field: 'amount' } },
      ],
      answer: { text: 'הלקוחות חייבים לך {s1.value}.' },
    } as unknown as Plan;
    expect(problemsFor(plan)).toEqual([]);
  });
});
