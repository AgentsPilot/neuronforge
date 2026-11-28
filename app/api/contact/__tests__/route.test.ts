/**
 * POST /api/contact (contact inbox standard): the public contact form.
 * It validates input, is rate limited, saves the message, and sends one
 * notification to the team inbox through the shared transport. The limiter,
 * the repository and the transport are mocked; nothing reaches the network.
 */

import { NextRequest } from 'next/server';

const mockLogged: unknown[][] = [];
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => mockLogged.push(args);
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  RATE_LIMITS: { create: { limit: 10, failureLimit: 10, windowSeconds: 900 } },
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
  tooManyRequests: (windowSeconds: number) =>
    new Response(JSON.stringify({ success: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(windowSeconds) },
    }),
}));

const mockCreate = jest.fn();
const mockMarkSent = jest.fn();
jest.mock('@/lib/repositories/ContactMessagesRepository', () => ({
  contactMessagesRepository: {
    createFromContactForm: (...args: unknown[]) => mockCreate(...args),
    markEmailSent: (...args: unknown[]) => mockMarkSent(...args),
  },
}));

const mockSendEmail = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { POST } from '../route';
import { CONTACT_FORM_INBOX } from '@/lib/business-os/supportContact';

const VISITOR = 'visitor.person@customer.example';
const VALID = { name: 'Visitor', email: VISITOR, message: 'Hello there\nSecond line <b>' };

function post(body: unknown, raw?: string) {
  return POST(
    new NextRequest('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  mockLogged.length = 0;
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockCreate.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
  mockMarkSent.mockResolvedValue({ data: true, error: null });
  mockSendEmail.mockResolvedValue({ sent: true, provider: 'resend' });
});

afterEach(() => jest.clearAllMocks());

describe('POST /api/contact', () => {
  it('saves the message and sends one notification to the team inbox', async () => {
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      emailSent: true,
      message: "Thanks Visitor! We've received your message and will get back to you soon.",
    });

    expect(mockCreate).toHaveBeenCalledWith({ name: 'Visitor', email: VISITOR, message: VALID.message });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [params] = mockSendEmail.mock.calls[0];
    expect(params).toMatchObject({
      kind: 'transactional',
      to: [CONTACT_FORM_INBOX],
      replyTo: VISITOR,
      subject: 'New contact form message',
    });
    expect(mockMarkSent).toHaveBeenCalledWith('msg-1');
  });

  it('sends nothing to the submitted address', async () => {
    await post(VALID);
    for (const [params] of mockSendEmail.mock.calls) {
      expect((params as { to: string[] }).to).toEqual([CONTACT_FORM_INBOX]);
    }
  });

  it('escapes the submitted text in the notification and keeps the line breaks', async () => {
    await post(VALID);
    const { html, subject } = mockSendEmail.mock.calls[0][0] as { html: string; subject: string };
    expect(html).toContain('Hello there<br>Second line &lt;b&gt;');
    expect(subject).not.toContain('Visitor');
  });

  it('counts the request against the contact-form allowance before reading the body', async () => {
    await post(VALID);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), 'contact-form', {
      limit: 10,
      failureLimit: 10,
      windowSeconds: 900,
    });
  });

  it('throttles after the allowance: 429, nothing saved or sent', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 11, degraded: false });
    const response = await post(VALID);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('900');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing field', { name: 'Visitor', email: VISITOR }],
    ['an invalid email', { ...VALID, email: 'nope' }],
    ['an over-long message', { ...VALID, message: 'a'.repeat(5001) }],
    ['a blank name', { ...VALID, name: '   ' }],
  ])('validates input: %s is a 400, nothing saved or sent', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toMatchObject({ success: false, error: 'Invalid input' });
    expect(json.details).toBeUndefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('validates input: a body that is not JSON is a 400', async () => {
    const response = await post(null, '{not json');
    expect(response.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 500 when the message cannot be saved, and sends nothing', async () => {
    mockCreate.mockResolvedValue({ data: null, error: new Error('db down') });
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to save message' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('answers 200 with emailSent false when the notification is not delivered', async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none', blocked: 'recipient_not_allowlisted' });
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect((await response.json()).emailSent).toBe(false);
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  it('never writes the submitted address or text to a log line', async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none' });
    await post(VALID);
    const logged = JSON.stringify(mockLogged);
    expect(logged).not.toContain('customer.example');
    expect(logged).not.toContain('Hello there');
  });
});
