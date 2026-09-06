/**
 * Whether a client actually receives an intake form.
 *
 * The journey strip is a picture of what happens to a client, so the failure
 * that matters is drawing a step they will never see. Every case below was
 * reachable: a business with the email toggle off, and — the one that started
 * this — intake switched on with no form chosen at all.
 */

import { intakeReachesClient, businessCollectsIntake } from '../intakeReach';

const REACHING = {
  is_enabled: true,
  send_after_booking: true,
  template_id: 'tpl-1',
};

describe('intakeReachesClient', () => {
  it('is true only when all three hold', () => {
    expect(intakeReachesClient(REACHING)).toBe(true);
  });

  it('is false when intake is off', () => {
    expect(intakeReachesClient({ ...REACHING, is_enabled: false })).toBe(false);
  });

  it('is false when the email is switched off', () => {
    // The reported case: the toggle was off and every service still showed
    // "intake form" at the end of its journey.
    expect(intakeReachesClient({ ...REACHING, send_after_booking: false })).toBe(false);
  });

  it('is false when no form has been chosen', () => {
    // The state that started all of this: enabled, saved, and sending nothing.
    expect(intakeReachesClient({ ...REACHING, template_id: null })).toBe(false);
  });

  it('never says yes on absent evidence', () => {
    expect(intakeReachesClient(null)).toBe(false);
    expect(intakeReachesClient(undefined)).toBe(false);
    expect(intakeReachesClient({})).toBe(false);
  });
});

/**
 * What the OWNER can do, which is not what the client receives.
 *
 * These two questions were one, and the conflation is why an owner with
 * auto-send off could neither send a form by hand nor see the step to do it
 * from.
 */
describe('businessCollectsIntake', () => {
  it('is true with auto-send OFF — the owner sends it themselves', () => {
    expect(
      businessCollectsIntake({ is_enabled: true, send_after_booking: false, template_id: 'tpl-1' })
    ).toBe(true);
  });

  it('is true with auto-send on', () => {
    expect(
      businessCollectsIntake({ is_enabled: true, send_after_booking: true, template_id: 'tpl-1' })
    ).toBe(true);
  });

  it('is false when intake is off entirely', () => {
    expect(
      businessCollectsIntake({ is_enabled: false, send_after_booking: true, template_id: 'tpl-1' })
    ).toBe(false);
  });

  it('is false with no form to send', () => {
    expect(
      businessCollectsIntake({ is_enabled: true, send_after_booking: true, template_id: null })
    ).toBe(false);
  });

  it('differs from intakeReachesClient exactly on auto-send', () => {
    const manualOnly = { is_enabled: true, send_after_booking: false, template_id: 'tpl-1' };

    expect(businessCollectsIntake(manualOnly)).toBe(true);
    expect(intakeReachesClient(manualOnly)).toBe(false);
  });
});
