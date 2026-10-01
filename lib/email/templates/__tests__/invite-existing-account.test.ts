/**
 * The "you already have an account" notice (Slice 5b; F5b-3, SA R-5): sent
 * instead of a sign-up code on a friend invite whose address already has an
 * account. Three languages, RTL for Hebrew, the ONLY link is sign-in, and
 * nothing from the champion (no inviter, no invite link, no code).
 */

import { generateInviteExistingAccountEmail } from '../invite-existing-account';

const SIGN_IN = 'https://www.agentspilot.ai/login';

const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe('the existing-account notice', () => {
  it.each(['en', 'he', 'es'] as const)('%s: one sign-in link, the ignore line, no code', (locale) => {
    const email = generateInviteExistingAccountEmail({ signInUrl: SIGN_IN, locale });
    expect(hrefsOf(email.html).filter((href) => href !== SIGN_IN && !href.includes('/images/'))).toEqual([]);
    expect(email.html).toContain(`href="${SIGN_IN}"`);
    expect(email.text).toContain(SIGN_IN);
    // Six digits outside a colour code would be a code; the wrapper uses hex colours.
    expect(email.html.replace(/#[0-9a-fA-F]{6}\b/g, '')).not.toMatch(/\b[0-9]{6}\b/);
    expect(email.text).not.toMatch(/\b[0-9]{6}\b/);
    expect(email.html).not.toContain('#t=');
    expect(email.text).not.toContain('/invite');
  });

  it('English says what happened and that ignoring it is safe (R-5)', () => {
    const email = generateInviteExistingAccountEmail({ signInUrl: SIGN_IN, locale: 'en' });
    expect(email.subject).toBe('You already have an AgentPilot account');
    expect(email.text).toContain('If you did not ask for this, you can ignore this email.');
    expect(email.text).toContain('no new account was created and no code was sent');
  });

  it('Hebrew is right to left', () => {
    const email = generateInviteExistingAccountEmail({ signInUrl: SIGN_IN, locale: 'he' });
    expect(email.html).toContain('dir="rtl"');
  });

  it('carries nothing from a champion: no inviter, no "via", no plan (R-5)', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      const email = generateInviteExistingAccountEmail({ signInUrl: SIGN_IN, locale });
      expect(email.text).not.toMatch(/ via |invited you|Essentials|Autopilot/i);
      expect(Object.keys(email).sort()).toEqual(['html', 'subject', 'text']);
    }
  });

  it('QA-1: a malformed sign-in URL never throws and never becomes a link (rendered without one)', () => {
    for (const signInUrl of ['javascript:alert(1)', 'https://x.test/"><b>', '', 'not a url']) {
      const email = generateInviteExistingAccountEmail({ signInUrl, locale: 'en' });
      expect(hrefsOf(email.html).filter((href) => !href.includes('/images/'))).toEqual([]);
      expect(email.html).not.toContain('<b>');
      expect(email.html).not.toContain('javascript:');
      expect(email.text).toContain('If you did not ask for this, you can ignore this email.');
    }
  });
});
