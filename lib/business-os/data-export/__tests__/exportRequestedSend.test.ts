/**
 * The shared "Export requested" send (MX-5 workplan §4.5, T-S1; SA-Q3).
 * Every seam is mocked: no network (tests/jest-no-network.ts).
 */

const mockSendEmail = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
  platformSenderAddress: () => 'AgentPilot <noreply@example.test>',
}));

const mockFindById = jest.fn();
jest.mock('@/lib/repositories/BusinessOsExportRequestRepository', () => ({
  BusinessOsExportRequestRepository: jest.fn().mockImplementation(() => ({
    findByIdForUser: (...a: unknown[]) => mockFindById(...a),
  })),
}));

const mockLanguage = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: { findPreferredLanguage: (...a: unknown[]) => mockLanguage(...a) },
}));

const mockClock = jest.fn();
jest.mock('@/lib/business-os/data-export/ownerClock', () => ({ ownerClock: (...a: unknown[]) => mockClock(...a) }));

import type { Logger } from '@/lib/logger';
import { EXPORT_REQUESTED_EMAIL_TIMEOUT_MS, sendExportRequestedEmail } from '../exportRequestedSend';

const OWNER = '11111111-1111-4111-8111-111111111111';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const TO = 'owner@example.test';

const logged: unknown[][] = [];
const log = {
  info: (...a: unknown[]) => logged.push(a),
  warn: (...a: unknown[]) => logged.push(a),
  error: (...a: unknown[]) => logged.push(a),
  debug: (...a: unknown[]) => logged.push(a),
} as unknown as Logger;

const args = (origin?: 'owner' | 'admin') => ({ userId: OWNER, requestId: REQUEST, to: TO, modules: ['clients' as const], ...(origin ? { origin } : {}) });

beforeEach(() => {
  logged.length = 0;
  mockSendEmail.mockReset().mockResolvedValue({ sent: true, provider: 'resend' });
  mockFindById.mockReset().mockResolvedValue({ data: { requested_at: '2026-10-27T10:05:00.000Z' }, error: null });
  mockLanguage.mockReset().mockResolvedValue({ data: 'en', error: null });
  mockClock.mockReset().mockResolvedValue({ timezone: 'UTC', isSet: false });
});

describe('sendExportRequestedEmail (T-S1)', () => {
  it('the guard is 10 s, as before the move', () => {
    expect(EXPORT_REQUESTED_EMAIL_TIMEOUT_MS).toBe(10_000);
  });

  it('sent: one transactional email to the owner, recipient redacted in the transport logs', async () => {
    expect(await sendExportRequestedEmail(args(), log)).toBe('sent');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent).toMatchObject({ kind: 'transactional', to: [TO], redactRecipientInLogs: true });
    expect(sent.subject).toBe('Your data export has started');
    // Reads keyed on the owner and the request.
    expect(mockFindById).toHaveBeenCalledWith(REQUEST, OWNER);
    expect(mockLanguage).toHaveBeenCalledWith(OWNER);
  });

  it("origin admin: support's wording, same recipient", async () => {
    expect(await sendExportRequestedEmail(args('admin'), log)).toBe('sent');
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toEqual([TO]);
    expect(sent.subject).toBe('AgentPilot support has started an export of your data');
    expect(sent.text).toContain('AgentPilot support started an export');
    expect(sent.text).not.toContain('You asked');
  });

  it('the transport answers not sent → email_failed', async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none' });
    expect(await sendExportRequestedEmail(args(), log)).toBe('email_failed');
  });

  it('the transport rejects → email_failed, never a throw', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    expect(await sendExportRequestedEmail(args(), log)).toBe('email_failed');
  });

  it('a read throws → email_failed and one warn, never a throw', async () => {
    mockClock.mockImplementation(() => {
      throw new Error('clock exploded');
    });
    expect(await sendExportRequestedEmail(args(), log)).toBe('email_failed');
    expect(JSON.stringify(logged)).toContain('Export requested email threw');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the send hangs past the guard → email_timeout, not email_failed (C-7)', async () => {
    jest.useFakeTimers();
    try {
      mockSendEmail.mockReturnValue(new Promise(() => undefined));
      const outcome = sendExportRequestedEmail(args(), log);
      await jest.advanceTimersByTimeAsync(EXPORT_REQUESTED_EMAIL_TIMEOUT_MS + 1);
      expect(await outcome).toBe('email_timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('an unreadable language or request time still sends, in English, with a warn; the address is never logged', async () => {
    mockLanguage.mockResolvedValue({ data: null, error: new Error('x') });
    mockFindById.mockResolvedValue({ data: null, error: new Error('y') });
    expect(await sendExportRequestedEmail(args('admin'), log)).toBe('sent');
    const text = JSON.stringify(logged);
    expect(text).toContain('language_unreadable');
    expect(text).toContain('requested_at_unreadable');
    expect(text).not.toContain(TO);
  });
});
