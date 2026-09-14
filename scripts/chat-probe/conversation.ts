/** The user's exact three turns, posted at the real route, in order. */
import { supabaseServer } from '@/lib/supabaseServer';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/business-os/chat-v4/route';
import { getConversationMemory } from '@/lib/business-os/bizql/memory/ConversationMemory';

const TURNS = ['כמה הזמנות שלחתי', 'כמה אושרו', 'מה הסך הכולל שלהם'];

async function main() {
  const { data } = await supabaseServer.from('proposals').select('user_id').limit(1).maybeSingle();
  const userId = data!.user_id as string;
  process.env.CHAT_PROBE_USER_ID = userId;

  await getConversationMemory().clear(userId);

  for (const message of TURNS) {
    const response = await POST(new NextRequest('http://localhost/api/business-os/chat-v4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ message, language: 'he' }),
    }));

    const payload = (await response.json()) as {
      answer?: { text: string; rows: unknown[] };
      understood?: { text: string; note?: string; alternatives: Array<{ label: string }> };
      error?: string;
    };

    console.log(`\n> ${message}`);
    console.log(`   ${payload.answer?.text ?? payload.error}`);
    if (payload.understood) {
      console.log(`   ${payload.understood.text}`);
      if (payload.understood.note) console.log(`   ${payload.understood.note}`);
      if (payload.understood.alternatives.length) {
        console.log(`   [ ${payload.understood.alternatives.map((a) => a.label).join(' ] [ ')} ]`);
      }
    }
  }

  const { data: truth } = await supabaseServer.from('proposals').select('status, total');
  const T = (truth ?? []) as Array<{ status: string; total: number }>;
  const current = T.filter((p) => p.status !== 'superseded');
  const accepted = current.filter((p) => p.status === 'accepted');
  console.log(`\ntruth: ${current.length} current quotes, ${accepted.length} accepted, ₪${accepted.reduce((a, p) => a + Number(p.total), 0).toLocaleString()}`);
}
void main();
