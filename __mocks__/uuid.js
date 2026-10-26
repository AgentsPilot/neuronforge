/**
 * `uuid`, for Jest only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * uuid v13 is ESM-ONLY — both `dist-node/index.js` and `dist/index.js` are
 * `export` files, and there is no CommonJS build to point at. Jest does not
 * transform `node_modules`, so any test that transitively reaches uuid dies
 * with "Jest encountered an unexpected token" before a single assertion runs.
 *
 * That is what happened to `app/api/cron/__tests__/runRecord.adoption.test.ts`:
 * it imports every cron route, and the `inbox-enquiries` route reaches
 * `lib/pilot`, which reaches uuid. Three tests failed on a parse error, so the
 * cron-adoption guard — which is what makes sure every scheduled route records
 * its runs — was not actually checking that route at all.
 *
 * Same situation as `lib-address/lite` in `jest.config.js`: a Jest gap, not a
 * product one. Webpack handles the ESM natively, so production is unaffected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A BEHAVIOUR-CHANGING STUB
 *
 * `crypto.randomUUID()` returns a real RFC-4122 version-4 UUID from the
 * platform's own CSPRNG — the same thing uuid's `v4()` returns, by the same
 * standard. Tests that assert "this is a v4 UUID", that it is unique, or that
 * it parses, all hold. Only `v4` is mapped because only `v4` is imported
 * anywhere in this repo; anything else should fail loudly rather than silently
 * return something plausible.
 */

const { randomUUID } = require('crypto');

const v4 = () => randomUUID();

module.exports = { v4 };
