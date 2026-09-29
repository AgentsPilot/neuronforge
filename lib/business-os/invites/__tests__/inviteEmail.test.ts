/**
 * Sending one invitation email (Slice 2a; FR-14 to FR-16, T-7, T-11; D-1a,
 * D-4 to D-7; SA R-2, R-9, R-12), with the REQUIRED leak test: no logger call
 * holds the token, the link, the hash or the invitee email.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { RecordInviteEmailOutcomeInput } from '@/lib/repositories/types';

import {
  deriveInviteEmailStatus,
  scrubProblemDetail,
  sendInvitationEmail,
  type InvitationEmailDeps,
  type InvitationEmailRow,
  type InviteEmailStatusRow,
} from '../inviteEmail';
import { INVITE_EMAIL_POLICY } from '../inviteEmailPolicy';
import { buildInviteLink, generateInviteToken, hashInviteToken } from '../inviteToken';

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const INVITEE = 'invitee@example.com';
const REPLY_TO = 'admin@example.com';
const SENDER = 'team@agentpilot.example';
const NOW = new Date('2026-10-01T12:00:00.000Z');

function row(overrides: Partial<InvitationEmailRow> = {}): InvitationEmailRow {
  return {
    id: INVITE_ID,
    email: INVITEE,
    grant_kind: 'cohort',
    access_open_ended: false,
    access_months: 12,
    inviter_display_name: 'Dana Levi',
    language: 'he',
    personal_note: 'Line one\nLine two',
    link_expires_at: '2026-10-31T12:00:00.000Z',
    ...overrides,
  };
}

interface Harness {
  deps: InvitationEmailDeps;
  sent: SendEmailParams[];
  recorded: RecordInviteEmailOutcomeInput[];
  logs: Array<{ level: string; context: Record<string, unknown>; message: string }>;
}

function harness(options: {
  result?: SendEmailResult | Error;
  sender?: string | undefined;
  record?: { data: boolean | null; error: Error | null } | Error;
} = {}): Harness {
  const sent: SendEmailParams[] = [];
  const recorded: RecordInviteEmailOutcomeInput[] = [];
  const logs: Harness['logs'] = [];
  const deps: InvitationEmailDeps = {
    sendEmail: async (params) => {
      sent.push(params);
      const result = options.result ?? { sent: true, provider: 'resend', providerMessageId: 'msg_123' };
      if (result instanceof Error) throw result;
      return result;
    },
    senderAddress: () => ('sender' in options ? options.sender : SENDER),
    repository: {
      recordInviteEmailOutcome: async (input) => {
        recorded.push(input);
        const answer = options.record ?? { data: true, error: null };
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    now: () => NOW,
    logger: {
      info: (context, message) => logs.push({ level: 'info', context, message }),
      warn: (context, message) => logs.push({ level: 'warn', context, message }),
    },
  };
  return { deps, sent, recorded, logs };
}

describe('sender fails closed (SA R-2)', () => {
  it.each([
    ['unset', undefined],
    ['blank', ''],
  ])('%s sender: no send at all, not_sent + sender_not_configured recorded, and a warning', async (_label, sender) => {
    const h = harness({ sender });
    const token = generateInviteToken();
    const outcome = await sendInvitationEmail({ row: row(), token, planName: 'Founding Partner', replyTo: REPLY_TO }, h.deps);

    expect(h.sent).toHaveLength(0);
    expect(outcome).toEqual({ status: 'not_sent', reason: 'sender_not_configured', recorded: true });
    expect(h.recorded).toEqual([
      {
        id: INVITE_ID,
        tokenHash: hashInviteToken(token),
        now: NOW,
        outcome: { kind: 'problem', problem: 'not_sent', detail: 'sender_not_configured' },
      },
    ]);
    expect(h.logs.some((entry) => entry.level === 'warn' && entry.context.reason === 'sender_not_configured')).toBe(true);
  });

  it('a sender lookup that throws is treated as not configured', async () => {
    const h = harness();
    h.deps.senderAddress = () => {
      throw new Error('boom');
    };
    const outcome = await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: null }, h.deps);
    expect(outcome.status).toBe('not_sent');
    expect(h.sent).toHaveLength(0);
  });
});

describe('the send (T-11, R-9)', () => {
  it('passes exactly the transport parameters: transactional, from, replyTo, both redactions, and NO ownerUserId', async () => {
    const h = harness();
    const token = generateInviteToken();
    await sendInvitationEmail({ row: row(), token, planName: 'Founding Partner', replyTo: REPLY_TO }, h.deps);

    expect(h.sent).toHaveLength(1);
    const params = h.sent[0];
    expect(params.kind).toBe('transactional');
    expect(params.to).toEqual([INVITEE]);
    expect(params.from).toBe(`"Dana Levi via AgentPilot" <${SENDER}>`);
    expect(params.replyTo).toBe(REPLY_TO);
    expect(params.redactRecipientInLogs).toBe(true);
    // QA2a-2: plus a fixed prefix of the token.
    expect(params.redactInLogs).toEqual([token, buildInviteLink(token), token.slice(0, INVITE_EMAIL_POLICY.tokenPrefixRedactLength)]);
    expect(Object.keys(params)).not.toContain('ownerUserId');
    expect(Object.keys(params)).not.toContain('unsubscribeUrl');
  });

  it('the emailed link is byte for byte buildInviteLink(token), and not in the subject', async () => {
    const h = harness();
    const token = generateInviteToken();
    await sendInvitationEmail({ row: row(), token, planName: 'Founding Partner', replyTo: REPLY_TO }, h.deps);
    const params = h.sent[0];
    expect(params.html).toContain(buildInviteLink(token));
    expect(params.text).toContain(buildInviteLink(token));
    expect(params.subject).not.toContain(token);
  });

  it('renders in the invite language (Hebrew, right to left) with the note', async () => {
    const h = harness();
    await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'Founding Partner', replyTo: REPLY_TO }, h.deps);
    expect(h.sent[0].html).toContain('dir="rtl"');
    expect(h.sent[0].html).toContain('Line one<br>Line two');
  });

  it('the fallback inviter name sends as AgentPilot <address>', async () => {
    const h = harness();
    await sendInvitationEmail({ row: row({ inviter_display_name: 'AgentPilot' }), token: generateInviteToken(), planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(h.sent[0].from).toBe(`AgentPilot <${SENDER}>`);
    expect(h.sent[0].subject).not.toContain('AgentPilot invited');
  });

  it('no Reply-To snapshot: the send goes out with no replyTo key, and a warning', async () => {
    const h = harness();
    await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: null }, h.deps);
    expect(Object.keys(h.sent[0])).not.toContain('replyTo');
    expect(h.logs.some((entry) => entry.level === 'warn' && /Reply-To/.test(entry.message))).toBe(true);
  });

  it('a tier invite says payment required', async () => {
    const h = harness();
    await sendInvitationEmail({ row: row({ grant_kind: 'tier', access_open_ended: null, access_months: null, language: 'en' }), token: generateInviteToken(), planName: 'Pro', replyTo: REPLY_TO }, h.deps);
    expect(h.sent[0].html).toContain('Payment required');
  });
});

describe('outcomes and the CAS write-back (D-5, D-6)', () => {
  it('Resend with an id → sent, the id recorded by (id, token hash)', async () => {
    const h = harness();
    const token = generateInviteToken();
    const outcome = await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(outcome).toEqual({ status: 'sent', provider: 'resend', providerMessageId: 'msg_123', recorded: true });
    expect(h.recorded).toEqual([
      { id: INVITE_ID, tokenHash: hashInviteToken(token), now: NOW, outcome: { kind: 'sent', providerMessageId: 'msg_123' } },
    ]);
  });

  it.each(['smtp', 'gmail'] as const)('%s (no id) → sent_untracked', async (provider) => {
    const h = harness({ result: { sent: true, provider } });
    const outcome = await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(outcome).toEqual({ status: 'sent_untracked', provider, providerMessageId: null, recorded: true });
    expect(h.recorded[0].outcome).toEqual({ kind: 'sent', providerMessageId: null });
  });

  it('a transport failure → not_sent, detail scrubbed of token, link, hash and email, capped at 300', async () => {
    const token = generateInviteToken();
    const link = buildInviteLink(token);
    const error = `resend: rejected ${link} for ${INVITEE} raw ${token} hash ${hashInviteToken(token)} ${'x'.repeat(400)}`;
    const h = harness({ result: { sent: false, provider: 'none', error } });
    const outcome = await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);

    expect(outcome).toEqual({ status: 'not_sent', reason: 'transport_failed', recorded: true });
    const recorded = h.recorded[0].outcome;
    expect(recorded.kind).toBe('problem');
    const detail = recorded.kind === 'problem' ? recorded.detail ?? '' : '';
    expect(detail.startsWith('transport_failed: ')).toBe(true);
    expect(detail).not.toContain(token);
    expect(detail).not.toContain(INVITEE);
    expect(detail).not.toContain(hashInviteToken(token));
    expect(detail).not.toContain('invite#t=');
    expect(Array.from(detail).length).toBeLessThanOrEqual(300);
  });

  it('a send that THROWS still ends as not_sent, never an exception (the invite and link survive)', async () => {
    const token = generateInviteToken();
    const h = harness({ result: new Error(`kaboom ${buildInviteLink(token)}`) });
    const outcome = await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(outcome).toEqual({ status: 'not_sent', reason: 'transport_failed', recorded: true });
    expect(JSON.stringify(h.logs)).not.toContain(token);
    expect(JSON.stringify(h.recorded)).not.toContain(token);
  });

  it('a lost CAS (the link was replaced) or a failed write is a warning, and recorded: false', async () => {
    for (const record of [{ data: false, error: null }, { data: null, error: new Error('db down') }, new Error('thrown')]) {
      const h = harness({ record });
      const outcome = await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: REPLY_TO }, h.deps);
      expect(outcome.status).toBe('sent');
      expect(outcome.recorded).toBe(false);
      expect(h.logs.some((entry) => entry.level === 'warn' && /unknown/.test(entry.message))).toBe(true);
    }
  });
});

describe('REQUIRED leak test (D-4, R-9, T-7)', () => {
  it.each([
    ['sent', { sent: true, provider: 'resend', providerMessageId: 'msg_9' } as SendEmailResult],
    ['not sent', { sent: false, provider: 'none', error: 'resend: bad request' } as SendEmailResult],
  ])('%s: no logger call holds the token, the link, the hash or the invitee email', async (_label, result) => {
    const token = generateInviteToken();
    const h = harness({ result });
    await sendInvitationEmail({ row: row(), token, planName: 'Founding Partner', replyTo: REPLY_TO }, h.deps);

    const serialised = JSON.stringify(h.logs);
    expect(h.logs.length).toBeGreaterThan(0);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(buildInviteLink(token));
    expect(serialised).not.toContain(hashInviteToken(token));
    expect(serialised).not.toContain(INVITEE);
    expect(serialised).not.toContain(REPLY_TO);
  });

  it('the recorded outcome holds no token, link or email (the hash is only the CAS key)', async () => {
    const token = generateInviteToken();
    const h = harness({ result: { sent: false, provider: 'none', error: `echo ${INVITEE} ${buildInviteLink(token)}` } });
    await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);
    const outcome = JSON.stringify(h.recorded.map((entry) => entry.outcome));
    expect(outcome).not.toContain(token);
    expect(outcome).not.toContain(INVITEE);
  });
});

describe('scrubProblemDetail', () => {
  it('replaces the longest secret first, then email-shaped text, and caps by code points', () => {
    expect(scrubProblemDetail('see https://x/invite#t=abc and abc and a@b.io', ['abc', 'https://x/invite#t=abc'])).toBe(
      'see [redacted] and [redacted] and [email]'
    );
    expect(Array.from(scrubProblemDetail('😀'.repeat(400), []))).toHaveLength(300);
    expect(scrubProblemDetail('plain', ['', 'x'])).toBe('plain');
  });
});

describe('deriveInviteEmailStatus (D-7, one derivation)', () => {
  const base: InviteEmailStatusRow = {
    email_attempted_at: null,
    email_sent_at: null,
    email_provider_message_id: null,
    email_problem: null,
    email_problem_at: null,
  };
  const A = '2026-10-01T12:00:00.000Z';
  const B = '2026-10-01T12:00:02.000Z';

  it.each([
    ['no attempt', {}, 'not_emailed', null],
    ['attempted, nothing recorded', { email_attempted_at: A }, 'unknown', A],
    ['not sent', { email_attempted_at: A, email_problem: 'not_sent', email_problem_at: B }, 'not_sent', B],
    ['sent with an id', { email_attempted_at: A, email_sent_at: B, email_provider_message_id: 'msg' }, 'sent', B],
    ['sent without an id', { email_attempted_at: A, email_sent_at: B }, 'sent_untracked', B],
    ['a 2c delivery problem', { email_attempted_at: A, email_sent_at: A, email_problem: 'bounced', email_problem_at: B }, 'unknown', B],
  ] as const)('%s → %s', (_label, overrides, status, at) => {
    expect(deriveInviteEmailStatus({ ...base, ...overrides })).toEqual({ status, at });
  });
});

describe('R-12: imports nothing from the entitlements module', () => {
  it('the source has no import from lib/business-os/entitlements', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'inviteEmail.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*business-os\/entitlements/);
    expect(source).not.toMatch(/from\s+['"]\.\.\/entitlements/);
  });

  it('never names ownerUserId in code (T-11), and builds the link only through buildInviteLink (R-9)', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'invites', 'inviteEmail.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('ownerUserId');
    expect(code).not.toContain('platformUrl');
    expect(code).not.toMatch(/#t=/);
    expect(code).toContain('buildInviteLink(token)');
  });
});

describe('QA2a-1: a hanging provider cannot outlive the route', () => {
  it('a transport that never resolves ends as unknown / send_timeout, writes nothing, and warns', async () => {
    const h = harness();
    h.deps.sendEmail = () => new Promise<SendEmailResult>(() => undefined);
    h.deps.sendTimeoutMs = 20;
    const token = generateInviteToken();

    const outcome = await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);

    expect(outcome).toEqual({ status: 'unknown', reason: 'send_timeout', recorded: false });
    expect(h.recorded).toHaveLength(0);
    expect(h.logs.some((entry) => entry.level === 'warn' && entry.context.reason === 'send_timeout')).toBe(true);
    expect(JSON.stringify(h.logs)).not.toContain(token);
  });

  it('a late answer after the timeout is ignored (nothing is recorded afterwards)', async () => {
    const h = harness();
    let answer: (value: SendEmailResult) => void = () => undefined;
    h.deps.sendEmail = () => new Promise<SendEmailResult>((resolve) => (answer = resolve));
    h.deps.sendTimeoutMs = 10;
    const outcome = await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: REPLY_TO }, h.deps);
    answer({ sent: true, provider: 'resend', providerMessageId: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(outcome.status).toBe('unknown');
    expect(h.recorded).toHaveLength(0);
  });

  it('a prompt answer is unaffected, and the timer does not keep the process alive', async () => {
    const h = harness();
    h.deps.sendTimeoutMs = 60_000;
    const outcome = await sendInvitationEmail({ row: row(), token: generateInviteToken(), planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(outcome.status).toBe('sent');
  });

  it('the default limit is the policy constant, about 20 s', () => {
    expect(INVITE_EMAIL_POLICY.sendTimeoutMs).toBe(20_000);
  });

  it('QA2a-2: a provider error echoing only the token prefix is scrubbed from the stored detail', async () => {
    const token = generateInviteToken();
    const prefix = token.slice(0, INVITE_EMAIL_POLICY.tokenPrefixRedactLength);
    const h = harness({ result: { sent: false, provider: 'none', error: `truncated https://x/invite#t=${prefix}...` } });
    await sendInvitationEmail({ row: row(), token, planName: 'P', replyTo: REPLY_TO }, h.deps);
    expect(JSON.stringify(h.recorded)).not.toContain(prefix);
  });
});
