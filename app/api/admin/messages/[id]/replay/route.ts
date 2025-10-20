import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { content, send_email } = body;
    const { id: messageId } = params;

    // Get the original message
    const { data: message, error: messageError } = await supabase
      .from('contact_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Create reply record
    const { data: reply, error: replyError } = await supabase
      .from('message_replies')
      .insert({
        message_id: messageId,
        sender: 'admin',
        content,
        admin_id: 'admin-user-id' // Replace with actual admin user ID
      })
      .select()
      .single();

    if (replyError) {
      console.error('Reply creation error:', replyError);
      return NextResponse.json({ error: 'Failed to create reply' }, { status: 500 });
    }

    // Update message status to replied
    await supabase
      .from('contact_messages')
      .update({ 
        status: 'replied',
        email_sent: send_email,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId);

    // Send email if requested
    if (send_email) {
      // TODO: Implement email sending logic here
      // You can use Nodemailer, SendGrid, or your preferred email service
      console.log(`Would send email to ${message.email}:`, content);
    }

    return NextResponse.json({ 
      reply_id: reply.id,
      admin_id: reply.admin_id,
      success: true 
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
