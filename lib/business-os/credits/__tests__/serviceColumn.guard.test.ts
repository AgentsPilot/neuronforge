/**
 * N-10 / KI-14 — nobody filters or groups the credit ledger on the RAW
 * `service` column.
 *
 * An adjustment row stores `service` NULL and inherits it from the charge it
 * corrects. A query `.eq('service', 'ai')`, a SQL `GROUP BY service`, or a Node
 * grouping on `row.service` silently drops every correction from its service.
 * The effective service is resolved in ONE place, `effectiveFields.ts`; every
 * other file in the credits module and the read repository must go through it.
 *
 * Every rule is proved against a planted violation first: a rule that cannot
 * match reads exactly like a rule that found nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const CREDITS_DIR = 'lib/business-os/credits';
const READ_REPOSITORY = 'lib/repositories/BusinessOsCreditLedgerReadRepository.ts';
/** The one file allowed to read a row's own `service`. */
const RESOLVER = `${CREDITS_DIR}/effectiveFields.ts`;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** Comments stripped: prose about the column is not a query on it. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RULES = [
  {
    name: 'a PostgREST filter or order on service',
    pattern: /\.(eq|neq|in|is|like|ilike|filter|order|or|match|not)\(\s*['"`]service['"`]/,
    mustMatch: [`q.eq('service', 'ai')`, `q.in("service", list)`, 'q.order(`service`)'],
  },
  {
    name: 'an or-expression on service',
    pattern: /['"`][^'"`]*\bservice\.(eq|in|is|neq)\./,
    mustMatch: [`q.or('service.eq.ai,kind.eq.adjustment')`],
  },
  {
    name: 'SQL grouping or filtering on service',
    pattern: /group\s+by\s+(\w+\.)?service\b|where\s+(\w+\.)?service\s*=|\band\s+(\w+\.)?service\s*=/i,
    mustMatch: ['SELECT sum(credits) FROM c GROUP BY service', 'where c.service = $1'],
  },
  {
    name: 'a Node read of a row\'s own service (outside the resolver)',
    pattern: /\.service\b/,
    mustMatch: ['groupBy(rows, (r) => r.service)', 'if (row.service === "ai")'],
  },
] as const;

const files = [...sourceFiles(CREDITS_DIR), READ_REPOSITORY];

describe('N-10: no grouping or filtering on the raw service column', () => {
  it('scans the credits module and the read repository', () => {
    expect(files).toEqual(expect.arrayContaining([RESOLVER, `${CREDITS_DIR}/creditReport.ts`, READ_REPOSITORY]));
  });

  it.each(RULES.map((r) => [r.name, r] as const))('the rule "%s" matches its planted violations', (_n, rule) => {
    for (const sample of rule.mustMatch) {
      expect({ sample, matched: rule.pattern.test(sample) }).toEqual({ sample, matched: true });
    }
  });

  it('the Node rule does not fire on the resolved field name', () => {
    expect(/\.service\b/.test('f.effectiveService')).toBe(false);
  });

  it.each(files)('%s obeys every rule', (file) => {
    const code = codeOf(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const rule of RULES) {
      // The resolver is the one place a row's own service is read.
      if (file === RESOLVER && rule.name.startsWith('a Node read')) continue;
      expect({ file, rule: rule.name, matched: rule.pattern.test(code) }).toEqual({
        file,
        rule: rule.name,
        matched: false,
      });
    }
  });
});
