/**
 * @jest-environment jsdom
 *
 * The queued strip's working state (CR-P2-1, BL-7a part 2).
 *
 * "Send now" now waits for the lead drain on the server, so the request can
 * take seconds. While it runs the strip must say "Working…" and offer neither
 * button, so the owner cannot click a second time. `control()` keeps its state
 * on the `queued:<contactId>` key, not the row's key, which is why this is
 * pinned separately. Cancel shares the same path.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string) => translations.en[key] || key,
      formatCurrency: (amount: number) => String(amount),
    }),
  };
});

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/payments/RefundModal', () => ({ RefundModal: () => null }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

import { NeedsYouCard, type GapView } from '@/components/business-os/insight/NeedsYouCard';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: { en: Record<string, string> };
};
const WORKING = translations.en['gaps.working'];
const SEND_NOW = translations.en['gaps.send_now'];
const CANCEL = translations.en['gaps.cancel'];
const ALREADY_SENDING = translations.en['gaps.refused.already_sending'];

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

const GAPS: GapView[] = [
  {
    id: 'enquiry_unanswered',
    action: 'send_booking_link',
    count: 1,
    items: [
      {
        contactId: CONTACT_ID,
        name: 'Dana Levi',
        note: null,
        since: '2026-10-05T08:00:00.000Z',
        entityId: null,
        queued: { label: 'Booking link', chosenBy: null, dueAt: null },
      },
    ],
  },
];

/** A fetch that stays pending until the test releases it with a body. */
let release: (body: unknown) => void;
let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn(
    () =>
      new Promise(resolve => {
        release = (body: unknown) => resolve({ ok: true, status: 200, json: async () => body });
      })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
});

function setup() {
  const onChanged = jest.fn();
  render(<NeedsYouCard gaps={GAPS} onChanged={onChanged} />);
  return { onChanged };
}

describe('NeedsYouCard queued strip: working state', () => {
  it('(a) while Send now is in flight it shows Working… and neither button', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: SEND_NOW }));

    expect(await screen.findByText(WORKING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SEND_NOW })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CANCEL })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/business-os/leads/${CONTACT_ID}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'send_now', kind: 'invite' });
  });

  it('(b) on success it calls onChanged and Working… goes', async () => {
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole('button', { name: SEND_NOW }));
    await screen.findByText(WORKING);

    await act(async () => release({ success: true }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
  });

  it('(c) on already_sending it shows the refusal and the buttons return', async () => {
    const { onChanged } = setup();
    fireEvent.click(screen.getByRole('button', { name: SEND_NOW }));
    await screen.findByText(WORKING);

    await act(async () => release({ success: false, reason: 'already_sending' }));

    expect(await screen.findByText(ALREADY_SENDING)).toBeInTheDocument();
    expect(screen.queryByText(WORKING)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: SEND_NOW })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: CANCEL })).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('(d) Cancel shows Working… too, with neither button', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: CANCEL }));

    expect(await screen.findByText(WORKING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SEND_NOW })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CANCEL })).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'cancel', kind: 'invite' });
  });
});
