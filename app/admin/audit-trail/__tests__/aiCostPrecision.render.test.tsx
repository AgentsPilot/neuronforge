/**
 * @jest-environment jsdom
 */

/**
 * Deduction layer slice 2 (SQ-14 (3), SA Q-5): the AI Action Details panel
 * shows the stored cost at its stored precision. At least 6 and at most 10
 * decimals, trailing zeros trimmed down to 6, never exponent notation. An entry
 * written before slice 2 (micro-rounded) renders exactly as it did.
 *
 * `asUsd` lives inside the page (a Next page file may not export helpers), so
 * it is tested through a render of the real page, as the other suites here do.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('@/components/UserProvider', () => ({
  useAuth: () => ({ user: { id: 'admin-user', email: 'admin@example.com' } }),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

import AuditTrailPage from '../page';

function aiEntry(id: string, estimatedCostUsd: number) {
  return {
    id,
    user_id: '99999999-9999-4999-8999-999999999999',
    action: 'BUSINESS_AI_ACTION_COMPLETED',
    entity_type: 'ai_action',
    entity_id: '33333333-3333-4333-8333-333333333333',
    resource_name: null,
    details: {
      schema: 1,
      area: 'chat',
      areas: ['chat'],
      actionType: 'chat_turn',
      groupId: '33333333-3333-4333-8333-333333333333',
      trigger: 'user',
      callCount: 1,
      failedCallCount: 0,
      inputTokens: 10,
      outputTokens: 0,
      totalTokens: 10,
      estimatedCostUsd,
      callNames: ['plan_cache_lookup_embedding'],
      models: ['text-embedding-3-small'],
      outcome: 'succeeded',
    },
    changes: null,
    severity: 'info',
    created_at: '2026-09-28T10:00:00.000Z',
    compliance_flags: [],
    users: { email: 'owner@example.com' },
  };
}

function mockRoute(logs: unknown[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      logs,
      pagination: { page: 1, pageSize: 20, total: logs.length, totalPages: 1, showing: logs.length, hasMore: false },
    }),
  }));
}

/** Render one AI entry, expand it, and return the Estimated Cost value. */
async function renderedCost(cost: number): Promise<string> {
  mockRoute([aiEntry('e1', cost)]);
  render(<AuditTrailPage />);
  fireEvent.click(await screen.findByText('owner@example.com'));
  const label = await screen.findByText('Estimated Cost');
  return within(label.parentElement as HTMLElement).getByText(/^\$/).textContent as string;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Estimated Cost precision (slice 2, SQ-14)', () => {
  it.each([
    // [stored, rendered]
    [0.0000002, '$0.0000002'], // a ~2e-7 embedding: was $0.000000
    [0.003502, '$0.003502'], // a micro-rounded (pre-slice-2) entry: byte-identical to before
    [0.0035024, '$0.0035024'], // the same action at 10 dp
    [0, '$0.000000'], // unchanged
    [0.3, '$0.300000'], // unchanged
    [1.5, '$1.500000'], // unchanged
    [0.0012353778, '$0.0012353778'], // the full 10 decimals
  ])('stores %p, shows %p', async (stored, shown) => {
    expect(await renderedCost(stored)).toBe(shown);
  });

  it('never shows exponent notation', async () => {
    const text = await renderedCost(1e-10);
    expect(text).toBe('$0.0000000001');
    expect(text).not.toMatch(/e/i);
  });
});
