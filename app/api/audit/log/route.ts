// app/api/audit/log/route.ts - Audit logging endpoint for the browser.
//
// The account is the session user: the `x-user-id` header and any body `userId`
// are ignored, and there are no anonymous writes (Layer 3 step 0, FR-22). The
// shared handler validates the body and writes through AuditTrailService.
import { NextRequest } from 'next/server';
import { handleClientAuditWrite } from '@/lib/audit/clientAuditWrite';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// POST /api/audit/log - Log an audit event for the signed-in user
export async function POST(request: NextRequest) {
  return handleClientAuditWrite(request, '/api/audit/log');
}
