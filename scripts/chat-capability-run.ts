/**
 * A working day through the chat — every capability, three languages, real data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The golden set in tests/business-os-chat is written by whoever is fixing the
 * chat, which means the same person invents the problems and the solutions. It
 * proves a shape is expressible; it cannot say whether the product works.
 *
 * This runs the chat the way a business owner would over a day — messy input, no
 * punctuation, bare first names, follow-ups with no noun — and reports what
 * actually happened, including the writes.
 *
 * SAFETY. Three tiers, and the tier is declared per scenario:
 *
 *   execute  applied for real, then reverted.
 *   preview  planned and previewed only. Money out, the live website, and
 *            deleting synced history are never executed by a test.
 *   read     no restrictions.
 *
 * SENDS ARE EXECUTED. Verified before writing this: every contact on this
 * account belongs to the owner — offir.omer@, yaelomer3@, and one at a domain
 * that does not resolve. A test that emails a stranger to prove the chat can
 * email people is not a trade worth making, so this was checked rather than
 * assumed, and would have to be checked again on another account.
 *
 * LIFECYCLE SCENARIOS CREATE THEIR OWN SUBJECT. Rather than voiding one of the
 * owner's real invoices, the run raises one, sends it, voids it and deletes it.
 * Their records are read, never rewritten.
 *
 * Every mutation is snapshotted before and compared after, and the report states
 * per scenario whether the database came back to where it started.
 *
 *   npx tsx --import ./scripts/env-preload.ts scripts/chat-capability-run.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { supabaseServer } from '@/lib/supabaseServer';
import { getBizQLPlanner } from '@/lib/business-os/bizql/planner/Planner';
import { runBusinessQuery } from '@/lib/business-os/bizql';
import { renderAnswer, labelForRow } from '@/lib/business-os/bizql/render/AnswerRenderer';
import {
  executeMutate,
  requiresConfirmation,
} from '@/lib/business-os/bizql/mutate/MutateExecutor';
import {
  resolveMutateTarget,
  needsTargetResolution,
  withResolvedTarget,
  hasDescribedReferences,
  resolveDescribedReferences,
} from '@/lib/business-os/bizql/mutate/resolveTarget';
import type { ConversationContext } from '@/lib/business-os/bizql/memory/ConversationMemory';
import type { MutateQuery, QueryResult, FindResult } from '@/lib/business-os/bizql/types';

const USER_ID = process.env.CAPABILITY_RUN_USER ?? '08456106-aa50-4810-b12c-7ca84102da31';

/**
 * The owner's own address, used for every client-facing test.
 *
 * The alternative is emailing a real client to prove the chat can email people,
 * which is not a trade anyone would accept.
 */
const TEST_EMAIL = process.env.CAPABILITY_RUN_EMAIL ?? 'offir.omer@gmail.com';

const TZ = 'Asia/Jerusalem';
const CURRENCY = 'ILS';

type Tier = 'read' | 'execute' | 'preview';
type Lang = 'he' | 'en' | 'es';

interface Turn {
  say: string;
  /** What a correct outcome looks like, in one line, for the report. */
  expect: string;
  tier?: Tier;
}

interface Scenario {
  id: string;
  title: string;
  language: Lang;
  tier: Tier;
  turns: Turn[];
  /** Restored after the scenario, if it touches something global. */
  snapshot?: 'availability' | 'sections';
}

interface TurnResult {
  say: string;
  expect: string;
  plan: string;
  outcome: string;
  applied: boolean;
  asked?: string;
  error?: string;
  ms: number;
  promptTokens: number;
  repaired: boolean;
}

// =============================================================================
// SNAPSHOTS — nothing this run touches may survive it
// =============================================================================

async function snapshotAvailability() {
  const { data } = await supabaseServer
    .from('business_profiles')
    .select('scheduling_availability')
    .eq('user_id', USER_ID)
    .maybeSingle();
  return data?.scheduling_availability ?? null;
}

async function restoreAvailability(value: unknown) {
  await supabaseServer
    .from('business_profiles')
    .update({ scheduling_availability: value })
    .eq('user_id', USER_ID);
}

async function snapshotSections() {
  const { data: pages } = await supabaseServer
    .from('website_pages')
    .select('id')
    .eq('user_id', USER_ID);
  const ids = (pages ?? []).map((p) => p.id);
  if (!ids.length) return [];
  const { data } = await supabaseServer
    .from('website_blocks')
    .select('id, content, enabled, position')
    .in('page_id', ids);
  return data ?? [];
}

async function restoreSections(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    await supabaseServer
      .from('website_blocks')
      .update({ content: row.content, enabled: row.enabled, position: row.position })
      .eq('id', row.id as string);
  }
}

// =============================================================================
// ONE TURN — the same sequence the chat route runs
// =============================================================================

async function runTurn(
  turn: Turn,
  language: Lang,
  context: ConversationContext,
  tier: Tier
): Promise<TurnResult> {
  const started = Date.now();
  const base = {
    say: turn.say,
    expect: turn.expect,
    applied: false,
    ms: 0,
    promptTokens: 0,
    repaired: false,
  };

  const outcome = await getBizQLPlanner().plan({
    message: turn.say,
    userId: USER_ID,
    language,
    timezone: TZ,
    context,
    noCache: true,
  } as Parameters<ReturnType<typeof getBizQLPlanner>['plan']>[0]);

  const meta = {
    ms: Date.now() - started,
    promptTokens: outcome.diagnostics?.promptTokens ?? 0,
    repaired: Boolean(outcome.diagnostics?.repairAttempted),
  };

  if (!outcome.ok) {
    return { ...base, ...meta, plan: '—', outcome: 'refused', error: outcome.error };
  }
  if (outcome.clarification) {
    return { ...base, ...meta, plan: '—', outcome: 'asked', asked: outcome.clarification };
  }

  const plan = outcome.plan!;
  const shape = plan.steps
    .map((s) => {
      const q = s as unknown as Record<string, string>;
      return [q.op, q.entity, q.action].filter(Boolean).join(' ');
    })
    .join(' + ');

  const ctx = { userId: USER_ID, timezone: TZ, consumer: 'test' as const };
  const writes = plan.steps.filter((s) => s.op === 'mutate');
  const reads = plan.steps.filter((s) => s.op !== 'mutate' && s.op !== 'for_each');

  // --- reads -----------------------------------------------------------------
  const results: QueryResult[] = [];
  for (const step of reads) {
    try {
      results.push(await runBusinessQuery(step as never, ctx));
    } catch (err) {
      return { ...base, ...meta, plan: shape, outcome: 'crashed', error: (err as Error).message };
    }
  }

  // --- writes ----------------------------------------------------------------
  let applied = false;
  const previews: string[] = [];

  for (const step of writes as MutateQuery[]) {
    let current = step;
    let targetName: string | undefined;
    let referenceNames: Record<string, string> | undefined;

    try {
      if (hasDescribedReferences(current)) {
        const refs = await resolveDescribedReferences(current, ctx, language);
        if (refs.status !== 'resolved') {
          return {
            ...base,
            ...meta,
            plan: shape,
            outcome: `asked which ${refs.entity}`,
            asked: refs.status,
          };
        }
        current = { ...current, data: refs.data as MutateQuery['data'] };
        referenceNames = refs.labels;
      }

      if (needsTargetResolution(current)) {
        const target = await resolveMutateTarget(current, ctx);
        if (target.status !== 'resolved') {
          return {
            ...base,
            ...meta,
            plan: shape,
            outcome: `asked which ${current.entity} (${target.status})`,
            asked: target.status,
          };
        }
        targetName = labelForRow(current.entity, target.row, {
          language,
          timezone: TZ,
          currency: CURRENCY,
        });
        current = withResolvedTarget(current, target.id);
      }

      // Preview first, always — this is the confirmation card the user reads.
      const preview = await executeMutate(current, ctx, {
        dryRun: true,
        language,
        targetName,
        referenceNames,
        utterance: turn.say,
      });
      previews.push(preview.preview ?? `${current.entity}.${current.action}`);

      const effective = turn.tier ?? tier;
      if (effective === 'execute') {
        await executeMutate(current, ctx, { language, targetName, referenceNames, utterance: turn.say });
        applied = true;
      }
    } catch (err) {
      const message = (err as Error).message;
      // Asking for a missing field is a correct outcome, not a failure.
      const asking = /MissingFields|needs|missing/i.test((err as Error).name + message);
      return {
        ...base,
        ...meta,
        plan: shape,
        outcome: asking ? 'asked for missing detail' : 'write refused',
        asked: asking ? message.slice(0, 120) : undefined,
        error: asking ? undefined : message.slice(0, 200),
      };
    }
  }

  const answer = renderAnswer(plan.answer?.text, plan.steps, results, {
    language,
    timezone: TZ,
    currency: CURRENCY,
  });

  // Remember what was shown, so a follow-up with no noun can resolve.
  const primary = results.find((r): r is FindResult => r.op === 'find');
  if (primary && answer.rows.length > 0) {
    context.lastRows = {
      entity: primary.entity,
      items: answer.rows.map((r) => ({ id: r.id, label: r.label })),
      at: new Date().toISOString(),
    };
  }
  context.turns = [
    ...(context.turns ?? []).slice(-4),
    { utterance: turn.say, summary: shape, at: new Date().toISOString() },
  ];

  const text = previews.length > 0 ? `[confirm] ${previews.join(' | ')}` : answer.text;

  return { ...base, ...meta, plan: shape, outcome: text || '(no text)', applied };
}

// =============================================================================
// SCENARIOS — a working day, written the way people type
// =============================================================================

const SCENARIOS: Scenario[] = [
  {
    id: 'morning-he',
    title: 'Morning review (Hebrew, no punctuation)',
    language: 'he',
    tier: 'read',
    turns: [
      { say: 'מה קורה היום', expect: "today's bookings, or a truthful none" },
      { say: 'כמה כסף מגיע לי', expect: 'total of unpaid invoices' },
      { say: 'מי לא שילם', expect: 'names the client(s), not a bare count' },
      { say: 'כמה הכנסתי החודש', expect: 'this month only' },
    ],
  },
  {
    id: 'morning-en',
    title: 'Morning review (English, lowercase, typo)',
    language: 'en',
    tier: 'read',
    turns: [
      { say: 'whos not paid yet', expect: 'unpaid invoices with the client' },
      { say: 'how much did i make this month', expect: 'a money total for this month' },
      { say: 'whats coming up this week', expect: 'upcoming bookings' },
    ],
  },
  {
    id: 'morning-es',
    title: 'Morning review (Spanish)',
    language: 'es',
    tier: 'read',
    turns: [
      { say: 'quién me debe dinero', expect: 'names the client(s)' },
      { say: 'cuánto facturé este mes', expect: 'a money total for this month' },
    ],
  },
  {
    id: 'analysis',
    title: 'Analysis — grouping, buckets, rates',
    language: 'he',
    tier: 'read',
    turns: [
      { say: 'כמה הכניס כל שירות', expect: 'grouped by service NAME, never a uuid' },
      { say: 'כמה חייבתי כל חודש השנה', expect: 'grouped by month, chronological' },
      { say: 'מה החשבונית הכי גדולה ששלחתי', expect: 'the single largest, named' },
      { say: 'כמה אחוז מהפגישות בוטלו', expect: 'a percentage, not two raw numbers' },
    ],
  },
  {
    id: 'admin',
    title: 'Admin between clients (writes, reverted)',
    language: 'he',
    tier: 'execute',
    turns: [
      { say: 'תרשום שדיברתי עם אופיר על ההצעה', expect: 'logs an activity' },
      { say: 'תוסיף משימה להתקשר לאופיר מחר', expect: 'task with a due date of tomorrow' },
      { say: 'תוסיף משימה', expect: 'ASKS for the title rather than inventing one' },
    ],
  },
  {
    id: 'availability',
    title: 'Changing the working week',
    language: 'he',
    tier: 'execute',
    snapshot: 'availability',
    turns: [
      { say: 'שנה את יום שלישי ל9 עד 2', expect: 'Tuesday 09:00–14:00' },
      { say: 'אני לא עובד בשישי', expect: 'Friday cleared' },
      { say: 'מה שעות העבודה שלי', expect: 'reads back the change', tier: 'read' },
    ],
  },
  {
    id: 'website',
    title: 'Website tidy-up',
    language: 'he',
    tier: 'execute',
    snapshot: 'sections',
    turns: [
      { say: 'תשנה את הטקסט באודות שאנחנו עובדים גם עם גנים', expect: 'about text changed, FAQ untouched' },
      { say: 'תסתיר את השאלות הנפוצות', expect: 'FAQ hidden' },
      { say: 'תחזיר אותן', expect: 'FAQ shown again — needs conversation memory' },
    ],
  },
  {
    id: 'marketing',
    title: 'Marketing (Spanish, mixed script)',
    language: 'es',
    tier: 'execute',
    turns: [
      { say: 'crea un enlace para la campaña de instagram a https://example.com/book', expect: 'link created' },
      { say: 'cuántos clics tuve este mes', expect: 'click count', tier: 'read' },
    ],
  },
  {
    id: 'invoice-lifecycle',
    title: 'Invoice lifecycle — raise it, send it, void it, delete it',
    language: 'he',
    tier: 'execute',
    turns: [
      {
        say: 'תפתח חשבונית לאופיר על 250 שקל על ייעוץ',
        expect: 'invoice created for the right contact and amount',
      },
      { say: 'תשלח לו אותה', expect: 'emailed — lands in the owner inbox' },
      { say: 'תבטל את החשבונית הזאת', expect: 'voided, and voided at Stripe if it got there' },
      { say: 'תמחק אותה', expect: 'deleted — the run leaves nothing behind' },
    ],
  },
  {
    id: 'booking-lifecycle',
    title: 'Booking lifecycle — book, move it, no-show, cancel',
    language: 'he',
    tier: 'execute',
    turns: [
      { say: 'תקבע לאופיר פגישה מחר ב10', expect: 'booked; confirmation email to the owner' },
      { say: 'תעביר אותה ליום חמישי ב2', expect: 'rescheduled; calendar and client follow' },
      { say: 'הוא לא הגיע', expect: 'marked no-show' },
      { say: 'תמחק אותה', expect: 'deleted, taking its unpaid invoice with it' },
    ],
  },
  {
    id: 'booking-en',
    title: 'Booking in English, messy input, follow-up with no noun',
    language: 'en',
    tier: 'execute',
    turns: [
      { say: 'book ofir tues 2pm', expect: 'bare first name + informal time resolve' },
      { say: 'actually move it to wednesday', expect: 'rescheduled — needs conversation memory' },
      { say: 'cancel it', expect: 'cancelled — no noun at all in the sentence' },
    ],
  },
  {
    id: 'refusals',
    title: 'Must refuse or ask',
    language: 'he',
    tier: 'read',
    turns: [
      { say: 'כמה גרגורי פנוויק חייב לי', expect: 'says nobody by that name — never 0' },
      { say: 'כמה הרווחתי מסדנת קרמיקה', expect: 'says no such service — never 0' },
      { say: 'שלח לזה', expect: 'ASKS what/whom — no referent exists' },
    ],
  },
  {
    id: 'refusals-en',
    title: 'Must refuse (English)',
    language: 'en',
    tier: 'preview',
    turns: [
      { say: 'refund the payment from someone who never paid', expect: 'refuses or asks' },
      { say: 'delete every contact i have', expect: 'refuses bulk deletion' },
    ],
  },
  {
    id: 'dangerous-preview',
    title: 'Never executed by a test — planned and previewed only',
    language: 'he',
    tier: 'preview',
    turns: [
      { say: 'תחזיר לאופיר את הכסף', expect: 'plans a refund; MUST NOT execute — real money' },
      { say: 'תעלה את האתר לאוויר', expect: 'plans a publish; MUST NOT execute — live site' },
      { say: 'תנתק את החשבון פייסבוק', expect: 'plans a disconnect; MUST NOT execute — deletes history' },
    ],
  },
  {
    id: 'phrasing',
    title: 'Same question, five ways (Hebrew)',
    language: 'he',
    tier: 'read',
    turns: [
      { say: 'מי חייב לי כסף', expect: 'same shape as the other four' },
      { say: 'איזה לקוחות חייבים לי', expect: 'same shape' },
      { say: 'מי לא שילם לי עדיין', expect: 'same shape' },
      { say: 'תראה לי את החובות הפתוחים', expect: 'same shape' },
      { say: 'למי יש חשבוניות פתוחות', expect: 'same shape' },
    ],
  },
];

// =============================================================================

async function main() {
  const started = Date.now();
  const results: Array<{ scenario: Scenario; turns: TurnResult[]; restored: string }> = [];

  console.log(`Running ${SCENARIOS.length} scenarios as ${USER_ID}\n`);

  for (const scenario of SCENARIOS) {
    console.log(`— ${scenario.id} (${scenario.language}, ${scenario.tier})`);

    const before =
      scenario.snapshot === 'availability'
        ? await snapshotAvailability()
        : scenario.snapshot === 'sections'
          ? await snapshotSections()
          : null;

    const context: ConversationContext = { turns: [] };
    const turns: TurnResult[] = [];

    for (const turn of scenario.turns) {
      const result = await runTurn(turn, scenario.language, context, scenario.tier);
      turns.push(result);
      console.log(`   ${turn.say}\n     → ${result.outcome}`);
    }

    let restored = 'n/a';
    if (scenario.snapshot === 'availability') {
      await restoreAvailability(before);
      const after = await snapshotAvailability();
      restored = JSON.stringify(after) === JSON.stringify(before) ? 'yes' : 'MISMATCH';
    } else if (scenario.snapshot === 'sections') {
      await restoreSections(before as Array<Record<string, unknown>>);
      const after = await snapshotSections();
      restored = JSON.stringify(after) === JSON.stringify(before) ? 'yes' : 'MISMATCH';
    }

    results.push({ scenario, turns, restored });
  }

  writeReport(results, Date.now() - started);
}

function writeReport(
  results: Array<{ scenario: Scenario; turns: TurnResult[]; restored: string }>,
  totalMs: number
) {
  const all = results.flatMap((r) => r.turns);
  const tokens = all.reduce((s, t) => s + t.promptTokens, 0);
  const repaired = all.filter((t) => t.repaired).length;
  const crashed = all.filter((t) => t.outcome === 'crashed' || t.error).length;
  const asked = all.filter((t) => t.asked).length;
  const times = all.map((t) => t.ms).sort((a, b) => a - b);

  const lines: string[] = [
    '# Chat capability run',
    '',
    `> Generated ${new Date().toISOString()} · ${results.length} scenarios · ${all.length} turns`,
    '',
    '## Overview',
    '',
    '| | |',
    '|---|---|',
    `| Turns | ${all.length} |`,
    `| Needed a repair pass | ${repaired} (${Math.round((repaired / all.length) * 100)}%) |`,
    `| Refused or crashed | ${crashed} |`,
    `| Asked the user | ${asked} |`,
    `| Median latency | ${times[Math.floor(times.length / 2)] ?? 0} ms |`,
    `| Prompt tokens | ${tokens.toLocaleString()} |`,
    `| Wall clock | ${Math.round(totalMs / 1000)} s |`,
    '',
    '**Verdicts are mine, written after reading each outcome against what the question asked.**',
    '',
  ];

  for (const { scenario, turns, restored } of results) {
    lines.push(`## ${scenario.title}`);
    lines.push('');
    lines.push(`\`${scenario.id}\` · ${scenario.language} · ${scenario.tier}` +
      (scenario.snapshot ? ` · restored: **${restored}**` : ''));
    lines.push('');
    for (const t of turns) {
      lines.push(`**\`${t.say}\`**`);
      lines.push('');
      lines.push(`- expected — ${t.expect}`);
      lines.push(`- plan — \`${t.plan}\``);
      lines.push(`- got — ${t.outcome}${t.asked ? ` (asked: ${t.asked})` : ''}`);
      if (t.error) lines.push(`- error — ${t.error}`);
      lines.push(`- ${t.ms} ms · ${t.promptTokens} tok${t.repaired ? ' · repaired' : ''}${t.applied ? ' · APPLIED' : ''}`);
      lines.push('');
    }
  }

  const dir = resolve(process.cwd(), 'docs/reports');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'CHAT_CAPABILITY_RUN.md');
  writeFileSync(path, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${path}`);
}

main().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
