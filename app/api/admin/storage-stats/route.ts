// API route for storage statistics (admin only)
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StorageStatsAdminAPI' });

export async function GET() {
  // No request object on this handler, so the correlation id is generated
  // rather than propagated.
  const requestLogger = logger.child({ correlationId: crypto.randomUUID() });

  try {
    // Admin gate. Nothing above this line may touch a request body,
    // the database, a job queue, or an outbound message (FR-5).
    const gate = await requireAdmin(requestLogger);
    if (gate instanceof NextResponse) return gate;

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
