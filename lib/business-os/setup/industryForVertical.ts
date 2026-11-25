/**
 * The industry a trade belongs to, so nobody is asked the same thing twice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A MAP RATHER THAN A QUESTION
 *
 * The settings form asks two things that are one thing. `vertical` — "what kind
 * of business is this" — is answered in the onboarding chat and offers
 * hairdresser, contractor, dentist, dog groomer. `industry` then asked again,
 * from a list written for a different product: `b2b_saas`, `ecommerce`,
 * `manufacturing`, `finance`. A barber had exactly one honest answer available
 * and it was "Other".
 *
 * Nothing reads the industry value. It branches nothing, reaches no prompt, and
 * is not the industry Stripe asks for (`business_profile.mcc`, derived
 * separately in `stripePrefill`). Its whole job is to be filled in, because
 * `missingProfileFields` counts it — a required field that drives nothing is a
 * tax on every new account, and one whose options do not fit is a tax that
 * cannot be paid honestly.
 *
 * So the trade decides it. The owner still sees the field, still sees a value
 * they can change, and no longer has to translate "I cut hair" into a market
 * category.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SUGGESTION, NEVER A WRITE OF ITS OWN
 *
 * The form prefills from this and saving stores it, exactly like the account
 * email in the field above it. An owner who disagrees picks another, and their
 * pick is never overwritten: the caller only consults this when the stored
 * value is empty.
 *
 * @module lib/business-os/setup
 */

/** The ten the settings form offers. `other` is the honest fallback. */
export type IndustryKey =
  | 'professional_services'
  | 'health'
  | 'beauty'
  | 'fitness'
  | 'education'
  | 'home_trades'
  | 'events'
  | 'pet_services'
  | 'retail'
  | 'other';

/**
 * Every vertical in `SELECTABLE_VERTICALS`, grouped.
 *
 * Grouped by what the business DOES rather than by who regulates it: a dentist
 * and a therapist share a category here because an owner looking for themselves
 * finds both under health, which is the only job this field has.
 */
const INDUSTRY_BY_VERTICAL: Record<string, IndustryKey> = {
  /* people paid for expertise */
  lawyer: 'professional_services',
  accountant: 'professional_services',
  consultant: 'professional_services',
  coach: 'professional_services',
  agency: 'professional_services',
  designer: 'professional_services',
  photographer: 'professional_services',
  realtor: 'professional_services',

  /* people paid for care */
  therapist: 'health',
  doctor: 'health',
  dentist: 'health',
  wellness: 'health',
  spa: 'health',

  /* people paid for how you look */
  beauty: 'beauty',
  hairdresser: 'beauty',
  barber: 'beauty',
  nail_tech: 'beauty',
  makeup_artist: 'beauty',
  esthetician: 'beauty',

  fitness: 'fitness',
  trainer: 'fitness',

  teacher: 'education',
  tutor: 'education',
  course_creator: 'education',

  /* people who come to your home or your car */
  contractor: 'home_trades',
  home_services: 'home_trades',
  auto_services: 'home_trades',

  events: 'events',
  pet_services: 'pet_services',
  retail: 'retail',
};

/**
 * The industry this trade sits in, or `null` where the trade is unknown.
 *
 * `null` for `default` and `other` deliberately: those are the sentinels the
 * story extraction writes when it could not read a trade, and deriving an
 * industry from "we do not know" would fill a required field with a guess
 * nobody made — the same mistake `stripePrefill` refuses for the MCC.
 */
export function industryForVertical(vertical: string | null | undefined): IndustryKey | null {
  if (!vertical) return null;
  return INDUSTRY_BY_VERTICAL[vertical.trim().toLowerCase()] ?? null;
}
