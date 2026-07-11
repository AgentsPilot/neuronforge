/**
 * PluginFieldFidelityValidator (Calibration — Item 5b + calibration-side of Item 3)
 *
 * The calibration-side plugin-truth oracle. For every transform step whose input
 * traces to a plugin action, it compares the transform's DECLARED item field
 * names against the producing plugin action's REAL `output_schema` (the source of
 * truth) using the shared Phase 0 reconciliation core. A clearly-same-field
 * spelling divergence (e.g. a `flatten` declaring `mime_type` while the Gmail
 * `search_emails` producer emits `mimeType`) is surfaced as a BLOCKING-class
 * issue (G1a) — it can never be waved through to a passing verdict.
 *
 * This is the calibration twin of the compiler-side Gap C gate (Phase 3). Both
 * reuse the SAME reconciliation core (requirement §Cross-Cutting Constraints #5 —
 * "one comparator, two call sites"); this class adds ZERO reconciliation logic of
 * its own — it only resolves producer schemas and shapes the result into issues.
 *
 * Schema-driven and generic: no plugin names, no hardcoded fields. It reads the
 * producing action's declared schema; the divergence detection is entirely the
 * core's job.
 */

import { createLogger } from '@/lib/logger';
import { reconcileFields, type FieldRename } from '@/lib/schema-reconciliation';

const logger = createLogger({ module: 'PluginFieldFidelityValidator', service: 'shadow-agent' });

/**
 * Resolves the authoritative `output_schema` for a plugin action (the plugin
 * definition — the source of truth). Injected so the validator stays pure and
 * has no hard dependency on the plugin manager. Same contract as
 * ScatterItemFieldValidator's resolver.
 */
export type ActionOutputSchemaResolver = (plugin: string, action: string) => any | null | undefined;

export interface PluginFieldFidelityIssue {
  /** The transform step whose declared schema diverges from the plugin producer. */
  stepId: string;
  /** The declared (wrong) field name, e.g. "mime_type". */
  declaredField: string;
  /** The producer's real field name, e.g. "mimeType". */
  realField: string;
  /** The producing plugin key, e.g. "google-mail". */
  plugin: string;
  /** The producing action name, e.g. "search_emails". */
  action: string;
  /** The upstream variable the transform consumes (root of its input). */
  sourceVariable: string;
  /**
   * Always true — a plugin-field-fidelity mismatch is blocking-class (G1a) and
   * must not be downgradeable to cosmetic/medium/user-confirm-only.
   */
  blocking: true;
}

/** Extract `{ plugin, action }` from a step that references a plugin action. */
function resolvePluginAction(step: any): { plugin: string; action: string } | null {
  if (!step) return null;
  if (typeof step.plugin === 'string' && typeof step.action === 'string' && step.plugin && !step.action.includes('.')) {
    return { plugin: step.plugin, action: step.action };
  }
  // Dotted form: action = "google-mail.search_emails".
  if (typeof step.action === 'string' && step.action.includes('.')) {
    const dot = step.action.indexOf('.');
    return { plugin: step.action.slice(0, dot), action: step.action.slice(dot + 1) };
  }
  if (typeof step.plugin === 'string' && typeof step.action === 'string' && step.plugin && step.action) {
    return { plugin: step.plugin, action: step.action };
  }
  return null;
}

/** The transform's declared item field names (from its output_schema.items.properties). */
function declaredItemFields(step: any): string[] {
  const schema = step?.config?.output_schema ?? step?.output_schema ?? step?.transform?.output_schema;
  if (!schema || typeof schema !== 'object') return [];
  // Prefer array-item properties; fall back to top-level properties.
  const itemProps = schema.items?.properties ?? (schema.type === 'array' ? undefined : schema.properties);
  if (itemProps && typeof itemProps === 'object') return Object.keys(itemProps);
  if (schema.properties && typeof schema.properties === 'object') return Object.keys(schema.properties);
  return [];
}

/** The transform's input reference (may be `{{var.path}}` or a bare `var.path`). */
function transformInputRef(step: any): string | null {
  const raw = step?.config?.input ?? step?.transform?.input ?? step?.input;
  return typeof raw === 'string' ? raw : null;
}

/** Root variable name of an input reference (`{{expense_emails.emails}}` → `expense_emails`). */
function rootVariable(inputRef: string): string | null {
  const templated = inputRef.match(/^\{\{\s*([A-Za-z0-9_]+)/);
  if (templated) return templated[1];
  const bare = inputRef.match(/^([A-Za-z0-9_]+)/);
  return bare ? bare[1] : null;
}

export class PluginFieldFidelityValidator {
  constructor(private readonly resolveActionSchema: ActionOutputSchemaResolver) {}

  /**
   * @param steps Compiled DSL steps (agent.pilot_steps / workflow_steps).
   * @returns One issue per clearly-same-field divergence between a transform's
   *   declared item fields and its producing plugin action's real fields.
   */
  validate(steps: any[]): PluginFieldFidelityIssue[] {
    const issues: PluginFieldFidelityIssue[] = [];
    if (!Array.isArray(steps)) return issues;

    // Index every step (including nested) by output_variable so a transform's
    // input can be resolved back to its producing step.
    const byOutputVar = new Map<string, any>();
    const indexAll = (arr: any[]) => {
      for (const s of arr || []) {
        if (s?.output_variable) byOutputVar.set(s.output_variable, s);
        if (s?.type === 'scatter_gather' && Array.isArray(s.scatter?.steps)) indexAll(s.scatter.steps);
      }
    };
    indexAll(steps);

    const visit = (arr: any[]) => {
      for (const s of arr || []) {
        if (s?.type === 'transform') this.checkTransform(s, byOutputVar, issues);
        if (s?.type === 'scatter_gather' && Array.isArray(s.scatter?.steps)) visit(s.scatter.steps);
      }
    };
    visit(steps);

    if (issues.length > 0) {
      logger.warn(
        { issueCount: issues.length, mismatches: issues.map(i => `${i.stepId}:${i.declaredField}→${i.realField}`) },
        '[PluginFieldFidelity] Blocking plugin-field-fidelity mismatches detected'
      );
    }
    return issues;
  }

  /**
   * Compute the clearly-same-field renames for a transform vs its plugin
   * producer, without shaping them into issues. Used by the Item 7 corrector so
   * detection and correction share one code path (constraint #5).
   */
  computeRenames(step: any, byOutputVar: Map<string, any>): {
    plugin: string;
    action: string;
    sourceVariable: string;
    renames: FieldRename[];
  } | null {
    const declared = declaredItemFields(step);
    if (declared.length === 0) return null;

    const inputRef = transformInputRef(step);
    if (!inputRef) return null;
    const sourceVariable = rootVariable(inputRef);
    if (!sourceVariable) return null;

    const producerStep = byOutputVar.get(sourceVariable);
    if (!producerStep) return null;

    const pluginAction = resolvePluginAction(producerStep);
    if (!pluginAction) return null; // producer is not a plugin action (e.g. another transform) → out of single-hop scope

    let realSchema: any;
    try {
      realSchema = this.resolveActionSchema(pluginAction.plugin, pluginAction.action);
    } catch (err) {
      logger.debug({ err, plugin: pluginAction.plugin, action: pluginAction.action }, '[PluginFieldFidelity] resolver failed');
      return null;
    }
    if (!realSchema) return null;

    const result = reconcileFields(declared, realSchema);
    if (!result.hasRenames) return null;

    return { plugin: pluginAction.plugin, action: pluginAction.action, sourceVariable, renames: result.renames };
  }

  private checkTransform(step: any, byOutputVar: Map<string, any>, issues: PluginFieldFidelityIssue[]): void {
    const computed = this.computeRenames(step, byOutputVar);
    if (!computed) return;
    const stepId = step.step_id || step.id || 'unknown';
    for (const rename of computed.renames) {
      issues.push({
        stepId,
        declaredField: rename.from,
        realField: rename.to,
        plugin: computed.plugin,
        action: computed.action,
        sourceVariable: computed.sourceVariable,
        blocking: true,
      });
    }
  }
}
