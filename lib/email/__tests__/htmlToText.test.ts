/**
 * D12 — the shared htmlToText util (extracted from D9's emailTransport). These
 * mirror the D9 assertions so behavior is proven unchanged after extraction, plus
 * a few edge cases the multipart senders rely on.
 */
import { htmlToText } from '../htmlToText';

const HTML =
  '<!DOCTYPE html><html><head><style>.x{color:red}</style></head>' +
  '<body><h1>Calibration passed</h1><p>Vendor: Wolt &amp; Expedia</p>' +
  '<br><div>All set</div></body></html>';

describe('htmlToText (shared util)', () => {
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

  it('returns empty string for undefined/null-ish input', () => {
    // @ts-expect-error — exercising the runtime guard callers depend on
    expect(htmlToText(undefined)).toBe('');
  });

  it('collapses excess whitespace and blank lines', () => {
    const text = htmlToText('<p>Line one</p>\n\n\n<p>Line two</p>');
    expect(text).toBe('Line one\n\nLine two');
  });

  it('turns <br> into newlines', () => {
    expect(htmlToText('a<br>b')).toBe('a\nb');
  });
});

/**
 * Comments are not body copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Found in a real send: a morning briefing whose plaintext part opened
 *
 *   "David KPMGinto a and several clients drop its styles outright, so content
 *    that sets no colour of its own — a plain paragraph composed in the chat,
 *    say — fell back to the client's default black…"
 *
 * That is a developer comment from the template. The tag strip is `<[^>]+>`,
 * which stops at the first `>` it meets, and the comment it was inside said
 * "Gmail rewrites <body> into a <div>" — so the match ended at `<body>` and
 * everything after it survived as text.
 *
 * Two reasons this matters beyond tidiness: the reader of a plaintext client
 * sees internal commentary, and a text part that does not correspond to the
 * HTML part is a signal spam filters score against.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('htmlToText — comments', () => {
  it('drops a comment whose prose contains a tag', () => {
    const html = `<p>Good morning, David</p>
      <!--
        The colour here, not only on the body element.
        Gmail rewrites <body> into a <div> and several clients drop its
        styles outright.
      -->
      <p>You have 1 appointment today.</p>`;

    const text = htmlToText(html);

    expect(text).toContain('Good morning, David');
    expect(text).toContain('You have 1 appointment today.');
    expect(text).not.toContain('Gmail rewrites');
    expect(text).not.toContain('into a');
    expect(text).not.toContain('styles outright');
  });

  it('drops conditional comments whole', () => {
    // `<!--[if mso]> … <![endif]-->` is the same shape and leaked the same way.
    const html = `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings>` +
      `<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->` +
      `<p>Your briefing</p>`;

    const text = htmlToText(html);

    expect(text).toBe('Your briefing');
    expect(text).not.toContain('PixelsPerInch');
  });

  it('leaves the visible copy alone', () => {
    const html = '<p>Money has not arrived today.</p><!-- a note --><p>No payments owed.</p>';

    expect(htmlToText(html)).toBe('Money has not arrived today.\nNo payments owed.');
  });
});
