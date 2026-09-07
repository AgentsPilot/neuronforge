/**
 * Whether a client actually receives an intake form.
 *
 * The journey strip is a picture of what happens to a client, so the failure
 * that matters is drawing a step they will never see. Every case below was
 * reachable: a business with the email toggle off, and — the one that started
 * this — intake switched on with no form chosen at all.
 */

import { intakeReachesClient, businessCollectsIntake, intakeBlockReason } from '../intakeReach';

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

  it('is false when the email is switched off', () => {
    // The reported case: the toggle was off and every service still showed
    // "intake form" at the end of its journey.
    expect(intakeReachesClient({ ...REACHING, send_after_booking: false })).toBe(false);
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

  it('differs from intakeReachesClient exactly on auto-send', () => {
    const manualOnly = { is_enabled: true, send_after_booking: false, hasPublishedForm: true };

    expect(businessCollectsIntake(manualOnly)).toBe(true);
    expect(intakeReachesClient(manualOnly)).toBe(false);
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

  it('only mentions auto-send when asked about the CLIENT path', () => {
    const manualOnly = { is_enabled: true, send_after_booking: false, hasPublishedForm: true };

    expect(intakeBlockReason(manualOnly)).toBeNull();
    expect(intakeBlockReason(manualOnly, { forClient: true })).toBe('not_automatic');
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
