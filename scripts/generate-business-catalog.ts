/**
 * Generate the physical half of the Business Catalog by introspecting the live database.
 *
 *   npx tsx scripts/generate-business-catalog.ts
 *
 * Writes lib/business-os/catalog/catalog.generated.ts.
 *
 * Introspection goes through PostgREST's OpenAPI document (GET /rest/v1/), which
 * reports every table's columns, Postgres types, NOT NULL set, primary key and
 * foreign keys. That avoids adding a Postgres driver or a connection string just
 * to read the schema.
 *
 * Known limitation, stated plainly because it shapes how the semantic layer is
 * written: PostgREST does NOT expose CHECK-constraint values. This repo encodes
 * status enums as CHECK constraints, so allowed values cannot be verified
 * automatically. The drift test therefore verifies column EXISTENCE and TYPE,
 * not enum membership. Where the allowed values are data-driven (contacts.stage
 * references crm_pipeline_stages), the semantic layer declares `enumSource` and
 * the compiler resolves them per user at runtime.
 */

import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

config({ path: '.env.local', quiet: true });

/** Tables the AI worker is allowed to know about. Extend deliberately. */
const TABLES = [
  'crm_contacts',
  'crm_tasks',
  'payment_invoices',
  'payment_transactions',
  'scheduling_bookings',
  'scheduling_services',
  'crm_pipeline_stages',
];

interface OpenApiProperty {
  format?: string;
  type?: string;
  description?: string;
  default?: unknown;
}

interface OpenApiDefinition {
  required?: string[];
  properties?: Record<string, OpenApiProperty>;
}

const PK_MARKER = '<pk/>';
const FK_PATTERN = /<fk table='([^']+)' column='([^']+)'\/>/;

function parseDescription(raw: string | undefined): {
  isPrimaryKey: boolean;
  foreignKey?: { table: string; column: string };
  description?: string;
} {
  if (!raw) return { isPrimaryKey: false };

  const isPrimaryKey = raw.includes(PK_MARKER);
  const fkMatch = raw.match(FK_PATTERN);

  // Strip PostgREST's machine markers so only the human comment survives.
  const description = raw
    .replace(PK_MARKER, '')
    .replace(FK_PATTERN, '')
    .replace(/Note: This is a Primary Key\./g, '')
    .replace(/Note: This is a Foreign Key to `[^`]+`\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    isPrimaryKey,
    foreignKey: fkMatch ? { table: fkMatch[1], column: fkMatch[2] } : undefined,
    description: description || undefined,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
    process.exit(1);
  }

  console.log(`Introspecting ${new URL(url).host} ...`);

  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });

  if (!response.ok) {
    console.error(`Introspection failed: HTTP ${response.status}`);
    process.exit(1);
  }

  const doc = (await response.json()) as { definitions?: Record<string, OpenApiDefinition> };
  const definitions = doc.definitions ?? {};

  const tables: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const table of TABLES) {
    const def = definitions[table];
    if (!def?.properties) {
      missing.push(table);
      continue;
    }

    const required = new Set(def.required ?? []);
    const columns = Object.entries(def.properties).map(([name, prop]) => {
      const meta = parseDescription(prop.description);
      return {
        name,
        format: prop.format ?? 'unknown',
        jsonType: prop.type ?? 'unknown',
        required: required.has(name),
        isPrimaryKey: meta.isPrimaryKey,
        ...(meta.foreignKey ? { foreignKey: meta.foreignKey } : {}),
        ...(meta.description ? { description: meta.description } : {}),
      };
    });

    tables[table] = { name: table, columns };
    console.log(`  ${table.padEnd(24)} ${columns.length} columns`);
  }

  if (missing.length > 0) {
    console.error(`\nTables not found in the database: ${missing.join(', ')}`);
    process.exit(1);
  }

  const payload = {
    // Deliberately NOT a timestamp of "now" in the hashed content — see index.ts.
    // This is metadata only; the catalog version hashes structure, not run time.
    generatedAt: new Date().toISOString(),
    source: new URL(url).host,
    tables,
  };

  const banner = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by: npx tsx scripts/generate-business-catalog.ts
 * Source     : ${payload.source}
 * Generated  : ${payload.generatedAt}
 *
 * This is the PHYSICAL half of the Business Catalog: what columns actually exist
 * in the database. The hand-authored semantic half lives in ./catalog.ts, and
 * ./index.ts fails loudly when the two disagree.
 *
 * Re-run the generator after every migration. A stale file will surface as a
 * failing catalog-drift test, not as a silent production bug.
 */

import type { PhysicalCatalog } from './catalog.schema';

export const PHYSICAL_CATALOG: PhysicalCatalog = ${JSON.stringify(payload, null, 2)} as const;
`;

  const outPath = resolve(process.cwd(), 'lib/business-os/catalog/catalog.generated.ts');
  writeFileSync(outPath, banner, 'utf8');

  console.log(`\nWrote ${outPath}`);
  console.log(`${Object.keys(tables).length} tables captured.`);
}

main().catch((err) => {
  console.error('Catalog generation failed:', err);
  process.exit(1);
});
