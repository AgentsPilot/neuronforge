/**
 * "Business details, complete" on a business we could not identify.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported from a real account's readiness card. Measured, with the live row:
 *
 *   company_name     "David KPMG"
 *   vertical         "default"        <- counted as a filled business type
 *   industry         "other"
 *   company_size     "solo"
 *   primary_goal     "grow_revenue"
 *   technical_level  "non_technical"
 *   -> missing: []   complete: true
 *
 * The card was telling the truth about its own rule. The rule was wrong:
 * `vertical` holds `'default'` when the story extraction cannot tell what the
 * business does, and `hasValue` only asks whether the string is non-empty.
 * Nobody typed "default" — we did.
 *
 * It is the one field in that list the whole setup hangs off: the pipeline
 * preset, the website's copy, and the sub-vertical all read it. Marking it
 * answered is how an owner never gets asked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { missingProfileFields, isBusinessProfileComplete } from '../profileReadiness';

const SETTINGS = {
  industry: 'other',
  company_size: 'solo',
  primary_goal: 'grow_revenue',
  technical_level: 'non_technical',
};

describe('a vertical we could not read is not a business type', () => {
  it('counts "default" as missing, which is the live case', () => {
    const profile = { company_name: 'David KPMG', vertical: 'default' };

    expect(missingProfileFields(profile, SETTINGS)).toEqual(['business_type']);
    expect(isBusinessProfileComplete(profile, SETTINGS)).toBe(false);
  });

  it('counts "other" as missing too, which is the same sentinel renamed', () => {
    // Still in older rows: the extraction's fallback used to be 'other'.
    const profile = { company_name: 'David KPMG', vertical: 'other' };
    expect(missingProfileFields(profile, SETTINGS)).toEqual(['business_type']);
  });

  it('ignores case and padding, because a sentinel can arrive either way', () => {
    expect(missingProfileFields({ company_name: 'X', vertical: ' Default ' }, SETTINGS))
      .toEqual(['business_type']);
  });

  it('accepts a real trade', () => {
    const profile = { company_name: 'David KPMG', vertical: 'teacher' };

    expect(missingProfileFields(profile, SETTINGS)).toEqual([]);
    expect(isBusinessProfileComplete(profile, SETTINGS)).toBe(true);
  });

  it('still reports an empty vertical as missing, as it always did', () => {
    expect(missingProfileFields({ company_name: 'X', vertical: '' }, SETTINGS))
      .toEqual(['business_type']);
    expect(missingProfileFields({ company_name: 'X', vertical: null }, SETTINGS))
      .toEqual(['business_type']);
  });

  it('does not swallow the other fields while checking this one', () => {
    // A sentinel vertical AND an unfilled form is two gaps, not one.
    expect(missingProfileFields({ company_name: '', vertical: 'default' }, {})).toEqual([
      'company_name',
      'business_type',
      'industry',
      'company_size',
      'primary_goal',
      'technical_level',
    ]);
  });
});
