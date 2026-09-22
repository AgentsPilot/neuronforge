import { describeServiceForIntake } from '../IntakeGenerationService';

/*
 * What the intake prompt is told about each service.
 *
 * A trainer's generated form asked "How long would you like each training
 * session to be?" — the catalogue already said 60 minutes, and the client had
 * seen it on the booking page. The model was not hallucinating; the service
 * reached the prompt as a name and a description, with the duration stripped
 * out, so an unanswered question looked like a gap worth filling.
 *
 * The failure is invisible by construction: a prompt missing a field reads
 * exactly like a prompt that never had one, and the only symptom surfaces much
 * later as a redundant question nobody flags. Hence these.
 */

const TRAINING_SESSION = {
  service_name: 'Personal training session',
  description: 'One-to-one strength work',
  duration_minutes: 60,
  price: 300,
  currency: 'ILS',
  is_scheduled: true,
};

describe('the service as the intake prompt sees it', () => {
  it('states the duration, so the form does not ask for it', () => {
    expect(describeServiceForIntake(TRAINING_SESSION)).toContain('runs 60 minutes');
  });

  it('states the price, so the form does not ask what it costs', () => {
    expect(describeServiceForIntake(TRAINING_SESSION)).toContain('costs 300 ILS');
  });

  it('marks the terms as settled rather than as data', () => {
    // The RULES section points at these as decisions already made. Phrased as
    // bare fields, they read as things the model might be expected to confirm.
    expect(describeServiceForIntake(TRAINING_SESSION)).toContain('already set:');
  });

  it('still carries the name and description', () => {
    const line = describeServiceForIntake(TRAINING_SESSION);
    expect(line).toContain('Personal training session');
    expect(line).toContain('One-to-one strength work');
  });

  it('says free rather than "costs 0"', () => {
    const line = describeServiceForIntake({ ...TRAINING_SESSION, price: 0 });
    expect(line).toContain('free');
    expect(line).not.toContain('costs 0');
  });

  it('omits terms it does not have, rather than inventing them', () => {
    /*
     * An unscheduled product has no duration and may have no price. Printing
     * "runs 0 minutes" would be worse than saying nothing — it is a false fact
     * the model would then work from.
     */
    const line = describeServiceForIntake({
      service_name: 'Recorded course',
      is_scheduled: false,
      duration_minutes: null,
      price: null,
    });

    expect(line).not.toContain('runs');
    expect(line).not.toContain('already set:');
    expect(line).toContain('no appointment time');
  });

  it('survives a service carrying nothing but a name', () => {
    expect(describeServiceForIntake({ service_name: 'Consultation' })).toBe('- Consultation');
  });
});
