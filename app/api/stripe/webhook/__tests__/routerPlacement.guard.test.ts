/**
 * Source guard: where the Business OS billing router sits in the Stripe
 * webhook, and that the Pilot-Credit conversions it replaced stay gone
 * (plan payments P-1).
 *
 *   - `dispatchBusinessOsEvent` is called once, inside `if (!isConnectEvent)`,
 *     after the Connect split and before the `switch`, so Connect events never
 *     reach it (SR-10) and every platform event does.
 *   - The deny path completes the claim through `completeClaim()`, the same
 *     update the end-of-handler path uses (SA P1-C4).
 *   - `handleInvoicePaid`, the customer-subscription fallback and the
 *     subscription-mode checkout conversion are gone (as-built G-6).
 *   - The router is called from this route only: one endpoint (SR-3).
 *   - The 500 body carries no internal message outside development (SA P1-C5).
 *
 * AST rather than regexes, like `pinoLogging.guard.test.ts`, so words in
 * comments cannot satisfy or trip it.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const ROOT = process.cwd();
const ROUTE = path.join(ROOT, 'app/api/stripe/webhook/route.ts');
const source = fs.readFileSync(ROUTE, 'utf8');
const sf = ts.createSourceFile(ROUTE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function topLevelFunction(name: string): ts.FunctionDeclaration | undefined {
  return sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name
  );
}

function callsTo(root: ts.Node, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(root, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(n);
  });
  return out;
}

/** Code text without comments, for "this call is gone" checks. */
function codeOf(node: ts.Node): string {
  const printer = ts.createPrinter({ removeComments: true });
  return ts.isSourceFile(node) ? printer.printFile(node) : printer.printNode(ts.EmitHint.Unspecified, node, sf);
}

const post = topLevelFunction('POST');

describe('stripe webhook: Business OS router placement (P-1)', () => {
  it('POST exists', () => {
    expect(post).toBeDefined();
  });

  it('calls dispatchBusinessOsEvent exactly once, after the Connect split and before the switch', () => {
    const calls = callsTo(post!, 'dispatchBusinessOsEvent');
    expect(calls).toHaveLength(1);

    let splitAt = -1;
    let switchAt = -1;
    walk(post!, (n) => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'isConnectEvent') splitAt = n.getStart(sf);
      if (ts.isSwitchStatement(n) && n.expression.getText(sf) === 'event.type') switchAt = n.getStart(sf);
    });
    expect(splitAt).toBeGreaterThan(-1);
    expect(switchAt).toBeGreaterThan(-1);
    expect(calls[0].getStart(sf)).toBeGreaterThan(splitAt);
    expect(calls[0].getStart(sf)).toBeLessThan(switchAt);
  });

  it('runs the router only inside `if (!isConnectEvent)`', () => {
    const [call] = callsTo(post!, 'dispatchBusinessOsEvent');
    let cursor: ts.Node = call;
    let guarded = false;
    while (cursor.parent && cursor !== post) {
      const parent: ts.Node = cursor.parent;
      if (ts.isIfStatement(parent) && parent.thenStatement === cursor && parent.expression.getText(sf) === '!isConnectEvent') {
        guarded = true;
        break;
      }
      cursor = parent;
    }
    expect(guarded).toBe(true);
  });

  it('every claim completion goes through completeClaim(), and completeClaim is the one completing update', () => {
    const helper = topLevelFunction('completeClaim');
    expect(helper).toBeDefined();
    expect(codeOf(helper!)).toContain("status: 'completed'");

    // No other place writes status 'completed'.
    const completingWrites: number[] = [];
    walk(sf, (n) => {
      if (
        ts.isPropertyAssignment(n) &&
        n.name.getText(sf) === 'status' &&
        n.initializer.getText(sf) === "'completed'" &&
        !(n.pos >= helper!.pos && n.end <= helper!.end)
      ) {
        completingWrites.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
      }
    });
    expect(completingWrites).toEqual([]);

    // Deny path + flow path + end-of-switch path.
    expect(callsTo(post!, 'completeClaim').length).toBeGreaterThanOrEqual(3);
  });

  it('handleInvoicePaid and the customer-subscription fallback are gone', () => {
    expect(topLevelFunction('handleInvoicePaid')).toBeUndefined();
    const code = codeOf(sf);
    expect(code).not.toContain('handleInvoicePaid(');
    expect(code).not.toContain('subscriptions.list(');
  });

  it('the platform invoice.paid arm writes nothing and alerts', () => {
    const code = codeOf(post!);
    expect(code).toContain('Platform invoice.paid reached the switch; not processed');
  });

  it('handleCheckoutCompleted keeps only the boost-pack conversion (subscription-mode conversion gone)', () => {
    const fn = topLevelFunction('handleCheckoutCompleted');
    expect(fn).toBeDefined();
    const code = codeOf(fn!);
    expect(code.match(/new QuotaAllocationService\(/g)).toHaveLength(1);
    expect(code).not.toContain("'welcome_bonus'");
    expect(code).not.toContain('monthly_credits');
    expect(code).not.toContain("activity_type: 'subscription_renewal'");
    expect(code).toContain("activity_type: 'boost_pack_purchase'");
  });

  it('the dunning handler survives untouched in the code (RD-16), even though platform invoices no longer reach it', () => {
    expect(topLevelFunction('handleInvoicePaymentFailed')).toBeDefined();
  });

  it('the router is called from this route only (one endpoint, SR-3)', () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.next', '.claude', '__tests__', 'coverage'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('dispatchBusinessOsEvent(')) {
          offenders.push(path.relative(ROOT, full).replace(/\\/g, '/'));
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks']) scan(path.join(ROOT, dir));
    expect(offenders.sort()).toEqual([
      'app/api/stripe/webhook/route.ts',
      'lib/business-os/billing/webhookDispatcher.ts',
    ]);
  });

  it('the 500 response carries no internal message outside development (SA P1-C5)', () => {
    const code = codeOf(post!);
    expect(code).not.toMatch(/error:\s*error\.message/);
    expect(code).toContain("error: 'Webhook processing failed'");
    expect(code).toMatch(/details: process\.env\.NODE_ENV === 'development'/);
  });

  it('the new billing modules do not touch the database (SA P1-C6)', () => {
    const dir = path.join(ROOT, 'lib/business-os/billing');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      expect({ file, supabase: /supabase/i.test(text), from: /\.from\(/.test(text) }).toEqual({
        file,
        supabase: false,
        from: false,
      });
    }
  });
});
