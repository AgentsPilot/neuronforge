/**
 * The shared email escaper and the style-value checks (invite master doc §0.8
 * item #23, found during PR #171).
 *
 * Two things are pinned here: hostile input cannot leave the attribute or the
 * declaration it was written into, and every value the platform really sends
 * passes through unchanged.
 */
import { escapeHrefAttribute, escapeHtml } from '@/lib/email/escapeHtml';
import { safeCssColor, safeCssLength, safeFontName } from '@/lib/email/cssValues';
import {
  emailButton,
  emailOutlineButton,
  emailPalette,
  withSafeStyleValues,
  wrapInBrandedTemplate,
  type BrandingData,
} from '@/lib/email/templates/base-template';

const MALICIOUS_COLOR = 'red;background:url(x)';

describe('escapeHtml', () => {
  it('escapes all five characters, & first so nothing is escaped twice', () => {
    expect(escapeHtml(`Tom & "Jerry's" <b>`)).toBe('Tom &amp; &quot;Jerry&#39;s&quot; &lt;b&gt;');
  });

  it('leaves ordinary text, including Hebrew, alone', () => {
    expect(escapeHtml('Dana Studio')).toBe('Dana Studio');
    expect(escapeHtml('סטודיו דנה')).toBe('סטודיו דנה');
  });

  it('is the only copy: no template defines its own any more', () => {
    // A drifted private copy (consent-confirmation's skipped `'`) is why this exists.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync, readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path');
    const dir = join(process.cwd(), 'lib', 'email', 'templates');
    const withCopy = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /function escapeHtml\s*\(/.test(readFileSync(join(dir, file), 'utf8')));
    expect(withCopy).toEqual([]);
  });
});

describe('escapeHrefAttribute', () => {
  it('passes a valid URL through byte for byte, & included', () => {
    const url = 'https://pay.example.com/p?id=1&x=2#top';
    expect(escapeHrefAttribute(url)).toBe(url);
  });

  it('passes an already-escaped URL through unchanged (no double escaping)', () => {
    const escaped = escapeHtml('https://x.example.com/?a=1&b="2"');
    expect(escapeHrefAttribute(escaped)).toBe(escaped);
  });

  it('cannot close the attribute', () => {
    expect(escapeHrefAttribute('https://x.example.com/"><script>alert(1)</script>')).toBe(
      'https://x.example.com/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });
});

describe('safeCssColor', () => {
  it.each(['#4F46E5', '#fff', '#ffff', '#11223344', 'rgb(1, 2, 3)', 'rgba(10,20,30,0.5)', 'rgb(10%, 20%, 30%)'])(
    'accepts %s unchanged',
    (value) => {
      expect(safeCssColor(value, '#000000')).toBe(value);
    }
  );

  it.each([
    MALICIOUS_COLOR,
    '#fff;background:url(x)',
    '#fff" onmouseover="x',
    'red',
    'expression(alert(1))',
    'rgb(1,2,3);color:red',
    '#ggg',
  ])('replaces %s with the fallback', (value) => {
    expect(safeCssColor(value, '#4F46E5')).toBe('#4F46E5');
  });

  it('treats empty and missing like the old `value || default`', () => {
    expect(safeCssColor('', '#abc')).toBe('#abc');
    expect(safeCssColor(undefined, '#abc')).toBe('#abc');
    expect(safeCssColor(null, '#abc')).toBe('#abc');
  });
});

describe('safeCssLength', () => {
  it.each(['12px', '30px', '1.5rem', '50%', '0px'])('accepts %s', (value) => {
    expect(safeCssLength(value, '8px')).toBe(value);
  });

  it.each(['12px;background:url(x)', '12', 'calc(1px)', '12px"'])('replaces %s', (value) => {
    expect(safeCssLength(value, '8px')).toBe('8px');
  });
});

describe('safeFontName', () => {
  it.each(['Inter', 'Playfair Display', 'DM Serif Display', 'Open_Sans', 'Noto Sans Hebrew', 'פרנק ריהל'])(
    'leaves %s unchanged',
    (name) => {
      expect(safeFontName(name)).toBe(name);
    }
  );

  it('strips both kinds of quote and anything that could start markup or a declaration', () => {
    expect(safeFontName('Evil"Font')).toBe('EvilFont');
    expect(safeFontName("Evil'Font")).toBe('EvilFont');
    expect(safeFontName('x"; background:url(y); a:"')).toBe('x backgroundurly a');
    expect(safeFontName('</style><script>')).toBe('stylescript');
  });

  it('gives an empty string for nothing usable', () => {
    expect(safeFontName('"";')).toBe('');
    expect(safeFontName(undefined)).toBe('');
  });
});

describe('the shell and the helpers with hostile branding', () => {
  const hostile: BrandingData = {
    businessName: `Dana's "Best" <Studio> & Co`,
    primaryColor: MALICIOUS_COLOR,
    secondaryColor: MALICIOUS_COLOR,
    textColor: '#fff" onload="x',
    pageColor: MALICIOUS_COLOR,
    radius: '12px;background:url(x)',
    headingFont: 'Evil"Font',
    bodyFont: 'Body" onload="x',
  };

  it('escapes a business name with quotes everywhere it appears', () => {
    const html = wrapInBrandedTemplate('<p>hi</p>', hostile);
    expect(html).toContain('<title>Dana&#39;s &quot;Best&quot; &lt;Studio&gt; &amp; Co</title>');
    expect(html).not.toContain('"Best"');
    expect(html).not.toContain('<Studio>');
  });

  it('writes no malicious colour, radius or font into a style attribute', () => {
    const html = wrapInBrandedTemplate('<p>hi</p>', hostile);
    expect(html).not.toContain('url(x)');
    // No quote survives to open a new attribute (the font's letters stay, as text).
    expect(html).not.toContain('onload="');
    expect(html).not.toContain('#fff"');
    expect(html).toContain('background-color: #f5f5f5;');
    expect(html).toContain('border-radius: 12px;');
    // The font keeps its letters and loses the quote that used to close `style="…"`.
    expect(html).toContain("font-family: 'Body onloadx', -apple-system");
    expect(html).toContain('font-family: EvilFont, -apple-system');
  });

  it('the palette falls back for each bad value', () => {
    const palette = emailPalette(hostile);
    expect(palette.brand).toBe('#4F46E5');
    expect(palette.ink).toBe('#1a1a1a');
    expect(palette.radius).toBe('12px');
  });

  it('a button keeps its url inside the attribute and drops a bad colour', () => {
    const html = emailButton('Pay', 'https://x.example.com/"><img src=x>', {
      color: MALICIOUS_COLOR,
      backgroundColor: MALICIOUS_COLOR,
      branding: hostile,
    });
    expect(html).toContain('href="https://x.example.com/&quot;&gt;&lt;img src=x&gt;"');
    expect(html).not.toContain('url(x)');
    expect(html).toContain('background-color: #4F46E5;');

    const outline = emailOutlineButton('Cancel', 'https://x.example.com/c', { color: MALICIOUS_COLOR });
    expect(outline).toContain('border: 2px solid #4F46E5;');
    expect(outline).not.toContain('url(x)');
  });
});

describe('withSafeStyleValues', () => {
  const defaults = { primaryColor: '#4F46E5', secondaryColor: '#818CF8' };

  it('returns a valid themed branding unchanged', () => {
    const valid: BrandingData = {
      businessName: 'Studio',
      primaryColor: '#E11D48',
      secondaryColor: '#0EA5E9',
      headingFont: 'Playfair Display',
      bodyFont: 'Inter',
      onBrand: '#000000',
      pageColor: '#0b0b0f',
      surfaceColor: '#15151c',
      mutedSurfaceColor: '#1d1d26',
      borderColor: '#2a2a33',
      textColor: '#f5f5f5',
      mutedTextColor: '#a0a0b0',
      radius: '30px',
      buttonRadius: '20px',
      websiteUrl: 'https://studio.example.com',
      locale: 'he',
    };
    expect(withSafeStyleValues(valid, defaults)).toEqual(valid);
  });

  it('replaces the required colours with the defaults and drops bad optional values', () => {
    const safe = withSafeStyleValues(
      {
        businessName: 'Studio',
        primaryColor: MALICIOUS_COLOR,
        secondaryColor: 'blue',
        textColor: MALICIOUS_COLOR,
        radius: '1px;x:y',
        headingFont: '"";',
      },
      defaults
    );
    expect(safe.primaryColor).toBe('#4F46E5');
    expect(safe.secondaryColor).toBe('#818CF8');
    expect(safe.textColor).toBeUndefined();
    expect(safe.radius).toBeUndefined();
    expect(safe.headingFont).toBeUndefined();
  });
});
