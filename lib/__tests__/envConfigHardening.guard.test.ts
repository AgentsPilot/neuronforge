/**
 * Source guards for the environment configuration hardening
 * (docs/requirements/ENV_CONFIG_HARDENING_REQUIREMENT.md). Plain file reads only.
 *
 * G-1 next.config.js passes no NANGO_* name through the build.
 * G-2 no code under lib/, app/ or components/ reads the old public-prefixed
 *     Slack secret name; V1 and V2 Slack code both use SLACK_CLIENT_SECRET.
 * G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
// Built from parts so this guard does not match itself.
const OLD_SLACK_NAME = ['NEXT', 'PUBLIC', 'SLACK', 'CLIENT', 'SECRET'].join('_');
const SCAN_DIRS = ['lib', 'app', 'components'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const CATALOGUE = path.join('lib', 'admin', 'environment', 'catalogue.ts');

function isExcluded(rel: string): boolean {
  return rel.includes('__tests__') || /\.test\.(ts|tsx|js)$/.test(rel) || rel === CATALOGUE;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
}

describe('environment configuration hardening guards', () => {
  it('G-1 next.config.js names no NANGO_ variable', () => {
    const src = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    expect(src).not.toMatch(/NANGO_/);
  });

  it('G-2 no source file reads the old public-prefixed Slack secret name', () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);
    // A broken walk would scan nothing and pass vacuously.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .map((f) => path.relative(ROOT, f))
      .filter((rel) => !isExcluded(rel))
      .filter((rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(OLD_SLACK_NAME));
    expect(offenders).toEqual([]);
  });

  it('G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'plugins', 'strategies', 'slackPluginStrategy.ts'), 'utf8');
    expect(src).toContain('process.env.SLACK_CLIENT_SECRET');
  });
});
