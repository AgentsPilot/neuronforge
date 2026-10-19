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
 * Part A2: the real caller components, with figures and while loading. Jobs'
 * tiles are module-private (SA-W5): their shapes are in A1, and its own layout
 * test stays unedited. Model pricing goes through its real `priceKpis.ts`.
 * Amended by Exchange rates 1a (SQ-7): three ExchangeRatesKpis cases appended; every existing hash unchanged.
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
import type { ExchangeRatesPayload, ExchangeRateWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

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

// Exchange rates 1a (SQ-7): two enabled rates, one of them stale, one disabled.
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
const FX_PAYLOAD: ExchangeRatesPayload = {
  rates: [fxRate('EUR', true, '2025-11-05T10:00:00.000Z'), fxRate('ILS', true, '2026-10-18T10:00:00.000Z'), fxRate('JPY', false, '2025-11-05T10:00:00.000Z')],
  history: [],
  readAt: FX_READ_AT,
};
const FX_PAYLOAD_FRESH: ExchangeRatesPayload = { ...FX_PAYLOAD, rates: [fxRate('ILS', true, '2026-10-18T10:00:00.000Z')] };

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
  ['A2 ExchangeRatesKpis loading', () => <ExchangeRatesKpis payload={null} loading />],
  ['A2 ExchangeRatesKpis', () => <ExchangeRatesKpis payload={FX_PAYLOAD} loading={false} />],
  ['A2 ExchangeRatesKpis none stale', () => <ExchangeRatesKpis payload={FX_PAYLOAD_FRESH} loading={false} />],
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
  'A1 strip children': 'c508be9c930742aa077af6c929de364a8947f7a63fb717cd9008115cef9ad938',
  'A1 strip loading 3': '33df0ad454d0e8e3107bd926290605d2106084a69e0278941466086ba55fe24c',
  'A1 strip loading 4': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A1 strip loading 5': 'a1b6856bed75c54e6a1b0690e36a36e27af1df9e5c72d60774997433a26e4838',
  'A1 strip loading default': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A1 strip loading with children (Jobs)': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A1 strip not loading with children (Jobs)': 'b0f973c97459ed030fb8457d88ad928bda833456809562109d2b8a4ed4cdb0a8',
  'A2 AnalyticsKpis loading bos': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A2 AnalyticsKpis loading all': 'a1b6856bed75c54e6a1b0690e36a36e27af1df9e5c72d60774997433a26e4838',
  'A2 AnalyticsKpis bos': '3eebeeeac0de7b1a6fde36de1ad36f5c355b5575648bc2a1297eb6c703bae4e5',
  'A2 AnalyticsKpis all': '43cb021f0b046586f25bef53f98befac6ca3c04cd510a44136276769ca80b72b',
  'A2 ArchivingKpis loading': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A2 ArchivingKpis': '0f77d90b359fa573b4e3bb6a17e3940d53b80418be15957d549b4cfa793559a0',
  'A2 ArchivingKpis failed run': '9f717ec68e67c0aeba96cef2be09d0e8b9b614eb255d1f5dda2c8ea15d1fe7b3',
  'A2 InviteKpis loading': 'a1b6856bed75c54e6a1b0690e36a36e27af1df9e5c72d60774997433a26e4838',
  'A2 InviteKpis': '32b71808fea3fd593c86c01813311139c5922c2ba6e729534562549a7964182f',
  'A2 ActivityKpis loading': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A2 ActivityKpis': 'a816e75980a749f68648caaa5c3e9c2dfc1e250ae44d8c3ed4ca7745926df643',
  'A2 CostsKpis loading': 'a1b6856bed75c54e6a1b0690e36a36e27af1df9e5c72d60774997433a26e4838',
  'A2 CostsKpis': '3f9aebb9344780cbc58e0c0d7603870936470a52262169a207699b92053f963e',
  'A2 CostsKpis no sections': '9cb293771862000be8ed5b99db803c7656e86b8fb87e5254438f7d9091d9947b',
  'A2 SettingsKpis loading': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A2 SettingsKpis': '1587aea98bfb0a6eacbc9aa9d7f954f0d08005ba8c9c92af3c5bdceb8d02241b',
  'A2 SettingsKpis quiet': '04f6b49dba54b26fbbddd18c4e499c734330920576599f4abaf91556f549a9da',
  'A2 PlansKpis loading': '00ff7c443adc30962c92208a0d8dc413b3b2bf9af1a4c0880e6c3c1dbd9534ee',
  'A2 PlansKpis': 'db11968a0448b9099f13273749add01d44ad7452186a30a2214fb541579b0b5e',
  'A2 PlansKpis one': '5d82771cf7fd5b6fc8d8ec49c6b4f1a8026d5002694724bbaafbe892f8d4e71c',
  'A2 BusinessesKpis loading': '33df0ad454d0e8e3107bd926290605d2106084a69e0278941466086ba55fe24c',
  'A2 BusinessesKpis': 'df69b7b5e517f8b1eafe44bc47cb0544fe97baf06b46852a2ad9a5e99093c549',
  'A2 Model pricing reading': 'be9d1a213d32c6e3704796468db7d2a40fdd2f2a6c39b0308039629f6da244ad',
  'A2 Model pricing unavailable': '31241fbf7736bf1aac551289805d08ae42b9925bc701096b8fb68803da4049e0',
  'A2 Model pricing recent': '13a71e361d6edb3f07816f7218353f3c6568b232cff90a7160ea321f854d2577',
  // Exchange rates 1a (SQ-7), recorded on first render.
  'A2 ExchangeRatesKpis loading': 'b628c0bab0e92bf9f5949794cae2e85732530b5c709306ec98f1265c8e51bcb5',
  'A2 ExchangeRatesKpis': '41899b6997db4acf7b68dd7babe940b77246a350d3fee262b3acde3894928a5e',
  'A2 ExchangeRatesKpis none stale': 'ada696c76cf91d2628a0ea51138beb3f099a9c9146c49624b4bb74200130503e',
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
