/**
 * The recorded AI cost's two usage-log reads, bound ONCE (Money MK-3,
 * SA-Q-MK3-1; first bound in the finance route by Money M-4, §11F.7).
 *
 * Two admin routes show the recorded AI cost for a window: Finance (Section 3)
 * and the AI cost page's report (`/api/admin/business-os/credits/report`). Both
 * take their reads from here, so the two cannot read the usage log
 * differently: same methods, same Business OS row filter, same paging, same
 * end conversion.
 *
 *   - no business picked: the Health tile's all-accounts read
 *     `listCostPointsAllAccountsInWindow`, bound to the request's admin read
 *     context, paged at 1,000 up to its ceiling, stopped by the signal;
 *   - one business picked: the Businesses drawer's one-account read
 *     `listCallsInWindow`, `.eq('user_id')` by signature, with exactly the id
 *     the caller has already validated. No signal (SA-Q53): raced only.
 *
 * Both readers are inclusive at the end and the callers' windows are
 * half-open, so each gets `end` less 1 ms (SA-Q52).
 *
 * This is the ONE file that names a usage-log reader for these two routes
 * (the finance source guard pins exactly these two methods here). It lives
 * under `app/api/admin/**`, the only place the admin analytics repository may
 * be imported. Server-only; read-only.
 *
 * @module app/api/admin/business-os/finance/recordedReads
 */

import 'server-only';

import { bosRowFilter } from '@/lib/business-os/llm/callCatalog';
import { settle } from '@/lib/business-os/credits/aiActivity';
import type { FinanceHealthDeps } from '@/lib/business-os/finance/financeHealth';
import type { FinanceSpan } from '@/lib/business-os/finance/financeWindow';
import type { RecordedReadInput } from '@/lib/business-os/finance/recordedCost';
import { ReadDeadlineError, underDeadline, type ReadTiming } from '@/lib/admin/readUnderDeadline';
import {
  adminTokenUsageAnalyticsRepository,
  ADMIN_HEALTH_READ_LIMITS,
  type AdminReadContext,
} from '@/lib/repositories/AdminTokenUsageAnalyticsRepository';
import { tokenUsageRepository, TOKEN_USAGE_READ_LIMITS } from '@/lib/repositories/TokenUsageRepository';

/** SA-Q52: both reused usage-log reads are inclusive at the end; the callers' windows are exclusive. */
const inclusiveEnd = (to: Date) => new Date(to.getTime() - 1);

export type RecordedReads = Pick<FinanceHealthDeps, 'readRecordedAllAccounts' | 'readRecordedForAccount'>;

/** How the recorded read ended, for the caller's one log line (counts and flags only). */
export interface RecordedReadOutcome {
  read: RecordedReadInput;
  kind: 'all_accounts' | 'account';
  outcome: 'ok' | 'deadline' | 'failed';
  ms: number | null;
}

/**
 * The AI cost report's run of the recorded read (Money MK-3), as Finance runs
 * it in `financeHealth.ts`: with a business, only the one-account read, with
 * exactly that (already validated) id, raced against the deadline; with none,
 * only the all-accounts read, whose paging the deadline's signal stops. Never
 * rejects: a failed or late read is `{ kind: 'failed' }`, which the builder
 * turns into Unknown (R4-9).
 */
export async function runRecordedRead(
  reads: RecordedReads,
  accountId: string | null,
  span: FinanceSpan,
  deadlineMs: number
): Promise<RecordedReadOutcome> {
  const timings: ReadTiming[] = [];
  const noData = () => new Error('Recorded read returned no data');
  const result =
    accountId !== null
      ? await underDeadline<RecordedReadInput>(
          'recorded',
          timings,
          () =>
            settle(async () => {
              const r = await reads.readRecordedForAccount(accountId, span);
              return r.error || !r.data
                ? { data: null, error: r.error ?? noData() }
                : { data: { kind: 'account' as const, ...r.data }, error: null };
            }),
          deadlineMs
        )
      : await underDeadline<RecordedReadInput>(
          'recorded',
          timings,
          (signal) =>
            settle(async () => {
              const r = await reads.readRecordedAllAccounts(span, signal);
              return r.error || !r.data
                ? { data: null, error: r.error ?? noData() }
                : { data: { kind: 'all_accounts' as const, ...r.data }, error: null };
            }),
          deadlineMs
        );
  return {
    read: result.ok ? result.value : { kind: 'failed' },
    kind: accountId !== null ? 'account' : 'all_accounts',
    outcome: result.ok ? 'ok' : result.error instanceof ReadDeadlineError ? 'deadline' : 'failed',
    ms: timings[0]?.ms ?? null,
  };
}

/**
 * The two reads, bound to this request's admin read context. Kept LAST in the
 * file: the finance source guard slices each binding from its key onwards.
 */
export function recordedReads(adminReadContext: AdminReadContext): RecordedReads {
  return {
    // M-4 (§11F.7): the Health tile's all-accounts read, Business OS rows only (SA-WR-48), called
    // only with no business picked; the signal stops its paging at the deadline.
    readRecordedAllAccounts: (span, signal) =>
      adminTokenUsageAnalyticsRepository.listCostPointsAllAccountsInWindow(
        adminReadContext,
        { start: span.from.toISOString(), end: inclusiveEnd(span.to).toISOString() },
        { featureFilter: bosRowFilter() },
        { pageSize: ADMIN_HEALTH_READ_LIMITS.PAGE_SIZE, ceiling: ADMIN_HEALTH_READ_LIMITS.CEILING, signal }
      ),
    // M-4: the Businesses drawer's one-account read (`.eq('user_id')` by signature), Business OS
    // rows only (SA-WR-48), with exactly the picked id the caller checked. No signal (SA-Q53).
    readRecordedForAccount: (id, span) =>
      tokenUsageRepository.listCallsInWindow(
        id,
        { start: span.from, end: inclusiveEnd(span.to) },
        bosRowFilter(),
        { pageSize: TOKEN_USAGE_READ_LIMITS.MAX_PAGE_SIZE, ceiling: TOKEN_USAGE_READ_LIMITS.MAX_CEILING }
      ),
  };
}
