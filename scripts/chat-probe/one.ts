/** One question at the real route, with the plan it produced. */
import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';

async function main() {
  const message = process.argv[2] ?? 'תפרסם את דף הנחיתה';
  const { data } = await supabaseServer.from('proposals').select('user_id').limit(1).maybeSingle();
  const userId = data!.user_id as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  await getConversationMemory().clear(userId);
  await getConfirmationStore().clear(userId);

  const response = await POST(new NextRequest('http://localhost/api/business-os/chat-v4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
    body: JSON.stringify({ message, language: 'he' }),
  }));

  const payload = (await response.json()) as Record<string, unknown>;
  console.log(`\nASKED: ${message}`);
  console.log(`PLAN:  ${JSON.stringify((payload.debug as { plan?: unknown })?.plan ?? '(no debug — set NODE_ENV=development)')}`);
  console.log(`CARD:  ${JSON.stringify((payload.confirmation as { preview?: string[] })?.preview ?? payload.answer ?? payload.error)}`);

  await getConfirmationStore().clear(userId);
}
void main();
