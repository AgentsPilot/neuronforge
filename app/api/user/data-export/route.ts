// /app/api/user/data-export/route.ts
// GDPR Article 15 & 20: Right to access and data portability
//
// DE-1 (BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3, §0.4): the file holds the
// person's own account details only (DX-1a): who they are (from the session),
// their profile, and their connected apps. Left out on purpose: agents, agent
// settings and runs (BQ-SA-1, Business OS only), activity and audit history
// (DX-1d), and the Pilot-Credit subscription and transactions (DX-1a: no plan
// or billing data). What each part holds lives in the section registry,
// lib/business-os/data-export/sections.ts; this route only runs it.
//
// Every read goes through a repository (CLAUDE.md rule 1) keyed on the
// authenticated user's id, with the service role, and names its columns, so a
// column added to a table later is not exported until someone decides it should
// be. Plugin credentials are never read; the provider profile (`profile_data`)
// is read, but only allow-listed string fields of it reach the body.
//
// FR-E12: a section that fails to read is marked `status: 'failed'` and listed
// in `summary.failed_sections`, never shown as an empty section. The response
// is still 200: the account identity comes from the session and cannot fail.
//
// WC-7: the `DATA_EXPORTED` audit entry is written with `logAndFlush`, bounded
// and never rejecting, so the audit can neither block nor fail the download.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';
import { EXPORT_SECTIONS, runExportSections, type ExportContext } from '@/lib/business-os/data-export/sections';
import { buildExportPayload, exportFileName, EXPORT_GDPR_ARTICLE } from '@/lib/business-os/data-export/payload';

const logger = createLogger({ module: 'UserDataExportAPI' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Export the person's data in machine-readable format (GDPR compliance)
 *
 * GDPR Requirements:
 * - Article 15: Right to access personal data
 * - Article 20: Right to data portability
 * - Format: JSON (machine-readable)
 * - Scope: the sections in EXPORT_SECTIONS
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Authenticate user. This client is for getUser() only: it is never passed
    // to a section reader (SA C-2).
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    requestLogger.info({ userId: user.id }, 'Data export started');

    const ctx: ExportContext = {
      userId: user.id,
      authUser: { id: user.id, email: user.email ?? null, created_at: user.created_at },
    };

    const sections = await runExportSections(ctx, EXPORT_SECTIONS, requestLogger);
    // One clock reading, so the file name and the dates inside never straddle midnight.
    const exportedAt = new Date();
    const payload = buildExportPayload({
      userId: user.id,
      now: exportedAt,
      sections,
      durationMs: Date.now() - startTime,
    });
    const { section_counts: sectionCounts, failed_sections: failedSections } = payload.summary;

    // Ids and counts only: never content, never the email.
    const completedFields = {
      userId: user.id,
      sectionCounts,
      failedSections,
      exportSizeKb: payload.summary.export_size_kb,
      durationMs: payload.summary.export_duration_ms,
    };
    if (failedSections.length > 0) {
      requestLogger.warn(completedFields, 'Data export completed with failed sections');
    } else {
      requestLogger.info(completedFields, 'Data export completed');
    }

    // AUDIT TRAIL (WC-7). logAndFlush never rejects and logs its own timeout and
    // failure lines, so there is nothing to catch here. Counts only (FR-E15);
    // a failed section's reason is never recorded here (SA C-3).
    await logAndFlush(
      {
        action: AUDIT_EVENTS.DATA_EXPORTED,
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User Data',
        details: {
          export_timestamp: exportedAt.toISOString(),
          export_format: 'JSON',
          format_version: payload.export_metadata.format_version,
          data_categories: sections.filter((section) => section.status === 'ok').map((section) => section.id),
          section_counts: sectionCounts,
          failed_sections: failedSections,
          gdpr_basis: EXPORT_GDPR_ARTICLE,
          ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown',
          user_agent: req.headers.get('user-agent') || 'unknown',
        },
        severity: 'info',
        complianceFlags: ['GDPR', 'SOC2'],
      },
      requestLogger,
      { reason: 'data export', continues: 'the export is still returned' }
    );

    // Return data as downloadable JSON
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${exportFileName(exportedAt)}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });

  } catch (error: unknown) {
    requestLogger.error({ err: error }, 'Data export failed');

    // FU-P2: the cause stays in the log line above; the body carries it only in
    // development (CLAUDE.md error response format).
    return NextResponse.json(
      {
        success: false,
        error: 'Data export failed',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
