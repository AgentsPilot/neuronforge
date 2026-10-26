/**
 * @jest-environment jsdom
 */

/**
 * Finance F-5, Pin A (AC-178, SA F5-R4): every existing user of the shared
 * `KpiTile` / `KpiStrip` renders byte-identically across F-5.
 *
 * Written FIRST and run green on the unchanged tree (447d17a2, before the
 * statuses, the optional value, `detail` and the cross-page mode existed),
 * then never edited again. Its SHA-256 is recorded in the F-5 workplan's
 * Implementation Notes at Step 0 and at handover; the two must be equal.
 *
 * Each case renders on its own, and its `innerHTML` is normalised (React
 * `useId` values become `:id:`, so render order cannot move a hash) and hashed
 * with SHA-256. A mismatch prints the case name and the normalised HTML.
 *
 * Part A1: every prop shape the ten caller pages pass (anchor, same-page
 * filter, no target; neutral, red, amber; with and without a sub-line; the
 * strip with children, with placeholders, and with both, as Jobs passes).
 * Part A3 (added ONCE by Money MK-5, SA-RR-MK pins table "Pin A (the new
 * Finance KpiTile usage)"): the shapes the Finance strip now passes, each with
 * MK-0's indicator. A1 and A2 and their hashes are unchanged; the file's old
 * and new SHA-256 are in docs/workplans/ADMIN_MONEY_MK5_STRIP_USD_WORKPLAN.md.
 *
 * RE-FROZEN by MK-0a (the user's decisions of 2026-10-19: every strip tile the
 * same size, `auto-rows-fr` on the strip; the indicator a word pill with its
 * tooltip below the box). Every case that renders the strip, and the A3
 * indicator cases, have new hashes; a bare KpiTile with no indicator is
 * byte-identical. The old and new values are in
 * docs/workplans/ADMIN_MONEY_MK0A_INDICATOR_PILL_WORKPLAN.md.
 *
 * Part A2: the real caller components, with figures and while loading. Jobs'
 * tiles are module-private (SA-W5): their shapes are in A1, and its own layout
 * test stays unedited. Model pricing goes through its real `priceKpis.ts`.
 * Amended by Exchange rates 1a (SQ-7): three ExchangeRatesKpis cases appended; every existing hash unchanged.
 * Amended by Exchange rates 1c.1 (SQ-15): the strip's own tiles changed, so "loading" is re-hashed, the two stale cases are removed, four cases are appended; no other case or hash touched.
 * Amended 2026-10-20 (user request): the Last rate change tile rounds each rate to 3 decimals, so the three Exchange rates cases that show a rate are re-hashed; no other case or hash touched.
 * Amended by Exchange rates 1d: fixtures gain `lastChange`; no case or hash changed.
 * Amended 2026-10-25 by Exchange rates 1e (SA §13.8 SQ-51 (7)): a third tile, "Rates last checked", so the five ExchangeRatesKpis cases are re-hashed (loading has 3 placeholders; the four payload cases pass `lastSync` ok, names kept) and two cases are appended (none, unavailable); no other case or hash touched.
 * Amended 2026-10-25 by Exchange rates 1f (SA §13.9 SQ-57): `FX_LAST_SYNC_OK` gains its checker (Anna Admin), so the four payload cases that draw it are re-hashed (two tiles, no history, name lookup failed, old rate null); loading, last sync none and last sync unavailable keep their hashes; two cases are appended (checker label failed, no checker); no other case or hash touched.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { createHash } from 'crypto';

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';

import { AnalyticsKpis } from '@/app/admin/analytics/components/AnalyticsKpis';
import type { AnalyticsFilters } from '@/app/admin/analytics/analyticsFilters';
import type { CategoryTotals, PeriodComparison } from '@/app/admin/analytics/analyticsTypes';
import { ArchivingKpis } from '@/app/admin/archiving/components/ArchivingKpis';
import type { ArchivingOverview } from '@/lib/archiving/types';
import { InviteKpis } from '@/app/admin/business-os-invites/components/InviteKpis';
import type { InvitesPayload } from '@/app/admin/business-os-invites/types';
import { ActivityKpis } from '@/app/admin/business-os-llm/components/activity/ActivityKpis';
import type { ActivityFilters } from '@/app/admin/business-os-llm/activityFilters';
import type { ActivityPayload } from '@/app/admin/business-os-llm/activityTypes';
import { CostsKpis } from '@/app/admin/business-os-llm/components/costs/CostsKpis';
import type { CostReportPayload } from '@/app/admin/business-os-llm/costTypes';
import { SettingsKpis } from '@/app/admin/business-os-llm/components/SettingsKpis';
import type { SettingsPayload } from '@/app/admin/business-os-llm/types';
import { PlansKpis } from '@/app/admin/business-os-tiers/components/PlansKpis';
import type { PlansPayload } from '@/app/admin/business-os-tiers/types';
import { BusinessesKpis } from '@/app/admin/users/components/BusinessesKpis';
import { lastCheckKpi, modelsInUseKpi, pendingKpi, underchargingKpi } from '@/app/admin/system-config/priceKpis';
import type { CheckStatusState } from '@/app/admin/system-config/priceKpis';
import type { ComparisonRow } from '@/lib/ai/pricing-research/comparisonModel';
import { KPI_WORDS } from '@/app/admin/system-config/priceReviewCopy';
import { ExchangeRatesKpis } from '@/app/admin/exchange-rates/components/ExchangeRatesKpis';
import type { ExchangeRateHistoryWire, ExchangeRatesPayload, ExchangeRateWire } from '@/lib/admin/exchangeRates/exchangeRateRules';
import type { LastRateSyncWire } from '@/lib/admin/exchangeRates/rateSyncRules';

/** Generous: the merge queue runs suites in parallel (the F-4 amendment lesson). */
const CASE_TIMEOUT_MS = 30_000;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const normalise = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':id:');

function htmlOf(element: React.ReactElement): string {
  const { container, unmount } = render(element);
  const html = normalise(container.innerHTML);
  unmount();
  return html;
}

const noop = () => undefined;

// Fixtures below are partial objects of large wire types: each caller reads
// only the listed fields, so a double assertion through `unknown` is used
// instead of building every unrelated field (test-only; no `any`).

const analyticsTile = (patch: Partial<AnalyticsFilters>) => ({ href: `/admin/analytics?p=${Object.keys(patch).join(',')}`, apply: noop });
const ANALYTICS_TOTALS = { cost: 4.25, tokens: 900, inputTokens: 600, outputTokens: 300, calls: 12 };
const ANALYTICS_CATEGORIES = {
  creation: { cost: 1, tokens: 100, calls: 2 },
  execution: { cost: 2, tokens: 200, calls: 4 },
  memory: { cost: 0.25, tokens: 50, calls: 1 },
  system: { cost: 1, tokens: 550, calls: 5 },
} as unknown as CategoryTotals;
const ANALYTICS_COMPARISON = { changes: { costPct: 12.5 } } as unknown as PeriodComparison;

const ARCHIVING: ArchivingOverview = {
  generatedAt: '2026-10-09T10:00:00.000Z',
  runsEnabled: true,
  sources: [
    {
      key: 'audit_trail',
      label: 'Audit trail',
      totalRows: 120,
      oldestRecordAt: '2026-01-01T00:00:00.000Z',
      options: [
        { retentionDays: 90, cutoff: '2026-07-11T00:00:00.000Z', eligibleRows: 40 },
        { retentionDays: 180, cutoff: '2026-04-12T00:00:00.000Z', eligibleRows: 20 },
        { retentionDays: 365, cutoff: '2025-10-09T00:00:00.000Z', eligibleRows: 0 },
      ],
      archivedTotal: 300,
      latestCutoff: null,
      lastRun: null,
    },
  ],
  runs: [],
} as unknown as ArchivingOverview;
const ARCHIVING_FAILED_RUN = {
  ...ARCHIVING,
  runs: [{ status: 'failed', isStale: false, startedAt: '2026-10-08T09:00:00.000Z', rowsArchived: 5 }],
} as unknown as ArchivingOverview;

const invite = (state: string) => ({ state });
const INVITES = { invites: [invite('pending'), invite('accepted'), invite('expired'), invite('revoked'), invite('pending')], truncated: true } as unknown as InvitesPayload;

const ACTIVITY_FILTERS = { outcome: 'failed', area: '', sort: 'time' } as unknown as ActivityFilters;
const activityTile = (patch: Partial<ActivityFilters>) => ({ href: `/admin/business-os-llm?p=${Object.keys(patch).join(',')}`, apply: noop });
const ACTIVITY = {
  rows: [
    { outcome: 'failed', costUsd: { net: 0.5 } },
    { outcome: 'ok', costUsd: { net: null } },
  ],
  capped: true,
  total: null,
  unresolvedAdjustments: 2,
  cutover: { coverage: 'after_cutover' },
} as unknown as ActivityPayload;

const COSTS = {
  sections: { totals: 'ok', rows: 'ok' },
  incomplete: true,
  grandTotal: { stored: { creditsTotal: 1500, costUsd: 3.25, charges: 40 } },
  periods: [{ matches: true }, { matches: false }, { matches: null }],
  mismatchedPeriods: 1,
  fallback: { count: 2, reconciled: 1 },
  chargedInWindow: { status: 'ok', costUsd: 2.5 },
} as unknown as CostReportPayload;

const SETTINGS = {
  areas: [
    { area: 'chat', switchable: true, configuredEnabled: true, calls: [{ resolved: { enabled: false } }, { resolved: { enabled: true } }], excludedCalls: [], areaIssues: [] },
    { area: 'insights', switchable: true, configuredEnabled: false, calls: [{ resolved: { enabled: true } }], areaIssues: ['x'] },
  ],
} as unknown as SettingsPayload;
const SETTINGS_QUIET = {
  areas: [{ area: 'chat', switchable: false, configuredEnabled: true, calls: [{ resolved: { enabled: true } }], excludedCalls: [], areaIssues: [] }],
} as unknown as SettingsPayload;

const PLANS = {
  mode: 'observe',
  enforced: false,
  plans: [{ availableToBuy: true }, { availableToBuy: false }],
  withheldWithoutGate: [{}],
  notBuilt: [{}, {}],
} as unknown as PlansPayload;
const PLANS_ONE = { mode: 'enforce', enforced: true, plans: [{ availableToBuy: false }], withheldWithoutGate: [], notBuilt: [] } as unknown as PlansPayload;

const RED_ROW = { colour: 'red', units: [], pending: [{ lineId: 'l1' }], areas: [{ enabled: true }], modelName: 'm' } as unknown as ComparisonRow;
const PLAIN_ROW = { colour: 'green', units: [], pending: [], areas: [{ enabled: false }], modelName: 'n' } as unknown as ComparisonRow;
const CHECK_RECENT = { openai: { lastOkAt: '2026-10-01T00:00:00.000Z' } } as unknown as CheckStatusState;

/** Model pricing renders its four tiles like this (`system-config/page.tsx`). */
function PriceStrip({ rows, status }: { rows: ComparisonRow[]; status: CheckStatusState }) {
  const generatedAt = '2026-10-09T10:00:00.000Z';
  return (
    <KpiStrip>
      <KpiTile testId="kpi-undercharging" label={KPI_WORDS.undercharging} {...underchargingKpi(rows)} />
      <KpiTile testId="kpi-pending" label={KPI_WORDS.pending} {...pendingKpi(rows)} />
      <KpiTile testId="kpi-last-check" label={KPI_WORDS.lastCheck} {...lastCheckKpi(status, generatedAt)} />
      <KpiTile testId="kpi-models-in-use" label={KPI_WORDS.modelsInUse} {...modelsInUseKpi(rows)} />
    </KpiStrip>
  );
}

// Exchange rates (1a SQ-7, 1c.1 SQ-15): two enabled rates, one disabled; the newest rate change.
const FX_READ_AT = '2026-10-19T12:00:00.000Z';
const fxRate = (code: string, isEnabled: boolean, lastUpdatedAt: string): ExchangeRateWire => ({
  currencyCode: code,
  currencyName: code,
  currencySymbol: code,
  rateToUsd: '1.000000',
  isEnabled,
  decimalPlaces: 2,
  lastUpdatedAt,
  updatedBy: null,
});
const FX_CHANGE: ExchangeRateHistoryWire = {
  id: 'h1',
  currencyCode: 'ILS',
  oldRate: '3.650000',
  newRate: '3.700000',
  changedBy: 'aaaaaaaa-1111-4111-8111-111111111111',
  changedByLabel: 'Anna Admin',
  changedAt: '2026-10-18T10:00:00.000Z',
  changeReason: null,
};
const FX_PAYLOAD: ExchangeRatesPayload = {
  rates: [fxRate('EUR', true, '2025-11-05T10:00:00.000Z'), fxRate('ILS', true, '2026-10-18T10:00:00.000Z'), fxRate('JPY', false, '2025-11-05T10:00:00.000Z')],
  history: [FX_CHANGE],
  lastChange: FX_CHANGE,
  nameLookup: 'ok',
  readAt: FX_READ_AT,
};
const FX_PAYLOAD_NO_HISTORY: ExchangeRatesPayload = { ...FX_PAYLOAD, history: [], lastChange: null };
const FX_PAYLOAD_LOOKUP_FAILED: ExchangeRatesPayload = { ...FX_PAYLOAD, history: [{ ...FX_CHANGE, changedByLabel: null }], lastChange: { ...FX_CHANGE, changedByLabel: null }, nameLookup: 'failed' };
const FX_PAYLOAD_OLD_RATE_NULL: ExchangeRatesPayload = { ...FX_PAYLOAD, history: [{ ...FX_CHANGE, oldRate: null }], lastChange: { ...FX_CHANGE, oldRate: null } };
// Exchange rates 1e (SQ-51 (7)): the "Rates last checked" tile's three states.
// Exchange rates 1f (SQ-57): the `ok` state names who ran it (the fixture admin).
const FX_LAST_SYNC_OK: LastRateSyncWire = {
  status: 'ok',
  checkedAt: '2026-10-25T09:14:03.000Z',
  rateDate: '2026-10-23',
  checkedBy: 'aaaaaaaa-1111-4111-8111-111111111111',
  checkedByLabel: 'Anna Admin',
};
const FX_LAST_SYNC_LABEL_FAILED: LastRateSyncWire = { ...FX_LAST_SYNC_OK, checkedByLabel: null };
const FX_LAST_SYNC_NO_CHECKER: LastRateSyncWire = { ...FX_LAST_SYNC_OK, checkedBy: null, checkedByLabel: 'Unknown user' };
const FX_LAST_SYNC_NONE: LastRateSyncWire = { status: 'none' };
const FX_LAST_SYNC_UNAVAILABLE: LastRateSyncWire = { status: 'unavailable' };

const CASES: ReadonlyArray<readonly [string, () => React.ReactElement]> = [
  // ── A1: the shared matrix ─────────────────────────────────────────────────
  ['A1 anchor neutral', () => <KpiTile testId="kpi-jobs" label="Jobs" value="5" href="#jobs" />],
  ['A1 anchor neutral no test id', () => <KpiTile label="Jobs" value="5" href="#jobs" />],
  ['A1 anchor neutral sub', () => <KpiTile testId="kpi-jobs" label="Jobs" value="5" sub="3 ok · 2 failed" href="#jobs" />],
  ['A1 anchor red sub', () => <KpiTile testId="kpi-stuck" label="Stuck" value="2" sub="at least" status="red" href="#queues" />],
  ['A1 anchor amber sub', () => <KpiTile testId="kpi-last" label="Last run" value="Partial" sub="2 rows" status="amber" href="#run-history" />],
  ['A1 anchor null sub null status', () => <KpiTile testId="kpi-x" label="X" value="1" sub={null} status={null} href="#x" />],
  ['A1 filter neutral', () => <KpiTile testId="kpi-calls" label="Calls" value="12" filter={{ href: '/p?a=1', apply: noop }} />],
  ['A1 filter current', () => <KpiTile testId="kpi-c" label="Creation" value="$1.00" sub="25%" filter={{ href: '/p?c=1', apply: noop, current: true }} />],
  ['A1 filter not current', () => <KpiTile testId="kpi-c" label="Creation" value="$1.00" filter={{ href: '/p?c=1', apply: noop, current: false }} />],
  ['A1 filter amber sub', () => <KpiTile testId="kpi-total" label="Total" value="$4.25" sub="may be incomplete" status="amber" filter={{ href: '/p', apply: noop }} />],
  ['A1 filter red', () => <KpiTile testId="kpi-r" label="Failed" value="3" status="red" filter={{ href: '/p?f=1', apply: noop }} />],
  ['A1 filter red current', () => <KpiTile testId="kpi-r" label="Failed" value="3" status="red" filter={{ href: '/p?f=1', apply: noop, current: true }} />],
  ['A1 none neutral', () => <KpiTile testId="kpi-avg" label="Avg cost per call" value="—" />],
  ['A1 none neutral sub', () => <KpiTile testId="kpi-pending" label="Pending" value="4" sub="at least: the newest 4 only" />],
  ['A1 none amber sub', () => <KpiTile testId="kpi-stopped" label="Stopped halfway" value="1" sub="s" status="amber" />],
  ['A1 none red sub', () => <KpiTile testId="kpi-under" label="Undercharging" value="2" sub="worst" status="red" />],
  [
    'A1 strip children',
    () => (
      <KpiStrip>
        <KpiTile label="A" value="1" href="#a" />
        <KpiTile label="B" value="2" status="red" />
      </KpiStrip>
    ),
  ],
  ['A1 strip loading 3', () => <KpiStrip loading placeholderCount={3} />],
  ['A1 strip loading 4', () => <KpiStrip loading placeholderCount={4} />],
  ['A1 strip loading 5', () => <KpiStrip loading placeholderCount={5} />],
  ['A1 strip loading default', () => <KpiStrip loading />],
  [
    'A1 strip loading with children (Jobs)',
    () => (
      <KpiStrip loading placeholderCount={4}>
        <KpiTile label="A" value="1" href="#a" />
      </KpiStrip>
    ),
  ],
  [
    'A1 strip not loading with children (Jobs)',
    () => (
      <KpiStrip loading={false} placeholderCount={4}>
        <KpiTile label="Jobs" value="5" sub="5 ok" href="#jobs" />
        <KpiTile label="Stuck" value="1" status="red" href="#queues" />
      </KpiStrip>
    ),
  ],

  // ── A2: the real callers ──────────────────────────────────────────────────
  ['A2 AnalyticsKpis loading bos', () => <AnalyticsKpis scope="bos" totals={ANALYTICS_TOTALS} categoryTotals={null} comparison={null} possiblyIncomplete={false} category="all" firstLoad tile={analyticsTile} />],
  ['A2 AnalyticsKpis loading all', () => <AnalyticsKpis scope="all" totals={ANALYTICS_TOTALS} categoryTotals={null} comparison={null} possiblyIncomplete={false} category="all" firstLoad tile={analyticsTile} />],
  ['A2 AnalyticsKpis bos', () => <AnalyticsKpis scope="bos" totals={ANALYTICS_TOTALS} categoryTotals={null} comparison={ANALYTICS_COMPARISON} possiblyIncomplete category="all" firstLoad={false} tile={analyticsTile} />],
  ['A2 AnalyticsKpis all', () => <AnalyticsKpis scope="all" totals={ANALYTICS_TOTALS} categoryTotals={ANALYTICS_CATEGORIES} comparison={null} possiblyIncomplete={false} category="memory" firstLoad={false} tile={analyticsTile} />],
  ['A2 ArchivingKpis loading', () => <ArchivingKpis overview={null} loading retention={{}} />],
  ['A2 ArchivingKpis', () => <ArchivingKpis overview={ARCHIVING} loading={false} retention={{}} />],
  ['A2 ArchivingKpis failed run', () => <ArchivingKpis overview={ARCHIVING_FAILED_RUN} loading={false} retention={{}} />],
  ['A2 InviteKpis loading', () => <InviteKpis payload={null} stoppedCount={0} loading />],
  ['A2 InviteKpis', () => <InviteKpis payload={INVITES} stoppedCount={1} loading={false} />],
  ['A2 ActivityKpis loading', () => <ActivityKpis payload={null} firstLoad filters={ACTIVITY_FILTERS} tile={activityTile} />],
  ['A2 ActivityKpis', () => <ActivityKpis payload={ACTIVITY} firstLoad={false} filters={ACTIVITY_FILTERS} tile={activityTile} />],
  ['A2 CostsKpis loading', () => <CostsKpis report={null} firstLoad sectionsShown={false} />],
  ['A2 CostsKpis', () => <CostsKpis report={COSTS} firstLoad={false} sectionsShown />],
  ['A2 CostsKpis no sections', () => <CostsKpis report={COSTS} firstLoad={false} sectionsShown={false} />],
  ['A2 SettingsKpis loading', () => <SettingsKpis payload={null} firstLoad />],
  ['A2 SettingsKpis', () => <SettingsKpis payload={SETTINGS} firstLoad={false} />],
  ['A2 SettingsKpis quiet', () => <SettingsKpis payload={SETTINGS_QUIET} firstLoad={false} />],
  ['A2 PlansKpis loading', () => <PlansKpis payload={null} loading />],
  ['A2 PlansKpis', () => <PlansKpis payload={PLANS} loading={false} />],
  ['A2 PlansKpis one', () => <PlansKpis payload={PLANS_ONE} loading={false} />],
  ['A2 BusinessesKpis loading', () => <BusinessesKpis stats={null} status="all" firstLoad statusTile={() => ({ href: '/admin/users', apply: noop })} />],
  ['A2 BusinessesKpis', () => <BusinessesKpis stats={{ totalUsers: 9, activeUsers: 4, newUsersToday: 1 }} status="active" firstLoad={false} statusTile={(s) => ({ href: `/admin/users?status=${s}`, apply: noop })} />],
  ['A2 Model pricing reading', () => <PriceStrip rows={[PLAIN_ROW]} status={undefined} />],
  ['A2 Model pricing unavailable', () => <PriceStrip rows={[RED_ROW, PLAIN_ROW]} status={null} />],
  ['A2 Model pricing recent', () => <PriceStrip rows={[]} status={CHECK_RECENT} />],
  ['A2 ExchangeRatesKpis loading', () => <ExchangeRatesKpis payload={null} loading lastSync={FX_LAST_SYNC_OK} />],
  ['A2 ExchangeRatesKpis two tiles', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} lastSync={FX_LAST_SYNC_OK} />],
  ['A2 ExchangeRatesKpis no history', () => <ExchangeRatesKpis payload={FX_PAYLOAD_NO_HISTORY} loading={false} lastSync={FX_LAST_SYNC_OK} />],
  ['A2 ExchangeRatesKpis name lookup failed', () => <ExchangeRatesKpis payload={FX_PAYLOAD_LOOKUP_FAILED} loading={false} lastSync={FX_LAST_SYNC_OK} />],
  ['A2 ExchangeRatesKpis old rate null', () => <ExchangeRatesKpis payload={FX_PAYLOAD_OLD_RATE_NULL} loading={false} lastSync={FX_LAST_SYNC_OK} />],
  ['A2 ExchangeRatesKpis last sync none', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} lastSync={FX_LAST_SYNC_NONE} />],
  ['A2 ExchangeRatesKpis last sync unavailable', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} lastSync={FX_LAST_SYNC_UNAVAILABLE} />],
  ['A2 ExchangeRatesKpis last sync checker label failed', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} lastSync={FX_LAST_SYNC_LABEL_FAILED} />],
  ['A2 ExchangeRatesKpis last sync no checker', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} lastSync={FX_LAST_SYNC_NO_CHECKER} />],
  // ── A3 (Money MK-5): the Finance strip's shapes, each with its leading / lagging indicator ──
  ['A3 Finance anchor lagging with status and detail', () => <KpiTile testId="tile-fk3_ai_cost" label="Charged AI cost this month" value="At least $12.50" sub="This month vs last month, UTC · Same days last month: $10.00" status="amber" detail="A lower bound" indicator={{ kind: 'lagging', definition: 'What it costs us.' }} href="#ai-cost" />],
  ['A3 Finance anchor leading with sub and detail', () => <KpiTile testId="tile-fk2_mrr" label="MRR now" value="$49.00" sub="Monthly, at list price, today" detail="Stripe test mode" indicator={{ kind: 'leading', definition: 'The monthly price.' }} href="#revenue-mrr" />],
  ['A3 Finance tab filter current lagging', () => <KpiTile testId="tile-fk4_ai_margin" label="AI margin" value="$85.50" sub="Revenue after tax minus Charged AI cost" detail="After Stripe fees (estimate): $82.32" indicator={{ kind: 'lagging', definition: 'A partial gross margin.' }} filter={{ href: '/admin/finance?tab=accounts', apply: noop, current: true }} />],
  ['A3 Finance tab filter lagging', () => <KpiTile testId="tile-fk5_paying" label="Paying accounts" value="18%" sub="9 of 50 accounts" indicator={{ kind: 'lagging', definition: 'What share pays.' }} filter={{ href: '/admin/finance?tab=plans', apply: noop }} />],
  ['A3 Finance no target lagging (a business picked)', () => <KpiTile testId="tile-fk5_paying" label="Paying accounts" value="Paying" sub="This business, now" indicator={{ kind: 'lagging', definition: 'What share pays.' }} />],
];

/** Recorded on the unchanged tree (447d17a2) at Step 0. */
const EXPECTED: Record<string, string> = {
  'A1 anchor neutral': '5b8dbee60e7175052e3664e418aaa70a2e5595ba0be740adb84835fd0edd01b1',
  'A1 anchor neutral no test id': '99f8aa87ec69e0f6e12ddadd795e659b5993b54547f6e265b3527093b1839d00',
  'A1 anchor neutral sub': '3c1b43eb29ea276eefb9fe67dc36b82393de7f2bc15514017a4f6a883026bfec',
  'A1 anchor red sub': 'a64d825fcff28147e8f29abf58a92ea2345fb29744248ee05432b41cbd661eaa',
  'A1 anchor amber sub': '69c379e9d389a36ef8b1849953c5cc010f780e444d92c9932012a19c2a73c5c1',
  'A1 anchor null sub null status': '99a22098a5e954308dd7db8eb3a701f93d0a47ac4f836b121f5e5b2f36381e98',
  'A1 filter neutral': 'e14c8560bfc94fdeeeb20eb5c2d3a85679897b0535375300352e4bbc9491721a',
  'A1 filter current': '5829eec3c5368a446fa809a69352a392f9dafbe0a1c8d9994d3aefe485bfc09b',
  'A1 filter not current': '599960a2bab70c741c28ff2e1638d4855b940c24ef823667a6a31a44bb54244d',
  'A1 filter amber sub': 'd560d889f1c373319faa608498802c0d33dc6cee277cb47f82616cd4260a1665',
  'A1 filter red': '28c5b582b3580b4d207c63211f06a994c5a86e1208aa8626cbaeaab7857f5c92',
  'A1 filter red current': '7dbb4f731171d307e9674619873779ce8303a781dc624296c8f051cfc95e58d9',
  'A1 none neutral': '4a8f243d83f2f534132c97a65f1c7ef3b84ccaab0e58b11d4d151986b6f94937',
  'A1 none neutral sub': 'cce149363b6e860d58a817ecf2bb0264abaa0abd3cd860f2735cb6e75c495005',
  'A1 none amber sub': '5f9c62edf9562af923ba963dab3168c4faa39c7f3e4917258606e75612da3ff2',
  'A1 none red sub': 'e73b9964462f1eee61b5f486d30035ef9b275d0338c944ea19a96f2ee0f258f6',
  'A1 strip children': '9a83fc289de4a3f401187b2397d4e0e5302bda56ebe6d67c2f88d44f9350e0dc',
  'A1 strip loading 3': 'aa4935d00b1352556b02c0083ab94de58a9ae2e7587678635659c6e46403ea8f',
  'A1 strip loading 4': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A1 strip loading 5': 'c5bb805961ec8cb19fe5a0978668a5be0cbc9a0b7986c96b20876c7568cc86cc',
  'A1 strip loading default': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A1 strip loading with children (Jobs)': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A1 strip not loading with children (Jobs)': '25c330ce9bfa26195e48c1ab327223453f19ff4f8bdf5e489fe29b619d4e2c27',
  'A2 AnalyticsKpis loading bos': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A2 AnalyticsKpis loading all': 'c5bb805961ec8cb19fe5a0978668a5be0cbc9a0b7986c96b20876c7568cc86cc',
  'A2 AnalyticsKpis bos': '5bbe567eea8c70900962b5fffa266205fcdb071a9c72cbe1dd435c3404c9a985',
  'A2 AnalyticsKpis all': 'a9bbfb89dd2c4b036561724fe48cc06650c192629d3e2bd01540236949535bba',
  'A2 ArchivingKpis loading': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A2 ArchivingKpis': 'eb5d340a074e57e1592ed65cba0adbae8a6d26dee4cb2400e4795c4709ecfc6b',
  'A2 ArchivingKpis failed run': 'a2ed84979c2d347650b4ef81858e132247d8784555e637819e7e8bfbaf949819',
  'A2 InviteKpis loading': 'c5bb805961ec8cb19fe5a0978668a5be0cbc9a0b7986c96b20876c7568cc86cc',
  'A2 InviteKpis': '150679220b4584492a66f6ba0b129e20f5b990bf21e4c90328813b9d28c5ac2b',
  'A2 ActivityKpis loading': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A2 ActivityKpis': 'a9e127f5ddf66d23d5a85f44a62841b0a294a0ffa26e874a3d2078151878ff58',
  'A2 CostsKpis loading': 'c5bb805961ec8cb19fe5a0978668a5be0cbc9a0b7986c96b20876c7568cc86cc',
  'A2 CostsKpis': '15439ff546e934a3c7352bf63f184127bbddfcc8977f95ccbd98d169266ef30e',
  'A2 CostsKpis no sections': '6ee816e2cb93e629a4613a32e456cf75388f9bcd4bee2424cb52796a0f57ede5',
  'A2 SettingsKpis loading': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A2 SettingsKpis': '2ba767a09c3960540b554ec09800a4523688e7a53b283281e3bf3029ea36d1e4',
  'A2 SettingsKpis quiet': 'ad762af1dcd97b350361a77614cc443052f145bf0db8afa5921446453fe00e0e',
  'A2 PlansKpis loading': '45c9f289d0fc608a1b9bcae86d76e181ff06b6bbbcbe4bc2a00b65fea6dad356',
  'A2 PlansKpis': '63fcccbf9f42bb335c58fa7dfe0c05c321e5b6c675b363ee88218dd9539c21b5',
  'A2 PlansKpis one': '485dd8565e2ac8eafb23e45af3c46823324a6acfa89c5f2ef0df8f697733fe4f',
  'A2 BusinessesKpis loading': 'aa4935d00b1352556b02c0083ab94de58a9ae2e7587678635659c6e46403ea8f',
  'A2 BusinessesKpis': 'b519a2272971487cf19892dddd47683da96a6524224bfc6382092f8f7cb65922',
  'A2 Model pricing reading': 'e6a7e097cca055e152d8ae41fa3124ceca4347fa0e5ca35ff7f1d56635e686be',
  'A2 Model pricing unavailable': '5c98bf3738881c93e87843aa9583a427dcfecce55897c309613e0020ba23367d',
  'A2 Model pricing recent': 'afe7ca77c2df6fd75c6ada7728e07c3ebab76fc9568676ab4eba0918fed331fd',
  // Exchange rates 1a (SQ-7), recorded on first render.
  // Exchange rates 1c.1 (SQ-15): re-pinned and appended, recorded on first render.
  // Exchange rates 1e (SQ-51 (7), 2026-10-25): the five re-hashed for the third tile, two appended.
  // Exchange rates 1f (SQ-57, 2026-10-25): two tiles, no history, name lookup failed and old rate null
  // re-hashed for "by {who} · ECB rates of …"; loading, none and unavailable unchanged; two appended.
  'A2 ExchangeRatesKpis loading': 'aa4935d00b1352556b02c0083ab94de58a9ae2e7587678635659c6e46403ea8f',
  'A2 ExchangeRatesKpis two tiles': '806e7a9d76cc04f8d17a6eedde469a4d9ebc66eee3b3fa918d42233debe5178a',
  'A2 ExchangeRatesKpis no history': '006b781ffb9f917c6be027f67d024677cfbf88c4d160734236d9c306ba55054d',
  'A2 ExchangeRatesKpis name lookup failed': '406405e8d9294093607e3ce35bed3b6e73c81641b5de9aa47283afa5a24af11c',
  'A2 ExchangeRatesKpis old rate null': '4c6d30593ce5ad2fd56f126fbd8ccdde4405830aadd64e30a0b9bdc17b119b4d',
  'A2 ExchangeRatesKpis last sync none': 'f64686d1fffe169e2803a5a20e695fb5961b90bfd820332ac39357c7538e56cd',
  'A2 ExchangeRatesKpis last sync unavailable': '118ffdf4174a67801aac84cb7b0ad2b56ac031281453dcfb10bc694997f985e3',
  'A2 ExchangeRatesKpis last sync checker label failed': '6533379681b22a1d0b30c84eeddb1c1704d228096f0c1890421393852202b868',
  'A2 ExchangeRatesKpis last sync no checker': '471653ff167baa07d34f48c2939b27d6b95ce054bfade7fed3666e9c916f9163',
  // A3 (Money MK-5): recorded at MK-5's handover.
  'A3 Finance anchor lagging with status and detail': '34166a30ada773fc7c5e7ca8dd90fb66b989d022bfc3b3eefaa1dbaf6fe83358',
  'A3 Finance anchor leading with sub and detail': '33106345987463ab9685bc4fed4a427e5e2e752a216cffdd7562707b82356a71',
  'A3 Finance tab filter current lagging': '9d94402070f3187e444af27a7d8ef5b8abe5c793674473d204cbe79d56944922',
  'A3 Finance tab filter lagging': '5ae604690d8a359e8e904557359e6a9943918b53fd166703309d2321194efc7c',
  'A3 Finance no target lagging (a business picked)': '876167dd1a46e911165ffa38004875214a463aa6eaafc4a8a80c6b5b8d4c434a',
};

describe('Finance F-5 Pin A: the existing KpiTile / KpiStrip callers render byte-identically', () => {
  it('lists every case once, and has a hash for each', () => {
    const names = CASES.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(EXPECTED).sort()).toEqual([...names].sort());
  });

  it.each(CASES)('%s', (name, build) => {
    const html = htmlOf(build());
    expect(html.length).toBeGreaterThan(20);
    expect({ name, hash: sha256(html), html: EXPECTED[name] === sha256(html) ? '' : html }).toEqual({ name, hash: EXPECTED[name], html: '' });
  }, CASE_TIMEOUT_MS);
});
