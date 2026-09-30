/**
 * The admin invite operations, without a request: C-3 (the token), C-6 (Paid
 * refused before any write), C-8 (the `en` default, as amended), C-9 (the
 * inviter name snapshot), the insert allow-list, R-7 (the one list-view mapper)
 * and the revoke outcome mapping.
 */

import { createHash } from 'crypto';

// Slice 1c: the ceiling and batch pins below import the repositories' limits;
// their modules must load without a real service-role client.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  CHAMPION_ACCESS_MONTHS_MAX,
  CHAMPION_INVITE_TYPE,
  INVITE_ISSUANCE_POLICY,
  INVITE_LINK_EXPIRY,
  INVITE_TYPES,
  PAID_INVITE_TYPE,
} from '@/lib/business-os/entitlements/config/invites';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { locales } from '@/lib/i18n/config';
import { platformUrl } from '@/lib/utils/origins';
import type { BusinessOsInvite, CreateBusinessOsInviteInput } from '@/lib/repositories/types';

import { LINEAGE_LOOKUP_LIMIT } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { BUSINESS_OS_INVITE_LIST_LIMIT } from '@/lib/repositories/BusinessOsInviteRepository';

import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';

import {
  INVITER_NAME_FALLBACK,
  INVITE_LINEAGE_BATCH,
  INVITE_LIST_CEILING,
  INVITE_LIST_VIEW_KEYS,
  buildInviteFormOptions,
  createInviteForAdmin,
  listInvitesForAdmin,
  resolveInviteFormLanguage,
  revokeInviteForAdmin,
  inviterNameFromProfile,
  toInviteListView,
  type CreateInviteDeps,
} from '../adminInviteOps';
import { createInviteSchema, type CreateInviteBody } from '../inviteSchemas';

const ADMIN = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const config = getEntitlementConfig();
const championGrant = INVITE_TYPES[CHAMPION_INVITE_TYPE].defaultGrantId;

/** Slice 2a: the two email fields are optional here, so the older fixtures read as "not emailed". */
type RowInput = Omit<CreateBusinessOsInviteInput, 'inviter_reply_to' | 'email_attempted_at'> &
  Partial<Pick<CreateBusinessOsInviteInput, 'inviter_reply_to' | 'email_attempted_at'>>;

function rowFrom(input: RowInput, overrides: Partial<BusinessOsInvite> = {}): BusinessOsInvite {
  return {
    id: INVITE_ID,
    email: input.email,
    email_locked: true,
    invite_type: input.invite_type,
    grant_kind: input.grant_kind,
    grant_id: input.grant_id,
    access_open_ended: input.access_open_ended,
    access_months: input.access_months,
    issuer_kind: 'admin',
    issuer_admin_id: input.issuer_admin_id,
    issuer_account_id: null,
    inviter_display_name: input.inviter_display_name,
    language: input.language,
    personal_note: input.personal_note,
    internal_reason: input.internal_reason,
    link_expiry_days: input.link_expiry_days,
    link_expires_at: input.link_expires_at,
    first_viewed_at: null,
    revoked_at: null,
    revoked_by_admin_id: null,
    revoke_reason: null,
    redeemed_at: null,
    redeemed_account_id: null,
    opened_by_existing_account_at: null,
    claimed_at: null,
    claimed_account_id: null,
    redemption_failed_at: null,
    redemption_failed_step: null,
    redemption_error_code: null,
    redemption_error_message: null,
    redemption_failed_account_id: null,
    email_attempted_at: input.email_attempted_at ?? null,
    email_sent_at: null,
    email_provider_message_id: null,
    email_problem: null,
    email_problem_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function championBody(overrides: Record<string, unknown> = {}): CreateInviteBody {
  return createInviteSchema.parse({
    inviteType: CHAMPION_INVITE_TYPE,
    email: 'X@Example.com',
    access: { kind: 'open_ended' },
    linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    language: 'he',
    personalNote: 'Welcome aboard',
    reason: 'QA slice 0 demo',
    sendEmail: false,
    ...overrides,
  });
}

const SENDER = 'team@agentpilot.example';

function harness(
  profile: { data: unknown; error: unknown } = { data: { full_name: 'Dana Levi' }, error: null },
  email: { result?: SendEmailResult; sender?: string | undefined; recorded?: boolean } = {}
) {
  const inserted: CreateBusinessOsInviteInput[] = [];
  const warnings: Array<{ context: Record<string, unknown>; message: string }> = [];
  const sent: SendEmailParams[] = [];
  const deps: CreateInviteDeps = {
    adminId: ADMIN,
    adminEmail: 'Admin@Example.com',
    config,
    now: NOW,
    repository: {
      createForAdmin: jest.fn(async (input: CreateBusinessOsInviteInput) => {
        inserted.push(input);
        return { data: rowFrom(input), error: null };
      }),
      recordInviteEmailOutcome: jest.fn(async () => ({ data: email.recorded ?? true, error: null })),
    },
    profileRepository: {
      findById: jest.fn(async () => profile as never),
    },
    logger: { warn: (context, message) => warnings.push({ context, message }) },
    email: {
      sendEmail: jest.fn(async (params: SendEmailParams) => {
        sent.push(params);
        return email.result ?? { sent: true, provider: 'resend' as const, providerMessageId: 'msg_1' };
      }),
      senderAddress: () => ('sender' in email ? email.sender : SENDER),
      now: () => NOW,
      logger: { info: () => undefined, warn: (context, message) => warnings.push({ context, message }) },
    },
  };
  return { deps, inserted, warnings, sent };
}

describe('createInviteForAdmin', () => {
  it('creates a champion invite: hash stored, token only in the link, expiry stamped from the chosen days', async () => {
    const { deps, inserted } = harness();
    const outcome = await createInviteForAdmin(championBody(), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(inserted).toHaveLength(1);
    const row = inserted[0];

    const prefix = `${platformUrl('/invite')}#t=`;
    expect(outcome.link.startsWith(prefix)).toBe(true);
    const token = outcome.link.slice(prefix.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row.token_hash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(outcome.invite)).not.toContain(token);

    expect(row.email).toBe('x@example.com');
    expect(row.grant_kind).toBe('cohort');
    expect(row.grant_id).toBe(championGrant);
    expect(row.access_open_ended).toBe(true);
    expect(row.access_months).toBeNull();
    expect(row.language).toBe('he');
    expect(row.link_expiry_days).toBe(30);
    expect(row.link_expires_at).toBe('2026-10-31T12:00:00.000Z');
    expect(row.issuer_admin_id).toBe(ADMIN);
  });

  it('a months grant stores the month count and open-ended false', async () => {
    const { deps, inserted } = harness();
    await createInviteForAdmin(championBody({ access: { kind: 'months', months: CHAMPION_ACCESS_MONTHS_MAX } }), deps);
    expect(inserted[0].access_open_ended).toBe(false);
    expect(inserted[0].access_months).toBe(CHAMPION_ACCESS_MONTHS_MAX);
  });

  it('the insert is exactly the allow-list: extra properties on the input never reach the repository', async () => {
    const { deps, inserted } = harness();
    const tampered = {
      ...championBody(),
      grant_id: 'evil',
      issuer_admin_id: 'someone-else',
      issuerAccountId: 'x',
      userId: 'x',
      tokenHash: 'x',
    } as unknown as CreateInviteBody;
    await createInviteForAdmin(tampered, deps);

    expect(Object.keys(inserted[0]).sort()).toEqual(
      [
        'token_hash',
        'email',
        'invite_type',
        'grant_kind',
        'grant_id',
        'access_open_ended',
        'access_months',
        'issuer_admin_id',
        'inviter_display_name',
        'language',
        'personal_note',
        'internal_reason',
        'link_expiry_days',
        'link_expires_at',
        'inviter_reply_to',
        'email_attempted_at',
      ].sort()
    );
    expect(inserted[0].grant_id).toBe(championGrant);
    expect(inserted[0].issuer_admin_id).toBe(ADMIN);
  });

  it('C-6: a Paid invite is refused with 409 before any read or write', async () => {
    const { deps } = harness();
    const body = createInviteSchema.parse({
      inviteType: PAID_INVITE_TYPE,
      email: 'lee@example.com',
      grantId: TIER_ORDER[0],
      linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
      language: 'en',
      reason: 'Referred',
      sendEmail: true,
    });
    const outcome = await createInviteForAdmin(body, deps);
    expect(outcome).toEqual({ ok: false, status: 409, error: 'paid_invites_not_available' });
    expect(deps.email.sendEmail).not.toHaveBeenCalled();
    expect(deps.repository.createForAdmin).not.toHaveBeenCalled();
    expect(deps.profileRepository.findById).not.toHaveBeenCalled();
    expect(INVITE_ISSUANCE_POLICY.paidInvitesAvailable).toBe(false);
  });

  it('C-9: the inviter name is the profile full name, trimmed and capped at 200', async () => {
    const plain = harness({ data: { full_name: '  Dana Levi  ' }, error: null });
    await createInviteForAdmin(championBody(), plain.deps);
    expect(plain.inserted[0].inviter_display_name).toBe('Dana Levi');

    const long = harness({ data: { full_name: 'n'.repeat(250) }, error: null });
    await createInviteForAdmin(championBody(), long.deps);
    expect(long.inserted[0].inviter_display_name).toHaveLength(200);
  });

  it('N-4: the 200 cap counts characters, so an emoji at the boundary is never split into a lone surrogate', async () => {
    const name = `${'n'.repeat(199)}\u{1F600}tail`;
    const { deps, inserted } = harness({ data: { full_name: name }, error: null });
    await createInviteForAdmin(championBody(), deps);
    const stored = inserted[0].inviter_display_name;
    expect(Array.from(stored)).toHaveLength(200);
    expect(stored.endsWith('\u{1F600}')).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(stored)).toBe(false);
  });

  it.each([
    ['a null name', { data: { full_name: null }, error: null }],
    ['a blank name', { data: { full_name: '   ' }, error: null }],
    ['no profile row', { data: null, error: null }],
  ])('C-9: %s falls back to AgentPilot', async (_label, profile) => {
    const { deps, inserted } = harness(profile);
    await createInviteForAdmin(championBody(), deps);
    expect(inserted[0].inviter_display_name).toBe(INVITER_NAME_FALLBACK);
    expect(INVITER_NAME_FALLBACK).toBe('AgentPilot');
  });

  it('C-9: a profile read error falls back to AgentPilot with a warning, and the invite is still created', async () => {
    const { deps, inserted, warnings } = harness({ data: null, error: new Error('profiles down') });
    const outcome = await createInviteForAdmin(championBody(), deps);
    expect(outcome.ok).toBe(true);
    expect(inserted[0].inviter_display_name).toBe(INVITER_NAME_FALLBACK);
    expect(warnings).toHaveLength(1);
  });

  it('an empty note is stored as null', async () => {
    const { deps, inserted } = harness();
    await createInviteForAdmin(championBody({ personalNote: '   ' }), deps);
    expect(inserted[0].personal_note).toBeNull();
  });

  it('a repository failure is a 500 that carries no token', async () => {
    const { deps } = harness();
    deps.repository.createForAdmin = jest.fn(async () => ({ data: null, error: new Error('insert failed') }));
    const outcome = await createInviteForAdmin(championBody(), deps);
    expect(outcome).toEqual({ ok: false, status: 500, error: 'could_not_create_invite' });
  });

  it('a grant that has left the config is refused with 409 before any write', async () => {
    const { deps } = harness();
    const stripped = { ...config, cohorts: {} as typeof config.cohorts };
    const outcome = await createInviteForAdmin(championBody(), { ...deps, config: stripped });
    expect(outcome).toEqual({ ok: false, status: 409, error: 'grant_not_available' });
    expect(deps.repository.createForAdmin).not.toHaveBeenCalled();
  });
});

describe('Slice 2a: the invitation email on create (FR-14 to FR-16)', () => {
  it('sendEmail false: nothing is sent, no attempt stamped, and the result says not_emailed', async () => {
    const { deps, inserted, sent } = harness();
    const outcome = await createInviteForAdmin(championBody({ sendEmail: false }), deps);
    expect(outcome.ok && outcome.email).toEqual({ requested: false, status: 'not_emailed' });
    expect(sent).toHaveLength(0);
    expect(inserted[0].email_attempted_at).toBeNull();
    expect(deps.repository.recordInviteEmailOutcome).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.invite.emailStatus).toBe('not_emailed');
  });

  it('sendEmail true: attempt stamped with the row, sent AFTER the insert, the link equals the returned link', async () => {
    const { deps, inserted, sent } = harness();
    const outcome = await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(inserted[0].email_attempted_at).toBe(NOW.toISOString());
    expect(sent).toHaveLength(1);
    expect(sent[0].html).toContain(outcome.link);
    expect(sent[0].to).toEqual(['x@example.com']);
    expect(sent[0].from).toBe(`"Dana Levi via AgentPilot" <${SENDER}>`);
    expect(outcome.email).toEqual({ requested: true, status: 'sent', provider: 'resend', providerMessageId: 'msg_1', recorded: true });
    expect(outcome.invite.emailStatus).toBe('sent');
  });

  it('R-12: the plan name in the email is the planLabel computed here', async () => {
    const { deps, sent } = harness();
    await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(sent[0].html).toContain(planLabel(config, championGrant));
  });

  it('D-2: the Reply-To is the gate email, normalised, snapshotted on the row; missing → null and no replyTo', async () => {
    const withEmail = harness();
    await createInviteForAdmin(championBody({ sendEmail: true }), withEmail.deps);
    expect(withEmail.inserted[0].inviter_reply_to).toBe('admin@example.com');
    expect(withEmail.sent[0].replyTo).toBe('admin@example.com');

    const without = harness();
    without.deps.adminEmail = undefined;
    await createInviteForAdmin(championBody({ sendEmail: true }), without.deps);
    expect(without.inserted[0].inviter_reply_to).toBeNull();
    expect(Object.keys(without.sent[0])).not.toContain('replyTo');

    const garbage = harness();
    garbage.deps.adminEmail = 'not an address';
    await createInviteForAdmin(championBody({ sendEmail: false }), garbage.deps);
    expect(garbage.inserted[0].inviter_reply_to).toBeNull();
    expect(garbage.warnings.some((entry) => /Reply-To/.test(entry.message))).toBe(true);
  });

  it('R-2: sender not configured → still created, link returned, not_sent + sender_not_configured, nothing sent', async () => {
    const { deps, sent } = harness(undefined, { sender: undefined });
    const outcome = await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(sent).toHaveLength(0);
    expect(outcome.link).toMatch(/#t=/);
    expect(outcome.email).toEqual({ requested: true, status: 'not_sent', reason: 'sender_not_configured', recorded: true });
    expect(outcome.invite.emailStatus).toBe('not_sent');
  });

  it('FR-16: a transport failure is still a created invite with its link, shown as not_sent', async () => {
    const { deps } = harness(undefined, { result: { sent: false, provider: 'none', error: 'resend: 500' } });
    const outcome = await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.link).toMatch(/#t=/);
    expect(outcome.email).toMatchObject({ requested: true, status: 'not_sent', reason: 'transport_failed' });
  });

  it('an outcome that could not be recorded is shown as unknown (what the list will say)', async () => {
    const { deps } = harness(undefined, { recorded: false });
    const outcome = await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(outcome.ok && outcome.email).toMatchObject({ status: 'sent', recorded: false });
    expect(outcome.ok && outcome.invite.emailStatus).toBe('unknown');
  });

  it('SMTP / Gmail (no message id) → sent_untracked', async () => {
    const { deps } = harness(undefined, { result: { sent: true, provider: 'gmail' } });
    const outcome = await createInviteForAdmin(championBody({ sendEmail: true }), deps);
    expect(outcome.ok && outcome.invite.emailStatus).toBe('sent_untracked');
  });
});

describe('resolveInviteFormLanguage (Slice 2a, C-8 as amended, D-8)', () => {
  const warnings: string[] = [];
  const logger = { warn: (_context: Record<string, unknown>, message: string) => warnings.push(message) };

  beforeEach(() => {
    warnings.length = 0;
  });

  it('reads the admin preference by the admin id', async () => {
    const findPreferredLanguage = jest.fn(async () => ({ data: 'he' as const, error: null }));
    expect(await resolveInviteFormLanguage({ adminId: ADMIN, preferences: { findPreferredLanguage }, logger })).toBe('he');
    expect(findPreferredLanguage).toHaveBeenCalledWith(ADMIN);
  });

  it('no usable preference → en, silently', async () => {
    const findPreferredLanguage = jest.fn(async () => ({ data: null, error: null }));
    expect(await resolveInviteFormLanguage({ adminId: ADMIN, preferences: { findPreferredLanguage }, logger })).toBe('en');
    expect(warnings).toHaveLength(0);
  });

  it('a read error or a throw → en with a warning', async () => {
    const errored = jest.fn(async () => ({ data: null, error: new Error('db') }));
    expect(await resolveInviteFormLanguage({ adminId: ADMIN, preferences: { findPreferredLanguage: errored }, logger })).toBe('en');
    const thrown = jest.fn(async () => {
      throw new Error('boom');
    });
    expect(await resolveInviteFormLanguage({ adminId: ADMIN, preferences: { findPreferredLanguage: thrown }, logger })).toBe('en');
    expect(warnings).toHaveLength(2);
  });
});

describe('toInviteListView (R-7)', () => {
  const input: CreateBusinessOsInviteInput = {
    token_hash: 'a'.repeat(64),
    email: 'x@example.com',
    invite_type: CHAMPION_INVITE_TYPE,
    grant_kind: 'cohort',
    grant_id: championGrant,
    access_open_ended: true,
    access_months: null,
    issuer_admin_id: ADMIN,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: 'Hi',
    internal_reason: 'Secret internal reason',
    link_expiry_days: 30,
    link_expires_at: '2026-10-31T12:00:00.000Z',
    inviter_reply_to: 'admin@example.com',
    email_attempted_at: null,
  };

  it('Slice 5a (F5a-11): an admin invite reads as admin-issued, with no account id and no inviter revoke', () => {
    const view = toInviteListView(rowFrom(input), config, NOW);
    expect(view).toMatchObject({ issuerKind: 'admin', issuerAccountId: null, revokedByInviter: false });
  });

  it('Slice 5a (F5a-11, F5a-8): a champion friend invite shows the champion account, and a revoke with no admin id is by the inviter', () => {
    const CHAMPION = '44444444-4444-4444-8444-444444444444';
    const friend = rowFrom(input, {
      issuer_kind: 'account',
      issuer_admin_id: null,
      issuer_account_id: CHAMPION,
      invite_type: PAID_INVITE_TYPE,
      grant_kind: 'tier',
      grant_id: TIER_ORDER[0],
      access_open_ended: null,
    });
    expect(toInviteListView(friend, config, NOW)).toMatchObject({ issuerKind: 'account', issuerAccountId: CHAMPION, revokedByInviter: false });

    const byInviter = { ...friend, revoked_at: '2026-10-01T00:00:00.000Z', revoked_by_admin_id: null, revoke_reason: 'Revoked by the inviting champion' };
    expect(toInviteListView(byInviter, config, NOW)).toMatchObject({ state: 'revoked', revokedByInviter: true });

    const byAdmin = { ...byInviter, revoked_by_admin_id: ADMIN };
    expect(toInviteListView(byAdmin, config, NOW).revokedByInviter).toBe(false);
  });

  it('Slice 2a: carries the derived email status, never the message id or the Reply-To', () => {
    expect(toInviteListView(rowFrom(input), config, NOW)).toMatchObject({ emailStatus: 'not_emailed', emailStatusAt: null });
    const sent = toInviteListView(
      rowFrom(input, {
        email_attempted_at: NOW.toISOString(),
        email_sent_at: '2026-10-01T12:00:03.000Z',
        email_provider_message_id: 'msg_secretish',
      }),
      config,
      NOW
    );
    expect(sent).toMatchObject({ emailStatus: 'sent', emailStatusAt: '2026-10-01T12:00:03.000Z' });
    const serialised = JSON.stringify(sent);
    expect(serialised).not.toContain('msg_secretish');
    expect(serialised).not.toContain('admin@example.com');
    for (const key of ['emailProviderMessageId', 'email_provider_message_id', 'emailProblemDetail', 'inviterReplyTo']) {
      expect(sent).not.toHaveProperty(key);
    }
  });

  it('has exactly the list-row keys, and none of the hidden columns', () => {
    const view = toInviteListView(rowFrom(input, { redeemed_account_id: null }), config, NOW);
    expect(Object.keys(view).sort()).toEqual([...INVITE_LIST_VIEW_KEYS].sort());
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('Secret internal reason');
    expect(serialised).not.toContain(ADMIN);
    expect(serialised).not.toContain('a'.repeat(64));
    for (const key of ['token_hash', 'tokenHash', 'issuer_admin_id', 'internal_reason', 'redeemed_account_id']) {
      expect(view).not.toHaveProperty(key);
    }
  });

  it('Slice 1a: carries the existing-account stamp through unchanged', () => {
    expect(toInviteListView(rowFrom(input), config, NOW).openedByExistingAccountAt).toBeNull();
    const stamped = toInviteListView(
      rowFrom(input, { opened_by_existing_account_at: '2026-10-02T09:00:00.000Z' }),
      config,
      NOW
    );
    expect(stamped.openedByExistingAccountAt).toBe('2026-10-02T09:00:00.000Z');
    expect(stamped.state).toBe('pending');
  });

  it('labels the grant from config and derives the state', () => {
    const view = toInviteListView(rowFrom(input), config, NOW);
    expect(view.grantLabel).toBe(planLabel(config, championGrant));
    expect(view.accessSummary).toBe('No end date');
    expect(view.state).toBe('pending');
    expect(toInviteListView(rowFrom(input), config, new Date('2026-11-01T00:00:00.000Z')).state).toBe('expired');
  });
});

describe('buildInviteFormOptions', () => {
  const options = buildInviteFormOptions(config);

  it('Slice 2a (D-8): pre-selects the language it is given, and only a supported one', () => {
    expect(buildInviteFormOptions(config, 'he').defaultLanguage).toBe('he');
    expect(buildInviteFormOptions(config, 'es').defaultLanguage).toBe('es');
    expect(buildInviteFormOptions(config, 'fr' as never).defaultLanguage).toBe('en');
  });

  it('expiry options and default from config; languages from the locale list; default en (C-8 as amended)', () => {
    expect(options.expiryDays).toEqual([...INVITE_LINK_EXPIRY.optionsDays]);
    expect(options.defaultExpiryDays).toBe(INVITE_LINK_EXPIRY.defaultDays);
    expect(options.languages).toEqual([...locales]);
    expect(options.defaultLanguage).toBe('en');
    expect(options.championAccessMonthsMax).toBe(CHAMPION_ACCESS_MONTHS_MAX);
  });

  it('champion is available and needs an access decision; paid is shown disabled with its reason', () => {
    const [champion, paid] = options.inviteTypes;
    expect(champion.type).toBe(CHAMPION_INVITE_TYPE);
    expect(champion.available).toBe(true);
    expect(champion.requiresAccess).toBe(true);
    expect(champion.label).toBe(`Champion (${planLabel(config, championGrant)})`);
    expect(champion.grants).toEqual([]);

    expect(paid.type).toBe(PAID_INVITE_TYPE);
    expect(paid.available).toBe(false);
    expect(paid.unavailableReason).toBe('available when payments are live');
    expect(paid.requiresAccess).toBe(false);
    expect(paid.grants.map((grant) => grant.id)).toEqual([...TIER_ORDER]);
    expect(paid.grants.filter((grant) => grant.default).map((grant) => grant.id)).toEqual([TIER_ORDER[0]]);
  });
});

describe('listInvitesForAdmin', () => {
  it('maps each row through the list view', async () => {
    const row = rowFrom({
      token_hash: 'a'.repeat(64),
      email: 'x@example.com',
      invite_type: CHAMPION_INVITE_TYPE,
      grant_kind: 'cohort',
      grant_id: championGrant,
      access_open_ended: true,
      access_months: null,
      issuer_admin_id: ADMIN,
      inviter_display_name: 'Dana',
      language: 'en',
      personal_note: null,
      internal_reason: 'Reason',
      link_expiry_days: 30,
      link_expires_at: '2026-10-31T12:00:00.000Z',
    });
    const outcome = await listInvitesForAdmin({
      repository: { listRecentForAdmin: async () => ({ data: [row], error: null }) },
      config,
      now: NOW,
    });
    expect(outcome).toEqual({
      ok: true,
      invites: [toInviteListView(row, config, NOW)],
      stoppedHalfway: { count: 0, inviteIds: [] },
      truncated: false,
    });
  });

  it('SA N-3: a failed lineage read is logged, and the list still answers with unknown levels', async () => {
    const row = rowFrom(
      {
        token_hash: 'a'.repeat(64),
        email: 'x@example.com',
        invite_type: CHAMPION_INVITE_TYPE,
        grant_kind: 'cohort',
        grant_id: championGrant,
        access_open_ended: true,
        access_months: null,
        issuer_admin_id: ADMIN,
        inviter_display_name: 'Dana',
        language: 'en',
        personal_note: null,
        internal_reason: 'Reason',
        link_expiry_days: 30,
        link_expires_at: '2026-10-31T12:00:00.000Z',
      },
      { redeemed_at: NOW.toISOString(), redeemed_account_id: 'acct-1', claimed_at: NOW.toISOString(), claimed_account_id: 'acct-1' }
    );
    const warnings: unknown[] = [];
    const outcome = await listInvitesForAdmin({
      repository: { listRecentForAdmin: async () => ({ data: [row], error: null }) },
      lineage: { findByInviteIdsForAdmin: async () => ({ data: null, error: new Error('timeout') }) },
      config,
      now: NOW,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.invites[0].level).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  describe('Slice 1c: the 500 ceiling and `truncated` (SA F-9)', () => {
    const base = rowFrom({
      token_hash: 'a'.repeat(64),
      email: 'x@example.com',
      invite_type: CHAMPION_INVITE_TYPE,
      grant_kind: 'cohort',
      grant_id: championGrant,
      access_open_ended: true,
      access_months: null,
      issuer_admin_id: ADMIN,
      inviter_display_name: 'Dana',
      language: 'en',
      personal_note: null,
      internal_reason: 'Reason',
      link_expiry_days: 30,
      link_expires_at: '2026-10-31T12:00:00.000Z',
    });
    const rows = (count: number, overrides: Partial<BusinessOsInvite> = {}) =>
      Array.from({ length: count }, (_value, index) => ({
        ...base,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ...overrides,
      }));

    it('the ceiling is 500, and the repository clamps to the same number', () => {
      expect(INVITE_LIST_CEILING).toBe(500);
      expect(BUSINESS_OS_INVITE_LIST_LIMIT).toBe(INVITE_LIST_CEILING);
    });

    it('asks the repository for exactly the ceiling', async () => {
      const listRecentForAdmin = jest.fn(async () => ({ data: [], error: null }));
      await listInvitesForAdmin({ repository: { listRecentForAdmin }, config, now: NOW });
      expect(listRecentForAdmin).toHaveBeenCalledWith({ limit: 500 });
    });

    it.each([
      [0, false],
      [499, false],
      [500, true],
    ])('%i rows: truncated is %s, and every row is returned', async (count, truncated) => {
      const outcome = await listInvitesForAdmin({
        repository: { listRecentForAdmin: async () => ({ data: rows(count), error: null }) },
        config,
        now: NOW,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.invites).toHaveLength(count);
        expect(outcome.truncated).toBe(truncated);
      }
    });

    it('reads lineage for more than 200 accepted rows in batches the lookup accepts', async () => {
      expect(INVITE_LINEAGE_BATCH).toBeLessThanOrEqual(LINEAGE_LOOKUP_LIMIT);
      const accepted = rows(450, { redeemed_at: NOW.toISOString(), redeemed_account_id: 'acct-1' });
      const batches: number[] = [];
      const outcome = await listInvitesForAdmin({
        repository: { listRecentForAdmin: async () => ({ data: accepted, error: null }) },
        lineage: {
          // Refuses an oversized batch, as the real lookup does.
          findByInviteIdsForAdmin: async (ids: string[]) => {
            batches.push(ids.length);
            if (ids.length > LINEAGE_LOOKUP_LIMIT) return { data: null, error: new Error('too many ids') };
            return { data: ids.map((id) => ({ account_id: 'acct-1', invite_id: id, level: 1 })), error: null };
          },
        },
        config,
        now: NOW,
      });
      expect(batches).toEqual([200, 200, 50]);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.invites.every((invite) => invite.level === 1)).toBe(true);
    });
  });

  it('a repository error is { ok: false }', async () => {
    const outcome = await listInvitesForAdmin({
      repository: { listRecentForAdmin: async () => ({ data: null, error: new Error('boom') }) },
      config,
      now: NOW,
    });
    expect(outcome).toEqual({ ok: false });
  });
});

describe('revokeInviteForAdmin', () => {
  const base = rowFrom({
    token_hash: 'a'.repeat(64),
    email: 'x@example.com',
    invite_type: CHAMPION_INVITE_TYPE,
    grant_kind: 'cohort',
    grant_id: championGrant,
    access_open_ended: true,
    access_months: null,
    issuer_admin_id: ADMIN,
    inviter_display_name: 'Dana',
    language: 'en',
    personal_note: null,
    internal_reason: 'Reason',
    link_expiry_days: 30,
    link_expires_at: '2026-10-31T12:00:00.000Z',
  });

  function deps(revoked: { data: BusinessOsInvite | null; error: Error | null }, existing: { data: BusinessOsInvite | null; error: Error | null }) {
    return {
      adminId: ADMIN,
      config,
      now: NOW,
      repository: {
        revokeForAdmin: jest.fn(async () => revoked),
        findByIdForAdmin: jest.fn(async () => existing),
      },
    };
  }

  it('revoked: the row comes back as a list view with state revoked', async () => {
    const revokedRow = { ...base, revoked_at: NOW.toISOString(), revoked_by_admin_id: ADMIN, revoke_reason: 'Wrong person' };
    const d = deps({ data: revokedRow, error: null }, { data: null, error: null });
    const outcome = await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, d);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.invite.state).toBe('revoked');
    expect(d.repository.revokeForAdmin).toHaveBeenCalledWith({
      id: INVITE_ID,
      adminId: ADMIN,
      reason: 'Wrong person',
      now: NOW,
      claimLeaseCutoff: new Date(NOW.getTime() - 120_000),
    });
    expect(d.repository.findByIdForAdmin).not.toHaveBeenCalled();
  });

  it('no row matched and none exists: 404', async () => {
    const outcome = await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: null }, { data: null, error: null }));
    expect(outcome).toEqual({ ok: false, status: 404, error: 'invite_not_found' });
  });

  it('no row matched but it exists (accepted or already revoked): 409', async () => {
    const outcome = await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: null }, { data: base, error: null }));
    expect(outcome).toEqual({ ok: false, status: 409, error: 'invite_not_revocable' });
  });

  it('Slice 1b (I-2): a LIVE signup claim answers 409 signup_in_progress', async () => {
    const claimed = { ...base, claimed_at: new Date(NOW.getTime() - 30_000).toISOString(), claimed_account_id: '55555555-5555-4555-8555-555555555555' };
    const outcome = await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: null }, { data: claimed, error: null }));
    expect(outcome).toEqual({ ok: false, status: 409, error: 'signup_in_progress' });
  });

  it('Slice 1b: a LAPSED claim is not "in progress" (the CAS decided; the answer is the generic 409)', async () => {
    const stale = { ...base, claimed_at: new Date(NOW.getTime() - 600_000).toISOString(), claimed_account_id: '55555555-5555-4555-8555-555555555555' };
    const outcome = await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: null }, { data: stale, error: null }));
    expect(outcome).toEqual({ ok: false, status: 409, error: 'invite_not_revocable' });
  });

  it('a repository error is a 500', async () => {
    expect(
      await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: new Error('x') }, { data: null, error: null }))
    ).toEqual({ ok: false, status: 500, error: 'could_not_revoke_invite' });
    expect(
      await revokeInviteForAdmin(INVITE_ID, { reason: 'Wrong person' }, deps({ data: null, error: null }, { data: null, error: new Error('x') }))
    ).toEqual({ ok: false, status: 500, error: 'could_not_revoke_invite' });
  });
});

describe('inviterNameFromProfile (C-9; Slice 5a SA R-1: one fallback for admins and champions)', () => {
  it.each([
    ['Dana Champion', 'Dana Champion'],
    ['  Dana  ', 'Dana'],
    [null, INVITER_NAME_FALLBACK],
    ['   ', INVITER_NAME_FALLBACK],
    [42, INVITER_NAME_FALLBACK],
  ])('%p → %p', (input, expected) => {
    expect(inviterNameFromProfile(input)).toBe(expected);
  });

  it('caps at the database limit, cut on a whole code point', () => {
    expect(Array.from(inviterNameFromProfile('😀'.repeat(250)))).toHaveLength(200);
  });
});
