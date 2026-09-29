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
