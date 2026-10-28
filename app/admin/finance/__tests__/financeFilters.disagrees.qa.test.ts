/**
 * @jest-environment node
 *
 * QA P-8b.3a: `status=disagrees` combined with the Finance page's other keys:
 * a window kept beside it, a business link that drops it over the repair
 * passes, Clear resetting it, and the redirected legacy link shape.
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { FINANCE_CLEAR_PATCH, FINANCE_FILTER_SPEC, financeFilterRepair, type FinanceFilters } from '../financeFilters';

const A = '11111111-1111-4111-8111-111111111111';

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

/** Apply repair patches until stable, as the hook does across renders. */
function settle(filters: FinanceFilters): FinanceFilters {
  let current = filters;
  for (let i = 0; i < 5; i += 1) {
    const patch = financeFilterRepair(current);
    if (patch === null) return current;
    current = { ...current, ...patch };
  }
  throw new Error('repair did not settle');
}

describe('QA P-8b.3a: disagrees beside the other Finance keys', () => {
  it('a window preset and the plans tab keep disagrees (no repair)', () => {
    const filters = parseLink('preset=7d&tab=plans&status=disagrees');
    expect(filters.status).toBe('disagrees');
    expect(filters.window).toEqual({ kind: 'preset', preset: '7d' });
    expect(financeFilterRepair(filters)).toBeNull();
  });

  it('a business link with the plans tab and disagrees settles with no tab and no status', () => {
    const settled = settle(parseLink(`accountId=${A}&tab=plans&status=disagrees`));
    expect(settled.account).toBe(A);
    expect(settled.tab).toBe('');
    expect(settled.status).toBe('');
  });

  it('the exchange-rates tab drops disagrees', () => {
    expect(settle(parseLink('tab=exchange-rates&status=disagrees')).status).toBe('');
  });

  it('Clear resets disagrees and keeps the tab', () => {
    const cleared = { ...parseLink('tab=plans&status=disagrees'), ...FINANCE_CLEAR_PATCH };
    expect(cleared.status).toBe('');
    expect(cleared.tab).toBe('plans');
  });

  it('the redirected legacy link (/admin/subscriptions?status=disagrees → ?tab=plans&status=disagrees) keeps the filter', () => {
    expect(parseLink('tab=plans&status=disagrees').status).toBe('disagrees');
  });

  it('case and spacing variants are unknown values and fall back to ""', () => {
    for (const raw of ['Disagrees', 'DISAGREES', 'disagrees%20', 'disagrees,active']) {
      expect(parseLink(`tab=plans&status=${raw}`).status).toBe('');
    }
  });
});
