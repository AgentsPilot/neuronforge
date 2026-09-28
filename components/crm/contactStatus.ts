/**
 * Whether a contact is still someone the business is working with.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "DEACTIVATED" IS A STAGE, NOT A COLUMN
 *
 * `crm_contacts` has no `is_active`. Deactivating moves the person into the
 * stage that means the relationship has ended, and the API resolves which stage
 * that is by TYPE — `past_client`, then `archived` — never by name or position,
 * because pipelines are generated per business: one calls it `inactive`, the
 * next `הושלם`, the next `closed_lost`.
 *
 * So the question "is this contact inactive" has exactly one correct form, and
 * it is this one. Asking it by stage KEY works for whichever business was in
 * front of you when you wrote it and quietly fails for every other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';

/** The stage types that mean the relationship is over. In preference order. */
const RETIRED_TYPES = ['past_client', 'archived'] as const;

/**
 * True when this contact sits in a stage that means they are no longer active.
 *
 * Returns false when the stages have not loaded yet — the honest answer while
 * we do not know is "do not claim they are inactive", since the badge that
 * follows is a statement about a real person's standing with the business.
 */
export function isContactInactive(
  stageKey: string | null | undefined,
  stages: CRMPipelineStage[] | undefined
): boolean {
  if (!stageKey || !stages?.length) return false;

  const stage = stages.find((s) => s.stage_key === stageKey);
  if (!stage) return false;

  return (RETIRED_TYPES as readonly string[]).includes(stage.stage_type);
}

/**
 * Where reactivating puts someone.
 *
 * The stage the business marked as its primary client stage, because a contact
 * being brought back is a client again — not a fresh lead to be qualified from
 * scratch. Falling back to the first stage that is not retired keeps a pipeline
 * without that flag working rather than leaving the button dead.
 *
 * Returns undefined when every stage is retired, which is a pipeline worth
 * fixing rather than a case to guess at.
 */
export function reactivationStage(
  stages: CRMPipelineStage[] | undefined
): CRMPipelineStage | undefined {
  if (!stages?.length) return undefined;

  const byPosition = [...stages].sort((a, b) => a.position - b.position);

  return (
    byPosition.find((s) => s.is_primary_client_stage) ??
    byPosition.find((s) => !(RETIRED_TYPES as readonly string[]).includes(s.stage_type))
  );
}
