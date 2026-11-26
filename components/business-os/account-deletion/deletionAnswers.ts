/**
 * What the owner sees for every answer of the deletion request and of Keep
 * my account (account deletion lifecycle DL-2a; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.4, §5.5, D-10;
 * DL-1b hand-overs CR-6 and CR-8).
 *
 * Pure maps: an HTTP status and a parsed body in, an outcome out. The
 * components only render outcomes, so every code is tested without
 * rendering. Typed `Record`s over the server's refusal codes: a new server
 * code fails the build until it is given an outcome here (the
 * `planManageCopy.ts` pattern).
 *
 * CLIENT-SAFE (SA W-5): `closureRequest.ts` and `closureKeep.ts` are imported
 * with `import type` only, so no server code reaches the browser bundle.
 * Values come from `schemas.ts` and `blockerCopy.ts`, both zod-only or
 * import-free.
 *
 * @module components/business-os/account-deletion/deletionAnswers
 */

import type { ClosureRequestRefusalCode } from '@/lib/business-os/account-deletion/closureRequest';
import type { ClosureKeepRefusalCode } from '@/lib/business-os/account-deletion/closureKeep';
import { BLOCKER_CODES, type BlockerCode, type BlockerView } from '@/lib/business-os/account-deletion/blockerCopy';
import { accountDeleteResponseDataSchema, accountKeepResponseDataSchema } from '@/lib/business-os/account-deletion/schemas';

/** A network failure (fetch threw): no status at all. */
export const NETWORK_FAILURE = 'network' as const;
export type AnswerStatus = number | typeof NETWORK_FAILURE;

interface AnswerBody {
  error?: unknown;
  data?: unknown;
  blockers?: unknown;
  outcomeUnknown?: unknown;
}

const asBody = (body: unknown): AnswerBody => (body && typeof body === 'object' ? (body as AnswerBody) : {});
const dataStatus = (body: AnswerBody): unknown =>
  body.data && typeof body.data === 'object' ? (body.data as { status?: unknown }).status : undefined;

const isBlockerCode = (value: unknown): value is BlockerCode =>
  typeof value === 'string' && (BLOCKER_CODES as readonly string[]).includes(value);

/**
 * The server's blockers. An unknown code reads "contact us", and an empty or
 * unreadable list falls back to the same (SA N-1): a refusal always says something.
 */
export function parseBlockers(value: unknown): BlockerView[] {
  const out: BlockerView[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const { code, count } = item as { code?: unknown; count?: unknown };
      const known = isBlockerCode(code) ? code : 'contact_support';
      if (out.some((blocker) => blocker.code === known)) continue;
      out.push(typeof count === 'number' && Number.isFinite(count) && count > 0 ? { code: known, count } : { code: known });
    }
  }
  return out.length > 0 ? out : [{ code: 'contact_support' }];
}

// ── The request (§5.4) ──────────────────────────────────────────────────────

/** Every line the drawer can show for a request answer. */
export type RequestMessageKey =
  | 'settings.account_delete.plan_change_pending'
  | 'settings.account_delete.plan_state_changed'
  | 'settings.account_delete.mismatch'
  | 'settings.account_delete.try_again'
  | 'settings.account_delete.too_many'
  | 'settings.account_delete.not_available'
  | 'settings.account_delete.already_requested'
  | 'plan.refusal.signed_out';

export type RequestOutcome =
  /** Recorded: re-read the closure and show the pending view. */
  | { kind: 'recorded' }
  /** Already requested (any `data.status`, `null` included: CR-6): re-read. */
  | { kind: 'already' }
  | { kind: 'blocked'; blockers: BlockerView[] }
  | { kind: 'message'; key: RequestMessageKey }
  /** We do not know whether it was recorded: say so, then re-read. */
  | { kind: 'unconfirmed' };

const TRY_AGAIN: RequestOutcome = { kind: 'message', key: 'settings.account_delete.try_again' };
const UNCONFIRMED: RequestOutcome = { kind: 'unconfirmed' };

/** The request route's own refusal codes (closureRequest.ts), each given an outcome. */
const REQUEST_REFUSALS: Readonly<Record<ClosureRequestRefusalCode, (body: AnswerBody) => RequestOutcome>> = {
  already_requested: () => ({ kind: 'already' }),
  blocked: (body) => ({ kind: 'blocked', blockers: parseBlockers(body.blockers) }),
  plan_change_pending: () => ({ kind: 'message', key: 'settings.account_delete.plan_change_pending' }),
  plan_state_changed: () => ({ kind: 'message', key: 'settings.account_delete.plan_state_changed' }),
  not_available: () => ({ kind: 'message', key: 'settings.account_delete.not_available' }),
  // P-8: `data.status: 'requesting'` means the row was written and Stripe's answer is pending.
  try_again: (body) => (dataStatus(body) === 'requesting' ? UNCONFIRMED : TRY_AGAIN),
  // Without `outcomeUnknown` the row was deleted and nothing changed.
  stripe_error: (body) => (body.outcomeUnknown === true ? UNCONFIRMED : TRY_AGAIN),
  request_failed: () => UNCONFIRMED,
};

export function requestOutcome(status: AnswerStatus, rawBody: unknown): RequestOutcome {
  if (status === NETWORK_FAILURE) return UNCONFIRMED;
  const body = asBody(rawBody);
  if (status === 200) {
    const data = accountDeleteResponseDataSchema.safeParse(body.data);
    // A 200 we cannot read may still have recorded the request: re-read rather than claim either way.
    return data.success ? { kind: 'recorded' } : UNCONFIRMED;
  }
  if (status === 401) return { kind: 'message', key: 'plan.refusal.signed_out' };
  if (status === 429) return { kind: 'message', key: 'settings.account_delete.too_many' };
  // The switch was turned off after the page loaded.
  if (status === 404) return { kind: 'message', key: 'settings.account_delete.not_available' };
  const code = typeof body.error === 'string' ? body.error : null;
  if (status === 400 && code === 'statement_mismatch') return { kind: 'message', key: 'settings.account_delete.mismatch' };
  // `invalid_body` (400) and `body_too_large` (413): nothing was recorded.
  if (status === 400 || status === 413) return TRY_AGAIN;
  if (code !== null && Object.prototype.hasOwnProperty.call(REQUEST_REFUSALS, code)) {
    return REQUEST_REFUSALS[code as ClosureRequestRefusalCode](body);
  }
  // Anything else: a server error may have recorded it; a client error did not.
  return status >= 500 ? UNCONFIRMED : TRY_AGAIN;
}

// ── Keep my account (§5.5) ──────────────────────────────────────────────────

export type KeepMessageKey =
  | 'account_closure.kept.restored'
  | 'account_closure.kept.not_restored_by_choice'
  | 'account_closure.kept.not_restored_by_choice_nodate'
  | 'account_closure.kept.not_needed'
  | 'account_closure.kept.failed'
  | 'account_closure.kept.unknown'
  | 'account_closure.kept.generic'
  | 'account_closure.nothing_to_keep'
  | 'account_closure.requesting_body'
  | 'account_closure.locked_body'
  | 'account_closure.keep_failed'
  | 'settings.account_delete.too_many'
  | 'plan.refusal.signed_out';

export interface KeepOutcome {
  /** True: the account is kept. The message is a `status`; the host page is refreshed. */
  kept: boolean;
  message: { key: KeepMessageKey; vars?: Record<string, string> } | null;
  /** Re-read the closure after this answer. */
  reread: boolean;
}

const keptWith = (key: KeepMessageKey, vars?: Record<string, string>): KeepOutcome => ({ kept: true, message: { key, ...(vars ? { vars } : {}) }, reread: true });
const refusedWith = (key: KeepMessageKey, reread = false): KeepOutcome => ({ kept: false, message: { key }, reread });

const KEEP_REFUSALS: Readonly<Record<ClosureKeepRefusalCode, (body: AnswerBody) => KeepOutcome>> = {
  nothing_to_keep: () => refusedWith('account_closure.nothing_to_keep', true),
  request_in_progress: () => refusedWith('account_closure.requesting_body'),
  locked: () => refusedWith('account_closure.locked_body'),
  // CR-8: another tab (or the mirror) kept it first: that is a kept screen.
  state_changed: (body) => (dataStatus(body) === 'kept' ? keptWith('account_closure.kept.generic') : { kept: false, message: null, reread: true }),
  try_again: () => refusedWith('account_closure.keep_failed'),
};

/**
 * `planEnd` is the plan end of the row read before the press, already
 * formatted on the closure's clock, or null when it is unknown (then the
 * `_nodate` line).
 */
export function keepOutcome(status: AnswerStatus, rawBody: unknown, context: { planEnd: string | null }): KeepOutcome {
  if (status === NETWORK_FAILURE) return refusedWith('account_closure.keep_failed');
  const body = asBody(rawBody);
  if (status === 200) {
    const data = accountKeepResponseDataSchema.safeParse(body.data);
    if (!data.success) return keptWith('account_closure.kept.generic');
    switch (data.data.renewal) {
      case 'restored':
        return keptWith('account_closure.kept.restored');
      case 'not_restored_by_choice':
        return context.planEnd
          ? keptWith('account_closure.kept.not_restored_by_choice', { planEnd: context.planEnd })
          : keptWith('account_closure.kept.not_restored_by_choice_nodate');
      case 'not_needed':
        return keptWith('account_closure.kept.not_needed');
      case 'failed':
        return keptWith('account_closure.kept.failed');
      case 'unknown':
        return keptWith('account_closure.kept.unknown');
    }
  }
  if (status === 401) return refusedWith('plan.refusal.signed_out');
  if (status === 429) return refusedWith('settings.account_delete.too_many');
  const code = typeof body.error === 'string' ? body.error : null;
  if (code !== null && Object.prototype.hasOwnProperty.call(KEEP_REFUSALS, code)) {
    return KEEP_REFUSALS[code as ClosureKeepRefusalCode](body);
  }
  return refusedWith('account_closure.keep_failed');
}
