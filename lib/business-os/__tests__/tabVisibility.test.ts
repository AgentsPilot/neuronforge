import { filterByCapability } from '../tabVisibility';

/**
 * The tab bar as it actually is: two entries everyone gets, four gated.
 * Mirrored here so a change to the real bar that drops a gate shows up as a
 * failing expectation rather than as a tab quietly appearing for everybody.
 */
const TABS = [
  { key: 'myday' },
  { key: 'people', capability: 'crm' },
  { key: 'payments', capability: 'payments' },
  { key: 'reports', capability: 'reports' },
  { key: 'website', capability: 'website' },
  { key: 'config' },
];

const keys = (items: { key: string }[]) => items.map((i) => i.key);

describe('filterByCapability', () => {
  describe('while the answer is still loading', () => {
    it('shows only the ungated entries', () => {
      expect(keys(filterByCapability(TABS, new Set(), 'loading'))).toEqual(['myday', 'config']);
    });

    it('ignores capabilities it happens to hold already', () => {
      // Nothing is known yet, so a stale set must not leak through.
      const stale = new Set(['crm', 'website']);
      expect(keys(filterByCapability(TABS, stale, 'loading'))).toEqual(['myday', 'config']);
    });
  });

  describe('once the answer is in', () => {
    it('shows exactly what the account has, plus the ungated entries', () => {
      const enabled = new Set(['crm', 'reports']);
      expect(keys(filterByCapability(TABS, enabled, 'ready'))).toEqual([
        'myday',
        'people',
        'reports',
        'config',
      ]);
    });

    it('leaves an account with nothing switched on able to reach My Day and Configuration', () => {
      // Configuration is how capabilities get switched on, so gating it would
      // lock a new account out of ever enabling anything.
      expect(keys(filterByCapability(TABS, new Set(), 'ready'))).toEqual(['myday', 'config']);
    });

    it('ignores capabilities that no tab claims', () => {
      const enabled = new Set(['crm', 'scheduling', 'insights', 'automations']);
      expect(keys(filterByCapability(TABS, enabled, 'ready'))).toEqual([
        'myday',
        'people',
        'config',
      ]);
    });

    it('shows every tab when everything is enabled', () => {
      const all = new Set(['crm', 'payments', 'reports', 'website']);
      expect(keys(filterByCapability(TABS, all, 'ready'))).toEqual(keys(TABS));
    });
  });

  describe('when the request failed', () => {
    it('shows everything rather than stranding the reader', () => {
      // The empty set here is meaningless, not an answer — hiding on it would
      // strip navigation down to two tabs because one request timed out.
      expect(keys(filterByCapability(TABS, new Set(), 'error'))).toEqual(keys(TABS));
    });
  });

  it('preserves the declared order', () => {
    const enabled = new Set(['website', 'crm']);
    expect(keys(filterByCapability(TABS, enabled, 'ready'))).toEqual([
      'myday',
      'people',
      'website',
      'config',
    ]);
  });

  it('does not mutate the input', () => {
    const before = [...TABS];
    filterByCapability(TABS, new Set(['crm']), 'ready');
    expect(TABS).toEqual(before);
  });
});
