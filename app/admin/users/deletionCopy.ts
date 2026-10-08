/**
 * Copy for the "Delete…" dialog on the Businesses screen (admin delete AD-1c
 * preview; AD-2b typed confirmation and result; requirement FR-A1 … FR-A3,
 * FR-A6, FR-A9, AC-A3; SA SC-9).
 *
 * The server sends facts: counts per area, table names, and each refusal with
 * its own message and clearing action (`adminDeletionRefusals.ts`, which owns
 * the SA-ruled wording such as R-3's Stripe dashboard pointer). This file only
 * adds the plain-language labels around them, the fixed "what is kept and
 * why" categories, and the error sentences. It imports nothing but types.
 *
 * AD-2b: every commit refusal code maps to ONE sentence here. The server's
 * `message`, `details` and `residue` text are never rendered.
 */

import type {
  DeletionCommitCodeView,
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
 * login (kept open by AD-2; AD-3 closes it); D15 activity history). AD-3 must
 * switch the preferences, activity-history and login lines back to "closed". Fixed categories; the per-table list
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
    why: 'Language, time zone and notification settings belong to the login, which this deletion leaves in place.',
  },
  {
    title: 'AgentsPilot agents',
    why: 'Agents and their history are kept: deleting a business never deletes agents.',
  },
  {
    title: 'Activity history',
    why: 'The activity record is kept, with the name on it. Removing the name is part of closing the login, a later step.',
  },
  {
    title: 'The login itself',
    why: 'Stays open: this deletion does not close the login, so the person can still sign in (to an account with no business) and the email stays taken. Closing the login is a later step.',
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

  // ── AD-2b: typed confirmation ──
  /** The description once a confirmation is offered (the read-only one above stays for every other state). */
  descriptionConfirm: 'Review what would be removed, then type to confirm. A deletion cannot be undone from here.',
  /** The status line once a confirmation is offered. */
  readyToConfirm: 'Type the value shown below to enable Delete.',
  confirmLabelBusinessName: 'Type the business name to confirm',
  confirmLabelEmail: 'Type the account email to confirm',
  confirmHint: 'Case and extra spaces do not matter. The server checks it again.',
  /** The G-1 precedent: honest about the delete function while it is not installed. */
  notAppliedLine:
    'The delete function is not installed on this server yet, so the server will refuse this deletion and nothing will be deleted.',
  unknownAppliedLine:
    'Whether the delete function is installed could not be checked. The server decides, and refuses if it is not.',
  deleting: 'Deleting the business… Keep this dialog open until it finishes.',
  deletingButton: 'Deleting…',

  // ── AD-2b: result ──
  resultTitle: 'The business was deleted',
  resultDescription: 'The rows below were removed. Close this dialog to refresh the list.',
  refusedTitle: 'Nothing was deleted',
  refusedDescription: 'The server refused the deletion.',
  unknownTitle: 'The result is not known',
  closeResult: 'Close and refresh the list',
  reopenPreview: 'Reopen the preview',
  otherTables: 'Other tables',
  auditRecorded: 'Recorded in the audit trail: yes.',
  auditNotRecorded:
    'Recorded in the audit trail: NO. The business was deleted, but its audit record could not be confirmed. Tell the platform team, with the correlation id below.',
  snapshotWrittenNote: 'A safety snapshot was written before it stopped. Nothing was deleted.',
  blockingNow: 'Blocking now:',
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

// ── Admin delete AD-2b: the commit result and refusals ─────────────────────

/** What the deletion kept (FR-A9; UD-14 agents; AD-2 keeps the login, AD-3 closes it). */
export const DELETION_RESULT_KEPT: readonly string[] = [
  'AgentsPilot agents and their history.',
  'The login: it stays open (closing it is a later step).',
  'Plan, billing and credit records.',
  'Email unsubscribes and marketing consent.',
  'Friends who already joined through this business’s invites keep their own accounts.',
];

const STALE_PREVIEW = 'The preview expired. Reopen it and confirm again. Nothing was deleted.';
const CHANGED_SINCE_PREVIEW =
  'Something changed since the preview was opened. Reopen it and confirm again. Nothing was deleted.';
const WRONG_CONFIRMATION =
  'This confirmation does not belong to this business or to your admin session. Reopen the preview. Nothing was deleted.';

/**
 * One sentence per commit refusal (AD-2b). `Record<DeletionCommitCodeView, …>`
 * is exhaustive, and the code union is pinned to the server's both ways, so a
 * new refusal cannot ship without its sentence.
 */
export const DELETION_COMMIT_REFUSAL_COPY: Record<DeletionCommitCodeView, string> = {
  admin_delete_disabled: 'Admin delete is switched off on this server. Nothing was deleted.',
  token_key_unavailable: 'The server cannot check the confirmation right now. Nothing was deleted.',
  token_expired: STALE_PREVIEW,
  token_version: STALE_PREVIEW,
  token_gate_version: STALE_PREVIEW,
  token_malformed: WRONG_CONFIRMATION,
  token_signature: WRONG_CONFIRMATION,
  token_surface: WRONG_CONFIRMATION,
  token_actor: WRONG_CONFIRMATION,
  token_target: WRONG_CONFIRMATION,
  token_level: WRONG_CONFIRMATION,
  token_options: WRONG_CONFIRMATION,
  user_not_found: 'This account no longer exists. Nothing was deleted.',
  identity_read_failed: 'The account could not be read. Nothing was deleted. Try again.',
  actor_not_admin: 'Your admin access could not be re-confirmed. Nothing was deleted.',
  refused: 'A refusal now applies to this business. Nothing was deleted.',
  confirmation_unverified: 'What to type could not be checked against the business. Nothing was deleted. Try again.',
  nothing_to_confirm: 'This account has no business name and no email to confirm against. Nothing was deleted.',
  confirmation_kind_changed: CHANGED_SINCE_PREVIEW,
  confirmation_mismatch: 'What you typed does not match. Nothing was deleted.',
  schema_changed: CHANGED_SINCE_PREVIEW,
  rpc_not_applied: 'The delete function is not installed on this server yet. Nothing was deleted.',
  rpc_state_unknown: 'Whether the delete function is installed could not be checked, so nothing was deleted.',
  capability_missing: 'The server is missing what it needs to delete safely. Nothing was deleted. This is a platform problem.',
  agents_option_refused: 'A deletion that includes agents is refused. Nothing was deleted. This is a platform problem.',
  delete_graph_refused:
    'The database would remove data the safety snapshot does not cover, so the deletion was stopped. Nothing was deleted. This is a platform problem.',
  delete_graph_unreadable:
    'The database’s delete rules could not be checked, so the deletion was stopped. Nothing was deleted.',
  stripe_connected: 'A Stripe account is connected to this business. Nothing was deleted. Disconnect it first.',
  stripe_unreadable: 'Whether Stripe is connected could not be checked. Nothing was deleted. Try again.',
  local_blocking: 'A billing or money check blocks this deletion. Nothing was deleted. Reopen the preview to see which.',
  local_unreadable: 'A billing or money check could not be read. Nothing was deleted. Try again.',
  snapshot_failed: 'The safety snapshot could not be written, so nothing was deleted.',
  already_running: 'A deletion for this account is already running. Nothing more was done.',
  // SA-3: the RPC call failing can be a transport failure after the database committed, so this one hedges.
  commit_failed:
    'The delete call failed before the server could confirm the result, so it is not known whether anything was deleted. Reload this page to see whether the business still exists.',
  precommit_refused: 'The final check right before the delete refused it. Nothing was deleted. Reopen the preview to see why.',
  audit_unavailable:
    'The deletion could not be recorded in the audit trail beforehand, so it was stopped. Nothing was deleted.',
};

/** The route's own codes, answered before the composition runs. */
const COMMIT_ROUTE_COPY: Record<string, string> = {
  Unauthorized: 'Your admin session has ended. Nothing was deleted. Sign in again, then reload this page.',
  Forbidden: 'This account is not an admin, so it cannot delete a business. Nothing was deleted.',
  invalid_user_id: 'That does not look like an account id. Nothing was deleted.',
  invalid_body: 'The confirmation could not be sent. Nothing was deleted. Reopen the preview and try again.',
};

/**
 * The server gave no known answer (a 500, a network failure, an unreadable
 * body). Whether anything was deleted is NOT known, so the dialog says so
 * rather than claiming "nothing was deleted".
 */
export const DELETION_COMMIT_UNKNOWN =
  'The server did not confirm the result, so it is not known whether anything was deleted. Reload this page to see whether the business still exists.';

const KNOWN_COMMIT_CODES: ReadonlySet<string> = new Set(Object.keys(DELETION_COMMIT_REFUSAL_COPY));

export function isKnownCommitCode(code: string): code is DeletionCommitCodeView {
  return KNOWN_COMMIT_CODES.has(code);
}

/** After these, the next step is to reopen the preview (a fresh token and refusal list). */
export const REOPEN_PREVIEW_CODES: ReadonlySet<DeletionCommitCodeView> = new Set<DeletionCommitCodeView>([
  'token_expired',
  'token_version',
  'token_gate_version',
  'token_malformed',
  'token_signature',
  'token_surface',
  'token_actor',
  'token_target',
  'token_level',
  'token_options',
  'confirmation_kind_changed',
  'confirmation_mismatch',
  'schema_changed',
  'refused',
  'precommit_refused',
  'local_blocking',
]);

/**
 * One sentence for a refusal, or `null` when the code is not one this screen
 * knows (the caller then shows `DELETION_COMMIT_UNKNOWN`). Never the server's text.
 */
export function commitRefusalSentence(code: string, expectedKind?: 'business name' | 'account email'): string | null {
  if (code === 'confirmation_mismatch' && expectedKind) {
    return `What you typed does not match the ${expectedKind}. Nothing was deleted.`;
  }
  if (isKnownCommitCode(code)) return DELETION_COMMIT_REFUSAL_COPY[code];
  return COMMIT_ROUTE_COPY[code] ?? null;
}

/**
 * The server's normalisation (`normaliseConfirmation` in
 * `lib/business-os/purge/confirmation.ts`, which this screen may not import):
 * trim, collapse whitespace, lower-case. Enabling Delete is a convenience; the
 * server compares again and is authoritative.
 */
export function normaliseConfirmText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function formatRows(count: number): string {
  return `${n(count)} ${count === 1 ? 'row' : 'rows'}`;
}

/** The invite lines of the result (UD-13): revoked, and left alone mid-signup. */
export function inviteResultLines(invites: { revoked: number | null; skippedMidSignup: number | null }): string[] {
  return [
    invites.revoked === null
      ? 'Pending invites this business sent: could not be revoked. Revoke them from the invites page.'
      : `Pending invites this business sent, now revoked: ${n(invites.revoked)}.`,
    invites.skippedMidSignup === null
      ? 'Invites a friend was in the middle of signing up with: unknown.'
      : `Invites a friend was in the middle of signing up with, left alone: ${n(invites.skippedMidSignup)}.`,
  ];
}

/** One storage bucket: removed, and any files still stored (residue). */
export function storageResultLine(s: { deleted: number; failed: number }): string {
  const removed = `${n(s.deleted)} ${s.deleted === 1 ? 'file' : 'files'} removed`;
  return s.failed > 0 ? `${removed}; ${n(s.failed)} could not be removed and are still stored` : removed;
}
