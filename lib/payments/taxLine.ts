/**
 * The tax already inside a price.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 *
 * Not a tax engine. It does not decide whether tax applies, look up a rate,
 * validate a VAT id, handle reverse charge, cross-border supply, exemptions or
 * filing. This platform charges a client for a service; what that charge is
 * made of is the business's affair and their accountant's.
 *
 * WHAT IT IS
 *
 * Arithmetic on a number the business typed. A VAT-registered business in the
 * EU (or anywhere with an inclusive-price convention) shows its clients a gross
 * price with the tax noted — "€100, includes 19% VAT" — and until now the
 * document said €100 and nothing else. The rate comes from the business, the
 * split is derived, and nobody's tax position is being computed.
 *
 * INCLUSIVE, never additive. The price the business set is the price the client
 * pays; the tax is carved OUT of it. Adding tax on top would change what people
 * are charged, which is not a display concern and not something a settings
 * toggle should ever do quietly.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/taxLine
 */

import { fromMinorUnits, toMinorUnits } from './refundMath';

export interface TaxLineSettings {
  /** The business says its prices already contain tax. */
  invoice_prices_include_tax?: boolean | null;
  /** Percent, as the business typed it: 19, 17, 21, 8.5. */
  invoice_tax_rate?: number | string | null;
  /** What they call it — VAT, מע״מ, IVA, MwSt. Free text, theirs. */
  invoice_tax_label?: string | null;
}

export interface TaxLine {
  /** The tax contained in the gross amount, in major units. */
  amount: number;
  /** The gross minus the tax — what the business keeps before costs. */
  net: number;
  /** The rate used, echoed back for the label. */
  rate: number;
  label: string;
}

/**
 * The tax inside a gross amount, or null when the business has not asked for it.
 *
 * Null — not zero — when it does not apply: a zero would render a "VAT: 0.00"
 * line on documents from every business that never configured tax, which is
 * worse than silence and would look like a mistake to their clients.
 */
export function taxLineFor(
  grossAmount: number,
  currency: string,
  settings: TaxLineSettings | null | undefined
): TaxLine | null {
  if (!settings?.invoice_prices_include_tax) return null;

  const rate = Number(settings.invoice_tax_rate ?? 0);

  // A rate of zero is not a tax line, and a negative or absurd one is a typo
  // rather than an instruction. 100% is the ceiling because the tax cannot be
  // the whole of an inclusive price.
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 100) return null;
  if (!Number.isFinite(grossAmount) || grossAmount <= 0) return null;

  /*
   * Carved out, in MINOR units.
   *
   * `gross − gross / (1 + rate/100)` in floating point lands on values like
   * 15.966386554621847, and rounding that per document rather than per currency
   * puts a half-agora on an invoice. `toMinorUnits` knows that JPY has no minor
   * unit and KWD has three, so the rounding is right for the currency the
   * client is actually being charged in.
   */
  const grossMinor = toMinorUnits(grossAmount, currency);
  const netMinor = Math.round(grossMinor / (1 + rate / 100));
  const taxMinor = grossMinor - netMinor;

  if (taxMinor <= 0) return null;

  return {
    amount: fromMinorUnits(taxMinor, currency),
    net: fromMinorUnits(netMinor, currency),
    rate,
    label: (settings.invoice_tax_label || '').trim() || 'VAT',
  };
}
