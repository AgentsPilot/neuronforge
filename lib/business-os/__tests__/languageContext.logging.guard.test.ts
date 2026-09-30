/**
 * LanguageContext logs through the client Pino logger, not console.*
 * (CLAUDE.md rule 3). Source-level guard modelled on
 * app/admin/users/__tests__/source.guard.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const FILE = 'lib/business-os/LanguageContext.tsx';

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = codeOf(fs.readFileSync(path.join(process.cwd(), FILE), 'utf8'));

describe('LanguageContext logging', () => {
  it('has no console.*', () => {
    expect(code).not.toMatch(/console\./);
  });

  it('logs through the client logger, not the server one', () => {
    expect(code).toMatch(/from ['"]@\/lib\/logger\/client['"]/);
    expect(code).not.toMatch(/createLogger/);
  });
});
