/**
 * The business type the owner typed themselves counts as an answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER HALF OF `profileReadinessSentinel.test.ts`, AND WHY IT IS NEEDED.
 *
 * That file is right: `vertical: 'default'` is our fallback, not a business
 * type, and reporting the profile complete on it is how an owner never gets
 * asked. What it could not see is that nothing could ANSWER the question it
 * started asking.
 *
 * Measured on the same account, six days later. The owner had described
 * themselves to the onboarding chat as "a contractor who renovate houses and
 * dealing with water mitigation". The extraction returned `default` — correctly,
 * because the preset list it must choose from held nine appointment-led
 * practices and no trades at all. Then:
 *
 *   dashboard   "business type missing", routing to settings
 *   settings    "Business type: Service Provider", read-only, no control
 *
 * Two surfaces, one field, opposite claims, and no way out of the loop. The
 * preset list is wider now, and this is the escape hatch for the trades it
 * still cannot name: free text in `organizations.settings.business_type`, which
 * satisfies the gate while the pipeline key stays honestly generic.
 *
 * The pipeline deliberately does NOT follow the words. We have no renovation
 * board; deriving a preset key from prose would hand somebody stages they never
 * chose, which is the failure `normalizeVertical` already records.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { missingProfileFields, isBusinessProfileComplete } from '../profileReadiness';

/** The four answers the settings form writes beside it, all filled. */
const SETTINGS = {
  industry: 'other',
  company_size: 'solo',
  primary_goal: 'grow_revenue',
  technical_level: 'non_technical',
};

/** The live row, as onboarding left it. */
/* Reachable by phone and mail, so these cases stay about the business type.
   Both became profile gates once it emerged that onboarding asks for neither. */
const CONTRACTOR = {
  company_name: 'David KPMG',
  vertical: 'default',
  phone: '+972501234567',
  email: 'hello@example.com',
};

describe('a business type in the owner’s own words', () => {
  it('satisfies the gate even though the pipeline key is still the fallback', () => {
    const settings = { ...SETTINGS, business_type: 'Renovation contractor' };

    expect(missingProfileFields(CONTRACTOR, settings)).toEqual([]);
    expect(isBusinessProfileComplete(CONTRACTOR, settings)).toBe(true);
  });

  it('is not satisfied by whitespace, which is an empty box with a space in it', () => {
    expect(missingProfileFields(CONTRACTOR, { ...SETTINGS, business_type: '   ' }))
      .toEqual(['business_type']);
  });

  it('still reports the gap when neither answer is there', () => {
    /* The case `profileReadinessSentinel` covers, restated here so a change
       that makes this file pass by weakening the rule cannot look green. */
    expect(missingProfileFields(CONTRACTOR, SETTINGS)).toEqual(['business_type']);
    expect(missingProfileFields(CONTRACTOR, { ...SETTINGS, business_type: null }))
      .toEqual(['business_type']);
  });

  it('needs only one of the two, so a real trade never requires typing', () => {
    expect(missingProfileFields({ ...CONTRACTOR, company_name: 'X', vertical: 'contractor' }, SETTINGS))
      .toEqual([]);
  });

  it('does not let the words cover for anything else that is unfilled', () => {
    // One answer, one gap closed. The rest of the form is still the rest of it.
    expect(missingProfileFields({ ...CONTRACTOR, company_name: '', vertical: 'default' }, { business_type: 'Caterer' }))
      .toEqual(['company_name', 'industry', 'company_size', 'primary_goal', 'technical_level']);
  });
});
