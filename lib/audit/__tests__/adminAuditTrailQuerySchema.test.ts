/**
 * AdminAuditTrailQuerySchema — the "all" sentinel boundary (SA code review X-1).
 *
 * A pure schema test: no route, no mocks, no Supabase. The property under test
 * is which parameters the UI's 'all' sentinel may touch. It belongs to the
 * schema, so it is asserted on the schema rather than observed indirectly
 * through the route's in-memory search filter.
 *
 * The defect this pins: 'all' was preprocessed to undefined for every optional
 * parameter, including `search`. Typing the word "all" into the audit search
 * box therefore produced ?search=all, which parsed as "no search", skipped the
 * route's filter entirely, and rendered a full unfiltered page under the
 * heading "Showing 20 matches on this page" — a false statement in a compliance
 * browser. "all" is a plausible search term here: it occurs inside action and
 * resource names.
 */

import { AdminAuditTrailQuerySchema } from '../requestSchemas';

/** The schema's required parameters, so each case can vary one thing. */
const base = { page: '1', page_size: '20' };

const parse = (query: Record<string, string>) => AdminAuditTrailQuerySchema.parse({ ...base, ...query });

describe('AdminAuditTrailQuerySchema — "all" is a dropdown sentinel, not a general "absent"', () => {
  it('passes the literal search term "all" through untouched', () => {
    expect(parse({ search: 'all' }).search).toBe('all');
  });

  it('passes free text that merely contains "all" through untouched', () => {
    expect(parse({ search: 'install' }).search).toBe('install');
    expect(parse({ search: 'ALL' }).search).toBe('ALL');
    expect(parse({ search: ' all ' }).search).toBe(' all ');
  });

  it('treats an empty search as absent', () => {
    expect(parse({ search: '' }).search).toBeUndefined();
    expect(parse({}).search).toBeUndefined();
  });

  it('still treats "all" as absent on the three dropdown filters', () => {
    const parsed = parse({ action: 'all', severity: 'all', entity_type: 'all' });
    expect(parsed.action).toBeUndefined();
    expect(parsed.severity).toBeUndefined();
    expect(parsed.entity_type).toBeUndefined();
  });

  it('keeps real dropdown values', () => {
    const parsed = parse({
      action: 'BUSINESS_AI_ACTION_COMPLETED',
      severity: 'warning',
      entity_type: 'ai_action',
    });
    expect(parsed.action).toBe('BUSINESS_AI_ACTION_COMPLETED');
    expect(parsed.severity).toBe('warning');
    expect(parsed.entity_type).toBe('ai_action');
  });

  it('does not apply the sentinel to the date filters either', () => {
    // 'all' is not a date, so the free-text preprocess hands it to the refine,
    // which rejects it. The failure mode that matters is the opposite one:
    // silently dropping the filter and returning unfiltered rows as if the
    // caller had asked for them.
    expect(() => parse({ date_from: 'all' })).toThrow();
    expect(parse({ date_from: '' }).date_from).toBeUndefined();
    // And a real datetime-local value still survives byte-for-byte (C-5).
    expect(parse({ date_from: '2026-09-01T10:00' }).date_from).toBe('2026-09-01T10:00');
  });
});
