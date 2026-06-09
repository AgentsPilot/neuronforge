/**
 * User-Facing Issue Translator
 *
 * AgentPilot serves non-technical users. Raw issue objects produced by the
 * runtime, validators, and detectors are full of jargon — step IDs, variable
 * paths, schema validation strings, error codes — that mean nothing to a
 * non-technical user.
 *
 * This module is the **single boundary** between technical issue objects and
 * the user-visible UI payload. Every issue returned by the calibration
 * batch route (and any other user-facing endpoint) MUST pass through
 * `toUserFacing()` before being serialized into the API response.
 *
 * Output rules:
 *   • `title`      — one short clause the user can grok at a glance.
 *   • `message`    — 1–2 sentences in plain English. No jargon, no IDs.
 *   • `what_to_do` — actionable next step (when one exists).
 *   • `severity`   — three buckets the UI maps to red/amber/blue chips.
 *   • `_technical` — the original raw object, hidden behind a debug toggle.
 *
 * @module lib/pilot/shadow/userFacing
 */

import { getFriendlyPluginName } from './friendlyLanguage';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** The three user-facing severity tiers. */
export type UserSeverity = 'must_fix' | 'will_auto_fix' | 'heads_up';

/**
 * Unified user-facing issue. The UI only ever reads these top-level fields;
 * `_technical` is available for support / debug toggles but never shown by
 * default.
 */
export interface UserFacingIssue {
  /** Short clause for the issue card title (≤ 60 chars typical). */
  title: string;
  /** 1–2 sentence plain-English explanation. */
  message: string;
  /** Optional concrete next action the user can take. */
  what_to_do?: string;
  /** Tier the UI uses to decide chip colour. */
  severity: UserSeverity;
  /** Where the issue came from (analytics / grouping; not user-shown). */
  category:
    | 'data_flow'
    | 'data_quality'
    | 'workflow_structure'
    | 'configuration'
    | 'connection'
    | 'auto_repaired'
    | 'review_needed'
    | 'system';
  /** Optional: the human-friendly step name the issue concerns. */
  step_name?: string;
  /** Raw payload. Surfaced only via debug toggle / support tools. */
  _technical: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────
// Severity mapping
// ─────────────────────────────────────────────────────────────────────────

function mapSeverity(raw: any): UserSeverity {
  const v = String(raw?.severity ?? raw?.priority ?? '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'error' || v === 'must_fix') {
    return 'must_fix';
  }
  if (v === 'auto_fix' || v === 'will_auto_fix' || raw?.auto_fixable === true) {
    return 'will_auto_fix';
  }
  return 'heads_up';
}

// ─────────────────────────────────────────────────────────────────────────
// Per-source translators
// ─────────────────────────────────────────────────────────────────────────

/**
 * Field-reference issues from `WorkflowValidator.validateFieldReferences`
 * and `validateOperationFields` (Phase 6 Tier 1 Fix #1).
 *
 * Raw shape (from the validator's pushed message strings):
 *   "Step 'step5' references '{{step1.EMAIL}}' at parameter 'params.text'
 *    — Field 'EMAIL' not found in step1 output. Available fields: …
 *    Suggested fix: '{{step1.email}}' (confidence 95%)."
 */
function translateFieldReferenceMessage(raw: string): UserFacingIssue | null {
  // Match the pattern we emit in WorkflowValidator.formatFieldValidationIssue
  const m = raw.match(
    /Step '([^']+)' references '([^']+)' at parameter '([^']+)' — (.+?)\. Suggested fix: '([^']+)' \(confidence (\d+)%\)/,
  );
  if (!m) return null;
  const [, stepId, badRef, , reason, suggested] = m;
  const friendlyStep = humanizeStepIdentifier(stepId);

  return {
    title: 'A field name looks wrong',
    message:
      `In "${friendlyStep}", we're trying to read ${prettifyRef(badRef)} ` +
      `but that field isn't produced by the previous step. ` +
      `It looks like you might mean ${prettifyRef(suggested)}.`,
    what_to_do: `We can apply this fix automatically. Confirm in the workflow editor.`,
    severity: 'must_fix',
    category: 'data_flow',
    step_name: friendlyStep,
    _technical: { source: 'field_reference', raw, suggested, stepId },
  };
}

/** Dry-run validator issues (Layer 3). */
function translateDryRunIssue(issue: any): UserFacingIssue {
  const type = issue?.type as string | undefined;
  const desc = String(issue?.description ?? '');

  if (type === 'empty_result') {
    return {
      title: 'The workflow returned nothing',
      message:
        `When we ran the workflow with your real data, it didn't produce any results. ` +
        `This often means we couldn't find data in the right format — for example, ` +
        `we asked for a list but got a single record back.`,
      what_to_do: 'Check that your data source has data, and that the first step is reading the right place.',
      severity: 'must_fix',
      category: 'data_quality',
      _technical: { source: 'dry_run', ...issue },
    };
  }

  if (type === 'execution_failed' || type === 'steps_failed') {
    return {
      title: 'The workflow couldn\'t finish',
      message:
        `When we tested with your real data, one or more steps couldn't complete. ` +
        `${desc ? `Detail: ${oneLine(desc)}` : ''}`.trim(),
      what_to_do: 'Open the workflow editor — we\'ll highlight the step that needs your attention.',
      severity: 'must_fix',
      category: 'data_flow',
      _technical: { source: 'dry_run', ...issue },
    };
  }

  return {
    title: 'We hit an issue during testing',
    message: oneLine(desc) || 'Something unexpected happened when we tested the workflow with your real data.',
    severity: 'must_fix',
    category: 'data_quality',
    _technical: { source: 'dry_run', ...issue },
  };
}

/** Calibration loop non-convergence (G-CAL-3). */
function translateNonConvergence(issue: any): UserFacingIssue {
  return {
    title: 'Some issues need your attention',
    message:
      'We tried to fix everything automatically, but a few issues still need your input. ' +
      'Review the items below and we\'ll guide you through them.',
    what_to_do: 'Go through the remaining items one by one — most take seconds to resolve.',
    severity: 'heads_up',
    category: 'review_needed',
    _technical: { source: 'calibration_loop', ...issue },
  };
}

/** Structural validator issues — prefixed `[structural]`. */
function translateStructuralMessage(raw: string): UserFacingIssue {
  // Strip the `[structural]` prefix and the path tokens like "workflow_steps[0]:"
  const cleaned = raw
    .replace(/^\[structural\]\s*/, '')
    .replace(/workflow_steps\[\d+\]:?\s*/g, '')
    .trim();

  // Common patterns we can recognize:
  if (/loop step missing required field "iterateOver"/i.test(cleaned)) {
    return {
      title: 'A loop is missing its data source',
      message: 'One of the steps is set up as a loop, but we don\'t know what to loop over.',
      what_to_do: 'Tell us which list of items the loop should process.',
      severity: 'must_fix',
      category: 'workflow_structure',
      _technical: { source: 'structural', raw },
    };
  }
  if (/scatter-gather step missing.*"gather"/i.test(cleaned)) {
    return {
      title: 'A parallel step needs a combining rule',
      message: 'One step processes items in parallel but we haven\'t set how to combine the results.',
      what_to_do: 'Choose how to combine the parallel results (collect, merge, etc.).',
      severity: 'must_fix',
      category: 'workflow_structure',
      _technical: { source: 'structural', raw },
    };
  }
  if (/missing required field "condition"/i.test(cleaned)) {
    return {
      title: 'A decision step has no question to answer',
      message: 'One step is supposed to decide between paths, but no decision rule is set.',
      what_to_do: 'Define what condition the step should check.',
      severity: 'must_fix',
      category: 'workflow_structure',
      _technical: { source: 'structural', raw },
    };
  }
  if (/circular dependency/i.test(cleaned)) {
    return {
      title: 'Two steps depend on each other',
      message: 'A loop has formed in the workflow — two or more steps are waiting for each other.',
      what_to_do: 'Reorder the steps so they form a clear flow from start to finish.',
      severity: 'must_fix',
      category: 'workflow_structure',
      _technical: { source: 'structural', raw },
    };
  }
  // Generic fallback for any other structural error
  return {
    title: 'A step is missing something',
    message:
      'One of the workflow steps is incomplete. We can usually fix this automatically, but this one needs your input.',
    severity: 'must_fix',
    category: 'workflow_structure',
    _technical: { source: 'structural', raw: cleaned },
  };
}

/** Hardcoded-value findings. */
function translateHardcodeIssue(issue: any): UserFacingIssue {
  const fieldLabel = issue?.label || issue?.paramName || 'a value';
  const stepName = friendlyStepFromIssue(issue);
  return {
    title: `${fieldLabel} is set to a fixed value`,
    message:
      `In "${stepName}", ${fieldLabel} is hardcoded. If you want this to be configurable, ` +
      `we can turn it into a workflow input.`,
    what_to_do: 'Choose: keep this fixed, or make it an input you can change per run.',
    severity: 'heads_up',
    category: 'configuration',
    step_name: stepName,
    _technical: { source: 'hardcode', ...issue },
  };
}

/** Action mismatch — wrong action chosen for the intent. */
function translateActionMismatchIssue(issue: any): UserFacingIssue {
  const stepName = friendlyStepFromIssue(issue);
  const pluginFriendly = getFriendlyPluginName(issue?.plugin || issue?.pluginKey || '');
  const suggested = issue?.suggestedAction || issue?.replacementAction;

  return {
    title: 'A step might be doing the wrong thing',
    message:
      `In "${stepName}", we're using a ${pluginFriendly || 'plugin'} action that doesn't quite match the goal. ` +
      (suggested ? `A different action would fit better.` : 'We may need to pick a different action.'),
    what_to_do: suggested
      ? 'We can swap the action automatically — confirm in the workflow editor.'
      : 'Open the workflow editor and choose the right action for this step.',
    severity: 'must_fix',
    category: 'workflow_structure',
    step_name: stepName,
    _technical: { source: 'action_mismatch', ...issue },
  };
}

/** Auto-repair applied (informational — was already fixed). */
function translateAutoRepaired(issue: any): UserFacingIssue {
  const what = issue?.repair_type || issue?.action || issue?.description || 'a small issue';
  return {
    title: 'We fixed something for you',
    message: `We automatically corrected ${humanizeForSentence(what)} so the workflow can run.`,
    severity: 'will_auto_fix',
    category: 'auto_repaired',
    _technical: { source: 'auto_repaired', ...issue },
  };
}

/** Plugin auth / connection issues. */
function translateAuthIssue(issue: any): UserFacingIssue {
  const pluginFriendly = getFriendlyPluginName(issue?.plugin || issue?.pluginKey || '');
  return {
    title: `${pluginFriendly || 'A connected app'} needs to be reconnected`,
    message:
      `We tried to use ${pluginFriendly || 'one of your connected apps'} but the connection isn't working. ` +
      `This usually means the access has expired.`,
    what_to_do: 'Reconnect the app and try again.',
    severity: 'must_fix',
    category: 'connection',
    _technical: { source: 'auth', ...issue },
  };
}

/** Output schema validation failure. */
function translateOutputSchemaIssue(issue: any): UserFacingIssue {
  return {
    title: 'The result doesn\'t look quite right',
    message:
      'The workflow finished, but the final result is missing something we expected — ' +
      'or has something in an unexpected format.',
    what_to_do: 'Review what the workflow is supposed to produce vs. what it actually returned.',
    severity: 'must_fix',
    category: 'data_quality',
    _technical: { source: 'output_schema', ...issue },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry: toUserFacing
// ─────────────────────────────────────────────────────────────────────────

/**
 * Translate ANY raw issue object into a UserFacingIssue. Defensive: never
 * throws, always returns a valid UserFacingIssue (with a generic fallback
 * if the input is unrecognizable). The raw input is preserved under
 * `_technical` so support staff can still inspect it.
 */
/**
 * Scatter/loop item-ref field mismatch (P3 / WP-56 companion). A loop step reads
 * a field that doesn't exist on the iterated items; the detector already computed
 * the correct field and a before/after token.
 */
function translateScatterItemFieldIssue(raw: any): UserFacingIssue {
  const d = raw?.details || {};
  const stepName = friendlyStepFromIssue(raw);
  const source = d.sourceVariable ? `"${d.sourceVariable}"` : 'the list';
  const brokenField = d.brokenField || 'a field';
  const oldToken: string | undefined = d.oldToken;
  const newToken: string | undefined = d.newToken;

  return {
    title: "A field name doesn't exist on these items",
    message:
      oldToken && newToken
        ? `In ${stepName}, each item from ${source} has no "${brokenField}" field, so ${oldToken} comes through empty. Use ${newToken} instead.`
        : oneLine(String(raw?.description ?? '')) || 'A loop step reads a field the items do not have.',
    what_to_do: newToken && oldToken ? `Change ${oldToken} to ${newToken}.` : 'Use a field the items actually have.',
    severity: 'must_fix',
    category: 'data_flow',
    step_name: stepName,
    _technical: { source: 'scatter_item_field', ...raw },
  };
}

export function toUserFacing(raw: any): UserFacingIssue {
  // String inputs: try to recognize known message formats.
  if (typeof raw === 'string') {
    const fieldRefMatch = translateFieldReferenceMessage(raw);
    if (fieldRefMatch) return fieldRefMatch;
    if (raw.startsWith('[structural]')) {
      return translateStructuralMessage(raw);
    }
    return {
      title: 'Heads up',
      message: oneLine(raw) || 'Something needs a closer look.',
      severity: 'heads_up',
      category: 'system',
      _technical: { source: 'string', raw },
    };
  }

  // Null/undefined → safe fallback (should never happen but defensive)
  if (raw == null || typeof raw !== 'object') {
    return {
      title: 'Heads up',
      message: 'Something needs a closer look.',
      severity: 'heads_up',
      category: 'system',
      _technical: { source: 'unknown', raw },
    };
  }

  // Recognize by `source` tag (added by the batch route for known sources)
  const source = raw.source as string | undefined;

  if (source === 'dry_run') return translateDryRunIssue(raw);
  if (source === 'scatter_item_field') return translateScatterItemFieldIssue(raw);
  if (source === 'calibration_loop') return translateNonConvergence(raw);
  if (source === 'hardcode' || raw.type === 'hardcoded_value') return translateHardcodeIssue(raw);
  if (source === 'action_mismatch' || raw.type === 'action_mismatch') return translateActionMismatchIssue(raw);
  if (source === 'auto_repaired' || raw.auto_fixed === true || raw.auto_fix_applied === true) {
    return translateAutoRepaired(raw);
  }
  if (source === 'auth' || /auth/i.test(String(raw.type ?? ''))) return translateAuthIssue(raw);
  if (source === 'output_schema' || /output.*schema|schema.*output/i.test(String(raw.description ?? raw.message ?? ''))) {
    return translateOutputSchemaIssue(raw);
  }

  // Description-based fallback recognition (issues from older sources)
  const desc = String(raw.description ?? raw.message ?? raw.error ?? '');
  const fieldRef = translateFieldReferenceMessage(desc);
  if (fieldRef) return fieldRef;
  if (desc.startsWith('[structural]')) return translateStructuralMessage(desc);

  // Generic fallback — preserve as much as we can without leaking tech-speak.
  return {
    title: 'Heads up',
    message: oneLine(desc) || 'Something in the workflow needs a closer look.',
    severity: mapSeverity(raw),
    category: 'system',
    step_name: friendlyStepFromIssue(raw),
    _technical: { source: source || 'unknown', ...raw },
  };
}

/**
 * Translate an entire list of raw issues. Convenience for the API boundary.
 */
export function toUserFacingList(issues: any[]): UserFacingIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map(toUserFacing);
}

// ─────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────

function oneLine(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Take a step id like "step5" and produce a slightly-more-readable phrase.
 * For better names, callers should pass the step's actual `name` field
 * through the existing `getFriendlyStepName` helper (in friendlyLanguage.ts).
 */
function humanizeStepIdentifier(stepId: string): string {
  if (!stepId) return 'a step';
  // "step5" → "Step 5"
  const m = stepId.match(/^step(\d+)$/i);
  if (m) return `Step ${m[1]}`;
  // Otherwise return as-is but title-cased
  return stepId.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function friendlyStepFromIssue(issue: any): string {
  const explicit = issue?.step_name || issue?.stepName || issue?.friendly_step_name;
  if (typeof explicit === 'string' && explicit) return explicit;
  const id = issue?.step_id || issue?.stepId || issue?.upstreamStep;
  return id ? humanizeStepIdentifier(id) : 'one of the steps';
}

/**
 * Turn `{{step1.email}}` into `"email" from Step 1`.
 * Turn `{{step1.data.subject}}` into `"subject" from Step 1`.
 */
function prettifyRef(ref: string): string {
  const inner = ref.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const parts = inner.split('.');
  if (parts.length === 0) return `"${ref}"`;
  const stepPart = parts[0];
  // Drop 'data' segment if present — that's an internal envelope name.
  const fieldParts = parts.slice(1).filter(p => p !== 'data');
  const fieldName = fieldParts[fieldParts.length - 1] || stepPart;
  const stepFriendly = humanizeStepIdentifier(stepPart);
  return `"${fieldName}" from ${stepFriendly}`;
}

function humanizeForSentence(s: string): string {
  return String(s ?? '').replace(/[-_]/g, ' ').toLowerCase();
}
