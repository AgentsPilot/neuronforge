/**
 * D12 — the Gmail executor must build proper multipart/alternative MIME (a text/plain
 * part AND a text/html part) whenever html_body is present, and must NOT discard a
 * supplied plaintext `body`. The text-only path (no html_body) must stay single-part
 * text/plain. buildEmailMessage is a private method with no instance-state deps beyond
 * this.mimeEncodeHeader (also on the prototype), so we exercise it via the prototype.
 */
import { GmailPluginExecutor } from '../gmail-plugin-executor';

// Decode Gmail's base64url raw output back into the MIME string.
function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function build(params: any): string {
  const instance = Object.create(GmailPluginExecutor.prototype);
  const raw = (instance as any).buildEmailMessage(params);
  return decodeRaw(raw);
}

describe('GmailPluginExecutor.buildEmailMessage — D12 multipart/alternative', () => {
  it('html_body + body → multipart/alternative with BOTH parts (body not discarded)', () => {
    const mime = build({
      recipients: { to: ['u@example.com'] },
      content: { subject: 'Hi', body: 'PLAINTEXT VERSION', html_body: '<p>HTML VERSION</p>' },
    });

    const boundaryMatch = mime.match(/multipart\/alternative; boundary="([^"]+)"/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch![1];

    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).toContain('Content-Type: text/html; charset=utf-8');
    // Supplied plaintext is used verbatim (NOT discarded, NOT derived from HTML).
    expect(mime).toContain('PLAINTEXT VERSION');
    expect(mime).toContain('<p>HTML VERSION</p>');
    // Proper opening and closing boundaries.
    expect(mime).toContain(`--${boundary}\r\n`);
    expect(mime).toContain(`--${boundary}--`);
    // Plaintext part precedes the HTML part (RFC 2046 preference order).
    expect(mime.indexOf('text/plain')).toBeLessThan(mime.indexOf('text/html'));
  });

  it('html_body only (no body) → text/plain part auto-generated from HTML', () => {
    const mime = build({
      recipients: { to: ['u@example.com'] },
      content: { subject: 'Hi', html_body: '<h1>Report</h1><p>All good</p>' },
    });

    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).toContain('Content-Type: text/html; charset=utf-8');
    // Derived plaintext contains the readable text, stripped of tags.
    expect(mime).toContain('Report');
    expect(mime).toContain('All good');
    expect(mime).toContain('<h1>Report</h1>'); // HTML part intact
  });

  it('empty body + html_body → still derives plaintext from HTML (empty treated as absent)', () => {
    const mime = build({
      recipients: { to: ['u@example.com'] },
      content: { subject: 'Hi', body: '   ', html_body: '<p>Fallback text</p>' },
    });

    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).toContain('Fallback text');
  });

  it('text-only (no html_body) → single-part text/plain, unchanged', () => {
    const mime = build({
      recipients: { to: ['u@example.com'] },
      content: { subject: 'Hi', body: 'just text' },
    });

    expect(mime).toContain('Content-Type: text/plain; charset=utf-8');
    expect(mime).not.toContain('multipart/alternative');
    expect(mime).not.toContain('text/html');
    expect(mime).toContain('just text');
  });

  it('preserves recipients/subject headers', () => {
    const mime = build({
      recipients: { to: ['a@example.com'], cc: ['c@example.com'] },
      content: { subject: 'Subject line', html_body: '<p>x</p>' },
    });
    expect(mime).toContain('To: a@example.com');
    expect(mime).toContain('Cc: c@example.com');
    expect(mime).toContain('Subject: Subject line');
    expect(mime).toContain('MIME-Version: 1.0');
  });
});
