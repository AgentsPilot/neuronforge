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

  // CF-5 PR 4 (workplan §7.3.5): the plan and booking sites (4 instalment, 2 plan
  // subscription, 4 booking). Every call of these three singletons in the route,
  // per function, including the ones that were already repository calls.
  const PLAN_BOOKING_CALLS: Record<string, Record<string, Record<string, number>>> = {
    paymentPlanRepository: {
      recordPlanPeriodPaid: { findInstallmentIdByStripeInvoiceId: 1, markPeriodPaidFromStripe: 1, findNextPendingPeriod: 1 },
      handlePlanSubscriptionEnded: { cancelOpenPeriodsForEndedPlan: 1 },
    },
    paymentPlanSubscriptionRepository: {
      recordPlanPeriodPaid: { findBySubscriptionId: 1, recordPeriodPaid: 1, close: 1 },
      handleConnectInvoicePaymentFailed: { findBySubscriptionId: 1, recordFailure: 1 },
      handlePlanSubscriptionEnded: { findEndStateBySubscriptionId: 1, endFromStripe: 1 },
    },
    schedulingBookingRepository: {
      handleConnectPaymentIntentSucceeded: { findOwnedId: 1 },
      recordPlanPeriodPaid: { markPaidForOwner: 1 },
      handleConnectInvoicePaid: { markPaidUnscoped: 1 },
      handleConnectCheckoutCompleted: { markPaidAndConfirmIfPending: 1, markPaidForOwnerCounted: 1 },
    },
  };

  it('the plan and booking tables are reached only through their repositories (CF-5 PR 4)', () => {
    const code = codeOf(sf);
    for (const table of ['payment_plan_installments', 'payment_plan_subscriptions', 'scheduling_bookings', 'payment_plans']) {
      expect({ table, inline: new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)`).test(code) }).toEqual({ table, inline: false });
    }

    // Only the singletons, never the classes (no instance built around the checks).
    const classMentions: string[] = [];
    walk(sf, (n) => {
      if (
        ts.isIdentifier(n) &&
        ['PaymentPlanRepository', 'PaymentPlanSubscriptionRepository', 'SchedulingBookingRepository'].includes(n.text)
      ) {
        classMentions.push(n.text);
      }
    });
    expect(classMentions).toEqual([]);

    // Each function makes exactly its expected calls, and no other function makes any.
    for (const [receiver, perFunction] of Object.entries(PLAN_BOOKING_CALLS)) {
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

  it('every plan and booking write keeps the key and the owner it had (CF-5 PR 4)', () => {
    /*
     * For each write: the arguments it is called with, and the owner tested by
     * the nearest `accountOwns(…)` before it (positional, as PR2-Q2 / PR3-Q1).
     * `null` means the write follows no `accountOwns` of its own: the checkout
     * booking is scoped by `accountOwner` (Fix-1, F-2), asserted separately below.
     *
     * The `subscription.id` argument of `cancelOpenPeriodsForEndedPlan` is F-3
     * (Stripe's id against a column holding our plan row's id), pinned as it is
     * on purpose (SA C-9). Fix-2 changes it, and this line with it.
     */
    const EXPECTED: Array<{ fn: string; receiver: string; method: string; args: string[]; check: string | null }> = [
      { fn: 'recordPlanPeriodPaid', receiver: 'paymentPlanRepository', method: 'markPeriodPaidFromStripe', args: ['plan.data.id', 'periodsPaid', expect.any(String) as unknown as string], check: 'plan.data.user_id' },
      { fn: 'recordPlanPeriodPaid', receiver: 'schedulingBookingRepository', method: 'markPaidForOwner', args: ['plan.data.booking_id', 'plan.data.user_id'], check: 'plan.data.user_id' },
      { fn: 'handleConnectInvoicePaid', receiver: 'schedulingBookingRepository', method: 'markPaidUnscoped', args: ['platformInvoice.booking_id'], check: 'platformInvoice.user_id' },
      { fn: 'handleConnectCheckoutCompleted', receiver: 'schedulingBookingRepository', method: 'markPaidAndConfirmIfPending', args: ['platformInvoice.booking_id'], check: 'platformInvoice.user_id' },
      { fn: 'handleConnectCheckoutCompleted', receiver: 'schedulingBookingRepository', method: 'markPaidForOwnerCounted', args: ['bookingId', 'owner'], check: null },
      { fn: 'handlePlanSubscriptionEnded', receiver: 'paymentPlanSubscriptionRepository', method: 'endFromStripe', args: ['plan.id', "completed ? 'completed' : 'cancelled'"], check: 'plan.user_id' },
      { fn: 'handlePlanSubscriptionEnded', receiver: 'paymentPlanRepository', method: 'cancelOpenPeriodsForEndedPlan', args: ['plan.user_id', 'subscription.id'], check: 'plan.user_id' },
    ];

    for (const { fn, receiver, method, args, check } of EXPECTED) {
      const node = topLevelFunction(fn)!;
      const writes = methodCallsTo(node, receiver, method);
      expect({ fn, method, count: writes.length }).toEqual({ fn, method, count: 1 });
      const write = writes[0];
      const checks = callsTo(node, 'accountOwns').filter((c) => c.end <= write.getStart(sf));
      const nearest = checks[checks.length - 1];
      expect({
        fn,
        method,
        args: write.arguments.map((a) => a.getText(sf)),
        check: check === null ? null : nearest?.arguments[1]?.getText(sf),
      }).toEqual({ fn, method, args, check });
    }

    // The checkout booking write (F-2): `owner` is the business that owns the
    // SENDING account, and a missing owner returns before the write.
    const checkout = topLevelFunction('handleConnectCheckoutCompleted')!;
    const ownerDecls: string[] = [];
    walk(checkout, (n) => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'owner') ownerDecls.push(n.initializer?.getText(sf) ?? '');
    });
    expect(ownerDecls).toEqual(['await accountOwner(connectAccountId, log)']);
    const counted = methodCallsTo(checkout, 'schedulingBookingRepository', 'markPaidForOwnerCounted')[0];
    const ownerGuard = codeOf(checkout).indexOf('if (!owner)');
    expect(ownerGuard).toBeGreaterThan(-1);
    expect(ownerGuard).toBeLessThan(codeOf(checkout).indexOf('markPaidForOwnerCounted('));
    expect(counted.arguments[1].getText(sf)).toBe('owner');
  });

  it('the plan-checkout owner check sits above the try whose catch reports an unbounded plan (FU-5 SA Q-3, CF-5 PR 4)', () => {
    const checkout = topLevelFunction('handleConnectCheckoutCompleted')!;
    const insideTry = (n: ts.Node): ts.TryStatement | undefined => {
      for (let p: ts.Node | undefined = n.parent; p && p !== checkout; p = p.parent) {
        if (ts.isTryStatement(p) && n.pos >= p.tryBlock.pos && n.end <= p.tryBlock.end) return p;
      }
      return undefined;
    };

    const planCheck = callsTo(checkout, 'accountOwns').filter((c) => c.arguments[1]?.getText(sf) === 'ownerId');
    expect(planCheck).toHaveLength(1);
    expect(insideTry(planCheck[0])).toBeUndefined();

    // The bind is still inside the try, and that catch still reports it and rethrows.
    const binds = callsTo(checkout, 'bindPlanSubscription');
    expect(binds).toHaveLength(1);
    const tryStatement = insideTry(binds[0]);
    expect(tryStatement).toBeDefined();
    const catchCode = codeOf(tryStatement!.catchClause!);
    expect(catchCode).toContain('Could not bound a payment plan - subscription may bill indefinitely');
    expect(catchCode).toMatch(/throw scheduleError/);
    expect(planCheck[0].end).toBeLessThan(tryStatement!.getStart(sf));
  });

  // CF-5 PR 5 (workplan §7.3.6): the agent-platform legacy sites. Every call of
  // these five singletons in the route, per function.
  const LEGACY_CALLS: Record<string, Record<string, Record<string, number>>> = {
    userSubscriptionRepository: {
      handleInvoicePaymentFailed: { findDunningState: 1, recordPaymentFailure: 1 },
      handleCheckoutCompleted: { findBalance: 1, applyBoostPackBalance: 1 },
      handleSubscriptionUpdated: { mirrorStripeStatus: 1 },
      handleSubscriptionDeleted: { markCanceled: 1 },
    },
    systemConfigRepository: { handleInvoicePaymentFailed: { findRawValue: 1 } },
    creditTransactionRepository: { handleCheckoutCompleted: { insertReturningId: 1 } },
    billingEventRepository: { handleInvoicePaymentFailed: { insert: 1 }, handleSubscriptionDeleted: { insert: 1 } },
    legacyBoostPackPurchaseRepository: { handleCheckoutCompleted: { insert: 1 } },
  };

  it('the legacy tables are reached only through their repositories, scoped to the metadata user (CF-5 PR 5)', () => {
    for (const [receiver, perFunction] of Object.entries(LEGACY_CALLS)) {
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

        // Each call keeps the user it had: the `user_subscriptions` methods take
        // `userId` first, each insert row carries `user_id: userId`, and that
        // `userId` is the function's own metadata read (workplan §5.1).
        for (const call of receiverCalls(node!, receiver)) {
          const first = call.arguments[0];
          const scopedTo =
            first && ts.isObjectLiteralExpression(first)
              ? first.properties
                  .filter(ts.isPropertyAssignment)
                  .find((p) => p.name.getText(sf) === 'user_id')
                  ?.initializer.getText(sf)
              : first?.getText(sf);
          const method = (call.expression as ts.PropertyAccessExpression).name.text;
          const expectedScope = receiver === 'systemConfigRepository' ? "'payment_grace_period_days'" : 'userId';
          expect({ fn, method, scopedTo }).toEqual({ fn, method, scopedTo: expectedScope });
        }
        const userIdDecls: string[] = [];
        walk(node!, (n) => {
          if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'userId') userIdDecls.push(n.initializer?.getText(sf) ?? '');
        });
        expect({ fn, userIdDecls }).toEqual({ fn, userIdDecls: [expect.stringMatching(/^\w+\.metadata\?\.user_id$/)] });
      }
      expect({ receiver, total: receiverCalls(sf, receiver).length }).toEqual({ receiver, total: expectedTotal });
    }
  });

  /*
   * CLAUDE.md rule 1, the final state (CF-5 PR 5, SA C-7): the route issues no
   * query of its own. It holds no client except `supabaseServer`, and that only
   * as an argument to the three helpers that take one (SA Q-2). It builds no
   * repository: it uses only the singletons, and only as the receiver of a
   * direct method call, so no alias (`const r = repo; r.complete()`, QA PR 1
   * edge case 2), destructured method or `.call` can get around the per-method
   * checks above. AST, comments ignored; the route is not parsed again.
   */
  const ALLOWED_CLIENT_USES = [
    { fn: 'handleCheckoutCompleted', call: 'pilotCreditsToTokens', argument: 1 },
    { fn: 'handleCheckoutCompleted', call: 'new QuotaAllocationService', argument: 0 },
    { fn: 'accountOwner', call: 'resolveAccountOwner', argument: 0 },
  ];

  /** Every rule-1 offence in a parsed file (the route, or a negative-control snippet). */
  function ruleOneOffences(file: ts.SourceFile): string[] {
    const offences: string[] = [];
    const where = (n: ts.Node) => `:${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`;
    const at = (n: ts.Node, what: string) => offences.push(`${what} ${where(n)}`);

    // Repository singletons this file imports, by alias path or relative path.
    // Only plain named imports are allowed from a repository module (SA
    // CR-P5-1): a namespace or default import, or an `as` rename, would let a
    // class or a singleton in under a name the checks below do not track.
    const singletons = new Set<string>();
    const isRepositoryModule = (specifier: string) =>
      isRepositorySpecifier(file.fileName, specifier) || specifier.includes('/repositories/');
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (/supabase/i.test(specifier) && specifier !== '@/lib/supabaseServer') at(statement, `client import ${specifier}`);
      // From the shared client module, only the plain, unrenamed `supabaseServer`
      // (QA PR 5 B01–B03): a rename would hide it from the helper-argument check,
      // and any other export is a second client.
      if (specifier === '@/lib/supabaseServer') {
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (clause?.name || (bindings && ts.isNamespaceImport(bindings))) at(statement, `supabase client import not named ${specifier}`);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.propertyName) at(element, `supabase client import renamed ${element.propertyName.text} as ${element.name.text}`);
            else if (element.name.text !== 'supabaseServer') at(element, `supabase client import ${element.name.text}`);
          }
        }
      }
      if (!isRepositoryModule(specifier)) continue;
      const clause = statement.importClause;
      if (clause?.name) at(statement, `repository default import ${specifier}`);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) at(statement, `repository namespace import ${specifier}`);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.propertyName) at(element, `repository import renamed ${element.propertyName.text} as ${element.name.text}`);
          // Keyed by the exported name, so the column constants stay allowed;
          // the local name is what the code below sees.
          if (/^[a-z]\w*Repository$/.test((element.propertyName ?? element.name).text)) singletons.add(element.name.text);
        }
      }
    }

    // Names the file binds itself. `Array.from` / `Buffer.from` are exempt only
    // while `Array` / `Buffer` are the globals (QA PR 5 B01, B07).
    const localNames = new Set<string>();
    walk(file, (n) => {
      if (
        (ts.isVariableDeclaration(n) ||
          ts.isParameter(n) ||
          ts.isBindingElement(n) ||
          ts.isFunctionDeclaration(n) ||
          ts.isClassDeclaration(n) ||
          ts.isImportSpecifier(n) ||
          ts.isImportClause(n) ||
          ts.isNamespaceImport(n)) &&
        n.name &&
        ts.isIdentifier(n.name)
      ) {
        localNames.add(n.name.text);
      }
    });

    walk(file, (n) => {
      // No `import()` / `require()` of a repository or Supabase module (QA PR 5
      // B04, B06, B07): it would reach a class or a client around the import
      // checks above. Other dynamic imports (the route's services) are allowed.
      if (
        ts.isCallExpression(n) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))
      ) {
        const arg = n.arguments[0];
        if (!arg || !ts.isStringLiteralLike(arg)) at(n, 'dynamic import of a computed module');
        else if (isRepositoryModule(arg.text) || /supabase/i.test(arg.text)) at(n, `dynamic import of ${arg.text}`);
      }
      // No `.from(…)` / `.rpc(…)`, as `x.from(` or `x['from'](` in any quote style.
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
            ? callee.argumentExpression.text
            : undefined;
        const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee) ? callee.expression : undefined;
        const isArrayOrBuffer =
          receiver && ts.isIdentifier(receiver) && ['Array', 'Buffer'].includes(receiver.text) && !localNames.has(receiver.text);
        if ((name === 'from' && !isArrayOrBuffer) || name === 'rpc') at(n, `.${name}(`);
      }
      if (!ts.isIdentifier(n)) return;
      const parent = n.parent;
      const isImportBinding = ts.isImportSpecifier(parent) || ts.isImportClause(parent);
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === n) || (ts.isPropertyAssignment(parent) && parent.name === n);
      if (isPropertyName) return;

      if (n.text === 'supabaseAdmin' || n.text === 'createClient') at(n, n.text);
      // A repository class named anywhere means one could be constructed.
      if (/^[A-Z]\w*Repository$/.test(n.text)) at(n, `class ${n.text}`);

      if (n.text === 'supabaseServer' && !isImportBinding) {
        const call = parent;
        const allowed = ALLOWED_CLIENT_USES.some(({ fn, call: callee, argument }) => {
          if (!(ts.isCallExpression(call) || ts.isNewExpression(call))) return false;
          const calleeText = ts.isNewExpression(call) ? `new ${call.expression.getText(file)}` : call.expression.getText(file);
          if (calleeText !== callee || call.arguments?.[argument] !== n) return false;
          let owner: ts.Node | undefined = call.parent;
          while (owner && !(ts.isFunctionDeclaration(owner) && owner.parent === file)) owner = owner.parent;
          return !!owner && (owner as ts.FunctionDeclaration).name?.text === fn;
        });
        if (!allowed) at(n, 'supabaseServer used other than as a helper argument');
      }

      // A singleton only as the receiver of a direct method call.
      if (singletons.has(n.text) && !isImportBinding) {
        const isDirectCall =
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === n &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent;
        if (!isDirectCall) at(n, `${n.text} not a direct method call`);
      }
    });
    return offences;
  }

  it('route.ts issues no query of its own and holds no client but the helpers\' argument (CLAUDE.md rule 1, CF-5 PR 5)', () => {
    expect(ruleOneOffences(sf)).toEqual([]);

    // Non-vacuity: each allowed helper use exists exactly once, and the
    // singletons the check guards are really imported.
    for (const { fn, call, argument } of ALLOWED_CLIENT_USES) {
      const node = topLevelFunction(fn)!;
      const hits: ts.Node[] = [];
      walk(node, (n) => {
        const text = ts.isNewExpression(n) ? `new ${n.expression.getText(sf)}` : ts.isCallExpression(n) ? n.expression.getText(sf) : '';
        if (text === call) hits.push(n);
      });
      expect({ fn, call, count: hits.length }).toEqual({ fn, call, count: 1 });
      const args = (hits[0] as ts.CallExpression | ts.NewExpression).arguments ?? [];
      expect({ fn, call, argument: args[argument]?.getText(sf) }).toEqual({ fn, call, argument: 'supabaseServer' });
    }
    const imported = codeOf(sf).match(/\b[a-z]\w*Repository\b/g) ?? [];
    for (const singleton of [...Object.keys(LEGACY_CALLS), 'processedWebhookEventRepository', 'paymentInvoiceRepository']) {
      expect(imported).toContain(singleton);
    }

    // The Business OS flow-handler map is code the check reads like any other;
    // it must stay clean of it (another slice adds `plan:` there).
    const handlers = sf.statements.find(
      (s) => ts.isVariableStatement(s) && s.declarationList.declarations[0]?.name.getText(sf) === 'BUSINESS_OS_FLOW_HANDLERS'
    );
    expect(handlers).toBeDefined();
  });

  it('the rule-1 check bites: each forbidden shape is caught, the allowed ones are not (negative control, CF-5 PR 5)', () => {
    const offencesIn = (text: string) =>
      ruleOneOffences(ts.createSourceFile('snippet.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
    const IMPORTS =
      "import { supabaseServer } from '@/lib/supabaseServer';\n" +
      "import { processedWebhookEventRepository } from '@/lib/repositories/ProcessedWebhookEventRepository';\n";

    const allowed =
      IMPORTS +
      'async function accountOwner() { await resolveAccountOwner(supabaseServer, id); }\n' +
      'async function handleCheckoutCompleted() {\n' +
      '  await pilotCreditsToTokens(credits, supabaseServer);\n' +
      '  new QuotaAllocationService(supabaseServer);\n' +
      '  await processedWebhookEventRepository.complete(id);\n' +
      '  const ids = Array.from(rows);\n' +
      '  // supabaseServer.from(\'x\') in a comment does not count\n' +
      '}\n' +
      'const BUSINESS_OS_FLOW_HANDLERS = { boost: handleBoostWebhookEvent, plan: handlePlanBillingEvent };\n';
    expect(offencesIn(allowed)).toEqual([]);

    const forbidden: Array<[string, RegExp]> = [
      ["async function f() { await supabaseServer.from('user_subscriptions').select('x'); }", /^\.from\(/],
      ['async function f() { await db.from(`billing_events`).insert(row); }', /^\.from\(/],
      ["async function f() { await db['from'](\"billing_events\"); }", /^\.from\(/],
      ["async function f() { await supabaseServer.rpc('fn'); }", /^\.rpc\(/],
      ['async function f() { const db = supabaseServer; }', /^supabaseServer used/],
      ['async function f() { await pilotCreditsToTokens(credits, supabaseServer); }', /^supabaseServer used/],
      ["import { createClient } from '@supabase/supabase-js';", /^client import @supabase\/supabase-js/],
      ['const supabaseAdmin = x;', /^supabaseAdmin/],
      ['async function f() { new ProcessedWebhookEventRepository().complete(id); }', /^class ProcessedWebhookEventRepository/],
      ['async function f() { const r = processedWebhookEventRepository; await r.complete(id); }', /not a direct method call/],
      ['async function f() { const { complete } = processedWebhookEventRepository; }', /not a direct method call/],
      ['async function f() { await processedWebhookEventRepository.complete.call(null, id); }', /not a direct method call/],
      ['async function f() { await handler(processedWebhookEventRepository); }', /not a direct method call/],
    ];
    for (const [snippet, offence] of forbidden) {
      const found = offencesIn(IMPORTS + snippet);
      expect({ snippet, caught: found.some((o) => offence.test(o)) }).toEqual({ snippet, caught: true });
    }
  });

  // SA CR-P5-1: import shapes that hid a repository from the check. One test
  // each, so each can be shown red on the earlier check and green on this one.
  const parseSnippet = (text: string) => ts.createSourceFile('snippet.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  it('the rule-1 check still allows the real import shapes: column constants, the flow-handler import (CR-P5-1)', () => {
    const allowed =
      "import { supabaseServer } from '@/lib/supabaseServer';\n" +
      "import { paymentInvoiceRepository, WEBHOOK_INVOICE_LOOKUP_COLUMNS } from '@/lib/repositories/PaymentRepository';\n" +
      "import { handlePlanBillingEvent } from '@/lib/business-os/billing/planBillingEvent';\n" +
      "import { handleBoostWebhookEvent } from '@/lib/business-os/boost/boostWebhookDeps';\n" +
      'async function f() { await paymentInvoiceRepository.findByStripeInvoiceId(id, WEBHOOK_INVOICE_LOOKUP_COLUMNS); }\n' +
      'const BUSINESS_OS_FLOW_HANDLERS = { boost: handleBoostWebhookEvent, plan: handlePlanBillingEvent };\n';
    expect(ruleOneOffences(parseSnippet(allowed))).toEqual([]);
  });

  it.each<[string, string, RegExp]>([
    [
      '(a) an `as`-renamed singleton, then aliased',
      "import { userSubscriptionRepository as subs } from '@/lib/repositories/UserSubscriptionRepository';\n" +
        'async function f() { const r = subs; await r.markCanceled(id); }',
      /^repository import renamed/,
    ],
    [
      '(b) a namespace import, then a class built through it',
      "import * as R from '@/lib/repositories/UserSubscriptionRepository';\n" +
        'async function f() { await new R.UserSubscriptionRepository().markCanceled(id); }',
      /^repository namespace import/,
    ],
    [
      '(c) a relative import of a singleton, then aliased',
      "import { userSubscriptionRepository } from '../../../../lib/repositories/UserSubscriptionRepository';\n" +
        'async function f() { const r = userSubscriptionRepository; await r.markCanceled(id); }',
      /^userSubscriptionRepository not a direct method call/,
    ],
    ['(d) a default import', "import repo from '@/lib/repositories/UserSubscriptionRepository';", /^repository default import/],
  ])('the rule-1 check catches %s (CR-P5-1 negative control)', (_label, snippet, offence) => {
    const found = ruleOneOffences(parseSnippet(snippet));
    expect({ found, caught: found.some((o) => offence.test(o)) }).toEqual({ found, caught: true });
  });

  // QA PR 5: client and dynamic-import shapes. `Array.from` / `Buffer.from` stay
  // allowed only while the file does not bind those names itself; the module
  // loads the route really does (`await import()` of a service) stay allowed.
  it('the rule-1 check allows Array.from / Buffer.from with no local binding, and a dynamic import of a service (QA PR 5)', () => {
    const allowed =
      "import { supabaseServer } from '@/lib/supabaseServer';\n" +
      'async function f() {\n' +
      "  const ids = Array.from(rows);\n" +
      "  const bytes = Buffer.from('x', 'utf8');\n" +
      "  const { auditLog } = await import('@/lib/services/AuditTrailService');\n" +
      "  const { BookingEmailService } = await import('@/lib/services/BookingEmailService');\n" +
      '}\n';
    expect(ruleOneOffences(parseSnippet(allowed))).toEqual([]);
  });

  it.each<[string, string, RegExp[]]>([
    [
      'B01b: supabaseServer renamed to Array, then Array.from',
      "import { supabaseServer as Array } from '@/lib/supabaseServer';\n" +
        "async function f() { await Array.from('billing_events').insert(row); }",
      [/^supabase client import renamed supabaseServer as Array/, /^\.from\(/],
    ],
    [
      'B01c: supabaseServer renamed to Buffer, then Buffer.from',
      "import { supabaseServer as Buffer } from '@/lib/supabaseServer';\n" +
        "async function f() { await Buffer.from('billing_events').insert(row); }",
      [/^supabase client import renamed supabaseServer as Buffer/, /^\.from\(/],
    ],
    [
      'B07: a local Buffer bound to a dynamically imported client',
      "async function f() { const Buffer = (await import('@/lib/supabaseServer')).supabaseServer; await Buffer.from('billing_events').insert(row); }",
      [/^dynamic import of @\/lib\/supabaseServer/, /^\.from\(/],
    ],
    [
      'B02: supabaseServer renamed, then used for a query',
      "import { supabaseServer as db } from '@/lib/supabaseServer';\n" + 'async function f() { await db.auth.getUser(); }',
      [/^supabase client import renamed supabaseServer as db/],
    ],
    [
      'B03: a second client from the supabaseServer module',
      "import { createServerSupabaseClient } from '@/lib/supabaseServer';",
      [/^supabase client import createServerSupabaseClient/],
    ],
    [
      'B04: a repository module through require()',
      "async function f() { const m = require('@/lib/repositories/UserSubscriptionRepository'); await m.userSubscriptionRepository.markCanceled(id); }",
      [/^dynamic import of @\/lib\/repositories\/UserSubscriptionRepository/],
    ],
    [
      'B06: a repository module through import(), then a class built from it',
      "async function f() { const M = await import('@/lib/repositories/UserSubscriptionRepository'); await new M.UserSubscriptionRepository(db).markCanceled(id); }",
      [/^dynamic import of @\/lib\/repositories\/UserSubscriptionRepository/],
    ],
  ])('the rule-1 check catches %s (QA PR 5 negative control)', (_label, snippet, offences) => {
    const found = ruleOneOffences(parseSnippet(snippet));
    expect({ found, caught: offences.map((o) => found.some((f) => o.test(f))) }).toEqual({ found, caught: offences.map(() => true) });
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
