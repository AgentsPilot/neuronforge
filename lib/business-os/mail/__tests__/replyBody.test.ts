/**
 * What may and may not reach a client's inbox.
 *
 * This module exists so the server never parses HTML it did not write. These
 * tests are the proof of that claim: every one asks whether the owner's own
 * text can become markup, or whether a link can become something other than a
 * link.
 */

import { renderHtml, renderText, safeHref, escapeHtml, isEmpty } from '../replyBody';

describe('rendering a reply', () => {
  it('escapes text so nothing the owner types becomes markup', () => {
    const html = renderHtml([
      { type: 'p', runs: [{ text: '<script>alert(1)</script> & "quotes" and 5 > 3' }] },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('escapes before wrapping, so a mark cannot smuggle a tag', () => {
    const html = renderHtml([{ type: 'p', runs: [{ text: '</strong><img src=x onerror=1>', bold: true }] }]);
    expect(html).toBe('<p><strong>&lt;/strong&gt;&lt;img src=x onerror=1&gt;</strong></p>');
  });

  describe('links', () => {
    it.each([
      ['javascript:alert(1)'],
      ['JaVaScRiPt:alert(1)'],
      ['data:text/html;base64,PHNjcmlwdD4='],
      ['vbscript:msgbox'],
      ['file:///etc/passwd'],
      ['not a url at all'],
      [''],
    ])('refuses %s', bad => {
      expect(safeHref(bad)).toBeUndefined();
      const html = renderHtml([{ type: 'p', runs: [{ text: 'click', href: bad }] }]);
      expect(html).toBe('<p>click</p>');
      expect(html).not.toContain('href');
    });

    it('keeps http and https, and marks them rel="noopener noreferrer"', () => {
      const html = renderHtml([
        { type: 'p', runs: [{ text: 'פגישת היכרות', href: 'https://app.example.com/c/vnfh7w/book?service=28275513' }] },
      ]);
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('href="https://app.example.com/c/vnfh7w/book?service=28275513"');
      expect(html).toContain('פגישת היכרות');
    });

    it('cannot let an address close its own attribute', () => {
      const html = renderHtml([{ type: 'p', runs: [{ text: 'x', href: 'https://e.com/?a="><b>' }] }]);
      /*
       * Two guards in series, and the FIRST one is why there is no `&quot;`
       * here: `new URL()` percent-encodes the quote and the angle brackets
       * before `escapeHtml` is ever reached. Asserting on the escaped entity
       * was asserting on the weaker of the two.
       */
      expect(html).toContain('%22');
      expect(html).not.toContain('<b>');
      expect(html).toMatch(/^<p><a href="[^"]*" rel="noopener noreferrer">x<\/a><\/p>$/);
    });
  });

  it('gathers consecutive list items into one list', () => {
    const html = renderHtml([
      { type: 'p', runs: [{ text: 'Options:' }] },
      { type: 'li', list: 'ul', runs: [{ text: 'one' }] },
      { type: 'li', list: 'ul', runs: [{ text: 'two' }] },
      { type: 'p', runs: [{ text: 'after' }] },
    ]);
    expect(html).toBe('<p>Options:</p><ul><li>one</li><li>two</li></ul><p>after</p>');
  });

  it('closes a list before starting a different kind', () => {
    const html = renderHtml([
      { type: 'li', list: 'ul', runs: [{ text: 'a' }] },
      { type: 'li', list: 'ol', runs: [{ text: 'b' }] },
    ]);
    expect(html).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('keeps a deliberate blank line', () => {
    expect(renderHtml([{ type: 'p', runs: [] }])).toBe('<p><br></p>');
  });

  describe('the plain-text half', () => {
    it('says the same thing, with the address spelled out', () => {
      const blocks = [
        { type: 'p' as const, runs: [{ text: 'Book here: ' }, { text: 'פגישת היכרות', href: 'https://e.com/book' }] },
      ];
      expect(renderText(blocks)).toBe('Book here: פגישת היכרות (https://e.com/book)');
    });

    it('does not print an address twice when it is already the text', () => {
      expect(renderText([{ type: 'p', runs: [{ text: 'https://e.com/book', href: 'https://e.com/book' }] }]))
        .toBe('https://e.com/book');
    });

    it('drops an address it would not have linked', () => {
      expect(renderText([{ type: 'p', runs: [{ text: 'click', href: 'javascript:alert(1)' }] }])).toBe('click');
    });

    it('marks list items', () => {
      expect(renderText([{ type: 'li', list: 'ul', runs: [{ text: 'one' }] }])).toBe('• one');
    });
  });

  it('knows when there is nothing to send', () => {
    expect(isEmpty([{ type: 'p', runs: [] }])).toBe(true);
    expect(isEmpty([{ type: 'p', runs: [{ text: '   ' }] }])).toBe(true);
    expect(isEmpty([{ type: 'p', runs: [{ text: 'hi' }] }])).toBe(false);
  });

  it('escapeHtml covers every character that can start markup', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
