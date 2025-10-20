// app/api/admin/users/[id]/terminate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin access
);

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = params.id;
    const body = await request.json();
    const { reason } = body;

    console.log(`Terminating user ${userId} for reason: ${reason || 'No reason provided'}`);

    // Delete user from Supabase Auth
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Error deleting user from auth:', deleteError);
      return NextResponse.json({
        error: 'Failed to terminate user',
        details: deleteError.message
      }, { status: 500 });
    }

    // Note: The profile record will be automatically deleted if you have CASCADE on the foreign key
    // If not, you might want to manually delete or mark it as terminated:
    // await supabase.from('profiles').delete().eq('id', userId);

    // Log the termination in audit trail if you have one
    try {
      await supabase.from('audit_trail').insert({
        user_id: userId,
        action: 'TERMINATE_USER',
        entity_type: 'user',
        entity_id: userId,
        details: { reason: reason || 'No reason provided', terminated_by: 'admin' },
        created_at: new Date().toISOString()
      });
    } catch (auditError) {
      console.log('Could not log to audit trail:', auditError);
      // Continue even if audit logging fails
    }

    console.log(`Successfully terminated user ${userId}`);

    return NextResponse.json({
      success: true,
      message: 'User terminated successfully'
    });

  } catch (error) {
    console.error('User termination API error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
