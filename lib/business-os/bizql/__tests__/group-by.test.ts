/**
 * The `group_by` grammar, and the two questions it exists to make expressible.
 *
 * Run against the REAL catalog rather than a fixture: the point of the relation
 * form is that it reaches an actual foreign key and an actual label column, and
 * a fixture would prove only that the parser can read a fixture.
 */

import { CATALOG } from '@/lib/business-os/catalog';
import { parseGroupBy, bucketKey } from '../groupBy';

const invoices = CATALOG.entities.invoices;
const bookings = CATALOG.entities.bookings;

describe('parseGroupBy', () => {
  describe('a field on this entity', () => {
    it('resolves to its column', () => {
      const { spec, problem } = parseGroupBy(invoices, 'status');
      expect(problem).toBeUndefined();
      expect(spec).toEqual({ kind: 'column', column: 'status', fieldKey: 'status' });
    });

    it('names the alternatives when the field is unknown', () => {
      const { problem } = parseGroupBy(invoices, 'nonsense');
      expect(problem).toContain("unknown field 'invoices.nonsense'");
      expect(problem).toContain('Available:');
    });
  });

  describe('a label on a related entity', () => {
    it('groups by the target label when given a bare relation name', () => {
      // The form worth having: the planner should not need to know that a
      // service's name lives in `service_name`.
      const { spec, problem } = parseGroupBy(invoices, 'service');
      expect(problem).toBeUndefined();
      expect(spec).toMatchObject({
        kind: 'relation',
        relationKey: 'service',
        fkColumn: 'service_id',
        targetEntity: 'services',
        targetColumns: ['service_name'],
      });
    });

    it('carries every column of a multi-part label', () => {
      // Grouping by half a person's name is not a grouping anyone asked for.
      const { spec } = parseGroupBy(invoices, 'contact');
      expect(spec).toMatchObject({
        kind: 'relation',
        targetColumns: ['first_name', 'last_name'],
      });
    });

    it('resolves an explicitly named field on the target', () => {
      const { spec, problem } = parseGroupBy(invoices, 'service.service_name');
      expect(problem).toBeUndefined();
      expect(spec).toMatchObject({ kind: 'relation', targetColumns: ['service_name'] });
    });

    it('points at the bare form when the named target field does not exist', () => {
      const { problem } = parseGroupBy(invoices, 'service.name');
      expect(problem).toContain("unknown field 'services.name'");
      expect(problem).toContain("use 'service' on its own");
    });

    it('refuses a relation that does not exist, and lists the ones that do', () => {
      const { problem } = parseGroupBy(invoices, 'unicorn.name');
      expect(problem).toContain("has no relation 'unicorn'");
      expect(problem).toContain('Available:');
    });

    it('refuses a one-to-many relation, where a row has no single target', () => {
      // Grouping invoices "by" a contact's many invoices is not a grouping —
      // silently taking the first would mislabel every bucket.
      const oneToMany = Object.entries(CATALOG.entities.contacts.relations ?? {}).find(
        ([, r]) => r.cardinality === 'many'
      );
      expect(oneToMany).toBeDefined();

      const { problem } = parseGroupBy(CATALOG.entities.contacts, `${oneToMany![0]}.id`);
      expect(problem).toContain('one-to-many');
    });
  });

  describe('a date bucketed by calendar period', () => {
    it.each(['day', 'week', 'month', 'year'])('accepts %s', bucket => {
      const { spec, problem } = parseGroupBy(invoices, `sent_at:${bucket}`);
      expect(problem).toBeUndefined();
      expect(spec).toMatchObject({ kind: 'bucket', bucket });
    });

    it('refuses an unknown bucket, and lists the real ones', () => {
      const { problem } = parseGroupBy(invoices, 'sent_at:fortnight');
      expect(problem).toContain("unknown time bucket 'fortnight'");
      expect(problem).toContain('day, week, month, year');
    });

    it('refuses to bucket something that is not a date', () => {
      const { problem } = parseGroupBy(invoices, 'status:month');
      expect(problem).toContain('only a date can be grouped');
    });
  });

  it('lets bookings be grouped by the service they are for', () => {
    // The relation Phase 1 added, exercised end to end through the parser.
    const { spec, problem } = parseGroupBy(bookings, 'service');
    expect(problem).toBeUndefined();
    expect(spec).toMatchObject({ kind: 'relation', targetEntity: 'services' });
  });

  it('lists relations too when a bare name matches nothing', () => {
    const { problem } = parseGroupBy(invoices, 'nonsense');
    expect(problem).toContain('a related entity:');
  });
});

describe('bucketKey', () => {
  const t = '2026-08-27T10:30:00Z';

  it('produces sortable keys per bucket', () => {
    expect(bucketKey(t, 'year', 'UTC')).toBe('2026');
    expect(bucketKey(t, 'month', 'UTC')).toBe('2026-08');
    expect(bucketKey(t, 'day', 'UTC')).toBe('2026-08-27');
    expect(bucketKey(t, 'week', 'UTC')).toMatch(/^2026-W\d{2}$/);
  });

  it('sorts chronologically as plain strings', () => {
    const keys = ['2026-01-31T00:00:00Z', '2025-12-01T00:00:00Z', '2026-10-05T00:00:00Z'].map(v =>
      bucketKey(v, 'month', 'UTC')
    );
    expect([...keys].sort()).toEqual(['2025-12', '2026-01', '2026-10']);
  });

  it('buckets in the USER\'s timezone, not the server\'s', () => {
    // 23:30 on 31 August in Tel Aviv is already September in UTC. The month a
    // business reports must be the month it was in for them.
    const lateNight = '2026-08-31T21:30:00Z'; // 00:30 on 1 Sep in Asia/Jerusalem
    expect(bucketKey(lateNight, 'month', 'UTC')).toBe('2026-08');
    expect(bucketKey(lateNight, 'month', 'Asia/Jerusalem')).toBe('2026-09');
  });

  it('returns null for a row with no date rather than inventing a bucket', () => {
    expect(bucketKey(null, 'month', 'UTC')).toBeNull();
    expect(bucketKey('', 'month', 'UTC')).toBeNull();
    expect(bucketKey('not a date', 'month', 'UTC')).toBeNull();
  });

  it('falls back to UTC rather than losing the row on a bad timezone', () => {
    expect(bucketKey(t, 'month', 'Mars/Olympus')).toBe('2026-08');
  });

  it('puts the turn of the year in the ISO week that owns it', () => {
    // 1 Jan 2027 is a Friday, so it belongs to the final week of 2026.
    expect(bucketKey('2027-01-01T12:00:00Z', 'week', 'UTC')).toBe('2026-W53');
    // 4 Jan is always in week 1, by definition.
    expect(bucketKey('2027-01-04T12:00:00Z', 'week', 'UTC')).toBe('2027-W01');
  });
});
