/**
 * Response shape of `GET /api/admin/environment`, shared by the route and the
 * read-only Environment admin page (EC-2).
 *
 * Types only: no runtime exports and no imports, so the page can pull it in
 * with `import type` and nothing reaches the client bundle (SA-C11), as
 * `lib/admin/adminList-types.ts` does.
 *
 * There is deliberately no field anywhere in this file that could hold a raw
 * environment value. A row's `display` is one of five closed shapes (SA-C5);
 * only `shown` carries text, and only after the classifier's shape gates.
 *
 * @module lib/admin/environment-types
 */

/** The page's groups, in no particular order (the order lives in the catalogue). */
export type EnvGroupId =
  | 'environment'
  | 'database'
  | 'admin'
  | 'addresses'
  | 'ai'
  | 'plugins'
  | 'external'
  | 'payments'
  | 'email'
  | 'jobs'
  | 'tokens'
  | 'features'
  | 'logging'
  | 'testing'
  | 'uncategorised';

/** Every group except Uncategorised, which the payload carries separately. */
export type EnvCataloguedGroupId = Exclude<EnvGroupId, 'uncategorised'>;

export type EnvSensitivity = 'flag' | 'secret' | 'config' | 'personal';

/** `browser-inlined`: the build may copy the value into the browser bundle. */
export type EnvScope = 'server' | 'browser-inlined';

export type EnvExpectation = 'required' | 'optional' | 'forbidden';

/** OQ-7: what each environment is expected to hold. Displayed from EC-4. */
export interface EnvExpectedIn {
  production: EnvExpectation;
  preview: EnvExpectation;
  local: EnvExpectation;
}

/** Why a set value is not shown. */
export type EnvHiddenReason = 'not-plain-config' | 'classification-error';

/** The one thing the browser learns about a variable's value (SA-C5). */
export type EnvDisplay =
  | { kind: 'shown'; text: string }
  | { kind: 'status'; set: boolean }
  | { kind: 'flag'; state: 'on' | 'off'; source: 'set' | 'default' | 'unrecognised' }
  | { kind: 'count'; entries: number }
  | { kind: 'hidden'; reason: EnvHiddenReason };

/**
 * EC-4 diagnostics: a closed set of codes, built from no characters of the
 * value (requirement M-7). `surrounding-whitespace` is the one named exception:
 * one boolean, "the value has whitespace at an end" (SA Q4-3).
 */
export type EnvDiagnostic =
  | 'required-not-set'
  | 'should-not-be-set'
  | 'unrecognised-flag'
  | 'surrounding-whitespace';

/** Which `expectedIn` column the diagnostics were checked against (null: not checked). */
export type EnvCheckedAgainst = 'production' | 'preview' | 'local';

export interface EnvRow {
  name: string;
  group: EnvGroupId;
  /** One plain sentence: what it is for and what happens when it is missing. */
  role: string;
  /** Uncatalogued rows are `secret` (requirement §3.2). */
  sensitivity: EnvSensitivity;
  scope: EnvScope;
  /** Null only for uncatalogued rows. */
  expectedIn: EnvExpectedIn | null;
  display: EnvDisplay;
  /** Distinct codes in a fixed order; always `[]` on uncategorised rows (EC-4). */
  diagnostics: EnvDiagnostic[];
  /** An admin page that shows this setting's contents under its own rules (OQ-10). */
  seeAlsoPath?: string;
  /** A repository doc path, shown as text (the app does not serve `/docs`). */
  docLink?: string;
}

export type EnvironmentLabel = 'production' | 'preview' | 'vercel-development' | 'local' | 'unknown';

export interface EnvironmentFacts {
  /** Each fact is the `shown` text of its catalogued row, or null. */
  host: string | null;
  region: string | null;
  branch: string | null;
  commit: string | null;
}

export interface EnvGroupBlock {
  id: EnvCataloguedGroupId;
  label: string;
  description: string;
  rows: EnvRow[];
}

export interface EnvironmentCounts {
  /** Catalogued rows plus uncategorised rows. */
  rows: number;
  /** Rows whose value is present and not blank. */
  set: number;
  notSet: number;
  uncategorised: number;
  /** Names set by the platform or operating system, counted and not listed. */
  platformHidden: number;
  /** Rows carrying `required-not-set`; null when the environment is not recognised (SA Q4-8). */
  requiredNotSet: number | null;
  /** Rows carrying `should-not-be-set`; null when the environment is not recognised. */
  shouldNotBeSet: number | null;
  /** Rows carrying `unrecognised-flag`. */
  unrecognisedFlags: number;
  /** Rows carrying `surrounding-whitespace`. */
  surroundingWhitespace: number;
}

export interface EnvironmentViewPayload {
  environment: { label: EnvironmentLabel; checkedAgainst: EnvCheckedAgainst | null; facts: EnvironmentFacts };
  /** In the catalogue's group order. */
  groups: EnvGroupBlock[];
  /** Always present, possibly empty (FR-15). */
  uncategorised: EnvRow[];
  counts: EnvironmentCounts;
  /** ISO timestamp. */
  generatedAt: string;
}
