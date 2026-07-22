/**
 * D12 follow-up — after the broken PDF branch (generatePDF stub → empty attachment)
 * was removed, EVERY sendEmailDraft call must go through the working
 * multipart/alternative (text/plain + text/html) send, including when the legacy
 * `includePdf` flag is still passed by callers.
 */
jest.mock('@/lib/plugins/helpers/getPluginConnection', () => ({
  getPluginConnection: jest.fn().mockResolvedValue({ access_token: 'tok_123' }),
}));

import { sendEmailDraft } from '../sendEmailDraft';

// Decode Gmail's base64url raw back into the MIME string.
function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function lastSentMime(fetchMock: jest.Mock): string {
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  return decodeRaw(body.raw);
}

describe('sendEmailDraft — D12 multipart/alternative (PDF branch removed)', () => {
  afterEach(() => jest.clearAllMocks());

  it('sends multipart/alternative with both a text/plain and text/html part', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'm1' }) });
    (global as any).fetch = fetchMock;

    await sendEmailDraft({ userId: 'u1', to: 'a@example.com', subject: 'Hi', body: 'line one\nline two' });

    const mime = lastSentMime(fetchMock);
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime).toContain('line one'); // plaintext body verbatim
    expect(mime).toContain('<html>'); // wrapped HTML part
    expect(mime.indexOf('text/plain')).toBeLessThan(mime.indexOf('text/html'));
    expect(mime).not.toContain('application/pdf'); // dead PDF branch gone
  });

  it('still sends a normal multipart email when the legacy includePdf flag is passed', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'm2' }) });
    (global as any).fetch = fetchMock;

    await sendEmailDraft({ userId: 'u1', to: 'a@example.com', subject: 'Hi', body: 'x', includePdf: true });

    const mime = lastSentMime(fetchMock);
    expect(mime).toContain('multipart/alternative');
    expect(mime).not.toContain('multipart/mixed');
    expect(mime).not.toContain('application/pdf');
  });

  it('throws when Gmail responds not-ok', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, text: async () => 'bad request' });
    (global as any).fetch = fetchMock;

    await expect(
      sendEmailDraft({ userId: 'u1', to: 'a@example.com', subject: 'Hi', body: 'x' })
    ).rejects.toThrow('Failed to send email: bad request');
  });
});
