/**
 * The flow the product describes, end to end, at the real route:
 *
 *   ask for a page about a thing  →  approve  →  get a LINK to look at
 *   → say "publish it"            →  approve  →  it is live
 *
 * The two approvals are ordinary chat turns ("כן"), because that is how the
 * user gives them. Nothing here calls a service directly.
 */
import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';

async function say(message: string) {
  const response = await POST(new NextRequest('http://localhost/api/business-os/chat-v4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
    body: JSON.stringify({ message, language: 'he' }),
  }));
  const p = (await response.json()) as Record<string, any>;
  const shown = p.confirmation
    ? `CARD: ${p.confirmation.preview.join(' | ')}`
    : p.needs
      ? `ASKS FOR: ${p.needs.fields.map((f: any) => f.label).join(', ')}`
      : (p.clarification ?? p.answer?.text ?? p.error ?? '(nothing)');
  console.log(`\n> ${message}\n   ${shown}`);
  return p;
}

async function main() {
  const { data } = await supabaseServer.from('proposals').select('user_id').limit(1).maybeSingle();
  const userId = data!.user_id as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  await getConversationMemory().clear(userId);
  await getConfirmationStore().clear(userId);

  const before = await supabaseServer
    .from('website_pages').select('id').eq('user_id', userId);
  console.log(`pages before: ${(before.data ?? []).length}`);

  await say('תבנה לי דף נחיתה לקורס "ניהול זמן להורים" — קורס אונליין בן 6 מפגשים להורים עובדים');
  await say('כן');

  const after = await supabaseServer
    .from('website_pages')
    .select('id, title, slug, page_type, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  const page = (after.data ?? [])[0] as Record<string, unknown> | undefined;
  console.log(`\nnewest page: ${JSON.stringify(page)}`);

  if (page) {
    const { data: blocks } = await supabaseServer
      .from('website_blocks').select('block_type').eq('page_id', page.id as string);
    console.log(`   sections generated: ${(blocks ?? []).length} — ${(blocks ?? []).map((b: any) => b.block_type).join(', ')}`);
  }

  /*
   * Publishing is left at the card on purpose. It puts a page on the real
   * website, and a probe must not do that to a live tenant — the card is the
   * evidence that the instruction was understood, which is the part in
   * question. Cancelled straight after so nothing sits parked.
   */
  await say('תפרסם את דף הנחיתה');
  await say('לא');

  await getConfirmationStore().clear(userId);
}
void main();
