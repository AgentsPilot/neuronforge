/**
 * The ledger, as a file for the accountant.
 *
 *   GET /api/payments/ledger/export
 *     ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     &format=xlsx|csv
 *     &payments=1&refunds=1&invoices=0&fees=1&tax=1&refs=1
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The orders page exports what is ON SCREEN — the rows currently loaded, capped
 * by pagination. That is a useful "save what I am looking at" and it stays.
 *
 * This is the other job: hand a whole period to somebody who has to reconcile
 * it. Server-side, so no page cap; a date range; refunds as their own dated
 * rows; and the tax and fee splits an accountant asks for.
 *
 * The shaping lives in `lib/payments/ledgerExport`, which is where the rules
 * about dates, signs and per-currency totals are written down and tested. This
 * file fetches, formats and serves.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/payments/ledger/export
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import {
  buildLedgerReport,
  ledgerFilename,
  ledgerToCsv,
  ledgerToWorkbook,
  LedgerReadError,
} from '@/lib/payments/ledgerService';
import type { LedgerExportOptions } from '@/lib/payments/ledgerExport';

const logger = createLogger({ module: 'LedgerExportAPI' });

const flag = (value: string | null, fallback: boolean): boolean =>
  value === null ? fallback : value === '1' || value === 'true';

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const parsed = QuerySchema.safeParse({
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      format: params.get('format') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid export options' }, { status: 400 });
    }

    const { from, to, format } = parsed.data;

    const options: LedgerExportOptions = {
      includePayments: flag(params.get('payments'), true),
      includeRefunds: flag(params.get('refunds'), true),
      includeInvoices: flag(params.get('invoices'), false),
      includeFees: flag(params.get('fees'), true),
      includeTax: flag(params.get('tax'), true),
      includeReferences: flag(params.get('refs'), true),
    };

    if (!options.includePayments && !options.includeRefunds && !options.includeInvoices) {
      return NextResponse.json(
        { success: false, error: 'Nothing selected to export' },
        { status: 400 }
      );
    }

    /*
     * The gathering and shaping now live in `lib/payments/ledgerService`, so a
     * scheduled send or a chat capability produces the same numbers as this
     * download rather than reimplementing four queries and hoping they agree.
     * This route validates, formats and serves.
     */
    const report = await buildLedgerReport({ userId: user.id, from, to, options });

    if (format === 'csv') {
      /*
       * One sheet's worth, since CSV has no sheets. The ledger is the one that
       * has to survive — the summary is derivable from it, and appending totals
       * under the rows would put two different table shapes in one file, which
       * is what stops a spreadsheet importing it cleanly.
       */
      requestLogger.info(
        { userId: user.id, rows: report.rows.length, from, to, format },
        'Ledger exported'
      );

      return new NextResponse(ledgerToCsv(report), {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8;',
          'Content-Disposition': `attachment; filename="${ledgerFilename(report, 'csv')}"`,
        },
      });
    }

    const buffer = await ledgerToWorkbook(report);

    requestLogger.info(
      {
        userId: user.id,
        rows: report.rows.length,
        invoices: report.invoiceRows.length,
        currencies: report.summary.length,
        from,
        to,
        format,
      },
      'Ledger exported'
    );

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${ledgerFilename(report, 'xlsx')}"`,
      },
    });
  } catch (error) {
    if (error instanceof LedgerReadError) {
      requestLogger.error({ err: error.cause }, 'Ledger export failed to read');
      return NextResponse.json(
        { success: false, error: 'Could not read the ledger' },
        { status: 500 }
      );
    }

    requestLogger.error({ err: error }, 'Ledger export failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
