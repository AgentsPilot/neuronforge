/**
 * The questions the planner has to get right, and what "right" means.
 *
 * Every case here is a real utterance from live use — several are bugs we
 * traced this week — rather than invented phrasing. A benchmark built from
 * imagined questions measures the imagination.
 *
 * `expect` describes the SHAPE of a correct plan, not one exact plan. There is
 * usually more than one right answer (summing transactions and invoices, or
 * only transactions, are both defensible for "income"), so scoring asks the
 * questions that distinguish right from wrong: the right entity, the right
 * operation, and — where a bug once lived — the specific field or aggregate.
 */

export interface PlanCase {
  id: string;
  message: string;
  language: 'he' | 'en' | 'es';
  /** Why this case exists — printed with failures so a regression explains itself. */
  because: string;
  expect: {
    /** Any one of these entities must appear in a step. */
    entity: string[];
    op?: Array<'find' | 'compute' | 'mutate' | 'for_each'>;
    /** Aggregate function, when the question is a quantity. */
    aggFn?: string;
    /** A field that must be filtered on — the derived-field cases. */
    whereField?: string;
    /** A field that must NOT be the send target — the phone-number bug. */
    forbidSendTo?: string[];
    /** No literal standing in for a computed value — the invented-threshold bug. */
    forbidFabricatedThreshold?: boolean;
  };
}

export const CASES: PlanCase[] = [
  {
    id: 'owes-he',
    message: 'מי חייב לי כסף?',
    language: 'he',
    because:
      'Money is owed on an unpaid invoice OR an uncollected plan period. Filtering invoices alone answered "0 contacts" for a business selling in instalments.',
    expect: { entity: ['contacts'], op: ['find'], whereField: 'owes_money' },
  },
  {
    id: 'owes-en',
    message: 'who owes me money?',
    language: 'en',
    because: 'Same question in English — the fix must not be language-specific.',
    expect: { entity: ['contacts'], op: ['find'], whereField: 'owes_money' },
  },
  {
    id: 'income-he',
    message: 'כמה הכנסות יש לי?',
    language: 'he',
    because:
      'Hebrew "כמה" is both how much and how many. Read as a count it answered "2" for a business asking its revenue.',
    expect: { entity: ['transactions', 'invoices'], op: ['compute'], aggFn: 'sum' },
  },
  {
    id: 'count-payments-he',
    message: 'כמה תשלומים קיבלתי?',
    language: 'he',
    because:
      'The counterpart of income-he. A rule that makes money always sum would break this one, which really is a count.',
    expect: { entity: ['transactions'], op: ['compute'], aggFn: 'count' },
  },
  {
    id: 'income-es',
    message: '¿cuánto he ingresado?',
    language: 'es',
    because: 'Spanish has the same how-much/how-many ambiguity as Hebrew.',
    expect: { entity: ['transactions', 'invoices'], op: ['compute'], aggFn: 'sum' },
  },
  {
    id: 'call-urgent-he',
    message: 'להתקשר לדויד דחוף מאוד',
    language: 'he',
    because:
      'There is no calling capability. The planner reached for the email action and addressed it to the phone column, and the user was asked to approve a send that could never work.',
    expect: { entity: ['contacts', 'tasks'], forbidSendTo: ['phone'] },
  },
  {
    id: 'most-profitable-he',
    message: 'מה השירות הכי רווחי שלי?',
    language: 'he',
    because:
      'Two bugs in one question. It computed max(price) then filtered price = 0 — a number invented because a filter cannot reference an earlier step — and named the cheapest service. And "profitable" is money EARNED: ranking by list price calls a costly service that never sold the most profitable one.',
    expect: { entity: ['transactions'], op: ['compute'], aggFn: 'sum', forbidFabricatedThreshold: true },
  },
  {
    id: 'unpaid-invoices-he',
    message: 'אילו חשבוניות לא שולמו?',
    language: 'he',
    because: 'The plain invoice case — it must keep working after the owes_money change.',
    expect: { entity: ['invoices'], op: ['find'] },
  },
  {
    id: 'bookings-week-en',
    message: 'what bookings do I have this week?',
    language: 'en',
    because: 'A date-anchored read, to check the model uses the relative anchors rather than a hardcoded date.',
    expect: { entity: ['bookings'], op: ['find'] },
  },
];
