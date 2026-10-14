/**
 * Logging standard pin for `app/api/help-bot-v2/route.ts` (RLS slice 2c-1,
 * R-11 + SA CR-1, 2026-10-14).
 *
 * The route was converted from `console.*` to Pino. CLAUDE.md rule 3 also
 * requires API routes to attach a correlationId: `POST` derives one and every
 * helper it calls logs through the request-scoped child logger. Source-level,
 * so a regression to `console.*` or a dropped correlationId fails here.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(process.cwd(), 'app', 'api', 'help-bot-v2', 'route.ts'), 'utf8');

describe('help-bot-v2 route logging (R-11, CR-1)', () => {
  it('has no console.* call', () => {
    expect(src).not.toMatch(/\bconsole\./);
  });

  it('derives a correlationId and logs through a request-scoped child logger', () => {
    expect(src).toContain("request.headers.get('x-correlation-id') || crypto.randomUUID()");
    expect(src).toContain('logger.child({ correlationId })');
  });

  it('the module logger is used only to build the request child (helpers log through the passed logger)', () => {
    expect(src.match(/\blogger\.\w+\(/g)).toEqual(['logger.child(']);
  });
});
