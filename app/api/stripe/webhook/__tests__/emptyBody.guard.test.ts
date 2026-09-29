/**
 * Source-level guard for the empty-body branch in the Stripe webhook route.
 *
 * On 2026-09-28 a `payment_intent.succeeded` for `pi_3UKhXJ616o7Lmjqf` was
 * dropped locally and logged as "Signature verification failed:
 * StripeSignatureVerificationError: No webhook payload was provided" with
 * `payload: ''`. The signature header was present and both secrets were
 * configured — nothing was wrong with either. The request had been aborted
 * between its headers and its body, so `await request.text()` resolved to ''.
 *
 * The misleading message is what made that expensive to find, so these tests
 * pin the branch that names the real cause, and pin that it cannot drift below
 * the verification loop (where it would never be reached for an empty body,
 * and the old message would come back).
 *
 * This is a source-level test on purpose: the route is ~2,750 lines and pulls
 * in Stripe, Supabase and a dozen services at module load, so importing it to
 * assert on twenty lines would test the imports rather than the branch.
 */

import fs from 'fs';
import path from 'path';

const ROUTE = path.join(process.cwd(), 'app/api/stripe/webhook/route.ts');
const source = fs.readFileSync(ROUTE, 'utf8');

/** The POST handler only — the file holds many other exports. */
const handler = source.slice(source.indexOf('export async function POST(request: NextRequest)'));

const idx = {
  bodyRead: handler.indexOf('const body = await request.text();'),
  signatureRead: handler.indexOf("request.headers.get('stripe-signature')"),
  emptyGuard: handler.indexOf('if (!body) {'),
  verifyLoop: handler.indexOf('for (const secret of secrets)'),
  constructCall: handler.indexOf('constructWebhookEvent(body, signature, secret)'),
};

describe('stripe webhook — empty body is reported as an aborted request, not a bad signature', () => {
  it('reads the body exactly once (a second read would itself yield an empty string)', () => {
    const reads = handler.match(/request\.(text|json|arrayBuffer|blob|formData)\(\)/g) ?? [];
    expect(reads).toEqual(['request.text()']);
  });

  it('guards the empty body before attempting signature verification', () => {
    expect(idx.emptyGuard).toBeGreaterThan(-1);
    expect(idx.emptyGuard).toBeGreaterThan(idx.bodyRead);
    expect(idx.emptyGuard).toBeLessThan(idx.verifyLoop);
    expect(idx.emptyGuard).toBeLessThan(idx.constructCall);
  });

  it('only reaches the guard once the signature header is known to be present', () => {
    // An empty body with no signature is a different (and less interesting)
    // request; the existing missing-header branch should still own it.
    expect(idx.signatureRead).toBeLessThan(idx.emptyGuard);
  });

  it('returns 400 for the empty body, so Stripe retries rather than considering it delivered', () => {
    const branch = handler.slice(idx.emptyGuard, idx.verifyLoop);
    expect(branch).toContain('status: 400');
    expect(branch).not.toContain('status: 200');
  });

  it('does not describe an empty body as a signature failure', () => {
    const branch = handler.slice(idx.emptyGuard, idx.verifyLoop);
    expect(branch).toMatch(/Empty request body/i);
    expect(branch).not.toMatch(/signature verification failed/i);
  });

  it('leaves the real signature-failure branch intact for bodies that do arrive', () => {
    const afterLoop = handler.slice(idx.verifyLoop);
    expect(afterLoop).toContain('if (!event)');
    expect(afterLoop).toMatch(/Signature verification failed/);
    expect(afterLoop).toContain("{ error: 'Invalid signature' }");
  });

  it('still tries every configured secret before declaring a signature failure', () => {
    // The platform and Connect secrets both reach this endpoint depending on a
    // dashboard setting; collapsing the loop to one secret would silently drop
    // connected-account events.
    expect(handler).toContain('process.env.STRIPE_WEBHOOK_SECRET');
    expect(handler).toContain('process.env.STRIPE_CONNECT_WEBHOOK_SECRET');
    expect(idx.constructCall).toBeGreaterThan(idx.verifyLoop);
  });
});
