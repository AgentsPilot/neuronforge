/**
 * The pure item-list builder (ADMIN_BOS_CLEANUP slice 7a; SA C7-13; workplan
 * §2.4, §2.5, §5.5 and condition W7A-4).
 *
 * Field allow-list (never a spread), fixed kind and status labels, the three
 * business-name fallbacks, the §E "due" basis per queue, the age words' basis
 * matching its anchor, and a sentinel over the serialised view.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  QUEUE_ITEM_KIND_LABELS,
  QUEUE_ITEM_QUEUE_IDS,
  QUEUE_ITEM_STATES,
  QUEUE_ITEM_STATUS_LABELS,
  buildQueueItemsView,
  kindLabel,
  type QueueItemInput,
} from '../buildQueueItemsView';
import { queueItemEligibility } from '../queueItemEligibility';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';
import { ADMIN_QUEUE_ITEM_STATES, ADMIN_QUEUE_SPECS } from '@/lib/repositories/AdminJobsQueuesRepository';
import type { QueueItemState } from '@/lib/admin/jobs/jobsQueuesTypes';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function input(overrides: Partial<QueueItemInput> = {}): QueueItemInput {
  return {
    id: '0f8e2c1a-1111-4111-8111-111111111111',
    userId: 'user-a',
    status: 'failed',
    attempts: 3,
    claimedAt: null,
    createdAt: minutesAgo(240),
    scheduledAt: minutesAgo(300),
    nextAttemptAt: null,
    kind: null,
    briefingDate: '2026-10-04',
    timezone: 'UTC',
    ...overrides,
  };
}

function build(
  queue: BosQueueId,
  state: QueueItemState,
  rows: QueueItemInput[],
  names: ReadonlyMap<string, string | null> | null = new Map([['user-a', 'Acme Plumbing']]),
  extra: { page?: number; total?: number | null; pageSize?: number; maxPage?: number } = {}
) {
  return buildQueueItemsView({
    queue,
    state,
    page: extra.page ?? 1,
    pageSize: extra.pageSize ?? 50,
    maxPage: extra.maxPage ?? 20,
    total: extra.total === undefined ? rows.length : extra.total,
    rows,
    names,
    now: NOW,
  });
}

describe('the id and state lists (Z-7 alignment)', () => {
  it('QUEUE_ITEM_QUEUE_IDS is set-equal to BOS_QUEUES and the repository specs', () => {
    expect([...QUEUE_ITEM_QUEUE_IDS].sort()).toEqual(BOS_QUEUES.map((q) => q.id).sort());
    expect([...QUEUE_ITEM_QUEUE_IDS].sort()).toEqual(Object.keys(ADMIN_QUEUE_SPECS).sort());
  });

  it('QUEUE_ITEM_STATES equals the repository states', () => {
    expect([...QUEUE_ITEM_STATES]).toEqual([...ADMIN_QUEUE_ITEM_STATES]);
  });
});

describe('B-1: fixed kind labels (C7-13)', () => {
  it.each([
    ['payment_reminders', 'upcoming_due', 'Reminder before the due date'],
    ['payment_reminders', 'due_today', 'Due-today reminder'],
    ['payment_reminders', 'overdue', 'Overdue reminder'],
    ['payment_reminders', 'retry_failed', 'Failed-payment notice'],
    ['payment_reminders', 'payment_received', 'Payment receipt'],
    ['lead_responses', 'invite', 'Booking invite to a new lead'],
    ['lead_responses', 'chase', 'Follow-up to a lead'],
    // Slice 7b (OP-11, W7B-11): the three kinds 20260916 and 20260923 added.
    ['lead_responses', 'invoice_chase', 'Invoice chase to a client'],
    ['lead_responses', 'intake_chase', 'Intake form reminder'],
    ['lead_responses', 'meeting_reminder', 'Meeting reminder'],
    ['insight_actions', 'chase_invoice', 'Invoice chase'],
    ['insight_actions', 'followup_nudge', 'Follow-up nudge'],
    ['insight_actions', 'booking_reminder', 'Booking reminder'],
  ] as const)('%s %s → %s', (queue, kind, label) => {
    expect(kindLabel(queue, kind)).toBe(label);
  });

  it('a value with no label, or none, is "Other" (never the raw value)', () => {
    for (const queue of ['payment_reminders', 'lead_responses', 'insight_actions'] as const) {
      expect(kindLabel(queue, 'something_new')).toBe('Other');
      expect(kindLabel(queue, null)).toBe('Other');
      expect(kindLabel(queue, 'toString')).toBe('Other');
    }
    // A kind from another queue's vocabulary is not borrowed.
    expect(kindLabel('lead_responses', 'overdue')).toBe('Other');
  });

  it('the one-kind queues have a fixed label whatever the row says', () => {
    expect(kindLabel('payment_automations', 'anything')).toBe('Payment automation');
    expect(kindLabel('daily_briefing_sends', null)).toBe('Morning briefing');
  });

  it('the label tables cover exactly the five queues', () => {
    expect(Object.keys(QUEUE_ITEM_KIND_LABELS).sort()).toEqual([...QUEUE_ITEM_QUEUE_IDS].sort());
  });

  /**
   * W7B-11: the lead-reply labels follow the LIVE CHECK, read from the latest
   * migration that sets `lead_responses_kind_check` (comments ignored). A new
   * kind added by a future migration fails here instead of showing "Other".
   */
  it('W7B-11: the lead-reply labels are exactly the kinds of the latest lead_responses_kind_check migration', () => {
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const lists = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
      .map((name) => {
        const sql = fs
          .readFileSync(path.join(dir, name), 'utf8')
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n');
        const match = sql.match(/ADD\s+CONSTRAINT\s+lead_responses_kind_check\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/i);
        return match ? { name, kinds: [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) } : null;
      })
      .filter((entry): entry is { name: string; kinds: string[] } => entry !== null);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    const latest = lists[lists.length - 1];
    expect(latest.name >= '20260923').toBe(true);
    expect(latest.kinds.sort()).toEqual(['chase', 'intake_chase', 'invite', 'invoice_chase', 'meeting_reminder']);
    const labels = QUEUE_ITEM_KIND_LABELS.lead_responses;
    expect(typeof labels).toBe('object');
    expect(Object.keys(labels).sort()).toEqual(latest.kinds.sort());
  });
});

describe('status labels', () => {
  it('every known status of every table has a label; an unknown one is "Unrecognised status"', () => {
    for (const queue of QUEUE_ITEM_QUEUE_IDS) {
      for (const status of ADMIN_QUEUE_SPECS[queue].known) expect(QUEUE_ITEM_STATUS_LABELS[status]).toBeTruthy();
    }
    const [item] = build('lead_responses', 'failed', [input({ status: 'weird' })]).items;
    expect(item.statusLabel).toBe('Unrecognised status');
    expect(item.status).toBe('weird');
  });

  it('a dead-lettered row reads "Dead-lettered", a plain failed row "Failed"', () => {
    expect(build('lead_responses', 'dead_lettered', [input()]).items[0].statusLabel).toBe('Dead-lettered');
    expect(build('lead_responses', 'failed', [input()]).items[0].statusLabel).toBe('Failed');
    expect(build('payment_automations', 'dead_lettered', [input({ status: 'dead_letter' })]).items[0].statusLabel).toBe('Dead-lettered');
    expect(build('lead_responses', 'waiting', [input({ status: 'pending' })]).items[0].statusLabel).toBe('Waiting');
    expect(build('payment_automations', 'stuck', [input({ status: 'running' })]).items[0].statusLabel).toBe('In progress');
  });
});

describe('B-2: business names, with three fixed fallbacks (OP-1)', () => {
  it.each([
    ['found', new Map([['user-a', '  Acme Plumbing ']]), 'Acme Plumbing'],
    ['empty name', new Map([['user-a', '   ']]), 'Business without a name'],
    ['null name', new Map([['user-a', null]]), 'Business without a name'],
    ['no profile row', new Map([['someone-else', 'Other Co']]), 'No business profile'],
    ['lookup failed', null, 'Name not available'],
  ] as const)('%s', (_case, names, expected) => {
    expect(build('lead_responses', 'failed', [input()], names as ReadonlyMap<string, string | null> | null).items[0].businessName).toBe(expected);
  });
});

describe('B-3: the §E due basis per queue', () => {
  it('payment tables: scheduled', () => {
    for (const queue of ['payment_reminders', 'payment_automations'] as const) {
      expect(build(queue, 'failed', [input()]).items[0].due).toEqual({ basis: 'scheduled', at: minutesAgo(300) });
    }
    expect(build('payment_automations', 'waiting', [input({ status: 'pending', scheduledAt: null })]).items[0].due).toEqual({
      basis: 'scheduled',
      at: null,
    });
  });

  it('briefing: business day', () => {
    expect(build('daily_briefing_sends', 'failed', [input()]).items[0].due).toEqual({ basis: 'business_day', date: '2026-10-04' });
  });

  it('lead replies and insight actions: queued (created_at)', () => {
    for (const queue of ['lead_responses', 'insight_actions'] as const) {
      expect(build(queue, 'failed', [input()]).items[0].due).toEqual({ basis: 'queued', at: minutesAgo(240) });
    }
  });
});

describe('B-4: age, with words that match the anchor (W7A-4)', () => {
  it('stuck with a claim: minutes since claimed, lease expired', () => {
    const [item] = build('lead_responses', 'stuck', [input({ status: 'processing', claimedAt: minutesAgo(25) })]).items;
    expect(item.age).toEqual({ minutes: 25, basis: 'since_claimed' });
    expect(item.lease).toBe('expired');
  });

  it('stuck with no claim: no lease, lease none', () => {
    const [item] = build('lead_responses', 'stuck', [input({ status: 'processing', claimedAt: null })]).items;
    expect(item.age).toEqual({ minutes: null, basis: 'no_lease' });
    expect(item.lease).toBe('none');
  });

  it('failed / dead-lettered: since due (payment tables), since queued (lead replies, insight actions), since the day began (briefing)', () => {
    for (const state of ['failed', 'dead_lettered'] as const) {
      expect(build('payment_reminders', state, [input()]).items[0].age).toEqual({ minutes: 300, basis: 'since_due' });
      expect(build('payment_automations', state, [input({ status: state === 'failed' ? 'failed' : 'dead_letter' })]).items[0].age).toEqual({
        minutes: 300,
        basis: 'since_due',
      });
      expect(build('lead_responses', state, [input()]).items[0].age).toEqual({ minutes: 240, basis: 'since_queued' });
      expect(build('insight_actions', state, [input()]).items[0].age).toEqual({ minutes: 240, basis: 'since_queued' });
      // 12:00 UTC on the 4th; the day began at 00:00 UTC.
      expect(build('daily_briefing_sends', state, [input()]).items[0].age).toEqual({ minutes: 720, basis: 'since_day_start' });
    }
    // Jerusalem's 4th began at 21:00 UTC on the 3rd: 15 h before NOW.
    expect(build('daily_briefing_sends', 'failed', [input({ timezone: 'Asia/Jerusalem' })]).items[0].age).toEqual({
      minutes: 900,
      basis: 'since_day_start',
    });
    // No anchor: no age, same basis.
    expect(build('payment_automations', 'failed', [input({ scheduledAt: null })]).items[0].age).toEqual({ minutes: null, basis: 'since_due' });
  });

  it('waiting: overdue from the effective due time (the card\'s rule), negative when not yet due', () => {
    // Payment tables: the later of scheduled_at and next_attempt_at.
    expect(
      build('payment_reminders', 'waiting', [input({ status: 'pending', scheduledAt: minutesAgo(60), nextAttemptAt: minutesAgo(20) })]).items[0].age
    ).toEqual({ minutes: 20, basis: 'overdue' });
    expect(
      build('payment_reminders', 'waiting', [input({ status: 'pending', scheduledAt: minutesAgo(-180), nextAttemptAt: null })]).items[0].age
    ).toEqual({ minutes: -180, basis: 'overdue' });
    expect(
      build('payment_automations', 'waiting', [input({ status: 'pending', scheduledAt: null })]).items[0].age
    ).toEqual({ minutes: null, basis: 'overdue' });
    // Others: next_attempt_at, else created_at.
    expect(build('lead_responses', 'waiting', [input({ status: 'pending', nextAttemptAt: minutesAgo(-15) })]).items[0].age).toEqual({
      minutes: -15,
      basis: 'overdue',
    });
    expect(build('insight_actions', 'waiting', [input({ status: 'pending' })]).items[0].age).toEqual({ minutes: 240, basis: 'overdue' });
  });

  it('nextAttemptAt is shown on waiting rows only; lease on stuck rows only', () => {
    const row = input({ status: 'pending', nextAttemptAt: minutesAgo(-15) });
    expect(build('lead_responses', 'waiting', [row]).items[0].nextAttemptAt).toBe(minutesAgo(-15));
    expect(build('lead_responses', 'failed', [{ ...row, status: 'failed' }]).items[0].nextAttemptAt).toBeNull();
    expect(build('lead_responses', 'failed', [row]).items[0].lease).toBeNull();
  });
});

describe('B-5: error category from the state filter, never from error text', () => {
  it.each([
    ['failed', 'failed'],
    ['dead_lettered', 'dead_lettered'],
    ['stuck', null],
    ['waiting', null],
  ] as const)('%s → %s', (state, category) => {
    expect(build('lead_responses', state, [input()]).items[0].errorCategory).toBe(category);
  });
});

describe('re-send and cancel marks come from the shared function', () => {
  it.each(QUEUE_ITEM_QUEUE_IDS)('%s', (queue) => {
    for (const state of QUEUE_ITEM_STATES) {
      const row = input({ status: state === 'waiting' ? 'pending' : state === 'stuck' ? ADMIN_QUEUE_SPECS[queue].inProgress : 'failed', claimedAt: state === 'stuck' ? minutesAgo(30) : null });
      const [item] = build(queue, state, [row]).items;
      const expected = queueItemEligibility(queue, row, NOW);
      expect(item.retry).toEqual(expected.retry);
      expect(item.cancel).toEqual(expected.cancel);
    }
  });

  it('W7A-7(a): a dead-lettered row on the four retryable tables is marked exactly like a failed one', () => {
    for (const queue of ['payment_reminders', 'daily_briefing_sends', 'lead_responses', 'insight_actions'] as const) {
      const dead = build(queue, 'dead_lettered', [input()]).items[0];
      const failed = build(queue, 'failed', [input()]).items[0];
      expect(dead.retry).toEqual(failed.retry);
      expect(dead.retry.allowed).toBe(true);
      expect(dead.cancel).toEqual({ allowed: true });
    }
  });
});

describe('B-6: exact keys', () => {
  it('the view and each item carry exactly the listed keys', () => {
    const view = build('payment_reminders', 'failed', [input({ kind: 'overdue' })]);
    expect(Object.keys(view).sort()).toEqual(['hasMore', 'items', 'maxPage', 'now', 'page', 'pageSize', 'queue', 'state', 'total'].sort());
    expect(Object.keys(view.items[0]).sort()).toEqual(
      ['id', 'businessName', 'kindLabel', 'status', 'statusLabel', 'state', 'errorCategory', 'attempts', 'due', 'nextAttemptAt', 'age', 'lease', 'retry', 'cancel'].sort()
    );
    expect(view.now).toBe(NOW.toISOString());
    expect(view.items[0]).toMatchObject({ id: input().id, attempts: 3, kindLabel: 'Overdue reminder', state: 'failed' });
  });
});

describe('B-7: sentinel', () => {
  it.each(QUEUE_ITEM_QUEUE_IDS)('%s: no account id, zone, raw kind or planted field reaches the view', (queue) => {
    const planted = {
      error_message: 'SENTINEL-ERR',
      skip_reason: 'SENTINEL-SKIP',
      payload: { to: 'sentinel@client.test' },
      recommendation: 'SENTINEL-REC',
      contact_id: 'SENTINEL-CONTACT',
      invoice_id: 'SENTINEL-INVOICE',
      booking_id: 'SENTINEL-BOOKING',
      email: 'SENTINEL-EMAIL',
    };
    const rows = (['stuck', 'failed', 'dead_lettered', 'waiting'] as const).map((state, i) => ({
      ...input({
        id: `item-${i}`,
        userId: 'SENTINEL-ACCOUNT-1',
        timezone: 'SENTINEL/Zone',
        kind: 'SENTINEL-KIND',
        status: state === 'stuck' ? ADMIN_QUEUE_SPECS[queue].inProgress : 'failed',
      }),
      ...planted,
    }));
    for (const state of QUEUE_ITEM_STATES) {
      const view = build(queue, state, rows, new Map([['SENTINEL-ACCOUNT-1', 'Acme']]));
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/SENTINEL|sentinel|@/);
      expect(text).toContain('Acme');
    }
  });
});

describe('B-8: paging', () => {
  it('more rows than the page size are cut to the page size; hasMore comes from total', () => {
    const rows = Array.from({ length: 55 }, (_, i) => input({ id: `item-${i}` }));
    const view = build('lead_responses', 'failed', rows, undefined, { total: 132, page: 2 });
    expect(view.items).toHaveLength(50);
    expect(view.hasMore).toBe(true);
    expect(build('lead_responses', 'failed', rows.slice(0, 32), undefined, { total: 132, page: 3 }).hasMore).toBe(false);
  });

  it('CR7A-2 / QA-7A-1: on the last servable page (20) of 1,500 there is no next page', () => {
    const rows = Array.from({ length: 50 }, (_, i) => input({ id: `item-${i}` }));
    const view = build('lead_responses', 'failed', rows, undefined, { total: 1500, page: 20, maxPage: 20 });
    expect(view).toMatchObject({ page: 20, maxPage: 20, total: 1500, hasMore: false });
    expect(build('lead_responses', 'failed', rows, undefined, { total: 1500, page: 19, maxPage: 20 }).hasMore).toBe(true);
  });

  it('W7A-2: a page past the end (total null) has no more pages and no items', () => {
    const view = build('lead_responses', 'waiting', [], undefined, { total: null, page: 4 });
    expect(view).toMatchObject({ total: null, hasMore: false, items: [], page: 4 });
  });
});

describe('purity', () => {
  it('reads no clock, names no repository, and does no I/O', () => {
    const code = fs
      .readFileSync(path.join(process.cwd(), 'lib/admin/jobs/buildQueueItemsView.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/Date\.now\(|new Date\(\s*\)/);
    expect(code).not.toMatch(/fetch\(|supabase|createLogger|process\.env|repositories/);
    expect(code).not.toMatch(/\.\.\.\s*(row|input|raw)\b/);
  });
});
