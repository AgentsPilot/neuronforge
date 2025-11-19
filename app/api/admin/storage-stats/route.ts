// API route for storage statistics (admin only)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data: subscriptions, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select('user_id, storage_quota_mb, storage_used_mb, status, balance, total_spent, total_earned');

    if (error) throw error;

    // Get emails from auth.users table
    const { data: users, error: usersError } = await supabaseAdmin.auth.admin.listUsers();

    if (usersError) throw usersError;

    // Map user IDs to emails
    const profiles = users.users.map(user => ({
      id: user.id,
      email: user.email || 'Unknown'
    }));

    return NextResponse.json({ subscriptions, profiles });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
