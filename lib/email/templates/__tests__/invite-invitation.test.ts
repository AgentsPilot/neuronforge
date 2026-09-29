/**
 * The invitation email (Slice 2a; FR-15a, workplan §3.5, D-3, D-4, SA R-13):
 * three languages, right to left for Hebrew with the link kept left to right,
 * the admin's note escaped with its line breaks, the link in the body and
 * NEVER in the subject (the transport logs subjects), the fallback wording when
 * no inviter name is on record, and "ignore it if you were not expecting it".
 */

import { generateInviteInvitationEmail, type InviteInvitationEmailData } from '../invite-invitation';

const TOKEN = 'Abc_def-GHIjklMNOpqrSTUvwxYZ0123456789abcde';
const LINK = `https://app.example.com/invite#t=${TOKEN}`;

function data(overrides: Partial<InviteInvitationEmailData> = {}): InviteInvitationEmailData {
  return {
    inviterName: 'Dana Levi',
    personalNote: 'Hi!\nLooking forward to it.',
    planName: 'Founding Partner',
    offer: { kind: 'free', accessOpenEnded: false, accessMonths: 12 },
    linkUrl: LINK,
    linkExpiresAt: new Date('2026-10-31T23:30:00.000Z'),
    locale: 'en',
    ...overrides,
  };
}

describe('the invitation email', () => {
  it.each(['en', 'he', 'es'] as const)('%s: the link in html and text (button and plain), never in the subject', (locale) => {
    const email = generateInviteInvitationEmail(data({ locale }));
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.html.split(LINK).length - 1).toBe(2);
    expect(email.text).toContain(LINK);
    expect(email.subject).not.toContain(LINK);
    expect(email.subject).not.toContain(TOKEN);
    expect(email.subject).not.toMatch(/https?:|invite#/);
    expect(email.subject).toContain('Dana Levi');
  });

  it('English: subject, heading, note, offer, button, plain link, expiry and the safety line', () => {
    const email = generateInviteInvitationEmail(data());
    expect(email.subject).toBe('Dana Levi invited you to AgentPilot');
    expect(email.html).toContain('Dana Levi invited you to join AgentPilot');
    expect(email.html).toContain('A note from Dana Levi:');
    expect(email.html).toContain('Founding Partner');
    expect(email.html).toContain('Free · 12 months');
    expect(email.html).toContain('Accept your invitation');
    expect(email.html).toContain('Or paste this link into your browser:');
    expect(email.text).toContain('This invitation is valid until');
    expect(email.text).toContain('Not expecting this? You can ignore this email; nothing happens unless you sign up.');
  });

  it('Spanish copy', () => {
    const email = generateInviteInvitationEmail(data({ locale: 'es' }));
    expect(email.subject).toBe('Dana Levi te ha invitado a AgentPilot');
    expect(email.html).toContain('Aceptar tu invitación');
    expect(email.text).toContain('Esta invitación es válida hasta el');
  });

  it('Hebrew is right to left, with the plain link and the plan name kept left to right', () => {
    const email = generateInviteInvitationEmail(data({ locale: 'he' }));
    expect(email.subject).toBe('הזמנה מ־Dana Levi להצטרף ל־AgentPilot');
    expect(email.html).toContain('<div dir="rtl" style="text-align: right;">');
    expect(email.html).toMatch(new RegExp(`<p dir="ltr"[^>]*>${LINK.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')}</p>`));
    expect(email.html).toContain('<span dir="ltr">Founding Partner</span>');
    expect(email.html).toContain('קבלת ההזמנה');
  });

  it('English stays left to right', () => {
    const email = generateInviteInvitationEmail(data());
    expect(email.html).toContain('<div dir="ltr" style="text-align: left;">');
    expect(email.html).not.toContain('<div dir="rtl"');
  });

  it('escapes the note and the name, and keeps the note line breaks', () => {
    const email = generateInviteInvitationEmail(
      data({ inviterName: 'Eve <b>"x"</b>', personalNote: '<script>alert(1)</script>\nline two & more' })
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>line two &amp; more');
    expect(email.html).toContain('Eve &lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    // The plain text part is not HTML: it carries the note as typed.
    expect(email.text).toContain('<script>alert(1)</script>\nline two & more');
  });

  it('omits the note block when there is no note', () => {
    for (const personalNote of [null, '', '   ']) {
      const email = generateInviteInvitationEmail(data({ personalNote }));
      expect(email.html).not.toContain('A note from');
      expect(email.text).not.toContain('A note from');
    }
  });

  it('the fallback name reads "You\'re invited", never "AgentPilot invited you to AgentPilot" (D-3)', () => {
    const email = generateInviteInvitationEmail(data({ inviterName: null }));
    expect(email.subject).toBe("You're invited to AgentPilot");
    expect(email.html).toContain('You&#39;re invited to join AgentPilot');
    expect(email.html).toContain('A note from the AgentPilot team:');
    expect(email.subject).not.toContain('AgentPilot invited');
  });

  it('a name cannot add a header line to the subject', () => {
    const email = generateInviteInvitationEmail(data({ inviterName: 'Dana\r\nBcc: x@example.com' }));
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it.each([
    [{ kind: 'free', accessOpenEnded: true, accessMonths: null } as const, 'Free · No end date'],
    [{ kind: 'free', accessOpenEnded: false, accessMonths: 1 } as const, 'Free · 1 month'],
    [{ kind: 'payment_required' } as const, 'Payment required'],
  ])('offer %j reads %s', (offer, expected) => {
    expect(generateInviteInvitationEmail(data({ offer })).html).toContain(expected);
  });

  it('the expiry is a date only, in UTC, in the invite locale (SA F-7)', () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in Israel; UTC keeps 31 Oct.
    const en = generateInviteInvitationEmail(data());
    expect(en.text).toMatch(/valid until [^\n]*October 31, 2026\./);
    expect(en.text).not.toMatch(/\d{1,2}:\d{2}/);
    const es = generateInviteInvitationEmail(data({ locale: 'es' }));
    expect(es.text).toMatch(/31 de octubre de 2026/);
  });

  it('is platform-branded (AgentPilot), with no business branding', () => {
    const email = generateInviteInvitationEmail(data());
    expect(email.html).toContain('AgentPilot');
    expect(email.html).not.toMatch(/neuronforge/i);
  });
});

/*
 * Slice 3a (T-3a-2, T-3a-3, T-3a-6; SA R-3): no developer comments in the sent
 * HTML except the Outlook conditional, and the AgentPilot wordmark only when
 * NEXT_PUBLIC_APP_URL is an https origin, with the text wordmark otherwise.
 */
describe('the invitation email: comments and the wordmark (Slice 3a)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
  const PROD = 'https://neuronforge-kohl.vercel.app';
  const MSO_BLOCK = /<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
  });

  it.each(['en', 'he', 'es'] as const)('%s: the only "<!--" is the MSO conditional', (locale) => {
    for (const url of [PROD, undefined]) {
      if (url === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = url;
      const { html } = generateInviteInvitationEmail(data({ locale }));
      expect(html.match(MSO_BLOCK)).toHaveLength(1);
      expect(html.replace(MSO_BLOCK, '')).not.toContain('<!--');
      expect(html).not.toContain('THE WORDMARK, QUIET');
    }
  });

  it.each(['en', 'he', 'es'] as const)('%s, https: the wordmark with alt, width and height, styled alt text', (locale) => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const { html } = generateInviteInvitationEmail(data({ locale }));
    expect(html).toContain(
      `<img src="${PROD}/images/brand/wordmark.png" alt="AgentPilot" width="154" height="28" style="display: inline-block; width: 154px; height: 28px;`
    );
    // What a client that blocks images shows in its place: the name, set like the text wordmark.
    expect(html).toMatch(/<img [^>]*alt="AgentPilot"[^>]*font-size: 16px; font-weight: 600;/);
    expect(html.match(/<img /g)).toHaveLength(1);
  });

  it.each([
    ['deleted', undefined],
    ['http://localhost:3000', 'http://localhost:3000'],
  ])('NEXT_PUBLIC_APP_URL %s: no image, the text wordmark instead, and no fallback host', (_label, url) => {
    if (url === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = url;
    const { html } = generateInviteInvitationEmail(data());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('wordmark.png');
    expect(html).not.toContain('agentspilot.ai');
    expect(html).toMatch(/<span style="font-family:[^"]*font-size: 16px; font-weight: 600;[^"]*">\s*AgentPilot\s*<\/span>/);
  });

  it('the plain-text part is the same with or without the logo (T-3a-6)', () => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const withLogo = generateInviteInvitationEmail(data());
    delete process.env.NEXT_PUBLIC_APP_URL;
    const withoutLogo = generateInviteInvitationEmail(data());
    expect(withLogo.text).toBe(withoutLogo.text);
    expect(withLogo.text).not.toContain('<!--');
    expect(withLogo.subject).toBe(withoutLogo.subject);
  });
});
