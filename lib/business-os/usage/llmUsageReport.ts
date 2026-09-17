/**
 * Business OS LLM usage verification report — the reads (Layer 1.1).
 *
 * Runs every ledger read one report needs, in parallel, and hands the results
 * to the pure checks in `llmUsageVerification.ts`. Read-only: no writes, no LLM
 * calls, no audit events.
 *
 * TENANT SCOPE. Only called from the admin-gated report route, after Zod has
 * rejected a platform account as the selected business. Every read is scoped to
 * that one account, or to the platform account ids (Checks 2 and 3's platform
 * parts). `platformAccountIds()` is read ONCE per report, and the same list is
 * queried and returned.
 *
 * FAILURE ISOLATION. `Promise.allSettled` plus `{ data, error }` results: a
 * failed read makes its own checks Fail with a safe message and never zeroes or
 * hides another check (FR-18). Raw errors are logged, never returned.
 *
 * @module lib/business-os/usage/llmUsageReport
 */

import {
  BOS_LEGACY_FEATURES_FLAT,
  BOS_LEGACY_HELPER_LABEL,
  bosRowFilter,
  isPlatformAccountEnvIgnored,
  platformAccountIds,
} from '@/lib/business-os/llm/callCatalog';
import {
  tokenUsageRepository,
  type TokenUsageMatch,
  type TokenUsageRepository,
  type TokenUsageWindow,
} from '@/lib/repositories/TokenUsageRepository';
import {
  businessProfileRepository,
  type BusinessProfileRepository,
} from '@/lib/repositories/BusinessProfileRepository';
import {
  LLM_USAGE_LIMITS,
  READ_FAILED,
  classifyCallRow,
  computeAreaTotals,
  evaluateCallsCheck,
  evaluateGroupsCheck,
  evaluateLegacyLabelsCheck,
  evaluatePlatformAccountCheck,
  evaluateUsageCardCheck,
  readOk,
  type PagedCalls,
  type ReadResult,
  type ReportWindow,
} from './llmUsageVerification';
import { readTokensPerCredit, readUsageSummary, type UsageSummaryLogger } from './usageSummary';
import type { LlmUsageReport, ReportTrigger } from './llmUsageReportTypes';

export interface LlmUsageReportLogger extends UsageSummaryLogger {
  error: (ctx: Record<string, unknown>, msg: string) => void;
}

export interface LlmUsageReportDeps {
  tokenUsage: Pick<TokenUsageRepository, 'listCallsInWindow' | 'countInWindow' | 'listLabelsInWindow'>;
  profiles: Pick<BusinessProfileRepository, 'findByUserId'>;
  readUsageSummary: typeof readUsageSummary;
  readTokensPerCredit: typeof readTokensPerCredit;
}

const defaultDeps: LlmUsageReportDeps = {
  tokenUsage: tokenUsageRepository,
  profiles: businessProfileRepository,
  readUsageSummary,
  readTokensPerCredit,
};

export interface BuildLlmUsageReportInput {
  accountId: string;
  window: ReportWindow;
  trigger: ReportTrigger;
}

type RepoResult<T> = { data: T | null; error: Error | null };

/** A settled repository call → a check input; failures are logged with the read's name only. */
function settle<T>(
  name: string,
  outcome: PromiseSettledResult<RepoResult<T>>,
  log: LlmUsageReportLogger
): ReadResult<T> {
  if (outcome.status === 'rejected') {
    log.error({ err: outcome.reason, read: name }, 'LLM usage report read threw');
    return READ_FAILED;
  }
  if (outcome.value.error || outcome.value.data === null) {
    log.error({ err: outcome.value.error, read: name }, 'LLM usage report read failed');
    return READ_FAILED;
  }
  return readOk(outcome.value.data);
}

export async function buildLlmUsageReport(
  input: BuildLlmUsageReportInput,
  log: LlmUsageReportLogger,
  deps: LlmUsageReportDeps = defaultDeps
): Promise<LlmUsageReport> {
  const { accountId, window, trigger } = input;
  const platformIds = platformAccountIds();
  const ledgerWindow: TokenUsageWindow = { start: window.start, end: window.end };
  const rowFilter = bosRowFilter();

  const platformRowsMatch: TokenUsageMatch = { kind: 'row_filter', filter: rowFilter };
  const legacyMatch: TokenUsageMatch = { kind: 'features', features: BOS_LEGACY_FEATURES_FLAT };
  const helperMatch: TokenUsageMatch = {
    kind: 'label',
    feature: BOS_LEGACY_HELPER_LABEL.feature,
    component: BOS_LEGACY_HELPER_LABEL.component,
  };

  const [r1, r2, r3, r4, r5, r6, r7, r8, r8Credit, r9] = await Promise.allSettled([
    deps.tokenUsage.listCallsInWindow(accountId, ledgerWindow, rowFilter, {
      pageSize: LLM_USAGE_LIMITS.PAGE_SIZE,
      ceiling: LLM_USAGE_LIMITS.READ_CEILING,
    }),
    deps.tokenUsage.countInWindow(platformIds, ledgerWindow, platformRowsMatch),
    deps.tokenUsage.listLabelsInWindow(
      platformIds,
      ledgerWindow,
      platformRowsMatch,
      LLM_USAGE_LIMITS.PLATFORM_BREAKDOWN_ROWS
    ),
    deps.tokenUsage.countInWindow(platformIds, ledgerWindow, legacyMatch),
    deps.tokenUsage.countInWindow([accountId], ledgerWindow, helperMatch),
    deps.tokenUsage.countInWindow(platformIds, ledgerWindow, helperMatch),
    deps.tokenUsage.listLabelsInWindow(platformIds, ledgerWindow, helperMatch, LLM_USAGE_LIMITS.HELPER_TIMESTAMPS),
    // Check 5: the card's own computation, from the start with no end bound (M-1).
    deps.readUsageSummary(accountId, window.start, log),
    deps.readTokensPerCredit(),
    // The business name is display data, looked up on manual refreshes only:
    // the profile read logs at info, which auto-refresh would flood (WC-6).
    trigger === 'manual' ? deps.profiles.findByUserId(accountId) : Promise.resolve(null),
  ]);

  const callsRead = settle('R1 selected-account calls', r1, log);
  const selectedCalls: ReadResult<PagedCalls> = callsRead.ok
    ? readOk({ rows: callsRead.value.rows.map(classifyCallRow), incomplete: callsRead.value.reachedCeiling })
    : READ_FAILED;

  let summary: Parameters<typeof evaluateUsageCardCheck>[0]['summary'] = READ_FAILED;
  if (r8.status === 'fulfilled') summary = readOk(r8.value);
  else log.error({ err: r8.reason, read: 'R8 usage summary' }, 'LLM usage report read threw');

  // readTokensPerCredit never rejects (it falls back to 10); guard anyway.
  const tokensPerCredit = r8Credit.status === 'fulfilled' ? r8Credit.value : 10;

  let account: LlmUsageReport['account'] = { userId: accountId, companyName: null, profileLookup: 'skipped' };
  if (trigger === 'manual') {
    if (r9.status === 'fulfilled' && r9.value && !r9.value.error) {
      account = {
        userId: accountId,
        companyName: r9.value.data?.company_name ?? null,
        profileLookup: r9.value.data ? 'found' : 'none',
      };
    } else {
      log.error(
        { err: r9.status === 'rejected' ? r9.reason : r9.value?.error, read: 'R9 business name' },
        'LLM usage report business name lookup failed; report continues without it'
      );
      account = { userId: accountId, companyName: null, profileLookup: 'failed' };
    }
  }

  return {
    account,
    window: { start: window.start.toISOString(), end: window.end.toISOString(), startClamped: window.startClamped },
    platformAccountIdsChecked: platformIds,
    platformAccountEnvIgnored: isPlatformAccountEnvIgnored(),
    incomplete: selectedCalls.ok && selectedCalls.value.incomplete,
    trigger,
    limits: {
      pageSize: LLM_USAGE_LIMITS.PAGE_SIZE,
      readCeiling: LLM_USAGE_LIMITS.READ_CEILING,
      displayRows: LLM_USAGE_LIMITS.DISPLAY_ROWS,
      displayGroups: LLM_USAGE_LIMITS.DISPLAY_GROUPS,
      platformBreakdownRows: LLM_USAGE_LIMITS.PLATFORM_BREAKDOWN_ROWS,
      helperTimestamps: LLM_USAGE_LIMITS.HELPER_TIMESTAMPS,
    },
    checks: {
      calls: evaluateCallsCheck(selectedCalls),
      platformAccount: evaluatePlatformAccountCheck(
        settle('R2 platform-account count', r2, log),
        settle('R3 platform-account breakdown', r3, log)
      ),
      legacyLabels: evaluateLegacyLabelsCheck({
        selectedCalls,
        legacyOnPlatformCount: settle('R4 platform legacy count', r4, log),
        helperLabelOnSelectedCount: settle('R5 selected helper-label count', r5, log),
        helperLabelOnPlatformCount: settle('R6 platform helper-label count', r6, log),
        helperLabelOnPlatformRows: settle('R7 platform helper-label timestamps', r7, log),
      }),
      groups: evaluateGroupsCheck(selectedCalls),
      usageCard: evaluateUsageCardCheck({ summary, tokensPerCredit }),
    },
    areaTotals: computeAreaTotals(selectedCalls),
  };
}
