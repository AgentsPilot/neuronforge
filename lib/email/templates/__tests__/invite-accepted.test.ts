/**
 * "Your invitation was accepted" (N-1; workplan §2.4, §5 test 10; SA Q-5, C-3):
 * three languages, RTL for Hebrew, joined vs. held wording (the held words are
 * the FR-31 list label, reused, never re-translated), the address escaped, no
 * address in the subject, and the champion/admin button targets.
 */

import { INVITE_FRIENDS_COPY } from '@/components/business-os/settings/inviteFriendsCopy';

import { generateInviteAcceptedEmail, type InviteAcceptedEmailData } from '../invite-accepted';

const INVITEE = 'friend@example.com';
const CHAMPION_URL = 'https://app.example.com/business-os/settings#settings-section-invite-friends';
const ADMIN_URL = 'https://app.example.com/admin/business-os-invites';

function data(overrides: Partial<InviteAcceptedEmailData> = {}): InviteAcceptedEmailData {
  return {
    event: 'accepted',
    inviteeEmail: INVITEE,
    status: 'joined',
    recipientKind: 'champion',
    actionUrl: CHAMPION_URL,
    locale: 'en',
    ...overrides,
  };
}

describe('the invite-accepted email', () => {
  it.each(['en', 'he', 'es'] as const)('%s: the address in html and text, never in the subject', (locale) => {
    const email = generateInviteAcceptedEmail(data({ locale }));
    expect(email.html).toContain(INVITEE);
    expect(email.text).toContain(INVITEE);
    expect(email.subject).not.toContain('@');
    expect(email.subject.length).toBeGreaterThan(0);
  });

  it('English copy', () => {
    const email = generateInviteAcceptedEmail(data());
    expect(email.subject).toBe('Your invitation was accepted');
    expect(email.text).toContain(`${INVITEE} accepted your invitation.`);
    expect(email.text).toContain(`Invited: ${INVITEE}`);
    expect(email.text).toContain('Status: Joined');
    expect(email.text).toContain("You're getting this because you sent this invitation.");
    expect(email.text).not.toContain('unsubscribe');
  });

  it('Hebrew is right to left, with the address kept left to right', () => {
    const email = generateInviteAcceptedEmail(data({ locale: 'he' }));
    expect(email.subject).toBe('ההזמנה שלך התקבלה');
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).toContain(`<span dir="ltr"><strong>${INVITEE}</strong></span>`);
  });

  it('English stays left to right', () => {
    expect(generateInviteAcceptedEmail(data()).html).not.toContain('dir="rtl"');
  });

  it.each(['en', 'he', 'es'] as const)(
    '%s: a held friend reads the FR-31 list label, exactly (SA Q-5), with the "after payment" line',
    (locale) => {
      const email = generateInviteAcceptedEmail(data({ locale, status: 'not_subscribed_yet' }));
      const label = INVITE_FRIENDS_COPY[locale].status.joined;
      expect(email.html).toContain(label);
      expect(email.text).toContain(label);
      const joined = generateInviteAcceptedEmail(data({ locale, status: 'joined' }));
      expect(joined.text).not.toContain(label);
      // The held version is longer by the "after payment" line.
      expect(email.text.split('\n').length).toBeGreaterThan(joined.text.split('\n').length);
    }
  );

  it('English held wording', () => {
    const email = generateInviteAcceptedEmail(data({ status: 'not_subscribed_yet' }));
    expect(email.text).toContain('Status: Signed up — not subscribed yet');
    expect(email.text).toContain('They can start once they finish their payment.');
    expect(email.text).not.toContain('payment pending');
  });

  it('escapes an address carrying markup or quotes in the HTML', () => {
    const hostile = '"><script>alert(1)</script>@x.test';
    const email = generateInviteAcceptedEmail(data({ inviteeEmail: hostile }));
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).not.toContain('"><script');
    // The plain-text part carries it as it is.
    expect(email.text).toContain(hostile);
  });

  it('buttons: the champion to their invite list, the admin to the admin invites page', () => {
    const champion = generateInviteAcceptedEmail(data());
    expect(champion.html).toContain(`href="${CHAMPION_URL}"`);
    expect(champion.text).toContain(`See your invitations: ${CHAMPION_URL}`);
    const admin = generateInviteAcceptedEmail(data({ recipientKind: 'admin', actionUrl: ADMIN_URL }));
    expect(admin.html).toContain(`href="${ADMIN_URL}"`);
    expect(admin.text).toContain(`Open invites: ${ADMIN_URL}`);
  });

  it('is platform-branded (AgentPilot)', () => {
    expect(generateInviteAcceptedEmail(data()).html).toContain('AgentPilot');
  });
});
