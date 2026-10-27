/**
 * Block KPIs on the five-tile grid (the user's request of 2026-10-27;
 * docs/workplans/ADMIN_BLOCK_KPI_5_GRID_WORKPLAN.md).
 *
 * Every admin file that renders the shared `BlockKpi` also imports the shared
 * `KpiStrip`, the page-top strip's grid that its tiles sit in. A new caller
 * that drops a block KPI straight into a section fails here; the render tests
 * beside each caller prove the tile's parent is that grid.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ADMIN = path.join(process.cwd(), 'app', 'admin');
const BLOCK_KPI_FILE = path.join(ADMIN, 'components', 'layout', 'BlockKpi.tsx');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sources(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('every BlockKpi caller puts its tiles on the KpiStrip grid', () => {
  const callers = sources(ADMIN).filter(
    (file) => file !== BLOCK_KPI_FILE && /<BlockKpi\b/.test(stripComments(fs.readFileSync(file, 'utf8')))
  );

  it('finds the known callers (Credits, Client payments, Leak check)', () => {
    const names = callers.map((file) => path.basename(file)).sort();
    expect(names).toEqual(expect.arrayContaining(['CreditsSection.tsx', 'LeakCheckPanel.tsx', 'TakingsSection.tsx']));
  });

  it('each caller imports KpiStrip from the shared layout folder and renders it', () => {
    for (const file of callers) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect({ file, imports: /import \{[^}]*\bKpiStrip\b[^}]*\} from '@\/app\/admin\/components\/layout\/KpiStrip'/.test(code) }).toEqual({
        file,
        imports: true,
      });
      expect({ file, renders: /<KpiStrip>/.test(code) }).toEqual({ file, renders: true });
    }
  });
});
