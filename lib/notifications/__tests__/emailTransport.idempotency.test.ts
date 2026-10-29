/**
 * Module export MX-3a (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §6, §13.1 T-T1…T-T9;
 * SA Workplan Review 2026-10-28 Q-4 / C-8, Q-7): the S-10 idempotency key, the
 * keyed send's no-fallback rule, the result's status / retry-after / error
 * name, the abort timeout, and F-7 (no attachment filename in any log line).
 *
 * The first block is the SA gate for this slice: a send WITHOUT a key is
 * byte-for-byte what it was (the Resend request, the SMTP mail options, the
 * fallback order, the result and the log lines), apart from F-7.
 */

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => logged.push({ level, args });
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/consent/marketingGate', () => ({
  marketingGate: { check: async () => ({ allowed: true }) },
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

import { IDEMPOTENCY_KEY_MAX_LENGTH, sendEmail, type SendEmailParams } from '../emailTransport';

const ENV = { ...process.env };
const ADDRESS = 'owner@example.com';
const FILENAME = 'secret-client-name.csv';
const KEY = 'export:66666666-6666-4666-8666-000000000001:2';

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit]>;

function setEnv(opts: { resend?: boolean; smtp?: boolean; gmail?: boolean; production?: boolean }) {
  process.env = { ...ENV };
  for (const name of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME', 'SMTP_SECURE', 'GMAIL_USER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'VERCEL_ENV']) {
    delete process.env[name];
  }
  if (opts.resend) process.env.RESEND_API_KEY = 're_test_key';
  if (opts.smtp) Object.assign(process.env, { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'relay', SMTP_PASS: 'pw' });
  if (opts.gmail) Object.assign(process.env, { GMAIL_USER: 'sys@example.com', GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 't' });
  if (opts.production) process.env.VERCEL_ENV = 'production';
}

function fetchAnswering(status: number, body: string, headers: Record<string, string> = {}): FetchMock {
  const mock: FetchMock = jest.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string): string | null => headers[name.toLowerCase()] ?? null },
    text: async () => body,
    json: async (): Promise<unknown> => JSON.parse(body),
  }));
  (global as unknown as { fetch: unknown }).fetch = mock;
  return mock;
}

const base: SendEmailParams = {
  kind: 'transactional',
  to: [ADDRESS],
  subject: 'Your data export: Clients (email 2 of 3)',
  html: '<p>Attached</p>',
  text: 'Attached',
  from: 'notifications@agentspilot.ai',
};
const withAttachment: SendEmailParams = {
  ...base,
  attachments: [{ filename: FILENAME, content: Buffer.from('a,b\r\n1,2\r\n', 'utf8'), contentType: 'text/csv; charset=utf-8' }],
};

beforeEach(() => {
  logged.length = 0;
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ messageId: '<smtp-1>', accepted: [ADDRESS], rejected: [] });
});

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

const messages = () => logged.map((entry) => entry.args[entry.args.length - 1]);

describe('T-T1 / T-T9: a send WITHOUT a key is unchanged (SA MX-3a gate)', () => {
  it('the Resend request is exactly the old request: same URL, method, headers and body; no key header, no signal', async () => {
    setEnv({ resend: true });
    const fetchMock = fetchAnswering(200, '{"id":"re_1"}');
    const result = await sendEmail(withAttachment);
    expect(result).toEqual({ sent: true, provider: 'resend', providerMessageId: 're_1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    // Key order and every key, as the request was built before MX-3a.
    expect(Object.keys(init)).toEqual(['method', 'headers', 'body']);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json' });
    expect(init.body).toBe(
      JSON.stringify({
        from: 'notifications@agentspilot.ai',
        to: [ADDRESS],
        subject: base.subject,
        html: base.html,
        text: 'Attached',
        attachments: [{ filename: FILENAME, content: Buffer.from('a,b\r\n1,2\r\n', 'utf8').toString('base64'), type: 'text/csv; charset=utf-8' }],
      })
    );
  });

  it('a Resend 500 still falls back to SMTP, with the same SMTP mail options as before, and the old result', async () => {
    setEnv({ resend: true, smtp: true });
    fetchAnswering(500, '{"name":"internal_server_error"}');
    const result = await sendEmail(withAttachment);
    expect(result).toEqual({ sent: true, provider: 'smtp', providerMessageId: '<smtp-1>' });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0]).toEqual({
      from: 'notifications@agentspilot.ai',
      to: ADDRESS,
      subject: base.subject,
      html: base.html,
      text: 'Attached',
      headers: {},
      attachments: [{ filename: FILENAME, content: expect.any(Buffer), contentType: 'text/csv; charset=utf-8' }],
    });
    expect(messages()).toContain('Resend send failed — trying next transport');
  });

  it('T-T9: an un-keyed 429 keeps the old fallback, and its result gains no new field', async () => {
    setEnv({ resend: true, smtp: true });
    fetchAnswering(429, '{"name":"rate_limit_exceeded"}', { 'retry-after': '3' });
    const result = await sendEmail(base);
    expect(result).toEqual({ sent: true, provider: 'smtp', providerMessageId: '<smtp-1>' });

    setEnv({ resend: true });
    fetchAnswering(429, '{"name":"rate_limit_exceeded"}', { 'retry-after': '3' });
    const failed = await sendEmail(base);
    expect(Object.keys(failed).sort()).toEqual(['error', 'provider', 'sent']);
    expect(failed).toMatchObject({ sent: false, provider: 'none' });
    expect(failed.error).toContain('Resend API error (429)');
  });

  it('the log lines of an un-keyed send are the old lines: same messages, the attempt line has no idempotencyKey', async () => {
    setEnv({ resend: true });
    fetchAnswering(200, '{"id":"re_1"}');
    await sendEmail(withAttachment);
    expect(messages()).toEqual(['Attempting to send email', 'Preparing attachment for Resend', 'Email sent']);
    const attempt = logged.find((entry) => entry.args[1] === 'Attempting to send email')?.args[0] as Record<string, unknown>;
    expect(Object.keys(attempt)).toEqual([
      'to',
      'subject',
      'hasAttachments',
      'attachmentCount',
      'attachmentDetails',
      'resendConfigured',
      'smtpConfigured',
      'gmailConfigured',
    ]);
    expect(attempt.attachmentDetails).toEqual([{ contentType: 'text/csv; charset=utf-8', size: 10 }]);
  });
});

describe('T-T2…T-T6: a keyed send', () => {
  it('T-T2: the Resend call carries Idempotency-Key, and the body is unchanged', async () => {
    setEnv({ resend: true });
    const fetchMock = fetchAnswering(200, '{"id":"re_9"}');
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toEqual({ sent: true, provider: 'resend', providerMessageId: 're_9' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json', 'Idempotency-Key': KEY });
    expect(JSON.parse(init.body as string)).not.toHaveProperty('idempotencyKey');
    // §6 T-6: the key (ids only) is on the attempt line.
    const attempt = logged.find((entry) => entry.args[1] === 'Attempting to send email')?.args[0] as Record<string, unknown>;
    expect(attempt.idempotencyKey).toBe(KEY);
  });

  it('T-T3: Resend 500 → sent false, provider resend, providerStatus 500; SMTP and Gmail never called', async () => {
    setEnv({ resend: true, smtp: true, gmail: true });
    fetchAnswering(500, '{"name":"internal_server_error","message":"boom"}');
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toMatchObject({ sent: false, provider: 'resend', providerStatus: 500, providerErrorCode: 'internal_server_error' });
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(messages()).toContain('Resend keyed send failed — no fallback for a keyed send');
  });

  it('T-T4: Resend 429 with retry-after 3 → providerStatus 429, retryAfterSeconds 3, no fallback', async () => {
    setEnv({ resend: true, smtp: true });
    fetchAnswering(429, '{"name":"rate_limit_exceeded"}', { 'retry-after': '3' });
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toMatchObject({ sent: false, provider: 'resend', providerStatus: 429, retryAfterSeconds: 3 });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it.each([['Mon, 27 Oct 2026 10:00:00 GMT'], ['1.5'], ['soon']])('a retry-after of %p is unparseable → undefined', async (value) => {
    setEnv({ resend: true });
    fetchAnswering(429, '{}', { 'retry-after': value });
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result.retryAfterSeconds).toBeUndefined();
    expect(result.providerStatus).toBe(429);
  });

  it.each([['concurrent_idempotent_requests'], ['invalid_idempotent_request']])('T-T5: a 409 %s carries its name in providerErrorCode', async (name) => {
    setEnv({ resend: true, smtp: true });
    fetchAnswering(409, JSON.stringify({ statusCode: 409, name, message: 'key reused' }));
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toMatchObject({ sent: false, provider: 'resend', providerStatus: 409, providerErrorCode: name });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('a non-code error name is not returned (codes only, never text)', async () => {
    setEnv({ resend: true });
    fetchAnswering(422, JSON.stringify({ name: 'Bad thing for owner@example.com' }));
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result.providerErrorCode).toBeUndefined();
    expect(result.providerStatus).toBe(422);
  });

  it.each([[''], ['k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)]])('T-T6: a key of length %#… is refused before fetch', async (key) => {
    setEnv({ resend: true, smtp: true });
    const fetchMock = fetchAnswering(200, '{"id":"re_1"}');
    const result = await sendEmail({ ...base, idempotencyKey: key });
    expect(result).toEqual({ sent: false, provider: 'none', error: 'invalid_idempotency_key' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('a key of exactly 256 characters is accepted', async () => {
    setEnv({ resend: true });
    fetchAnswering(200, '{"id":"re_1"}');
    expect((await sendEmail({ ...base, idempotencyKey: 'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH) })).sent).toBe(true);
  });
});

describe('T-T7: a keyed send with Resend not configured (SA Q-7)', () => {
  it('outside production: SMTP sends, with one idempotency_unsupported warn', async () => {
    setEnv({ smtp: true });
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toEqual({ sent: true, provider: 'smtp', providerMessageId: '<smtp-1>' });
    const warns = logged.filter((entry) => entry.level === 'warn' && String(entry.args[1]).includes('idempotency_unsupported'));
    expect(warns).toHaveLength(1);
  });

  it('in production: refused with idempotency_unsupported, SMTP and Gmail never called', async () => {
    setEnv({ smtp: true, gmail: true, production: true });
    const result = await sendEmail({ ...base, idempotencyKey: KEY });
    expect(result).toEqual({ sent: false, provider: 'none', error: 'idempotency_unsupported' });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('in production an UN-keyed send without Resend still falls back as before', async () => {
    setEnv({ smtp: true, production: true });
    expect(await sendEmail(base)).toEqual({ sent: true, provider: 'smtp', providerMessageId: '<smtp-1>' });
  });
});

describe('timeoutMs: the transport aborts the Resend request (SA C-8 / Q-4)', () => {
  function fetchHanging(): FetchMock {
    const mock: FetchMock = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );
    (global as unknown as { fetch: unknown }).fetch = mock;
    return mock;
  }

  it('keyed: an abort is sent false, providerErrorCode timeout, no fallback; the request carried a signal', async () => {
    setEnv({ resend: true, smtp: true });
    const fetchMock = fetchHanging();
    const result = await sendEmail({ ...base, idempotencyKey: KEY, timeoutMs: 20 });
    expect(result).toMatchObject({ sent: false, provider: 'resend', providerErrorCode: 'timeout' });
    expect(result.providerStatus).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('un-keyed: an abort is a Resend failure like any other, and SMTP is tried', async () => {
    setEnv({ resend: true, smtp: true });
    fetchHanging();
    const result = await sendEmail({ ...base, timeoutMs: 20 });
    expect(result).toEqual({ sent: true, provider: 'smtp', providerMessageId: '<smtp-1>' });
  });

  it('a send that answers in time is not aborted, and the timer is cleared', async () => {
    setEnv({ resend: true });
    jest.useFakeTimers();
    try {
      fetchAnswering(200, '{"id":"re_1"}');
      const result = await sendEmail({ ...base, idempotencyKey: KEY, timeoutMs: 45_000 });
      expect(result.sent).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([[0], [-5], [1.5], [300_001]])('a timeoutMs of %p is refused before fetch', async (timeoutMs) => {
    setEnv({ resend: true });
    const fetchMock = fetchAnswering(200, '{"id":"re_1"}');
    expect(await sendEmail({ ...base, idempotencyKey: KEY, timeoutMs })).toEqual({ sent: false, provider: 'none', error: 'invalid_timeout_ms' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('T-T8 / F-7: no transport log line holds an attachment filename', () => {
  it.each([
    ['Resend', { resend: true }],
    ['SMTP', { smtp: true }],
    ['Gmail', { gmail: true }],
  ] as const)('the %s path', async (_name, env) => {
    setEnv(env);
    fetchAnswering(200, '{"id":"re_1"}');
    const result = await sendEmail(withAttachment);
    expect(result.sent).toBe(true);
    expect(logged.length).toBeGreaterThan(1);
    expect(JSON.stringify(logged)).not.toContain(FILENAME);
    expect(JSON.stringify(logged)).not.toContain('secret-client-name');
  });

  it('the file still goes out under its name (F-7 changes logs only)', async () => {
    setEnv({ smtp: true });
    await sendEmail(withAttachment);
    expect(mockSendMail.mock.calls[0][0].attachments[0].filename).toBe(FILENAME);
  });
});
