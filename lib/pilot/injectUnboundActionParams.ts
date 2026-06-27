/**
 * injectUnboundActionParams — runtime safety net that binds an action param the
 * compiler left UNBOUND, using a step-tagged namespaced input value.
 *
 * Why this exists (WP-60 Part B):
 *   The compiler's param auto-binder couldn't connect an action param to a
 *   differently-named config key (e.g. `list_files.folder_id` ← `folder_link`,
 *   token-Jaccard 0.333 < 0.4), so it emitted NO binding and `list_files`
 *   defaulted to the Drive root. WP-60 Part A fixes the compiler for *future*
 *   agents (stem-aware matching), but already-saved agents keep the unbound DSL
 *   until regenerated. This runtime pass repairs them on the next execution —
 *   no rebuild — and catches any future compiler miss.
 *
 *   It is the schema-aware sibling of [[reconcileInputsToDsl]]: reconcile FILLS
 *   an existing `{{input.X}}` reference; this INJECTS a param that has no
 *   reference at all. Both run once at the top of `WorkflowPilot.execute()`.
 *
 * How it binds (deterministic-first, conservative):
 *   - Step targeting uses the namespaced input key `{plugin}__{capability}__{param}`,
 *     matched to the action step by **plugin** (the capability segment is not a
 *     reliable join key — it appears as both `list` and `storage/list` in the
 *     wild — so it is not required to match).
 *   - Param pick is schema-scoped: only params the action's schema actually
 *     declares are eligible, chosen by stem equality (`folder_link` →
 *     `folder_id`, stripping `_id`/`_link`/`_url`).
 *   - Conservative: injects only when exactly ONE eligible unbound param
 *     stem-matches exactly ONE step-tagged key. Any ambiguity → skip.
 *   - Backward-safe: never overwrites a param already present in the step;
 *     mutates the in-memory steps for this execution only.
 *   The injected value is the raw input (often a URL); the plugin executor's
 *   own normalisation (e.g. Drive `extractDriveId`, WP-57 2B-1) converts it.
 *
 * @module lib/pilot/injectUnboundActionParams
 */

import { createLogger } from '@/lib/logger';
import type { WorkflowStep } from './types';
import { isEmpty, stemOf, parseNamespacedKey } from './reconcileInputsToDsl';

const logger = createLogger({ module: 'injectUnboundActionParams' });

/**
 * Resolve the parameter names an action accepts (the `properties` keys of the
 * action's JSON-schema), or null if the action/plugin is unknown. Injected as a
 * callback so this stays unit-testable without the plugin manager.
 */
export type ActionParamResolver = (plugin: string, action: string) => string[] | null;

/** Visit every step that has a plugin + action, recursing nested blocks. */
function forEachPluginStep(steps: WorkflowStep[], fn: (step: any) => void): void {
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as any;
    if (s.plugin && s.action) fn(s);
    if (Array.isArray(s.then_steps)) forEachPluginStep(s.then_steps, fn);
    if (Array.isArray(s.else_steps)) forEachPluginStep(s.else_steps, fn);
    if (Array.isArray(s.loopSteps)) forEachPluginStep(s.loopSteps, fn);
    if (Array.isArray(s.steps)) forEachPluginStep(s.steps, fn);
    if (Array.isArray(s.workflowSteps)) forEachPluginStep(s.workflowSteps, fn);
    if (s.scatter && Array.isArray(s.scatter.steps)) forEachPluginStep(s.scatter.steps, fn);
  }
}

/**
 * Inject step-tagged input values into action params the compiler left unbound.
 * Mutates `steps` in place; returns the list of injections performed.
 */
export function injectUnboundActionParams(
  steps: WorkflowStep[],
  inputValues: Record<string, any>,
  resolveActionParams: ActionParamResolver
): Array<{ step: string; param: string; from: string; plugin: string }> {
  const injected: Array<{ step: string; param: string; from: string; plugin: string }> = [];
  if (!Array.isArray(steps) || !inputValues || typeof inputValues !== 'object') return injected;

  // Pre-parse the step-tagged (namespaced) keys that carry a value.
  const namespaced = Object.keys(inputValues)
    .map(key => {
      const parsed = parseNamespacedKey(key);
      return parsed ? { key, plugin: parsed.plugin, param: parsed.param } : null;
    })
    .filter((x): x is { key: string; plugin: string; param: string } =>
      x !== null && !isEmpty(inputValues[x.key])
    );

  if (namespaced.length === 0) return injected;

  forEachPluginStep(steps, (step) => {
    const plugin: string = step.plugin;
    const action: string = step.action;

    const schemaParams = resolveActionParams(plugin, action);
    if (!schemaParams || schemaParams.length === 0) return; // unknown action — don't guess

    const params: Record<string, any> = (step.params && typeof step.params === 'object') ? step.params : {};

    // Candidate values tagged for this plugin (step targeting via the namespaced key).
    const candidates = namespaced.filter(n => n.plugin === plugin);
    if (candidates.length === 0) return;

    // Eligible params: declared by the action schema AND not already bound on the step.
    const unboundParams = schemaParams.filter(p => isEmpty(params[p]));

    for (const param of unboundParams) {
      // A previous injection in this pass may have filled it.
      if (!isEmpty(params[param])) continue;

      const stemMatches = candidates.filter(c => stemOf(c.param) === stemOf(param));
      if (stemMatches.length !== 1) continue; // 0 = no signal, >1 = ambiguous → skip

      const chosen = stemMatches[0];
      // Guard against fanning ONE tagged value across multiple params/steps: once a
      // key has been used, skip it everywhere else. Cross-step consequence: if two
      // same-plugin steps each have a same-stem unbound param and there's a single
      // tagged key, the FIRST-visited step wins and the rest are skipped (rather
      // than mis-routing the value to all). Real workflows have one such step;
      // the namespaced key's `capability` segment would disambiguate further if
      // this ever needs to be exact (deferred — same latent edge as reconcile).
      if (injected.some(i => i.from === chosen.key)) continue;

      params[param] = inputValues[chosen.key];
      step.params = params;
      injected.push({ step: step.id || step.step_id || '?', param, from: chosen.key, plugin });
    }
  });

  if (injected.length > 0) {
    logger.info({ injected }, 'Injected step-tagged inputs into unbound action params (WP-60)');
  }
  return injected;
}
