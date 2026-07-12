/**
 * Parameter-resolver framework — shared types (Calibration Option A).
 *
 * A *resolver* looks up the correct value for a failed parameter by consulting
 * the LIVE data source (e.g. read a spreadsheet's real tab names), for the class
 * of parameter errors whose correct value is not knowable from the agent
 * blueprint alone. The generic engine (ParameterResolverEngine) is the only
 * caller; resolvers never touch the DSL or the DB directly.
 *
 * Design + decisions: docs/workplans/CALIBRATION_DATASOURCE_RESOLVER_WORKPLAN.md.
 * The engine is plugin-agnostic; all app-specifics live in the resolver.
 */

/** Everything a resolver needs to look up the right value. */
export interface ResolverContext {
  /** The value that failed, e.g. "Sheet1". */
  currentValue: unknown;
  /** All resolved input values for the run (spreadsheet_id, etc.). */
  resolvedInputs: Record<string, any>;
  /** The failing step's params. */
  stepParams: Record<string, any>;
  /** The failing step id. */
  stepId: string;
  /** User id — for reusing the connected-account plugin auth. */
  userId: string;
  /** The raw API/runtime error, e.g. "Unable to parse range: Sheet1". */
  rawError: string;
}

/** Outcome of a resolver's lookup. */
export type ResolverResult =
  /** One clearly-correct value found. */
  | { status: 'resolved'; value: unknown; confidence: number; reason: string }
  /**
   * Several plausible values, none clearly correct. In the headless flow the
   * ENGINE auto-applies `candidates[0]` as a best-effort fix and discloses it in
   * the summary email (there is no interactive picker). `candidates[0]` MUST be
   * the resolver's best default (e.g. the first tab).
   */
  | { status: 'ambiguous'; candidates: ResolverCandidate[]; confidence: number; reason: string }
  /** Could not look up a value (e.g. missing prerequisite input, source read failed). */
  | { status: 'unresolved'; reason: string };

export interface ResolverCandidate {
  value: unknown;
  /** Human-readable label for the disclosure text (e.g. the tab title). */
  label: string;
}

/** A resolver for one `plugin.action.parameter`. */
export interface ParameterResolver {
  plugin: string;
  action: string;
  parameter: string;
  /** Cheap guard — only attempt when relevant (e.g. rawError matches a pattern). */
  appliesTo(ctx: ResolverContext): boolean;
  /** The lookup. MUST be self-contained and side-effect free (no DSL/DB writes). */
  resolve(ctx: ResolverContext): Promise<ResolverResult>;
}

/**
 * Where the corrected value is written. The engine computes this by inspecting
 * the failing param: a `{{input.X}}` template → the input field X; a literal →
 * the step param itself (like the P3 DSL rewrite).
 */
export type ApplyTarget =
  | { kind: 'input'; field: string }
  | { kind: 'dsl'; stepId: string; paramPath: string };

/** A fix the engine decided to apply, with everything the caller needs to persist + disclose it. */
export interface PlannedFix {
  issueId?: string;
  stepId: string;
  stepName?: string;
  plugin: string;
  action: string;
  parameter: string;
  target: ApplyTarget;
  /** The corrected value to write. */
  value: unknown;
  confidence: number;
  /** 'confident' = one clear answer; 'best_effort' = a disclosed guess (ambiguous). */
  kind: 'confident' | 'best_effort';
  /** Plain-English line for the calibration summary email + FixesApplied card. */
  disclosure: string;
  reason: string;
}

/** An issue the engine chose to leave as-is (no resolver, or unresolved). */
export interface ReportOnlyOutcome {
  issueId?: string;
  stepId?: string;
  reason: string;
}

/** Aggregate result of one engine pass over a batch of parameter errors. */
export interface EngineOutcome {
  applied: PlannedFix[];
  reportOnly: ReportOnlyOutcome[];
  /** Disclosures for the summary email ("What we changed"), one per applied fix. */
  appliedFixNotes: string[];
}
