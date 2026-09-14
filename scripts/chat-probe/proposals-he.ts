/**
 * Twenty Hebrew questions about quotes, run through the real chat pipeline.
 *
 *   npx tsx -r dotenv/config scripts/chat-probe/proposals-he.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS AND NOT THE BENCH
 *
 * `scripts/planner-bench` scores the PLAN — did it pick the right entity and
 * operation. That is the right measure for coverage and the wrong one for
 * "is the answer true": tonight's failures were plans that scored fine and
 * produced ₪45,850 where the truth was ₪15,850.
 *
 * So this posts each question at the REAL route — `POST /api/business-os/
 * chat-v4` — and reads what the browser would have received: the answer text,
 * the rows, the "this is what I understood" line. A re-implementation of the
 * turn would agree with itself and tell us nothing.
 *
 * Two modules are shimmed to run outside Next (see preload.cjs): `server-only`,
 * a compile marker, and `getUser`, which reads cookies. Nothing else.
 *
 * The questions are phrased the way the owner actually types: no field names,
 * no entity names, no hints. They run IN SEQUENCE against one conversation, so
 * the memory behaves exactly as it does for a person working through a list —
 * which is itself part of what is being tested.
 *
 * Reads only: a question that plans a write is reported and never confirmed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';

const TIMEZONE = 'Asia/Jerusalem';

interface Probe {
  ask: string;
  /** What the database says the answer is. Null where a number is not the point. */
  truth: (t: Truth) => number | null;
  /** What the question is really testing. */
  about: string;
}

interface Truth {
  all: number;
  current: number;
  currentTotal: number;
  accepted: number;
  acceptedTotal: number;
  declined: number;
  drafts: number;
  draftTotal: number;
  sent: number;
  awaitingReply: number;
  superseded: number;
  expired: number;
  biggest: number;
  avgCurrent: number;
  avgAccepted: number;
  davidCount: number;
  davidTotal: number;
  clientsWithQuotes: number;
  acceptedShare: number;
}

const PROBES: Probe[] = [
  { ask: 'כמה הצעות מחיר יש לי בסך הכל?',        truth: (t) => t.current,        about: 'the plain count — must exclude replaced versions' },
  { ask: 'כמה הצעות שלחתי ללקוחות?',             truth: (t) => t.sent,           about: 'sent, not existing (was_sent)' },
  { ask: 'כמה הצעות עדיין מחכות לתשובה מהלקוח?', truth: (t) => t.awaitingReply,  about: 'awaiting_reply — a draft is not waiting on the client' },
  { ask: 'כמה הצעות אושרו?',                     truth: (t) => t.accepted,       about: 'a plain enum value, not a semantic term' },
  { ask: 'כמה הצעות נדחו?',                      truth: (t) => t.declined,       about: 'declined ≠ superseded' },
  { ask: 'יש לי הצעות שעדיין בטיוטה?',           truth: (t) => t.drafts,         about: 'draft' },
  { ask: 'מה הסכום הכולל של ההצעות שאושרו?',     truth: (t) => t.acceptedTotal,  about: 'sum + status filter' },
  { ask: 'כמה כסף יש לי בהצעות שעוד פתוחות?',    truth: (t) => t.draftTotal,     about: 'the `open` semantic term + a sum' },
  { ask: 'מה ההצעה הכי גדולה ששלחתי?',           truth: (t) => t.biggest,        about: 'max, and "sent" as a qualifier' },
  { ask: 'מה הסכום הממוצע של הצעה אצלי?',        truth: (t) => t.avgCurrent,     about: 'avg over current versions' },
  { ask: 'מה הממוצע של ההצעות שאושרו?',          truth: (t) => t.avgAccepted,    about: 'avg + filter' },
  { ask: 'כמה הצעות שלחתי החודש?',               truth: null as never,           about: 'a date anchor on sent_at' },
  { ask: 'תראה לי את ההצעות שאושרו',             truth: (t) => t.accepted,       about: 'a list, not a count' },
  { ask: 'לאילו לקוחות שלחתי הצעות?',            truth: (t) => t.clientsWithQuotes, about: 'counting PEOPLE, not quotes' },
  { ask: 'כמה הצעות יש לדויד המלך?',             truth: (t) => t.davidCount,     about: 'filter by client name through a relation' },
  { ask: 'מה הסכום הכולל של ההצעות של דויד?',    truth: (t) => t.davidTotal,     about: 'sum + relation filter' },
  { ask: 'יש הצעות שפג תוקפן?',                  truth: (t) => t.expired,        about: 'the status nothing ever sets — valid_until is the real test' },
  { ask: 'יש הצעות שהחלפתי בגרסה חדשה?',         truth: (t) => t.superseded,     about: 'asking FOR the excluded rows must include them' },
  { ask: 'פלח לי את ההצעות לפי סטטוס',           truth: null as never,           about: 'group by an enum' },
  { ask: 'כמה אחוז מההצעות שלי אושרו?',          truth: (t) => t.acceptedShare,  about: 'a percentage the user DID ask for' },
];

async function groundTruth(userId: string): Promise<Truth> {
  const { data } = await supabaseServer
    .from('proposals')
    .select('id, status, total, sent_at, contact_id, valid_until')
    .eq('user_id', userId);

  const rows = (data ?? []) as Array<{ status: string; total: number; sent_at: string | null; contact_id: string }>;
  const current = rows.filter((r) => r.status !== 'superseded');
  const accepted = current.filter((r) => r.status === 'accepted');
  const drafts = current.filter((r) => r.status === 'draft');
  const sum = (list: Array<{ total: number }>) => list.reduce((a, r) => a + Number(r.total ?? 0), 0);

  const { data: david } = await supabaseServer
    .from('crm_contacts').select('id').ilike('first_name', '%דויד%').eq('user_id', userId).maybeSingle();

  const davidRows = current.filter((r) => r.contact_id === (david?.id as string));

  return {
    all: rows.length,
    current: current.length,
    currentTotal: sum(current),
    accepted: accepted.length,
    acceptedTotal: sum(accepted),
    declined: current.filter((r) => r.status === 'declined').length,
    drafts: drafts.length,
    draftTotal: sum(current.filter((r) => ['draft', 'sent', 'viewed'].includes(r.status))),
    sent: current.filter((r) => r.sent_at).length,
    awaitingReply: current.filter((r) => ['sent', 'viewed'].includes(r.status)).length,
    superseded: rows.filter((r) => r.status === 'superseded').length,
    expired: current.filter((r) => r.status === 'expired').length,
    biggest: Math.max(...current.filter((r) => r.sent_at).map((r) => Number(r.total ?? 0)), 0),
    avgCurrent: Math.round((sum(current) / Math.max(1, current.length)) * 100) / 100,
    avgAccepted: Math.round((sum(accepted) / Math.max(1, accepted.length)) * 100) / 100,
    davidCount: davidRows.length,
    davidTotal: sum(davidRows),
    clientsWithQuotes: new Set(current.map((r) => r.contact_id)).size,
    acceptedShare: Math.round((accepted.length / Math.max(1, current.length)) * 100),
  };
}

/**
 * The figure the answer reported, compared against the truth.
 *
 * Every number in the sentence is considered, not the first one. "אושרו 4 מתוך 7,
 * שזה 57%" is a correct answer to "what percentage were accepted", and reading
 * only the leading figure scored it wrong — a probe that lies about the product
 * is worse than no probe.
 *
 * A percentage is matched on its own terms: 57 and "57%" are the same claim.
 */
function reportsTheNumber(text: string, expected: number, rows: number): boolean {
  const cleaned = text.replace(/[₪$€£‎‏]/g, '').replace(/(\d),(\d)/g, '$1$2');
  const found = [...cleaned.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));

  // A list answers with rows; the sentence may name fewer, having collapsed
  // duplicates.
  if (rows > 0 && Math.abs(rows - expected) < 0.5) return true;

  return found.some((n) => Math.abs(n - expected) < 0.5);
}

async function main() {
  const { data: owner } = await supabaseServer
    .from('proposals').select('user_id').limit(1).maybeSingle();

  const userId = owner!.user_id as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  const truth = await groundTruth(userId);
  console.log(`ground truth: ${JSON.stringify(truth)}\n`);

  // Start from a clean conversation, so the first question is not a follow-up
  // to whatever was asked in the app an hour ago.
  await getConversationMemory().clear(userId);

  let right = 0;
  let judged = 0;
  const issues: string[] = [];

  for (const probe of PROBES) {
    const request = new NextRequest('http://localhost/api/business-os/chat-v4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ message: probe.ask, language: 'he' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as {
      success: boolean;
      error?: string;
      answer?: { text: string; rows: Array<{ label: string }> };
      understood?: { text: string; alternatives: Array<{ label: string }> };
      confirmation?: { preview: string[] };
      clarification?: string;
    };

    const expected = probe.truth ? probe.truth(truth) : null;

    if (payload.confirmation) {
      console.log(`· ${probe.ask}\n    ASKED TO WRITE: ${payload.confirmation.preview.join(' | ')}\n`);
      issues.push(`${probe.ask} — planned a WRITE for a question`);
      continue;
    }

    if (payload.clarification) {
      console.log(`· ${probe.ask}\n    ASKED BACK: ${payload.clarification}\n`);
      continue;
    }

    if (!payload.success || !payload.answer) {
      console.log(`✗ ${probe.ask}\n    REFUSED: ${payload.error}\n    (${probe.about})`);
      issues.push(`${probe.ask} — refused`);
      continue;
    }

    const ok =
      expected === null
        ? null
        : reportsTheNumber(payload.answer.text, expected, payload.answer.rows.length);

    if (ok === true) right += 1;
    if (ok !== null) judged += 1;

    console.log(
      `${ok === null ? '·' : ok ? '✓' : '✗'} ${probe.ask}\n` +
      `    ${payload.answer.text}${payload.answer.rows.length ? `  [${payload.answer.rows.length} rows: ${payload.answer.rows.slice(0, 3).map((r) => r.label).join(', ')}]` : ''}\n` +
      (payload.understood ? `    ${payload.understood.text}\n` : '') +
      (ok === false ? `    EXPECTED ${expected} — ${probe.about}\n` : '')
    );

    if (ok === false) issues.push(`${probe.ask} — truth ${expected} (${probe.about})`);
  }

  console.log(`\n═══ ${right}/${judged} correct where a number could be checked ═══`);
  if (issues.length) console.log(`\nissues:\n  ${issues.join('\n  ')}`);
}

void main();
