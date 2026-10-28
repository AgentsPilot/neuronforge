/**
 * Source guard on the plan reconcile pass (plan payments P-8b.2; SA ruling 2,
 * "a source guard on planReconcilePass.ts that mirrors routerPlacement"; SA
 * ruling 3, one event type set).
 *
 *   - The pass never calls the route's UNCONDITIONAL `reclaimFailed`; its only
 *     way back into a failed claim is `reclaimFailedIfStillFailed`.
 *   - The handler runs in exactly one place, `runOnWonClaim`, whose claim
 *     parameter is a `WonClaim`, and that is called once, with `attempt.won`
 *     (the value only a won `takeClaim` returns).
 *   - The claim is completed or failed only through `settleClaim`: one
 *     `complete(` and one `markFailed(` in the whole file, both inside it.
 *   - `PLAN_HANDLER_EVENT_TYPES` equals the plan handler's `case` labels, both
 *     ways, and the wiring hands exactly that constant to the pass; neither the
 *     pass nor its wiring writes an event type literal of its own.
 *   - The wiring reuses the webhook's dispatcher, handler, stale age and API
 *     version rather than copying them.
 *
 * AST, so words in comments cannot satisfy or trip it. Pure fs read.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const ROOT = process.cwd();

function parse(relative: string): ts.SourceFile {
  const file = path.join(ROOT, relative);
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function methodCalls(root: ts.Node, method: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(root, (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === method) out.push(n);
  });
  return out;
}

function functionCalls(root: ts.Node, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(root, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
  });
  return out;
}

function functionNamed(root: ts.Node, name: string): ts.FunctionDeclaration {
  let found: ts.FunctionDeclaration | undefined;
  walk(root, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
  });
  if (!found) throw new Error(`function ${name} not found`);
  return found;
}

function inside(node: ts.Node, container: ts.Node): boolean {
  return node.pos >= container.pos && node.end <= container.end;
}

function stringLiterals(root: ts.Node): string[] {
  const out: string[] = [];
  walk(root, (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
  });
  return out;
}

const pass = parse('lib/business-os/billing/planReconcilePass.ts');
const wiring = parse('lib/business-os/billing/planReconcileDeps.ts');
const handler = parse('lib/business-os/billing/planBillingHandler.ts');

/** The exported constant's elements, read from the source (importing the handler would wire production ports). */
const PLAN_HANDLER_EVENT_TYPES: string[] = (() => {
  let found: string[] | null = null;
  walk(handler, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(handler) === 'PLAN_HANDLER_EVENT_TYPES') {
      let init: ts.Expression | undefined = n.initializer;
      while (init && (ts.isSatisfiesExpression(init) || ts.isAsExpression(init))) init = init.expression;
      if (init && ts.isArrayLiteralExpression(init)) {
        found = init.elements.filter(ts.isStringLiteral).map((e) => e.text);
      }
    }
  });
  if (!found) throw new Error('PLAN_HANDLER_EVENT_TYPES not found');
  return found;
})();

describe('planReconcilePass: claim discipline (SA ruling 2)', () => {
  it('never calls the unconditional reclaimFailed; takes a failed claim back only conditionally', () => {
    expect(methodCalls(pass, 'reclaimFailed')).toEqual([]);
    expect(methodCalls(wiring, 'reclaimFailed')).toEqual([]);
    expect(methodCalls(pass, 'reclaimFailedIfStillFailed')).toHaveLength(1);
  });

  it('runs the handler in exactly one place, on a WonClaim, called once with attempt.won', () => {
    const handles = methodCalls(pass, 'handle');
    expect(handles).toHaveLength(1);
    const runner = functionNamed(pass, 'runOnWonClaim');
    expect(inside(handles[0], runner)).toBe(true);
    expect(runner.parameters.map((p) => p.type?.getText(pass))).toContain('WonClaim');

    const calls = functionCalls(pass, 'runOnWonClaim');
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments[1].getText(pass)).toBe('attempt.won');
    // The only `WonClaim` values are built in takeClaim.
    const takeClaim = functionNamed(pass, 'takeClaim');
    const wonLiterals: ts.Node[] = [];
    walk(pass, (n) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(pass) === 'won' && ts.isObjectLiteralExpression(n.initializer)) wonLiterals.push(n);
    });
    expect(wonLiterals.length).toBeGreaterThan(0);
    for (const literal of wonLiterals) expect(inside(literal, takeClaim)).toBe(true);
  });

  it('completes or fails a claim only through settleClaim', () => {
    const settle = functionNamed(pass, 'settleClaim');
    for (const method of ['complete', 'markFailed']) {
      const calls = methodCalls(pass, method);
      expect({ method, count: calls.length }).toEqual({ method, count: 1 });
      expect(inside(calls[0], settle)).toBe(true);
    }
    // settleClaim is reached only from runOnWonClaim.
    const runner = functionNamed(pass, 'runOnWonClaim');
    const settles = functionCalls(pass, 'settleClaim');
    expect(settles.length).toBe(2);
    for (const call of settles) expect(inside(call, runner)).toBe(true);
  });

  it('imports no repository, no database client and no Stripe client of its own (pure given its ports)', () => {
    const imports = pass.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
    expect(imports.sort()).toEqual(['@/lib/business-os/billing/reconcilePassRunner', 'stripe']);
    // `stripe` is a type-only import.
    const stripeImport = pass.statements.filter(ts.isImportDeclaration).find((d) => (d.moduleSpecifier as ts.StringLiteral).text === 'stripe');
    expect(stripeImport?.importClause?.isTypeOnly).toBe(true);
  });
});

describe('one event type set (SA ruling 3)', () => {
  it("PLAN_HANDLER_EVENT_TYPES equals the plan handler's case labels, both ways", () => {
    const labels: string[] = [];
    walk(handler, (n) => {
      if (ts.isSwitchStatement(n) && n.expression.getText(handler) === 'event.type') {
        for (const clause of n.caseBlock.clauses) {
          if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression)) labels.push(clause.expression.text);
        }
      }
    });
    expect(labels.sort()).toEqual([...PLAN_HANDLER_EVENT_TYPES].sort());
    expect(PLAN_HANDLER_EVENT_TYPES).toHaveLength(7);
    expect(PLAN_HANDLER_EVENT_TYPES).toEqual(expect.arrayContaining(['checkout.session.completed', 'checkout.session.expired']));
  });

  it('the wiring hands the pass that constant, and neither file writes an event type of its own', () => {
    const assignments: string[] = [];
    walk(wiring, (n) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(wiring) === 'eventTypes') assignments.push(n.initializer.getText(wiring));
    });
    expect(assignments).toEqual(['handlerModule.PLAN_HANDLER_EVENT_TYPES']);
    const looksLikeEventType = (text: string) => /^(invoice|checkout|customer|charge|payment_intent)\.[a-z_.]+$/.test(text);
    // The one literal: Step C looks again only at a completed `invoice.paid`.
    expect(stringLiterals(pass).filter(looksLikeEventType)).toEqual(['invoice.paid']);
    expect(stringLiterals(wiring).filter(looksLikeEventType)).toEqual([]);
  });
});

describe('the wiring reuses, never copies (SR-3, SR-4)', () => {
  const code = ts.createPrinter({ removeComments: true }).printFile(wiring);

  it.each([
    ['the webhook dispatcher', 'dispatcherModule.dispatchBusinessOsEvent('],
    ['the plan handler', 'handlerModule.handlePlanBillingEvent('],
    ['the stale claim age', 'claimModule.STALE_CLAIM_AGE_MS'],
    ['the verified (api_version, type) pairs of the handler', 'verifiedShapes: handlerModule.PLAN_HANDLER_VERIFIED_EVENT_SHAPES'],
  ])('uses %s', (_name, text) => {
    expect(code).toContain(text);
  });

  it('builds everything lazily: no static import of a repository, the handler or the dispatcher', () => {
    const imports = wiring.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/repositories|planBillingHandler|webhookDispatcher|StripeService/);
    }
  });

  it('neither file logs with console', () => {
    for (const file of [pass, wiring]) expect(file.getFullText()).not.toMatch(/console\./);
  });
});
