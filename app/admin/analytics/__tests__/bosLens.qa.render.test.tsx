/**
 * @jest-environment jsdom
 */

/**
 * AI cost & usage — ADMIN_BOS_CLEANUP slice 3, QA edge case.
 *
 * C3-4 also clears a Category selection when switching to Business OS, and
 * bosLens.render.test.tsx only switches with Agent or Execution selected. This
 * locks the Category branch: the first Business OS request carries no
 * category, and switching back to "All" restores nothing (QA report 2026-10-03).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));

let mockSearch = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import AdminCostAnalytics from '../page';

const fetchMock = jest.fn(async (input: unknown) => {
  const q = new URL(String(input), 'http://x').searchParams;
  const breakdownBy = q.get('breakdownBy') ?? 'provider';
  const body = {
    success: true,
    totals: { cost: 1.5, tokens: 100, inputTokens: 60, outputTokens: 40, calls: 3 },
    filters: {},
    availableFilters: { providers: [], models: [], activities: [], users: [], agents: [] },
    categoryTotals: {
      creation: { cost: 0, tokens: 0, calls: 0 },
      execution: { cost: 0, tokens: 0, calls: 0 },
      memory: { cost: 0.5, tokens: 10, calls: 1 },
      system: { cost: 1, tokens: 90, calls: 2 },
    },
    possiblyIncomplete: false,
    items: [
      {
        id: `${breakdownBy}-1`,
        label: `Row ${breakdownBy}`,
        cost: 1.5,
        tokens: 100,
        inputTokens: 60,
        outputTokens: 40,
        calls: 3,
        percentage: 100,
        type: breakdownBy,
        metadata: {},
      },
    ],
  };
  return { ok: true, status: 200, json: async () => body };
});

const queries = (): URLSearchParams[] => fetchMock.mock.calls.map(([u]) => new URL(String(u), 'http://x').searchParams);
const lastQuery = () => queries()[queries().length - 1];

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
});

beforeEach(() => {
  fetchMock.mockClear();
  mockSearch = '';
});

afterEach(() => {
  // No request ever pairs scope=bos with a view the route refuses there.
  for (const q of queries()) {
    if (q.get('scope') !== 'bos') continue;
    expect(['agent', 'execution']).not.toContain(q.get('breakdownBy'));
    expect(q.has('agent') || q.has('execution') || q.has('category')).toBe(false);
  }
});

describe('switching to Business OS clears a Category selection (C3-4, QA)', () => {
  it('C-1: Memory selected in "All"; the switch sends no category, and switching back restores nothing', async () => {
    mockSearch = 'scope=all';
    render(<AdminCostAnalytics />);
    fireEvent.click(await screen.findByTestId('category-card-memory'));
    await waitFor(() => expect(lastQuery().get('category')).toBe('memory'));
    expect(await screen.findByText('Category: Memory')).toBeTruthy();

    fireEvent.click(screen.getByTestId('scope-toggle'));
    await waitFor(() => expect(lastQuery().get('scope')).toBe('bos'));
    expect(lastQuery().has('category')).toBe(false);
    expect(screen.queryByText(/^Category:/)).toBeNull();
    expect(document.body.textContent).not.toContain('not valid');

    fireEvent.click(screen.getByTestId('scope-toggle'));
    await waitFor(() => expect(lastQuery().get('scope')).toBe('all'));
    expect(lastQuery().has('category')).toBe(false);
  });
});
