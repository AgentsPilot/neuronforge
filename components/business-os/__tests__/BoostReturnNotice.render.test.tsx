/**
 * @jest-environment jsdom
 *
 * The dashboard's "payment received" notice (credits boost slice 5b.1; FR-11,
 * FR-13; SA Q-2). It only READS our row; it never credits.
 */

import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));
const mockNotify = jest.fn();
jest.mock('@/lib/business-os/client/creditUsageSignal', () => ({ notifyCreditUsageChanged: () => mockNotify() }));

import {
  BoostReturnNotice,
  BOOST_RETURN_CREDITED_HIDE_MS,
  BOOST_RETURN_POLL_DELAYS_MS,
  __resetBoostReturnForTests,
} from '@/components/business-os/BoostReturnNotice';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as { translations: Record<Lang, Record<string, string>> };
const tr = (key: string) => translations[mockLang.language][key];
const SESSION = 'cs_test_a1B2c3';

let replies: Array<{ status: number; body: unknown }> = [];
let fetchMock: jest.Mock;
function installFetch() {
  fetchMock = jest.fn(async () => {
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const purchase = (status: string | null) => ({ status: 200, body: { success: true, data: { purchase: status === null ? null : { status } } } });

function visit(search: string) {
  window.history.replaceState(null, '', `/business-os${search}`);
}

/** Advance through the poll's next wait and let the read settle. */
async function tick(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetBoostReturnForTests();
  mockNotify.mockClear();
  mockLang.language = 'en';
  replies = [purchase('processing')];
  installFetch();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('BoostReturnNotice', () => {
  it('a normal visit: renders nothing and reads nothing', async () => {
    visit('');
    render(<BoostReturnNotice />);
    await tick(100000);
    expect(screen.queryByTestId('boost-return-notice')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a malformed session id: nothing shown, nothing read, and the parameters are still removed', async () => {
    visit('?boost=return&session_id=pi_123');
    render(<BoostReturnNotice />);
    await tick(100000);
    expect(screen.queryByTestId('boost-return-notice')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('a valid return: the address is cleaned, other parameters kept, and "Payment received" is shown', () => {
    visit(`?tab=home&boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    expect(window.location.search).toBe('?tab=home');
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Payment received — your credits will appear shortly.');
    expect(screen.getByTestId('boost-return-notice')).toHaveAttribute('role', 'status');
  });

  it('reads OUR row for this session only, by GET, and never writes', async () => {
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    await tick(BOOST_RETURN_POLL_DELAYS_MS[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/business-os/credits/boost/purchases?sessionId=${SESSION}`);
    expect((init as RequestInit | undefined)?.method ?? 'GET').toBe('GET');
  });

  it('credited → "Credits added.", the card is told to re-read, the poll stops, the notice hides after a moment', async () => {
    replies = [purchase('processing'), purchase('credited')];
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    await tick(BOOST_RETURN_POLL_DELAYS_MS[0]);
    expect(mockNotify).not.toHaveBeenCalled();
    await tick(BOOST_RETURN_POLL_DELAYS_MS[1]);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Credits added.');
    expect(mockNotify).toHaveBeenCalledTimes(1);
    await tick(100000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('boost-return-notice')).not.toBeInTheDocument();
    expect(BOOST_RETURN_CREDITED_HIDE_MS).toBeLessThan(100000);
  });

  it('SA Q-2: still processing after five reads → "still being confirmed", and NO sixth read', async () => {
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    for (const delay of BOOST_RETURN_POLL_DELAYS_MS) await tick(delay);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent(
      'Your payment is still being confirmed. Your credits will appear here once it completes.'
    );
    await tick(10 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(BOOST_RETURN_POLL_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBe(77000);
  });

  it.each([
    ['awaiting_payment', 'Your payment is processing. Some payment methods take a few days; your credits will be added when it completes.'],
    ['failed', "The payment didn't go through. You weren't charged."],
    ['expired', "This checkout expired. You weren't charged."],
    ['under_review', "Payment under review. We'll be in touch if we need anything."],
  ])('%s → its line, and the poll stops', async (status, text) => {
    replies = [purchase(status)];
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    await tick(BOOST_RETURN_POLL_DELAYS_MS[0]);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent(text);
    await tick(100000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('not this owner\'s session (purchase null) → the notice disappears', async () => {
    replies = [purchase(null)];
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    await tick(BOOST_RETURN_POLL_DELAYS_MS[0]);
    expect(screen.queryByTestId('boost-return-notice')).not.toBeInTheDocument();
  });

  it('a failed read keeps polling within the bound (never a final answer from an error)', async () => {
    replies = [{ status: 500, body: { success: false } }, purchase('credited')];
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    await tick(BOOST_RETURN_POLL_DELAYS_MS[0]);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Payment received');
    await tick(BOOST_RETURN_POLL_DELAYS_MS[1]);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Credits added.');
  });

  it('a remount (StrictMode) on the same page load keeps the notice', async () => {
    visit(`?boost=return&session_id=${SESSION}`);
    const first = render(<BoostReturnNotice />);
    first.unmount();
    render(<BoostReturnNotice />);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Payment received');
  });

  it('Dismiss hides it', () => {
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    fireEvent.click(screen.getByTestId('boost-return-dismiss'));
    expect(screen.queryByTestId('boost-return-notice')).not.toBeInTheDocument();
  });

  it('Hebrew: RTL and the Hebrew line', () => {
    mockLang.language = 'he';
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    expect(screen.getByTestId('boost-return-notice')).toHaveStyle({ direction: 'rtl' });
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent(tr('usage.boost.return.received'));
  });
});

describe('QA R-3: when the notice reads, and how many times', () => {
  it('reads at 2, 7, 17, 37 and 77 seconds after landing, then never again', async () => {
    visit(`?boost=return&session_id=${SESSION}`);
    render(<BoostReturnNotice />);
    const readAt: number[] = [];
    // One-second steps, as wall time on the page (durations here are seconds, not figures).
    for (let second = 1; second <= 90; second += 1) {
      await tick(1000);
      if (fetchMock.mock.calls.length > readAt.length) readAt.push(second);
    }
    expect(readAt).toEqual([2, 7, 17, 37, 77]);
    expect(screen.getByTestId('boost-return-message')).toHaveTextContent('Your payment is still being confirmed.');
    await tick(10 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    // Ninety fake-timer steps, each through act(): cheap, but slower than Jest's
    // default 5 s under a loaded full run (it timed out once there). Time on the
    // page is faked; this only bounds the real time the steps may take.
  }, 30_000);

  it('under StrictMode (double mount) there is ONE poll sequence', async () => {
    visit(`?boost=return&session_id=${SESSION}`);
    render(
      <StrictMode>
        <BoostReturnNotice />
      </StrictMode>
    );
    await tick(2 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(200 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
