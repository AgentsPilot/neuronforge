/**
 * Who may read an invoice, and for how long.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The invoice id used to be the whole authorisation. A v4 UUID cannot be
 * guessed, so this was never an enumeration risk — the risk was PERMANENCE: the
 * URL never expired and was bound to nobody, so it worked forever for anyone it
 * was ever forwarded to, and what it discloses is the client's name, address,
 * email, line items, amounts and the business's bank details.
 *
 * These are the two halves of the replacement, and the behaviour that makes it
 * worth having rather than theatre.
 * ─────────────────────────────────────────────────────────────────────────────
 */

process.env.BOOKING_TOKEN_SECRET = 'test-secret-for-invoice-links';

/**
 * The contact address the module reads to bind and to compare.
 *
 * Mutable, because the whole point of binding is that CHANGING it revokes
 * outstanding links — which is only testable if the test can change it.
 */
const contact: { email: string | null } = { email: 'client@example.test' };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { client_email: contact.email, contact: { email: contact.email } },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

import * as jwt from 'jsonwebtoken';

import {
  generateInvoiceToken,
  verifyInvoiceToken,
  mayViewInvoice,
  TOKEN_EXPIRY_DAYS,
} from '@/lib/payments/invoiceAccessToken';

const INVOICE = 'b3e53aeb-4b35-4f08-be8c-a8e7206841d1';
const OTHER = '00000000-0000-4000-8000-000000000000';
const NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  contact.email = 'client@example.test';
});

describe('the token', () => {
  it('round-trips the invoice and the address it names', async () => {
    expect(verifyInvoiceToken(await generateInvoiceToken(INVOICE))).toEqual(
      expect.objectContaining({ invoiceId: INVOICE, email: 'client@example.test' })
    );
  });

  it('refuses one signed with a different secret', () => {
    const forged = jwt.sign({ invoiceId: INVOICE }, 'not-the-secret', { expiresIn: '30d' });
    expect(verifyInvoiceToken(forged)).toBeNull();
  });

  it('refuses one that has expired', () => {
    const stale = jwt.sign({ invoiceId: INVOICE }, process.env.BOOKING_TOKEN_SECRET!, {
      expiresIn: '-1s',
    });
    expect(verifyInvoiceToken(stale)).toBeNull();
  });

  it('refuses a well-formed token carrying no invoice', () => {
    const empty = jwt.sign({ somethingElse: true }, process.env.BOOKING_TOKEN_SECRET!, {
      expiresIn: '30d',
    });
    expect(verifyInvoiceToken(empty)).toBeNull();
  });
});

describe('a signed link', () => {
  it('opens the invoice it names', async () => {
    expect(
      await mayViewInvoice({ invoiceId: INVOICE, token: await generateInvoiceToken(INVOICE), now: NOW })
    ).toEqual({ allowed: true, reason: 'token' });
  });

  it('does NOT open a different invoice', async () => {
    /*
     * The id in the URL is never trusted over the one in the verified payload.
     * Without this, a token for any invoice would open every invoice.
     */
    expect(
      await mayViewInvoice({ invoiceId: OTHER, token: await generateInvoiceToken(INVOICE), now: NOW })
    ).toEqual({ allowed: false, reason: 'bad_token' });
  });

  it('works on an invoice far older than the bare-URL window', async () => {
    // The whole point: a signed link stands on its own terms, not the
    // invoice's age.
    expect(
      (
        await mayViewInvoice({
          invoiceId: INVOICE,
          token: await generateInvoiceToken(INVOICE),
          issuedAt: daysAgo(400),
          now: NOW,
        })
      ).allowed
    ).toBe(true);
  });

  it('STOPS working once the contact address changes', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE REVOCATION.
     *
     * Booking links already behave this way — the portal compares a token's
     * email against the booking's current contact — so changing a client's
     * address invalidates every outstanding link for them. Invoice links had
     * no such property: they were bound to an id that never changes.
     *
     * No denylist, nothing to expire, and it fires on the event that actually
     * means "that address should no longer receive this".
     * ─────────────────────────────────────────────────────────────────────
     */
    const issued = await generateInvoiceToken(INVOICE);
    expect((await mayViewInvoice({ invoiceId: INVOICE, token: issued, now: NOW })).allowed).toBe(
      true
    );

    contact.email = 'somewhere-else@example.test';

    expect(await mayViewInvoice({ invoiceId: INVOICE, token: issued, now: NOW })).toEqual({
      allowed: false,
      reason: 'address_changed',
    });
  });

  it('is unbothered by capitalisation or stray spaces', async () => {
    const issued = await generateInvoiceToken(INVOICE);
    contact.email = '  CLIENT@Example.TEST ';
    expect((await mayViewInvoice({ invoiceId: INVOICE, token: issued, now: NOW })).allowed).toBe(
      true
    );
  });

  it('refuses a token minted before addresses were bound', async () => {
    /*
     * No such token exists in anyone's inbox — none of this has shipped — so
     * it is refused rather than admitted on the old terms. Admitting it would
     * leave a permanent way to present an unbound token and be let in.
     */
    const unbound = jwt.sign({ invoiceId: INVOICE }, process.env.BOOKING_TOKEN_SECRET!, {
      expiresIn: '30d',
    });
    expect((await mayViewInvoice({ invoiceId: INVOICE, token: unbound, now: NOW })).allowed).toBe(
      false
    );
  });
});

describe('a bare URL, for the links already in inboxes', () => {
  it('opens a recently issued invoice', async () => {
    expect(await mayViewInvoice({ invoiceId: INVOICE, issuedAt: daysAgo(3), now: NOW })).toEqual({
      allowed: true,
      reason: 'fresh',
    });
  });

  it('opens one exactly at the boundary', async () => {
    expect(
      (await mayViewInvoice({ invoiceId: INVOICE, issuedAt: daysAgo(TOKEN_EXPIRY_DAYS), now: NOW }))
        .allowed
    ).toBe(true);
  });

  it('is refused once the invoice outlives the window a token would have had', async () => {
    expect(
      await mayViewInvoice({
        invoiceId: INVOICE,
        issuedAt: daysAgo(TOKEN_EXPIRY_DAYS + 1),
        now: NOW,
      })
    ).toEqual({ allowed: false, reason: 'expired' });
  });

  it('is refused on an invoice that was never issued to anybody', async () => {
    // No send date means no bare link was ever handed out, so there is nothing
    // to keep working.
    expect((await mayViewInvoice({ invoiceId: INVOICE, issuedAt: null, now: NOW })).allowed).toBe(
      false
    );
  });

  it('is refused on an unparseable date rather than defaulting open', async () => {
    expect(
      (await mayViewInvoice({ invoiceId: INVOICE, issuedAt: 'not a date', now: NOW })).allowed
    ).toBe(false);
  });

  it('can be switched off entirely without a deploy', async () => {
    /*
     * `INVOICE_BARE_URL_GRACE_DAYS=0` collapses the rule to "signed links
     * only". An env var and not a hardcoded sunset date: a date changes
     * behaviour silently, months later, when nobody is watching.
     */
    process.env.INVOICE_BARE_URL_GRACE_DAYS = '0';
    try {
      expect(
        (await mayViewInvoice({ invoiceId: INVOICE, issuedAt: daysAgo(1), now: NOW })).allowed
      ).toBe(false);
    } finally {
      delete process.env.INVOICE_BARE_URL_GRACE_DAYS;
    }
  });

  it('ignores a malformed grace setting rather than locking everyone out', async () => {
    process.env.INVOICE_BARE_URL_GRACE_DAYS = 'thirty';
    try {
      expect(
        (await mayViewInvoice({ invoiceId: INVOICE, issuedAt: daysAgo(1), now: NOW })).allowed
      ).toBe(true);
    } finally {
      delete process.env.INVOICE_BARE_URL_GRACE_DAYS;
    }
  });
});

describe('the rule that makes signing worth anything', () => {
  it('a bad token is refused even where a bare URL would have been let in', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * If a wrong or expired token fell back to the freshness rule, then
     * STRIPPING the signature off a URL would grant more access than
     * presenting it — and every attacker would simply delete `?t=`. Presenting
     * a token must never be worse than presenting none.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const fresh = { invoiceId: INVOICE, issuedAt: daysAgo(1), now: NOW };

    expect((await mayViewInvoice(fresh)).allowed).toBe(true);
    expect(await mayViewInvoice({ ...fresh, token: 'nonsense' })).toEqual({
      allowed: false,
      reason: 'bad_token',
    });
    expect(
      (await mayViewInvoice({ ...fresh, token: await generateInvoiceToken(OTHER) })).allowed
    ).toBe(false);
  });
});
