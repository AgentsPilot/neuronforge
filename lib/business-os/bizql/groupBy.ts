/**
 * What `group_by` is allowed to mean, in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE
 *
 * `group_by` was one field key on one entity, resolved independently by the
 * validator and the compiler. That made two ordinary questions inexpressible:
 *
 *   "how much revenue did each service bring in?"  — the money is on invoices,
 *   the name is on services. Grouping by `service_id` is not an answer: the user
 *   would be shown a column of UUIDs.
 *
 *   "how much did I invoice each month?" — grouping a timestamp groups by the
 *   INSTANT, so every row becomes its own group and a trend question returns
 *   noise.
 *
 * So the grammar grows two forms, and the parser lives here rather than in
 * either caller. Two independent readings of the same string is how a plan comes
 * to pass validation and then mean something else at execution — the validator
 * accepting `service.name` while the compiler looked for a column called
 * "service.name" would be exactly that bug.
 *
 * The forms:
 *   "status"           a field on this entity            (as before)
 *   "service.name"     a field on a related entity       (labels, not ids)
 *   "issued_at:month"  a date field, truncated to a bucket
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/groupBy
 */

import type { ResolvedEntity, ResolvedField } from '@/lib/business-os/catalog';
import { CATALOG } from '@/lib/business-os/catalog';

export const TIME_BUCKETS = ['day', 'week', 'month', 'year'] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

export type GroupSpec =
  /** A column on the queried entity. */
  | { kind: 'column'; column: string; fieldKey: string }
  /** A date column, truncated to a calendar bucket. */
  | { kind: 'bucket'; column: string; fieldKey: string; bucket: TimeBucket }
  /**
   * A label from a related entity, reached through this entity's foreign key.
   * Rows are bucketed by the id and the ids are resolved to labels afterwards,
   * which keeps the scan single-table and the label lookup user-scoped.
   */
  | {
      kind: 'relation';
      relationKey: string;
      fkColumn: string;
      targetEntity: string;
      /**
       * The columns whose values form the label. Usually one; a contact's label
       * is `first_name` + `last_name`, and grouping by half a person's name is
       * not a grouping anyone asked for.
       */
      targetColumns: string[];
    };

/** Either a parsed spec or the reason it cannot be one. */
export type GroupByParse = { spec: GroupSpec; problem?: undefined } | { problem: string; spec?: undefined };

function readable(entity: ResolvedEntity, fieldKey: string): ResolvedField | undefined {
  const field = entity.fields[fieldKey];
  return field && field.readable !== false ? field : undefined;
}

/** Field keys a caller may group this entity by, for an error message worth reading. */
function groupableFields(entity: ResolvedEntity): string[] {
  return Object.keys(entity.fields).filter((key) => entity.fields[key].readable !== false);
}

/**
 * Parse a `group_by` string against the entity being queried.
 *
 * Never throws: both callers want to report the problem in their own way — the
 * validator collects it alongside others, the compiler raises it as a validation
 * error — and a parser that throws forces one of them to catch.
 */
export function parseGroupBy(entity: ResolvedEntity, spec: string): GroupByParse {
  if (spec.includes(':')) {
    const [fieldKey, bucketRaw] = spec.split(':', 2);
    const field = readable(entity, fieldKey);

    if (!field) {
      return { problem: `unknown field '${entity.key}.${fieldKey}'.` };
    }
    if (field.type !== 'date' && field.type !== 'datetime') {
      return {
        problem:
          `'${entity.key}.${fieldKey}' is a ${field.type}, and only a date can be ` +
          `grouped into ${TIME_BUCKETS.join('/')} buckets.`,
      };
    }
    if (!TIME_BUCKETS.includes(bucketRaw as TimeBucket)) {
      return {
        problem: `unknown time bucket '${bucketRaw}'. Use one of: ${TIME_BUCKETS.join(', ')}.`,
      };
    }

    return {
      spec: { kind: 'bucket', column: field.column, fieldKey, bucket: bucketRaw as TimeBucket },
    };
  }

  if (spec.includes('.')) {
    const [relationKey, targetFieldKey] = spec.split('.', 2);
    const relation = entity.relations?.[relationKey];

    if (!relation) {
      const available = Object.keys(entity.relations ?? {});
      return {
        problem:
          `'${entity.key}' has no relation '${relationKey}'. ` +
          `Available: ${available.join(', ') || 'none'}.`,
      };
    }

    // Grouping means every row lands in exactly one bucket. A one-to-many
    // relation gives a row many targets, so "revenue by service" over an
    // invoice's MANY services has no single answer — and silently picking the
    // first would double-count nothing and mislabel everything.
    if (relation.cardinality !== 'one' || relation.via.side !== 'local') {
      return {
        problem:
          `'${entity.key}.${relationKey}' is a one-to-many relation, so a row does ` +
          `not belong to a single ${relation.target}. Group the ${relation.target} ` +
          `side instead.`,
      };
    }

    const target = CATALOG.entities[relation.target];
    if (!target) {
      return { problem: `relation '${relationKey}' points at unknown entity '${relation.target}'.` };
    }

    const targetField = readable(target, targetFieldKey);
    if (!targetField) {
      return {
        problem:
          `unknown field '${relation.target}.${targetFieldKey}'. ` +
          `To group by what a ${relation.target} is called, use '${relationKey}' on its own.`,
      };
    }

    return {
      spec: {
        kind: 'relation',
        relationKey,
        fkColumn: relation.via.column,
        targetEntity: relation.target,
        targetColumns: [targetField.column],
      },
    };
  }

  // A bare name is a field first — that is what it has always meant — and a
  // relation second.
  const field = readable(entity, spec);
  if (field) {
    return { spec: { kind: 'column', column: field.column, fieldKey: spec } };
  }

  // "group by service" / "group by contact": the target's own label, whatever
  // it is called. This is the form worth having, because the planner should not
  // need to know that a service's name lives in `service_name` and a contact's
  // in two columns — only that the answer should say who or what, not an id.
  const relation = entity.relations?.[spec];
  if (relation) {
    if (relation.cardinality !== 'one' || relation.via.side !== 'local') {
      return {
        problem:
          `'${entity.key}.${spec}' is a one-to-many relation, so a row does not ` +
          `belong to a single ${relation.target}. Group the ${relation.target} side instead.`,
      };
    }

    const target = CATALOG.entities[relation.target];
    if (!target) {
      return { problem: `relation '${spec}' points at unknown entity '${relation.target}'.` };
    }

    const labelKeys = Array.isArray(target.labelField) ? target.labelField : [target.labelField];
    const columns = labelKeys
      .map((key) => readable(target, key)?.column)
      .filter((column): column is string => Boolean(column));

    if (columns.length === 0) {
      return { problem: `'${relation.target}' has no readable label to group by.` };
    }

    return {
      spec: {
        kind: 'relation',
        relationKey: spec,
        fkColumn: relation.via.column,
        targetEntity: relation.target,
        targetColumns: columns,
      },
    };
  }

  return {
    problem:
      `unknown field '${entity.key}.${spec}'. ` +
      `Available: ${groupableFields(entity).join(', ')}` +
      (entity.relations
        ? `; or a related entity: ${Object.keys(entity.relations).join(', ')}.`
        : '.'),
  };
}

/**
 * The calendar bucket a timestamp falls in, as a sortable key.
 *
 * Bucketed in the USER'S timezone, not the server's. A booking at 23:30 on the
 * 31st in Tel Aviv belongs to that month for the person who took it, and to the
 * next one for a server in UTC — which is how a monthly total quietly disagrees
 * with the list it summarises.
 *
 * Keys sort lexicographically into chronological order, which is what lets the
 * caller order a trend without parsing them back into dates.
 */
export function bucketKey(value: unknown, bucket: TimeBucket, timezone: string): string | null {
  if (value === null || value === undefined || value === '') return null;

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;

  // en-CA renders ISO-ordered parts (YYYY-MM-DD), so the pieces can be sliced
  // out without reconstructing a date in the target zone.
  let iso: string;
  try {
    iso = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // An unknown timezone must not lose the row: fall back to UTC.
    iso = date.toISOString().slice(0, 10);
  }

  switch (bucket) {
    case 'year':
      return iso.slice(0, 4);
    case 'month':
      return iso.slice(0, 7);
    case 'day':
      return iso;
    case 'week':
      return isoWeekKey(iso);
  }
}

/**
 * ISO week key, `2026-W35`.
 *
 * ISO weeks start on Monday and belong to the year containing their Thursday,
 * so the last days of December can fall in week 1 of the next year. Computed
 * from the already-localised date parts, so the week matches the day bucket.
 */
function isoWeekKey(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // UTC arithmetic on an already-localised calendar date: the zone shift was
  // applied when the parts were produced, and applying it twice would move days.
  const date = new Date(Date.UTC(y, m - 1, d));

  // Shift to the Thursday of this ISO week; its year is the week-numbering year.
  const day = date.getUTCDay() || 7; // Sunday is 7, not 0.
  date.setUTCDate(date.getUTCDate() + 4 - day);

  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);

  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));

  return `${year}-W${String(week).padStart(2, '0')}`;
}
