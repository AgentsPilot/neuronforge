/**
 * The pure core of the public validate route (C-4, AC-2, FR-10): one answer for
 * every bad token, state only on a match, an exact allow-list per state, and
 * `first_viewed_at` stamped only for a valid invite that has not been seen.
 */

import { CHAMPION_INVITE_TYPE, INVITE_TYPES } from '@/lib/business-os/entitlements/config/invites';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInvitePublicView } from '@/lib/repositories/types';

import { generateInviteToken, hashInviteToken } from '../inviteToken';
import { NOT_RECOGNISED, viewInviteByToken, type PublicInviteRepository } from '../publicInviteView';

const NOW = new Date('2026-10-10T00:00:00.000Z');
const config = getEntitlementConfig();
const TOKEN = generateInviteToken();
const INVITE_ID = '11111111-1111-4111-8111-111111111111';

function stored(overrides: Partial<BusinessOsInvitePublicView> = {}): BusinessOsInvitePublicView {
  return {
    id: INVITE_ID,
    grant_kind: 'cohort',
    grant_id: INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId,
    access_open_ended: true,
    access_months: null,
    inviter_display_name: 'Dana',
    language: 'he',
    personal_note: 'Welcome aboard',
    link_expires_at: '2026-10-31T00:00:00.000Z',
    first_viewed_at: null,
    revoked_at: null,
    redeemed_at: null,
    ...overrides,
  };
}

function harness(row: BusinessOsInvitePublicView | null, options: { lookupError?: boolean; markError?: boolean } = {}) {
  const lookups: string[] = [];
  const warnings: Array<Record<string, unknown>> = [];
  const repository: PublicInviteRepository & { markFirstViewed: jest.Mock } = {
    findByTokenHashForPublicView: jest.fn(async (hash: string) => {
      lookups.push(hash);
      if (options.lookupError) return { data: null, error: new Error('timeout') };
      return { data: hash === hashInviteToken(TOKEN) ? row : null, error: null };
    }),
    markFirstViewed: jest.fn(async () =>
      options.markError ? { data: null, error: new Error('update failed') } : { data: true, error: null }
    ),
  };
  const deps = { repository, config, now: NOW, logger: { warn: (context: Record<string, unknown>) => warnings.push(context) } };
  return { deps, repository, lookups, warnings };
}

describe('AC-2: every bad token gets the same answer', () => {
  const oneOff = `${TOKEN.slice(0, -1)}${TOKEN.endsWith('A') ? 'B' : 'A'}`;

  it.each([
    ['an unknown well-formed token', generateInviteToken()],
    ['a one-character-off token', oneOff],
    ['a short token', 'abc'],
    ['a 44-character token', `${TOKEN}A`],
    ['a character outside the set', `${TOKEN.slice(0, -1)}+`],
    ['an empty token', ''],
  ])('%s is not_recognised', async (_label, token) => {
    const { deps } = harness(stored());
    const outcome = await viewInviteByToken(token, deps);
    expect(outcome).toEqual({ ok: true, response: NOT_RECOGNISED, inviteId: null });
    expect(outcome.ok && outcome.response).toEqual({ state: 'not_recognised' });
  });

  it('a malformed token never reaches the database (D-6); a well-formed one does exactly one lookup', async () => {
    const malformed = harness(stored());
    await viewInviteByToken('abc', malformed.deps);
    expect(malformed.lookups).toHaveLength(0);

    const wellFormed = harness(stored());
    await viewInviteByToken(generateInviteToken(), wellFormed.deps);
    expect(wellFormed.lookups).toHaveLength(1);
    expect(wellFormed.lookups[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a lookup error is { ok: false } (the route says try again, not "not recognised")', async () => {
    const { deps } = harness(stored(), { lookupError: true });
    expect(await viewInviteByToken(TOKEN, deps)).toEqual({ ok: false });
  });
});

describe('the valid state', () => {
  it('has exactly the allow-listed keys, and no email, id, hash, issuer or reason', async () => {
    const { deps } = harness(stored());
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const response = outcome.response as Record<string, unknown>;
    expect(Object.keys(response).sort()).toEqual(
      ['inviterDisplayName', 'language', 'linkExpiresAt', 'offer', 'personalNote', 'state'].sort()
    );
    expect(Object.keys(response.offer as object).sort()).toEqual(['access', 'free', 'included', 'monthlyPriceUsd', 'planName'].sort());
    expect(response.state).toBe('valid');
    expect(response.language).toBe('he');
    expect(response.personalNote).toBe('Welcome aboard');

    const serialised = JSON.stringify(response);
    expect(serialised).not.toContain(INVITE_ID);
    expect(serialised).not.toContain(hashInviteToken(TOKEN));
    expect(serialised).not.toContain(TOKEN);
    expect(outcome.inviteId).toBe(INVITE_ID);
  });

  it('FR-10: stamps first_viewed_at only when it is null', async () => {
    const unseen = harness(stored());
    await viewInviteByToken(TOKEN, unseen.deps);
    expect(unseen.repository.markFirstViewed).toHaveBeenCalledWith(INVITE_ID, NOW);

    const seen = harness(stored({ first_viewed_at: '2026-10-05T00:00:00.000Z' }));
    await viewInviteByToken(TOKEN, seen.deps);
    expect(seen.repository.markFirstViewed).not.toHaveBeenCalled();
  });

  it('a failed first-view stamp is logged and ignored: the visitor still sees the page', async () => {
    const { deps, warnings } = harness(stored(), { markError: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('valid');
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(TOKEN);
  });

  it('an unknown stored language falls back to en', async () => {
    const { deps } = harness(stored({ language: 'fr' }));
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && (outcome.response as { language: string }).language).toBe('en');
  });
});

describe('matched but not valid: the narrow allow-list', () => {
  it.each([
    ['expired', stored({ link_expires_at: '2026-10-10T00:00:00.000Z' })],
    ['revoked', stored({ revoked_at: '2026-10-05T00:00:00.000Z' })],
    ['used', stored({ redeemed_at: '2026-10-05T00:00:00.000Z' })],
    ['unavailable', stored({ grant_id: 'retired-cohort' })],
  ])('%s carries only state, language and the inviter name, and stamps nothing', async (state, row) => {
    const { deps, repository } = harness(row);
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response).toEqual({ state, language: 'he', inviterDisplayName: 'Dana' });
    expect(repository.markFirstViewed).not.toHaveBeenCalled();
  });
});
