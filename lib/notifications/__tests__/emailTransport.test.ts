/**
 * D9 — the transport must send proper multipart/alternative (HTML + plaintext).
 * A caller that supplies ONLY `html` must still produce both a `html` and a
 * non-empty `text` part on every provider (Resend + nodemailer).
 */

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'x' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail: mockSendMail })) },
}));

import { sendEmail, htmlToText } from '../emailTransport';

const HTML =
  '<!DOCTYPE html><html><head><style>.x{color:red}</style></head>' +
  '<body><h1>Calibration passed</h1><p>Vendor: Wolt &amp; Expedia</p>' +
  '<br><div>All set</div></body></html>';

const ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ENV };
  jest.clearAllMocks();
});

describe('htmlToText (D9 plaintext generation)', () => {
  it('strips tags/style and decodes entities into readable text', () => {
    const text = htmlToText(HTML);
    expect(text).toContain('Calibration passed');
    expect(text).toContain('Vendor: Wolt & Expedia');
    expect(text).toContain('All set');
    expect(text).not.toContain('<');
    expect(text).not.toContain('color:red'); // <style> content removed
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('sendEmail — Resend path sends both html and text', () => {
  it('auto-generates a text part when the caller supplies only html', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;

    const result = await sendEmail({ to: ['u@example.com'], subject: 'Result', html: HTML });

    expect(result).toEqual({ sent: true, provider: 'resend' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toBe(HTML);
    expect(typeof body.text).toBe('string');
    expect(body.text.length).toBeGreaterThan(0);
    expect(body.text).toContain('Calibration passed');
  });

  it('honors a caller-supplied text part verbatim', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    (global as any).fetch = fetchMock;

    await sendEmail({ to: ['u@example.com'], subject: 'Result', html: HTML, text: 'CUSTOM PLAINTEXT' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('CUSTOM PLAINTEXT');
  });
});

describe('sendEmail — nodemailer path sends both html and text', () => {
  it('passes both parts to sendMail (Resend not configured)', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.GMAIL_USER = 'sys@example.com';
    process.env.GMAIL_CLIENT_ID = 'id';
    process.env.GMAIL_CLIENT_SECRET = 'secret';
    process.env.GMAIL_REFRESH_TOKEN = 'refresh';

    const result = await sendEmail({ to: ['u@example.com'], subject: 'Result', html: HTML });

    expect(result).toEqual({ sent: true, provider: 'gmail' });
    const arg = mockSendMail.mock.calls[0][0];
    expect(arg.html).toBe(HTML);
    expect(typeof arg.text).toBe('string');
    expect(arg.text.length).toBeGreaterThan(0);
    expect(arg.text).toContain('Calibration passed');
  });
});
