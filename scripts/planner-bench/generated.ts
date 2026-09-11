/**
 * The question space, generated from the catalog.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY GENERATE RATHER THAN COLLECT
 *
 * `cases.ts` holds real utterances, each guarding a bug we actually shipped.
 * That makes it an excellent regression suite and a poor measure of coverage:
 * it only contains questions someone already thought to ask, so it can only
 * ever confirm we have not gone backwards.
 *
 * "Is the chat production-ready for read and write?" is a coverage question,
 * and coverage is answerable here for one reason: the capability surface is
 * FINITE AND DECLARED. 24 entities, known fields, known relations, a closed set
 * of question shapes. Unlike open-ended app generation, our question space can
 * be enumerated — so it can be measured instead of sampled by bug report.
 *
 * WHAT THIS DELIBERATELY DOES NOT MEASURE
 *
 * Phrasing quality. These questions are plain and slightly stiff — "how many
 * bookings do I have" rather than "am I busy this week". A planner that fails
 * the plain form has a capability gap; one that passes it may still fail real
 * speech. So this measures the FLOOR, and `cases.ts` measures the ceiling
 * against phrasings that actually broke.
 *
 * The Hebrew and Spanish here are mine and therefore stiffer than a native
 * speaker's. A failure in those languages is worth reading twice before it is
 * believed: it may be measuring my grammar rather than the planner's
 * comprehension.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG } from '@/lib/business-os/catalog';
import type { PlanCase } from './cases';

type Lang = 'en' | 'he' | 'es';

/** The entity's plural name in one language, falling back to English. */
function plural(entity: { labels: { many: Record<string, string> } }, lang: Lang): string {
  return entity.labels.many[lang] ?? entity.labels.many.en;
}

/**
 * Skipped entities.
 *
 * `business_profile` is not queryable by declaration — asking it a find is a
 * validation error by design, so generating one would score a correct refusal
 * as a failure.
 */
function isSkipped(key: string): boolean {
  return CATALOG.entities[key]?.queryable === false;
}

export function generateCases(): PlanCase[] {
  const cases: PlanCase[] = [];
  const langs: Lang[] = ['en', 'he', 'es'];

  for (const [key, entity] of Object.entries(CATALOG.entities)) {
    if (isSkipped(key)) continue;

    const fields = Object.entries(entity.fields);

    // A money field makes "what is the total" a real question for this entity.
    const money = fields.find(([, f]) => f.format === 'money' && !f.aggregateInstead);
    // A date field makes a period question real.
    const dated = fields.find(([, f]) => f.type === 'datetime' || f.format === 'date');
    // An enum makes a status filter real.
    const enumField = fields.find(([, f]) => (f.enumValues?.length ?? 0) > 1);
    /*
     * Only a BELONGS-TO makes "per X" a real question.
     *
     * The first relation used to be taken whatever its cardinality, which
     * generated "break down my services by payment" — services HAS payments,
     * so the grouping runs the wrong way and the only sensible plan is to query
     * payments instead. The model did exactly that and was scored wrong three
     * times per sweep for being right.
     */
    const relation = Object.entries(entity.relations ?? {}).find(
      ([, r]) => r.cardinality === 'one'
    );

    for (const lang of langs) {
      const many = plural(entity as never, lang);

      // ---- list ------------------------------------------------------------
      cases.push({
        id: `gen-${key}-list-${lang}`,
        message:
          lang === 'he' ? `הצג את ה${many} שלי`
          : lang === 'es' ? `muestra mis ${many}`
          : `show my ${many}`,
        language: lang,
        because: `Baseline: the plainest possible read of ${key}. A failure here is a capability gap, not a phrasing one.`,
        expect: { entity: [key], op: ['find'] },
      });

      // ---- count -----------------------------------------------------------
      cases.push({
        id: `gen-${key}-count-${lang}`,
        message:
          lang === 'he' ? `כמה ${many} יש לי`
          : lang === 'es' ? `¿cuántos ${many} tengo?`
          : `how many ${many} do I have`,
        language: lang,
        because: `Counting ${key}. Hebrew "כמה" and Spanish "cuántos" are also the how-MUCH word, which is where sums and counts get confused.`,
        expect: { entity: [key], op: ['compute'], aggFn: 'count' },
      });

      // ---- sum -------------------------------------------------------------
      if (money) {
        const label = money[1].labels[lang] ?? money[1].labels.en;
        cases.push({
          id: `gen-${key}-sum-${lang}`,
          message:
            lang === 'he' ? `מה סך ה${label} של ה${many}`
            : lang === 'es' ? `¿cuál es el total de ${label} de mis ${many}?`
            : `what is the total ${label} of my ${many}`,
          language: lang,
          because: `A money question over ${key}.${money[0]} must sum, not count.`,
          expect: { entity: [key], op: ['compute'], aggFn: 'sum' },
        });
      }

      // ---- status filter ---------------------------------------------------
      if (enumField) {
        const [fieldKey, field] = enumField;
        const value = field.enumValues![0];
        const valueLabel = field.enumLabels?.[value]?.[lang] ?? field.enumLabels?.[value]?.en ?? value;

        /*
         * Name the FIELD, not the word "status".
         *
         * The first enum field is not always the status one — for `tasks` it is
         * `priority` — so "show tasks with status urgent" asked about a field
         * that has no such value, and scored the model wrong for filtering the
         * one that does. Three failures in every sweep that were the corpus's
         * fault, and a corpus that lies about its own cases is worse than no
         * corpus.
         */
        const fieldLabel = field.labels[lang] ?? field.labels.en ?? fieldKey;

        cases.push({
          id: `gen-${key}-status-${lang}`,
          message:
            lang === 'he' ? `הצג ${many} עם ${fieldLabel} ${valueLabel}`
            : lang === 'es' ? `muestra ${many} con ${fieldLabel} ${valueLabel}`
            : `show ${many} with ${fieldLabel} ${valueLabel}`,
          language: lang,
          because: `Filtering ${key}.${fieldKey}. A wrong or missing status filter answers a different question with a bigger number.`,
          expect: { entity: [key], op: ['find'], whereField: fieldKey },
        });
      }

      // ---- date range ------------------------------------------------------
      if (dated) {
        cases.push({
          id: `gen-${key}-period-${lang}`,
          message:
            lang === 'he' ? `כמה ${many} היו לי החודש`
            : lang === 'es' ? `¿cuántos ${many} tuve este mes?`
            : `how many ${many} did I have this month`,
          language: lang,
          because: `A period question over ${key}.${dated[0]} — must use a date anchor, never a hardcoded date.`,
          expect: { entity: [key], op: ['compute'] },
        });
      }

      // ---- group by --------------------------------------------------------
      if (relation && money) {
        const relLabel =
          CATALOG.entities[relation[1].target]?.labels.one[lang] ??
          CATALOG.entities[relation[1].target]?.labels.one.en ??
          relation[0];

        cases.push({
          id: `gen-${key}-group-${lang}`,
          message:
            lang === 'he' ? `פלח את ה${many} לפי ${relLabel}`
            : lang === 'es' ? `desglosa mis ${many} por ${relLabel}`
            : `break down my ${many} by ${relLabel}`,
          language: lang,
          because: `Grouping ${key} by ${relation[0]}. Grouping by the raw id shows the user a uuid.`,
          expect: { entity: [key], op: ['compute'] },
        });
      }
    }
  }

  return cases;
}
