/**
 * The per-address window, exercised rather than asserted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Its sibling test reads the source and checks the call is wired in the right
 * order. That catches a check being deleted; it cannot catch one that is
 * present and wrong.
 *
 * A live probe was tried first and proved nothing: the account with the real
 * duplicates had no unmailed ABANDONED sibling left, so the send was refused
 * by the status check and the test passed without the window ever running.
 * Mocked here so the window is the only thing that can refuse.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const sendEmail = jest.fn(async () => ({ sent: true, provider: 'resend' }));
const reads: Array<Record<string, unknown> | null> = [];

jest.mock('@/lib/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => log };
  return { createLogger: () => log };
});

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...(a as [])),
}));
jest.mock('@/lib/notifications/recordEmailSend', () => ({ recordEmailSend: jest.fn() }));
jest.mock('@/lib/email/branding', () => ({ resolveEmailBranding: jest.fn(async () => ({})) }));
jest.mock('@/lib/email/templates/booking-recovery', () => ({
  generateBookingRecoveryEmail: () => ({ subject: 's', html: '<p>h</p>' }),
}));

/* Answers `maybeSingle()` from a queue, in call order. */
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => {
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'maybeSingle') return async () => ({ data: reads.shift() ?? null, error: null });
            if (prop === 'then') return undefined;
            return () => builder;
          },
        }
      );
      return builder;
    },
  },
}));

import { sendOneRecovery } from '../abandonedRecovery';

const ATTEMPT = {
  id: 'a1',
  user_id: 'u1',
  service_id: null,
  first_name: 'Dana',
  email: 'dana@example.test',
  start_time: null,
  timezone: null,
  page_url: 'https://book.test',
  locale: 'en',
  status: 'abandoned',
};

beforeEach(() => {
  reads.length = 0;
  sendEmail.mockClear();
});

it('refuses when the same address had one this week, and sends nothing', async () => {
  reads.push(ATTEMPT);          // the attempt itself: abandoned, has an email
  reads.push({ id: 'other' });  // a sibling attempt mailed inside the window

  const outcome = await sendOneRecovery('a1', 'u1');

  expect(outcome.sent).toBe(false);
  /* Not the status check: the attempt above is abandoned. */
  expect(outcome.reason).not.toContain('abandoned');
  expect(sendEmail).not.toHaveBeenCalled();
});

it('sends when the address has had nothing recent', async () => {
  reads.push(ATTEMPT);
  reads.push(null);             // nothing inside the window

  const outcome = await sendOneRecovery('a1', 'u1');

  expect(outcome.sent).toBe(true);
  expect(sendEmail).toHaveBeenCalledTimes(1);
});
