/**
 * Can the chat build a landing page? Asked several ways, through the real
 * route. Nothing is confirmed, so nothing is written — the run stops at the
 * card the user would approve.
 */
import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';

const ASKS = [
  'תבנה לי דף נחיתה',
  'אני רוצה דף נחיתה חדש לקורס הקיץ',
  'צור דף נחיתה בשם "שיפוץ מטבחים"',
  'תוסיף לדף הנחיתה סקשן של המלצות',
  'תפרסם את דף הנחיתה',
];

async function main() {
  const { data } = await supabaseServer.from('website_pages').select('user_id').limit(1).maybeSingle();
  const { data: fallback } = await supabaseServer.from('proposals').select('user_id').limit(1).maybeSingle();
  const userId = (data?.user_id ?? fallback!.user_id) as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  const { data: pages } = await supabaseServer
    .from('website_pages').select('id, title, slug, page_type, status').eq('user_id', userId);
  console.log(`existing pages: ${(pages ?? []).length}`);
  for (const p of (pages ?? []) as Array<Record<string, unknown>>) {
    console.log(`   ${String(p.page_type).padEnd(9)} ${String(p.status).padEnd(9)} ${p.slug}  "${p.title}"`);
  }

  for (const message of ASKS) {
    await getConversationMemory().clear(userId);
    await getConfirmationStore().clear(userId);

    const response = await POST(new NextRequest('http://localhost/api/business-os/chat-v4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ message, language: 'he' }),
    }));

    const payload = (await response.json()) as {
      confirmation?: { preview: string[]; canAttach?: boolean };
      needs?: { fields: Array<{ label: string }> };
      clarification?: string;
      answer?: { text: string };
      error?: string;
    };

    console.log(`\n> ${message}`);
    if (payload.confirmation) console.log(`   CARD: ${payload.confirmation.preview.join(' | ')}`);
    else if (payload.needs) console.log(`   ASKS FOR: ${payload.needs.fields.map((f) => f.label).join(', ')}`);
    else if (payload.clarification) console.log(`   ASKS BACK: ${payload.clarification}`);
    else console.log(`   ${payload.answer?.text ?? payload.error}`);
  }

  // Nothing must be left parked after a dry look at writes.
  await getConfirmationStore().clear(userId);
}
void main();
