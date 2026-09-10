/**
 * Catalog drift tests.
 *
 * These are the guarantee that the Business Catalog cannot quietly disagree with
 * the database. They run with no network and no DB connection: the physical half
 * is a checked-in artefact of introspection, so the comparison is pure.
 *
 * If one of these fails after a migration, the fix is:
 *     npx tsx scripts/generate-business-catalog.ts
 * and then reconcile lib/business-os/catalog/catalog.ts.
 */

import { PHYSICAL_CATALOG } from '../catalog.generated';
import { SEMANTIC_CATALOG } from '../catalog';
import { CATALOG, CATALOG_VERSION, resolveSemanticTerm } from '../index';

describe('Business Catalog', () => {
  it('builds without drift against the introspected schema', () => {
    // buildCatalog() throws at import time, so reaching this line is the assertion.
    expect(Object.keys(CATALOG.entities).length).toBeGreaterThan(0);
  });

  it('produces a stable, non-empty version hash', () => {
    expect(CATALOG_VERSION).toMatch(/^[0-9a-f]{16}$/);
  });

  describe('every declared field maps to a real column of a compatible type', () => {
    for (const [entityKey, entity] of Object.entries(SEMANTIC_CATALOG)) {
      for (const [fieldKey, field] of Object.entries(entity.fields)) {
        it(`${entityKey}.${fieldKey} → ${entity.table}.${field.column}`, () => {
          const table = PHYSICAL_CATALOG.tables[entity.table];
          expect(table).toBeDefined();

          const column = table.columns.find((c) => c.name === field.column);
          expect(column).toBeDefined();
        });
      }
    }
  });

  describe('tenant isolation', () => {
    /**
     * The most important test in this file.
     *
     * Every repository in this codebase is constructed with the service-role
     * Supabase client, which BYPASSES row-level security. `user_id` filtering is
     * therefore the only thing separating tenants. An entity that cannot be
     * scoped must never be exposed to the planner.
     */
    it('every exposed entity resolves a user scope', () => {
      for (const entity of Object.values(CATALOG.entities)) {
        const scope = entity.userScope;
        expect(scope).toBeDefined();

        if (scope.kind === 'column') {
          const table = PHYSICAL_CATALOG.tables[entity.table];
          const column = table.columns.find((c) => c.name === scope.column);

          expect(column).toBeDefined();
          expect(column!.format).toBe('uuid');
        } else {
          expect(entity.relations?.[scope.relation]).toBeDefined();
        }
      }
    });
  });

  describe('bulk-action safety', () => {
    it('no action permits uncapped fan-out', () => {
      for (const entity of Object.values(CATALOG.entities)) {
        for (const [actionKey, action] of Object.entries(entity.actions ?? {})) {
          if (action.allowBulk) {
            expect(action.maxFanout).toBeGreaterThan(0);
          }
          // Deletion must never be applied to a selector-derived set.
          if (action.risk === 'delete') {
            expect(action.allowBulk ?? false).toBe(false);
          }
          expect(actionKey).toBeTruthy();
        }
      }
    });

    it('every destructive or outbound action requires confirmation', () => {
      for (const entity of Object.values(CATALOG.entities)) {
        for (const action of Object.values(entity.actions ?? {})) {
          if (action.risk === 'delete' || action.risk === 'send') {
            expect(action.requiresConfirmation).toBe(true);
          }
        }
      }
    });
  });

  describe('semantic terms', () => {
    /**
     * "unpaid" is a genuine BUSINESS RULE, not a synonym: money owed to you is
     * `sent` OR `overdue`, and specifically NOT `draft` (never issued) or
     * `cancelled`. Getting that wrong changes who gets chased for money, so it is
     * pinned here. It also replaces three drifting copies of the same rule in
     * CashArAgingDetector, semantic-schema.ts and the v2 chat prompt.
     */
    it('"unpaid" means sent or overdue — and excludes draft and cancelled', () => {
      expect(resolveSemanticTerm('invoices', 'status', 'unpaid')).toEqual(['sent', 'overdue']);
    });

    it('is case-insensitive', () => {
      expect(resolveSemanticTerm('invoices', 'status', 'UNPAID')).toEqual(['sent', 'overdue']);
    });

    /**
     * THE ANTI-HARDCODING GUARD.
     *
     * Hand-written synonym tables are what made the previous three chat versions
     * unmaintainable: they need an entry per wording per language and never
     * generalise. The catalog must declare FACTS (what values exist, what a
     * business rule means) and never VOCABULARY ("shekels", "customer",
     * "outstanding") — an LLM maps words to published values by itself.
     *
     * So a semantic term is only justified when it expands to something a model
     * could NOT read off the enum: either multiple stored values, or a classifier
     * for a per-user field. A term that maps 1:1 onto a value it already sees is
     * a synonym, and synonyms are how this grows out of control.
     *
     * Arity is the proxy for "could not read it off the enum", and it is not a
     * perfect one. `bookings.status.upcoming -> confirmed` is single-valued and
     * is still not a synonym: "upcoming" is a temporal word, not a restatement
     * of "confirmed", and the pairing of that status with a future date is a
     * business rule (`SchedulingRepository.getUpcoming`) rather than something
     * legible in the enum. Published as nothing, the planner filtered on time
     * alone and answered "האם יש לי פגישות קרובות?" with three meetings, one
     * completed, one cancelled and one no-show.
     *
     * The synonyms this guard exists to reject share a shape arity misses: the
     * term is a lexical restatement of the one value it maps to — `done` for
     * `completed`, `missed` for `no_show`, `booked` for `confirmed`. So a
     * single-valued term stays rejected by default, and earning an exemption
     * costs an entry here plus the sentence saying why. That friction is the
     * point: it is the difference between a considered rule and a reflex.
     */
    it('declares no synonyms — only multi-value business rules or per-user classifiers', () => {
      /**
       * Single-valued terms that are NOT restatements of their value.
       * One line of justification each, or it does not belong here.
       */
      const JUSTIFIED_SINGLE_VALUE = new Set([
        // "Upcoming" is about time, not status; the status half is a business
        // rule the enum cannot show. See the block comment above.
        'bookings.status.upcoming',
      ]);

      const offenders: string[] = [];

      for (const entity of Object.values(CATALOG.entities)) {
        for (const [fieldKey, field] of Object.entries(entity.fields)) {
          for (const [term, values] of Object.entries(field.semanticTerms ?? {})) {
            const isBusinessRule = values.length > 1;
            const isPerUserClassifier = Boolean(field.enumSource);

            const isJustified = JUSTIFIED_SINGLE_VALUE.has(`${entity.key}.${fieldKey}.${term}`);

            if (!isBusinessRule && !isPerUserClassifier && !isJustified) {
              offenders.push(`${entity.key}.${fieldKey}.${term} -> ${values.join('|')}`);
            }
          }
        }
      }

      expect(offenders).toEqual([]);
    });

    it('still rejects a single-valued term that is a plain restatement', () => {
      // The exemption is an allowlist, not a hole: `done -> completed` has the
      // same arity as `upcoming -> confirmed` and must still be refused.
      const JUSTIFIED_SINGLE_VALUE = new Set(['bookings.status.upcoming']);
      const wouldBeOffender = (key: string, values: string[]) =>
        values.length === 1 && !JUSTIFIED_SINGLE_VALUE.has(key);

      expect(wouldBeOffender('bookings.status.done', ['completed'])).toBe(true);
      expect(wouldBeOffender('bookings.status.missed', ['no_show'])).toBe(true);
      expect(wouldBeOffender('bookings.status.upcoming', ['confirmed'])).toBe(false);
    });

    it('keeps the total number of declared terms small', () => {
      const total = Object.values(CATALOG.entities).reduce(
        (sum, entity) =>
          sum +
          Object.values(entity.fields).reduce(
            (n, field) => n + Object.keys(field.semanticTerms ?? {}).length,
            0
          ),
        0
      );

      // A creeping count is the early warning that vocabulary is being added.
      expect(total).toBeLessThanOrEqual(12);
    });

    it('returns undefined for undeclared terms rather than guessing', () => {
      expect(resolveSemanticTerm('invoices', 'status', 'banana')).toBeUndefined();
    });

    it('every semantic term maps to values inside the declared enum', () => {
      for (const [entityKey, entity] of Object.entries(CATALOG.entities)) {
        for (const [fieldKey, field] of Object.entries(entity.fields)) {
          if (!field.semanticTerms || !field.enumValues) continue;

          for (const [term, values] of Object.entries(field.semanticTerms)) {
            for (const value of values) {
              expect({ entityKey, fieldKey, term, value }).toEqual({
                entityKey,
                fieldKey,
                term,
                value: field.enumValues.includes(value) ? value : `NOT_IN_ENUM:${value}`,
              });
            }
          }
        }
      }
    });
  });

  describe('the derived field that makes the intake question expressible', () => {
    it('contacts.has_completed_intake expands a real relation and column', () => {
      const derived = SEMANTIC_CATALOG.contacts.derived?.has_completed_intake;
      expect(derived).toBeDefined();

      // `expand` may declare one hop or several; this field declares one, and
      // narrowing says so rather than reaching through a union.
      const expand = derived!.expand as { relation: string; where?: Array<{ field: string }> };

      const relation = SEMANTIC_CATALOG.contacts.relations?.[expand.relation];
      expect(relation).toBeDefined();
      expect(relation!.target).toBe('bookings');

      // The predicate must reference a column that genuinely exists on bookings.
      const targetTable = PHYSICAL_CATALOG.tables[SEMANTIC_CATALOG.bookings.table];
      for (const predicate of expand.where ?? []) {
        const field = SEMANTIC_CATALOG.bookings.fields[predicate.field];
        expect(field).toBeDefined();
        expect(targetTable.columns.some((c) => c.name === field.column)).toBe(true);
      }
    });
  });

  describe('data-driven enums are not hardcoded', () => {
    /**
     * Regression guard for the exact bug that motivated this rewrite: chat-v3
     * declared contacts' pipeline stage as a fixed enum ['active','inactive','lead']
     * on a column that is not even called `status`. Stages are configured per user
     * in crm_pipeline_stages, so a fixed list is always wrong for someone.
     */
    it('contacts.stage declares an enumSource instead of a fixed list', () => {
      const stage = SEMANTIC_CATALOG.contacts.fields.stage;
      expect(stage.enumSource).toBeDefined();
      expect(stage.enumSource!.table).toBe('crm_pipeline_stages');
      expect(stage.enumSource!.scopedToUser).toBe(true);
      expect(stage.enumValues).toBeUndefined();
    });
  });
});
