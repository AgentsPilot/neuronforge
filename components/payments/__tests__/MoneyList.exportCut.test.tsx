/**
 * @jest-environment jsdom
 *
 * QA, LX-1: the export-cut notice, rendered through the real MoneyList.
 *
 * `MoneyCapNotice.test` checks the notice and `exportWasCut` on their own and
 * pins the wiring at source level. This drives the real component: the list
 * loads, the page's export handle is called, and what the owner sees on screen
 * is asserted. The list's children that are not under test (row, strip,
 * drawer, refund modal) are stubbed; the row stub keeps `onSelect` so a
 * hand-picked export can be made.
 */

import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { translations } from '@/lib/business-os/LanguageContext';

const en = translations.en as Record<string, string>;
const mockT = (key: string, vars?: Record<string, string | number>) => {
  let text = en[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return text;
};

jest.mock('@/lib/business-os/LanguageContext', () => {
  const actual = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    ...actual,
    useLanguage: () => ({
      t: mockT,
      language: 'en',
      isRTL: false,
      timeZoneOptions: (o: Intl.DateTimeFormatOptions) => ({ ...o, timeZone: 'UTC' }),
    }),
  };
});

jest.mock('@/components/payments/MoneyRow', () => ({
  MoneyRow: ({ item, onSelect }: { item: { key: string; title: string }; onSelect?: () => void }) => (
    <div role="button" data-testid={`row-${item.key}`} onClick={() => onSelect?.()}>
      {item.title}
    </div>
  ),
}));
jest.mock('@/components/payments/MoneySummaryStrip', () => ({ MoneySummaryStrip: () => null }));
jest.mock('@/components/payments/MoneyDetailDrawer', () => ({ MoneyDetailDrawer: () => null }));
jest.mock('@/components/payments/RefundModal', () => ({ RefundModal: () => null }));

import { MoneyList } from '@/components/payments/MoneyList';

const item = (n: number) => ({
  key: `k${n}`,
  kind: 'standalone',
  title: `Order ${n}`,
  status: 'paid',
  method: 'card',
  amount: 10,
  refunded: 0,
  currency: 'USD',
  date: '2026-10-20T10:00:00.000Z',
  bookingId: null,
  contactId: null,
  contactName: `Client ${n}`,
  entries: [],
  simple: true,
});

const totals = { collected: 0, outstanding: 0, refunded: 0, cancelled: 0, overdue: 0, byCurrency: {} };

/** The route's answer: the list page asks with offset, the export with limit=2000. */
type Answer = { items: number; total: number; truncated: boolean };
let listAnswer: Answer;
let exportAnswer: Answer;
let listLoads = 0;

const respond = (a: Answer) => ({
  json: async () => ({
    success: true,
    data: {
      items: Array.from({ length: a.items }, (_, i) => item(i + 1)),
      totals,
      total: a.total,
      summaryCount: a.total,
      truncated: a.truncated,
    },
  }),
});

beforeEach(() => {
  listLoads = 0;
  listAnswer = { items: 3, total: 3, truncated: false };
  exportAnswer = { items: 3, total: 3, truncated: false };
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).includes('limit=2000')) return respond(exportAnswer);
    listLoads++;
    return respond(listAnswer);
  }) as unknown as typeof fetch;
  URL.createObjectURL = jest.fn(() => 'blob:x');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function mount(refreshKey = 0) {
  let api: { exportCsv: () => Promise<void> } | null = null;
  const onReady = (a: { exportCsv: () => Promise<void> }) => {
    api = a;
  };
  const utils = render(<MoneyList onReady={onReady} refreshKey={refreshKey} />);
  await screen.findByTestId('row-k1');
  return {
    ...utils,
    exportNow: async () => {
      await act(async () => {
        await api!.exportCsv();
      });
    },
    onReady,
  };
}

describe('MoneyList export-cut notice (rendered)', () => {
  it('shows when the export response says truncated, and the file still downloads', async () => {
    exportAnswer = { items: 3, total: 3, truncated: true };
    const { exportNow } = await mount();
    expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument();

    await exportNow();

    expect(screen.getByTestId('money-export-cut')).toHaveTextContent(mockT('payments.export.cut', { count: 3 }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows when the filter matched more than the export returned', async () => {
    exportAnswer = { items: 5, total: 2400, truncated: false };
    const { exportNow } = await mount();
    await exportNow();
    expect(screen.getByTestId('money-export-cut')).toHaveTextContent('5');
  });

  it('does not show for a whole export', async () => {
    const { exportNow } = await mount();
    await exportNow();
    expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not show for a hand-picked selection, even when the full export would be cut', async () => {
    exportAnswer = { items: 3, total: 9999, truncated: true };
    const { exportNow } = await mount();

    fireEvent.click(screen.getByRole('button', { name: en['payments.select.start'] || 'Select rows' }));
    fireEvent.click(screen.getByTestId('row-k1'));
    await exportNow();

    expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument();
    // The picked set never asks the route.
    expect((global.fetch as jest.Mock).mock.calls.some(([u]) => String(u).includes('limit=2000'))).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('a hand-picked export clears a notice left by an earlier cut export', async () => {
    exportAnswer = { items: 3, total: 9999, truncated: true };
    const { exportNow } = await mount();
    await exportNow();
    expect(screen.getByTestId('money-export-cut')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en['payments.select.start'] || 'Select rows' }));
    fireEvent.click(screen.getByTestId('row-k2'));
    await exportNow();

    expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument();
  });

  it('clears on the next list load', async () => {
    exportAnswer = { items: 3, total: 3, truncated: true };
    const { exportNow, rerender, onReady } = await mount(0);
    await exportNow();
    expect(screen.getByTestId('money-export-cut')).toBeInTheDocument();

    const before = listLoads;
    rerender(<MoneyList onReady={onReady} refreshKey={1} />);
    await waitFor(() => expect(listLoads).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument());
  });

  it("the list's own truncated notice is independent of the export notice", async () => {
    listAnswer = { items: 3, total: 3, truncated: true };
    const { exportNow } = await mount();
    expect(screen.getByTestId('money-truncated')).toBeInTheDocument();
    await exportNow();
    expect(screen.getByTestId('money-truncated')).toBeInTheDocument();
    expect(screen.queryByTestId('money-export-cut')).not.toBeInTheDocument();
  });
});
