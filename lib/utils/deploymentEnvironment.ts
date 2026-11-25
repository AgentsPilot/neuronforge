/**
 * Is this deployment Vercel's production deployment?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS THE RUNTIME `VERCEL_ENV`, AND ONLY THAT (PROD-1b, SA D-3).
 *
 * Vercel sets `VERCEL_ENV` on the server at runtime: `production` on the
 * Production Branch's deployments, `preview` on every other deployment
 * (custom environments included), and nothing locally or under Jest.
 *
 * This is deliberately NOT `lib/utils/origins.ts`'s environment reader, which
 * prefers the build-inlined `NEXT_PUBLIC_VERCEL_ENV` so browser code can share
 * it. That one answers "which address should a link point at"; this one
 * answers "may this server act as production", and a value baked in at build
 * time is the wrong witness for that. It is not a second origin resolver.
 *
 * Exact comparison, read per call. An unexpected value (`Production`, padded,
 * empty) reads as NOT production, so every guard built on this fails closed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Moved here from `lib/notifications/emailTransport.ts`, where it was private,
 * so the email guard and the transport's keyed-send check share one definition.
 *
 * @module lib/utils/deploymentEnvironment
 */

/*
 * The parameter exists for tests; callers pass nothing. A literal
 * `process.env.VERCEL_ENV` read (not the whole object) keeps the admin
 * Environment page's drift guard able to see what this reads.
 */
export function isProductionDeployment(vercelEnv: string | undefined = process.env.VERCEL_ENV): boolean {
  return vercelEnv === 'production';
}
