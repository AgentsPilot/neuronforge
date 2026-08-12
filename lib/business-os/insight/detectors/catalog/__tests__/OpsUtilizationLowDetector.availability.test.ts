/**
 * Unit tests for calculateAvailableHours (M3).
 *
 * Pure function over the weekly availability JSONB shape stored on
 * business_profiles.scheduling_availability. Sums (end - start) across each day's
 * intervals; falls back to 40h for empty {} / missing / malformed input.
 */

import {
  calculateAvailableHours,
  type WeeklyAvailability,
} from '@/lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector';

describe('calculateAvailableHours', () => {
  it('sums a single interval per day across the week', () => {
    const availability: WeeklyAvailability = {
      monday: [{ start: '09:00', end: '17:00' }], // 8h
      tuesday: [{ start: '09:00', end: '17:00' }], // 8h
      wednesday: [{ start: '10:00', end: '15:30' }], // 5.5h
    };
    expect(calculateAvailableHours(availability)).toBeCloseTo(21.5, 5);
  });

  it('sums multiple intervals within a day', () => {
    const availability: WeeklyAvailability = {
      monday: [
        { start: '09:00', end: '12:00' }, // 3h
        { start: '13:00', end: '17:00' }, // 4h
      ],
    };
    expect(calculateAvailableHours(availability)).toBeCloseTo(7, 5);
  });

  it('falls back to 40h for an empty object', () => {
    expect(calculateAvailableHours({})).toBe(40);
  });

  it('falls back to 40h for null / undefined', () => {
    expect(calculateAvailableHours(null)).toBe(40);
    expect(calculateAvailableHours(undefined)).toBe(40);
  });

  it('falls back to 40h when all intervals are malformed', () => {
    const malformed = {
      monday: [{ start: 'nope', end: '17:00' }],
      tuesday: [{ start: '09:00', end: '99:99' }],
      wednesday: 'not-an-array',
      thursday: [{ start: '17:00', end: '09:00' }], // end <= start
    } as unknown as WeeklyAvailability;
    expect(calculateAvailableHours(malformed)).toBe(40);
  });

  it('ignores malformed intervals but sums the valid ones', () => {
    const mixed = {
      monday: [
        { start: '09:00', end: '17:00' }, // 8h valid
        { start: 'bad', end: '17:00' }, // ignored
      ],
      tuesday: 'garbage',
    } as unknown as WeeklyAvailability;
    expect(calculateAvailableHours(mixed)).toBeCloseTo(8, 5);
  });
});
