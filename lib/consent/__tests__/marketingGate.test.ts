/**
 * The gate's own decisions, isolated from the transport.
 *
 * The property being protected here is that ambiguity means NO. Every other
 * lookup in the email path degrades gracefully on failure; this one must not,
 * because the two outcomes are not symmetrical — an email that was not sent can
 * be sent again, and one sent to someone who never agreed cannot be unsent.
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { MarketingGate, MARKETING_SENDING_ENABLED } from '../marketingGate';
import type { MarketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';

const OWNER = 'owner-1';
const EMAIL = 'client@example.com';

function repoWith(overrides: {
  state?: { data: unknown; error: Error | null };
  settings?: { data: unknown; error: Error | null };
}): MarketingConsentRepository {
  return {
    getState: jest.fn(async () => overrides.state ?? { data: null, error: null }),
    settings: jest.fn(
      async () =>
        overrides.settings ?? { data: { postal_address: '1 High St, London' }, error: null }
    ),
  } as unknown as MarketingConsentRepository;
}

describe('MarketingGate', () => {
  it('is open only while the three obligations are actually implemented', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * This asserted `false` for as long as consent could be collected but not
     * used — deliberately, because consent cannot be gathered retroactively
     * while sending without an unsubscribe link is its own violation.
     *
     * It is now `true`, and what holds the line is no longer the constant but
     * the three things the constant was waiting for. Pinned HERE rather than
     * left to the files that implement them, because flipping this back on
     * after any of them is removed is the mistake worth catching:
     *
     *   the link      derived per recipient and appended by the transport
     *   the header    List-Unsubscribe, with one-click only where it works
     *   the address   printed in that same footer
     *
     * Read off the sources, so deleting an implementation fails here.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(MARKETING_SENDING_ENABLED).toBe(true);

    const transport = readFileSync(
      join(process.cwd(), 'lib', 'notifications', 'emailTransport.ts'),
      'utf-8'
    );
    const footer = readFileSync(
      join(process.cwd(), 'lib', 'notifications', 'marketingFooter.ts'),
      'utf-8'
    );

    /* Built for every marketing send, by the transport, and fatal when it cannot be. */
    expect(transport).toContain('buildMarketingFooter');
    expect(transport).toContain("blocked: 'no_unsubscribe'");
    expect(transport).toContain('generateUnsubscribeToken');
    expect(transport).toContain("'List-Unsubscribe'");

    /* The footer refuses to render without all three parts. */
    expect(footer).toContain('MarketingFooterError');
    expect(footer).toContain('postalAddress');

    /* And the page that actually takes somebody off the list exists. */
    expect(
      existsSync(
        join(process.cwd(), 'app', 'consent', 'unsubscribe', '[token]', 'page.tsx')
      )
    ).toBe(true);
    expect(
      existsSync(join(process.cwd(), 'app', 'api', 'unsubscribe', 'route.ts'))
    ).toBe(true);
  });

  // The rest of the gate's logic only becomes reachable once sending is on.
  // These describe what it will do then, and fail loudly if the constant is
  // flipped without them being revisited.
  const whenEnabled = MARKETING_SENDING_ENABLED ? describe : describe.skip;

  whenEnabled('once sending is enabled', () => {
    it('refuses when no decision was ever recorded', async () => {
      const gate = new MarketingGate(repoWith({ state: { data: null, error: null } }));
      await expect(gate.check(OWNER, EMAIL)).resolves.toEqual({
        allowed: false,
        reason: 'no_consent',
      });
    });

    it('refuses when consent was withdrawn', async () => {
      const gate = new MarketingGate(
        repoWith({ state: { data: { consented: false }, error: null } })
      );
      await expect(gate.check(OWNER, EMAIL)).resolves.toMatchObject({ reason: 'no_consent' });
    });

    it('refuses when the lookup itself fails', async () => {
      // Fail closed. This is the branch that separates "we could not tell" from
      // "go ahead", and getting it the other way round is the whole risk.
      const gate = new MarketingGate(
        repoWith({ state: { data: null, error: new Error('unreachable') } })
      );
      await expect(gate.check(OWNER, EMAIL)).resolves.toMatchObject({
        reason: 'consent_lookup_failed',
      });
    });

    it('refuses a consented recipient when the business has no postal address', async () => {
      // CAN-SPAM requires one in every commercial message, and consent does not
      // substitute for it.
      const gate = new MarketingGate(
        repoWith({
          state: { data: { consented: true }, error: null },
          settings: { data: { postal_address: '   ' }, error: null },
        })
      );
      await expect(gate.check(OWNER, EMAIL)).resolves.toMatchObject({
        reason: 'no_postal_address',
      });
    });

    it('allows a consented recipient of a fully configured business', async () => {
      const gate = new MarketingGate(
        repoWith({ state: { data: { consented: true }, error: null } })
      );
      /* The verdict now says WHY it was lawful, because consent and soft
         opt-in are defended differently if anybody asks. */
      await expect(gate.check(OWNER, EMAIL)).resolves.toEqual({
        allowed: true,
        basis: 'consent',
      });
    });

    it('refuses an address nobody has decided about, by default', async () => {
      /*
       * No row at all. `recordConsent` writes nothing for an untouched box —
       * an untouched box is not a decision — so this is "not asked", and
       * without a caller claiming soft opt-in it stays a no.
       */
      const gate = new MarketingGate(repoWith({ state: { data: null, error: null } }));

      await expect(gate.check(OWNER, EMAIL)).resolves.toEqual({
        allowed: false,
        reason: 'no_consent',
      });
    });

    it('refuses a withdrawal even when soft opt-in is claimed', async () => {
      /*
       * The absolute one. Soft opt-in is for people who never answered; it can
       * never reach somebody who answered no, and a caller asserting it must
       * not change that.
       */
      const gate = new MarketingGate(
        repoWith({ state: { data: { consented: false }, error: null } })
      );

      await expect(gate.check(OWNER, EMAIL, { softOptIn: true })).resolves.toEqual({
        allowed: false,
        reason: 'no_consent',
      });
    });

    it('reads settings once across a fan-out', async () => {
      const repo = repoWith({ state: { data: { consented: true }, error: null } });
      const gate = new MarketingGate(repo);

      await gate.check(OWNER, 'a@example.com');
      await gate.check(OWNER, 'b@example.com');
      await gate.check(OWNER, 'c@example.com');

      expect(repo.settings).toHaveBeenCalledTimes(1);
      expect(repo.getState).toHaveBeenCalledTimes(3);
    });
  });
});
