/**
 * Let the real chat route run outside Next.
 *
 * Two modules exist only inside the bundler: `server-only`, which is a compile
 * marker, and `@/lib/auth`, whose `getUser` reads request cookies. Everything
 * else the route touches — the planner, the compiler, the repositories, the
 * conversation memory — is ordinary code that runs fine here.
 *
 * So those two are aliased and nothing else is. The point of this probe is that
 * it exercises the SAME handler the browser hits; a re-implementation would
 * agree with itself and tell us nothing.
 *
 * CHAT_PROBE_USER_ID names the account whose data is being asked about.
 */
const Module = require('module');
const path = require('path');

const resolve = Module._resolveFilename;
const NOOP = path.join(__dirname, 'noop.cjs');
const AUTH = path.join(__dirname, 'auth-stub.cjs');

Module._resolveFilename = function (request, ...args) {
  if (request === 'server-only' || request === 'client-only') return NOOP;
  if (request === '@/lib/auth' || request.endsWith('/lib/auth')) return AUTH;
  return resolve.call(this, request, ...args);
};
