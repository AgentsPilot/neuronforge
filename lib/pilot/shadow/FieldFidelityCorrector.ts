/**
 * FieldFidelityCorrector (Calibration — Item 7, in-place backfill for existing agents)
 *
 * CORRECTS (not merely detects) a declared-vs-plugin field-name mismatch by
 * deterministically rewriting a stored workflow's wrong field name to the
 * plugin's real spelling during calibration. This repairs already-saved broken
 * agents in place on re-calibration, without regeneration — closing the
 * backwards-compat gap that the generation/compiler fixes (Phase 3) leave open.
 *
 * It is "a fourth call site into the shared reconciliation core plus persistence
 * + re-verify wiring, not new reconciliation logic" (requirement §Item 7): it
 * reuses PluginFieldFidelityValidator.computeRenames (which reuses the Phase 0
 * core) to decide WHAT to rewrite, then applies the rewrite across the data-flow
 * chain that consumes the transform's output.
 *
 * G1 safety conditions honoured (the corrector's own two):
 *   1. Deterministic, provably-correct rename — only clearly-same-field spellings
 *      from the core's `renames` (ambiguous/derived are never in that list).
 *   2. Every correction is returned for audit + surfacing; the caller snapshots
 *      pilot_steps before applying (reversibility) and caps the verdict at
 *      `corrected_not_verified` when the re-run does not exercise the real path.
 *
 * Generic — no plugin names, no hardcoded fields.
 */

import { createLogger } from '@/lib/logger';
import {
  PluginFieldFidelityValidator,
  type ActionOutputSchemaResolver,
} from '@/lib/pilot/shadow/PluginFieldFidelityValidator';

const logger = createLogger({ module: 'FieldFidelityCorrector', service: 'shadow-agent' });

export interface FieldCorrection {
  /** The transform step whose declared schema originated the mismatch. */
  stepId: string;
  /** Wrong declared spelling (e.g. "mime_type"). */
  from: string;
  /** Plugin-real spelling it was rewritten to (e.g. "mimeType"). */
  to: string;
  plugin: string;
  action: string;
  /** The transform's output variable (root of the corrected data-flow chain). */
  outputVariable: string;
  /** Human-readable list of what was rewritten (schema keys, conditions, refs). */
  locations: string[];
}

export interface CorrectionResult {
  /** A deep clone of the input steps with all corrections applied. */
  correctedSteps: any[];
  corrections: FieldCorrection[];
  changed: boolean;
}

/** Index every step (including nested) by output_variable. */
function indexByOutputVar(steps: any[]): Map<string, any> {
  const map = new Map<string, any>();
  const walk = (arr: any[]) => {
    for (const s of arr || []) {
      if (s?.output_variable) map.set(s.output_variable, s);
      if (s?.type === 'scatter_gather' && Array.isArray(s.scatter?.steps)) walk(s.scatter.steps);
    }
  };
  walk(steps);
  return map;
}

/** Root variables referenced via `{{var...}}` anywhere inside a JSON node. */
function collectReferencedVars(node: unknown, into: Set<string>): void {
  if (typeof node === 'string') {
    const re = /\{\{\s*([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node)) !== null) into.add(m[1]);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectReferencedVars(v, into);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) collectReferencedVars(v, into);
  }
}

/** Flat list of all steps (including nested scatter bodies). */
function flatten(steps: any[]): any[] {
  const out: any[] = [];
  const walk = (arr: any[]) => {
    for (const s of arr || []) {
      out.push(s);
      if (s?.type === 'scatter_gather' && Array.isArray(s.scatter?.steps)) walk(s.scatter.steps);
    }
  };
  walk(steps);
  return out;
}

export class FieldFidelityCorrector {
  private readonly validator: PluginFieldFidelityValidator;

  constructor(private readonly resolveActionSchema: ActionOutputSchemaResolver) {
    this.validator = new PluginFieldFidelityValidator(resolveActionSchema);
  }

  /**
   * Compute and apply in-place field-name corrections to a copy of `steps`.
   * Never mutates the input array.
   */
  correct(steps: any[]): CorrectionResult {
    if (!Array.isArray(steps) || steps.length === 0) {
      return { correctedSteps: steps, corrections: [], changed: false };
    }

    const cloned: any[] = JSON.parse(JSON.stringify(steps));
    const byOutputVar = indexByOutputVar(cloned);
    const allSteps = flatten(cloned);
    const corrections: FieldCorrection[] = [];

    for (const step of allSteps) {
      if (step?.type !== 'transform') continue;
      const computed = this.validator.computeRenames(step, byOutputVar);
      if (!computed || computed.renames.length === 0) continue;

      const outputVariable: string | undefined = step.output_variable;
      if (!outputVariable) continue;

      // Build the from→to map for this transform, and the closure of variables
      // that carry the corrected item shape downstream (the transform output +
      // transitive consumers' outputs + scatter loop variables in the chain).
      const fromTo = new Map<string, string>();
      for (const r of computed.renames) fromTo.set(r.from, r.to);
      const closure = this.buildConsumerClosure(outputVariable, allSteps);

      const stepId = step.step_id || step.id || 'unknown';
      for (const [from, to] of fromTo) {
        const locations: string[] = [];

        // 1. Rewrite the transform's OWN declared item-schema keys.
        if (this.renameSchemaKeys(step, from, to)) locations.push(`${stepId}.output_schema`);

        // 2/3. Rewrite downstream condition.field literals + {{closureVar.from}} refs.
        for (const consumer of allSteps) {
          const cId = consumer.step_id || consumer.id || 'unknown';
          if (this.renameConditionFields(consumer, from, to, closure, cId, locations)) { /* recorded inside */ }
          if (this.renameTemplateRefs(consumer, from, to, closure, cId, locations)) { /* recorded inside */ }
          // Also propagate the corrected key into a consumer's own declared schema
          // when the consumer re-declares the same (shape-preserving) item field.
          if (closure.has(consumer.output_variable) && this.renameSchemaKeys(consumer, from, to)) {
            locations.push(`${cId}.output_schema`);
          }
        }

        corrections.push({
          stepId,
          from,
          to,
          plugin: computed.plugin,
          action: computed.action,
          outputVariable,
          locations,
        });
      }
    }

    if (corrections.length > 0) {
      logger.info(
        { correctionCount: corrections.length, corrections: corrections.map(c => `${c.stepId}:${c.from}→${c.to}`) },
        '[FieldFidelityCorrector] Applied in-place field-fidelity corrections'
      );
    }

    return { correctedSteps: cloned, corrections, changed: corrections.length > 0 };
  }

  /** BFS closure of variables carrying the transform's item shape downstream. */
  private buildConsumerClosure(rootVar: string, allSteps: any[]): Set<string> {
    const closure = new Set<string>([rootVar]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const step of allSteps) {
        const refs = new Set<string>();
        collectReferencedVars(step.config ?? step, refs);
        collectReferencedVars(step.scatter ?? {}, refs);
        collectReferencedVars(step.params ?? {}, refs);
        const consumesClosure = [...refs].some(v => closure.has(v));
        if (!consumesClosure) continue;
        // This step consumes a closure variable → its output carries the shape.
        if (step.output_variable && !closure.has(step.output_variable)) {
          closure.add(step.output_variable);
          grew = true;
        }
        // A scatter iterating a closure variable introduces its loop variable.
        if (step.type === 'scatter_gather') {
          const itemVar = step.gather?.itemVariable ?? step.scatter?.itemVariable;
          const scatterInputRefs = new Set<string>();
          collectReferencedVars(step.scatter?.input ?? '', scatterInputRefs);
          if (itemVar && [...scatterInputRefs].some(v => closure.has(v)) && !closure.has(itemVar)) {
            closure.add(itemVar);
            grew = true;
          }
        }
      }
    }
    return closure;
  }

  /** Rename a key in a step's declared output_schema item properties. Returns true if changed. */
  private renameSchemaKeys(step: any, from: string, to: string): boolean {
    const schema = step?.config?.output_schema ?? step?.output_schema ?? step?.transform?.output_schema;
    if (!schema || typeof schema !== 'object') return false;
    const props = schema.items?.properties ?? schema.properties;
    if (!props || typeof props !== 'object' || !(from in props) || from === to) return false;
    // Preserve key order while renaming from→to.
    const rebuilt: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) rebuilt[k === from ? to : k] = v;
    if (schema.items?.properties) schema.items.properties = rebuilt;
    else schema.properties = rebuilt;
    return true;
  }

  /**
   * Rewrite `condition.field` literals (in filter/comparison conditions) that
   * equal `from`, on steps within the corrected chain.
   */
  private renameConditionFields(
    step: any,
    from: string,
    to: string,
    closure: Set<string>,
    stepId: string,
    locations: string[]
  ): boolean {
    // Only touch steps whose input traces to the corrected chain.
    const refs = new Set<string>();
    collectReferencedVars(step.config ?? step, refs);
    if (![...refs].some(v => closure.has(v))) return false;

    let changed = false;
    const rewriteCondition = (cond: any) => {
      if (!cond || typeof cond !== 'object') return;
      if (typeof cond.field === 'string' && cond.field === from && 'operator' in cond) {
        cond.field = to;
        changed = true;
      }
      // Nested boolean groups (and/or arrays of conditions).
      for (const key of ['conditions', 'and', 'or', 'all', 'any']) {
        if (Array.isArray(cond[key])) for (const sub of cond[key]) rewriteCondition(sub);
      }
    };
    rewriteCondition(step.config?.condition);
    rewriteCondition(step.condition);
    if (changed) locations.push(`${stepId}.condition.field`);
    return changed;
  }

  /** Rewrite `{{closureVar.from...}}` templated refs to `{{closureVar.to...}}`. */
  private renameTemplateRefs(
    step: any,
    from: string,
    to: string,
    closure: Set<string>,
    stepId: string,
    locations: string[]
  ): boolean {
    let changed = false;
    const rewriteString = (s: string): string => {
      // Match {{ var.field ... }} where var ∈ closure and the FIRST field === from.
      return s.replace(/\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g, (full, v, f) => {
        if (closure.has(v) && f === from) {
          changed = true;
          return full.replace(new RegExp(`\\.${from}(?![A-Za-z0-9_])`), `.${to}`);
        }
        return full;
      });
    };
    const walk = (node: any): any => {
      if (typeof node === 'string') return rewriteString(node);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) node[k] = walk(node[k]);
        return node;
      }
      return node;
    };
    if (step.config) walk(step.config);
    if (step.params) walk(step.params);
    if (step.scatter) walk(step.scatter);
    if (changed) locations.push(`${stepId}.refs`);
    return changed;
  }
}
