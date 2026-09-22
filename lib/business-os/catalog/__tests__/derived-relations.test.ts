/**
 * Every link between two declared entities is traversable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * Relations were hand-written, and the hand fell behind: 42 edges declared
 * against 150 the database publishes, with seven entities declaring none at all.
 * `proposals` was one of them, so "when is the first meeting of the proposal"
 * was structurally unanswerable while `proposals.booking_id` sat on every row,
 * in the database and in the physical catalog.
 *
 * Nothing failed when that happened. A migration added a foreign key, no test
 * noticed, and the chat quietly could not follow it. This is the test that
 * notices — it compares what the physical catalog KNOWS against what the
 * resolved catalog OFFERS, so the two cannot drift apart again.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CATALOG, SEMANTIC_CATALOG } from '..';
import { PHYSICAL_CATALOG } from '../catalog.generated';

/** Physical table -> the entity that speaks for it. */
const tableToEntity = new Map(
  Object.entries(SEMANTIC_CATALOG).map(([key, def]) => [def.table, key])
);

/** Every FK that joins two entities the catalog actually declares. */
function reachableForeignKeys() {
  const edges: Array<{ entity: string; column: string; target: string }> = [];

  for (const [entityKey, def] of Object.entries(SEMANTIC_CATALOG)) {
    const table = PHYSICAL_CATALOG.tables[def.table];
    if (!table) continue;

    for (const column of table.columns) {
      if (!column.foreignKey) continue;
      // Tenant scope is on every table and is not a link a person traverses.
      if (column.name === def.userScope?.column) continue;

      const target = tableToEntity.get(column.foreignKey.table);
      if (target) edges.push({ entity: entityKey, column: column.name, target });
    }
  }

  return edges;
}

describe('the catalog offers every link the database declares', () => {
  it('has at least one such link to check, so this test cannot pass vacuously', () => {
    expect(reachableForeignKeys().length).toBeGreaterThan(10);
  });

  it.each(reachableForeignKeys())(
    '$entity.$column reaches $target',
    ({ entity, column, target }) => {
      const relations = Object.values(CATALOG.entities[entity]?.relations ?? {});

      const reaches = relations.some(
        (r) => r.target === target && r.via.side === 'local' && r.via.column === column
      );

      expect(reaches).toBe(true);
    }
  );
});

describe('what is derived and what is declared', () => {
  it('lets a hand-written relation win, so a better word survives', () => {
    /*
     * `contacts.transactions` is declared by hand with the label "payments" —
     * the word a business owner uses. Derivation must never overwrite that.
     */
    const declared = SEMANTIC_CATALOG.contacts?.relations ?? {};
    const resolved = CATALOG.entities.contacts?.relations ?? {};

    for (const [key, relation] of Object.entries(declared)) {
      expect(resolved[key]).toEqual(relation);
    }
  });

  it('names a derived relation after its column, so two links to one entity both survive', () => {
    // A proposal points at another proposal (the version it replaced) AND at a
    // contact. Keying by target would collapse repeats and lose one silently.
    const proposals = CATALOG.entities.proposals?.relations ?? {};

    expect(proposals.supersedes?.target).toBe('proposals');
    expect(proposals.contact?.target).toBe('contacts');
    expect(proposals.booking?.target).toBe('bookings');
  });

  it('never points a relation at an entity that does not exist', () => {
    for (const entity of Object.values(CATALOG.entities)) {
      for (const relation of Object.values(entity.relations ?? {})) {
        expect(CATALOG.entities[relation.target]).toBeDefined();
      }
    }
  });
});
