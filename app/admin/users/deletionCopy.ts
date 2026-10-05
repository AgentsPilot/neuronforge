/**
 * Copy for the read-only "Delete…" dialog on the Businesses screen (admin
 * delete AD-1c; requirement FR-A1, FR-A2, AC-A3; SA SC-9).
 *
 * The server sends facts: counts per area, table names, and each refusal with
 * its own message and clearing action (`adminDeletionRefusals.ts`, which owns
 * the SA-ruled wording such as R-3's Stripe dashboard pointer). This file only
 * adds the plain-language labels around them, the fixed "what is kept and
 * why" categories, and the error sentences. It imports nothing.
 */

import type {
  DeletionAreaCountView,
  DeletionAreaView,
  DeletionRefusalIdView,
  DeletionRefusalStatusView,
  DeletionTableCountView,
} from './types';

/** Per-area labels, in the words an admin uses for a business (FR-A2). */
export const DELETION_AREA_LABELS: Record<DeletionAreaView, string> = {
  business_profile: 'Business profile and settings',
  crm: 'Contacts, leads and proposals',
  website: 'Website and its images',
  scheduling: 'Services and bookings',
  payments: 'Invoices and client payments',
  email_marketing: 'Email marketing',
  intake: 'Intake forms and responses',
  onboarding_chat: 'Onboarding chat',
  capabilities: 'Enabled capabilities',
  smart_links: 'Smart links',
  channels: 'Messaging channels',
  insights: 'Insights',
  briefings: 'Daily briefings',
  integrations: 'Connected integrations (disconnected)',
  agents: 'AgentsPilot agents',
  activity_history: 'Activity history',
  unassigned: 'Tables with no area (a platform problem)',
};

/** What a refusal is about, as a short heading. The server's message says what was found. */
export const DELETION_REFUSAL_TITLES: Record<DeletionRefusalIdView, string> = {
  'R-1': 'Your own account',
  'R-2': 'Platform admin',
  'R-3': 'Live plan subscription',
  'R-4': 'Paid for by another account',
  'R-5': 'Stripe connected',
  'R-6': 'Money in flight',
  'R-7': 'A deletion already running',
  'R-8': 'Every business table classified',
};

/** Status as text, so the blocked state never relies on colour alone. */
export const DELETION_STATUS_LABELS: Record<DeletionRefusalStatusView, string> = {
  applies: 'Blocks deletion',
  unverified: 'Could not verify: blocks deletion',
  clear: 'Clear',
  not_applicable: 'Not applicable',
  not_evaluated: 'Not checked',
  deferred: 'Checked at the moment of deletion',
};

/** The statuses that block (the server's `BLOCKING_REFUSAL_STATUSES`). Used for styling and the count only. */
export const BLOCKING_STATUSES: ReadonlySet<DeletionRefusalStatusView> = new Set(['applies', 'unverified']);

/**
 * What is kept and why (FR-A2: money ledger, unsubscribes, preferences, the
 * closed login; D15 activity history). Fixed categories; the per-table list
 * the server sends goes in the technical expander.
 */
export const DELETION_KEPT_CATEGORIES: ReadonlyArray<{ title: string; why: string }> = [
  {
    title: 'The money ledger',
    why: 'Plan billing, subscription invoices and the credit ledger stay unchanged. Financial records are kept.',
  },
  {
    title: 'Email unsubscribes and marketing consent',
    why: 'Kept so that nobody who opted out is ever emailed again, and so consent can still be evidenced.',
  },
  {
    title: 'Account preferences',
    why: 'Language, time zone and notification settings belong to the login, which is closed, not deleted.',
  },
  {
    title: 'Activity history',
    why: 'The activity record is kept. The name on it is removed when the login is closed.',
  },
  {
    title: 'The login itself',
    why: 'Closed, not deleted: sign-in is disabled and the email stays taken, so it cannot be used for a new sign-up.',
  },
];

export const DELETION_COPY = {
  title: 'Delete this business?',
  description: 'A read-only preview. Nothing is deleted from this dialog.',
  loading: 'Loading the deletion preview…',
  unavailablePrefix: 'Deletion not yet available: ',
  /** The disabled confirm's reason before a preview has answered, and after it failed. */
  reasonLoading: 'the preview has not loaded yet.',
  reasonError: 'the preview could not be loaded.',
  confirmButton: 'Delete business',
  /** Distinct from the primitive's corner "Close" (one accessible name per control). */
  close: 'Close preview',
  retry: 'Try again',
  notCounted: 'Not counted: this account is refused above.',
  noBusinessName: 'No business name',
  unknown: 'unknown',
  technical: 'Technical details: tables',
} as const;

/** One sentence per failure. Never the server's raw error (no details are rendered). */
export const DELETION_ERROR_COPY: Record<string, string> = {
  Unauthorized: 'Your admin session has ended. Sign in again, then reload this page.',
  Forbidden: 'This account is not an admin, so it cannot open a deletion preview.',
  invalid_user_id: 'That does not look like an account id.',
  user_not_found: 'This account no longer exists.',
};

export const DELETION_GENERIC_ERROR = 'The deletion preview could not be loaded. Try again; if it keeps failing, the correlation id is in the server logs.';

export function deletionErrorSentence(code: string): string {
  return DELETION_ERROR_COPY[code] ?? DELETION_GENERIC_ERROR;
}

const n = (value: number) => value.toLocaleString('en-US');

/** One table or bucket count: "unknown" when it could not be counted, never 0. */
export function formatTableCount(t: DeletionTableCountView): string {
  if (t.count === null) return DELETION_COPY.unknown;
  return t.truncated ? `at least ${n(t.count)}` : n(t.count);
}

/**
 * An area's rows. All tables unknown → "unknown"; some unknown → the counted
 * rows as a floor, with how many tables are unknown; a capped count → a floor.
 */
export function formatAreaRows(area: DeletionAreaCountView): string {
  if (area.tables.length > 0 && area.tablesUnknown >= area.tables.length) return DELETION_COPY.unknown;
  const floor = area.tablesUnknown > 0 || area.tables.some((t) => t.truncated);
  const rows = `${floor ? 'at least ' : ''}${n(area.rows)} ${area.rows === 1 ? 'row' : 'rows'}`;
  return area.tablesUnknown > 0
    ? `${rows} (${area.tablesUnknown} ${area.tablesUnknown === 1 ? 'table' : 'tables'} unknown)`
    : rows;
}

/** A calendar date in UTC, so the dialog reads the same for every admin. */
export function formatJoined(iso: string | null): string {
  if (!iso) return DELETION_COPY.unknown;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? DELETION_COPY.unknown : new Date(ms).toISOString().slice(0, 10);
}
