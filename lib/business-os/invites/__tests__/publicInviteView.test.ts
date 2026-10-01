/**
 * The pure core of the public validate route (C-4, AC-2, FR-10): one answer for
 * every bad token, state only on a match, an exact allow-list per state, and
 * `first_viewed_at` stamped only for a valid invite that has not been seen.
 */

import { CHAMPION_INVITE_TYPE, INVITE_ISSUANCE_POLICY, INVITE_TYPES } from '@/lib/business-os/entitlements/config/invites';
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
    issuer_kind: 'admin',
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

const INVITEE_EMAIL = 'invitee@example.com';

interface HarnessOptions {
  lookupError?: boolean;
  markError?: boolean;
  /** Does the invitee email already have an account? Default: no. */
  hasAccount?: boolean;
  emailError?: boolean;
  emailMissing?: boolean;
  accountError?: boolean;
  /** The existing-account stamp was already set by an earlier view. */
  alreadyStamped?: boolean;
  stampError?: boolean;
}

function harness(row: BusinessOsInvitePublicView | null, options: HarnessOptions = {}) {
  const lookups: string[] = [];
  const warnings: Array<Record<string, unknown>> = [];
  const accountQuestions: string[] = [];
  const accounts = {
    emailHasAccount: jest.fn(async (email: string) => {
      accountQuestions.push(email);
      if (options.accountError) return { data: null, error: new Error('lookup failed') };
      return { data: options.hasAccount === true, error: null };
    }),
  };
  const repository: PublicInviteRepository & {
    markFirstViewed: jest.Mock;
    findInviteeEmailForPublicCheck: jest.Mock;
    markOpenedByExistingAccount: jest.Mock;
  } = {
    findByTokenHashForPublicView: jest.fn(async (hash: string) => {
      lookups.push(hash);
      if (options.lookupError) return { data: null, error: new Error('timeout') };
      return { data: hash === hashInviteToken(TOKEN) ? row : null, error: null };
    }),
    markFirstViewed: jest.fn(async () =>
      options.markError ? { data: null, error: new Error('update failed') } : { data: true, error: null }
    ),
    findInviteeEmailForPublicCheck: jest.fn(async (id: string) => {
      if (options.emailError) return { data: null, error: new Error('read failed') };
      if (options.emailMissing) return { data: null, error: null };
      return { data: id === INVITE_ID ? INVITEE_EMAIL : 'someone-else@example.com', error: null };
    }),
    markOpenedByExistingAccount: jest.fn(async () => {
      if (options.stampError) return { data: null, error: new Error('stamp failed') };
      return { data: options.alreadyStamped !== true, error: null };
    }),
  };
  const deps = {
    repository,
    accounts,
    config,
    now: NOW,
    logger: { warn: (context: Record<string, unknown>) => warnings.push(context) },
  };
  return { deps, repository, accounts, accountQuestions, lookups, warnings };
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
      ['inviterDisplayName', 'language', 'linkExpiresAt', 'maskedEmail', 'offer', 'personalNote', 'state'].sort()
    );
    // Slice 1b (R-6): the first character of the local part, and the domain. Never the full email.
    expect(response.maskedEmail).toBe('i•••@example.com');
    expect(JSON.stringify(response)).not.toContain(INVITEE_EMAIL);
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
    const { deps, repository, accounts } = harness(row, { hasAccount: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.response).toEqual({ state, language: 'he', inviterDisplayName: 'Dana' });
    expect(repository.markFirstViewed).not.toHaveBeenCalled();
    // The account question is asked only for a pending, grant-available invite.
    expect(repository.findInviteeEmailForPublicCheck).not.toHaveBeenCalled();
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
    expect(repository.markOpenedByExistingAccount).not.toHaveBeenCalled();
  });
});

describe('FR-8a / L-3: the invited email already has an account (Slice 1a)', () => {
  it('answers existing_account with exactly the narrow keys, and never the email', async () => {
    const { deps } = harness(stored(), { hasAccount: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome).toEqual({
      ok: true,
      inviteId: INVITE_ID,
      response: { state: 'existing_account', language: 'he', inviterDisplayName: 'Dana' },
      firstOpenByExistingAccount: true,
    });
    expect(JSON.stringify(outcome.ok && outcome.response)).not.toContain(INVITEE_EMAIL);
  });

  it('decides before the offer and the first-view stamp: an existing account is not a signup view', async () => {
    const { deps, repository } = harness(stored(), { hasAccount: true });
    await viewInviteByToken(TOKEN, deps);
    expect(repository.markFirstViewed).not.toHaveBeenCalled();
    expect(repository.markOpenedByExistingAccount).toHaveBeenCalledWith(INVITE_ID, NOW);
  });

  it('R-4: the lookup is asked exactly once, about the email read for the MATCHED row, and nothing else', async () => {
    const { deps, repository, accountQuestions } = harness(stored(), { hasAccount: true });
    await viewInviteByToken(TOKEN, deps);
    expect(repository.findInviteeEmailForPublicCheck).toHaveBeenCalledTimes(1);
    expect(repository.findInviteeEmailForPublicCheck).toHaveBeenCalledWith(INVITE_ID);
    expect(accountQuestions).toEqual([INVITEE_EMAIL]);
  });

  it('R-4: an unmatched token never reaches the email read or the lookup', async () => {
    const { deps, repository, accounts } = harness(stored(), { hasAccount: true });
    await viewInviteByToken(generateInviteToken(), deps);
    await viewInviteByToken('abc', deps);
    expect(repository.findInviteeEmailForPublicCheck).not.toHaveBeenCalled();
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
  });

  it('reports the first open only once: a reload after the stamp is set carries no flag', async () => {
    const { deps } = harness(stored(), { hasAccount: true, alreadyStamped: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('existing_account');
    expect(outcome.ok && outcome.firstOpenByExistingAccount).toBeUndefined();
  });

  it('a failed stamp is logged and ignored, with no flag: the visitor still sees the page', async () => {
    const { deps, warnings } = harness(stored(), { hasAccount: true, stampError: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('existing_account');
    expect(outcome.ok && outcome.firstOpenByExistingAccount).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain(INVITEE_EMAIL);
    expect(JSON.stringify(warnings)).not.toContain(TOKEN);
  });

  it.each([
    ['the email read fails', { emailError: true }],
    ['the row has vanished between reads', { emailMissing: true }],
    ['the account lookup fails', { accountError: true }],
  ])('"no account" is never the default: when %s, the outcome is { ok: false } (try again)', async (_label, options) => {
    const { deps, repository } = harness(stored(), { hasAccount: true, ...options });
    expect(await viewInviteByToken(TOKEN, deps)).toEqual({ ok: false });
    expect(repository.markFirstViewed).not.toHaveBeenCalled();
  });

  it('with no account, the Slice 0 valid path is unchanged and asks the question exactly once', async () => {
    const { deps, accountQuestions, repository } = harness(stored());
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('valid');
    expect(accountQuestions).toEqual([INVITEE_EMAIL]);
    expect(repository.markOpenedByExistingAccount).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome.ok && outcome.response)).not.toContain(INVITEE_EMAIL);
  });
});

describe('Slices 5a/5b (F5a-10, F5b-3, SA R-5, Q-8): a champion friend invite', () => {
  const policy = INVITE_ISSUANCE_POLICY as unknown as { accountInvitesAvailable: boolean };
  const friendRow = (overrides: Partial<BusinessOsInvitePublicView> = {}) =>
    stored({
      issuer_kind: 'account',
      grant_kind: 'tier',
      grant_id: INVITE_ISSUANCE_POLICY.account.grantId,
      access_open_ended: null,
      access_months: null,
      ...overrides,
    });

  afterEach(() => {
    policy.accountInvitesAvailable = false;
  });

  it('with the switch on (5b): valid, with the offer and the masked email, and NO existing-account check (F5b-3)', async () => {
    policy.accountInvitesAvailable = true;
    // The address HAS an account: the page must still say nothing about it.
    const { deps, repository, accounts } = harness(friendRow(), { hasAccount: true });
    const outcome = await viewInviteByToken(TOKEN, deps);

    expect(outcome.ok).toBe(true);
    const response = outcome.ok ? (outcome.response as Record<string, unknown>) : {};
    expect(response.state).toBe('valid');
    expect(Object.keys(response).sort()).toEqual([
      'inviterDisplayName',
      'language',
      'linkExpiresAt',
      'maskedEmail',
      'offer',
      'personalNote',
      'state',
    ]);
    expect((response.offer as { free: boolean }).free).toBe(false);
    expect(response.maskedEmail).not.toBe(INVITEE_EMAIL);
    expect(String(response.maskedEmail)).toContain('•');
    // The champion holds the link: never ask whether the typed address has an account.
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
    expect(repository.markOpenedByExistingAccount).not.toHaveBeenCalled();
    expect(repository.markFirstViewed).toHaveBeenCalledTimes(1);
  });

  it('with the switch on and a failed email read: try again, never a form without a masked address', async () => {
    policy.accountInvitesAvailable = true;
    const { deps, accounts } = harness(friendRow(), { emailError: true });
    expect(await viewInviteByToken(TOKEN, deps)).toEqual({ ok: false });
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
  });

  it('whether or not the address has an account, the answer is identical (F5b-3)', async () => {
    policy.accountInvitesAvailable = true;
    const withAccount = await viewInviteByToken(TOKEN, harness(friendRow(), { hasAccount: true }).deps);
    const withoutAccount = await viewInviteByToken(TOKEN, harness(friendRow(), { hasAccount: false }).deps);
    expect(withAccount).toEqual(withoutAccount);
  });

  it('with the switch off (as shipped): unavailable, and nothing is stamped or asked', async () => {
    expect(INVITE_ISSUANCE_POLICY.accountInvitesAvailable).toBe(false);
    const { deps, repository, accounts } = harness(friendRow(), { hasAccount: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('unavailable');
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
    expect(repository.findInviteeEmailForPublicCheck).not.toHaveBeenCalled();
    expect(repository.markFirstViewed).not.toHaveBeenCalled();
  });

  it('keyed on issuer_kind, whatever the grant (R-5): an account row with a cohort grant is unavailable, never valid', async () => {
    policy.accountInvitesAvailable = true;
    const { deps, accounts } = harness(stored({ issuer_kind: 'account' }), { hasAccount: false });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('unavailable');
    expect(accounts.emailHasAccount).not.toHaveBeenCalled();
  });

  it('expired, revoked and used friend invites answer as any other invite', async () => {
    policy.accountInvitesAvailable = true;
    for (const [overrides, state] of [
      [{ link_expires_at: '2026-10-01T00:00:00.000Z' }, 'expired'],
      [{ revoked_at: '2026-10-05T00:00:00.000Z' }, 'revoked'],
    ] as const) {
      const { deps } = harness(friendRow(overrides));
      const outcome = await viewInviteByToken(TOKEN, deps);
      expect(outcome.ok && outcome.response.state).toBe(state);
    }
  });

  it('an admin invite still takes the existing-account check (unchanged)', async () => {
    const { deps, accounts } = harness(stored(), { hasAccount: true });
    const outcome = await viewInviteByToken(TOKEN, deps);
    expect(outcome.ok && outcome.response.state).toBe('existing_account');
    expect(accounts.emailHasAccount).toHaveBeenCalledTimes(1);
  });
});
