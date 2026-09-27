/**
 * Wire types of `GET /api/admin/health-summary` (admin reorganisation slice 4).
 *
 * RUNTIME-FREE on purpose: only `export type` / `export interface`, no values
 * and no imports. The Health page is a client component and imports these with
 * `import type` only, so it never pulls the rule config or the evaluator into
 * the browser bundle (SA C-21): the rules it renders arrive in the response.
 *
 * @module lib/admin/health/healthTypes
 */

/**
 * A tile's state. There is deliberately NO `'green'` (SA C-10): the page says
 * whether something needs action, needs a look, is normal, is not measured, or
 * could not be checked. It never says "all good".
 */
export type TileStatus = 'red' | 'amber' | 'neutral' | 'not_measured' | 'unavailable';

export type HealthTileId =
  | 'bos_ai_settings'
  | 'bos_ai_failures'
  | 'bos_ai_spend'
  | 'critical_audit'
  | 'entitlements_mode'
  | 'scheduled_jobs'
  | 'queues';

/** One number on a tile, and the page that shows the same number. */
export interface HealthFigure {
  /** e.g. "Last 24 h" */
  label: string;
  /** Formatted on the server, e.g. "$3.41" or "at least $12.10". */
  value: string;
  /** False = a lower bound. The page never drops the "at least". */
  exact: boolean;
  /** The page that shows the same number; null when there is none (and the tile says why). */
  href: string | null;
  /** The link's accessible name, e.g. "Failed AI actions, last 24 hours: 3, open in audit trail". */
  linkLabel: string | null;
  /** e.g. the OI-P1 sentence when calls exceed 1,000. */
  note: string | null;
}

/** One rule as the page shows it: what it says, and what it actually tests (SA C-22). */
export interface HealthRuleView {
  colour: 'red' | 'amber';
  description: string;
  /** Generated from the rule's condition, so the displayed rule is always the applied one. */
  condition: string;
}

export interface HealthTile {
  id: HealthTileId;
  title: string;
  status: TileStatus;
  /** The matching rule's description; "Normal" when none matched; fixed text otherwise. */
  headline: string;
  /** The matching rule's id, or null (none matched, invariant, not evaluated). */
  matchedRuleId: string | null;
  figures: HealthFigure[];
  /** The tile's rules, in evaluation order. Empty for the not-measured tiles. */
  rules: HealthRuleView[];
  /**
   * What happens when no rule matches, in words — the last line of the rule
   * list. Built by the evaluator, so it can never claim "Normal" for a tile
   * whose figure is only a lower bound (SA C-18, code review 2). Null when the
   * tile has no rules.
   */
  otherwise: string | null;
  /** One line under the figures (e.g. why a tile has no link). */
  footnote: string | null;
}

export interface HealthWindowsView {
  /** ISO, minute-floored UTC. The end of every current window. */
  end: string;
  last24hStart: string;
  previous24hStart: string;
  last7dStart: string;
  previous7dStart: string;
}

export interface HealthSummary {
  generatedAt: string;
  windows: HealthWindowsView;
  tiles: HealthTile[];
}
