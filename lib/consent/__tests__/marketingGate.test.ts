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
  it('is closed at the platform level until unsubscribe support exists', () => {
    // Consent is being COLLECTED before it can be USED, deliberately: it cannot
    // be gathered retroactively, but sending without an unsubscribe link is its
    // own violation. This constant is the seam between the two.
    expect(MARKETING_SENDING_ENABLED).toBe(false);
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
      await expect(gate.check(OWNER, EMAIL)).resolves.toEqual({ allowed: true });
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
