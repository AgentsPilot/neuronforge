import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

// Mark as dynamic since it uses request.url and searchParams
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') || 'all';
    const search = searchParams.get('search') || '';

    let query = supabase
      .from('contact_messages')
      .select('*')
      .order('created_at', { ascending: false });

    // Apply status filter
    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    // Apply search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,message.ilike.%${search}%,subject.ilike.%${search}%,company.ilike.%${search}%`);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
    }

    // Fetch replies for each message
    const messagesWithReplies = await Promise.all(
      messages.map(async (message) => {
        const { data: replies } = await supabase
          .from('message_replies')
          .select('*')
          .eq('message_id', message.id)
          .order('created_at', { ascending: true });

        return {
          ...message,
          replies: replies || []
        };
      })
    );

    return NextResponse.json({ messages: messagesWithReplies });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}