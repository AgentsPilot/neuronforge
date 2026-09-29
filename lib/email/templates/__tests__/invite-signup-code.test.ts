/**
 * The sign-up code email (Slice 1b; L-2, R-9): three languages, right to left
 * for Hebrew, the code in the body and NEVER in the subject (the transport logs
 * subjects), and "ignore it if you did not ask".
 */

import { generateInviteSignupCodeEmail } from '../invite-signup-code';

const CODE = '048213';

describe('the sign-up code email', () => {
  it.each(['en', 'he', 'es'] as const)('%s: code in html and text, not in the subject', (locale) => {
    const email = generateInviteSignupCodeEmail({ code: CODE, validMinutes: 10, locale });
    expect(email.html).toContain(CODE);
    expect(email.text).toContain(CODE);
    expect(email.subject).not.toContain(CODE);
    expect(email.subject).not.toMatch(/[0-9]{6}/);
    expect(email.text).toContain('10');
  });

  it('English says what it is for and that ignoring it is safe', () => {
    const email = generateInviteSignupCodeEmail({ code: CODE, validMinutes: 10, locale: 'en' });
    expect(email.subject).toBe('Your AgentPilot sign-up code');
    expect(email.text).toContain('If you did not ask for this code, ignore this email');
  });

  it('Hebrew is right to left, with the code itself kept left to right', () => {
    const email = generateInviteSignupCodeEmail({ code: CODE, validMinutes: 10, locale: 'he' });
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain(`dir="ltr" style="margin: 0 0 16px; font-size: 32px`);
  });

  it('refuses anything that is not exactly six digits (no markup can be injected through the code)', () => {
    expect(() => generateInviteSignupCodeEmail({ code: '<b>1</b>', validMinutes: 10, locale: 'en' })).toThrow();
    expect(() => generateInviteSignupCodeEmail({ code: '12345', validMinutes: 10, locale: 'en' })).toThrow();
  });

  it('is platform-branded, never a business or an inviter', () => {
    const email = generateInviteSignupCodeEmail({ code: CODE, validMinutes: 10, locale: 'en' });
    expect(email.html).toContain('AgentPilot');
  });
});

/*
 * Slice 3a (T-3a-2, T-3a-3, T-3a-6; SA R-3): no developer comments in the sent
 * HTML except the Outlook conditional, and the AgentPilot wordmark only when
 * NEXT_PUBLIC_APP_URL is an https origin, with the text wordmark otherwise.
 */
describe('the sign-up code email: comments and the wordmark (Slice 3a)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
  const PROD = 'https://neuronforge-kohl.vercel.app';
  const MSO_BLOCK = /<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g;
  const render = (locale: 'en' | 'he' | 'es' = 'en') =>
    generateInviteSignupCodeEmail({ code: CODE, validMinutes: 10, locale });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
  });

  it.each(['en', 'he', 'es'] as const)('%s: the only "<!--" is the MSO conditional', (locale) => {
    for (const url of [PROD, undefined]) {
      if (url === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = url;
      const { html } = render(locale);
      expect(html.match(MSO_BLOCK)).toHaveLength(1);
      expect(html.replace(MSO_BLOCK, '')).not.toContain('<!--');
    }
  });

  it.each(['en', 'he', 'es'] as const)('%s, https: the wordmark with alt, width and height', (locale) => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const { html } = render(locale);
    expect(html).toContain(
      `<img src="${PROD}/images/brand/wordmark.png" alt="AgentPilot" width="154" height="28" style="display: inline-block; width: 154px; height: 28px;`
    );
    expect(html).toMatch(/<img [^>]*alt="AgentPilot"[^>]*font-size: 16px; font-weight: 600;/);
  });

  it.each([
    ['deleted', undefined],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('NEXT_PUBLIC_APP_URL %s: no image, the text wordmark instead', (_label, url) => {
    if (url === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = url;
    const { html } = render();
    expect(html).not.toContain('<img');
    expect(html).not.toContain('agentspilot.ai');
    expect(html).toMatch(/<span style="font-family:[^"]*font-size: 16px; font-weight: 600;[^"]*">\s*AgentPilot\s*<\/span>/);
  });

  it('the plain-text part is the same with or without the logo (T-3a-6)', () => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const withLogo = render();
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(render().text).toBe(withLogo.text);
  });
});
