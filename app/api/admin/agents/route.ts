// app/api/admin/agents/route.ts
// ADMIN-ONLY: list agents across all users for the calibration test trigger
// (and other admin operator surfaces). Gated strictly via AdminAccessService —
// never profiles.role. Cross-user reads are BY DESIGN (admin operator view) and
// use the service-role client inside AgentRepository.

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { supabaseServer } from '@/lib/supabaseServer';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminAgentsAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate the caller.
    const authSupabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await authSupabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Admin gate (AdminAccessService only).
    const isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
    if (!isAdmin) {
      requestLogger.warn({ userId: user.id }, 'Non-admin attempted to list all agents');
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // 3. Query params.
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;
    const limitRaw = parseInt(searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    // 4. Fetch agents across users (repository uses the service-role client).
    const agentRepo = new AgentRepository();
    const { data: agents, error } = await agentRepo.findAllForAdmin({ search, limit });
    if (error || !agents) {
      requestLogger.error({ err: error }, 'Failed to list agents for admin');
      return NextResponse.json({ success: false, error: 'Failed to list agents' }, { status: 500 });
    }

    // 5. Best-effort owner-email enrichment (friendlier picker). Non-fatal.
    let emailById = new Map<string, string>();
    try {
      const { data: authUsers } = await supabaseServer.auth.admin.listUsers({ page: 1, perPage: 1000 });
      emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || '']));
    } catch (enrichErr) {
      requestLogger.warn({ err: enrichErr }, 'Owner-email enrichment failed (non-fatal)');
    }

    const items = agents.map((a) => ({
      ...a,
      owner_email: emailById.get(a.user_id) || null,
    }));

    requestLogger.info({ count: items.length, search: search || null }, 'Admin agent list returned');
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin agents request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
