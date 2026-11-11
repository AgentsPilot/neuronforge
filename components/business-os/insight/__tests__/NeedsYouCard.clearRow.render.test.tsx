/**
 * @jest-environment jsdom
 */

/**
 * Clearing one row must not reload the dashboard.
 *
 * `onChanged` is `fetchDashboardData` on the Business OS page, which re-reads
 * my-day, stats, pipeline stages and two channel-insight calls alongside the
 * gaps. That is the right response to an action whose effects are spread across
 * the page. For taking a single row off a single list it reads, on screen, as
 * the page reloading — which is exactly how it was reported.
 *
 * So the row is dropped locally and nothing is refetched. This pins both halves,
 * because the cheap fix is one `onChanged?.()` away from coming back.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NeedsYouCard, type GapView } from '../NeedsYouCard';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    isRTL: false,
    language: 'en',
    formatCurrency: (n: number) => String(n),
  }),
}));
jest.mock('@/components/payments/RefundModal', () => ({ RefundModal: () => null }));
jest.mock('../ExtendQuoteDialog', () => ({ ExtendQuoteDialog: () => null }));

const waiting = (): GapView => ({
  id: 'client_reply_waiting',
  action: 'answer_client',
  count: 1,
  items: [
    {
      contactId: '11111111-1111-1111-1111-111111111111',
      name: 'Dana Levi',
      note: 'They asked to move the time.',
      subject: 'Re: your appointment',
      quote: 'Can we move it?',
      threadId: 'thread-1',
      since: new Date().toISOString(),
      entityId: null,
    },
  ],
});

beforeEach(() => {
  global.fetch = jest.fn(async () =>
    ({ json: async () => ({ success: true, data: { settled: true } }) }) as unknown as Response
  ) as unknown as typeof fetch;
});

describe('clearing a reply row', () => {
  it('removes the row without asking the dashboard to reload', async () => {
    const onChanged = jest.fn();
    render(<NeedsYouCard gaps={[waiting()]} onChanged={onChanged} />);

    fireEvent.click(screen.getAllByText('gaps.reply.mark_handled')[0]);

    /*
     * Asserted on the QUOTE, not the name: `t` is stubbed to return its key, so
     * the lead sentence renders as `gaps.lead.say.client_reply_waiting` with no
     * `{name}` substituted. The client's own words are passed through verbatim
     * and are the only text on the row guaranteed to be there.
     */
    /* PLURAL: the promoted row and the folded list both render the row, and
       the fold is `hidden` rather than unmounted, so the quote is in the DOM
       twice. Clearing has to remove BOTH, which a singular query could not
       even express. */
    expect(screen.getAllByText(/Can we move it/).length).toBeGreaterThan(0);

    await waitFor(
      () => expect(screen.queryAllByText(/Can we move it/)).toHaveLength(0),
      { timeout: 3000 }
    );

    /* The whole point: the row is gone and the page was never refetched. */
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('posts handled with the thread, so the server settles the right one', async () => {
    render(<NeedsYouCard gaps={[waiting()]} />);
    fireEvent.click(screen.getAllByText('gaps.reply.mark_handled')[0]);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/business-os/gaps/reply');
    expect(JSON.parse(init.body)).toMatchObject({
      action: 'handled',
      contactId: '11111111-1111-1111-1111-111111111111',
      threadId: 'thread-1',
    });
  });
});
