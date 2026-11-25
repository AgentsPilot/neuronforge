/**
 * @jest-environment jsdom
 */

/**
 * The promoted refund row carries its own three answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `refundDecisions` was extracted from the list row for exactly one reason,
 * and its own comment says so: "These lived only in the per-item list. The
 * LEAD row — the promoted one, drawn with the reply box, and the only row most
 * owners ever see because the rest stay folded — rendered the generic action
 * instead."
 *
 * The extraction happened. The second call site did not. So the function that
 * exists to fix the lead row was never called from it, and a refund request
 * arriving as the most urgent thing showed the client, the amount, the AI
 * assessment and a reply box — and no way to refund, return a different
 * amount, or decline. The only route to those buttons was to expand "and 2
 * more waiting" and answer it from the folded list underneath.
 *
 * Reported twice from a live account with that card on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ASSERTS ON A CONTAINER AND NOT A COUNT
 *
 * The fold is `hidden`, not unmounted (see the note in the clear-row suite),
 * so the LIST's buttons are in the DOM whether or not anybody has expanded it.
 * A test asking "is there a decline button on screen" passes against the
 * broken card. The question has to be asked of the promoted row itself, so
 * each assertion is scoped to the action row that holds "open the client" —
 * a control only the lead has.
 */

import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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

/** The live row this was reported from: assessed, 40 USD still returnable. */
const refundAsked = (): GapView => ({
  id: 'refund_requested',
  action: 'refund',
  count: 1,
  items: [
    {
      contactId: '11111111-1111-1111-1111-111111111111',
      name: 'Tal Omer',
      entityId: '22222222-2222-2222-2222-222222222222',
      requestId: '33333333-3333-3333-3333-333333333333',
      amount: 40,
      currency: 'USD',
      refundRecommendation: 'refund_partial',
      refundRecommendedAmount: 40,
      refundReasoning:
        'A payment was found and there is still 40 USD left to return.',
      refundClientDraft: 'I’m sorry you couldn’t make it.',
      refundableAmount: 40,
      /* One payment behind the booking and no live plan: the two conditions
         `canApproveInOneClick` adds beyond "the agent named a figure". With
         either missing the one-click button is deliberately withheld and the
         dialog asks instead, so a fixture without them tests the wrong card. */
      refundPaymentsCount: 1,
      planLive: false,
      refundViaProcessor: true,
      since: new Date().toISOString(),
    } as GapView['items'][number],
  ],
});

/** The lead's action row, found through the one control only it renders. */
function leadActions(): HTMLElement {
  const openClient = screen.getByText('gaps.lead.open_contact');
  const row = openClient.closest('div');
  if (!row) throw new Error('the promoted row has no action row');
  return row as HTMLElement;
}

describe('a refund request promoted to the top of the card', () => {
  it('offers the decision on the row that asks for it', () => {
    render(<NeedsYouCard gaps={[refundAsked()]} />);

    const actions = leadActions();

    /*
     * All three, because the bug was not "a button is missing" — it was that
     * the whole decision lived somewhere else. Returning the money, returning
     * a different amount, and saying no are one answer with three shapes, and
     * an owner offered any two of them is still being steered.
     */
    expect(within(actions).getByText('gaps.refund.decline')).toBeTruthy();
    expect(within(actions).getByText('gaps.refund.partial')).toBeTruthy();
    /* The one-click approve carries its figure, so it is matched loosely:
       its label is built from the amount, not from a bare key. */
    expect(within(actions).getByText(/gaps\.refund\.(approve|mark_returned)/)).toBeTruthy();
  });

  it('still opens the client and the booking from the same row', () => {
    render(<NeedsYouCard gaps={[refundAsked()]} />);

    /* The decisions were inserted beside these, so a mistake in that insert
       shows up here as something displaced rather than as a silent pass. */
    const actions = leadActions();
    expect(within(actions).getByText('gaps.lead.open_contact')).toBeTruthy();
    expect(actions.querySelectorAll('button').length).toBeGreaterThanOrEqual(4);
  });

  it('offers nothing of the kind on a row that is not a refund', () => {
    /* The guard cuts both ways: `refundDecisions` is gated on the gap id, and
       a lead row for a reply must not grow refund buttons from this change. */
    render(
      <NeedsYouCard
        gaps={[
          {
            id: 'client_reply_waiting',
            action: 'answer_client',
            count: 1,
            items: [
              {
                contactId: '44444444-4444-4444-4444-444444444444',
                name: 'Dana Levi',
                note: 'They asked to move the time.',
                since: new Date().toISOString(),
                entityId: null,
              } as GapView['items'][number],
            ],
          },
        ]}
      />
    );

    const actions = leadActions();
    expect(within(actions).queryByText('gaps.refund.decline')).toBeNull();
    expect(within(actions).queryByText('gaps.refund.partial')).toBeNull();
  });

  it('keeps the message to the client out of the button row', async () => {
    /*
     * "Only the buttons" beside the headline. A four-row textarea in that flex
     * row takes its width from its own content, so the box the owner is meant
     * to read and edit would squeeze the sentence naming the client into a
     * narrow column. It renders underneath instead, at the card's width.
     */
    global.fetch = jest.fn(async () =>
      ({ json: async () => ({ success: true, data: { draft: 'I cannot refund this one.' } }) }) as unknown as Response
    ) as unknown as typeof fetch;

    render(<NeedsYouCard gaps={[refundAsked()]} />);

    const actions = leadActions();
    fireEvent.click(within(actions).getByText('gaps.refund.decline'));

    /* The draft arrives, and lands somewhere that is not the button row. */
    await waitFor(() =>
      expect(screen.getAllByDisplayValue('I cannot refund this one.').length).toBeGreaterThan(0)
    );
    expect(within(leadActions()).queryByRole('textbox')).toBeNull();

    /* And the second tap is still required: declining has not been recorded. */
    const posted = (global.fetch as jest.Mock).mock.calls.map(call => String(call[0]));
    expect(posted.some(url => url.includes('/decline-draft'))).toBe(true);
    expect(posted.some(url => url.endsWith('/refund-requests/decide'))).toBe(false);
  });

  it('puts the drafted refusal INTO the reply box, replacing the suggestion', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * The bug this exists for: the editor seeded once per MOUNT, so the box
     * kept the agent's suggested REPLY — "we can refund 40 USD, or arrange a
     * new time" — while the label above it changed to "what they will be
     * told" and the state behind it held a refusal. The owner would have sent
     * an offer of a refund as their decline.
     *
     * A row with a `subject` is the one that borrows the reply box, so this
     * is the fixture that exercises it; the portal-form case without one
     * keeps its own editor and is covered above.
     * ─────────────────────────────────────────────────────────────────────
     */
    global.fetch = jest.fn(async () =>
      ({ json: async () => ({ success: true, data: { draft: 'I cannot refund this one.' } }) }) as unknown as Response
    ) as unknown as typeof fetch;

    const gap = refundAsked();
    (gap.items[0] as Record<string, unknown>).subject = 'Refund request';
    (gap.items[0] as Record<string, unknown>).refundClientDraft =
      'We can refund 40 USD, or arrange a new time.';

    const { container } = render(<NeedsYouCard gaps={[gap]} />);

    const editor = () =>
      container.querySelector('[contenteditable="true"]') as HTMLElement | null;

    /* It opens on the agent's reply suggestion. */
    await waitFor(() => expect(editor()?.textContent).toContain('arrange a new time'));

    fireEvent.click(within(leadActions()).getByText('gaps.refund.decline'));

    /* And the refusal replaces it, rather than sitting in state unseen. */
    await waitFor(() => expect(editor()?.textContent).toContain('I cannot refund this one'));
    expect(editor()?.textContent).not.toContain('arrange a new time');
  });

  it('offers one way out, not two', async () => {
    /* The ✕ under the box and a "Cancel" beside the headline did the same
       thing, in two places, for one question. */
    global.fetch = jest.fn(async () =>
      ({ json: async () => ({ success: true, data: { draft: 'No.' } }) }) as unknown as Response
    ) as unknown as typeof fetch;

    render(<NeedsYouCard gaps={[refundAsked()]} />);
    fireEvent.click(within(leadActions()).getByText('gaps.refund.decline'));

    await waitFor(() =>
      expect(screen.queryAllByText('gaps.refund.decline_confirm').length).toBeGreaterThan(0)
    );
    expect(within(leadActions()).queryByText('common.cancel')).toBeNull();
  });

  it('will not record the decline while the sentence is still being written', async () => {
    /*
     * The second tap sends whatever is in state, and for the few seconds the
     * model takes there is nothing there. An owner tapping twice quickly used
     * to record the decline and tell the client NOTHING — silently, with the
     * row gone from the card and no way to notice.
     */
    let release: (value: unknown) => void = () => {};
    const held = new Promise(resolve => {
      release = resolve;
    });
    global.fetch = jest.fn(async () => {
      await held;
      return { json: async () => ({ success: true, data: { draft: 'No.' } }) } as unknown as Response;
    }) as unknown as typeof fetch;

    render(<NeedsYouCard gaps={[refundAsked()]} />);
    fireEvent.click(within(leadActions()).getByText('gaps.refund.decline'));

    /* Mid-draft: the button names what it is doing and refuses the press. */
    const waiting = await screen.findAllByText('gaps.refund.decline_drafting');
    expect(waiting.length).toBeGreaterThan(0);
    const confirm = waiting
      .map(node => node.closest('button'))
      .find(Boolean) as HTMLButtonElement | undefined;
    expect(confirm?.disabled).toBe(true);

    release(null);

    /* And once the sentence exists, it asks for the second tap. */
    await waitFor(() =>
      expect(screen.queryAllByText('gaps.refund.decline_confirm').length).toBeGreaterThan(0)
    );
    const posted = (global.fetch as jest.Mock).mock.calls.map(call => String(call[0]));
    expect(posted.some(url => url.endsWith('/refund-requests/decide'))).toBe(false);
  });
});
