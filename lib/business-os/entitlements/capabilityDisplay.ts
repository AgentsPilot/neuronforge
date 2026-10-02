import 'server-only';

/**
 * How a capability VALUE is written for a human.
 *
 * ── Why it is one function and not two ──────────────────────────────────────
 * The plan cards and the account lookup show the same values, and they showed
 * them differently: the cards said `1 seat` while the lookup printed
 * `{"included":1,"purchasable":false}` straight out of `JSON.stringify` (QA-8).
 * One of those is a value an admin can read and the other is the shape of our
 * storage.
 *
 * A screen with two formatters is a screen that will eventually disagree with
 * itself about what an account has — which is the same failure as two granting
 * rules, one layer down. So there is one, it lives server-side with the rest of
 * the deciding, and both payloads carry its output rather than the raw value.
 *
 * The raw value is still sent alongside: this is presentation, and a caller
 * that wants to compare numbers should compare numbers.
 */

import { defaultLocale, type Locale } from '@/lib/i18n/config';
import type { CapabilityDef, CapabilityValue } from './types';

/**
 * The words around a value, per language (credit deduction slice 6, OI-10).
 *
 * ── What is localised, and what is not (SA Q-10) ──────────────────────
 * The PHRASES are: "per month", "in total", the fair-use note, the unit and
 * "more purchasable". The NUMBER is grouped by the reader's language through
 * `Intl.NumberFormat(locale)` — the same call the dashboard card makes, so the
 * plan screen and the card print 32,250 identically (Spanish groups `19.750`
 * but not `2000`, which is CLDR's rule and accepted).
 *
 * Not localised, deliberately:
 *   - variant ids (`branded`, `priority`, …) pass through unchanged — they are
 *     ids, and translating them is a separate decision (Q-10);
 *   - `yes` / `no`: never shown to a customer (`groupByCategory` drops `yes`, and
 *     a `no` is not granting, so it is never listed), and the `yes` comparison in
 *     `groupByCategory` keys on the English word.
 *
 * Admin callers pass no locale and keep English: the admin screens are English.
 *
 * Templates only — **no figure lives here**. Every number comes from the value
 * the resolver produced off the tier matrix / cohort config.
 */
interface ValuePhrases {
  perMonth: (n: string) => string;
  total: (n: string) => string;
  fairUse: (n: string) => string;
  quantity: (count: number, n: string, unit: 'seat' | 'location' | 'included') => string;
  morePurchasable: string;
}

const PHRASES: Record<Locale, ValuePhrases> = {
  en: {
    perMonth: (n) => `${n} per month`,
    total: (n) => `${n} in total`,
    fairUse: (n) => `${n} per month (alerts, never blocks)`,
    quantity: (count, n, unit) => `${n} ${unit}${count === 1 ? '' : 's'}`,
    morePurchasable: ', more purchasable',
  },
  he: {
    perMonth: (n) => `${n} לחודש`,
    total: (n) => `${n} בסך הכול`,
    fairUse: (n) => `${n} לחודש (התראה בלבד, ללא חסימה)`,
    quantity: (count, n, unit) => {
      const words = { seat: ['מושב', 'מושבים'], location: ['מיקום', 'מיקומים'], included: ['כלול', 'כלולים'] }[unit];
      return `${n} ${count === 1 ? words[0] : words[1]}`;
    },
    morePurchasable: ', ניתן לרכוש עוד',
  },
  es: {
    perMonth: (n) => `${n} al mes`,
    total: (n) => `${n} en total`,
    fairUse: (n) => `${n} al mes (avisa, nunca bloquea)`,
    quantity: (count, n, unit) => {
      const words = { seat: ['puesto', 'puestos'], location: ['ubicación', 'ubicaciones'], included: ['incluido', 'incluidos'] }[unit];
      return `${n} ${count === 1 ? words[0] : words[1]}`;
    },
    morePurchasable: ', se pueden comprar más',
  },
};

/**
 * One number formatter per locale, built once (SA 6b optimisation note): the
 * plan screen asks for about thirty values per plan, and an `Intl.NumberFormat`
 * is not free to construct. The options never vary, so the locale is the key.
 */
const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();

function numberFormatFor(locale: string): Intl.NumberFormat {
  let format = NUMBER_FORMATS.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    NUMBER_FORMATS.set(locale, format);
  }
  return format;
}

/**
 * `{ perMonth: 500 }` → `500 per month` (or `500 לחודש`, `500 al mes`).
 * Presentation only, never a decision.
 */
export function describeCapabilityValue(
  value: CapabilityValue,
  definition: CapabilityDef,
  locale: Locale = defaultLocale
): string {
  const shape = definition.shape;
  const phrases = PHRASES[locale] ?? PHRASES[defaultLocale];
  const number = numberFormatFor(locale);

  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.perMonth === 'number') return phrases.perMonth(number.format(record.perMonth));
    if (typeof record.total === 'number') return phrases.total(number.format(record.total));
    if (typeof record.ceilingPerMonth === 'number') return phrases.fairUse(number.format(record.ceilingPerMonth));
    if (typeof record.included === 'number') {
      const unit = shape.kind === 'quantity' ? shape.unit : 'included';
      const purchasable = record.purchasable === true ? phrases.morePurchasable : '';
      return `${phrases.quantity(record.included, number.format(record.included), unit)}${purchasable}`;
    }
  }

  // Not reachable for any shape the catalog declares. Kept as a last resort so
  // a new shape shows SOMETHING rather than an empty cell — and it is ugly on
  // purpose, because it should be noticed and given a case above.
  return JSON.stringify(value);
}
