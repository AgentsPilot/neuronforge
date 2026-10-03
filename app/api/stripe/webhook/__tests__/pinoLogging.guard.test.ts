/**
 * Source guard: the Stripe webhook logs through Pino, with a request
 * correlation, and never logs a payload.
 *
 * Plan payments P-0 (= Credits Boost slice 0) converted all 173 `console.*`
 * calls in this route to structured Pino (CLAUDE.md rule 3). These tests keep
 * it that way:
 *
 *   - no `console.*` anywhere in the file;
 *   - a module logger from `@/lib/logger`, declared once;
 *   - `POST` builds a request child with a `correlationId` and binds the Stripe
 *     event id (boost §18.4: the event id is the webhook's correlation);
 *   - no log call carries a payload: no `JSON.stringify`, no `metadata` object
 *     as a value (only `Object.keys(…metadata…)`), and no field that would put
 *     client personal or card data in the logs. `@/lib/logger` has no redaction
 *     today, so what is not logged is the only protection;
 *   - errors are logged as `{ err }`.
 *
 * Source-level on purpose, like `emptyBody.guard.test.ts`: importing a
 * 2,700-line route to assert on its text would test its imports. The AST is
 * used rather than regexes over the text, so words in comments and messages
 * cannot trip the guard, and names are matched whole (SA P0-C5: `card` must not
 * match `discard`, so nobody is tempted to weaken the guard).
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const ROUTE = path.join(process.cwd(), 'app/api/stripe/webhook/route.ts');
const source = fs.readFileSync(ROUTE, 'utf8');
const sf = ts.createSourceFile(ROUTE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const LOG_METHODS = new Set(['info', 'warn', 'error', 'debug', 'trace', 'fatal']);
/** Fields that would put a client's personal or card data into the logs. */
const FORBIDDEN_NAMES = new Set([
  'email',
  'customer_details',
  'customer_email',
  'billing_details',
  'payment_method_details',
  'card',
  'phone',
  'address',
]);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function isLogCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const object = node.expression.expression;
  return (
    ts.isIdentifier(object) &&
    (object.text === 'log' || object.text === 'logger') &&
    LOG_METHODS.has(node.expression.name.text)
  );
}

const logCalls: ts.CallExpression[] = [];
walk(sf, (n) => {
  if (isLogCall(n)) logCalls.push(n);
});

const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** The object literal a log call passes as context, if any. */
function contextOf(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const [first] = call.arguments;
  return first && ts.isObjectLiteralExpression(first) ? first : null;
}

function hasErrKey(call: ts.CallExpression): boolean {
  const ctx = contextOf(call);
  return !!ctx?.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === 'err'
  );
}

function postFunction(): ts.FunctionDeclaration {
  const post = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'POST'
  );
  if (!post) throw new Error('POST not found');
  return post;
}

describe('stripe webhook: Pino logging (P-0)', () => {
  it('contains no console.* call', () => {
    const consoleUses: number[] = [];
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && n.text === 'console') consoleUses.push(lineOf(n));
    });
    expect(consoleUses).toEqual([]);
  });

  it('imports createLogger from @/lib/logger and declares the module logger once', () => {
    const imports = sf.statements.filter(
      (s): s is ts.ImportDeclaration =>
        ts.isImportDeclaration(s) &&
        ts.isStringLiteral(s.moduleSpecifier) &&
        s.moduleSpecifier.text === '@/lib/logger'
    );
    expect(imports).toHaveLength(1);
    expect(imports[0].getText(sf)).toContain('createLogger');

    const declarations: string[] = [];
    walk(sf, (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        n.initializer &&
        ts.isCallExpression(n.initializer) &&
        ts.isIdentifier(n.initializer.expression) &&
        n.initializer.expression.text === 'createLogger'
      ) {
        declarations.push(n.name.getText(sf));
      }
    });
    expect(declarations).toEqual(['logger']);
  });

  it('logs only through log/logger at real levels (has at least the 173 converted calls)', () => {
    expect(logCalls.length).toBeGreaterThanOrEqual(173);
  });

  it('POST builds a request child carrying a correlationId, then binds the Stripe event id', () => {
    const post = postFunction().getText(sf);
    expect(post).toMatch(/logger\.child\(\{\s*correlationId:/);
    expect(post).toMatch(/log\.child\(\{\s*stripeEventId:\s*event\.id/);
    // Bound after verification, so the event id is real when it is attached.
    expect(post.indexOf('stripeEventId: event.id')).toBeGreaterThan(post.indexOf('if (!event)'));
    expect(post).toContain('log.child({ connectAccountId })');
  });

  it('passes the request logger to every handler it calls', () => {
    const handlerCalls: string[] = [];
    walk(postFunction(), (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text.startsWith('handle')
      ) {
        const last = n.arguments[n.arguments.length - 1];
        if (!last || !ts.isIdentifier(last) || last.text !== 'log') handlerCalls.push(n.getText(sf));
      }
    });
    expect(handlerCalls).toEqual([]);
  });

  it('never stringifies anything inside a log call', () => {
    const offenders = logCalls.filter((c) => c.arguments.some((a) => a.getText(sf).includes('JSON.stringify')));
    expect(offenders.map(lineOf)).toEqual([]);
  });

  it('logs metadata only as its keys, never as values', () => {
    const offenders: number[] = [];
    for (const call of logCalls) {
      for (const arg of call.arguments) {
        walk(arg, (n) => {
          const isMetadataRead =
            (ts.isPropertyAccessExpression(n) && n.name.text === 'metadata') ||
            (ts.isIdentifier(n) && n.text === 'metadata' && !ts.isPropertyAccessExpression(n.parent));
          if (!isMetadataRead) return;
          // Allowed only as the argument of Object.keys(…).
          let cursor: ts.Node = n;
          let isInsideKeys = false;
          while (cursor !== arg) {
            const parent: ts.Node = cursor.parent;
            if (
              ts.isCallExpression(parent) &&
              parent.expression.getText(sf) === 'Object.keys'
            ) {
              isInsideKeys = true;
              break;
            }
            cursor = parent;
          }
          if (!isInsideKeys) offenders.push(lineOf(n));
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('puts no personal or card field into a log call (names matched whole)', () => {
    const offenders: string[] = [];
    for (const call of logCalls) {
      for (const arg of call.arguments) {
        walk(arg, (n) => {
          if (ts.isIdentifier(n) && FORBIDDEN_NAMES.has(n.text)) offenders.push(`${lineOf(n)}: ${n.text}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('logs errors as { err } in every catch that logs, and in every .catch handler', () => {
    const missing: number[] = [];

    walk(sf, (n) => {
      if (ts.isCatchClause(n)) {
        const inCatch = logCalls.filter((c) => c.pos >= n.block.pos && c.end <= n.block.end);
        if (inCatch.length > 0 && !inCatch.some(hasErrKey)) missing.push(lineOf(n));
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'catch'
      ) {
        const handler = n.arguments[0];
        if (handler) {
          const inHandler = logCalls.filter((c) => c.pos >= handler.pos && c.end <= handler.end);
          if (inHandler.length > 0 && !inHandler.every(hasErrKey)) missing.push(lineOf(n));
        }
      }
    });
    expect(missing).toEqual([]);
  });

  it('uses static messages: the message argument is never a template with values', () => {
    const offenders = logCalls.filter((c) =>
      c.arguments.some((a) => ts.isTemplateExpression(a))
    );
    expect(offenders.map(lineOf)).toEqual([]);
  });

  it('keeps the wording the empty-body guard and log searches rely on', () => {
    expect(source).toContain('Empty request body');
    expect(source).toContain("'Signature verification failed'");
  });
});
