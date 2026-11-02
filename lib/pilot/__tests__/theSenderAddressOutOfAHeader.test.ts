/**
 * The bare address out of a mail header, and the trap in it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `search_emails` returned `from` as the raw header, so `"Dana Levi"
 * <dana@host>` as often as a plain address. That made two ordinary things
 * impossible: MATCHING a sender against a column (`email_sends.to_email`,
 * `crm_contacts.email`) and WRITING BACK to them, since a recipient field
 * wants an address and not a display name.
 *
 * It is what lets the mail receptionist agent scan the mailbox FIRST and work
 * out whose mail it is afterwards. Without it the sender could not be
 * identified after the fact, so the plan had to build a scoped query up front
 * and read client records before it had seen a single reply.
 *
 * THE FAILURE THAT MATTERS IS NOT THE OBVIOUS ONE. A quoted display name may
 * legally contain an @, so a header can carry two address-shaped tokens with
 * only the bracketed one being the real sender. Anything reaching for the first
 * match addresses a client's draft to whatever was in the display name.
 *
 * Reached through the prototype rather than a constructed instance: it touches
 * no `this`, and building a GmailPluginExecutor would drag in an OAuth token to
 * test a pure function.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { GmailPluginExecutor } from '@/lib/server/gmail-plugin-executor';

type Parser = (header: string) => string;

const parse = (GmailPluginExecutor.prototype as unknown as Record<string, Parser>)
  .parseEmailAddress;

const address = (header: string) => parse.call({} as never, header);

describe('parseEmailAddress', () => {
  it('takes the address out of a display-name header', () => {
    expect(address('Dana Levi <dana@host.com>')).toBe('dana@host.com');
  });

  it('reads a bare address with no brackets', () => {
    expect(address('dana@host.com')).toBe('dana@host.com');
  });

  /*
   * THE ONE THAT MATTERS. Legal RFC 5322, and the reason angle brackets are
   * checked before anything else rather than as a fallback.
   */
  it('prefers the bracketed address over an @ inside the display name', () => {
    expect(address('"admin@old-domain.com" <dana@host.com>')).toBe('dana@host.com');
  });

  it('keeps a quoted name containing a comma from splitting the header', () => {
    expect(address('"Levi, Dana" <dana@host.com>')).toBe('dana@host.com');
  });

  it('takes only the first of a list, never a joined string', () => {
    expect(address('dana@host.com, ruth@host.com')).toBe('dana@host.com');
  });

  it('lowercases, so one person is one key when matched against a column', () => {
    expect(address('Dana <Dana@Host.COM>')).toBe('dana@host.com');
  });

  /*
   * Empty, not null. The value is interpolated straight into a provider query
   * and into a BizQL filter; `to:null` is a search most engines answer
   * generously, and a filter on the string "null" matches nothing in a way
   * that looks like a working guard.
   */
  it('returns an empty string for an absent header', () => {
    expect(address('')).toBe('');
  });

  it('returns an empty string for a display name with no address at all', () => {
    expect(address('Reception Desk')).toBe('');
  });
});
