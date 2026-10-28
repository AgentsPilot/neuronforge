/**
 * Words for the Environment admin page (admin environment view EC-2; workplan
 * §2.3; SA rulings Q2-1 to Q2-4, E2-1, E2-2).
 *
 * Pure. Every word the page shows about a value comes from here, and is built
 * only from the closed fields of the response's `display` union: the one
 * exception is `shown.text`, which the server has already passed through its
 * shape gates. Nothing here reads the environment.
 *
 * Client boundary (SA-C11): the only import from the feature is a type-only
 * import of `lib/admin/environment-types.ts`. Bundled for the browser.
 *
 * @module app/admin/environment/environmentDisplay
 */

import type { KpiTileStatus } from '@/app/admin/components/layout/KpiStrip';
import type { StatusTone } from '@/app/admin/components/layout/StatusChip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import type {
  EnvCheckedAgainst,
  EnvDiagnostic,
  EnvDisplay,
  EnvGroupId,
  EnvironmentLabel,
  EnvironmentViewPayload,
  EnvRow,
  EnvScope,
  EnvSupabaseProject,
  EnvSupabaseRole,
} from '@/lib/admin/environment-types';

export interface ChipWords {
  text: string;
  tone: StatusTone;
}

/** Q2-1: info for the four known labels, warn (amber) for Unknown. */
export const ENVIRONMENT_LABEL_WORDS: Readonly<Record<EnvironmentLabel, ChipWords>> = {
  production: { text: 'Production', tone: 'info' },
  preview: { text: 'Preview', tone: 'info' },
  'vercel-development': { text: 'Vercel development', tone: 'info' },
  local: { text: 'Local (merged .env files)', tone: 'info' },
  unknown: { text: 'Unknown environment', tone: 'warn' },
};

const LABELS = Object.keys(ENVIRONMENT_LABEL_WORDS) as EnvironmentLabel[];

export function scopeWords(scope: EnvScope): string {
  return scope === 'browser-inlined' ? 'Built into the browser bundle' : 'Server';
}

export function entriesWords(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`;
}

export function platformHiddenLine(count: number): string {
  if (count === 0) return 'No settings set by the hosting platform or operating system were left out.';
  if (count === 1) return '1 setting set by the hosting platform or operating system is not shown.';
  return `${count} settings set by the hosting platform or operating system are not shown.`;
}

/**
 * SA E2-2: the only pages a row may link to, and their link words. A path the
 * catalogue sends that is not here renders no link at all.
 */
export const SEE_ALSO_LINKS: Readonly<Record<string, string>> = {
  '/admin/settings': 'See Admin users',
};

export function seeAlsoLink(path: string | undefined): { href: string; label: string } | null {
  if (!path || !Object.prototype.hasOwnProperty.call(SEE_ALSO_LINKS, path)) return null;
  return { href: path, label: SEE_ALSO_LINKS[path] };
}

/** How one value cell reads: an optional chip, optional monospace text, an optional note. */
export interface ValueWords {
  chip: ChipWords | null;
  mono: string | null;
  note: string | null;
}

const SET: ChipWords = { text: 'Set', tone: 'neutral' };
const NOT_SET: ChipWords = { text: 'Not set', tone: 'unknown' };
const HIDDEN_UNCHECKED = 'Hidden: could not be checked';

function onOff(state: 'on' | 'off'): ChipWords {
  return state === 'on' ? { text: 'On', tone: 'info' } : { text: 'Off', tone: 'neutral' };
}

export function describeDisplay(display: EnvDisplay): ValueWords {
  switch (display.kind) {
    case 'shown':
      return { chip: null, mono: display.text, note: null };
    case 'status':
      return { chip: display.set ? SET : NOT_SET, mono: null, note: null };
    case 'flag': {
      const chip = onOff(display.state);
      if (display.source === 'default') return { chip, mono: null, note: '(default)' };
      if (display.source === 'unrecognised') {
        // SA Q2-2: follows the state, never a literal, so a default-on flag reads On.
        return { chip, mono: null, note: `Set, not a recognised value: reads as ${chip.text}` };
      }
      return { chip, mono: null, note: null };
    }
    case 'count':
      return { chip: null, mono: null, note: entriesWords(display.entries) };
    case 'hidden':
      // SA E2-1: only `not-plain-config` is guaranteed set, so only it carries the Set chip.
      if (display.reason === 'not-plain-config') {
        return { chip: SET, mono: null, note: 'Hidden: does not look like plain configuration' };
      }
      return { chip: null, mono: null, note: HIDDEN_UNCHECKED };
    default: {
      // Compile time: a new kind must be handled above. Run time (QA §6.2): an
      // unknown kind gets the fixed words and never echoes a field of the object.
      const unreachable: never = display;
      void unreachable;
      return { chip: null, mono: null, note: HIDDEN_UNCHECKED };
    }
  }
}

// ── Payload guard (QA §6.2: deep, so a malformed row is the fallback state, not a crash) ──

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => !!value && typeof value === 'object' && !Array.isArray(value);
const isStringOrNull = (value: unknown) => value === null || typeof value === 'string';
const isCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isDisplay(value: unknown): boolean {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'shown':
      return typeof value.text === 'string';
    case 'status':
      return typeof value.set === 'boolean';
    case 'flag':
      return (value.state === 'on' || value.state === 'off') && ['set', 'default', 'unrecognised'].includes(value.source as string);
    case 'count':
      return isCount(value.entries);
    case 'hidden':
      return typeof value.reason === 'string';
    default:
      return false;
  }
}

/** SA E4-3: every code must be one the page has words for. */
function isDiagnostics(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((code) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(DIAGNOSTIC_WORDS, code))
  );
}

/** EC-6 (SA-L5): absent, or a closed `kind`; a known project has a 1 to 60 character label and a role with words. */
function isSupabaseProject(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  if (value.kind === 'unknown') return true;
  if (value.kind !== 'known') return false;
  return (
    typeof value.label === 'string' &&
    value.label.length >= 1 &&
    value.label.length <= SUPABASE_LABEL_MAX &&
    typeof value.role === 'string' &&
    Object.prototype.hasOwnProperty.call(SUPABASE_ROLE_WORDS, value.role)
  );
}

function isRow(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    (value.scope === 'server' || value.scope === 'browser-inlined') &&
    (value.seeAlsoPath === undefined || typeof value.seeAlsoPath === 'string') &&
    isDisplay(value.display) &&
    isDiagnostics(value.diagnostics) &&
    isSupabaseProject(value.supabaseProject)
  );
}

const CHECKED_AGAINST: ReadonlyArray<EnvCheckedAgainst | null> = ['production', 'preview', 'local', null];
const isCountOrNull = (value: unknown) => value === null || isCount(value);

function isCounts(value: unknown): boolean {
  return (
    isObject(value) &&
    [
      'rows',
      'set',
      'notSet',
      'uncategorised',
      'platformHidden',
      'unrecognisedFlags',
      'surroundingWhitespace',
      'supabaseUrlMismatch',
    ].every((key) => isCount(value[key])) &&
    // SA Q4-8: only these two may be null (not checked).
    isCountOrNull(value.requiredNotSet) &&
    isCountOrNull(value.shouldNotBeSet)
  );
}

function isGroup(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.description === 'string' &&
    Array.isArray(value.rows) &&
    value.rows.every(isRow)
  );
}

/** The shape the page can vouch for; anything else is the fallback sentence. */
export function isEnvironmentViewPayload(data: unknown): data is EnvironmentViewPayload {
  if (!isObject(data)) return false;
  const environment = data.environment;
  if (!isObject(environment) || typeof environment.label !== 'string') return false;
  if (!(LABELS as string[]).includes(environment.label)) return false;
  if (!CHECKED_AGAINST.includes(environment.checkedAgainst as EnvCheckedAgainst | null)) return false;
  const facts = environment.facts;
  if (!isObject(facts) || !['host', 'region', 'branch', 'commit'].every((key) => isStringOrNull(facts[key]))) return false;
  if (!Array.isArray(data.groups) || !data.groups.every(isGroup)) return false;
  if (!Array.isArray(data.uncategorised) || !data.uncategorised.every(isRow)) return false;
  // The count line and the KPI strip render these numbers, so they must be numbers (or null where allowed).
  return isCounts(data.counts);
}

// ── EC-4: diagnostics, KPI tiles and filters (workplan §4.4; SA Q4-5 to Q4-11, E4-3, E4-4) ──

export interface DiagnosticWords {
  text: string;
  /** Extra words for a screen reader and the tooltip; never taken from the payload. */
  detail: string | null;
}

/**
 * The only words a diagnostic can produce. Keyed by the closed union, so a new
 * code fails to compile until it has words (and the payload guard refuses any
 * code that is not a key here).
 */
export const DIAGNOSTIC_WORDS: Readonly<Record<EnvDiagnostic, DiagnosticWords>> = {
  'required-not-set': { text: 'Required, not set', detail: null },
  'should-not-be-set': { text: 'Should not be set on this environment', detail: null },
  'unrecognised-flag': { text: 'Set, not a recognised value', detail: null },
  'surrounding-whitespace': {
    text: 'Spaces or line breaks around the value',
    detail: 'Code that does not trim them reads a different value.',
  },
  // SA-L6: an address, not "a different project": two custom domains raise it too.
  'supabase-url-mismatch': { text: 'Not the same address as the other Supabase URL', detail: null },
};

// ── EC-6: the Supabase project label (SA OQ-1, OQ-3, SA-L5) ──

/**
 * Words for each project role. Keyed by the closed union, so a new role fails
 * to compile until it has words (and the payload guard refuses any role that
 * is not a key here).
 */
export const SUPABASE_ROLE_WORDS: Readonly<Record<EnvSupabaseRole, string>> = {
  'development-staging': 'Development and staging',
  production: 'Production',
};

/** SA-L5: the longest project label the page accepts. */
export const SUPABASE_LABEL_MAX = 60;

/** OQ-3: neutral, muted text, not a diagnostic. */
export const UNKNOWN_PROJECT_WORDS = 'Unknown project';

/** How the project reads in the value cell: our label (if known), then muted words. */
export interface ProjectWords {
  label: string | null;
  muted: string;
}

export function projectWords(project: EnvSupabaseProject | undefined): ProjectWords | null {
  if (!project) return null;
  if (project.kind === 'known') return { label: project.label, muted: SUPABASE_ROLE_WORDS[project.role] };
  return { label: null, muted: UNKNOWN_PROJECT_WORDS };
}

const WARN = 'warn' as const;

/** The value cell, with the EC-4 emphasis applied (all amber chips carry words and the warn icon). */
export interface RowValueWords extends ValueWords {
  /** EC-6: the project label after the shown origin; null when there is none. */
  project: ProjectWords | null;
  /** Amber chips after the value, in the row's code order. */
  warnings: Array<{ code: EnvDiagnostic; chip: ChipWords; detail: string | null }>;
}

export function rowValueWords(row: Pick<EnvRow, 'display' | 'diagnostics' | 'supabaseProject'>): RowValueWords {
  const base = describeDisplay(row.display);
  let chip = base.chip;
  let note = base.note;
  const warnings: RowValueWords['warnings'] = [];

  for (const code of row.diagnostics) {
    const words = DIAGNOSTIC_WORDS[code];
    if (code === 'required-not-set' && row.display.kind === 'status' && !row.display.set) {
      // FR-17: the grey "Not set" chip becomes the amber "Required, not set".
      chip = { text: words.text, tone: WARN };
      continue;
    }
    if (code === 'unrecognised-flag' && row.display.kind === 'flag' && note) {
      // FR-19: the words already shipped (EC-2); EC-4 makes them an amber chip.
      warnings.push({ code, chip: { text: note, tone: WARN }, detail: null });
      note = null;
      continue;
    }
    warnings.push({ code, chip: { text: words.text, tone: WARN }, detail: words.detail });
  }
  // SA-L1: a label only ever sits beside a shown origin.
  const project = base.mono !== null ? projectWords(row.supabaseProject) : null;
  return { chip, mono: base.mono, note, project, warnings };
}

// Filters (FR-21). The group id list is typed against the union, so a new group fails to compile here.
const GROUP_IDS: Readonly<Record<EnvGroupId, true>> = {
  environment: true,
  database: true,
  admin: true,
  addresses: true,
  ai: true,
  plugins: true,
  external: true,
  payments: true,
  email: true,
  jobs: true,
  tokens: true,
  features: true,
  logging: true,
  testing: true,
  uncategorised: true,
};

export const GROUP_FILTER_IDS = Object.keys(GROUP_IDS) as EnvGroupId[];

/** U-4: an unknown group id is ignored (the filter falls back to All). */
export function isGroupFilter(raw: string): raw is EnvGroupId {
  return Object.prototype.hasOwnProperty.call(GROUP_IDS, raw);
}

/** FR-21 / SA Q4-11: the variable name only, case-insensitive, trimmed. */
export function matchesSearch(name: string, search: string): boolean {
  const term = search.trim().toLowerCase();
  return term === '' || name.toLowerCase().includes(term);
}

export interface EnvironmentFilterState {
  /** '' = all groups. */
  group: string;
  search: string;
}

export interface VisibleView {
  groups: Array<EnvironmentViewPayload['groups'][number]>;
  /** False when the group filter names another group (SA Q4-7). */
  showUncategorised: boolean;
  uncategorised: EnvRow[];
  /** Nothing matches anywhere. */
  empty: boolean;
}

/** What the filters leave on screen. The environment card is never filtered. */
export function visibleView(data: EnvironmentViewPayload, filters: EnvironmentFilterState): VisibleView {
  const group = isGroupFilter(filters.group) ? filters.group : '';
  const groups = data.groups
    .filter((block) => group === '' || block.id === group)
    .map((block) => ({ ...block, rows: block.rows.filter((row) => matchesSearch(row.name, filters.search)) }))
    // Without a search every chosen card stays (an empty one reads "None"); with one, only cards that match.
    .filter((block) => block.rows.length > 0 || filters.search.trim() === '');
  const showUncategorised = group === '' || group === 'uncategorised';
  const uncategorised = showUncategorised ? data.uncategorised.filter((row) => matchesSearch(row.name, filters.search)) : [];
  const filtering = group !== '' || filters.search.trim() !== '';
  const empty =
    filtering && groups.every((block) => block.rows.length === 0) && (!showUncategorised || uncategorised.length === 0);
  return { groups, showUncategorised, uncategorised, empty };
}

/** The anchor id of a catalogued row (catalogued names are `[A-Z0-9_]`, so no escaping is needed). */
export function rowAnchorId(name: string): string {
  return `env-row-${name}`;
}

export const UNCATEGORISED_ANCHOR = 'uncategorised';

export interface KpiTileModel {
  testId: string;
  label: string;
  value: string | null;
  sub: string | null;
  status: KpiTileStatus | null;
  /** A same-page anchor, or null: no target, so not a link (K-6). */
  href: `#${string}` | null;
}

function firstVisible(view: VisibleView, codes: readonly EnvDiagnostic[]): `#${string}` | null {
  for (const block of view.groups) {
    for (const row of block.rows) {
      if (row.diagnostics.some((code) => codes.includes(code))) return `#${rowAnchorId(row.name)}`;
    }
  }
  return null;
}

const NOT_CHECKED_SUB = 'Not checked: the environment is not recognised';

function expectationTile(
  testId: string,
  label: string,
  count: number | null,
  code: EnvDiagnostic,
  view: VisibleView
): KpiTileModel {
  // SA Q4-8: null means not checked, which is "Not measured yet", never 0.
  if (count === null) return { testId, label, value: null, sub: NOT_CHECKED_SUB, status: 'not_measured', href: null };
  // K-5 / FR-20: amber only above 0; never green.
  return { testId, label, value: formatCount(count), sub: null, status: count > 0 ? 'amber' : null, href: count > 0 ? firstVisible(view, [code]) : null };
}

/** FR-20: the five tiles, from the server's counts only (K-5). Values are whole-payload figures (K-8). */
export function kpiTiles(data: EnvironmentViewPayload, view: VisibleView): KpiTileModel[] {
  const { counts } = data;
  const valueChecks = counts.unrecognisedFlags + counts.surroundingWhitespace + counts.supabaseUrlMismatch;
  // OQ-4: the mismatch joins the sub-line only when there is one.
  const mismatchWords =
    counts.supabaseUrlMismatch > 0
      ? `, ${formatCount(counts.supabaseUrlMismatch)} Supabase address ${counts.supabaseUrlMismatch === 1 ? 'mismatch' : 'mismatches'}`
      : '';
  return [
    { testId: 'kpi-set', label: 'Set', value: formatCount(counts.set), sub: `of ${formatCount(counts.rows)} listed`, status: null, href: null },
    expectationTile('kpi-required-not-set', 'Required, not set', counts.requiredNotSet, 'required-not-set', view),
    expectationTile('kpi-should-not-be-set', 'Should not be set here', counts.shouldNotBeSet, 'should-not-be-set', view),
    {
      testId: 'kpi-values-to-check',
      label: 'Values to check',
      value: formatCount(valueChecks),
      sub: `${formatCount(counts.unrecognisedFlags)} unrecognised switch ${counts.unrecognisedFlags === 1 ? 'value' : 'values'}, ${formatCount(counts.surroundingWhitespace)} with spaces around${mismatchWords}`,
      status: valueChecks > 0 ? 'amber' : null,
      href: valueChecks > 0 ? firstVisible(view, ['unrecognised-flag', 'surrounding-whitespace', 'supabase-url-mismatch']) : null,
    },
    {
      testId: 'kpi-uncategorised',
      label: 'Uncategorised',
      value: formatCount(counts.uncategorised),
      sub: null,
      status: null,
      href: view.showUncategorised ? `#${UNCATEGORISED_ANCHOR}` : null,
    },
  ];
}

/** The environment card's note about which expectations were checked (SA Q4-1, OQ-7). */
export function checkedNote(data: EnvironmentViewPayload): string | null {
  if (data.environment.checkedAgainst === null) {
    return 'Checks against the expected settings are off, because this environment is not recognised.';
  }
  if (data.environment.label === 'vercel-development') return 'Checked against the local expectations.';
  return null;
}
