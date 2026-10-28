/**
 * The server-side classifier behind `GET /api/admin/environment`
 * (admin environment view, EC-1; requirement §3.2, SA rulings OQ-3 to OQ-5,
 * conditions SA-C1 to SA-C8).
 *
 * RULE ZERO: a value the catalogue does not positively allow to be shown never
 * leaves this function. Every path fails closed: unknown class or shape,
 * uncatalogued name, a name that looks like a credential, a value that does
 * not look like plain configuration, or any error while classifying a row.
 *
 * PURE. It takes the environment object as an ARGUMENT and never reaches for
 * the global one (SA-C8): it enumerates the argument's keys and reads them by
 * computed name, so in production it sees the deployment's runtime values, not
 * anything a build step inlined. No logger, no I/O. Only the route passes the
 * real environment in; tests pass fixture objects.
 *
 * Errors: no message is ever built from a value, and a caught error's message
 * is never read (SA-C6). Row errors are returned beside the payload as
 * name + error class, for the route to log.
 *
 * @module lib/admin/environment/classifyEnvironment
 */

import 'server-only';

import { parseAdminEmails } from '@/lib/admin/adminEmailsEnv';
import { parseBoostTestAccounts } from '@/lib/business-os/boost/boostCheckoutAccess';
import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';
import type {
  EnvCataloguedGroupId,
  EnvCheckedAgainst,
  EnvDiagnostic,
  EnvDisplay,
  EnvironmentFacts,
  EnvironmentLabel,
  EnvironmentViewPayload,
  EnvGroupBlock,
  EnvRow,
  EnvScope,
  EnvSupabaseProject,
} from '@/lib/admin/environment-types';

import {
  ENVIRONMENT_CATALOGUE,
  ENVIRONMENT_GROUPS,
  type EnvCatalogueEntry,
  type EnvConfigEntry,
  type EnvFlagEntry,
  type EnvGroupInfo,
  type EnvPersonalEntry,
} from './catalogue';
import { isPlatformNoise } from './platformDenyList';
import { SUPABASE_PROJECTS, SUPABASE_URL_ROW_NAMES, type SupabaseProjectEntry } from './supabaseProjects';

// ── Masking rules ───────────────────────────────────────────────────────────

/** SA-C1: a name containing any of these (any case) is status-only. */
export const SECRET_NAME_TOKENS: readonly string[] = [
  'KEY',
  'SECRET',
  'TOKEN',
  'PASS',
  'PWD',
  'SALT',
  'PRIVATE',
  'CREDENTIAL',
  'CREDS',
  'SIGNING',
  'AUTH',
  'DSN',
  'CERT',
  'HOOK',
  'COOKIE',
  'SESSION',
  'CONNECTION',
];

/** SA-C2: the longest `config` value that may be shown. */
export const MAX_SHOWN_LENGTH = 200;

export const UNCATALOGUED_ROLE = 'Not described in the catalogue yet.';

/** True when the name matches the SA-C1 pattern. Over-matching only masks. */
export function nameLooksSecret(name: string): boolean {
  const upper = name.toUpperCase();
  return SECRET_NAME_TOKENS.some((token) => upper.includes(token));
}

const WHITESPACE_OR_QUOTE = /[\s'"`]/;
// A JWT: three dot-separated base64url segments. Either the encoded-JSON opening
// (`eyJ`) followed by a dot ANYWHERE in the value (so `prefix:eyJ…` and
// `path/eyJ…` are caught too, SA CR-2), or three segments of 10+ characters
// each. The 10-character floor keeps ordinary three-label host names
// (`app.example.test`) visible; a real JWT's segments are all far longer.
const JWT_SHAPED = /^(?:[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}$/;
const JWT_OPENING = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/;
const LONG_OPAQUE_RUN = /[A-Za-z0-9+/=]{40,}/;

const HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
const HAS_LETTER = /[A-Za-z]/;
const INTEGER = /^-?\d{1,15}$/;
const GIT_SHA = /^[0-9a-f]{40}$/i;
// SA optimisation: only the known region formats (a Vercel id such as `abc1`, an AWS id such as `xx-word-1`).
const REGION = /^(?:[a-z]{3}\d|[a-z]{2}-[a-z]+-\d)$/;
// SA RC-2: no `@`, so an address catalogued by mistake as `config` is hidden.
const IDENTIFIER = /^[A-Za-z0-9._:/-]+$/;
// SA QF-1: a run of 20+ letters and digits mixing upper case, lower case and a
// digit looks like a provider key, even when `-` or `_` breaks it into pieces.
// Lower-case client ids and UUIDs do not match (no upper case, or runs too short).
const ALNUM_RUN = /[A-Za-z0-9]{20,}/g;
const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /\d/;
// SA QF-2: a URL must spell its scheme with the slashes; `https:word` parses but is not an address.
const URL_SCHEME = /^https?:\/\//i;
// EC-6 (OQ-6): https only, the exact Supabase host, no port, no further subdomain.
// Matched against the SHOWN origin, which `new URL()` has already lower-cased (SA-L2).
const SUPABASE_ORIGIN = /^https:\/\/([a-z0-9]+)\.supabase\.co$/;

function hasMixedKeyRun(text: string): boolean {
  for (const run of text.match(ALNUM_RUN) ?? []) {
    if (HAS_UPPER.test(run) && HAS_LOWER.test(run) && HAS_DIGIT.test(run)) return true;
  }
  return false;
}

const HIDDEN_NOT_PLAIN: EnvDisplay = { kind: 'hidden', reason: 'not-plain-config' };

// ── Options and result ──────────────────────────────────────────────────────

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface ClassifyEnvironmentOptions {
  /** Test seam: a substitute catalogue. */
  catalogue?: readonly EnvCatalogueEntry[];
  /** Test seam: substitute groups (order and labels). */
  groups?: readonly EnvGroupInfo[];
  /** Test seam: a substitute deny-list matcher. */
  isNoise?: (name: string) => boolean;
  /** Test seam: a fixed clock. */
  now?: () => Date;
  /** Test seam: a substitute Supabase project table (EC-6). */
  supabaseProjects?: ReadonlyMap<string, SupabaseProjectEntry>;
}

export interface EnvRowError {
  name: string;
  /** The error's class name only (SA-C6). Never its message. */
  errorClass: string;
}

export interface ClassifyEnvironmentResult {
  payload: EnvironmentViewPayload;
  rowErrors: EnvRowError[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isSetValue(raw: string | undefined): raw is string {
  return typeof raw === 'string' && raw.trim() !== '';
}

function scopeOfName(name: string): EnvScope {
  // SA QF-3: case-sensitive, as Next.js inlines only the exact prefix.
  return name.startsWith('NEXT_PUBLIC_') ? 'browser-inlined' : 'server';
}

/** The class name of whatever was thrown. Reads no message. */
export function errorClassOf(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.constructor?.name || 'Error';
  return typeof thrown;
}

/** Fixed-text error for impossible states (a type escape). Never carries a value. */
class EnvClassificationError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'EnvClassificationError';
  }
}

function passesGlobalGates(text: string, allowLongRun: boolean): boolean {
  if (text.length > MAX_SHOWN_LENGTH) return false;
  if (WHITESPACE_OR_QUOTE.test(text)) return false;
  if (JWT_SHAPED.test(text) || JWT_OPENING.test(text)) return false;
  if (!allowLongRun && LONG_OPAQUE_RUN.test(text)) return false;
  return true;
}

function configDisplay(entry: EnvConfigEntry, raw: string): EnvDisplay {
  const text = raw.trim();
  const isGitSha = entry.shape === 'gitSha';
  if (!passesGlobalGates(text, isGitSha)) return HIDDEN_NOT_PLAIN;

  switch (entry.shape) {
    case 'url': {
      if (!URL_SCHEME.test(text)) return HIDDEN_NOT_PLAIN;
      let parsed: URL;
      try {
        parsed = new URL(text);
      } catch {
        return HIDDEN_NOT_PLAIN;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return HIDDEN_NOT_PLAIN;
      // SA-C4: origin only. User-info, path, query and fragment never leave.
      const origin = parsed.origin;
      if (!passesGlobalGates(origin, false)) return HIDDEN_NOT_PLAIN;
      return { kind: 'shown', text: origin };
    }
    case 'host':
      // SA QF-1 (b): host names are written lower case, so a capital means it is not a host.
      return HOST.test(text) && HAS_LETTER.test(text) && !HAS_UPPER.test(text) && !hasMixedKeyRun(text)
        ? { kind: 'shown', text }
        : HIDDEN_NOT_PLAIN;
    case 'integer':
      return INTEGER.test(text) ? { kind: 'shown', text } : HIDDEN_NOT_PLAIN;
    case 'enum': {
      const lower = text.toLowerCase();
      const match = entry.enumValues.find((allowed) => allowed.toLowerCase() === lower);
      // The catalogue's own spelling is shown, never the input's.
      return match !== undefined ? { kind: 'shown', text: match } : HIDDEN_NOT_PLAIN;
    }
    case 'gitSha':
      return GIT_SHA.test(text) ? { kind: 'shown', text } : HIDDEN_NOT_PLAIN;
    case 'region':
      return REGION.test(text) ? { kind: 'shown', text } : HIDDEN_NOT_PLAIN;
    case 'identifier':
      return IDENTIFIER.test(text) && !hasMixedKeyRun(text) ? { kind: 'shown', text } : HIDDEN_NOT_PLAIN;
    default:
      throw new EnvClassificationError('unknown_config_shape');
  }
}

/** SA-C3: a closed verdict, built from no characters of the value. */
function flagDisplay(entry: EnvFlagEntry, raw: string | undefined): EnvDisplay {
  const fallback = entry.flagDefault ? 'on' : 'off';
  if (!isSetValue(raw)) return { kind: 'flag', state: fallback, source: 'default' };

  if (entry.flagParser === 'lenient') {
    const normalised = raw.trim().toLowerCase();
    const recognised = normalised === 'true' || normalised === '1' || normalised === 'false' || normalised === '0';
    const state = parseBooleanFlag(raw, entry.flagDefault) ? 'on' : 'off';
    return { kind: 'flag', state, source: recognised ? 'set' : 'unrecognised' };
  }
  if (entry.flagParser === 'strict-true') {
    // The reader is `=== 'true'`: anything else reads as off.
    if (raw === 'true') return { kind: 'flag', state: 'on', source: 'set' };
    if (raw === 'false') return { kind: 'flag', state: 'off', source: 'set' };
    return { kind: 'flag', state: 'off', source: 'unrecognised' };
  }
  throw new EnvClassificationError('unknown_flag_parser');
}

function personalDisplay(entry: EnvPersonalEntry, raw: string | undefined): EnvDisplay {
  if (!isSetValue(raw)) return { kind: 'status', set: false };
  switch (entry.personalKind) {
    case 'single':
      return { kind: 'status', set: true };
    case 'list-admin-emails':
      // OQ-10: the one parser the admin gate and the Admin users page use.
      return { kind: 'count', entries: parseAdminEmails(raw).size };
    case 'list-boost-accounts':
      // QA-3 / SA Q4-9: the checkout's own reader, called WITHOUT a logger so its
      // once-only warning state is untouched. Counts valid account ids only.
      return { kind: 'count', entries: parseBoostTestAccounts(raw)?.size ?? 0 };
    default:
      throw new EnvClassificationError('unknown_personal_kind');
  }
}

function displayFor(entry: EnvCatalogueEntry, raw: string | undefined): EnvDisplay {
  const isSet = isSetValue(raw);
  // SA-C1: the name pattern beats the catalogue for config and personal; a flag keeps its verdict.
  if ((entry.sensitivity === 'config' || entry.sensitivity === 'personal') && nameLooksSecret(entry.name)) {
    return { kind: 'status', set: isSet };
  }
  switch (entry.sensitivity) {
    case 'secret':
      return { kind: 'status', set: isSet };
    case 'personal':
      return personalDisplay(entry, raw);
    case 'flag':
      return flagDisplay(entry, raw);
    case 'config':
      return isSet ? configDisplay(entry, raw) : { kind: 'status', set: false };
    default:
      throw new EnvClassificationError('unknown_sensitivity');
  }
}

/** Requirement §3.1. `NODE_ENV` alone never yields production. */
export function environmentLabelOf(env: EnvSource): EnvironmentLabel {
  const vercelEnv = (env['VERCEL_ENV'] ?? '').trim().toLowerCase();
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (vercelEnv === 'development') return 'vercel-development';
  if (vercelEnv === '' && (env['NODE_ENV'] ?? '').trim().toLowerCase() === 'development') return 'local';
  return 'unknown';
}

/** SA Q4-1: which `expectedIn` column applies; null (not checked) for an unknown label (OQ-7). */
export function checkedAgainstOf(label: EnvironmentLabel): EnvCheckedAgainst | null {
  switch (label) {
    case 'production':
      return 'production';
    case 'preview':
      return 'preview';
    case 'local':
    case 'vercel-development':
      return 'local';
    default:
      return null;
  }
}

/**
 * EC-4 diagnostics for one catalogued row (SA E4-1, E4-3). Each code is a
 * literal pushed in a fixed order; nothing is copied from the value or spread
 * from the entry. The only value-derived fact is the M-7 boolean
 * "whitespace at an end" (SA Q4-3): never which end, which character or how many.
 */
function diagnosticsFor(
  entry: EnvCatalogueEntry,
  raw: string | undefined,
  display: EnvDisplay,
  checkedAgainst: EnvCheckedAgainst | null
): EnvDiagnostic[] {
  const out: EnvDiagnostic[] = [];
  const isSet = isSetValue(raw);
  if (checkedAgainst !== null) {
    const expected = entry.expectedIn[checkedAgainst];
    if (expected === 'required' && !isSet) out.push('required-not-set');
    // SA Q4-4: literal FR-18, amber when set, whatever a flag reads.
    if (expected === 'forbidden' && isSet) out.push('should-not-be-set');
  }
  if (display.kind === 'flag' && display.source === 'unrecognised') out.push('unrecognised-flag');
  if (typeof raw === 'string' && raw !== '' && raw !== raw.trim()) out.push('surrounding-whitespace');
  return out;
}

/** Builds a row field by field (SA-C5). The value never becomes a field. */
function catalogueRow(entry: EnvCatalogueEntry, display: EnvDisplay, diagnostics: EnvDiagnostic[]): EnvRow {
  const row: EnvRow = {
    name: entry.name,
    group: entry.group,
    role: entry.role,
    sensitivity: entry.sensitivity,
    scope: entry.scope,
    expectedIn: {
      production: entry.expectedIn.production,
      preview: entry.expectedIn.preview,
      local: entry.expectedIn.local,
    },
    display,
    diagnostics,
  };
  if (entry.seeAlsoPath) row.seeAlsoPath = entry.seeAlsoPath;
  if (entry.docLink) row.docLink = entry.docLink;
  return row;
}

function shownText(row: EnvRow | undefined): string | null {
  return row && row.display.kind === 'shown' ? row.display.text : null;
}

/**
 * EC-6 (SA-L1, SA-L3, SA-L5): what our table says about a shown origin, or
 * undefined when the origin is not a Supabase host. Input is `shown` text only,
 * which already passed the global gates and the origin reduction, so no new
 * value class is read. One anchored regex and one Map lookup: it cannot throw
 * (SA-L4). Built field by field; the table entry is never spread.
 */
function supabaseProjectOf(
  origin: string,
  projects: ReadonlyMap<string, SupabaseProjectEntry>
): EnvSupabaseProject | undefined {
  const match = SUPABASE_ORIGIN.exec(origin);
  if (!match) return undefined;
  // A Map has no inherited keys, so `constructor` and the like are simply absent (SA-L3).
  const entry = projects.get(match[1]);
  if (!entry) return { kind: 'unknown' };
  return { kind: 'known', label: entry.label, role: entry.role };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function classifyEnvironment(env: EnvSource, options: ClassifyEnvironmentOptions = {}): ClassifyEnvironmentResult {
  const catalogue = options.catalogue ?? ENVIRONMENT_CATALOGUE;
  const groups = options.groups ?? ENVIRONMENT_GROUPS;
  const isNoise = options.isNoise ?? isPlatformNoise;
  const now = options.now ?? (() => new Date());
  const supabaseProjects = options.supabaseProjects ?? SUPABASE_PROJECTS;

  if (!Array.isArray(catalogue) || catalogue.length === 0) {
    // Fail closed: no catalogue means no answer, never an unmasked list.
    throw new EnvClassificationError('catalogue_unavailable');
  }

  const label = environmentLabelOf(env);
  const checkedAgainst = checkedAgainstOf(label);
  const rowErrors: EnvRowError[] = [];
  const catalogued = new Set<string>();
  const rowsByGroup = new Map<EnvCataloguedGroupId, EnvRow[]>();
  const rowsByName = new Map<string, EnvRow>();
  let setCount = 0;
  const tally: Record<EnvDiagnostic, number> = {
    'required-not-set': 0,
    'should-not-be-set': 0,
    'unrecognised-flag': 0,
    'surrounding-whitespace': 0,
    // SA-L7: initialised for the closed record, never read. The code sits on two
    // rows, so a per-row tally would count one mismatch twice (OQ-4).
    'supabase-url-mismatch': 0,
  };

  for (const entry of catalogue) {
    catalogued.add(entry.name);
    const raw = env[entry.name];
    if (isSetValue(raw)) setCount += 1;

    let display: EnvDisplay;
    let diagnostics: EnvDiagnostic[];
    try {
      display = displayFor(entry, raw);
      diagnostics = diagnosticsFor(entry, raw, display, checkedAgainst);
    } catch (thrown) {
      display = { kind: 'hidden', reason: 'classification-error' };
      diagnostics = [];
      rowErrors.push({ name: entry.name, errorClass: errorClassOf(thrown) });
    }
    for (const code of diagnostics) tally[code] += 1;

    const row = catalogueRow(entry, display, diagnostics);
    rowsByName.set(entry.name, row);
    const list = rowsByGroup.get(entry.group) ?? [];
    list.push(row);
    rowsByGroup.set(entry.group, list);
  }

  // EC-6: the project label and the pair check, from `shown` rows only (SA-L1).
  // Hidden, masked, unset and errored rows take no part.
  const shownSupabaseRows: EnvRow[] = [];
  for (const name of SUPABASE_URL_ROW_NAMES) {
    const row = rowsByName.get(name);
    if (!row || row.display.kind !== 'shown') continue;
    const project = supabaseProjectOf(row.display.text, supabaseProjects);
    // Omitted, never null, when no label applies (SA-L5).
    if (project) row.supabaseProject = project;
    shownSupabaseRows.push(row);
  }
  let supabaseUrlMismatch = 0;
  if (shownSupabaseRows.length === 2) {
    const [first, second] = shownSupabaseRows;
    if (shownText(first) !== shownText(second)) {
      // SA-L6: on both rows, after the existing codes, whatever `checkedAgainst` is.
      first.diagnostics.push('supabase-url-mismatch');
      second.diagnostics.push('supabase-url-mismatch');
      supabaseUrlMismatch = 1;
    }
  }

  // OQ-4 precedence: catalogue, then deny-list, then Uncategorised.
  const uncategorised: EnvRow[] = [];
  let platformHidden = 0;
  for (const name of Object.keys(env).sort()) {
    if (catalogued.has(name)) continue;
    if (isNoise(name)) {
      platformHidden += 1;
      continue;
    }
    const isSet = isSetValue(env[name]);
    if (isSet) setCount += 1;
    uncategorised.push({
      name,
      group: 'uncategorised',
      role: UNCATALOGUED_ROLE,
      sensitivity: 'secret',
      scope: scopeOfName(name),
      expectedIn: null,
      display: { kind: 'status', set: isSet },
      // M-4 / M-7 (b): uncategorised rows stay status-only, with no diagnostic at all.
      diagnostics: [],
    });
  }

  const groupBlocks: EnvGroupBlock[] = groups.map((group) => ({
    id: group.id,
    label: group.label,
    description: group.description,
    rows: rowsByGroup.get(group.id) ?? [],
  }));

  const facts: EnvironmentFacts = {
    host: shownText(rowsByName.get('VERCEL_URL')),
    region: shownText(rowsByName.get('VERCEL_REGION')),
    branch: shownText(rowsByName.get('VERCEL_GIT_COMMIT_REF')),
    commit: shownText(rowsByName.get('VERCEL_GIT_COMMIT_SHA')),
  };

  const totalRows = rowsByName.size + uncategorised.length;
  const payload: EnvironmentViewPayload = {
    environment: { label, checkedAgainst, facts },
    groups: groupBlocks,
    uncategorised,
    counts: {
      rows: totalRows,
      set: setCount,
      notSet: totalRows - setCount,
      uncategorised: uncategorised.length,
      platformHidden,
      // SA Q4-8: null, not 0, when the environment is not recognised.
      requiredNotSet: checkedAgainst === null ? null : tally['required-not-set'],
      shouldNotBeSet: checkedAgainst === null ? null : tally['should-not-be-set'],
      unrecognisedFlags: tally['unrecognised-flag'],
      surroundingWhitespace: tally['surrounding-whitespace'],
      // OQ-4: from the pair, not the tally.
      supabaseUrlMismatch,
    },
    generatedAt: now().toISOString(),
  };

  return { payload, rowErrors };
}
