/**
 * How a refusal from the Apply, Dismiss or margin review functions becomes an
 * answer (AI model price review slice 8; SA RC-3, RC-14). Pure.
 *
 * The functions raise their own SQLSTATEs (class P, left by Postgres to
 * applications, SA O-11) and put the refused line's id in DETAIL, so the page
 * can say which line it was. Anything unknown is a 500 with no detail.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DecisionCode =
  | 'not_admin_row'
  | 'not_found'
  | 'not_pending'
  | 'stale'
  | 'starts_later'
  | 'busy'
  | 'override_required'
  | 'override_not_needed'
  | 'already_done'
  | 'not_needed'
  | 'invalid_input';

export interface DecisionAnswer {
  status: number;
  code: DecisionCode;
  error: string;
  lineIds: string[];
}

const WORDS: Record<DecisionCode, [number, string]> = {
  // SA CR8-1: 42501 is also what the emergency stop (REVOKE EXECUTE) returns, so the words must be true in both cases.
  // The runbook quotes them exactly (emergencyRunbook.source.test.ts pins the pair).
  not_admin_row: [403, 'Prices cannot be changed right now: your admin access is not recorded, or an operator has switched Apply off. Ask an operator.'],
  not_found: [404, 'That price is no longer on record. Reload the page.'],
  not_pending: [409, 'That price was already applied, dismissed or replaced. Reload the page.'],
  stale: [409, 'The price we charge changed since this was recorded. Record the provider price again.'],
  starts_later: [409, 'A price dated later is waiting for this model, so it cannot be applied now. Ask an operator to check it.'],
  busy: [409, 'Someone else is changing prices. Try again.'],
  override_required: [422, 'A flagged price needs your own reason for going ahead.'],
  override_not_needed: [422, 'An override reason was given for a price that has no flag to override. Remove it and try again.'],
  already_done: [409, 'This margin review is already marked done.'],
  not_needed: [409, 'This Apply needs no margin review.'],
  invalid_input: [400, 'Some details could not be read. Check them and try again.'],
};

export function decisionAnswer(code: DecisionCode, lineIds: readonly string[] = []): DecisionAnswer {
  const [status, error] = WORDS[code];
  return { status, code, error, lineIds: [...lineIds] };
}

/** The answer for a database refusal, or null when it is not one of ours (then the route answers 500). */
export function answerForDatabaseError(error: { code?: string; details?: string } | null | undefined): DecisionAnswer | null {
  const code = error?.code;
  const lineIds = typeof error?.details === 'string' && UUID.test(error.details) ? [error.details] : [];
  switch (code) {
    case '42501':
      return decisionAnswer('not_admin_row');
    case 'P8001':
      return decisionAnswer('not_pending', lineIds);
    case 'P8002':
    case '23505':
      return decisionAnswer('stale', lineIds);
    case 'P8003':
      return decisionAnswer('override_required', lineIds);
    case 'P8004':
      return decisionAnswer('not_found', lineIds);
    case 'P8005':
      return decisionAnswer(error?.details === 'not_needed' ? 'not_needed' : 'already_done');
    case 'P8006':
      return decisionAnswer('override_not_needed', lineIds);
    case 'P8007':
      return decisionAnswer('starts_later', lineIds);
    case '55P03':
    case '40P01':
      return decisionAnswer('busy');
    case '22023':
      return decisionAnswer('invalid_input');
    default:
      return null;
  }
}
