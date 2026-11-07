/**
 * G8's gate-side logic: `.github/ci/jest-gate-check.mjs`, the half of the
 * no-network mechanism that nothing covered.
 *
 * WHY THIS EXISTS. Every way G8 can be wrong makes it PASS — a shard that
 * never recorded, a marker that cannot confirm the guard was on, a ceiling
 * that is present but unusable all read as "zero refusals, nothing to compare
 * against". SA's first pass over the script found five such paths reporting
 * PASS without looking; the fixtures that proved the fixes were run by hand
 * and never committed, so an edit to the script could restore any of them in
 * silence. The ceiling is now pinned at 0 (PR #633), which makes those rails
 * the live part of the check rather than scaffolding: if they stop biting, the
 * gate is open and the step summary still says pass. The five are marked
 * SA CR-N1..CR-N5 below.
 *
 * HOW. The script is spawned the way the workflow spawns it, against a fixture
 * tree in a temp directory. `--root` and `--quarantine` exist for exactly
 * this: the script then reads the fixture's quarantine and resolves listed
 * paths against the fixture root, so no case here depends on the repo's real
 * suite counts or on the real ceiling.
 *
 * The baseline case is fully green and exits 0. That is what makes the
 * negative cases mean anything — a harness that could only ever report FAIL
 * would prove nothing, which is the failure mode the cases themselves are
 * about.
 *
 * No test here reaches the network: the child reads files and runs `git
 * cat-file` for G3. Only G8's row is asserted on; the other checks' rows are
 * incidental.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, '.github', 'ci', 'jest-gate-check.mjs');

/** The one suite the fixture's listings name. Its content is never read. */
const SUITE = 'fake/only.test.ts';

const fixtures: string[] = [];

afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A fixture that passes every check, which each case then breaks in one way.
 *
 * realpath, because on Windows the temp directory is reached through a path
 * the script's `path.relative(root, …)` would otherwise read as outside the
 * root — a thrown "path outside the repo root", which is a FAIL for the wrong
 * reason.
 */
function clean(): string {
  const fx = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'g8-gate-')));
  fixtures.push(fx);

  const suite = path.join(fx, SUITE);
  fs.mkdirSync(path.dirname(suite), { recursive: true });
  fs.writeFileSync(suite, '');
  // `jest --listTests` prints one absolute path per line, native separators.
  fs.writeFileSync(path.join(fx, 'full.txt'), `${suite}\n`);
  fs.writeFileSync(path.join(fx, 'gate.txt'), `${suite}\n`);

  quarantine(fx, { suites: [], minSuites: 1, minTests: 1, maxRefusedConnections: 0 });
  results(fx, 'gate-results-1-of-1.json', {
    numTotalTestSuites: 1,
    numFailedTestSuites: 0,
    numRuntimeErrorTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ name: suite, status: 'passed' }],
  });

  const shard = shardDir(fx, 1);
  fs.mkdirSync(shard, { recursive: true });
  fs.writeFileSync(path.join(shard, 'present.json'), JSON.stringify({ allowTestNetwork: false }));
  fs.writeFileSync(path.join(shard, 'alive-w1-1.json'), JSON.stringify({ pid: 1 }));

  return fx;
}

function quarantine(fx: string, value: unknown): void {
  fs.writeFileSync(path.join(fx, 'quarantine.json'), JSON.stringify(value, null, 2));
}

function results(fx: string, name: string, value: unknown): void {
  const dir = path.join(fx, 'gate-out');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
}

function shardDir(fx: string, i: number): string {
  return path.join(fx, 'gate-out', 'no-network', `shard-${i}`);
}

/** One refusal, shaped as tests/jest-no-network.ts writes them. */
function refusal(destination = 'test.supabase.co:443'): string {
  return JSON.stringify({
    destination,
    transport: ['lib/supabaseFetch.ts'],
    possiblyNotTheOriginFile: SUITE,
    possiblyNotTheOriginCase: 'reads a row',
  });
}

function writeRefusals(fx: string, lines: string[], name = 'refusals-w1-1.jsonl'): void {
  fs.writeFileSync(path.join(shardDir(fx, 1), name), lines.join('\n') + '\n');
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Exactly the workflow's invocation, plus the two flags that point it at a
 * fixture. `--base HEAD` resolves in a shallow clone too; G3 then compares the
 * fixture's quarantine against the real one at HEAD, which is harmless because
 * the fixture quarantines nothing.
 */
function run(fx: string): Run {
  const out = spawnSync(
    process.execPath,
    [
      SCRIPT,
      '--full-list', path.join(fx, 'full.txt'),
      '--gate-list', path.join(fx, 'gate.txt'),
      '--results-dir', path.join(fx, 'gate-out'),
      '--quarantine', path.join(fx, 'quarantine.json'),
      '--root', fx,
      '--base', 'HEAD',
    ],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }
  );
  return { status: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

type Verdict = 'PASS' | 'FAIL' | 'MISSING';

/**
 * G8's own row. Passing checks print to stdout and failing ones to stderr, so
 * each stream holds at most one of the two and a block runs to the next check
 * line in the same stream — or, for a pass, to the trailer.
 */
function g8(out: Run): { verdict: Verdict; detail: string } {
  const block = (text: string, verdict: 'PASS' | 'FAIL'): string | null => {
    const head = `${verdict}  G8 refused connections: `;
    const at = text.indexOf(head);
    if (at < 0) return null;
    const rest = text.slice(at + head.length);
    const end = rest.search(/\n(?:PASS|FAIL) {2}G\d|\njest-gate-check:/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const failed = block(out.stderr, 'FAIL');
  if (failed !== null) return { verdict: 'FAIL', detail: failed };
  const passed = block(out.stdout, 'PASS');
  if (passed !== null) return { verdict: 'PASS', detail: passed };
  // The check did not run at all, which is not a pass.
  return { verdict: 'MISSING', detail: `${out.stdout}\n${out.stderr}` };
}

/** A FAIL that names its reason, and takes the whole script down with it. */
function expectFail(out: Run, because: RegExp): void {
  const row = g8(out);
  expect(row.verdict).toBe('FAIL');
  expect(row.detail).toMatch(because);
  expect(out.status).toBe(1);
}

describe('the baseline fixture (what makes a FAIL below mean something)', () => {
  it('passes every check and exits 0', () => {
    const out = run(clean());
    const row = g8(out);
    expect(row.verdict).toBe('PASS');
    expect(row.detail).toMatch(/0 refused connection\(s\) vs ceiling 0 \(margin 0\)/);
    // Every check, not just G8 — but by the absence of FAIL lines rather than
    // an empty stderr, which a Node runtime warning would break for nothing.
    expect(out.stderr).not.toMatch(/^FAIL {2}G\d/m);
    expect(out.status).toBe(0);
  });
});

describe('a shard whose evidence is missing or unprovable', () => {
  it('fails when a shard wrote no marker, rather than reading its silence as zero', () => {
    const fx = clean();
    fs.rmSync(path.join(shardDir(fx, 1), 'present.json'));
    expectFail(run(fx), /shard 1 wrote no marker/);
  });

  it('fails when a marker is not valid JSON', () => {
    const fx = clean();
    fs.writeFileSync(path.join(shardDir(fx, 1), 'present.json'), '{ not json');
    expectFail(run(fx), /marker is not valid JSON/);
  });

  // SA CR-N1: the key absent read as absent-is-fine, so the guard could be
  // switched off by deleting one line of the workflow.
  it('fails when the marker omits allowTestNetwork', () => {
    const fx = clean();
    fs.writeFileSync(path.join(shardDir(fx, 1), 'present.json'), JSON.stringify({ shard: 1 }));
    expectFail(run(fx), /does not state allowTestNetwork: false \(got undefined\)/);
  });

  // SA CR-N2: `"false"` is truthy, and a printf-built marker is how it would
  // get quoted.
  it('fails when the marker quotes the value', () => {
    const fx = clean();
    fs.writeFileSync(
      path.join(shardDir(fx, 1), 'present.json'),
      JSON.stringify({ allowTestNetwork: 'false' })
    );
    expectFail(run(fx), /does not state allowTestNetwork: false \(got "false"\)/);
  });

  it('fails when the marker says the guard was allowed to reach the network', () => {
    const fx = clean();
    fs.writeFileSync(
      path.join(shardDir(fx, 1), 'present.json'),
      JSON.stringify({ allowTestNetwork: true })
    );
    expectFail(run(fx), /ALLOW_TEST_NETWORK=1 disables the guard entirely/);
  });

  // SA CR-N3: the marker only proves the WORKFLOW meant to record. Without the
  // guard's own proof of life, a renamed env var leaves an empty directory
  // that reads as a clean run.
  it('fails when a marker claims recording but no alive-* file backs it', () => {
    const fx = clean();
    fs.rmSync(path.join(shardDir(fx, 1), 'alive-w1-1.json'));
    expectFail(run(fx), /no alive-\* file.*never recorded/s);
  });

  it('fails when a shard the result filenames promise recorded nothing at all', () => {
    const fx = clean();
    // Two shards named, only shard 1 present: the second's refusals are unknown.
    fs.renameSync(
      path.join(fx, 'gate-out', 'gate-results-1-of-1.json'),
      path.join(fx, 'gate-out', 'gate-results-1-of-2.json')
    );
    expectFail(run(fx), /shard 2 wrote no marker/);
  });

  it('fails when the shard count cannot be derived, so completeness is unprovable', () => {
    const fx = clean();
    results(fx, 'gate-results-1-of-2.json', { testResults: [] });
    expectFail(run(fx), /shard count could not be derived/);
  });
});

describe('records that cannot be counted', () => {
  // SA CR-N4: a filename the pattern does not match was skipped in silence,
  // so a worker's whole record file could go uncounted.
  it('fails on a record file whose name it does not recognise', () => {
    const fx = clean();
    writeRefusals(fx, [refusal()], 'refusals-w1.jsonl');
    expectFail(run(fx), /file\(s\) this check does not recognise/);
  });

  it('fails on a record line that is not valid JSON', () => {
    const fx = clean();
    writeRefusals(fx, ['{ truncated mid-write']);
    expectFail(run(fx), /holds a line that is not valid JSON/);
  });

  it('fails when a worker hit its record cap, because the count is then a floor', () => {
    const fx = clean();
    writeRefusals(fx, [JSON.stringify({ truncated: true, worker: 1 })]);
    expectFail(run(fx), /hit its record cap/);
  });
});

describe('the ceiling', () => {
  it('fails when the count is over it', () => {
    const fx = clean();
    writeRefusals(fx, [refusal()]);
    expectFail(run(fx), /1 refused connection\(s\), ceiling 0/);
  });

  it('passes when the count equals it', () => {
    const fx = clean();
    quarantine(fx, { suites: [], minSuites: 1, minTests: 1, maxRefusedConnections: 1 });
    writeRefusals(fx, [refusal()]);
    const row = g8(run(fx));
    expect(row.verdict).toBe('PASS');
    expect(row.detail).toMatch(/1 refused connection\(s\) vs ceiling 1 \(margin 0\)/);
  });

  it('is report-only when absent, which is how the number is bootstrapped', () => {
    const fx = clean();
    quarantine(fx, { suites: [], minSuites: 1, minTests: 1 });
    writeRefusals(fx, [refusal()]);
    const row = g8(run(fx));
    expect(row.verdict).toBe('PASS');
    expect(row.detail).toMatch(/REPORT ONLY/);
  });

  // SA CR-N5: a string or a float is not absent. Read as "not pinned yet" it
  // would leave G8 permanently report-only while the summary line still
  // printed a ceiling.
  it('fails on a string-typed ceiling rather than treating it as unpinned', () => {
    const fx = clean();
    quarantine(fx, { suites: [], minSuites: 1, minTests: 1, maxRefusedConnections: '0' });
    writeRefusals(fx, [refusal()]);
    expectFail(run(fx), /present but not a whole number \("0"\)/);
  });

  it('fails on a fractional ceiling', () => {
    const fx = clean();
    quarantine(fx, { suites: [], minSuites: 1, minTests: 1, maxRefusedConnections: 0.5 });
    expectFail(run(fx), /present but not a whole number \(0\.5\)/);
  });
});
