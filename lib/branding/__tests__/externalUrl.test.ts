import { safeExternalUrl } from '../externalUrl';

describe('safeExternalUrl', () => {
  describe('what must never reach an href', () => {
    // The reason this function exists: the value is owner-typed text that ends
    // up in a link on a customer-facing page.
    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ])('drops %s', value => {
      expect(safeExternalUrl(value)).toBeNull();
    });

    it('treats a bare host:port as a scheme and drops it', () => {
      // The regex cannot tell `example.co.il:8080` from `javascript:alert(1)`
      // without deciding what counts as a scheme, and getting that wrong in the
      // permissive direction is the one failure that matters here. A business
      // website on an explicit port is vanishingly rare; admitting an unknown
      // scheme is not. See the note in externalUrl.ts.
      expect(safeExternalUrl('example.co.il:8080')).toBeNull();
    });
  });

  describe('what a person actually types', () => {
    it('upgrades a bare domain to https rather than refusing it', () => {
      expect(safeExternalUrl('example.com')).toBe('https://example.com/');
    });

    it('keeps an explicit http, which plenty of small sites still are', () => {
      expect(safeExternalUrl('http://example.com')).toBe('http://example.com/');
    });

    it('keeps a path, query and fragment intact', () => {
      expect(safeExternalUrl('https://example.com/a/b?c=1#d')).toBe('https://example.com/a/b?c=1#d');
    });

    it('trims surrounding whitespace', () => {
      expect(safeExternalUrl('  https://example.com  ')).toBe('https://example.com/');
    });

    it('does not let a protocol-relative value inherit the page scheme', () => {
      expect(safeExternalUrl('//evil.example')).toBe('https://evil.example/');
    });

    it('accepts an explicit scheme with a port', () => {
      expect(safeExternalUrl('https://example.co.il:8080')).toBe('https://example.co.il:8080/');
    });

    it('normalises a triple slash rather than rejecting it', () => {
      // `new URL` reads this as host "nowhere"; it is a valid https link, just
      // an odd way to type one.
      expect(safeExternalUrl('https:///nowhere')).toBe('https://nowhere/');
    });
  });

  describe('nothing to show', () => {
    it.each([null, undefined, '', '   '])('returns null for %p', value => {
      expect(safeExternalUrl(value)).toBeNull();
    });

    it('returns null rather than throwing on unparseable text', () => {
      expect(safeExternalUrl('http://')).toBeNull();
    });
  });
});
