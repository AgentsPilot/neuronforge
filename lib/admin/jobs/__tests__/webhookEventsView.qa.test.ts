/**
 * QA edge cases for the "Stripe webhook events" builder (plan payments
 * P-8b.3b, AM-4; SA P3-SA-2 items 2, 3 and 7, P3-SA-6, P3-SA-7).
 *
 * Adds to the Dev suite: the time basis for created given as a string, zero,
 * negative, fractional or in the future (each at builder level, not only in
 * `stripeCreatedMs`); mixed bases in one sort; the 50 / 51 cut; "at least" on
 * the stuck state alone at 200 / 201; more timeout and non-timeout wordings;
 * rejected event ids; and a Stripe customer id planted beside an email.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import {
  WEBHOOK_EVENTS_SHOWN_LIMIT,
  WEBHOOK_TIMEOUT_PATTERN,
  buildWebhookEventsView,
  classifyWebhookFailure,
  stripeCreatedMs,
  type WebhookEventsInput,
} from '@/lib/admin/jobs/webhookEventsView';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';
import type { AdminWebhookEventRow } from '@/lib/repositories/AdminWebhookEventReadRepository';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const NOW_S = NOW.getTime() / 1000;
const LAST_ATTEMPT = '2026-10-28T11:50:00.000Z'; // 10 min before NOW

function r(id: string, metadata: unknown, patch: Partial<AdminWebhookEventRow> = {}): AdminWebhookEventRow {
  return {
    event_id: id,
    event_type: 'invoice.paid',
    status: 'failed',
    processed_at: LAST_ATTEMPT,
    failure_message: 'boom',
    metadata,
    ...patch,
  };
}

function build(patch: Partial<WebhookEventsInput>) {
  return buildWebhookEventsView({
    mode: 'test',
    now: NOW,
    counts: { failed: 0, stuck: 0 },
    lists: { failed: [], stuck: [] },
    noMode: { failed: 0, stuck: 0 },
    readPerState: 200,
    staleAfterMs: STALE_CLAIM_AGE_MS,
    ...patch,
  });
}

const one = (row: AdminWebhookEventRow) => build({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row], stuck: [] } });

describe('QA: metadata.created edge values, through the whole builder', () => {
  it.each([
    ['a numeric string', { created: String(NOW_S - 3600), livemode: false }],
    ['missing', { livemode: false }],
    ['negative', { created: -1761652800, livemode: false }],
    ['zero', { created: 0, livemode: false }],
    ['Infinity', { created: Number.POSITIVE_INFINITY, livemode: false }],
    ['null', { created: null, livemode: false }],
    ['a boolean', { created: true, livemode: false }],
  ])('created %s → createdAt null; the age counts from the last attempt (10 min)', (_label, metadata) => {
    const row = one(r('evt_A', metadata)).rows[0];
    expect(row.createdAt).toBeNull();
    expect(row.lastAttemptAt).toBe(LAST_ATTEMPT);
    expect(row.ageMinutes).toBe(10);
  });

  it('fractional seconds are kept to the millisecond', () => {
    expect(stripeCreatedMs({ created: 1761652800.5 })).toBe(1761652800500);
    expect(one(r('evt_F', { created: 1761652800.5, livemode: false })).rows[0].createdAt).toBe('2025-10-28T12:00:00.500Z');
  });

  it('a created time in the future gives age 0, never a negative age', () => {
    const row = one(r('evt_Fut', { created: NOW_S + 3600, livemode: false })).rows[0];
    expect(row.ageMinutes).toBe(0);
  });

  it('the age is floored to whole minutes (59 min 59 s → 59)', () => {
    expect(one(r('evt_M', { created: NOW_S - 3599, livemode: false })).rows[0].ageMinutes).toBe(59);
  });

  it('created time wins over a NEWER last attempt and over an OLDER one', () => {
    const newerAttempt = one(r('evt_N', { created: NOW_S - 120 * 60, livemode: false })).rows[0];
    expect(newerAttempt.ageMinutes).toBe(120);
    const olderAttempt = one(r('evt_O', { created: NOW_S - 5 * 60, livemode: false }, { processed_at: '2026-10-28T10:00:00.000Z' })).rows[0];
    expect(olderAttempt.ageMinutes).toBe(5);
  });

  it('mixed bases sort together: created where present, last attempt otherwise; a row with neither goes last', () => {
    const payload = build({
      counts: { failed: 4, stuck: 0 },
      lists: {
        failed: [
          r('evt_noTime', { livemode: false }, { processed_at: null }),
          r('evt_attempt10', { livemode: false }), // 10 min (fallback)
          r('evt_created30', { created: NOW_S - 30 * 60, livemode: false }),
          r('evt_created5', { created: NOW_S - 5 * 60, livemode: false }),
        ],
        stuck: [],
      },
    });
    expect(payload.rows.map((x) => x.eventId)).toEqual(['evt_created30', 'evt_attempt10', 'evt_created5', 'evt_noTime']);
    expect(payload.tiles.oldestAgeMinutes).toBe(30);
    expect(payload.rows[3].ageMinutes).toBeNull();
  });

  it('the Oldest tile skips a timeless first row only if it sorts first (it never does: timeless rows go last)', () => {
    const payload = build({
      counts: { failed: 2, stuck: 0 },
      lists: { failed: [r('evt_a', { livemode: false }, { processed_at: null }), r('evt_b', { created: NOW_S - 60, livemode: false })], stuck: [] },
    });
    expect(payload.tiles.oldestAgeMinutes).toBe(1);
  });

  it('a stuck row ordered by created is placed among failed rows by created, not by state', () => {
    const payload = build({
      counts: { failed: 1, stuck: 1 },
      lists: {
        failed: [r('evt_f', { created: NOW_S - 60 * 60, livemode: false })],
        stuck: [r('evt_s', { created: NOW_S - 120 * 60, livemode: false }, { status: 'processing', failure_message: null })],
      },
    });
    expect(payload.rows.map((x) => [x.eventId, x.state])).toEqual([
      ['evt_s', 'stuck'],
      ['evt_f', 'failed'],
    ]);
  });
});

describe('QA: failure classes', () => {
  it.each([
    'TIMEOUT',
    'Gateway Timeout',
    'Connection timed-out',
    'socket time_out',
    'The operation was aborted due to timeout',
    'canceling statement due to statement timeout',
    'Deadline Exceeded',
  ])('timeout: %p', (message) => {
    expect(classifyWebhookFailure('failed', message)).toBe('timeout');
  });

  it.each(['socket hang up', 'Request aborted', 'outtime', 'timer reset', 'No such customer: cus_ABC123', 'x'])(
    'handler_error: %p',
    (message) => {
      expect(classifyWebhookFailure('failed', message)).toBe('handler_error');
    }
  );

  it.each([[null], [undefined], [''], [' '], ['\n\t']])('unknown: %p', (message) => {
    expect(classifyWebhookFailure('failed', message)).toBe('unknown');
  });

  it('a stuck row is stuck whatever its message (null, empty, a timeout, an error)', () => {
    for (const m of [null, '', 'timed out', 'boom']) expect(classifyWebhookFailure('stuck', m)).toBe('stuck');
  });

  it('the pattern is not global (no lastIndex state across calls)', () => {
    expect(WEBHOOK_TIMEOUT_PATTERN.global).toBe(false);
    expect(WEBHOOK_TIMEOUT_PATTERN.sticky).toBe(false);
    for (let i = 0; i < 3; i += 1) expect(classifyWebhookFailure('failed', 'timed out')).toBe('timeout');
  });
});

describe('QA: limits', () => {
  const rows = (n: number, prefix = 'evt_r') =>
    Array.from({ length: n }, (_, i) => r(`${prefix}${String(i).padStart(3, '0')}`, { created: NOW_S - (1000 - i) * 60, livemode: false }));

  it('50 rows: all shown; 51: 50 shown, the newest is cut, N stays exact', () => {
    let payload = build({ counts: { failed: 50, stuck: 0 }, lists: { failed: rows(50), stuck: [] } });
    expect(payload.listed).toBe(50);
    expect(payload.matching).toBe(50);
    payload = build({ counts: { failed: 51, stuck: 0 }, lists: { failed: rows(51), stuck: [] } });
    expect(payload.listed).toBe(WEBHOOK_EVENTS_SHOWN_LIMIT);
    expect(payload.matching).toBe(51);
    expect(payload.rows.map((x) => x.eventId)).not.toContain('evt_r050');
    expect(payload.rows[0].eventId).toBe('evt_r000');
  });

  it('the 50 cut spans both states: 30 failed + 30 stuck → 50 oldest across both', () => {
    const failed = Array.from({ length: 30 }, (_, i) => r(`evt_f${i}`, { created: NOW_S - (2 * i + 1) * 60, livemode: false }));
    const stuck = Array.from({ length: 30 }, (_, i) =>
      r(`evt_s${i}`, { created: NOW_S - (2 * i + 2) * 60, livemode: false }, { status: 'processing', failure_message: null })
    );
    const payload = build({ counts: { failed: 30, stuck: 30 }, lists: { failed, stuck } });
    expect(payload.listed).toBe(50);
    expect(payload.matching).toBe(60);
    expect(payload.rows[0].eventId).toBe('evt_s29');
    expect(payload.tiles.oldestAgeMinutes).toBe(60);
  });

  it('stuck at exactly 200 is exact; at 201 the Oldest is "at least" (the failed state alone at 200 does not trip it)', () => {
    const stuck200 = rows(200, 'evt_s').map((x) => ({ ...x, status: 'processing', failure_message: null }));
    expect(build({ counts: { failed: 0, stuck: 200 }, lists: { failed: [], stuck: stuck200 } }).tiles.oldestAtLeast).toBe(false);
    expect(build({ counts: { failed: 0, stuck: 201 }, lists: { failed: [], stuck: stuck200 } }).tiles.oldestAtLeast).toBe(true);
    expect(
      build({ counts: { failed: 200, stuck: 200 }, lists: { failed: rows(200), stuck: stuck200 } }).tiles.oldestAtLeast
    ).toBe(false);
  });

  it.each([
    [{ failed: 0, stuck: 0 }, 0],
    [{ failed: 1, stuck: 0 }, 1],
    [{ failed: 0, stuck: 1 }, 1],
    [{ failed: 4, stuck: 3 }, 7],
  ])('no-mode %p → %i, and never in a tile, the matching total or the list', (noMode, expected) => {
    const payload = build({ noMode });
    expect(payload.noMode).toBe(expected);
    expect(payload.tiles.failed).toBe(0);
    expect(payload.tiles.stuck).toBe(0);
    expect(payload.matching).toBe(0);
    expect(payload.rows).toEqual([]);
  });
});

describe('QA: event links', () => {
  it.each([
    ['evt_'],
    ['evt_abc def'],
    ['evt_abc/../../x'],
    ['EVT_abc'],
    ['evt_abc-def'],
    ['javascript:alert(1)'],
    [`evt_${'a'.repeat(251)}`],
    [''],
  ])('id %p gets no link', (id) => {
    expect(one(r(id, { created: NOW_S - 60, livemode: true })).rows[0].dashboardUrl).toBeNull();
  });

  it('the longest accepted id (250 chars after the prefix) gets a link', () => {
    const id = `evt_${'a'.repeat(250)}`;
    expect(one(r(id, { created: NOW_S - 60, livemode: true })).rows[0].dashboardUrl).toBe(`https://dashboard.stripe.com/events/${id}`);
  });

  it.each([['true'], [1], [null], [undefined]])('livemode %p (not a boolean) gets no link', (livemode) => {
    expect(one(r('evt_ok1', { created: NOW_S - 60, livemode })).rows[0].dashboardUrl).toBeNull();
  });

  it('test and live links differ only by /test/', () => {
    const t = one(r('evt_Z9', { created: NOW_S - 60, livemode: false })).rows[0].dashboardUrl;
    const l = one(r('evt_Z9', { created: NOW_S - 60, livemode: true })).rows[0].dashboardUrl;
    expect(t).toBe('https://dashboard.stripe.com/test/events/evt_Z9');
    expect(l).toBe('https://dashboard.stripe.com/events/evt_Z9');
  });
});

describe('QA: P3-SA-6 with a Stripe customer id and an email', () => {
  it('neither reaches the payload, in any class', () => {
    const planted = ['jane.customer@example.com', 'cus_QAplanted123'];
    const message = `No such customer: cus_QAplanted123 (jane.customer@example.com)`;
    const payload = build({
      counts: { failed: 3, stuck: 1 },
      lists: {
        failed: [
          r('evt_h', { created: NOW_S - 60, livemode: false }, { failure_message: message }),
          r('evt_t', { created: NOW_S - 61, livemode: false }, { failure_message: `timed out: ${message}` }),
          r('evt_u', { created: NOW_S - 62, livemode: false }, { failure_message: '' }),
        ],
        stuck: [r('evt_s', { created: NOW_S - 63, livemode: false }, { status: 'processing', failure_message: message })],
      },
    });
    const text = JSON.stringify(payload);
    for (const p of planted) expect(text).not.toContain(p);
    expect(text).not.toContain('created":17'); // the raw metadata is not echoed
    for (const row of payload.rows) expect(row).not.toHaveProperty('metadata');
    for (const row of payload.rows) expect(row).not.toHaveProperty('failure_message');
  });
});
