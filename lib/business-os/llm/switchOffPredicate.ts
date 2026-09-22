import 'server-only';

/**
 * The switch-off trap, as ONE implementation both doors call.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * A call-level `enabled: true` SURVIVES an area-level `enabled: false`: the
 * resolver reads the call override last, so an "emergency switch-off" that
 * ignored it would leave named calls spending. The operator script has refused
 * that since Layer 2 (`scripts/bos-llm-settings.ts`, the `--include-calls`
 * rule) — but it refuses it in the SCRIPT, not in `validateAreaRow`.
 *
 * That matters here. The admin screen's requirement says the screen must not
 * become "a weaker door than the script", and it achieves that for the
 * guardrails by calling the resolver's own `validateAreaRow`. This rule is the
 * one refusal `validateAreaRow` does NOT know, so a screen that re-implemented
 * it would be a second copy that can drift — on the single refusal an
 * emergency depends on, where drift means calls kept running after an operator
 * was told they had stopped.
 *
 * So: one pure predicate over a CANDIDATE row, no repository, no cache, no
 * I/O, usable at the same point in both flows.
 *
 * ── Two deliberate differences from the script's inline block ─────────────
 * 1. It reads the CANDIDATE row, not the stored row. The script derives its
 *    candidate from the stored row, so the two agree; the screen submits a
 *    whole row, where the candidate is the only honest input.
 * 2. It reports only SWITCHABLE calls. A non-switchable call's `enabled: true`
 *    does not keep it running — its off path is either impossible (onboarding)
 *    or enforced at route entry (`chat/planner`, D-27) — and writing `false`
 *    into one would produce a row `validateAreaRow` then REFUSES as `locked`.
 *    Naming it would tell an operator their kill switch is partial when it is
 *    complete, which is the exact lie the S1-7 "PARTIAL SWITCH" warning was
 *    deleted for.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §3.9 (RC-4)
 * @module lib/business-os/llm/switchOffPredicate
 */

import type { BosLlmArea } from '@/lib/business-os/llm/callCatalog';
import {
  bosLlmSettingsCallNames,
  isSwitchableBosLlmCall,
} from '@/lib/business-os/llm/modelSettingsPolicy';
import { asRowObject } from '@/lib/business-os/llm/modelSettingsSchema';

/**
 * Does this candidate row switch the AREA off?
 *
 * Strictly `=== false`: an absent `enabled` inherits (the area stays on) and a
 * non-boolean is rejected by the guardrails, so neither is a switch-off.
 */
export function isAreaSwitchOff(candidateRow: unknown): boolean {
  const row = asRowObject(candidateRow);
  return row?.enabled === false;
}

/**
 * The switchable calls whose own `enabled: true` would survive this row's
 * area-level `enabled: false`.
 *
 * Empty when the row does not switch the area off, so a caller can ask
 * unconditionally.
 */
export function callsBlockingSwitchOff(area: BosLlmArea, candidateRow: unknown): string[] {
  const row = asRowObject(candidateRow);
  if (!row || row.enabled !== false) return [];

  const calls = asRowObject(row.calls) ?? {};
  const known = new Set(bosLlmSettingsCallNames(area));

  return Object.entries(calls)
    .filter(([callName, entry]) => {
      // An unknown call name is already refused by `validateAreaRow`; naming it
      // here too would produce two different refusals for one mistake.
      if (!known.has(callName)) return false;
      if (!isSwitchableBosLlmCall(area, callName)) return false;
      return (asRowObject(entry) ?? {}).enabled === true;
    })
    .map(([callName]) => callName);
}

/**
 * The `--include-calls` transform: the same row with every call named by
 * `callsBlockingSwitchOff` set to `enabled: false`.
 *
 * Returns the row unchanged when nothing blocks, so it is safe to apply
 * unconditionally. Never mutates its input — the caller may still need the
 * original for a diff.
 */
export function withCallsSwitchedOff(area: BosLlmArea, candidateRow: unknown): unknown {
  const blocking = callsBlockingSwitchOff(area, candidateRow);
  if (blocking.length === 0) return candidateRow;

  const row = asRowObject(candidateRow);
  /* istanbul ignore next — `blocking` is non-empty only when the row parsed */
  if (!row) return candidateRow;

  const calls = asRowObject(row.calls) ?? {};
  const nextCalls: Record<string, unknown> = { ...calls };
  for (const callName of blocking) {
    nextCalls[callName] = { ...(asRowObject(calls[callName]) ?? {}), enabled: false };
  }

  return { ...row, calls: nextCalls };
}
