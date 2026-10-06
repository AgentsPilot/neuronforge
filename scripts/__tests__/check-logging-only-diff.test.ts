/**
 * `scripts/check-logging-only-diff.ts` — the "only logging changed" proof used
 * by every rule-3 `console.*` → Pino conversion (first user: the Stripe webhook,
 * plan payments P-0).
 *
 * A check that cannot be shown to fail is not a check, so each side is driven:
 * pairs where only logging changed must pass; pairs where a `return` was
 * dropped, a condition changed, or a log argument gained a side-effecting call
 * must fail or be flagged. The refusal (SA P0-C3) and the `--functions` mode
 * (SA P0-C4, relied on by P-1) are covered too, and so is the `--exact` mode
 * (plan payments P-10, SA P10-C5): plain text equality, no normalisation, no
 * refusal, and the default mode left exactly as it was.
 */

import {
  compareFunctions,
  compareFunctionsExact,
  compareSources,
  findReservedIdentifierUses,
  RefusedError,
} from '../check-logging-only-diff';
import * as ts from 'typescript';

const FILE = 'route.ts';

const BASE = `
import { thing } from '@/lib/thing';

async function handle(invoice: Invoice, accountId: string) {
  console.log('🎯 [Webhook] Processing', invoice.id, 'Account:', accountId);
  const { data, error } = await db.from('t').select('*').eq('id', invoice.id).single();
  if (error) {
    console.error('❌ [Webhook] lookup failed:', error);
    return;
  }
  notify(data).catch(err => console.error('notify failed', err));
  console.log(\`done \${data.id}\`);
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!body) {
    console.error('Empty request body');
    return respond(400);
  }
  await handle(parse(body), 'acct_1');
  return respond(200);
}
`;

/** The faithful conversion of BASE: logger, request child, `log` threaded through. */
const CONVERTED = `
import { thing } from '@/lib/thing';
import { createLogger, type Logger } from '@/lib/logger';

const logger = createLogger({ module: 'stripe-webhook' });

async function handle(invoice: Invoice, accountId: string, log: Logger) {
  log.info({ invoiceId: invoice.id, connectAccountId: accountId }, 'Processing');
  const { data, error } = await db.from('t').select('*').eq('id', invoice.id).single();
  if (error) {
    log.error({ err: error }, 'Lookup failed');
    return;
  }
  notify(data).catch(err => log.error({ err }, 'Notify failed'));
  log.info({ id: data.id }, 'Done');
}

export async function POST(request: Request) {
  let log: Logger = logger.child({ correlationId: request.headers.get('x-correlation-id') });
  const body = await request.text();
  if (!body) {
    log.error({}, 'Empty request body');
    return respond(400);
  }
  log = log.child({ stripeEventId: 'evt_1' });
  await handle(parse(body), 'acct_1', log);
  return respond(200);
}
`;

describe('check-logging-only-diff: passes when only logging changed', () => {
  it('treats a full console → Pino conversion (logger, child, threaded log) as identical', () => {
    const result = compareSources(FILE, BASE, CONVERTED);
    expect(result.diff).toBe('');
    expect(result.identical).toBe(true);
    expect(result.baseLogCalls).toBe(5);
    expect(result.headLogCalls).toBe(5);
  });

  it('ignores comments and formatting', () => {
    const reformatted = BASE.replace(
      "console.error('❌ [Webhook] lookup failed:', error);",
      '// a comment\n    console.error(\n      "different words",\n      { err: error }\n    );'
    );
    expect(compareSources(FILE, BASE, reformatted).identical).toBe(true);
  });
});

describe('check-logging-only-diff: fails on any non-logging edit', () => {
  it('fails when a return is dropped', () => {
    const edited = CONVERTED.replace("log.error({ err: error }, 'Lookup failed');\n    return;", "log.error({ err: error }, 'Lookup failed');");
    expect(edited).not.toBe(CONVERTED);
    const result = compareSources(FILE, BASE, edited);
    expect(result.identical).toBe(false);
    expect(result.diff).toMatch(/^- +return;$/m);
  });

  it('fails when an if condition changes', () => {
    const edited = CONVERTED.replace('if (error) {', 'if (!error) {');
    expect(compareSources(FILE, BASE, edited).identical).toBe(false);
  });

  it('fails when a status code changes', () => {
    const edited = CONVERTED.replace('return respond(400);', 'return respond(500);');
    expect(compareSources(FILE, BASE, edited).identical).toBe(false);
  });

  it('fails when a non-logging statement is added next to the logger setup', () => {
    const edited = CONVERTED.replace(
      "log = log.child({ stripeEventId: 'evt_1' });",
      "log = log.child({ stripeEventId: 'evt_1' });\n  await audit(body);"
    );
    expect(compareSources(FILE, BASE, edited).identical).toBe(false);
  });

  it('fails when a real argument is swapped for the logger', () => {
    const edited = CONVERTED.replace("await handle(parse(body), 'acct_1', log);", 'await handle(parse(body), log);');
    expect(compareSources(FILE, BASE, edited).identical).toBe(false);
  });
});

describe('check-logging-only-diff: lists calls inside log arguments for review', () => {
  it('marks a side-effecting call inside a log argument REVIEW, and pure formatting ok', () => {
    const edited = CONVERTED.replace(
      "log.info({ id: data.id }, 'Done');",
      "log.info({ id: data.id, keys: Object.keys(data), saved: await save(data) }, 'Done');"
    );
    // The AST outside logging is unchanged, so this cannot fail the equality:
    // the listing is what catches it.
    const result = compareSources(FILE, BASE, edited);
    expect(result.identical).toBe(true);
    const save = result.headArgCalls.find((c) => c.text.startsWith('save('));
    const keys = result.headArgCalls.find((c) => c.text.startsWith('Object.keys('));
    expect(save).toMatchObject({ scope: 'handle', isAllowListed: false });
    expect(keys).toMatchObject({ scope: 'handle', isAllowListed: true });
  });

  it('lists the calls in removed logger setup too (they are seen nowhere else)', () => {
    const result = compareSources(FILE, BASE, CONVERTED);
    const texts = result.headArgCalls.map((c) => c.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "createLogger({ module: 'stripe-webhook' })",
        "request.headers.get('x-correlation-id')",
      ])
    );
  });
});

describe('check-logging-only-diff: refuses a base that already uses log/logger (P0-C3)', () => {
  const sf = (text: string) => ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);

  it('refuses when the base passes `log` as a value', () => {
    const base = `function f(log: string) { send(log); }`;
    expect(findReservedIdentifierUses(sf(base)).length).toBeGreaterThan(0);
    expect(() => compareSources(FILE, base, base)).toThrow(RefusedError);
  });

  it('refuses when the base reads a variable named logger outside a log call', () => {
    const base = `const logger = createLogger({}); register(logger);`;
    expect(() => compareSources(FILE, base, base)).toThrow(RefusedError);
  });

  it('accepts a base that is already partly Pino (setup + log calls only)', () => {
    const base = `const logger = createLogger({}); function f() { logger.info({ a: 1 }, 'x'); }`;
    expect(findReservedIdentifierUses(sf(base))).toEqual([]);
    expect(compareSources(FILE, base, base).identical).toBe(true);
  });

  it('does not count property names such as obj.log or { log: 1 }', () => {
    const base = `function f(o: { log: number }) { return o.log + ({ log: 1 }).log; }`;
    expect(findReservedIdentifierUses(sf(base))).toEqual([]);
  });

  it('refuses on the base side only: the route under conversion has no such use today', () => {
    expect(findReservedIdentifierUses(sf(BASE))).toEqual([]);
  });
});

describe('check-logging-only-diff: --functions mode (P0-C4)', () => {
  it('reports each named function identical when only its logging changed', () => {
    const verdicts = compareFunctions(FILE, BASE, CONVERTED, ['handle', 'POST']);
    expect(verdicts.map((v) => [v.name, v.status])).toEqual([
      ['handle', 'identical'],
      ['POST', 'identical'],
    ]);
  });

  it('isolates the function that changed and leaves the others identical', () => {
    const edited = CONVERTED.replace('return respond(400);', 'return respond(500);');
    const verdicts = compareFunctions(FILE, BASE, edited, ['handle', 'POST']);
    expect(verdicts.find((v) => v.name === 'handle')?.status).toBe('identical');
    const post = verdicts.find((v) => v.name === 'POST');
    expect(post?.status).toBe('differs');
    expect(post?.diff).toContain('respond(500)');
  });

  it('reports a function missing on either side', () => {
    const verdicts = compareFunctions(FILE, BASE, CONVERTED.replace('async function handle(', 'async function handle2('), [
      'handle',
      'nope',
    ]);
    expect(verdicts.map((v) => v.status)).toEqual(['missing-in-head', 'missing-in-base']);
  });

  it('ignores edits outside the named functions', () => {
    const edited = `${CONVERTED}\nexport function added() { return 1; }\n`;
    expect(compareFunctions(FILE, BASE, edited, ['handle', 'POST']).every((v) => v.status === 'identical')).toBe(true);
    expect(compareSources(FILE, BASE, edited).identical).toBe(false);
  });
});

describe('check-logging-only-diff: --exact mode (P10-C5)', () => {
  it('passes for identical text, including a base that already uses `log` (no P0-C3 refusal)', () => {
    const verdicts = compareFunctionsExact(FILE, CONVERTED, CONVERTED, ['handle', 'POST']);
    expect(verdicts.map((v) => [v.name, v.status])).toEqual([
      ['handle', 'identical'],
      ['POST', 'identical'],
    ]);
    // The default mode still refuses the same base: --exact did not change it.
    expect(() => compareFunctions(FILE, CONVERTED, CONVERTED, ['handle'])).toThrow(RefusedError);
  });

  it('treats CRLF and LF copies as identical', () => {
    const crlf = CONVERTED.replace(/\n/g, '\r\n');
    expect(compareFunctionsExact(FILE, CONVERTED, crlf, ['handle', 'POST']).every((v) => v.status === 'identical')).toBe(
      true
    );
  });

  it('fails on a one-character change inside a named function, and only for that function', () => {
    const edited = CONVERTED.replace('return respond(400);', 'return respond(401);');
    const verdicts = compareFunctionsExact(FILE, CONVERTED, edited, ['handle', 'POST']);
    expect(verdicts.find((v) => v.name === 'handle')?.status).toBe('identical');
    const post = verdicts.find((v) => v.name === 'POST');
    expect(post?.status).toBe('differs');
    expect(post?.diff).toContain('respond(401)');
  });

  it('fails on a log-only or comment-only edit inside a function (nothing is normalised)', () => {
    const logEdit = CONVERTED.replace("'Lookup failed'", "'Lookup failed!'");
    expect(compareFunctionsExact(FILE, CONVERTED, logEdit, ['handle'])[0].status).toBe('differs');
    // The default mode would call the same edit identical; exact must not.
    expect(compareFunctions(FILE, BASE, logEdit, ['handle'])[0].status).toBe('identical');

    const commentEdit = CONVERTED.replace('  if (error) {', '  // added\n  if (error) {');
    expect(compareFunctionsExact(FILE, CONVERTED, commentEdit, ['handle'])[0].status).toBe('differs');
  });

  it('reports a function missing on either side', () => {
    const renamed = CONVERTED.replace('async function handle(', 'async function handle2(');
    const verdicts = compareFunctionsExact(FILE, CONVERTED, renamed, ['handle', 'nope']);
    expect(verdicts.map((v) => v.status)).toEqual(['missing-in-head', 'missing-in-base']);
  });

  it('ignores edits outside the named functions, including a changed leading comment', () => {
    const documented = CONVERTED.replace('async function handle(', '/** new doc */\nasync function handle(');
    const edited = `${documented}\nexport function added() { return 1; }\n`;
    expect(compareFunctionsExact(FILE, CONVERTED, edited, ['handle', 'POST']).every((v) => v.status === 'identical')).toBe(
      true
    );
  });
});
