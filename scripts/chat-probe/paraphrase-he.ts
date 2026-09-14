/**
 * The same intents, asked the way different people ask them.
 *
 *   npx tsx -r dotenv/config -r ./scripts/chat-probe/preload.cjs \
 *     scripts/chat-probe/paraphrase-he.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS AND NOT THE TWENTY-QUESTION PROBE
 *
 * A fixed list of sentences rewards fixing the sentence. That happened: a label
 * gained "(שלחתי)", the probe went green, and three other conjugations of the
 * same verb still failed. A suite that asks each intent several ways cannot be
 * satisfied that way — the only thing that passes it is a mapping that holds.
 *
 * Each phrasing runs in a FRESH conversation, so nothing inherits and every
 * failure belongs to the sentence that produced it. Ground truth is computed
 * from the database at the start of the run.
 *
 * Reads only. A question that plans a write is reported and never confirmed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';

interface Intent {
  what: string;
  /** Several ways a person might ask for the same thing. */
  asks: string[];
  truth: (t: Truth) => number;
}

interface Truth {
  current: number;
  currentTotal: number;
  accepted: number;
  acceptedTotal: number;
  drafts: number;
  draftTotal: number;
  sent: number;
  superseded: number;
  average: number;
}

const INTENTS: Intent[] = [
  {
    what: 'how many quotes exist',
    truth: (t) => t.current,
    asks: ['כמה הצעות מחיר יש לי?', 'כמה הצעות יש לי בסך הכל?', 'תגיד לי כמה הצעות מחיר קיימות אצלי'],
  },
  {
    what: 'how many were SENT',
    truth: (t) => t.sent,
    asks: ['כמה הצעות שלחתי ללקוחות?', 'כמה הצעות מחיר כבר יצאו ללקוחות?', 'כמה מההצעות שלי כבר נשלחו?'],
  },
  {
    what: 'how many were ACCEPTED',
    truth: (t) => t.accepted,
    asks: ['כמה הצעות אושרו?', 'כמה לקוחות אישרו לי הצעה?', 'על כמה הצעות קיבלתי אישור?'],
  },
  {
    what: 'the value of the accepted ones',
    truth: (t) => t.acceptedTotal,
    asks: [
      'מה הסכום הכולל של ההצעות שאושרו?',
      'כמה כסף סגרתי בהצעות שאושרו?',
      'מה השווי של כל ההצעות שהלקוחות אישרו?',
    ],
  },
  {
    what: 'how many are still drafts',
    truth: (t) => t.drafts,
    asks: ['כמה הצעות עדיין בטיוטה?', 'כמה הצעות עוד לא שלחתי?', 'יש לי הצעות שלא יצאו עדיין?'],
  },
  {
    what: 'money sitting in unanswered quotes',
    truth: (t) => t.draftTotal,
    asks: [
      'כמה כסף יש לי בהצעות שעוד פתוחות?',
      'מה הסכום של ההצעות שטרם נענו?',
      'כמה כסף תלוי באוויר בהצעות מחיר?',
    ],
  },
  {
    what: 'the average quote',
    truth: (t) => t.average,
    asks: ['מה הסכום הממוצע של הצעה?', 'כמה שווה הצעה ממוצעת אצלי?', 'מה ממוצע ההצעות שלי?'],
  },
  {
    what: 'versions replaced by a newer one',
    truth: (t) => t.superseded,
    asks: ['כמה הצעות החלפתי בגרסה חדשה?', 'כמה גרסאות ישנות של הצעות יש לי?', 'כמה הצעות הוחלפו?'],
  },
];

async function groundTruth(userId: string): Promise<Truth> {
  const { data } = await supabaseServer
    .from('proposals')
    .select('status, total, sent_at')
    .eq('user_id', userId);

  const rows = (data ?? []) as Array<{ status: string; total: number; sent_at: string | null }>;
  const current = rows.filter((r) => r.status !== 'superseded');
  const sum = (l: Array<{ total: number }>) => l.reduce((a, r) => a + Number(r.total ?? 0), 0);
  const accepted = current.filter((r) => r.status === 'accepted');
  const drafts = current.filter((r) => r.status === 'draft');

  return {
    current: current.length,
    currentTotal: sum(current),
    accepted: accepted.length,
    acceptedTotal: sum(accepted),
    drafts: drafts.length,
    draftTotal: sum(current.filter((r) => ['draft', 'sent', 'viewed'].includes(r.status))),
    sent: current.filter((r) => r.sent_at).length,
    superseded: rows.length - current.length,
    average: Math.round((sum(current) / Math.max(1, current.length)) * 100) / 100,
  };
}

/** Every number in the sentence counts — a right answer often states two. */
function states(text: string, expected: number, rows: number): boolean {
  const cleaned = text.replace(/[₪$€£‎‏]/g, '').replace(/(\d),(\d)/g, '$1$2');
  const found = [...cleaned.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));

  if (rows > 0 && Math.abs(rows - expected) < 0.5) return true;
  return found.some((n) => Math.abs(n - expected) < 0.5);
}

async function ask(message: string): Promise<{ text: string; rows: number; understood?: string }> {
  const response = await POST(
    new NextRequest('http://localhost/api/business-os/chat-v4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ message, language: 'he' }),
    })
  );

  const payload = (await response.json()) as {
    answer?: { text: string; rows: unknown[] };
    understood?: { text: string };
    confirmation?: unknown;
    clarification?: string;
    error?: string;
  };

  if (payload.confirmation) return { text: '[planned a WRITE]', rows: 0 };
  if (payload.clarification) return { text: `[asked back] ${payload.clarification}`, rows: 0 };
  if (!payload.answer) return { text: `[refused] ${payload.error ?? ''}`, rows: 0 };

  return {
    text: payload.answer.text,
    rows: payload.answer.rows.length,
    understood: payload.understood?.text,
  };
}

async function main() {
  const { data: owner } = await supabaseServer.from('proposals').select('user_id').limit(1).maybeSingle();
  const userId = owner!.user_id as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  const truth = await groundTruth(userId);
  console.log(`ground truth: ${JSON.stringify(truth)}\n`);

  const memory = getConversationMemory();
  const failures: string[] = [];
  let landed = 0;
  let asked = 0;

  for (const intent of INTENTS) {
    const expected = intent.truth(truth);
    console.log(`\n── ${intent.what}  (truth: ${expected}) ──`);

    for (const question of intent.asks) {
      // Fresh conversation per phrasing: nothing inherits, so a failure belongs
      // to the sentence rather than to the one before it.
      await memory.clear(userId);

      const answer = await ask(question);
      const ok = states(answer.text, expected, answer.rows);

      asked += 1;
      if (ok) landed += 1;
      else failures.push(`${intent.what}  ←  "${question}"\n      ${answer.text}\n      ${answer.understood ?? ''}`);

      console.log(`  ${ok ? '✓' : '✗'} ${question}`);
      console.log(`      ${answer.text}${answer.rows ? `  [${answer.rows} rows]` : ''}`);
    }
  }

  console.log(`\n═══ ${landed}/${asked} phrasings landed ═══`);

  const byIntent = INTENTS.map((i) => {
    const mine = failures.filter((f) => f.startsWith(i.what)).length;
    return `${i.asks.length - mine}/${i.asks.length}  ${i.what}`;
  });
  console.log(`\nby intent:\n  ${byIntent.join('\n  ')}`);

  if (failures.length) console.log(`\nfailures:\n\n${failures.join('\n\n')}`);
}

void main();
