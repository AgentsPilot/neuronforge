/**
 * Whether a client actually receives an intake form.
 *
 * The journey strip is a picture of what happens to a client, so the failure
 * that matters is drawing a step they will never see. Every case below was
 * reachable: a business with the email toggle off, and — the one that started
 * this — intake switched on with no form chosen at all.
 */

import {
  intakeReachesClient,
  businessCollectsIntake,
  intakeBlockReason,
  intakeAppliesToService,
} from '../intakeReach';

const REACHING = {
  is_enabled: true,
  send_after_booking: true,
  hasPublishedForm: true,
};

describe('intakeReachesClient', () => {
  it('is true only when all three hold', () => {
    expect(intakeReachesClient(REACHING)).toBe(true);
  });

  it('is false when intake is off', () => {
    expect(intakeReachesClient({ ...REACHING, is_enabled: false })).toBe(false);
  });

  it('does not depend on the auto-send switch at all', () => {
    /*
     * `send_after_booking` used to gate this, and the column defaults to false
     * — so every business that never found the second switch quietly stopped
     * emailing intake to clients who booked themselves. Switching intake ON is
     * the owner saying clients should receive it; there is no second saying.
     */
    expect(intakeReachesClient({ ...REACHING, send_after_booking: false })).toBe(true);
    expect(intakeReachesClient({ ...REACHING, send_after_booking: null })).toBe(true);
  });

  it('is false when no form is published', () => {
    // The state that started all of this: enabled, saved, and sending nothing.
    expect(intakeReachesClient({ ...REACHING, hasPublishedForm: false })).toBe(false);
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
      businessCollectsIntake({ is_enabled: true, send_after_booking: false, hasPublishedForm: true })
    ).toBe(true);
  });

  it('is true with auto-send on', () => {
    expect(
      businessCollectsIntake({ is_enabled: true, send_after_booking: true, hasPublishedForm: true })
    ).toBe(true);
  });

  it('is false when intake is off entirely', () => {
    expect(
      businessCollectsIntake({ is_enabled: false, send_after_booking: true, hasPublishedForm: true })
    ).toBe(false);
  });

  it('is false with no published form to send', () => {
    expect(
      businessCollectsIntake({ is_enabled: true, send_after_booking: true, hasPublishedForm: false })
    ).toBe(false);
  });

  it('now agrees with intakeReachesClient — the two switches became one', () => {
    const enabled = { is_enabled: true, send_after_booking: false, hasPublishedForm: true };

    expect(businessCollectsIntake(enabled)).toBe(true);
    expect(intakeReachesClient(enabled)).toBe(true);
  });
});

/**
 * A generated form is not an approved form.
 *
 * Between generation and publication the questions were written by a model from
 * a business description — plausible, and not the owner's. Sending them is
 * worse than sending nothing, because the owner finds out from their client.
 */
describe('the publish gate', () => {
  const generatedNotPublished = {
    is_enabled: true,
    send_after_booking: true,
    hasPublishedForm: false,
  };

  it('withholds an unpublished form from the client', () => {
    expect(intakeReachesClient(generatedNotPublished)).toBe(false);
  });

  it('withholds it from the OWNER too — sending by hand sends the same questions', () => {
    expect(businessCollectsIntake(generatedNotPublished)).toBe(false);
  });

  it('opens both the moment it is published, changing nothing else', () => {
    const published = { ...generatedNotPublished, hasPublishedForm: true };

    expect(intakeReachesClient(published)).toBe(true);
    expect(businessCollectsIntake(published)).toBe(true);
  });
});

/**
 * Why, not just no.
 *
 * "Nothing happened" is what each of these looked like from the outside. A
 * business one click from working should be told that rather than told no.
 */
describe('intakeBlockReason', () => {
  it('names an unpublished form as the reason', () => {
    expect(
      intakeBlockReason({ is_enabled: true, send_after_booking: true, hasPublishedForm: false })
    ).toBe('not_published');
  });

  it('reports intake being off ahead of anything else', () => {
    // Nothing is published either, and saying so would send the owner to fix
    // the second thing standing in their way rather than the first.
    expect(
      intakeBlockReason({ is_enabled: false, send_after_booking: true, hasPublishedForm: false })
    ).toBe('disabled');
  });

  it('names the SERVICE when that is what is in the way', () => {
    const enabled = { is_enabled: true, send_after_booking: false, hasPublishedForm: true };

    // Nothing about the business stops it any more.
    expect(intakeBlockReason(enabled)).toBeNull();

    // A quote has no occasion for a form, and a product has no appointment.
    expect(intakeBlockReason(enabled, { service: { sale_mode: 'proposal' } })).toBe('not_applicable');
    expect(intakeBlockReason(enabled, { service: { is_scheduled: false } })).toBe('not_applicable');

    // A real appointment, free or paid, is asked.
    expect(intakeBlockReason(enabled, { service: { sale_mode: 'direct', is_scheduled: true } })).toBeNull();
  });

  it('is null when nothing is in the way', () => {
    expect(
      intakeBlockReason(
        { is_enabled: true, send_after_booking: true, hasPublishedForm: true },
        { forClient: true }
      )
    ).toBeNull();
  });
});

/**
 * Which services ask their client anything.
 *
 * The owner's rule, in their words: if intake is on, send it — unless the
 * booking is a quote request or a product. Those two have no occasion for a
 * form; everything else does, free consultations included.
 */
describe('intakeAppliesToService', () => {
  it('asks for a paid appointment', () => {
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: true })).toBe(true);
  });

  it('asks for a FREE consultation — costing nothing is not the same as needing nothing', () => {
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: true })).toBe(true);
  });

  it('does not ask for a quote request', () => {
    expect(intakeAppliesToService({ sale_mode: 'proposal', is_scheduled: true })).toBe(false);
  });

  it('does not ask for a product, which has no appointment to prepare for', () => {
    expect(intakeAppliesToService({ sale_mode: 'direct', is_scheduled: false })).toBe(false);
  });

  it('asks when the service is unknown, rather than silently skipping', () => {
    expect(intakeAppliesToService(null)).toBe(true);
    expect(intakeAppliesToService({})).toBe(true);
  });
});
