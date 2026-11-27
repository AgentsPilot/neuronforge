/**
 * The words of the version line (app version stamp R19; §5.4; SA Q5, Q6, SA-V8).
 *
 * Pure and client-safe. English and untranslated on purpose: the line is a
 * technical identifier people quote in bug reports, so everyone must see the
 * same string. The time is UTC and says so: a build time is not a business
 * hour, and a viewer's local time would give two people two different strings
 * for one build.
 *
 * A missing commit or build time is left out, never printed as "null".
 *
 * @module lib/version/formatVersionLine
 */

import type { DeploymentRole } from '@/lib/admin/environment-types';
import type { AppVersion } from '@/lib/validation/app-version-schema';

export const DEPLOYMENT_ROLE_WORDS: Readonly<Record<DeploymentRole, string>> = {
  production: 'Production',
  staging: 'Staging',
  preview: 'Preview',
  development: 'Development',
  local: 'Local',
  unknown: 'Unknown environment',
};

const SEPARATOR = ' · ';

/** `2026-01-02T03:04:05.000Z` → `2026-01-02 03:04 UTC`; null for anything unparseable. */
export function formatBuildTime(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const text = parsed.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

export function formatVersionLine(version: AppVersion): string {
  const parts: string[] = [DEPLOYMENT_ROLE_WORDS[version.environment] ?? DEPLOYMENT_ROLE_WORDS.unknown];
  if (version.commit) parts.push(version.commit);
  const builtAt = version.builtAt ? formatBuildTime(version.builtAt) : null;
  if (builtAt) parts.push(`built ${builtAt}`);
  return parts.join(SEPARATOR);
}
