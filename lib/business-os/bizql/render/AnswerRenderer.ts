/**
 * Answer rendering: plan + results → the sentence the user reads.
 *
 * There are NO per-operation, per-language response templates here.
 *
 * chat-v3 carried ~120 hand-written strings in ResponseTemplates.ts (one per
 * operation × three languages) plus 35 inline `language === 'he' ? … : …`
 * ternaries, and chat-v2 spent a SECOND `gpt-4o` call writing the final message.
 * Instead the planner emits `answer.text` with `{placeholders}` in the user's own
 * language as part of the plan it already produces, and this module substitutes
 * real values into it. That costs ~15 output tokens, needs no template per
 * operation, works in any language, and is cached along with the plan.
 *
 * The safety property that makes it acceptable: the planner writes the sentence
 * BEFORE seeing any data, and `validatePlan` rejects text containing numbers the
 * user did not supply. The model may phrase; it may not assert facts.
 *
 * @module lib/business-os/bizql/render
 */

import { CATALOG, type ResolvedEntity } from '@/lib/business-os/catalog';
import type { ComputeResult, FindResult, QueryResult, QueryRow } from '../types';

export interface RenderContext {
  language?: string;
  currency?: string;
  timezone?: string;
}

export interface RenderedRow {
  id: string;
  label: string;
  fields: Array<{ key: string; label: string; value: string }>;
}

export interface RenderedAnswer {
  text: string;
  rows: RenderedRow[];
  entity?: string;
  truncated: boolean;
  /** True when an aggregate ran over a capped scan and may be incomplete. */
  approximate: boolean;
}

// =============================================================================
// VALUE FORMATTING — driven by catalog format hints, not by per-entity switches
// =============================================================================

function formatValue(
  value: unknown,
  format: string | undefined,
  ctx: RenderContext,
  row?: QueryRow
): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (format) {
    case 'money': {
      // Prefer the row's own currency over the profile default: a business can
      // invoice in more than one.
      const currency = (row?.currency as string) || ctx.currency || 'USD';
      const amount = Number(value);
      if (Number.isNaN(amount)) return String(value);
      try {
        return new Intl.NumberFormat(ctx.language || 'en', {
          style: 'currency',
          currency,
        }).format(amount);
      } catch {
        return `${amount} ${currency}`;
      }
    }

    case 'date':
    case 'datetime': {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      try {
        return new Intl.DateTimeFormat(ctx.language || 'en', {
          dateStyle: 'medium',
          ...(format === 'datetime' ? { timeStyle: 'short' } : {}),
          timeZone: ctx.timezone || 'UTC',
        }).format(date);
      } catch {
        return date.toISOString();
      }
    }

    case 'tags':
      return Array.isArray(value) ? value.join(', ') : String(value);

    case 'boolean':
      return value ? '✓' : '✗';

    default:
      return String(value);
  }
}

/** Label an embedded parent row, e.g. the contact attached to an invoice. */
function embeddedLabel(
  entity: ResolvedEntity,
  row: QueryRow,
  ctx: RenderContext
): string | undefined {
  for (const [relationKey, relation] of Object.entries(entity.relations ?? {})) {
    if (relation.via.side !== 'local') continue;

    const embedded = row[relationKey];
    if (!embedded || typeof embedded !== 'object') continue;

    const target = CATALOG.entities[relation.target];
    if (!target) continue;

    const label = pickLabel(target, embedded as QueryRow, ctx, false);
    if (label && label !== '—') return label;
  }
  return undefined;
}

/**
 * Name a row the way a person would.
 *
 * When a related parent was pulled in, lead with it: asked "which clients have an
 * unpaid invoice over $100", a list reading "INV-00001, INV-00002" answers a
 * different question than the one asked. "אופיר עמר (INV-00002)" answers both
 * framings, and it is derived from the catalog's relations rather than special-
 * cased per entity.
 */
function pickLabel(
  entity: ResolvedEntity,
  row: QueryRow,
  ctx: RenderContext,
  includeEmbedded = true
): string {
  const keys = Array.isArray(entity.labelField) ? entity.labelField : [entity.labelField];

  const own = keys
    .map((key) => {
      const field = entity.fields[key];
      if (!field) return undefined;
      const raw = row[field.column];
      if (raw === null || raw === undefined || raw === '') return undefined;
      // Respect the field's format hint, so a booking labelled by start_time
      // reads "Aug 26, 2026, 1:00 PM" rather than a raw ISO timestamp.
      return formatValue(raw, field.format, ctx, row);
    })
    .filter((v): v is string => Boolean(v))
    .join(' ');

  const related = includeEmbedded ? embeddedLabel(entity, row, ctx) : undefined;

  if (related && own) return `${related} (${own})`;
  if (related) return related;
  if (own) return own;

  return String(row.id ?? '—').slice(0, 8);
}

function renderRow(entity: ResolvedEntity, row: QueryRow, ctx: RenderContext): RenderedRow {
  const displayKeys = entity.displayFields ?? Object.keys(entity.fields);

  const fields = displayKeys
    .map((key) => {
      const field = entity.fields[key];
      if (!field || field.readable === false) return null;
      if (!(field.column in row)) return null;

      return {
        key,
        label: field.labels[(ctx.language as 'en') ?? 'en'] ?? field.labels.en,
        value: formatValue(row[field.column], field.format, ctx, row),
      };
    })
    .filter((f): f is RenderedRow['fields'][number] => f !== null);

  return { id: String(row.id ?? ''), label: pickLabel(entity, row, ctx), fields };
}

// =============================================================================
// PLACEHOLDER SUBSTITUTION
// =============================================================================

/**
 * Resolve one `{sN.something}` placeholder against a step's result.
 *
 * An unknown placeholder resolves to an empty string rather than being left as
 * literal `{s1.count}` in the user's face — a stray token is better than
 * exposing the internals of a plan.
 */
function resolvePlaceholder(
  expression: string,
  results: Map<string, QueryResult>,
  ctx: RenderContext
): string {
  const [stepId, ...rest] = expression.split('.');
  const path = rest.join('.');
  const result = results.get(stepId);
  if (!result) return '';

  if (result.op === 'find') {
    const find = result as FindResult;
    switch (path) {
      case 'count':
        return String(find.rows.length);
      case 'rows': {
        const entity = CATALOG.entities[find.entity];
        if (!entity) return String(find.rows.length);
        // Keep an inline list short; the full set is rendered as cards.
        return find.rows
          .slice(0, 5)
          .map((row) => pickLabel(entity, row, ctx))
          .join(', ');
      }
      default:
        return String(find.rows.length);
    }
  }

  const compute = result as ComputeResult;

  if (path === 'groups' && compute.groups) {
    return compute.groups.map((g) => `${g.key}: ${g.value}`).join(', ');
  }

  if (compute.value === null) return '0';

  // An aggregate over a money field should read as money. The entity's own
  // format hint decides, so no per-question special-casing is needed.
  const entity = CATALOG.entities[compute.entity];
  const isMoney = Object.values(entity?.fields ?? {}).some((f) => f.format === 'money');

  return isMoney
    ? formatValue(compute.value, 'money', ctx)
    : String(Math.round(compute.value * 100) / 100);
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function renderAnswer(
  answerText: string | undefined,
  steps: Array<{ id?: string }>,
  results: QueryResult[],
  ctx: RenderContext = {}
): RenderedAnswer {
  const byId = new Map<string, QueryResult>();
  steps.forEach((step, index) => {
    if (step.id && results[index]) byId.set(step.id, results[index]);
  });

  // Display the largest find result: with one step that is simply it, and with
  // several it is the one the user most likely meant.
  const findResults = results.filter((r): r is FindResult => r.op === 'find');
  const primary = findResults.sort((a, b) => b.rows.length - a.rows.length)[0];

  const entity = primary ? CATALOG.entities[primary.entity] : undefined;
  const rows = primary && entity ? primary.rows.map((row) => renderRow(entity, row, ctx)) : [];

  // Track whether any placeholder resolved to nothing. A sentence built around a
  // list — "Your clients are {s1.rows}" — collapses to "Your clients are ." when
  // the result is empty, which is worse than saying plainly that there are none.
  let emptySubstitution = false;

  const text = (answerText ?? '').replace(/\{([^}]+)\}/g, (_match, expression: string) => {
    const resolved = resolvePlaceholder(expression.trim(), byId, ctx);
    if (resolved === '') emptySubstitution = true;
    return resolved;
  });

  const useFallback = !text.trim() || (emptySubstitution && primary?.rows.length === 0);

  return {
    text: useFallback ? fallbackText(primary, entity, ctx) : text.trim(),
    rows,
    entity: primary?.entity,
    truncated: findResults.some((r) => r.truncated),
    approximate: results.some((r) => r.op === 'compute' && r.approximate),
  };
}

/**
 * Used only when the planner omitted answer text, or built a sentence around a
 * list that turned out to be empty.
 *
 * Deliberately NOT an English sentence. Hand-written prose here would need
 * translating for every language, which is the pattern this system exists to
 * avoid — and "No אנשי קשר found." is worse than useless for a Hebrew speaker.
 * A localized noun plus a count reads correctly in any language and needs no
 * translation table:  "contacts: 0"  ·  "אנשי קשר: 0"  ·  "contactos: 0"
 */
function fallbackText(
  primary: FindResult | undefined,
  entity: ResolvedEntity | undefined,
  ctx: RenderContext
): string {
  if (!primary || !entity) return '';

  const language = (ctx.language as 'en') ?? 'en';
  const count = primary.rows.length;
  const labels = count === 1 ? entity.labels.one : entity.labels.many;

  return `${labels[language] ?? labels.en}: ${count}`;
}
