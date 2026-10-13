/**
 * No Supabase client on the request path opens sockets without a ceiling.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A GUARD AND NOT A UNIT TEST
 *
 * `supabaseFetch` queues requests past a cap so a burst waits instead of
 * opening another socket, and `supabaseFetch.test.ts` proves the queue works.
 * This proves something different and easier to lose: that the clients
 * actually USE it.
 *
 * They did not. The pool's own header quotes the stack trace it was written
 * for —
 *
 *     TypeError: fetch failed … read ECONNRESET
 *       at GoTrueClient._getUser
 *
 * — and `supabaseServer` and `supabaseAdmin` were wired in while the two AUTH
 * clients were not. So the one query every route makes first, on every request,
 * was the one with no bound. The same error came back on 2026-10-10:
 *
 *     TypeError: fetch failed … UND_ERR_SOCKET: other side closed
 *       at SupabaseAuthClient._getUser
 *       bytesWritten: 1884, bytesRead: 0
 *
 * A request written in full and nothing read back: the far end dropped it.
 *
 * AND THE FAILURE WEARS A DISGUISE. A dropped auth socket does not surface as
 * an outage — it surfaces as `user === null`, which is a false 401. A signed-in
 * owner is told they are not signed in, and the log says their session was
 * invalid rather than that the connection died.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Every module that builds a Supabase client something reaches on a REQUEST.
 *
 * Not every `createClient` in the repo: the agent pipeline, the calibration
 * scripts and the memory summariser build their own, and they are not what a
 * page load fires thirty of. The cap exists for the request path.
 */
const REQUEST_PATH_CLIENTS = [
  'lib/supabaseServer.ts',
  'lib/supabaseAdmin.ts',
  'lib/supabaseServerAuth.ts',
  'lib/auth.ts',
  'lib/security/onboardingVerdict.ts',
];

describe('every client on the request path is inside the pool', () => {
  it.each(REQUEST_PATH_CLIENTS)('%s passes supabaseFetch', path => {
    const source = read(path);

    expect(source).toContain("from '@/lib/supabaseFetch'");
    expect(source).toMatch(/global:\s*\{\s*fetch:\s*supabaseFetch\s*\}/);
  });

  /*
   * The two that were missing, named individually.
   *
   * `it.each` above would go green if somebody deleted a row from the list, so
   * the two this was written for are asserted by name as well — a deletion is
   * how a guard quietly stops guarding.
   */
  it('includes the authenticated server client', () => {
    expect(REQUEST_PATH_CLIENTS).toContain('lib/supabaseServerAuth.ts');
  });

  it('includes the one behind getUser, which every route calls first', () => {
    expect(REQUEST_PATH_CLIENTS).toContain('lib/auth.ts');
  });
});

describe('the pool itself', () => {
  const source = read('lib/supabaseFetch.ts');

  it('queues past the limit rather than opening another socket', () => {
    // The whole bargain: waiting ~80ms is invisible, a reset is a false 401.
    expect(source).toMatch(/waiting/);
    expect(source).not.toMatch(/throw new Error\('too many/i);
  });

  /*
   * Deliberately NOT `setGlobalDispatcher`. That would cap every outbound
   * request in the process — Stripe and the mail transport included — and
   * throttling a payment confirmation behind a queue of CRM reads is a worse
   * bug than the one being fixed.
   */
  it('wraps the Supabase clients only, not the whole process', () => {
    // The CALL, not the word — the header explains at length why it is not
    // used, so a bare substring match would find its own rationale.
    expect(source).not.toMatch(/setGlobalDispatcher\s*\(/);
    expect(source).not.toMatch(/from ['"]undici['"]/);
  });
});
