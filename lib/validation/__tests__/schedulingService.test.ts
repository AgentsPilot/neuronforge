import {
  createServiceSchema,
  updateServiceSchema,
  serviceFieldsSchema,
  MAX_BUFFER_MINUTES,
} from '../schedulingService';

/*
 * Create and update must accept the same values.
 *
 * They were separate copies of the same thirty lines and had drifted in seven
 * places. Six of those were one bug repeated: `.optional()` accepts a value or
 * nothing and REJECTS `null`, so an owner clearing a field had the WHOLE
 * request refused — and the visible symptom was that the service NAME would
 * not save, while the field that actually failed went unmentioned.
 *
 * The schemas are derived from one object now, so these mostly assert that the
 * derivation stays honest rather than re-checking each field.
 */

const NULLABLE_FIELDS = [
  'description',
  'duration_minutes',
  'collection',
  'price',
  'buffer_minutes',
  'max_bookings_per_day',
  'installment_count',
  'installment_frequency',
  'first_payment_due',
  'first_payment_days',
] as const;

const SAMPLE: Record<string, unknown> = {
  description: 'x',
  duration_minutes: 60,
  collection: 'invoice',
  price: 100,
  buffer_minutes: 15,
  max_bookings_per_day: 3,
  installment_count: 3,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 7,
};

describe('creating and updating a service', () => {
  it('accept exactly the same field names', () => {
    // The one legitimate difference is whether the name is required.
    const created = Object.keys(createServiceSchema.shape).sort();
    const updated = Object.keys(updateServiceSchema.shape).sort();
    expect(created).toEqual(updated);
  });

  it.each(NULLABLE_FIELDS)('let an owner clear %s on BOTH routes', field => {
    /*
     * Clearing a field is a thing owners do. `.optional()` alone rejects null
     * and takes the rest of the payload down with it.
     */
    const payload = { service_name: 'Training', [field]: null };

    expect(createServiceSchema.safeParse(payload).success).toBe(true);
    expect(updateServiceSchema.safeParse({ [field]: null }).success).toBe(true);
  });

  it.each(Object.keys(SAMPLE))('accept a real value for %s on both routes', field => {
    const payload = { service_name: 'Training', [field]: SAMPLE[field] };

    expect(createServiceSchema.safeParse(payload).success).toBe(true);
    expect(updateServiceSchema.safeParse({ [field]: SAMPLE[field] }).success).toBe(true);
  });

  it('agree on the buffer ceiling', () => {
    // Create capped at 120 and update at 1440, so a service given a longer
    // buffer could never be re-saved through create.
    const atCeiling = { service_name: 'Training', buffer_minutes: MAX_BUFFER_MINUTES };
    expect(createServiceSchema.safeParse(atCeiling).success).toBe(true);
    expect(updateServiceSchema.safeParse({ buffer_minutes: MAX_BUFFER_MINUTES }).success).toBe(true);

    const over = MAX_BUFFER_MINUTES + 1;
    expect(createServiceSchema.safeParse({ service_name: 'T', buffer_minutes: over }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ buffer_minutes: over }).success).toBe(false);
  });

  it('agree on the statuses a service may hold', () => {
    for (const status of ['draft', 'active', 'inactive']) {
      expect(createServiceSchema.safeParse({ service_name: 'T', status }).success).toBe(true);
      expect(updateServiceSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it('require a name to create one, and not to change one', () => {
    expect(createServiceSchema.safeParse({}).success).toBe(false);
    expect(updateServiceSchema.safeParse({}).success).toBe(true);
  });

  it('derive both from the same field set', () => {
    // If someone adds a field to only one route, the first test fails — this
    // one says why, by pinning where fields are meant to be declared.
    for (const field of Object.keys(serviceFieldsSchema.shape)) {
      expect(createServiceSchema.shape).toHaveProperty(field);
      expect(updateServiceSchema.shape).toHaveProperty(field);
    }
  });
});
