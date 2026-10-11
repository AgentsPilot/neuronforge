/**
 * Audit trail's filter spec and request builder (Admin Layout Standard L-1c,
 * workplan §3.5 and §4): the route's params keep their names and historical
 * order; whole dates go out as UTC instants (end of day to the microsecond,
 * SA S-1); linked bounds go out verbatim; the spec's validators mirror the
 * route's schema so a value the route would refuse is ignored on arrival.
 */

import {
  AUDIT_FILTER_SPEC,
  auditRequestParams,
  isSearchActive,
  type AuditFilters,
} from '../auditTrailFilters';

const DEFAULTS: AuditFilters = {
  window: { kind: 'none' },
  account: '',
  action: 'all',
  severity: 'all',
  entityType: 'all',
  search: '',
};
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-10-11T09:15:00.000Z');

const params = (filters: Partial<AuditFilters>, page = 1) =>
  auditRequestParams({ ...DEFAULTS, ...filters }, page, 20, NOW);

describe('auditRequestParams', () => {
  it('defaults send only page and page_size', () => {
    expect(params({}).toString()).toBe('page=1&page_size=20');
  });

  it('keeps the historical names and order', () => {
    const all = params(
      {
        action: 'BUSINESS_AI_ACTION_FAILED',
        severity: 'critical',
        entityType: 'ai_action',
        window: { kind: 'linked', from: '2026-09-25T10:30', to: '2026-09-26T10:30' },
        search: 'grp',
        account: ACCOUNT,
      },
      3,
    );
    expect([...all.keys()]).toEqual(['action', 'severity', 'entity_type', 'date_from', 'date_to', 'search', 'user_id', 'page', 'page_size']);
    expect(all.get('user_id')).toBe(ACCOUNT);
    expect(all.get('page')).toBe('3');
  });

  it('whole dates go out as UTC instants, the To day included to the microsecond', () => {
    const custom = params({ window: { kind: 'custom', from: '2026-10-01', to: '2026-10-05' } });
    expect(custom.get('date_from')).toBe('2026-10-01T00:00:00.000Z');
    expect(custom.get('date_to')).toBe('2026-10-05T23:59:59.999999Z');
    // Both pass the route's Date.parse check.
    expect(Number.isFinite(Date.parse(custom.get('date_to') as string))).toBe(true);

    const preset = params({ window: { kind: 'preset', preset: '7d' } });
    expect(preset.get('date_from')).toBe('2026-10-05T00:00:00.000Z');
    expect(preset.get('date_to')).toBe('2026-10-11T23:59:59.999999Z');

    const oneSided = params({ window: { kind: 'custom', from: null, to: '2026-10-05' } });
    expect(oneSided.get('date_from')).toBeNull();
    expect(oneSided.get('date_to')).toBe('2026-10-05T23:59:59.999999Z');
  });

  it('linked bounds go out verbatim, byte for byte in the query string', () => {
    const linked = params({ window: { kind: 'linked', from: '2026-09-25T10:30', to: null } });
    expect(linked.toString()).toBe('date_from=2026-09-25T10%3A30&page=1&page_size=20');
  });

  it('no window sends no dates', () => {
    const none = params({ window: { kind: 'none' } });
    expect(none.get('date_from')).toBeNull();
    expect(none.get('date_to')).toBeNull();
  });

  it('sends search only when it has non-blank text, untrimmed as before', () => {
    expect(params({ search: '   ' }).get('search')).toBeNull();
    expect(params({ search: ' acme ' }).get('search')).toBe(' acme ');
    expect(isSearchActive({ ...DEFAULTS, search: '  ' })).toBe(false);
    expect(isSearchActive({ ...DEFAULTS, search: 'a' })).toBe(true);
  });
});

describe('AUDIT_FILTER_SPEC validators (U-4: what the route would refuse is ignored)', () => {
  const parseField = <K extends keyof AuditFilters>(key: K, raw: string) => {
    const field = AUDIT_FILTER_SPEC[key];
    return field.parse((name) => (name === field.keys[0] ? raw : null));
  };

  it('accepts what the route accepts', () => {
    expect(parseField('action', 'BUSINESS_AI_ACTION_FAILED')).toBe('BUSINESS_AI_ACTION_FAILED');
    expect(parseField('entityType', 'ai_action')).toBe('ai_action');
    expect(parseField('severity', 'warning')).toBe('warning');
    expect(parseField('account', ACCOUNT)).toBe(ACCOUNT);
    expect(parseField('search', 'x'.repeat(200))).toBe('x'.repeat(200));
  });

  it('ignores a bad identifier, an unknown severity, a non-UUID account and an over-long search', () => {
    expect(parseField('action', "a'b")).toBeUndefined();
    expect(parseField('action', 'x'.repeat(65))).toBeUndefined();
    expect(parseField('entityType', 'ai-action')).toBeUndefined();
    expect(parseField('severity', 'catastrophic')).toBeUndefined();
    expect(parseField('account', 'nope')).toBeUndefined();
    expect(parseField('search', 'x'.repeat(201))).toBeUndefined();
  });

  it('owns the standard keys, reads the legacy names, and keeps search page-only', () => {
    expect(AUDIT_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
    expect(AUDIT_FILTER_SPEC.window.aliases).toEqual({ date_from: 'from', date_to: 'to' });
    expect(AUDIT_FILTER_SPEC.account.keys).toEqual(['account']);
    expect(AUDIT_FILTER_SPEC.account.aliases).toEqual({ user_id: 'account' });
    expect(AUDIT_FILTER_SPEC.entityType.keys).toEqual(['entity_type']);
    expect(AUDIT_FILTER_SPEC.search.pageOnly).toBe(true);
    expect(AUDIT_FILTER_SPEC.window.defaultValue).toEqual({ kind: 'none' });
  });
});
