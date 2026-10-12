/**
 * @jest-environment jsdom
 *
 * "Payment processing": the bounded refresh (plan payments P-5a.2; workplan
 * §3.3, §8 "Refresher"; SA S5-6, W-7, Q-5; risk R-6).
 *
 *   - at most 15 `router.refresh()` calls, 4 s apart, then the "taking longer"
 *     line;
 *   - `stuck` / `slow`: the line at once and NO refresh (one manual load, one
 *     alert);
 *   - marker-only: the line links to the screen WITHOUT the marker (W-7 c).
 */

import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';

const refreshes: number[] = [];
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => refreshes.push(Date.now()) }),
}));

import {
  PaymentProcessingRefresher,
  PROCESSING_REFRESH_INTERVAL_MS,
  PROCESSING_REFRESH_LIMIT,
} from '../awaiting-payment/PaymentProcessingRefresher';

const PROPS = {
  slowLabel: 'This is taking longer than usual. Refresh in a minute.',
  checkAgainLabel: 'Check again',
  checkAgainHref: '/invite/awaiting-payment',
};

beforeEach(() => {
  refreshes.length = 0;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('PaymentProcessingRefresher', () => {
  it('the bound is 15 refreshes, 4 s apart (about one minute)', () => {
    expect(PROCESSING_REFRESH_LIMIT).toBe(15);
    expect(PROCESSING_REFRESH_INTERVAL_MS).toBe(4000);
  });

  it('refreshes every 4 s, at most 15 times, then shows the "taking longer" line', () => {
    render(<PaymentProcessingRefresher delay="none" markerOnly={false} {...PROPS} />);
    expect(screen.queryByTestId('awaiting-payment-processing-slow')).not.toBeInTheDocument();

    advance(PROCESSING_REFRESH_INTERVAL_MS - 1);
    expect(refreshes).toHaveLength(0);
    advance(1);
    expect(refreshes).toHaveLength(1);

    for (let i = 0; i < 30; i += 1) advance(PROCESSING_REFRESH_INTERVAL_MS);
    expect(refreshes).toHaveLength(PROCESSING_REFRESH_LIMIT);
    expect(screen.getByTestId('awaiting-payment-processing-slow')).toHaveTextContent(PROPS.slowLabel);
    // Not marker-only: no link.
    expect(screen.queryByTestId('awaiting-payment-check-again')).not.toBeInTheDocument();
  });

  it.each(['stuck', 'slow'] as const)('%s: the line at once and no refresh at all (Q-5)', (delay) => {
    render(<PaymentProcessingRefresher delay={delay} markerOnly={false} {...PROPS} />);
    expect(screen.getByTestId('awaiting-payment-processing-slow')).toHaveTextContent(PROPS.slowLabel);
    advance(PROCESSING_REFRESH_INTERVAL_MS * 20);
    expect(refreshes).toEqual([]);
  });

  it('marker-only: after the bound, the line links to the screen WITHOUT the marker (W-7 c)', () => {
    render(<PaymentProcessingRefresher delay="none" markerOnly {...PROPS} />);
    for (let i = 0; i < PROCESSING_REFRESH_LIMIT; i += 1) advance(PROCESSING_REFRESH_INTERVAL_MS);
    const link = screen.getByTestId('awaiting-payment-check-again');
    expect(link).toHaveAttribute('href', '/invite/awaiting-payment');
    expect(link.getAttribute('href')).not.toContain('checkout');
    expect(link).toHaveTextContent(PROPS.checkAgainLabel);
  });

  it('unmounting stops the timer', () => {
    const { unmount } = render(<PaymentProcessingRefresher delay="none" markerOnly={false} {...PROPS} />);
    unmount();
    advance(PROCESSING_REFRESH_INTERVAL_MS * 3);
    expect(refreshes).toEqual([]);
  });
});
