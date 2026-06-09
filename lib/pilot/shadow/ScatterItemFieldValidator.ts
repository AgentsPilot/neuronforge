/**
 * ScatterItemFieldValidator (Calibration P3 — WP-56 companion)
 *
 * Detects scatter/loop sub-steps that reference a field on the iteration
 * variable that does NOT exist on the iterated collection's element schema, and
 * proposes the correct field (before/after) — WITHOUT silently rewriting the DSL.
 *
 * Motivating bug (agent 8c7caa01): a scatter iterates Drive `list_files` items
 * (which expose `id`) but a sub-step references `{{doc_item.folder_id}}` —
 * `folder_id` is the *folder container's* identifier, not a file field. At
 * runtime the ref resolves to `undefined`, the Docs `document_id` defaults to
 * "", and the API 400s on every item. The runtime `StructuralRepairEngine`
 * detects the broken ref but can only WARN — it has no schema for the iteration
 * variable, so it can't suggest a correction (WP-2 reconciliation is scoped to
 * step *output* schemas, not scatter/loop iteration variables).
 *
 * This validator closes that gap on the CALIBRATION side only:
 *   1. For each scatter-gather step, resolve the iterated collection's element
 *      fields from the source step's `output_schema` (schema-driven, plugin-
 *      agnostic — no hardcoded plugin/field names).
 *   2. Flag any `{{itemVariable.field}}` ref whose first field segment is absent
 *      from the element schema.
 *   3. Suggest the best replacement field — identifier-aware (an `*_id`/`id`-
 *      shaped broken field maps to the element's identifier field) then
 *      Levenshtein — and emit a surfaced before/after proposal.
 *
 * It is intentionally NOT wired into the runtime `StructuralRepairEngine`: that
 * engine can auto-apply, and silent field-ref rewrites are the WP-40 hazard. A
 * proposal the user confirms is the safe contract here.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ScatterItemFieldValidator', service: 'shadow-agent' });

export interface ScatterItemFieldIssue {
  /** The scatter-gather step that owns the iteration. */
  scatterStepId: string;
  /** The sub-step whose params contain the broken ref. */
  subStepId: string;
  /** The iteration variable name (e.g. "doc_item"). */
  itemVariable: string;
  /** The variable the scatter iterates over (e.g. "contract_docs"). */
  sourceVariable: string;
  /** The field that does not exist on the element schema (e.g. "folder_id"). */
  brokenField: string;
  /** The suggested replacement field (e.g. "id"). */
  suggestedField: string;
  /** Canonical before token, e.g. "{{doc_item.folder_id}}". */
  oldToken: string;
  /** Canonical after token, e.g. "{{doc_item.id}}". */
  newToken: string;
  /** 0–1 confidence in the suggestion. */
  confidence: number;
  /** Element fields that DO exist (for the user-facing message). */
  availableFields: string[];
}

/**
 * Resolves the authoritative `output_schema` for a plugin action (the plugin
 * definition — the source of truth). Injected by the caller so the validator
 * stays pure/testable and has no hard dependency on the plugin manager.
 */
export type ActionOutputSchemaResolver = (plugin: string, action: string) => any | null | undefined;

export class ScatterItemFieldValidator {
  /**
   * @param resolveActionSchema Optional resolver returning a plugin action's
   *   authoritative `output_schema`. When provided, it takes precedence over the
   *   step's STORED `output_schema` — which can be mutated (the WP-56 `id` →
   *   `folder_id` case, where the stored schema agreed with the wrong reference
   *   and hid the bug). Falls back to the stored schema when the resolver yields
   *   nothing (e.g. the scatter source is a transform, not a plugin action).
   */
  constructor(private readonly resolveActionSchema?: ActionOutputSchemaResolver) {}

  /**
   * @param steps Compiled DSL steps (agent.pilot_steps / workflow_steps).
   */
  validate(steps: any[]): ScatterItemFieldIssue[] {
    const issues: ScatterItemFieldIssue[] = [];
    if (!Array.isArray(steps)) return issues;

    // Index every step (including nested) by its output_variable so a scatter's
    // `scatter.input` can be resolved back to the producing step's schema.
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
        if (s?.type === 'scatter_gather') {
          this.checkScatter(s, byOutputVar, issues);
          if (Array.isArray(s.scatter?.steps)) visit(s.scatter.steps); // nested scatters
        }
      }
    };
    visit(steps);

    if (issues.length > 0) {
      logger.info({ issueCount: issues.length, issues: issues.map(i => i.oldToken) },
        '[ScatterItemField] Detected scatter item-ref field mismatches');
    }
    return issues;
  }

  private checkScatter(scatterStep: any, byOutputVar: Map<string, any>, issues: ScatterItemFieldIssue[]): void {
    const itemVar: string | undefined = scatterStep.gather?.itemVariable || scatterStep.scatter?.itemVariable;
    const inputRef: unknown = scatterStep.scatter?.input;
    if (!itemVar || typeof inputRef !== 'string') return;

    const resolved = this.resolveElementFields(inputRef, byOutputVar);
    if (!resolved) return; // source/path/schema not resolvable → cannot validate safely
    const { sourceVariable, elementFields } = resolved;
    if (elementFields.size === 0) return;

    const scatterStepId = scatterStep.step_id || scatterStep.id || 'unknown';
    const subSteps: any[] = scatterStep.scatter?.steps || [];

    for (const sub of subSteps) {
      const paramsStr = JSON.stringify(sub?.params ?? sub?.config ?? {});
      // {{ itemVar.field ... }} — capture the root var and the FIRST field segment.
      const regex = /\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)[^}]*\}\}/g;
      const flagged = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = regex.exec(paramsStr)) !== null) {
        const root = m[1];
        const firstField = m[2];
        if (root !== itemVar) continue;            // only the iteration variable
        if (elementFields.has(firstField)) continue; // field exists → fine
        if (flagged.has(firstField)) continue;     // dedupe per sub-step
        flagged.add(firstField);

        const suggestion = this.suggestField(firstField, [...elementFields]);
        if (!suggestion) continue; // only surface confident proposals — avoid noise

        issues.push({
          scatterStepId,
          subStepId: sub.step_id || sub.id || 'unknown',
          itemVariable: itemVar,
          sourceVariable,
          brokenField: firstField,
          suggestedField: suggestion.field,
          oldToken: `{{${itemVar}.${firstField}}}`,
          newToken: `{{${itemVar}.${suggestion.field}}}`,
          confidence: suggestion.confidence,
          availableFields: [...elementFields],
        });
      }
    }
  }

  /**
   * Resolve `{{sourceVar.path...}}` to the element field names of the iterated
   * array, by walking the producing step's `output_schema` to the array's
   * `items.properties`. Returns null if anything is unresolvable (we never guess
   * when the schema can't confirm the element shape).
   */
  private resolveElementFields(
    inputRef: string,
    byOutputVar: Map<string, any>
  ): { sourceVariable: string; elementFields: Set<string> } | null {
    const m = inputRef.match(/^\{\{\s*([A-Za-z0-9_]+)((?:\.[A-Za-z0-9_]+)*)\s*\}\}$/);
    if (!m) return null;
    const sourceVariable = m[1];
    const path = m[2] ? m[2].split('.').filter(Boolean) : [];

    const srcStep = byOutputVar.get(sourceVariable);
    if (!srcStep) return null;

    // Candidate schemas in priority order: the plugin definition (source of
    // truth) first, then the step's stored output_schema. The plugin def wins
    // because a stored schema can be mutated to agree with a wrong reference
    // (WP-56), which would otherwise hide the bug from a schema comparison.
    const candidates: any[] = [];
    if (this.resolveActionSchema && srcStep.plugin && srcStep.action) {
      try {
        const authoritative = this.resolveActionSchema(srcStep.plugin, srcStep.action);
        if (authoritative) candidates.push(authoritative);
      } catch {
        /* resolver failure is non-fatal — fall back to the stored schema */
      }
    }
    if (srcStep.output_schema) candidates.push(srcStep.output_schema);

    for (const schema of candidates) {
      let node: any = schema;
      let resolvable = true;
      for (const seg of path) {
        const next = node?.properties?.[seg];
        if (!next) { resolvable = false; break; }
        node = next;
      }
      // The iterated node must be an array of objects with a known item shape.
      if (resolvable && node?.type === 'array' && node.items?.properties && typeof node.items.properties === 'object') {
        return { sourceVariable, elementFields: new Set(Object.keys(node.items.properties)) };
      }
    }
    return null;
  }

  /**
   * Suggest the best element field for a broken field name. Identifier-aware
   * first (an id-shaped broken field maps to the element's identifier field),
   * then small-distance Levenshtein. Plugin-agnostic. Returns null when there is
   * no confident match — better to surface nothing than a wrong rewrite.
   */
  private suggestField(
    brokenField: string,
    elementFields: string[]
  ): { field: string; confidence: number } | null {
    const isIdentifierLike =
      brokenField.toLowerCase() === 'id' ||
      brokenField.toLowerCase().endsWith('_id') ||
      /[A-Za-z]Id$/.test(brokenField);

    if (isIdentifierLike) {
      const idField =
        elementFields.find(f => f.toLowerCase() === 'id') ||
        elementFields.find(f => f.toLowerCase().endsWith('_id') || /[A-Za-z]Id$/.test(f));
      if (idField) return { field: idField, confidence: 0.9 };
    }

    let best: string | null = null;
    let bestDistance = Infinity;
    const bl = brokenField.toLowerCase();
    for (const f of elementFields) {
      const d = this.levenshtein(bl, f.toLowerCase());
      if (d < bestDistance && d <= 3) {
        bestDistance = d;
        best = f;
      }
    }
    if (best) return { field: best, confidence: bestDistance <= 1 ? 0.85 : 0.65 };
    return null;
  }

  /**
   * Apply a detected issue's fix to the DSL in place: rewrite the exact template
   * token (e.g. `{{doc_item.folder_id}}` → `{{doc_item.id}}`) in the offending
   * sub-step's params. Targeted exact-token replacement — no fuzzy rewriting.
   * Returns true if something changed. Caller decides whether to apply (we only
   * auto-apply high-confidence issues; lower-confidence ones stay surfaced).
   */
  static applyFix(steps: any[], issue: ScatterItemFieldIssue): boolean {
    if (!Array.isArray(steps)) return false;

    const findSubStep = (arr: any[]): any => {
      for (const s of arr || []) {
        if (s?.type === 'scatter_gather') {
          for (const sub of s.scatter?.steps || []) {
            if ((sub?.step_id || sub?.id) === issue.subStepId) return sub;
          }
          const nested = findSubStep(s.scatter?.steps || []);
          if (nested) return nested;
        }
      }
      return null;
    };

    const sub = findSubStep(steps);
    if (!sub) return false;

    const useParams = sub.params != null;
    const target = useParams ? sub.params : sub.config;
    if (target == null) return false;

    const before = JSON.stringify(target);
    const after = before.split(issue.oldToken).join(issue.newToken);
    if (after === before) return false; // token not present — nothing to do

    const parsed = JSON.parse(after);
    if (useParams) sub.params = parsed;
    else sub.config = parsed;
    return true;
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        matrix[i][j] =
          b.charAt(i - 1) === a.charAt(j - 1)
            ? matrix[i - 1][j - 1]
            : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
    return matrix[b.length][a.length];
  }
}
