/**
 * Which build is running: environment role, short commit, build time
 * (app version stamp R19; DEVELOPMENT_LIFECYCLE.md §5.4; SA-V3 to SA-V6).
 *
 * The ONLY reader of `APP_BUILD_COMMIT` and `APP_BUILD_TIME` (SA-V6). Both
 * are set by `next.config.js` `env` at build time and inlined into the compiled
 * code, so no runtime setting can change them. The role comes from the
 * deployment's own `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF`, through the admin
 * environment module's one classifier, so the stamp and /admin/environment
 * cannot disagree about which environment this is.
 *
 * Each name is read LITERALLY into an explicit object (SA-V3): never the whole
 * `process.env`, which would also defeat Next's inlining.
 *
 * Fails soft: a value that is missing or malformed becomes `null`, never an
 * error, because a version probe that throws tells the smoke test nothing.
 *
 * @module lib/version/readAppVersion
 */

import 'server-only';

import { deploymentRoleOf } from '@/lib/admin/environment/classifyEnvironment';
import type { AppVersion } from '@/lib/validation/app-version-schema';

/** The only names this stamp reads. */
export interface AppVersionSource {
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  NODE_ENV?: string;
  APP_BUILD_COMMIT?: string;
  APP_BUILD_TIME?: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const SHORT_LENGTH = 7;

/** The literal reads. Kept apart from the logic so tests never touch `process.env`. */
export function currentAppVersionSource(): AppVersionSource {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    NODE_ENV: process.env.NODE_ENV,
    APP_BUILD_COMMIT: process.env.APP_BUILD_COMMIT,
    APP_BUILD_TIME: process.env.APP_BUILD_TIME,
  };
}

function shortCommitOf(raw: string | undefined): string | null {
  const text = (raw ?? '').trim().toLowerCase();
  return FULL_SHA.test(text) ? text.slice(0, SHORT_LENGTH) : null;
}

function builtAtOf(raw: string | undefined): string | null {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Normalised, so the schema's ISO check always sees the canonical form.
  return parsed.toISOString();
}

/** Pure: builds the stamp from the given names only. */
export function appVersionOf(source: AppVersionSource): AppVersion {
  return {
    environment: deploymentRoleOf({
      VERCEL_ENV: source.VERCEL_ENV,
      VERCEL_GIT_COMMIT_REF: source.VERCEL_GIT_COMMIT_REF,
      NODE_ENV: source.NODE_ENV,
    }),
    commit: shortCommitOf(source.APP_BUILD_COMMIT),
    builtAt: builtAtOf(source.APP_BUILD_TIME),
  };
}
