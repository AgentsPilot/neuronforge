/**
 * The worker's numbers, keys and send payloads (module export MX-3a, workplan
 * D-3…D-13, §13.2 T-S1…T-S4; SA Workplan Review Q-3, Q-6, C-3, C-4, C-8).
 */

import {
  BUILD_CLAIM_CUTOFF_SECONDS,
  buildNoticeSend,
  buildPartSend,
  classifyKeyedSend,
  MAX_PARTS_PER_MODULE,
  MODULE_EXPORT_SENDING_BOUNDS,
  MODULE_JOB_FAILURE_CODES,
  MODULE_JOB_RETRY_CODES,
  NOTICE_SEND_TIMEOUT_MS,
  noticeIdempotencyKey,
  ownerFactsKey,
  PART_BYTES_MAX,
  PART_CONTENT_TYPE,
  PART_SEND_TIMEOUT_MS,
  PART_SEND_TRIES,
  partIdempotencyKey,
  SEND_GAP_MS,
} from '../moduleExportSending';
import { CODE_SHAPE } from '../moduleExportPolicy';
import { IDEMPOTENCY_KEY_MAX_LENGTH, SEND_TIMEOUT_MS_MAX, type SendEmailParams } from '@/lib/notifications/emailTransport';

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/consent/marketingGate', () => ({ marketingGate: { check: async () => ({ allowed: true }) } }));

const JOB = '66666666-6666-4666-8666-000000000001';
const email = { subject: 'Your data export: Clients (email 1 of 2)', html: '<p>x</p>', text: 'x' };

describe('the numbers (T-S1, T-S4)', () => {
  it('build cutoff < budget < maxDuration ≤ lease − 60', () => {
    const b = MODULE_EXPORT_SENDING_BOUNDS;
    expect(b.buildCutoffSeconds).toBeLessThan(b.budgetSeconds);
    expect(b.budgetSeconds).toBeLessThan(b.maxDurationSeconds);
    expect(b.maxDurationSeconds).toBeLessThanOrEqual(b.leaseSeconds - 60);
    // A fresh job claimed at the cutoff still has at least 180 s (D-10).
    expect(b.budgetSeconds - b.buildCutoffSeconds).toBeGreaterThanOrEqual(180);
  });

  it('the user answers: 7,000,000 bytes per email (BQ-42, decimal), at most 10 emails (BQ-28)', () => {
    expect(PART_BYTES_MAX).toBe(7_000_000);
    expect(MAX_PARTS_PER_MODULE).toBe(10);
    // Base64 of a full part stays under 10,000,000 bytes.
    expect(Math.ceil(PART_BYTES_MAX / 3) * 4).toBeLessThan(10_000_000);
  });

  it('sending: 600 ms apart, 3 tries, timeouts inside what the transport accepts and inside the budget', () => {
    expect(SEND_GAP_MS).toBe(600);
    expect(PART_SEND_TRIES).toBe(3);
    expect(PART_SEND_TIMEOUT_MS).toBe(45_000);
    expect(NOTICE_SEND_TIMEOUT_MS).toBe(10_000);
    expect(PART_SEND_TIMEOUT_MS).toBeLessThanOrEqual(SEND_TIMEOUT_MS_MAX);
    expect(PART_SEND_TIMEOUT_MS / 1000).toBeLessThan(MODULE_EXPORT_SENDING_BOUNDS.budgetSeconds - BUILD_CLAIM_CUTOFF_SECONDS);
  });

  it('every failure and retry code fits the SQL code shape', () => {
    for (const value of [...Object.values(MODULE_JOB_FAILURE_CODES), ...Object.values(MODULE_JOB_RETRY_CODES)]) expect(value).toMatch(CODE_SHAPE);
    expect(MODULE_JOB_FAILURE_CODES.REQUEST_MISMATCH).toBe('request_mismatch');
  });
});

describe('the keys (T-S2, T-S3)', () => {
  it('export:{id}:{n} and export-notice:{id}, inside Resend\'s 256 characters', () => {
    expect(partIdempotencyKey(JOB, 1)).toBe(`export:${JOB}:1`);
    expect(partIdempotencyKey(JOB, 10)).toBe(`export:${JOB}:10`);
    expect(noticeIdempotencyKey(JOB)).toBe(`export-notice:${JOB}`);
    expect(noticeIdempotencyKey(JOB).length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
  });

  it.each([[0], [11], [1.5], [Number.NaN]])('a part number of %p throws', (n) => {
    expect(() => partIdempotencyKey(JOB, n)).toThrow(RangeError);
  });

  it('a job id that is not a uuid throws (a key never carries free text)', () => {
    expect(() => noticeIdempotencyKey('owner@example.com')).toThrow(RangeError);
    expect(() => partIdempotencyKey('x', 1)).toThrow(RangeError);
  });

  it('SA C-4: the owner-facts key is by user AND request', () => {
    const userA = '11111111-1111-4111-8111-111111111111';
    const userB = '22222222-2222-4222-8222-222222222222';
    const request = '55555555-5555-4555-8555-555555555555';
    expect(ownerFactsKey(userA, request)).not.toBe(ownerFactsKey(userB, request));
  });
});

describe('the payloads (SA Q-3, C-3, C-8)', () => {
  const csvBytes = Buffer.from('a,b\r\n', 'utf8');
  const partSend = () =>
    buildPartSend({ to: 'owner@example.com', from: 'notifications@agentspilot.ai', email, jobId: JOB, n: 2, fileName: 'clients_2026-10-28_part-2-of-3.csv', csvBytes });

  it('a part payload: transactional, one recipient, keyed, timed out by the transport, recipient redacted in logs', () => {
    const p = partSend();
    expect(p).toEqual({
      kind: 'transactional',
      to: ['owner@example.com'],
      from: 'notifications@agentspilot.ai',
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{ filename: 'clients_2026-10-28_part-2-of-3.csv', content: csvBytes, contentType: PART_CONTENT_TYPE }],
      idempotencyKey: `export:${JOB}:2`,
      timeoutMs: PART_SEND_TIMEOUT_MS,
      redactRecipientInLogs: true,
    });
    // It is a SendEmailParams as it stands: no copy, no cast, at the call site.
    const asParams: SendEmailParams = p;
    expect(asParams.redactRecipientInLogs).toBe(true);
  });

  it('a notice payload: keyed export-notice, the notice timeout, no attachment, recipient redacted', () => {
    const p = buildNoticeSend({ to: 'owner@example.com', from: undefined, email, jobId: JOB });
    expect(p).toEqual({
      kind: 'transactional',
      to: ['owner@example.com'],
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `export-notice:${JOB}`,
      timeoutMs: NOTICE_SEND_TIMEOUT_MS,
      redactRecipientInLogs: true,
    });
    expect(p).not.toHaveProperty('from');
  });

  it('Q-3: a payload is frozen, so a re-send passes the same unchanged object', () => {
    const p = partSend();
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.to)).toBe(true);
    expect(Object.isFrozen(p.attachments)).toBe(true);
    expect(Object.isFrozen(p.attachments?.[0])).toBe(true);
    expect(() => {
      (p as { subject: string }).subject = 'changed';
    }).toThrow(TypeError);
  });

  it.each([[''], ['a@example.com, b@example.com'], ['a@example.com;b@example.com']])('refuses the recipient %p (exactly one address)', (to) => {
    expect(() => buildNoticeSend({ to, from: undefined, email, jobId: JOB })).toThrow(RangeError);
  });
});

describe('classifyKeyedSend', () => {
  it.each([
    ['accepted with an id', { sent: true, provider: 'resend', providerMessageId: 're_1' }, { outcome: 'accepted', resendId: 're_1' }],
    ['accepted, body unreadable', { sent: true, provider: 'resend' }, { outcome: 'accepted', resendId: null }],
    ['timeout', { sent: false, provider: 'resend', providerErrorCode: 'timeout' }, { outcome: 'retry', waitSeconds: 0 }],
    ['429 with retry-after', { sent: false, provider: 'resend', providerStatus: 429, retryAfterSeconds: 2 }, { outcome: 'retry', waitSeconds: 2 }],
    ['429 without retry-after', { sent: false, provider: 'resend', providerStatus: 429 }, { outcome: 'retry', waitSeconds: 1 }],
    ['409 concurrent', { sent: false, provider: 'resend', providerStatus: 409, providerErrorCode: 'concurrent_idempotent_requests' }, { outcome: 'retry', waitSeconds: 1 }],
    ['409 invalid key reuse', { sent: false, provider: 'resend', providerStatus: 409, providerErrorCode: 'invalid_idempotent_request' }, { outcome: 'key_conflict' }],
    ['500', { sent: false, provider: 'resend', providerStatus: 500 }, { outcome: 'retry', waitSeconds: 0 }],
    ['network error (no status)', { sent: false, provider: 'resend', error: 'resend: fetch failed' }, { outcome: 'retry', waitSeconds: 0 }],
    ['422 validation', { sent: false, provider: 'resend', providerStatus: 422, providerErrorCode: 'validation_error' }, { outcome: 'refused', reason: 'validation_error' }],
    ['403 without a name', { sent: false, provider: 'resend', providerStatus: 403 }, { outcome: 'refused', reason: 'http_403' }],
    ['.invalid recipient', { sent: false, provider: 'none', blocked: 'invalid_recipient' }, { outcome: 'refused', reason: 'invalid_recipient' }],
    ['no Resend in production', { sent: false, provider: 'none', error: 'idempotency_unsupported' }, { outcome: 'refused', reason: 'idempotency_unsupported' }],
    ['a bad key', { sent: false, provider: 'none', error: 'invalid_idempotency_key' }, { outcome: 'refused', reason: 'invalid_idempotency_key' }],
  ] as const)('%s', (_name, result, expected) => {
    expect(classifyKeyedSend(result)).toEqual(expected);
  });

  // MX-3a SA code review #1: outside production a keyed send may fall back to
  // SMTP; that transport's message id is not a Resend id and must not be stored.
  it('accepted via SMTP: the SMTP message id is not taken as a resend_id', () => {
    expect(classifyKeyedSend({ sent: true, provider: 'smtp', providerMessageId: '<abc@mail.example.com>' })).toEqual({
      outcome: 'accepted',
      resendId: null,
    });
  });

  it('accepted via Gmail: no resend_id', () => {
    expect(classifyKeyedSend({ sent: true, provider: 'gmail', providerMessageId: 'gmail-1' })).toEqual({ outcome: 'accepted', resendId: null });
  });

  it('accepted via Resend: the Resend id is kept', () => {
    expect(classifyKeyedSend({ sent: true, provider: 'resend', providerMessageId: 're_kept' })).toEqual({ outcome: 'accepted', resendId: 're_kept' });
  });
});
