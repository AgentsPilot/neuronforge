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
 *   - Billing modules reach the database only through the allow-listed
 *     repository caller `businessOsStripeCustomer.ts` (SA P1-C6, P-2a M-1).
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

/**
 * P-2a M-1: the ONLY file in `lib/business-os/billing/` allowed to import a
 * repository. It reaches the database through `BusinessOsBillingAccountRepository`
 * (CLAUDE.md rule 1). The router, catalog and resolver must stay DB-free.
 */
// P-3a: planCheckout.ts records the checkout lock and reads the billing row
// (workplan BUSINESS_OS_PLAN_PAYMENTS_P3A_WORKPLAN.md §4).
const BILLING_REPOSITORY_CALLERS = ['businessOsStripeCustomer.ts', 'planCheckout.ts'];

const REPOSITORIES_DIR = path.join(ROOT, 'lib', 'repositories');

/** Is this module specifier the repositories barrel or a file under it (alias or relative)? */
function isRepositorySpecifier(fromFile: string, specifier: string): boolean {
  if (specifier === '@/lib/repositories' || specifier.startsWith('@/lib/repositories/')) return true;
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return resolved === REPOSITORIES_DIR || resolved.startsWith(REPOSITORIES_DIR + path.sep);
}

/**
 * Every repository module a file imports: static imports (type-only included),
 * `export … from`, `import()` and `require()`. AST, so comments and strings
 * that merely mention the folder do not count.
 */
function repositoryImportsOf(fileName: string, text: string): string[] {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  walk(file, (node) => {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteral(specifier) && isRepositorySpecifier(fileName, specifier.text)) {
      found.push(specifier.text);
    }
  });
  return found;
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
function codeOf(node: ts.Node, file: ts.SourceFile = sf): string {
  const printer = ts.createPrinter({ removeComments: true });
  return ts.isSourceFile(node) ? printer.printFile(node) : printer.printNode(ts.EmitHint.Unspecified, node, file);
}

/** Calls of the form `<receiver>.<method>(…)` under `root`. */
function methodCallsTo(root: ts.Node, receiver: string, method: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  walk(root, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === receiver &&
      n.expression.name.text === method
    ) {
      out.push(n);
    }
  });
  return out;
}

/**
 * Lines of every `status: 'completed'` property in `file`, outside `except`.
 * The completing write of the claim table (CF-5 PR 1 moved it from the route
 * into `ProcessedWebhookEventRepository.complete`).
 */
function completingWritesIn(file: ts.SourceFile, except?: ts.Node): number[] {
  const lines: number[] = [];
  walk(file, (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(file) === 'status' &&
      n.initializer.getText(file) === "'completed'" &&
      !(except && n.pos >= except.pos && n.end <= except.end)
    ) {
      lines.push(file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1);
    }
  });
  return lines;
}

// The claim repository (CF-5 PR 1). A small file, parsed once for the claim checks.
const CLAIM_REPO = path.join(ROOT, 'lib/repositories/ProcessedWebhookEventRepository.ts');
const claimRepoSf = ts.createSourceFile(
  CLAIM_REPO,
  fs.readFileSync(CLAIM_REPO, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

function claimRepositoryMethod(name: string): ts.MethodDeclaration | undefined {
  let found: ts.MethodDeclaration | undefined;
  walk(claimRepoSf, (n) => {
    if (
      ts.isMethodDeclaration(n) &&
      n.name.getText(claimRepoSf) === name &&
      ts.isClassDeclaration(n.parent) &&
      n.parent.name?.text === 'ProcessedWebhookEventRepository'
    ) {
      found = n;
    }
  });
  return found;
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

  // CF-5 PR 1 moved the completing update into
  // `ProcessedWebhookEventRepository.complete` (workplan §7.3.2). The check
  // followed it: completeClaim() must call that method, the method must be the
  // one completing update in the repository, the route must hold none of its
  // own, and nothing in the route may call the method around completeClaim().
  it('every claim completion goes through completeClaim(), and completeClaim is the one completing update', () => {
    const helper = topLevelFunction('completeClaim');
    expect(helper).toBeDefined();
    expect(methodCallsTo(helper!, 'processedWebhookEventRepository', 'complete')).toHaveLength(1);

    // The repository's complete() is the one completing write there.
    const complete = claimRepositoryMethod('complete');
    expect(complete).toBeDefined();
    expect(codeOf(complete!, claimRepoSf)).toContain("status: 'completed'");
    expect(completingWritesIn(claimRepoSf, complete!)).toEqual([]);

    // The route writes status 'completed' nowhere itself.
    expect(completingWritesIn(sf)).toEqual([]);

    // Nothing in the route reaches complete() except through completeClaim().
    const direct = methodCallsTo(sf, 'processedWebhookEventRepository', 'complete').filter(
      (c) => !(c.pos >= helper!.pos && c.end <= helper!.end)
    );
    expect(direct).toEqual([]);

    // Deny path + flow path + end-of-switch path.
    expect(callsTo(post!, 'completeClaim').length).toBeGreaterThanOrEqual(3);
  });

  it('the claim table is reached only through its repository (CF-5 PR 1)', () => {
    // Comments excluded, so a line explaining the history cannot trip or satisfy it.
    // Any quote style, backticks included (SA O-P1-1).
    expect(codeOf(sf)).not.toMatch(/from\(\s*['"`]processed_webhook_events['"`]\s*\)/);
    // Only the singleton: a `new ProcessedWebhookEventRepository()` built in the
    // route could call complete() around completeClaim() unseen (SA O-P1-1).
    // AST identifiers, so the import path string does not count.
    const classMentions: number[] = [];
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && n.text === 'ProcessedWebhookEventRepository') {
        classMentions.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
      }
    });
    expect(classMentions).toEqual([]);
    for (const method of ['findClaim', 'reclaimFailed', 'insertClaim', 'markFailed']) {
      expect(methodCallsTo(post!, 'processedWebhookEventRepository', method)).toHaveLength(1);
    }
  });

  // CF-5 PR 2 (workplan §7.3.3): the 15 invoice and business-profile sites.
  // Expected calls per handler; together they are every call in the route.
  const INVOICE_CALLS: Record<string, Record<string, number>> = {
    handleConnectInvoicePaid: {
      findByStripeInvoiceId: 1,
      findByIdUnscoped: 1,
      recordStripeInvoiceId: 1,
      markPaidFromStripeInvoice: 1,
      readFieldsUnscoped: 1,
    },
    handleConnectCheckoutCompleted: { findByIdUnscoped: 1, markPaidFromCheckout: 1 },
    handleConnectInvoicePaymentFailed: { findByStripeInvoiceId: 1, setStatusFromStripe: 1, readFieldsUnscoped: 1 },
    handleConnectInvoiceFinalized: { findByStripeInvoiceId: 1, recordStripeDocuments: 1 },
    handleConnectInvoiceUncollectible: { findByStripeInvoiceId: 1, setStatusFromStripe: 1 },
  };
  const INVOICE_WRITES = ['recordStripeInvoiceId', 'markPaidFromStripeInvoice', 'markPaidFromCheckout', 'setStatusFromStripe', 'recordStripeDocuments'];

  /** Every `<receiver>.<anything>(…)` call under `root`, as method names. */
  function receiverCalls(root: ts.Node, receiver: string): ts.CallExpression[] {
    const out: ts.CallExpression[] = [];
    walk(root, (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === receiver
      ) {
        out.push(n);
      }
    });
    return out;
  }

  it('the invoice and business-profile tables are reached only through their repositories (CF-5 PR 2)', () => {
    const code = codeOf(sf);
    expect(code).not.toMatch(/from\(\s*['"`]payment_invoices['"`]\s*\)/);
    expect(code).not.toMatch(/from\(\s*['"`]business_profiles['"`]\s*\)/);

    // Only the singletons, never the classes (no instance built around the checks).
    const classMentions: string[] = [];
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && (n.text === 'PaymentInvoiceRepository' || n.text === 'BusinessProfileRepository')) {
        classMentions.push(n.text);
      }
    });
    expect(classMentions).toEqual([]);

    // Each handler makes exactly its expected calls, and no other function makes any.
    let expectedTotal = 0;
    for (const [fn, expected] of Object.entries(INVOICE_CALLS)) {
      const node = topLevelFunction(fn);
      expect(node).toBeDefined();
      const actual: Record<string, number> = {};
      for (const call of receiverCalls(node!, 'paymentInvoiceRepository')) {
        const name = (call.expression as ts.PropertyAccessExpression).name.text;
        actual[name] = (actual[name] ?? 0) + 1;
      }
      expect({ fn, calls: actual }).toEqual({ fn, calls: expected });
      expectedTotal += Object.values(expected).reduce((a, b) => a + b, 0);
    }
    expect(receiverCalls(sf, 'paymentInvoiceRepository')).toHaveLength(expectedTotal);

    const languageReads = receiverCalls(sf, 'businessProfileRepository');
    expect(languageReads.map((c) => (c.expression as ts.PropertyAccessExpression).name.text)).toEqual(['findLanguage']);
    const failed = topLevelFunction('handleConnectInvoicePaymentFailed')!;
    expect(languageReads[0].pos >= failed.pos && languageReads[0].end <= failed.end).toBe(true);
  });

  it('F-1 stays fixed: every invoice write comes after an ownership check on an invoice row (CF-5 PR 2)', () => {
    // The nearest `accountOwns(…)` before each write must test an invoice row's
    // owner, not, say, a plan's. Moving a write above its check (the F-1 shape)
    // makes the nearest check a different one, or none.
    for (const fn of Object.keys(INVOICE_CALLS)) {
      const node = topLevelFunction(fn)!;
      const checks = callsTo(node, 'accountOwns');
      const writes = receiverCalls(node, 'paymentInvoiceRepository').filter((c) =>
        INVOICE_WRITES.includes((c.expression as ts.PropertyAccessExpression).name.text)
      );
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        const before = checks.filter((c) => c.end <= write.getStart(sf));
        const nearest = before[before.length - 1];
        expect({ fn, write: write.expression.getText(sf), check: nearest?.arguments[1]?.getText(sf) }).toEqual({
          fn,
          write: write.expression.getText(sf),
          check: expect.stringMatching(/^(platformInvoice|invoiceByMetadata)\.user_id$/),
        });
      }
    }
  });

  // CF-5 PR 3 (workplan §7.3.4): the 12 money-row sites (11 `payment_transactions`,
  // 1 `payment_refunds`). Expected calls per function; together they are every
  // call in the route.
  const MONEY_ROW_CALLS: Record<string, Record<string, Record<string, number>>> = {
    paymentTransactionRepository: {
      handleDispute: { findFirstByStripeReference: 1, recordDisputeState: 1 },
      handleChargeRefunded: { findFirstByStripeReference: 1 },
      handleConnectPaymentIntentSucceeded: { findByPaymentIntentId: 1, insertFromWebhook: 1 },
      recordPlanPeriodPaid: { insertFromWebhookReturningId: 1 },
      handleConnectInvoicePaid: {
        findSettledIdForInvoice: 1,
        findByPaymentIntentId: 1,
        attachToInvoice: 1,
        insertFromWebhook: 1,
      },
      handleConnectCheckoutCompleted: { insertFromWebhook: 1 },
    },
    paymentRefundRepository: {
      handleChargeRefunded: { upsertFromStripe: 1 },
    },
  };

  it('the money-row tables are reached only through their repositories (CF-5 PR 3)', () => {
    const code = codeOf(sf);
    expect(code).not.toMatch(/from\(\s*['"`]payment_transactions['"`]\s*\)/);
    expect(code).not.toMatch(/from\(\s*['"`]payment_refunds['"`]\s*\)/);

    // Only the singletons, never the classes (no instance built around the checks).
    const classMentions: string[] = [];
    walk(sf, (n) => {
      if (ts.isIdentifier(n) && (n.text === 'PaymentTransactionRepository' || n.text === 'PaymentRefundRepository')) {
        classMentions.push(n.text);
      }
    });
    expect(classMentions).toEqual([]);

    // Each function makes exactly its expected calls, and no other function makes any.
    for (const [receiver, perFunction] of Object.entries(MONEY_ROW_CALLS)) {
      let expectedTotal = 0;
      for (const [fn, expected] of Object.entries(perFunction)) {
        const node = topLevelFunction(fn);
        expect(node).toBeDefined();
        const actual: Record<string, number> = {};
        for (const call of receiverCalls(node!, receiver)) {
          const name = (call.expression as ts.PropertyAccessExpression).name.text;
          actual[name] = (actual[name] ?? 0) + 1;
        }
        expect({ receiver, fn, calls: actual }).toEqual({ receiver, fn, calls: expected });
        expectedTotal += Object.values(expected).reduce((a, b) => a + b, 0);
      }
      expect({ receiver, total: receiverCalls(sf, receiver).length }).toEqual({ receiver, total: expectedTotal });
    }
  });

  it('every owner-checked money-row write comes after that check, and carries the proved owner (CF-5 PR 3)', () => {
    // The owner each function proves with `accountOwns` before it records money.
    // The dispute and refund writes have no such check (FU-3): they are keyed by
    // a Stripe reference and copy the owner from the row they found.
    const OWNER_PROVED: Record<string, string> = {
      handleConnectPaymentIntentSucceeded: 'ownerId',
      recordPlanPeriodPaid: 'plan.data.user_id',
      handleConnectInvoicePaid: 'platformInvoice.user_id',
      handleConnectCheckoutCompleted: 'platformInvoice.user_id',
    };
    const WRITES = ['insertFromWebhook', 'insertFromWebhookReturningId', 'attachToInvoice'];

    for (const [fn, owner] of Object.entries(OWNER_PROVED)) {
      const node = topLevelFunction(fn)!;
      const checks = callsTo(node, 'accountOwns');
      const writes = receiverCalls(node, 'paymentTransactionRepository').filter((c) =>
        WRITES.includes((c.expression as ts.PropertyAccessExpression).name.text)
      );
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        const before = checks.filter((c) => c.end <= write.getStart(sf));
        const nearest = before[before.length - 1];
        const row = write.arguments[0];
        const rowOwner =
          row && ts.isObjectLiteralExpression(row)
            ? row.properties
                .filter(ts.isPropertyAssignment)
                .find((p) => p.name.getText(sf) === 'user_id')
                ?.initializer.getText(sf)
            : undefined;
        const method = (write.expression as ts.PropertyAccessExpression).name.text;
        expect({ fn, method, check: nearest?.arguments[1]?.getText(sf) }).toEqual({ fn, method, check: owner });
        // An insert writes the owner it proved; the attach writes no owner at all.
        expect({ fn, method, rowOwner }).toEqual({ fn, method, rowOwner: method === 'attachToInvoice' ? undefined : owner });
      }
    }
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

  it('billing modules touch the database only through the allow-listed repository caller (SA P1-C6, P-2a M-1)', () => {
    const dir = path.join(ROOT, 'lib/business-os/billing');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const full = path.join(dir, file);
      const text = fs.readFileSync(full, 'utf8');
      expect({
        file,
        supabase: /supabase/i.test(text),
        from: /\.from\(/.test(text),
        repositoryImports: BILLING_REPOSITORY_CALLERS.includes(file) ? [] : repositoryImportsOf(full, text),
      }).toEqual({ file, supabase: false, from: false, repositoryImports: [] });
    }
    // The allow-listed callers exist and really are the ones that import a
    // repository: the billing repository and nothing else.
    for (const name of BILLING_REPOSITORY_CALLERS) {
      const caller = path.join(dir, name);
      expect(repositoryImportsOf(caller, fs.readFileSync(caller, 'utf8'))).toEqual([
        '@/lib/repositories/BusinessOsBillingAccountRepository',
      ]);
    }
  });

  it('the repository-import check bites: barrel, file, relative path, type-only, re-export, dynamic import and require (M-1 negative control)', () => {
    const file = path.join(ROOT, 'lib/business-os/billing/planPriceCatalog.ts');
    const real = fs.readFileSync(file, 'utf8');
    expect(repositoryImportsOf(file, real)).toEqual([]);
    const injected: Array<[string, string]> = [
      ["import { agentRepository } from '@/lib/repositories';", '@/lib/repositories'],
      ["import { x } from '@/lib/repositories/BusinessOsBillingAccountRepository';", '@/lib/repositories/BusinessOsBillingAccountRepository'],
      ["import { x } from '../../repositories/AgentRepository';", '../../repositories/AgentRepository'],
      ["import type { X } from '@/lib/repositories/types';", '@/lib/repositories/types'],
      ["export { x } from '@/lib/repositories';", '@/lib/repositories'],
      ["const m = () => import('@/lib/repositories/AgentRepository');", '@/lib/repositories/AgentRepository'],
      ["const m = require('@/lib/repositories');", '@/lib/repositories'],
    ];
    for (const [line, specifier] of injected) {
      expect(repositoryImportsOf(file, `${line}\n${real}`)).toEqual([specifier]);
    }
    // Words in comments or strings that only mention the folder do not count.
    expect(repositoryImportsOf(file, `// see @/lib/repositories\nconst s = 'lib/repositories';\n${real}`)).toEqual([]);
    expect(repositoryImportsOf(file, "import { x } from '@/lib/repositoriesExtra';")).toEqual([]);
    expect(repositoryImportsOf(file, "import { x } from '../../../repositories/AgentRepository';")).toEqual([]);
  });
});
