/**
 * @jest-environment node
 *
 * Plan payments P-8b.3a (AM-2; SA P3-SA-2 item 5): `status=disagrees` on the
 * Finance URL. Without `SUBSCRIPTION_FILTERS` in the parser, the value would be
 * dropped as invalid before it reached the Subscriptions list. Parsed exactly
 * as the shared hook does (canonical key first, then the first alias, U-9).
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { SUBSCRIPTION_FILTERS, SUBSCRIPTION_STATUSES } from '@/lib/admin/billing/subscriptionsTypes';
import { FINANCE_FILTER_SPEC, financeCanClear, financeFilterRepair, type FinanceFilters } from '../financeFilters';

function parseLink(link: string): FinanceFilters {
  const params = new URLSearchParams(link);
  const read = <V>(field: AdminFilterField<V>): V => {
    const getter = (key: string): string | null => {
      const canonical = params.get(key);
      if (canonical) return canonical;
      for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
        if (target !== key) continue;
        const value = params.get(legacy);
        if (value) return value;
      }
      return null;
    };
    const parsed = field.parse(getter);
    return parsed === undefined ? field.defaultValue : parsed;
  };
  const S = FINANCE_FILTER_SPEC;
  return {
    window: read(S.window),
    account: read(S.account),
    tab: read(S.tab),
    sort: read(S.sort),
    group: read(S.group),
    show: read(S.show),
    status: read(S.status),
    currencies: read(S.currencies),
  };
}

/** The keys this test owns, written in the spec's order, as the hook writes them. */
function serialiseTabAndStatus(filters: FinanceFilters): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...FINANCE_FILTER_SPEC.tab.serialise(filters.tab),
    ...FINANCE_FILTER_SPEC.status.serialise(filters.status),
  })) {
    out.set(key, value);
  }
  return out.toString();
}

describe('P-8b.3a: the disagrees filter on the Finance URL', () => {
  it('the filter set is every status plus disagrees, nothing else', () => {
    expect([...SUBSCRIPTION_FILTERS]).toEqual([...SUBSCRIPTION_STATUSES, 'disagrees']);
  });

  it('round trip: ?tab=plans&status=disagrees parses and serialises to the same URL', () => {
    const filters = parseLink('tab=plans&status=disagrees');
    expect(filters.tab).toBe('plans');
    expect(filters.status).toBe('disagrees');
    expect(serialiseTabAndStatus(filters)).toBe('tab=plans&status=disagrees');
    expect(financeFilterRepair(filters)).toBeNull();
    expect(financeCanClear(filters)).toBe(true);
  });

  it('an unknown value falls back to "" (U-4), and only that filter drops', () => {
    const filters = parseLink('tab=plans&status=disagree');
    expect(filters.status).toBe('');
    expect(filters.tab).toBe('plans');
  });

  it('the reset rule still holds: off the plans tab, disagrees is cleared', () => {
    expect(financeFilterRepair(parseLink('status=disagrees'))).toEqual({ status: '' });
    expect(financeFilterRepair(parseLink('tab=accounts&status=disagrees'))).toEqual({ status: '' });
  });
});
