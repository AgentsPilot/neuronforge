/**
 * The seed and the code must say the same thing.
 *
 * `archetypes.ts` is the source of truth for the six that ship, and the
 * migration seeds `website_archetypes` from the same values by hand. Two
 * handwritten copies of thirty numbers drift, and the failure is quiet: the
 * repository resolves these four from code first, so a wrong hex in the seed
 * would never show up on a published page — only in the wizard's gallery, where
 * an owner would pick a swatch and get a different site.
 *
 * So the SQL is parsed and compared. It is a text file, which is the only
 * reason this is cheap enough to be worth doing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ARCHETYPES } from '../archetypes';

/*
 * Every migration that writes to `website_archetypes`, in order.
 *
 * More than one file, because a seed can be CORRECTED by a later migration and
 * what has to match the code is the state the database actually ends in, not
 * the state one file leaves it in. Reading only the original seed would fail
 * the moment a typo was fixed the one way it is safe to fix one — with a new
 * migration rather than by editing an applied file.
 */
const MIGRATIONS = [
  '20260922_website_archetypes.sql',
  '20260924_website_archetype_compositions.sql',
  '20260927_archetype_container_units.sql',
].map(file =>
  readFileSync(join(__dirname, '../../../supabase/migrations', file), 'utf8')
);

const SQL = MIGRATIONS.join('\n');

interface SeededRow {
  name: string;
  source: string;
  tokens: any;
  layouts: any;
  composition?: string;
}

/**
 * The rows as the database would hold them once every migration has run.
 *
 * INSERTs first, then the UPDATEs that amend them — which is the order the
 * migrations themselves run in, and the only order that gives the right answer
 * when a later file corrects an earlier one.
 */
function seededRows() {
  const rows: Record<string, SeededRow> = {};

  // `( 'id', 'name', 'source', '{...}'::jsonb, '{...}'::jsonb, ['composition',] n )`
  const tuple =
    /\(\s*'([a-z]+)',\s*'([^']+)',\s*'([^']+)',\s*'(\{[\s\S]*?\})'::jsonb,\s*'(\{[^']*\})'::jsonb,\s*(?:'([a-z]+)',\s*)?\d+\s*\)/g;

  let match: RegExpExecArray | null;
  while ((match = tuple.exec(SQL)) !== null) {
    rows[match[1]] = {
      name: match[2],
      source: match[3],
      tokens: JSON.parse(match[4]),
      layouts: JSON.parse(match[5]),
      composition: match[6],
    };
  }

  // `UPDATE ... SET composition = 'x' WHERE id = 'y'` / `WHERE id IN ('y','z')`
  const compUpdate =
    /UPDATE\s+website_archetypes\s+SET\s+composition\s*=\s*'([a-z]+)'\s+WHERE\s+id\s+(?:=\s*'([a-z]+)'|IN\s*\(([^)]*)\))/gi;
  while ((match = compUpdate.exec(SQL)) !== null) {
    const ids = match[2]
      ? [match[2]]
      : (match[3] ?? '').split(',').map(part => part.trim().replace(/'/g, ''));
    ids.filter(Boolean).forEach(id => {
      if (rows[id]) rows[id].composition = match![1];
    });
  }

  // `jsonb_set(tokens, '{a,b}', '"value"')` corrections to a seeded blob.
  const jsonbSet =
    /SET\s+tokens\s*=\s*jsonb_set\(\s*tokens\s*,\s*'\{([^}]*)\}'\s*,\s*'("[^"]*")'::jsonb\s*\)\s*\n?\s*WHERE\s+id\s*=\s*'([a-z]+)'/gi;
  while ((match = jsonbSet.exec(SQL)) !== null) {
    const row = rows[match[3]];
    if (!row) continue;
    const path = match[1].split(',').map(part => part.trim());
    let node = row.tokens;
    for (const key of path.slice(0, -1)) node = node?.[key];
    if (node) node[path[path.length - 1]] = JSON.parse(match[2]);
  }

  /*
   * The column default, for every row that never names a composition.
   *
   * Rows seeded before the column existed take it, and so does any later row
   * that omits the value — which is what makes an old row keep rendering in the
   * bones it always had. Reading the default out of the DDL rather than
   * hardcoding 'stone' here means this test still tells the truth if the
   * default is ever changed.
   */
  const declaredDefault = /ADD COLUMN IF NOT EXISTS composition\s+TEXT\s+NOT NULL\s+DEFAULT\s+'([a-z]+)'/i
    .exec(SQL)?.[1];

  Object.values(rows).forEach(row => {
    row.composition = row.composition ?? declaredDefault;
  });

  return rows;
}

describe('the archetype seed', () => {
  const rows = seededRows();

  it('seeds every archetype that ships', () => {
    expect(Object.keys(rows).sort()).toEqual(ARCHETYPES.map(a => a.id).sort());
  });

  it.each(ARCHETYPES.map(a => [a.id ?? '', a] as const))(
    '%s matches the object in code, value for value',
    (id, archetype) => {
      const row = rows[id];
      expect(row).toBeDefined();

      expect(row.source).toBe(archetype.source);
      expect(row.tokens.colors).toEqual(archetype.colors);
      expect(row.tokens.fonts).toEqual(archetype.fonts);
      expect(row.tokens.scale).toEqual(archetype.scale);
      expect(row.tokens.borderRadius).toBe(archetype.borderRadius);
      expect(row.tokens.spacing).toBe(archetype.spacing);
      expect(row.layouts).toEqual(archetype.layouts);
      // The column, not the token blob — it selects a stylesheet rather than
      // describing a colour, so it lives beside `layouts` and not inside them.
      expect(row.composition).toBe(archetype.composition);
    }
  );

  it('carries no id, source or layouts inside tokens', () => {
    // `ArchetypeRepository` spreads `tokens` and then sets these three itself.
    // A copy inside the blob would win or lose depending on spread order, which
    // is exactly the kind of thing that works until someone reorders a line.
    Object.values(rows).forEach(row => {
      expect(row.tokens.id).toBeUndefined();
      expect(row.tokens.source).toBeUndefined();
      expect(row.tokens.layouts).toBeUndefined();
    });
  });

  it('does not overwrite a row somebody edited on purpose', () => {
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });
});
