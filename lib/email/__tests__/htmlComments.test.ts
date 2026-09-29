/**
 * `stripHtmlComments` (invite-only signup Slice 3a, T-3a-1; SA Q-7): every
 * developer comment goes, the Outlook conditional comments stay byte for byte.
 */

import { stripHtmlComments } from '../htmlComments';

const MSO = `<!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->`;

describe('stripHtmlComments', () => {
  it('removes a single-line comment', () => {
    expect(stripHtmlComments('<p>a</p><!-- Greeting --><p>b</p>')).toBe('<p>a</p><p>b</p>');
  });

  it('removes a multi-line comment, including one whose prose holds tags and ">"', () => {
    const html = `<tr>
  <!--
    Gmail rewrites <body> into a <div> -> so this note has markup in it.
  -->
  <td>x</td>
</tr>`;
    // Only the comment goes; the indentation before it stays.
    expect(stripHtmlComments(html)).toBe(['<tr>', '  ', '  <td>x</td>', '</tr>'].join('\n'));
  });

  it('removes several comments, leaving everything between them untouched', () => {
    expect(stripHtmlComments('a<!--1-->b<!-- 2 -->c<!---->d')).toBe('abcd');
  });

  it('keeps the hidden [if mso] block byte for byte, and removes a comment next to it', () => {
    const html = `<head>${MSO}<!-- note --></head>`;
    expect(stripHtmlComments(html)).toBe(`<head>${MSO}</head>`);
  });

  it('keeps a hidden conditional whose condition is not mso (e.g. [if gte mso 9])', () => {
    const html = '<!--[if gte mso 9]><v:rect>x</v:rect><![endif]-->';
    expect(stripHtmlComments(html)).toBe(html);
  });

  it('keeps the downlevel-revealed markers, and still strips a comment between them', () => {
    const html = '<!--[if !mso]><!--><div>for everyone else<!-- dev note --></div><!--<![endif]-->';
    expect(stripHtmlComments(html)).toBe('<!--[if !mso]><!--><div>for everyone else</div><!--<![endif]-->');
  });

  it('leaves comment-free HTML unchanged (the same string)', () => {
    const html = '<p style="color: #1a1a1a;">Hi -- there, a > b</p>';
    expect(stripHtmlComments(html)).toBe(html);
  });

  it('leaves an unterminated "<!--" alone rather than guessing where it ends', () => {
    const html = '<p>before</p><!-- never closed <p>after</p>';
    expect(stripHtmlComments(html)).toBe(html);
  });

  it('handles the empty string', () => {
    expect(stripHtmlComments('')).toBe('');
  });
});
