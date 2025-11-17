// API route for storage statistics (admin only)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  try {
    const { data: subscriptions, error } = await supabaseAdmin
      .from('user_subscriptions')
      .select('user_id, storage_quota_mb, storage_used_mb, status, balance, total_spent, total_earned');

    if (error) throw error;

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, email');

    if (profileError) throw profileError;

    return NextResponse.json({ subscriptions, profiles });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
