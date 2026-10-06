// lib/business-os/purge/adminDeletionRefusals.ts
//
// Admin delete AD-1b (T9): the refusal evaluator for the admin deletion
// preview, R-1 … R-8 of requirement §6.3.
//
// PURE: facts in, refusals out. No I/O, no logging, deterministic. The
// composition (`AdminDeletionPreview.ts`) does every read and hands the
// results here.
//
// ── The rules this file exists to keep (SA SC-4) ────────────────────────────
//   * EVERY refusal is returned, not just the first. `evaluateResetGuard`
//     short-circuits, which is right for a commit and wrong for a preview whose
//     job is to list everything the admin has to resolve.
//   * A failed read is a refusal ("could not verify"), NEVER a pass. Each fact
//     is tri-state: a value, or `'unreadable'` / `null`, which maps to the
//     status `unverified`.
//   * Statuses are never re-typed. R-6 takes the `LocalPreconditionResult`
//     that `decideLocalPrecondition` derived from `LOCAL_BLOCKING_CONDITIONS`;
//     no C1–C3 status string appears here. R-3's list is typed against the
//     billing repository's own status union.
//
// No import from `lib/business-os/entitlements/` (SC-5): the plan subscription
// is read as a billing row, not as an entitlement.

import type { BusinessOsSubscriptionStatus } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { LocalPreconditionResult } from './localPrecondition';
import type { SchemaReconcileStatus } from './SchemaReconciler';
import type { DeleteGraphStatus } from './deleteGraph';

export type AdminDeletionRefusalId = 'R-1' | 'R-2' | 'R-3' | 'R-4' | 'R-5' | 'R-6' | 'R-7' | 'R-8';

/**
 * - `applies`        the refusal holds: deletion is blocked until it clears
 * - `clear`          checked, and it does not hold
 * - `unverified`     the check could not be completed: treated as blocking
 * - `not_applicable` cannot occur as the platform is built (R-4)
 * - `not_evaluated`  skipped because R-1 or R-2 already refuses (SC-3)
 * - `deferred`       only knowable at the moment of deletion (R-7, D-4)
 */
export type AdminDeletionRefusalStatus =
  | 'applies'
  | 'clear'
  | 'unverified'
  | 'not_applicable'
  | 'not_evaluated'
  | 'deferred';

export interface AdminDeletionRefusal {
  id: AdminDeletionRefusalId;
  status: AdminDeletionRefusalStatus;
  /** What was found, in plain language. Never an email or a business name. */
  message: string;
  /** What clears it, when something can. */
  clearingAction?: string;
  /** Structured facts for the dialog (counts, modes, table names). No PII. */
  detail?: Record<string, unknown>;
}

/** The statuses that block a deletion. */
export const BLOCKING_REFUSAL_STATUSES: ReadonlySet<AdminDeletionRefusalStatus> = new Set(['applies', 'unverified']);

/**
 * R-3: plan subscription statuses that mean "we are still charging, or may".
 * Typed against the repository's union, so a status the database cannot hold
 * does not compile (SA further condition 1).
 */
export const R3_LIVE_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
];

/** One `livemode` row of `business_os_billing_accounts`, reduced to what R-3 reads. */
export interface PlanBillingRowFact {
  status: BusinessOsSubscriptionStatus | null;
  stripeSubscriptionId: string | null;
  endedAt: string | null;
}

/** One Stripe mode's billing read: the row (or none), or unreadable. */
export type PlanBillingFact = { row: PlanBillingRowFact | null } | 'unreadable';

/** The facts R-3 … R-8 need. Read only when R-1 and R-2 are clear (SC-3). */
export interface AdminDeletionLaterFacts {
  billing: { test: PlanBillingFact; live: PlanBillingFact };
  /** Stripe Connect accounts found, or unreadable (the resolver threw). */
  connectAccounts: number | 'unreadable';
  /** `decideLocalPrecondition(countLocalBlockingState(target))`. */
  localBlocking: LocalPreconditionResult;
  schema: { status: SchemaReconcileStatus; unclassified: readonly string[]; missingDeletable: readonly string[] };
  /**
   * AD-2a: the delete-graph verdict for the admin run's level and options.
   * R-8 refuses unless it is `ok` (a cascade, delete order or trigger outside
   * the run). The orchestrator refuses the same verdict; R-8 shows it before
   * the admin types anything. Missing at runtime = `unverified` (fail closed).
   */
  deleteGraph: { status: DeleteGraphStatus };
}

export interface AdminDeletionFacts {
  adminId: string;
  targetId: string;
  /** `checkAdminStatus` on the target: `null` = could not tell. */
  targetIsAdmin: boolean | null;
  /** Absent when R-1 / R-2 refused and nothing further was read. */
  later?: AdminDeletionLaterFacts;
}

export interface AdminDeletionEvaluation {
  /** Always R-1 … R-8, in order. */
  refusals: AdminDeletionRefusal[];
  /** True when R-1 or R-2 refuses (applies or unverified): nothing is counted. */
  identityRefused: boolean;
}

/** True when a plan billing row means the business may still be charged (SC-5). */
export function isPlanSubscriptionLive(row: PlanBillingRowFact): boolean {
  if (row.status !== null && R3_LIVE_STATUSES.includes(row.status)) return true;
  // A subscription Stripe has not ended yet, whatever the mirrored status says.
  return row.stripeSubscriptionId !== null && row.endedAt === null;
}

const R3_CLEARING =
  'Cancel the subscription in the Stripe dashboard, in the mode shown (test or live). In-app cancel arrives with plan payments P-7a.';

function evaluateR1(facts: AdminDeletionFacts): AdminDeletionRefusal {
  if (facts.targetId.toLowerCase() === facts.adminId.toLowerCase()) {
    return {
      id: 'R-1',
      status: 'applies',
      message: 'This is your own account. An admin cannot delete their own account from the admin console.',
      clearingAction: 'None from the admin console: your own account is never deleted here.',
    };
  }
  return { id: 'R-1', status: 'clear', message: 'This is not your own account.' };
}

function evaluateR2(facts: AdminDeletionFacts): AdminDeletionRefusal {
  if (facts.targetIsAdmin === true) {
    return {
      id: 'R-2',
      status: 'applies',
      message: 'This account is a platform admin. Admin accounts cannot be deleted from the admin console.',
      clearingAction: 'Remove the admin first, by SQL (admins are not managed from the UI).',
    };
  }
  if (facts.targetIsAdmin === null) {
    return {
      id: 'R-2',
      status: 'unverified',
      message: 'Could not verify whether this account is a platform admin. Refusing rather than assuming it is not.',
      clearingAction: 'Try again. If it keeps failing, the admin list could not be read: contact engineering.',
    };
  }
  return { id: 'R-2', status: 'clear', message: 'This account is not a platform admin.' };
}

function evaluateR3(billing: AdminDeletionLaterFacts['billing']): AdminDeletionRefusal {
  const modes = [
    { mode: 'test' as const, fact: billing.test },
    { mode: 'live' as const, fact: billing.live },
  ];
  const liveModes = modes
    .filter((m) => m.fact !== 'unreadable' && m.fact.row !== null && isPlanSubscriptionLive(m.fact.row))
    .map((m) => m.mode);
  const unreadableModes = modes.filter((m) => m.fact === 'unreadable').map((m) => m.mode);

  if (liveModes.length > 0) {
    return {
      id: 'R-3',
      status: 'applies',
      message: `This business has a platform plan subscription that is still live (Stripe ${liveModes.join(' and ')} mode). Deleting it would keep charging a business that no longer exists.`,
      clearingAction: R3_CLEARING,
      detail: { liveModes, unreadableModes },
    };
  }
  if (unreadableModes.length > 0) {
    return {
      id: 'R-3',
      status: 'unverified',
      message: `Could not read the platform plan subscription (Stripe ${unreadableModes.join(' and ')} mode). Refusing rather than assuming there is none.`,
      clearingAction: 'Try again. If it keeps failing, contact engineering.',
      detail: { liveModes, unreadableModes },
    };
  }
  return { id: 'R-3', status: 'clear', message: 'No live platform plan subscription, in test or live mode.' };
}

function evaluateR4(): AdminDeletionRefusal {
  // SA-7: as built, no login can pay for another login's plan (one `user_id`
  // per billing row, no payer column; "friend pays" = the friend pays for
  // their own plan). R-3 covers the target's own subscription. R-4 stays in
  // the list so it is never forgotten: ANY future slice that lets one login
  // pay for another MUST wire R-4 in the same PR (requirement §6.3, UD-4).
  return {
    id: 'R-4',
    status: 'not_applicable',
    message: 'No cross-account payment relationship exists.',
  };
}

function evaluateR5(connectAccounts: AdminDeletionLaterFacts['connectAccounts']): AdminDeletionRefusal {
  if (connectAccounts === 'unreadable') {
    return {
      id: 'R-5',
      status: 'unverified',
      message: 'Could not determine whether this business has a Stripe account connected. Refusing rather than assuming it does not.',
      clearingAction: 'Try again. If it keeps failing, contact engineering.',
    };
  }
  if (connectAccounts > 0) {
    return {
      id: 'R-5',
      status: 'applies',
      message: `This business has ${connectAccounts} Stripe account(s) connected for taking client payments.`,
      clearingAction: 'Disconnect Stripe first (available with AD-4).',
      detail: { accountCount: connectAccounts },
    };
  }
  return { id: 'R-5', status: 'clear', message: 'No Stripe account connected.' };
}

function evaluateR6(local: LocalPreconditionResult): AdminDeletionRefusal {
  if (local.outcome === 'refused') {
    return {
      id: 'R-6',
      status: 'unverified',
      message: `Could not check for payments still in flight (${local.reason}). Refusing rather than assuming there are none.`,
      clearingAction: 'Try again. If it keeps failing, contact engineering.',
    };
  }
  if (local.outcome === 'blocked') {
    return {
      id: 'R-6',
      status: 'applies',
      message: `This business still has money in flight: ${local.hits.map((h) => `${h.count} ${h.label}`).join('; ')}.`,
      clearingAction: 'Resolve these first: finish or cancel the running plans, settle the pending payments and refunds, and close the unpaid invoices.',
      detail: { hits: local.hits.map((h) => ({ condition: h.condition, table: h.table, count: h.count })) },
    };
  }
  return { id: 'R-6', status: 'clear', message: 'No money in flight.' };
}

function evaluateR7(): AdminDeletionRefusal {
  // D-4: knowing whether a run is in progress means taking the advisory lock,
  // which would make a read-only preview a writer. AD-2 evaluates it for real.
  return {
    id: 'R-7',
    status: 'deferred',
    message: 'Checked at the moment of deletion.',
  };
}

/**
 * AD-2a: R-7 for real, at the moment of deletion. The RPC's advisory lock is
 * the only thing that knows; its `already_running` answer maps here (AC-A11).
 */
export function r7AlreadyRunning(): AdminDeletionRefusal {
  return {
    id: 'R-7',
    status: 'applies',
    message: 'A deletion of this business is already running. Nothing was deleted by this attempt.',
    clearingAction: 'Wait for the running deletion to finish, then open the preview again.',
  };
}

function evaluateR8(
  schema: AdminDeletionLaterFacts['schema'],
  deleteGraph: AdminDeletionLaterFacts['deleteGraph'] | undefined,
): AdminDeletionRefusal {
  const clearingAction = 'This is a platform problem, not something wrong with this business: contact engineering.';
  if (schema.status === 'ok') {
    // AD-2a: a classified schema is not enough. The live delete graph must
    // also be clean for this run, or the run would reach rows it does not list.
    const graphStatus = deleteGraph?.status;
    if (graphStatus === 'refused') {
      return {
        id: 'R-8',
        status: 'applies',
        message:
          'The live database structure would make this deletion remove or block rows outside what it lists (a cascade, a delete order or an unreviewed trigger).',
        clearingAction,
        detail: { deleteGraph: 'refused' },
      };
    }
    if (graphStatus !== 'ok') {
      return {
        id: 'R-8',
        status: 'unverified',
        message:
          'Could not verify what this deletion would remove by cascade: the live database structure could not be read. Refusing.',
        clearingAction,
        detail: { deleteGraph: graphStatus ?? 'not_read' },
      };
    }
    return {
      id: 'R-8',
      status: 'clear',
      message: 'Every table that holds business data is classified, and the delete graph is clean.',
    };
  }
  if (schema.status === 'drift') {
    return {
      id: 'R-8',
      status: 'applies',
      message: 'The platform has business data tables whose deletion rules are not defined yet, so the count could be incomplete.',
      clearingAction,
      detail: { unclassified: [...schema.unclassified], missingDeletable: [...schema.missingDeletable] },
    };
  }
  return {
    id: 'R-8',
    status: 'unverified',
    message:
      schema.status === 'ambiguous'
        ? 'Could not verify that every business data table is classified: the schema check is ambiguous. Refusing.'
        : 'Could not verify that every business data table is classified: the schema could not be read. Refusing.',
    clearingAction,
  };
}

function notEvaluated(id: AdminDeletionRefusalId): AdminDeletionRefusal {
  return { id, status: 'not_evaluated', message: 'Not checked: this account is refused above.' };
}

/**
 * Evaluate R-1 … R-8. Every refusal is returned, always in order.
 *
 * When R-1 or R-2 refuses (including R-2 unverified: an account that may be an
 * admin is not enumerated), R-3 … R-8 are `not_evaluated` and `later` is
 * ignored. When they are clear but `later` is missing, R-3 … R-8 fail closed
 * to `unverified`: a fact that was never read is not a pass.
 */
export function evaluateAdminDeletionRefusals(facts: AdminDeletionFacts): AdminDeletionEvaluation {
  const r1 = evaluateR1(facts);
  const r2 = evaluateR2(facts);
  const identityRefused = BLOCKING_REFUSAL_STATUSES.has(r1.status) || BLOCKING_REFUSAL_STATUSES.has(r2.status);

  if (identityRefused) {
    return {
      identityRefused,
      refusals: [r1, r2, ...(['R-3', 'R-4', 'R-5', 'R-6', 'R-7', 'R-8'] as const).map(notEvaluated)],
    };
  }

  const later = facts.later;
  if (!later) {
    const missing = (id: AdminDeletionRefusalId): AdminDeletionRefusal => ({
      id,
      status: 'unverified',
      message: 'Could not verify: this check did not run. Refusing.',
    });
    return {
      identityRefused,
      refusals: [r1, r2, missing('R-3'), evaluateR4(), missing('R-5'), missing('R-6'), evaluateR7(), missing('R-8')],
    };
  }

  return {
    identityRefused,
    refusals: [
      r1,
      r2,
      evaluateR3(later.billing),
      evaluateR4(),
      evaluateR5(later.connectAccounts),
      evaluateR6(later.localBlocking),
      evaluateR7(),
      evaluateR8(later.schema, later.deleteGraph),
    ],
  };
}

/** The refusals that block, in order. */
export function blockingRefusals(refusals: readonly AdminDeletionRefusal[]): AdminDeletionRefusal[] {
  return refusals.filter((r) => BLOCKING_REFUSAL_STATUSES.has(r.status));
}
