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

import type { StatusTone } from '@/app/admin/components/layout/StatusChip';
import type {
  EnvDisplay,
  EnvironmentLabel,
  EnvironmentViewPayload,
  EnvScope,
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

function isRow(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.name === 'string' &&
    typeof value.role === 'string' &&
    (value.scope === 'server' || value.scope === 'browser-inlined') &&
    (value.seeAlsoPath === undefined || typeof value.seeAlsoPath === 'string') &&
    isDisplay(value.display)
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
  const facts = environment.facts;
  if (!isObject(facts) || !['host', 'region', 'branch', 'commit'].every((key) => isStringOrNull(facts[key]))) return false;
  if (!Array.isArray(data.groups) || !data.groups.every(isGroup)) return false;
  if (!Array.isArray(data.uncategorised) || !data.uncategorised.every(isRow)) return false;
  // The count line renders this number, so it must be one (SA, optional).
  return isObject(data.counts) && isCount(data.counts.platformHidden);
}
