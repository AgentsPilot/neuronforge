/**
 * Cross-cutting conventions every plugin executor must follow.
 *
 * These are source-level scans rather than behavioural tests, because the bugs
 * they guard against are invisible at runtime in unit tests: a mock connection
 * object built with the wrong casing satisfies both the code and the mock, so
 * the executor passes its own suite while failing against every real token.
 *
 * Origin: meta-ads-plugin-executor read `connection.accessToken` (camelCase)
 * when UserConnection stores `access_token`. Every Graph API call went out with
 * an undefined token, and the plugin was non-functional in production while its
 * unit tests were green.
 */

import * as fs from 'fs';
import * as path from 'path';

const SERVER_DIR = path.join(__dirname, '../../../lib/server');

/** Strip comments so documentation about a bad pattern doesn't count as the bad pattern. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function executorFiles(): { name: string; source: string }[] {
  return fs
    .readdirSync(SERVER_DIR)
    .filter(f => f.endsWith('-plugin-executor.ts'))
    .map(name => ({
      name,
      source: stripComments(fs.readFileSync(path.join(SERVER_DIR, name), 'utf8')),
    }));
}

describe('[smoke] plugin executor conventions', () => {
  it('finds executor files to check', () => {
    expect(executorFiles().length).toBeGreaterThan(10);
  });

  it('reads credentials from UserConnection using snake_case fields', () => {
    const offenders = executorFiles()
      .filter(({ source }) => /connection\s*\.\s*(accessToken|refreshToken|expiresAt|profileData)\b/.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  it('never logs a URL that carries the access token in its query string', () => {
    // Meta puts the token in the query string for GET. Logging the assembled URL
    // writes a live credential into the log stream.
    const offenders = executorFiles()
      .filter(({ source }) => /logger\.\w+\(\s*\{[^}]*\burl:\s*fullUrl\b/.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  /**
   * Executors that still log via console, predating the Pino standard. This list
   * is a ratchet: it may shrink, never grow. Converting one of these means
   * deleting its entry here — and a new executor can never be added to it.
   */
  const KNOWN_CONSOLE_OFFENDERS = [
    'airtable-plugin-executor.ts',
    'chatgpt-research-plugin-executor.ts',
    'hubspot-plugin-executor.ts',
    'linkedin-plugin-executor.ts',
    'slack-plugin-executor.ts',
    'whatsapp-business-plugin-executor.ts',
  ];

  it('introduces no new console logging in executors', () => {
    const offenders = executorFiles()
      .filter(({ source }) => /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(source))
      .map(({ name }) => name);

    const unexpected = offenders.filter(name => !KNOWN_CONSOLE_OFFENDERS.includes(name));
    expect(unexpected).toEqual([]);
  });

  it('keeps the console allowlist honest as files are converted', () => {
    const offenders = executorFiles()
      .filter(({ source }) => /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(source))
      .map(({ name }) => name);

    // A name left here after its file was cleaned up means the ratchet stopped
    // protecting that file. Remove it from the list.
    const staleEntries = KNOWN_CONSOLE_OFFENDERS.filter(name => !offenders.includes(name));
    expect(staleEntries).toEqual([]);
  });
});
