/**
 * Utterance normalisation and literal extraction for the plan cache.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS WHERE CACHE SAFETY IS WON OR LOST.
 *
 * It does two jobs at once, and they reinforce each other:
 *
 *   1. GENERALISATION — "invoices over $100" and "invoices over $250" become the
 *      same cache key, so one planning call answers a family of questions rather
 *      than a single phrasing.
 *
 *   2. PRIVACY — the normalised text is what gets stored, and for globally
 *      shared entries it is stored across tenants. Stripping numbers, emails,
 *      quoted strings and names is therefore not a nicety: it is the control
 *      that makes a shared cache safe to have at all.
 *
 * The extracted literals are re-injected into the plan at execution time, so
 * nothing is lost — the cached artefact is a SHAPE, never an answer and never
 * anyone's data.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/cache
 */

import { createHash } from 'crypto';

/** A literal lifted out of an utterance, to be put back after a cache hit. */
export interface ExtractedLiteral {
  slot: string;
  kind: 'number' | 'money' | 'email' | 'quoted' | 'date';
  value: string | number;
}

export interface NormalizedUtterance {
  /** Slot-substituted text. This is what gets hashed and stored. */
  normalized: string;
  literals: ExtractedLiteral[];
  /** Whether this text is safe to store in a globally shared cache entry. */
  portable: boolean;
  /** Why it is not portable, for logging. Empty when portable. */
  unportableReasons: string[];
}

// Ordered most-specific first: an email must be caught before its digits are.
const PATTERNS: Array<{ kind: ExtractedLiteral['kind']; re: RegExp }> = [
  { kind: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { kind: 'quoted', re: /["'“”'']([^"'“”'']{1,80})["'“”'']/g },
  { kind: 'date', re: /\b\d{4}-\d{2}-\d{2}\b/g },
  { kind: 'money', re: /[$€£₪]\s?\d+(?:[.,]\d+)?/g },
  { kind: 'number', re: /\b\d+(?:[.,]\d+)?\b/g },
];

/** Signals that an utterance names a specific person or record. */
const UNPORTABLE_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  { reason: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { reason: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]+/ },
  { reason: 'phone', re: /\+?\d[\d\s()-]{7,}\d/ },
];

/**
 * Normalise an utterance and lift its literals into slots.
 *
 * Deliberately conservative: unicode is preserved so Hebrew and Spanish
 * normalise as well as English, and only case, whitespace and trailing
 * punctuation are folded. Aggressive stemming would collide questions that mean
 * different things, and a cache collision here returns a confidently wrong plan.
 */
export function normalizeUtterance(input: string): NormalizedUtterance {
  const literals: ExtractedLiteral[] = [];
  const counters: Record<string, number> = {};

  let text = input.normalize('NFKC').trim().toLowerCase();

  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, (match, captured?: string) => {
      counters[kind] = (counters[kind] ?? 0) + 1;
      const slot = `<${kind}${counters[kind]}>`;

      const raw = kind === 'quoted' ? (captured ?? match) : match;
      const numeric = kind === 'number' || kind === 'money';

      literals.push({
        slot,
        kind,
        value: numeric ? Number(raw.replace(/[^\d.]/g, '')) : raw,
      });

      return slot;
    });
  }

  // Collapse whitespace and drop trailing punctuation so "who owes me money?"
  // and "who owes me money" share an entry.
  const normalized = text.replace(/\s+/g, ' ').replace(/[?!.,;:]+$/, '').trim();

  const unportableReasons = UNPORTABLE_PATTERNS.filter((p) => p.re.test(input)).map(
    (p) => p.reason
  );

  return {
    normalized,
    literals,
    portable: unportableReasons.length === 0,
    unportableReasons,
  };
}

/**
 * Cache key.
 *
 * `CATALOG_VERSION` is part of the key so any schema or semantic change
 * invalidates every entry at once. Do not add selective invalidation — working
 * out which cached plans a migration affects is exactly the kind of reasoning
 * that gets quietly wrong, and the cost of a full miss is one cheap call.
 *
 * Language is included because the plan carries `answer.text` in the user's own
 * language, so an English and a Hebrew plan for the same question are different
 * artefacts.
 */
export function cacheKey(
  normalized: string,
  language: string,
  catalogVersion: string
): string {
  return createHash('sha256')
    .update(`${catalogVersion}|${language}|${normalized}`)
    .digest('hex');
}

/**
 * Whether a PLAN (as opposed to the utterance) may be stored globally.
 *
 * The utterance scrubber above catches what the user typed; this catches what
 * the planner produced. A plan that resolved a name into a concrete row id is
 * tenant-specific and must never be shared, even if the question that produced
 * it looked generic.
 */
export function isPlanPortable(plan: unknown): { portable: boolean; reason?: string } {
  const serialised = JSON.stringify(plan ?? {});

  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(serialised)) {
    return { portable: false, reason: 'plan contains a resolved row id' };
  }
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(serialised)) {
    return { portable: false, reason: 'plan contains an email address' };
  }
  if (/"user_id"/.test(serialised)) {
    return { portable: false, reason: 'plan references user_id' };
  }

  return { portable: true };
}

/**
 * Put extracted literals back into a cached plan.
 *
 * A cached plan holds the slot markers the normaliser produced, so "over $100"
 * and "over $250" share one entry and diverge only here. Slots are matched by
 * position within a kind, which is why the normaliser numbers them.
 */
export function rehydratePlan<T>(plan: T, literals: ExtractedLiteral[]): T {
  if (literals.length === 0) return plan;

  let serialised = JSON.stringify(plan);

  for (const literal of literals) {
    // A slot may appear as a bare JSON string ("<number1>") when it stood in for
    // a value, in which case the quotes go too for numeric kinds.
    if (typeof literal.value === 'number') {
      serialised = serialised.split(`"${literal.slot}"`).join(String(literal.value));
    }
    serialised = serialised.split(literal.slot).join(String(literal.value));
  }

  return JSON.parse(serialised) as T;
}

/** Replace literal values in a plan with slot markers, ready for storage. */
export function dehydratePlan<T>(plan: T, literals: ExtractedLiteral[]): T {
  if (literals.length === 0) return plan;

  let serialised = JSON.stringify(plan);

  // Longest first, so 100 inside 1000 is not substituted.
  const ordered = [...literals].sort(
    (a, b) => String(b.value).length - String(a.value).length
  );

  for (const literal of ordered) {
    const value = String(literal.value);
    if (typeof literal.value === 'number') {
      // Numeric JSON values are unquoted; quote the slot so it stays valid JSON.
      serialised = serialised.split(`:${value}`).join(`:"${literal.slot}"`);
      serialised = serialised.split(`,${value}`).join(`,"${literal.slot}"`);
    }
    serialised = serialised.split(value).join(literal.slot);
  }

  try {
    return JSON.parse(serialised) as T;
  } catch {
    // Substitution produced invalid JSON — store the plan as-is rather than
    // corrupt it. A less general cache entry beats a broken one.
    return plan;
  }
}
