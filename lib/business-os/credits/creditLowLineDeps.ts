/**
 * The low-line check's production wiring (credit deduction slice 8b, SA SQ-44).
 *
 * Declared, with its reason, on the plan repository's referrer guard (RC-15,
 * `businessOsEntitlements.imports.guard`) as a READER: it calls
 * `findPeriodAnchor` and nothing else, and that guard pins that it calls no
 * plan-state write.
 *
 * ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
 * The check runs inside the AI charge recorder, after a charge is recorded,
 * in a path that has no user session — so no owner RLS client exists there.
 * Both reads therefore run as the service role (the S11-SQ-9 pattern SA ruled):
 *   - the plan anchor (`findPeriodAnchor`): the plan table has no owner policy
 *     by design;
 *   - the credit totals, through the OWNER read repository constructed on the
 *     service-role client: owner-safe columns only (no cost column), and every
 *     method adds `.eq('user_id', accountId)` for the one account.
 * The account id is the charge record's `accountId`, validated by
 * `runAiAction` from its own server-side identities — never request input.
 * SELECT only; nothing is written here.
 *
 * Server-only.
 *
 * @module lib/business-os/credits/creditLowLineDeps
 */

import 'server-only';

import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { BusinessOsCreditOwnerReadRepository } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import type { CreditLowLineDeps } from './creditLowLine';

let owner: BusinessOsCreditOwnerReadRepository | undefined;

export function creditLowLineDeps(): CreditLowLineDeps {
  // One instance per process; constructing it does no I/O.
  owner ??= new BusinessOsCreditOwnerReadRepository(supabaseServer);
  return {
    findPeriodAnchor: (accountId) => businessOsAccountPlanRepository.findPeriodAnchor(accountId),
    owner,
  };
}
