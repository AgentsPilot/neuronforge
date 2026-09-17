/**
 * Response types of the admin LLM usage verification API (Layer 1.1).
 *
 * RUNTIME-FREE on purpose: only `export type` / `export interface`, no values
 * and no imports. The `/test-business-os` tab is a client component and must
 * not pull server modules (the catalog imports Node `crypto` and Pino) into the
 * browser bundle, so it imports these with `import type` only (RC-8). Labels,
 * statuses and flags are computed on the server and sent as data.
 *
 * @module lib/business-os/usage/llmUsageReportTypes
 */

/** A check's result. The client adds its own "not checked" before a refresh. */
export type CheckStatus = 'pass' | 'fail' | 'incomplete' | 'info';

export type RowFlag = 'legacy_feature' | 'unknown_area' | 'unknown_call_name' | 'missing_group_id';

export type AreaKind = 'current' | 'legacy' | 'unknown';

export type ReportTrigger = 'manual' | 'auto';

export interface LlmUsageCallRow {
  createdAt: string;
  feature: string;
  areaKind: AreaKind;
  /** The catalog area (for a legacy value, the area it belongs to); null when unknown. */
  area: string | null;
  /** Area name, 'legacy' or 'unknown'. */
  areaLabel: string;
  component: string | null;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  /** input + output */
  tokens: number;
  estimatedCostUsd: number;
  success: boolean;
  /** Only for a failed call. The error message text is never read. */
  errorCode: string | null;
  flags: RowFlag[];
  /** Set when the row is a known non-catalog component in its own area. */
  knownComponent: { component: string; reason: string } | null;
}

interface CheckBase {
  status: CheckStatus;
  /** A safe, fixed message when a read failed; never raw error text. */
  error: string | null;
}

export interface CallsCheck extends CheckBase {
  rowsRead: number;
  incomplete: boolean;
  flaggedRows: number;
  flagCounts: Record<RowFlag, number>;
  rows: LlmUsageCallRow[];
  rowsTruncated: boolean;
  displayCap: number;
}

export interface PlatformAccountCheck extends CheckBase {
  count: number | null;
  breakdown: Array<{ feature: string; component: string | null; calls: number }>;
  breakdownRowsRead: number;
  breakdownTruncated: boolean;
  breakdownCap: number;
}

export interface LegacyLabelsCheck extends CheckBase {
  /** (a) legacy feature values on the selected account, from the paged read. */
  legacyOnSelected: {
    count: number;
    byFeature: Array<{ feature: string; calls: number }>;
    incomplete: boolean;
  } | null;
  /** (a) legacy feature values on the platform account, exact count. */
  legacyOnPlatform: { count: number } | null;
  /** (b) the legacy helper label on the selected account: a mislabelled call. */
  helperLabelOnSelected: { count: number } | null;
  /** (c) the legacy helper label on the platform account: Info only. */
  helperLabelOnPlatform: {
    count: number;
    timestamps: string[];
    timestampsTruncated: boolean;
    timestampCap: number;
  } | null;
  helperLabel: { feature: string; component: string };
}

export interface ActionGroup {
  sessionId: string;
  /** The group's area label, or 'mixed'. */
  areaLabel: string;
  callCount: number;
  /** Call names in the order they first ran, with repeat counts. */
  calls: Array<{ component: string; count: number }>;
  /** e.g. 'planner ×2, analysis' */
  callSummary: string;
  tokens: number;
  estimatedCostUsd: number;
  firstAt: string;
  lastAt: string;
}

export interface UngroupedCallRow extends LlmUsageCallRow {
  /** True when the component is exempt from the missing-grouping-id flag. */
  expected: boolean;
}

export interface GroupsCheck extends CheckBase {
  incomplete: boolean;
  groups: ActionGroup[];
  groupsTotal: number;
  groupsTruncated: boolean;
  displayCap: number;
  ungrouped: UngroupedCallRow[];
  ungroupedTotal: number;
  ungroupedFlagged: number;
  ungroupedTruncated: boolean;
}

export interface UsageCardCategory {
  key: string;
  tokens: number;
  calls: number;
  credits: number;
  /** The owner's card lists only categories with tokens. */
  shownOnCard: boolean;
}

export interface UsageCardCheck extends CheckBase {
  summedBy: 'database' | 'rows' | null;
  tokensPerCredit: number | null;
  /** The card's function has no end bound: this check runs to the time of the read. */
  windowEnd: 'open';
  totals: { tokens: number; calls: number; credits: number } | null;
  categories: UsageCardCategory[];
  otherFeatures: Array<{ feature: string; tokens: number; calls: number; isBusinessOs: boolean }>;
}

export interface AreaTotalsLine {
  key: string;
  kind: 'area' | 'legacy' | 'unknown';
  calls: number;
  tokens: number;
  estimatedCostUsd: number;
}

export interface AreaTotals {
  status: 'complete' | 'incomplete' | 'error';
  error: string | null;
  lines: AreaTotalsLine[];
  total: { calls: number; tokens: number; estimatedCostUsd: number };
}

export interface LlmUsageReport {
  account: {
    userId: string;
    companyName: string | null;
    /** 'skipped' on automatic refreshes: the name is looked up on manual refreshes only. */
    profileLookup: 'found' | 'none' | 'failed' | 'skipped';
  };
  window: { start: string; end: string; startClamped: boolean };
  platformAccountIdsChecked: string[];
  /** SYSTEM_ADMIN_USER_ID is set but is not a UUID, so only the all-zero id was checked. */
  platformAccountEnvIgnored: boolean;
  /** The paged read reached its ceiling: affected checks are Incomplete. */
  incomplete: boolean;
  trigger: ReportTrigger;
  limits: {
    pageSize: number;
    readCeiling: number;
    displayRows: number;
    displayGroups: number;
    platformBreakdownRows: number;
    helperTimestamps: number;
  };
  checks: {
    calls: CallsCheck;
    platformAccount: PlatformAccountCheck;
    legacyLabels: LegacyLabelsCheck;
    groups: GroupsCheck;
    usageCard: UsageCardCheck;
  };
  areaTotals: AreaTotals;
}

export interface BusinessListEntry {
  userId: string;
  companyName: string | null;
}

export interface BusinessListResponse {
  businesses: BusinessListEntry[];
  limit: number;
  /** Ids only, so the tab can warn before a platform account is selected. */
  platformAccountIds: string[];
  platformAccountEnvIgnored: boolean;
}

export type ApiEnvelope<T> = { success: true; data: T } | { success: false; error: string };
