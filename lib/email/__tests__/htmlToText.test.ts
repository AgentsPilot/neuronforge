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
