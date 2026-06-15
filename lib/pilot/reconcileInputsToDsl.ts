/**
 * reconcileInputsToDsl — bridge step-tagged input values onto the DSL's
 * `{{input.X}}` references at execution time.
 *
 * Why this exists (WP-57 2B Part 2):
 *   A workflow step reads its parameters from `{{input.X}}` (e.g. a Drive
 *   `list_files` step reads `folder_id: "{{input.folder_id}}"`). At runtime
 *   that resolves to a plain lookup of `inputValues.folder_id`
 *   (ExecutionContext.resolveReference → getNestedValue). But the value the
 *   user actually supplied is delivered under a *namespaced* key that tags it
 *   for a specific step — `{plugin}__{capability}__{param}`, e.g.
 *   `google-drive__storage/list__folder_link`. Nothing bridges the two, so
 *   `inputValues.folder_id` is empty and the action falls back to its default
 *   (for `list_files`, the Drive root). The DSL and the values only sit
 *   together at execution time, which is why this reconciliation lives here and
 *   not in the compiler (the compiler's merged config never reaches runtime —
 *   see WP-57 summary § "Why the compiler can't carry the fix").
 *
 * What it does:
 *   For each action step's unmet `{{input.X}}` reference, route a value whose
 *   namespaced key is tagged for that *same step* (matched by `step.plugin`)
 *   into `X`. When a step has more than one candidate, a stem check
 *   (`folder_id` ≡ `folder_link` ≡ `folder`, stripping `_id`/`_link`/`_url`)
 *   disambiguates. The Drive executor's `extractDriveId` (WP-57 2B Part 1) then
 *   turns the routed link into a bare ID.
 *
 * Safety:
 *   - Plugin-agnostic — keys off the `{plugin}__…` tag, never hardcoded names.
 *   - Fills MISSING keys only; an exact-name match (`inputValues.folder_id`
 *     already present) is never overwritten, so every currently-working agent
 *     produces byte-identical inputs.
 *   - Pure — returns a new object; the caller's `inputValues` is not mutated.
 *
 * @module lib/pilot/reconcileInputsToDsl
 */

import { createLogger } from '@/lib/logger';
import type { WorkflowStep } from './types';

const logger = createLogger({ module: 'reconcileInputsToDsl' });

/** Matches `{{input.X}}` / `{{inputs.X}}` and captures `X` (may be dotted). */
const INPUT_REF_RE = /\{\{\s*inputs?\.([a-zA-Z0-9_$.]+)\s*\}\}/g;

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '';

/** Strip a trailing role suffix (`_id`/`_link`/`_url`) to get the semantic stem. */
function stemOf(name: string): string {
  return name.replace(/_(id|link|url)$/i, '').toLowerCase();
}

/**
 * Parse a namespaced input key `{plugin}__{capability}__{param}`.
 * The param (last segment) may itself contain dots (e.g. `recipients.to`);
 * only `__` separates the three parts. Returns null for non-namespaced keys.
 */
function parseNamespacedKey(key: string): { plugin: string; param: string } | null {
  const parts = key.split('__');
  if (parts.length < 3) return null;
  const plugin = parts[0];
  const param = parts[parts.length - 1];
  // A malformed key with an empty plugin or param segment (e.g. a trailing
  // `__`) is not a routable tag — reject it so it can't satisfy the
  // single-candidate fallback with a stem-less, empty-named param.
  if (!plugin || !param) return null;
  return { plugin, param };
}

/** Collect every `{{input.X}}` reference found anywhere inside a params value. */
function collectInputRefs(value: unknown, acc: Set<string>): void {
  if (typeof value === 'string') {
    INPUT_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INPUT_REF_RE.exec(value)) !== null) acc.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) collectInputRefs(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectInputRefs(v, acc);
  }
}

/** Visit every action step (one with a `plugin` + `params`), recursing nested blocks. */
function forEachActionStep(steps: WorkflowStep[], fn: (step: any) => void): void {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as any;
    if (s.plugin && s.params) fn(s);
    // Recurse the nested-step shapes of every container step type.
    if (Array.isArray(s.then_steps)) forEachActionStep(s.then_steps, fn);
    if (Array.isArray(s.else_steps)) forEachActionStep(s.else_steps, fn);
    if (Array.isArray(s.loopSteps)) forEachActionStep(s.loopSteps, fn);
    if (Array.isArray(s.steps)) forEachActionStep(s.steps, fn);
    if (Array.isArray(s.workflowSteps)) forEachActionStep(s.workflowSteps, fn);
    if (s.scatter && Array.isArray(s.scatter.steps)) forEachActionStep(s.scatter.steps, fn);
  }
}

/**
 * Route step-tagged namespaced input values onto the DSL's unmet `{{input.X}}`
 * references. Returns a new inputValues object; only missing keys are filled.
 */
export function reconcileInputsToDsl(
  steps: WorkflowStep[],
  inputValues: Record<string, any>
): Record<string, any> {
  if (!Array.isArray(steps) || !inputValues || typeof inputValues !== 'object') {
    return inputValues;
  }

  // Pre-parse the namespaced (step-tagged) keys that carry a value.
  const namespaced = Object.keys(inputValues)
    .map(key => {
      const parsed = parseNamespacedKey(key);
      return parsed ? { key, plugin: parsed.plugin, param: parsed.param } : null;
    })
    .filter((x): x is { key: string; plugin: string; param: string } =>
      x !== null && !isEmpty(inputValues[x.key])
    );

  if (namespaced.length === 0) return inputValues;

  const result = { ...inputValues };
  const routed: Array<{ from: string; to: string; plugin: string }> = [];

  forEachActionStep(steps, (step) => {
    const plugin: string = step.plugin;

    const refs = new Set<string>();
    collectInputRefs(step.params, refs);

    // Only top-level (non-dotted) refs that are currently unmet. Dotted refs
    // (e.g. `recipients.to`) address nested input shapes we don't synthesize.
    const unmet = [...refs].filter(x => !x.includes('.') && isEmpty(result[x]));
    if (unmet.length === 0) return;

    const candidates = namespaced.filter(n => n.plugin === plugin);
    if (candidates.length === 0) return;

    for (const x of unmet) {
      // A previous step in this pass may already have filled it.
      if (!isEmpty(result[x])) continue;

      const stemMatches = candidates.filter(c => stemOf(c.param) === stemOf(x));

      let chosen: typeof candidates[number] | undefined;
      if (stemMatches.length === 1) {
        // Unambiguous semantic match — strongest signal.
        chosen = stemMatches[0];
      } else if (stemMatches.length === 0 && candidates.length === 1 && unmet.length === 1) {
        // The step has a single unmet input and the plugin tagged a single
        // value for it — the step itself disambiguates, no stem needed.
        chosen = candidates[0];
      }
      // Otherwise ambiguous (multiple stem matches, or multiple candidates for
      // a multi-input step with no stem match) — leave unmet, same as today.
      if (!chosen) continue;

      result[x] = inputValues[chosen.key];
      routed.push({ from: chosen.key, to: x, plugin });
    }
  });

  if (routed.length > 0) {
    logger.info({ routed }, 'Reconciled step-tagged inputs onto DSL input references');
  }

  return result;
}
