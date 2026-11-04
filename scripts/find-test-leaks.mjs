#!/usr/bin/env node
// find-test-leaks.mjs: which network calls does this suite make, and is it
// really the one making them?
//
// `npm run test:leaks -- <path> [<path>...]`
//
// G8 in .github/ci/jest-gate-check.mjs counts refused connections across the
// whole gate and holds the total to a ceiling. It deliberately accuses no test,
// because it cannot: tests/jest-no-network.ts installs once per worker, so a
// socket opened by a promise an earlier file left floating is charged to
// whichever file is running when it opens. This is the other half — the way to
// settle attribution rather than guess at it.
//
// Run with ONE suite and `--runInBand`: there is no earlier file in the worker,
// so there is nothing to inherit, and every refusal recorded really was made by
// that suite. A suite the gate pointed at that records nothing here is innocent,
// and the leak belongs to a file that ran before it.
//
// --runTestsByPath, NOT a bare path argument: Jest treats a bare path as a
// REGEX, so a Next.js route folder such as `[accountId]` is a character class
// and the suite is silently skipped — a run that proves nothing while looking
// like a pass.
//
// EXIT CODES SAY WHETHER THIS RAN, NOT WHAT IT FOUND. 0 means the question was
// answered, leaks or none; 2 means it could not be answered (no path given, no
// jest, or jest failed to launch). Finding leaks is a 0 — read the report.
//
// One file it cannot answer for: tests/jest-no-network.guard.test.ts, which the
// guard exempts from RECORDING so its deliberate attempts never inflate the
// gate's count. The report says so rather than calling it clean.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Jest's own entry point, found by walking up for it.
 *
 * Not `require.resolve('jest/bin/jest.js')`, which the package's `exports` map
 * refuses, and not `npx`, which on Windows is a `.cmd` that `execFile` cannot
 * launch without a shell. Walking up also finds the install a git worktree
 * shares with its parent checkout, which is how this repo's worktrees are set
 * up — they have no `node_modules` of their own.
 */
function findJest() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', 'jest', 'bin', 'jest.js');
    if (existsSync(candidate)) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

const paths = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (paths.length === 0) {
  console.error('usage: npm run test:leaks -- <test path> [<test path>...]');
  console.error('       one suite at a time gives provable attribution; more than one does not');
  process.exit(2);
}

const jest = findJest();
if (!jest) {
  console.error('could not find node_modules/jest/bin/jest.js from here or any parent directory');
  process.exit(2);
}

const dir = mkdtempSync(path.join(tmpdir(), 'test-leaks-'));

/* In a function so every exit path runs the cleanup in the `finally` below:
   `process.exit` would skip it, and a top-level `return` is not allowed. */
function run() {
  try {
    execFileSync(
      process.execPath,
      [jest, '--config', 'jest.config.js', '--runInBand', '--ci', '--runTestsByPath', ...paths],
      { stdio: 'inherit', env: { ...process.env, NO_NETWORK_RECORD_DIR: dir } }
    );
  } catch (err) {
    /*
     * A red suite still leaks, and its records are what we came for — but a
     * jest that never STARTED records nothing, and reporting that as "no
     * leaks" is the silent pass this whole guard exists to abolish. `status`
     * is null when the child could not be spawned at all.
     */
    if (err.status === null || err.status === undefined) {
      console.error(`\ncould not run jest: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    console.log('\n(the suite was not green — the records below still stand)');
  }

  const records = [];
  let truncated = false;
  let unreadable = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        /*
         * A worker killed mid-append leaves a partial line. Counting it and
         * carrying on, rather than throwing: the `finally` below deletes the
         * temp directory, so an unguarded parse would destroy every record
         * this run collected over one truncated line.
         */
        unreadable++;
        continue;
      }
      if (r.truncated) truncated = true;
      else records.push(r);
    }
  }
  if (unreadable > 0) console.log(`(${unreadable} record line(s) could not be read and are not counted below)`);

  console.log('\n' + '-'.repeat(72));
  if (records.length === 0) {
    if (paths.some((p) => p.includes('jest-no-network.guard.test'))) {
      /*
       * The one file this tool cannot answer for. It refuses connections
       * deliberately, and the guard exempts it from RECORDING so those
       * attempts never inflate the gate's count — so "no records"
       * here means "exempt", not "clean", and saying otherwise would be a lie
       * from the tool that exists to replace guessing.
       */
      console.log("The guard's own test is EXEMPT from recording, so this says nothing about it.");
      console.log('It opens connections on purpose, to prove they are refused. See GUARDS_OWN_TEST');
      console.log('in tests/jest-no-network.ts.');
    } else {
      console.log('No refused connections. This suite does not reach the network on its own.');
      console.log('If the gate named it, the leak is in a file that ran BEFORE it in the worker.');
    }
    return;
  }

  const only = paths.length === 1;
  console.log(
    `${records.length} refused connection(s)` +
      (only ? ', provably from this suite (it ran alone, in band).' : '.') +
      (only ? '' : ' Several suites ran, so attribution between them is NOT proved — rerun one at a time.')
  );
  if (truncated) console.log('A worker hit its record cap, so there were more than this.');

  const tally = (key) => {
    const counts = new Map();
    for (const r of records) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log('\nDestinations:');
  for (const [k, c] of tally((r) => r.destination ?? '?')) console.log(`  ${c} x ${k}`);

  console.log('\nThe code path that opened the socket (the transport, not the caller):');
  for (const [k, c] of tally((r) => (r.transport ?? []).join(' <- ') || 'no repo frame')) {
    console.log(`  ${c} x ${k}`);
  }

  console.log('\nThe case that was running:');
  for (const [k, c] of tally((r) => r.possiblyNotTheOriginCase ?? '(none — during an import, or after the last case)')) {
    console.log(`  ${c} x ${k}`);
  }

  console.log(
    '\nTo fix: stub the seam the call goes through, so the suite never reaches it.',
    "\nFor Supabase that is jest.mock('@/lib/supabaseServer', ...), which most",
    '\ntest files already do; for the audit write, tests/helpers/silentAuditTrail.ts.',
    '\nA call to a live endpoint belongs in tests/plugins/integration-tests/.'
  );
}

try {
  run();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
