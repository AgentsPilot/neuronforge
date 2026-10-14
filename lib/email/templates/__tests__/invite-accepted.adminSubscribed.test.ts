/**
 * Plan payments P-9.2 (T10, BQ-P11): "{email} has subscribed" to the ISSUING
 * ADMIN. No new copy: the admin's heading is the approved N-2 SUBJECT (the
 * English champion heading says "friend"); the lead, status word, subject and
 * footer are N-2's; the button is N-1's admin one. The champion's email is
 * unchanged.
 */

import { generateInviteAcceptedEmail } from '../invite-accepted';

const INVITEE = 'buyer@example.com';
const base = { event: 'subscribed' as const, inviteeEmail: INVITEE, status: 'subscribed' as const, actionUrl: 'https://app.example.test/admin/business-os-invites' };

describe('the subscribed email to an admin (T10)', () => {
  it.each([
    ['en', 'Your invitation turned into a subscription', `${INVITEE} has subscribed.`, 'Open invites'],
    ['he', 'ההזמנה שלך הפכה למנוי', `התשלום עבור ${INVITEE} הושלם והמנוי פעיל.`, 'לרשימת ההזמנות'],
    ['es', 'Tu invitación se convirtió en una suscripción', `${INVITEE} se suscribió.`, 'Abrir invitaciones'],
  ] as const)('%s: subject = heading = the approved N-2 subject; N-2 lead; the admin button', (locale, subject, lead, button) => {
    const email = generateInviteAcceptedEmail({ ...base, recipientKind: 'admin', locale });
    expect(email.subject).toBe(subject);
    const lines = email.text.split('\n');
    expect(lines[0]).toBe(subject);
    expect(email.text).toContain(lead);
    expect(email.text).toContain(button);
    expect(email.text).not.toContain('friend');
    expect(email.html).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
  });

  it('the champion\'s subscribed email keeps its own heading', () => {
    const email = generateInviteAcceptedEmail({ ...base, recipientKind: 'champion', locale: 'en' });
    expect(email.text.split('\n')[0]).toBe('Your friend subscribed');
    expect(email.subject).toBe('Your invitation turned into a subscription');
  });

  it('the accepted email (N-1) to an admin is unchanged', () => {
    const email = generateInviteAcceptedEmail({ ...base, event: 'accepted', status: 'not_subscribed_yet', recipientKind: 'admin', locale: 'en' });
    expect(email.subject).toBe('Your invitation was accepted');
    expect(email.text.split('\n')[0]).toBe('Your invitation was accepted');
  });
});
