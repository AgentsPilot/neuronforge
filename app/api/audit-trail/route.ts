// app/api/audit-trail/route.ts
// Audit trail write endpoint for the browser (one caller: the settings plugins tab).
//
// POST shares the /api/audit/log handler: the account is the session user, never
// the body's `userId` (Layer 3 step 0, FR-22).
//
// The GET handler was removed in Layer 3 step 0. It read any account's audit log
// from a `?userId=` query parameter with no login, it had no caller, and it had
// not worked for some time (it passed two arguments to a one-argument query and
// read `.length` off a result object).

import { NextRequest } from 'next/server';
import { handleClientAuditWrite } from '@/lib/audit/clientAuditWrite';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// POST /api/audit-trail - Log an audit trail event for the signed-in user
export async function POST(request: NextRequest) {
  return handleClientAuditWrite(request, '/api/audit-trail');
}
