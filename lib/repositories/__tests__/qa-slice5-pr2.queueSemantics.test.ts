/**
 * QA probe (slice 5 PR-2, uncommitted): the queue figures are SEMANTICALLY
 * right. The repository's recorded PostgREST chains are evaluated in memory
 * against synthetic rows (a tiny PostgREST filter interpreter), and each figure
 * is compared with the answer worked out by hand from the claim functions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
const mockLog = jest.fn();
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: (...a: unknown[]) => mockLog(...a), warn: (...a: unknown[]) => mockLog(...a), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { AdminJobsQueuesRepository, DEAD_LETTER_MARKER, type AdminQueueId } from '../AdminJobsQueuesRepository';

type Row = Record<string, string | number | null>;
type Call = { method: string; args: unknown[] };

const NOW = new Date('2026-09-27T12:00:00.000Z');
const iso = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();
const CTX = { correlationId: 'c', adminId: 'a' };

// ── A tiny PostgREST filter interpreter (only what the repository uses) ─────
function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v;
}
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== '\\') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function cmp(a: unknown, b: unknown): number {
  const ta = typeof a === 'string' ? Date.parse(a) : Number(a);
  const tb = typeof b === 'string' ? Date.parse(b) : Number(b);
  return ta - tb;
}
function test(row: Row, column: string, op: string, raw: unknown): boolean {
  const v = row[column] ?? null;
  switch (op) {
    case 'eq':
      return v !== null && v === raw;
    case 'lte':
      return v !== null && cmp(v, raw) <= 0;
    case 'lt':
      return v !== null && cmp(v, raw) < 0;
    case 'gte':
      return v !== null && cmp(v, raw) >= 0;
    case 'gt':
      return v !== null && cmp(v, raw) > 0;
    case 'is':
      return raw === null || raw === 'null' ? v === null : false;
    case 'in': {
      const list = Array.isArray(raw) ? raw : splitTop(String(raw).replace(/^\(|\)$/g, '')).map(unquote);
      return v !== null && list.includes(v as string);
    }
    default:
      throw new Error(`op ${op}`);
  }
}
/** SQL three-valued NOT: NULL stays unknown (false). */
function notTest(row: Row, column: string, op: string, raw: unknown): boolean {
  const v = row[column] ?? null;
  if (op === 'is') return !test(row, column, op, raw);
  if (v === null) return false;
  return !test(row, column, op, raw);
}
function orClause(row: Row, clause: string): boolean {
  const [column, ...rest] = clause.split('.');
  if (rest[0] === 'not') {
    const op = rest[1];
    return notTest(row, column, op, unquote(rest.slice(2).join('.')));
  }
  const op = rest[0];
  const value = rest.slice(1).join('.');
  return test(row, column, op, op === 'in' ? value : unquote(value));
}

function run(rows: Row[], calls: Call[]) {
  let out = rows;
  let head = false;
  let columns = '*';
  let order: string | null = null;
  let limit: number | null = null;
  for (const { method, args } of calls) {
    if (method === 'select') {
      columns = String(args[0]);
      head = !!(args[1] as { head?: boolean } | undefined)?.head;
    } else if (['eq', 'lte', 'lt', 'gte', 'gt', 'is', 'in'].includes(method)) {
      out = out.filter((r) => test(r, String(args[0]), method, args[1]));
    } else if (method === 'not') {
      out = out.filter((r) => notTest(r, String(args[0]), String(args[1]), args[2]));
    } else if (method === 'or') {
      const clauses = splitTop(String(args[0]));
      out = out.filter((r) => clauses.some((c) => orClause(r, c)));
    } else if (method === 'order') {
      order = String(args[0]);
    } else if (method === 'limit') {
      limit = Number(args[0]);
    }
  }
  if (head) return { data: null, error: null, count: out.length };
  if (order) out = [...out].sort((a, b) => cmp(a[order!], b[order!]));
  if (limit !== null) out = out.slice(0, limit);
  const cols = columns.split(',').map((c) => c.trim());
  return { data: out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), error: null };
}

function clientOver(tables: Record<string, Row[]>) {
  const selects: string[] = [];
  const client = {
    from: (table: string) => {
      const calls: Call[] = [];
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'lte', 'lt', 'gte', 'gt', 'is', 'in', 'not', 'or', 'order', 'limit', 'abortSignal']) {
        builder[m] = (...args: unknown[]) => {
          if (m === 'select') selects.push(String(args[0]));
          calls.push({ method: m, args });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve(run(tables[table] ?? [], calls));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, selects };
}

const base = { claimed_at: null, next_attempt_at: null, error_message: null, payload: 'OWNER TEXT a@b.c', recommendation: 'secret plan' };

describe('the two payment tables (scheduled_at gates "due")', () => {
  const rows: Row[] = [
    { id: 'due1', status: 'pending', scheduled_at: iso(-300), ...base }, // due, oldest never-retried
    { id: 'due2', status: 'pending', scheduled_at: iso(-10), ...base, next_attempt_at: iso(-5) }, // due, retried
    { id: 'lat1', status: 'pending', scheduled_at: iso(+60), ...base }, // later (future schedule)
    { id: 'lat2', status: 'pending', scheduled_at: iso(-60), ...base, next_attempt_at: iso(+30) }, // later (backing off)
    { id: 'now', status: 'pending', scheduled_at: NOW.toISOString(), ...base }, // exactly due: claim uses <= now()
    { id: 'nodue', status: 'pending', scheduled_at: null, ...base }, // never picked up
    { id: 'pr1', status: 'processing', scheduled_at: iso(-60), ...base, claimed_at: iso(-1) }, // in progress, fresh
    { id: 'pr2', status: 'processing', scheduled_at: iso(-60), ...base, claimed_at: iso(-12) }, // stuck (> 11.5 min)
    { id: 'pr3', status: 'processing', scheduled_at: iso(-60), ...base, claimed_at: null }, // stuck (no claim)
    { id: 'pr4', status: 'processing', scheduled_at: iso(-60), ...base, claimed_at: iso(-11.5) }, // exactly 690 s: not stuck
    { id: 'f1', status: 'failed', scheduled_at: iso(-60), ...base, error_message: 'card declined for a@b.c' }, // failed 24h
    { id: 'f2', status: 'failed', scheduled_at: iso(-3 * 1440), ...base }, // failed 7d, null message
    { id: 'd1', status: 'failed', scheduled_at: iso(-60), ...base, error_message: DEAD_LETTER_MARKER }, // dead-letter (marker)
    { id: 'd2', status: 'dead_letter', scheduled_at: iso(-60), ...base, error_message: DEAD_LETTER_MARKER }, // dead-letter (status)
    { id: 'g1', status: 'failed', scheduled_at: iso(-60), ...base, error_message: 'max executions reached' },
    { id: 'g2', status: 'failed', scheduled_at: iso(-2 * 1440), ...base, error_message: 'cooldown active' },
    { id: 'old', status: 'failed', scheduled_at: iso(-8 * 1440), ...base }, // outside 7 d
    { id: 'u1', status: 'overdue', scheduled_at: iso(-60), ...base }, // unrecognised
    { id: 'ok', status: 'sent', scheduled_at: iso(-60), ...base },
    { id: 'c', status: 'completed', scheduled_at: iso(-60), ...base },
    { id: 'x', status: 'cancelled', scheduled_at: iso(-60), ...base },
  ];

  it('payment_reminders', async () => {
    const { client, selects } = clientOver({ payment_reminders: rows });
    const { data, error } = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'payment_reminders', NOW);
    expect(error).toBeNull();
    expect(data).toEqual({
      dueNow: 3, // due1, due2, now
      later: 2,
      noDueTime: null,
      inProgress: 4,
      stuck: 2,
      failed24h: 2, // f1 + g1 (guardrail markers are not a payment_reminders concept); d1 excluded
      failed7d: 4, // + f2, g2
      deadLettered24h: 1, // d1 only: 'dead_letter' is not a payment_reminders status
      deadLettered7d: 1,
      skipped7d: null,
      guardrailSkips7d: null,
      unrecognisedStatus: 3, // overdue, dead_letter, completed
      oldestDueAt: iso(-300),
    });
    for (const s of selects) expect(s).toMatch(/^(id|scheduled_at|next_attempt_at|created_at)(, ?(scheduled_at|next_attempt_at))?$/);
  });

  it('payment_automations: dead_letter STATUS is the dead-letter; failed+marker counts as failed; guardrails apart', async () => {
    const auto = rows.map((r) => (r.status === 'processing' ? { ...r, status: 'running' } : r));
    const { client } = clientOver({ payment_automation_executions: auto });
    const { data } = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, 'payment_automations', NOW);
    expect(data).toMatchObject({
      dueNow: 3,
      later: 2,
      noDueTime: 1,
      inProgress: 4,
      stuck: 2,
      failed24h: 2, // f1 + d1 (a 'failed' row with the marker is not this table's dead-letter)
      failed7d: 3, // + f2 ; g1/g2 excluded
      deadLettered24h: 1, // d2
      deadLettered7d: 1,
      guardrailSkips7d: 2,
      unrecognisedStatus: 2, // processing? no — rows were renamed; overdue + sent
      oldestDueAt: iso(-300),
    });
  });
});

describe.each(['daily_briefing_sends', 'lead_responses', 'insight_actions'] as const)('%s (no scheduled_at)', (queue) => {
  const rows: Row[] = [
    { id: 'a', status: 'pending', created_at: iso(-200), ...base }, // due, oldest
    { id: 'b', status: 'pending', created_at: iso(-400), ...base, next_attempt_at: iso(-100) }, // due since -100
    { id: 'c', status: 'pending', created_at: iso(-5), ...base, next_attempt_at: iso(+15) }, // later (15-min delay)
    { id: 'e', status: 'processing', created_at: iso(-30), ...base, claimed_at: iso(-20) }, // stuck
    { id: 'f', status: 'failed', created_at: iso(-60), ...base, error_message: DEAD_LETTER_MARKER },
    { id: 'g', status: 'failed', created_at: iso(-60), ...base, error_message: 'smtp said no to a@b.c' },
    { id: 'h', status: 'skipped', created_at: iso(-60), ...base },
    { id: 'i', status: 'sent', created_at: iso(-60), ...base },
  ];
  it('figures', async () => {
    const { client } = clientOver({ [queue]: rows });
    const { data } = await new AdminJobsQueuesRepository(client).readQueueFiguresAllAccounts(CTX, queue as AdminQueueId, NOW);
    expect(data).toEqual({
      dueNow: 2,
      later: 1,
      noDueTime: null,
      inProgress: 1,
      stuck: 1,
      failed24h: 1,
      failed7d: 1,
      deadLettered24h: 1,
      deadLettered7d: 1,
      skipped7d: 1,
      guardrailSkips7d: null,
      unrecognisedStatus: 0,
      oldestDueAt: iso(-200),
    });
    // Nothing from a row's content reaches the result or the logs.
    const all = JSON.stringify([data, mockLog.mock.calls]);
    expect(all).not.toMatch(/OWNER|a@b\.c|secret plan|smtp|dead-letter: max/);
  });
});
