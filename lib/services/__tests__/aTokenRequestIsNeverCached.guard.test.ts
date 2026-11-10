/**
 * No request that asks a provider about credentials may be cached.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TEN-DAY OUTAGE, IN ONE LINE
 *
 * Next patches the global `fetch`. A refresh POST is the perfect cache key —
 * same URL, same headers, same body on every call — so a stored response gets
 * replayed indefinitely: the SAME access token, with the SAME `expires_in:
 * 3599` beside it, long after that token has died.
 *
 * Measured on a live account on 2026-11-09:
 *
 *     23:35:21   access token ffb70284ccab EXPIRES
 *     23:40:22   the server "refreshes" and stores ffb70284ccab
 *     23:41:02   the same refresh token, sent from a plain Node process with
 *                no patched fetch, returns a DIFFERENT token — Gmail 200
 *
 * Google cannot issue an already-expired token, so that response never came
 * from Google. A mailbox agent failed for ten days while its connection
 * refreshed every five minutes and reported success every time, because it was
 * never actually asking the provider for anything.
 *
 * Five wrong causes were shipped before this one was found, each of them a
 * theory about Google or about our storage. The provider was innocent
 * throughout.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Every fetch in a file, with the options object that follows it. */
function fetchCalls(source: string): string[] {
  const out: string[] = [];
  const re = /fetch\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(source.slice(m.index, m.index + 400));
  return out;
}

describe('the OAuth service never serves a cached credential', () => {
  const src = read('lib/services/OAuthTokenService.ts');

  it('every fetch it makes is no-store', () => {
    const calls = fetchCalls(src);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call).toMatch(/cache:\s*'no-store'/);
    }
  });

  it('including the refresh, which is the one that caused the outage', () => {
    expect(src).toMatch(/refresh_url,\s*\{\s*cache:\s*'no-store'/);
  });

  it('and the file says why, so it is not "tidied" away', () => {
    expect(src).toContain('NEVER CACHE A TOKEN REQUEST');
  });
});

describe('the pre-flight verify asks the provider every time', () => {
  it('a replayed 401 would condemn a healthy token', () => {
    /* And a replayed 200 would pass a dead one into the run — the failure is
       symmetric, which is why this one matters as much as the refresh. */
    const src = read('lib/execution/connectionsReady.ts');
    const call = fetchCalls(src)[0] ?? '';
    expect(call).toMatch(/cache:\s*'no-store'/);
  });
});

describe('the legacy Gmail strategy too', () => {
  it('its refresh is not cached either', () => {
    /* Reachable through `/api/run-agent`. A second, quieter copy of the same
       bug is still the same bug. */
    const src = read('lib/plugins/strategies/gmailDataStrategy.ts');
    const refresh = src.slice(src.indexOf('async refreshToken('));
    expect(refresh.slice(0, refresh.indexOf('const tokens'))).toMatch(/cache:\s*'no-store'/);
  });
});
