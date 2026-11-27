/**
 * The version stamp's pieces (app version stamp R19; SA-V1, SA-V3, SA-V6, SA-V8):
 * the role classifier, the reader, the formatter, the schema, and the source
 * rules that keep the stamp to its three fields. Every value is made up.
 */

import * as fs from 'fs';
import * as path from 'path';

import { deploymentRoleOf, type EnvSource } from '@/lib/admin/environment/classifyEnvironment';
import { appVersionSchema } from '@/lib/validation/app-version-schema';
import { DEPLOYMENT_ROLE_WORDS, formatBuildTime, formatVersionLine } from '../formatVersionLine';
import { appVersionOf } from '../readAppVersion';

const FAKE_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const REPO = path.resolve(__dirname, '..', '..', '..');

describe('deploymentRoleOf (SA-V1)', () => {
  it.each([
    // [VERCEL_ENV, ref, NODE_ENV, role]
    ['production', 'production', 'production', 'production'],
    ['production', 'main', 'production', 'staging'],
    ['preview', 'main', 'production', 'staging'],
    ['preview', 'production', 'production', 'unknown'],
    ['preview', 'feature/x', 'production', 'preview'],
    ['preview', undefined, 'production', 'preview'],
    ['production', 'feature/x', 'production', 'unknown'],
    ['production', '', 'production', 'unknown'],
    ['production', undefined, 'production', 'unknown'],
    ['production', 'Main', 'production', 'unknown'],
    ['production', 'Production', 'production', 'unknown'],
    ['production', 'production-old', 'production', 'unknown'],
    ['preview', 'Main', 'production', 'preview'],
    ['development', 'main', 'development', 'development'],
    [undefined, undefined, 'development', 'local'],
    [undefined, 'main', 'development', 'local'],
    [undefined, undefined, 'production', 'unknown'],
    ['something-else', 'main', 'production', 'unknown'],
  ] as const)('VERCEL_ENV=%s ref=%s NODE_ENV=%s → %s', (vercelEnv, ref, nodeEnv, role) => {
    const env: EnvSource = { VERCEL_ENV: vercelEnv, VERCEL_GIT_COMMIT_REF: ref, NODE_ENV: nodeEnv };
    expect(deploymentRoleOf(env)).toBe(role);
  });
});

describe('appVersionOf', () => {
  it('builds the three fields and lower-cases and shortens the SHA', () => {
    expect(
      appVersionOf({
        VERCEL_ENV: 'production',
        VERCEL_GIT_COMMIT_REF: 'production',
        APP_BUILD_COMMIT: FAKE_SHA.toUpperCase(),
        APP_BUILD_TIME: '2026-01-02T03:04:05.000Z',
      })
    ).toEqual({ environment: 'production', commit: 'abcdef0', builtAt: '2026-01-02T03:04:05.000Z' });
  });

  it('a local build with nothing set still has all three fields', () => {
    const version = appVersionOf({ NODE_ENV: 'development' });
    expect(version).toEqual({ environment: 'local', commit: null, builtAt: null });
    expect(appVersionSchema.safeParse(version).success).toBe(true);
  });

  it('normalises a parseable build time to ISO', () => {
    expect(appVersionOf({ APP_BUILD_TIME: '2026-01-02T03:04:05Z' }).builtAt).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('appVersionSchema', () => {
  const good = { environment: 'staging', commit: 'abcdef0', builtAt: '2026-01-02T03:04:05.000Z' };
  it('accepts the three fields, with nulls', () => {
    expect(appVersionSchema.safeParse(good).success).toBe(true);
    expect(appVersionSchema.safeParse({ ...good, commit: null, builtAt: null }).success).toBe(true);
  });
  it.each([
    ['an extra field', { ...good, extra: 'x' }],
    ['an unknown role', { ...good, environment: 'qa' }],
    ['a word instead of an id', { ...good, environment: 'Staging' }],
    ['a full SHA', { ...good, commit: FAKE_SHA }],
    ['an upper-case SHA', { ...good, commit: 'ABCDEF0' }],
    ['a non-ISO time', { ...good, builtAt: 'yesterday' }],
  ])('rejects %s', (_case, value) => {
    expect(appVersionSchema.safeParse(value).success).toBe(false);
  });
});

describe('formatVersionLine (SA Q5, SA-V8)', () => {
  it('reads role · commit · built time UTC', () => {
    expect(formatVersionLine({ environment: 'staging', commit: 'abcdef0', builtAt: '2026-01-02T03:04:05.000Z' })).toBe(
      'Staging · abcdef0 · built 2026-01-02 03:04 UTC'
    );
  });
  it('leaves out what is missing and never prints null', () => {
    const line = formatVersionLine({ environment: 'local', commit: null, builtAt: null });
    expect(line).toBe('Local');
    expect(line).not.toContain('null');
    expect(formatVersionLine({ environment: 'production', commit: 'abcdef0', builtAt: null })).toBe('Production · abcdef0');
  });
  it('has words for every role', () => {
    expect(Object.keys(DEPLOYMENT_ROLE_WORDS).sort()).toEqual(
      ['development', 'local', 'preview', 'production', 'staging', 'unknown']
    );
  });
  it('formatBuildTime is null for garbage', () => {
    expect(formatBuildTime('not-a-time')).toBeNull();
  });
});

describe('source rules (SA-V3, SA-V6)', () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', '__tests__', '__mocks__', '.git', '.claude'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('APP_BUILD_* is read only by readAppVersion.ts (and set only by next.config.js)', () => {
    const readers = ['app', 'lib', 'components', 'hooks']
      .flatMap((root) => sourceFiles(path.join(REPO, root)))
      .filter((file) => /process\.env\.APP_BUILD_|process\.env\[['"]APP_BUILD_/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file).split(path.sep).join('/'));
    expect(readers).toEqual(['lib/version/readAppVersion.ts']);
  });

  it('the reader imports server-only and never uses process.env whole', () => {
    const src = fs.readFileSync(path.join(REPO, 'lib/version/readAppVersion.ts'), 'utf8');
    expect(src).toMatch(/^import 'server-only';$/m);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/process\.env(?![.\w])/);
  });
});
