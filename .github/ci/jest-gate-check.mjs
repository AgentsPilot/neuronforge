#!/usr/bin/env node
// jest-gate-check.mjs: proves the Jest PR gate ran everything it should have.
//
// A green Jest run proves only that the suites that RAN passed. It cannot see a
// typo'd ignore pattern, a narrowed testMatch, a shard that never uploaded, or a
// suite that crashed out of the count. This script checks those, from the
// listings and the --json results, with no dependencies beyond Node itself.
//
//   G1  partition: full list = gate list + quarantine + integration dir, no overlap
//   G2  every quarantine entry exists on disk and has a reason
//   G3  ratchet: the quarantine only shrinks against the base commit
//   G4  no listed path is under .claude/ (agent worktrees)
//   G5  executed = listed: the result files cover exactly the gate list, once,
//       with no runtime-error suite and no failure
//   G6  no gate suite is wholly skipped
//   G7  floors: gate suites >= minSuites and gate tests >= minTests
//   G8  refused network connections <= maxRefusedConnections, which may only
//       ratchet DOWN; fail closed on missing or untrustworthy evidence
//
// It lives in .github/ so a change to it is never skippable (see
// non-deploying-change.sh). Usage (CI and local are the same):
//
//   npx jest --listTests > full.txt
//   npx jest -c jest.gate.config.js --listTests > gate.txt
//   node .github/ci/jest-gate-check.mjs --full-list full.txt --gate-list gate.txt \
//        [--results-dir DIR] [--base REF] [--list-only] [--quarantine FILE]
//
// --results-dir holds gate-results-<n>-of-<N>.json, one per shard. The shard
// count is read from those names, so the workflow's matrix is the only place N
// is written; every index 1..N must be present (fail closed on missing evidence).
// --base defaults to HEAD^1: the base tip on a pull_request merge ref, and the
// previous main tip on a merge landing on main. --quarantine exists so the
// red paths can be proved against a scratch copy; CI never passes it.
//
// Exit 0 only if every check passed. With GITHUB_STEP_SUMMARY set, a summary
// table is appended to it.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const QUARANTINE_FILE = '.github/ci/jest-quarantine.json';
const INTEGRATION_DIR = 'tests/plugins/integration-tests/';
const RESULT_NAME = /^gate-results-(\d+)-of-(\d+)\.json$/;
// Written by tests/jest-no-network.ts (records) and the shard job (marker).
const REFUSALS_DIR = 'no-network';
const REFUSALS_NAME = /^refusals-w\d+-\d+\.jsonl$/;
// One per worker, written by the guard at install time. Its ABSENCE is the
// signal: see G8 and tests/jest-no-network.ts `announceRecording`.
const ALIVE_NAME = /^alive-w\d+-\d+\.json$/;
const MARKER_NAME = 'present.json';

// ── arguments ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { base: 'HEAD^1', listOnly: false, root: process.cwd(), quarantine: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--full-list') args.fullList = value();
    else if (flag === '--gate-list') args.gateList = value();
    else if (flag === '--results-dir') args.resultsDir = value();
    else if (flag === '--base') args.base = value();
    else if (flag === '--root') args.root = path.resolve(value());
    else if (flag === '--list-only') args.listOnly = true;
    else if (flag === '--quarantine') args.quarantine = path.resolve(value());
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.fullList || !args.gateList) throw new Error('--full-list and --gate-list are required');
  if (!args.listOnly && !args.resultsDir) throw new Error('--results-dir is required unless --list-only');
  return args;
}

// ── helpers ─────────────────────────────────────────────────────────────────
const checks = [];
function record(id, ok, detail) {
  checks.push({ id, ok, detail });
}

/** Repo-relative, forward slashes. A path outside the root is an error, not a skip. */
function toRel(root, p) {
  const rel = path.relative(root, p).split(path.sep).join('/');
  if (rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`path outside the repo root: ${p}`);
  return rel;
}

/** One absolute path per line, as `jest --listTests` prints. Anything else is reported. */
function readList(root, file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const looksLikePath = (l) => l.startsWith('/') || /^[A-Za-z]:[\\/]/.test(l);
  const paths = lines.filter(looksLikePath).map((l) => toRel(root, l));
  const other = lines.filter((l) => !looksLikePath(l));
  const set = new Set(paths);
  if (set.size !== paths.length) throw new Error(`${file} lists a path twice`);
  if (paths.length === 0) throw new Error(`${file} lists no tests`);
  return { set, other };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * G8: how many network connections the gate refused, against a ceiling.
 *
 * WHY A COUNT AND NOT A FAILED TEST. `tests/jest-no-network.ts` installs once
 * per worker, so a socket opened by a promise an earlier file left floating is
 * charged to whichever file is running when it opens. An earlier attempt to
 * fail the running case did exactly that to an innocent suite, and a failure
 * pointing at the wrong file is the original sin of this bug class. So this
 * accuses no test: it reads one number, and the attribution below only informs.
 *
 * FAIL CLOSED, because every way this check can be wrong makes it PASS:
 *   - a shard whose marker is missing recorded nothing, and nothing reads as
 *     zero refusals, which would ratchet the ceiling down on a lie;
 *   - the marker only proves the WORKFLOW meant to record. The guard says for
 *     itself that it ran, once per worker (`alive-*`), and a shard with none of
 *     those did not record whatever its marker claims — one renamed env var,
 *     one `setupFiles` edit or one unwritable directory is enough, and the
 *     guard swallows a failed write by design;
 *   - ALLOW_TEST_NETWORK=1 makes the guard return early and record nothing,
 *     which is the one way to defeat this silently — hence the marker carries
 *     it, and a marker that does not say `false` is not good enough;
 *   - a ceiling that is present but not a whole number would read as "not
 *     pinned yet" and pass forever, since G3's ratchet also ignores it;
 *   - a record file whose name is unrecognised would be skipped in silence;
 *   - a worker that hit its record cap reports `truncated`, and a count known
 *     to be incomplete must never read as a pass.
 *
 * REPORT-ONLY WHEN THE CEILING IS ABSENT. That is permanent behaviour, not
 * scaffolding: it is how the number is bootstrapped from a real CI run (the
 * count cannot be measured honestly on a developer machine), and it keeps that
 * path exercised. G3's own bootstrap branch works the same way.
 */
function checkRefusals(args, quarantine, shardCount) {
  const dir = path.join(args.resultsDir, REFUSALS_DIR);
  const problems = [];
  const records = [];
  let truncated = false;

  if (shardCount < 1) {
    record('G8 refused connections', false, 'the shard count could not be derived, so the evidence cannot be proved complete (see G5)');
    return null;
  }

  for (let i = 1; i <= shardCount; i++) {
    const shardDir = path.join(dir, `shard-${i}`);
    const marker = path.join(shardDir, MARKER_NAME);
    if (!existsSync(marker)) {
      problems.push(`shard ${i} wrote no marker (${REFUSALS_DIR}/shard-${i}/${MARKER_NAME}): it was not recording, so its refusals are unknown`);
      continue;
    }
    let present;
    try {
      present = JSON.parse(readFileSync(marker, 'utf8'));
    } catch (err) {
      problems.push(`shard ${i}'s marker is not valid JSON: ${err.message}`);
      continue;
    }
    /*
     * `!== false`, not `=== true`. The field is the one assertion that keeps
     * the guard from being switched off silently, so anything other than an
     * explicit `false` — a missing key, a quoted "true", a `printf` edit —
     * must be a problem rather than a pass.
     */
    if (present.allowTestNetwork !== false) {
      problems.push(
        `shard ${i}'s marker does not state allowTestNetwork: false (got ${JSON.stringify(present.allowTestNetwork)}). ` +
        'ALLOW_TEST_NETWORK=1 disables the guard entirely: it is for diagnosing a live service by hand, never for CI. ' +
        'A marker that cannot confirm it was off is treated as if it was on.'
      );
    }

    const files = readdirSync(shardDir);

    /* The guard's own proof that it ran. Nothing else can give it. */
    if (!files.some((f) => ALIVE_NAME.test(f))) {
      problems.push(
        `shard ${i} has a marker but no alive-* file, so tests/jest-no-network.ts never recorded: ` +
        'its refusals are unknown, and zero records here does NOT mean zero leaks. ' +
        'Check NO_NETWORK_RECORD_DIR reaches the test process and that the directory is writable.'
      );
    }

    /* Anything unaccounted for, rather than quietly skipped. */
    const unexpected = files.filter(
      (f) => f !== MARKER_NAME && !ALIVE_NAME.test(f) && !REFUSALS_NAME.test(f)
    );
    if (unexpected.length) {
      problems.push(`shard ${i} holds file(s) this check does not recognise, so they were not counted: ${unexpected.slice(0, 5).join(', ')}`);
    }

    for (const f of files.filter((f) => REFUSALS_NAME.test(f))) {
      for (const line of readFileSync(path.join(shardDir, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r;
        try {
          r = JSON.parse(line);
        } catch {
          problems.push(`${REFUSALS_DIR}/shard-${i}/${f} holds a line that is not valid JSON`);
          continue;
        }
        if (r.truncated) truncated = true;
        else records.push(r);
      }
    }
  }

  if (truncated) {
    problems.push('a worker hit its record cap, so the true count is higher than the one below and cannot be compared to a ceiling');
  }

  const total = records.length;
  const ceiling = quarantine.maxRefusedConnections;
  /*
   * ABSENT, specifically — not merely unusable. G2 fails a ceiling that is
   * present and not a whole number, so this must not describe one as "no
   * ceiling pinned yet" and pass; `in` keeps the two apart.
   */
  const pinned = 'maxRefusedConnections' in quarantine;
  const bootstrap = !pinned;
  if (pinned && !Number.isInteger(ceiling)) {
    problems.push(`maxRefusedConnections is present but not a whole number (${JSON.stringify(ceiling)}), so nothing can be compared against it — see G2`);
  }

  if (Number.isInteger(ceiling) && total > ceiling) {
    problems.push(
      `${fmt(total)} refused connection(s), ceiling ${fmt(ceiling)}. A unit test must not reach the network: ` +
      "stub the seam the call goes through — for Supabase, jest.mock('@/lib/supabaseServer', ...). " +
      'The diagnostics below name the transport and, unreliably, a file.'
    );
  }

  const detail = problems.length
    ? problems.join('\n')
    : bootstrap
      ? `${fmt(total)} refused connection(s) across ${shardCount} shard(s). REPORT ONLY: ${QUARANTINE_FILE} has no "maxRefusedConnections", so there is nothing to compare against yet. Pin it from this number to start gating.`
      : `${fmt(total)} refused connection(s) vs ceiling ${fmt(ceiling)} (margin ${fmt(ceiling - total)}), across ${shardCount} shard(s)`;

  record('G8 refused connections', problems.length === 0, detail);
  return { total, ceiling: bootstrap ? null : ceiling, records };
}

/**
 * The leads to follow when G8 moves, printed whether or not it failed.
 *
 * A ceiling with nothing to chase is a wall, not a tool. Two kinds of lead,
 * and the difference between them matters:
 *
 *   - THE TRANSPORT is ground truth. It is the repo frames of the stack that
 *     actually opened the socket, so it says WHICH client leaked (Supabase,
 *     an LLM provider) whoever owns the call. It stops at the transport —
 *     the socket opens on an undici continuation, so the calling service is
 *     not in the stack — which is why it is aggregated rather than listed.
 *   - THE FILE is a guess, for the reason G8 above explains, and is labelled
 *     as one. It is a starting point for the triage command, never a verdict.
 */
function refusalDiagnostics(refusals) {
  if (!refusals || refusals.total === 0) return [];

  const tally = (key) => {
    const counts = new Map();
    for (const r of refusals.records) {
      const k = key(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  };

  const lines = ['', `Refused connections (${fmt(refusals.total)}), by destination:`];
  for (const [k, c] of tally((r) => r.destination ?? '?')) lines.push(`  ${fmt(c)} x ${k}`);

  lines.push('', 'By the code path that opened the socket (ground truth — the transport, not the caller):');
  for (const [k, c] of tally((r) => (r.transport ?? []).join(' <- ') || 'no repo frame')) {
    lines.push(`  ${fmt(c)} x ${k}`);
  }

  lines.push(
    '',
    'By the file that was RUNNING at the time — THIS MAY BE THE WRONG FILE.',
    'The guard installs once per worker, so a socket opened by a promise an',
    'earlier file left floating is charged to whichever file is running when it',
    'opens. Do not read these as the offender, and do not paste one into a bug',
    'title. To settle it, run the suite ALONE, which leaves nothing to inherit:',
    '',
    '    npm run test:leaks -- <path>',
    ''
  );
  for (const [k, c] of tally((r) => r.possiblyNotTheOriginFile ?? '?')) lines.push(`  ${fmt(c)} x ${k}`);

  return lines;
}

// ── checks ──────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;

  const quarantine = JSON.parse(readFileSync(args.quarantine ?? path.join(root, QUARANTINE_FILE), 'utf8'));
  const entries = Array.isArray(quarantine.suites) ? quarantine.suites : [];
  const quarantined = new Set(entries.map((e) => e.path));
  const full = readList(root, args.fullList);
  const gate = readList(root, args.gateList);
  const integration = new Set([...full.set].filter((p) => p.startsWith(INTEGRATION_DIR)));

  // G1 partition, computed rather than pinned.
  {
    const problems = [];
    for (const p of gate.set) {
      if (!full.set.has(p)) problems.push(`gate lists a suite the full run does not: ${p}`);
      if (quarantined.has(p)) problems.push(`quarantined suite is in the gate: ${p}`);
      if (p.startsWith(INTEGRATION_DIR)) problems.push(`integration suite is in the gate: ${p}`);
    }
    for (const p of quarantined) {
      if (!full.set.has(p)) problems.push(`quarantined suite is not collected by jest.config.js: ${p}`);
      if (p.startsWith(INTEGRATION_DIR)) problems.push(`quarantine names an integration suite: ${p}`);
    }
    for (const p of full.set) {
      if (!gate.set.has(p) && !quarantined.has(p) && !integration.has(p)) {
        problems.push(`suite dropped from the gate without a quarantine entry: ${p}`);
      }
    }
    const sum = gate.set.size + quarantined.size + integration.size;
    if (sum !== full.set.size) problems.push(`${full.set.size} != ${gate.set.size} + ${quarantined.size} + ${integration.size}`);
    if (full.other.length || gate.other.length) {
      problems.push(`unexpected non-path lines in a listing: ${[...full.other, ...gate.other].slice(0, 3).join(' | ')}`);
    }
    record('G1 partition', problems.length === 0,
      problems.length ? problems.join('\n') : `${full.set.size} = ${gate.set.size} gate + ${quarantined.size} quarantined + ${integration.size} integration`);
  }

  // G2 every entry is real and explained.
  {
    const problems = [];
    if (quarantined.size !== entries.length) problems.push('the quarantine lists a path twice');
    for (const e of entries) {
      if (typeof e.path !== 'string' || !e.path) problems.push('an entry has no path');
      else if (!existsSync(path.join(root, e.path))) problems.push(`not on disk: ${e.path}`);
      if (typeof e.reason !== 'string' || !e.reason.trim()) problems.push(`no reason: ${e.path}`);
    }
    for (const key of ['minSuites', 'minTests']) {
      if (!Number.isInteger(quarantine[key]) || quarantine[key] <= 0) problems.push(`${key} must be a positive integer`);
    }
    /*
     * The refusal ceiling is OPTIONAL — absent means "not pinned yet", and G8
     * is then report-only. So it has to be validated when present, or a string,
     * a float or a null would read as absent and leave G8 permanently
     * report-only while appearing to gate. G3's ratchet ignores a non-integer
     * too, so nothing downstream would ever object.
     */
    if ('maxRefusedConnections' in quarantine) {
      const ceiling = quarantine.maxRefusedConnections;
      if (!Number.isInteger(ceiling) || ceiling < 0) {
        problems.push(`maxRefusedConnections must be a non-negative integer when present (got ${JSON.stringify(ceiling)}); remove the key to leave G8 report-only`);
      }
    }
    record('G2 quarantine entries', problems.length === 0, problems.length ? problems.join('\n') : `${entries.length} entries, each on disk with a reason`);
  }

  // G3 ratchet. The base must resolve; a missing FILE at base is the one-time bootstrap.
  {
    let ok = false;
    let detail;
    try {
      git(['cat-file', '-e', `${args.base}^{commit}`]);
      let baseText = null;
      try {
        baseText = git(['show', `${args.base}:${QUARANTINE_FILE}`]);
      } catch {
        baseText = null;
      }
      if (baseText === null) {
        ok = true;
        detail = `bootstrap: ${QUARANTINE_FILE} does not exist at ${args.base}, so there is nothing to ratchet against yet`;
      } else {
        const base = JSON.parse(baseText);
        const basePaths = new Set((base.suites ?? []).map((e) => e.path));
        const added = [...quarantined].filter((p) => !basePaths.has(p));
        ok = added.length === 0;
        detail = ok
          ? `${quarantined.size} entries, a subset of the base's ${basePaths.size}`
          : `entries added since ${args.base} (removals only; an addition needs SA review):\n${added.join('\n')}`;
        if (ok) {
          const lowered = ['minSuites', 'minTests'].filter((k) => Number(quarantine[k]) < Number(base[k]));
          if (lowered.length) detail += `\nNote: ${lowered.join(', ')} lowered against the base; that needs SA sign-off in review.`;
        }

        /*
         * The refusal ceiling ratchets the OTHER WAY from the floors above:
         * minSuites/minTests may only rise, maxRefusedConnections may only
         * fall. And a raise is a hard FAIL here rather than a note, because
         * editing the number up is precisely how a new leak would get waved
         * through — which is the "nothing goes red" problem this check exists
         * to end. Removing it entirely is the largest possible raise, so that
         * fails too; introducing it where the base had none is a tightening.
         */
        const headCeiling = quarantine.maxRefusedConnections;
        const baseCeiling = base.maxRefusedConnections;
        if (Number.isInteger(baseCeiling)) {
          if (!Number.isInteger(headCeiling)) {
            ok = false;
            detail += `\nmaxRefusedConnections was removed (base: ${baseCeiling}). It may only ratchet DOWN; removing it un-gates the check.`;
          } else if (headCeiling > baseCeiling) {
            ok = false;
            detail += `\nmaxRefusedConnections raised ${baseCeiling} -> ${headCeiling}. It may only ratchet DOWN. Stub the leaking seam instead; a genuinely unavoidable raise takes the same route as a quarantine addition (SA review, visible override).`;
          } else if (headCeiling < baseCeiling) {
            detail += `\nmaxRefusedConnections ratcheted ${baseCeiling} -> ${headCeiling}.`;
          }
        } else if (Number.isInteger(headCeiling)) {
          detail += `\nmaxRefusedConnections pinned at ${headCeiling} (the base had none).`;
        }
      }
    } catch (err) {
      ok = false;
      detail = `cannot resolve base ${args.base} (fail closed): ${String(err.message ?? err).split('\n')[0]}`;
    }
    record('G3 ratchet', ok, detail);
  }

  // G4 nothing from an agent worktree.
  {
    const leaked = [...full.set, ...gate.set].filter((p) => p.startsWith('.claude/') || p.includes('/.claude/'));
    record('G4 no .claude paths', leaked.length === 0, leaked.length ? leaked.slice(0, 5).join('\n') : '0');
  }

  const totals = { suites: 0, failedSuites: 0, runtimeErrors: 0, pendingSuites: 0, tests: 0, passed: 0, failed: 0, pending: 0, todo: 0 };
  const failing = [];
  // Derived in G5 from the result filenames, reused by G8 so the shard count is
  // still written in exactly one place (the workflow matrix).
  let shardCount = 0;
  let refusals = null;

  if (!args.listOnly) {
    // G5 executed = listed, from N shard files, all present.
    const problems = [];
    let files = [];
    if (!existsSync(args.resultsDir)) problems.push(`no results directory: ${args.resultsDir}`);
    else files = readdirSync(args.resultsDir).filter((f) => RESULT_NAME.test(f));
    const totalsN = new Set(files.map((f) => Number(RESULT_NAME.exec(f)[2])));
    if (files.length === 0) problems.push('no result files: a shard did not run or did not upload');
    if (totalsN.size > 1) problems.push(`result files disagree on the shard count: ${[...totalsN].join(', ')}`);
    const n = totalsN.size === 1 ? [...totalsN][0] : 0;
    shardCount = n;
    for (let i = 1; i <= n; i++) {
      if (!files.includes(`gate-results-${i}-of-${n}.json`)) problems.push(`missing result file for shard ${i}/${n}`);
    }
    const executed = new Map();
    for (const f of files) {
      let r;
      try {
        r = JSON.parse(readFileSync(path.join(args.resultsDir, f), 'utf8'));
      } catch (err) {
        problems.push(`${f} is not valid JSON: ${err.message}`);
        continue;
      }
      totals.suites += r.numTotalTestSuites ?? 0;
      totals.failedSuites += r.numFailedTestSuites ?? 0;
      totals.runtimeErrors += r.numRuntimeErrorTestSuites ?? 0;
      totals.pendingSuites += r.numPendingTestSuites ?? 0;
      totals.tests += r.numTotalTests ?? 0;
      totals.passed += r.numPassedTests ?? 0;
      totals.failed += r.numFailedTests ?? 0;
      totals.pending += r.numPendingTests ?? 0;
      totals.todo += r.numTodoTests ?? 0;
      for (const t of r.testResults ?? []) {
        const rel = toRel(root, t.name);
        if (executed.has(rel)) problems.push(`ran in two shards: ${rel}`);
        executed.set(rel, t.status);
        // Jest also reports 'pending' and 'focused' (every test skipped); only 'failed' fails.
        if (t.status === 'failed') failing.push(rel);
      }
    }
    const notRun = [...gate.set].filter((p) => !executed.has(p));
    const notListed = [...executed.keys()].filter((p) => !gate.set.has(p));
    if (notRun.length) problems.push(`listed but not executed (${notRun.length}):\n${notRun.slice(0, 10).join('\n')}`);
    if (notListed.length) problems.push(`executed but not in the gate list (${notListed.length}):\n${notListed.slice(0, 10).join('\n')}`);
    if (totals.suites !== gate.set.size) problems.push(`executed ${totals.suites} suites, the gate lists ${gate.set.size}`);
    if (totals.runtimeErrors !== 0) problems.push(`${totals.runtimeErrors} suite(s) failed to run (runtime error)`);
    if (totals.failedSuites !== 0 || totals.failed !== 0) problems.push(`${totals.failedSuites} failed suite(s), ${totals.failed} failed test(s)`);
    record('G5 executed = listed', problems.length === 0,
      problems.length ? problems.join('\n') : `${totals.suites} suites from ${files.length} shard file(s), 0 runtime errors, 0 failures`);

    // G6 no wholly skipped suite.
    record('G6 no skipped suite', totals.pendingSuites === 0, `${totals.pendingSuites} wholly skipped`);

    // G7 floors.
    const suitesOk = totals.suites >= quarantine.minSuites;
    const testsOk = totals.tests >= quarantine.minTests;
    record('G7 floors', suitesOk && testsOk,
      `suites ${fmt(totals.suites)} vs floor ${fmt(quarantine.minSuites)} (margin ${fmt(totals.suites - quarantine.minSuites)}); ` +
      `tests ${fmt(totals.tests)} vs floor ${fmt(quarantine.minTests)} (margin ${fmt(totals.tests - quarantine.minTests)})`);

    // G8 refused network connections: a ceiling that only ratchets down.
    refusals = checkRefusals(args, quarantine, shardCount);
  }

  // ── report ────────────────────────────────────────────────────────────────
  const allOk = checks.every((c) => c.ok);
  for (const c of checks) {
    const line = `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`;
    if (c.ok) console.log(line);
    else console.error(line);
  }
  // Leads for G8, printed whether or not it failed: a number that moved is
  // only useful with something to chase.
  const diagnostics = refusalDiagnostics(refusals);
  for (const line of diagnostics) console.log(line);

  console.log(allOk ? 'jest-gate-check: passed' : 'jest-gate-check: FAILED');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [];
    md.push(`### Jest gate: ${allOk ? 'passed' : 'FAILED'}`, '');
    if (!args.listOnly) {
      md.push('| | Total | Passed | Failed | Skipped |', '|---|---|---|---|---|');
      md.push(`| Suites | ${fmt(totals.suites)} | ${fmt(totals.suites - totals.failedSuites - totals.pendingSuites)} | ${fmt(totals.failedSuites)} | ${fmt(totals.pendingSuites)} |`);
      md.push(`| Tests | ${fmt(totals.tests)} | ${fmt(totals.passed)} | ${fmt(totals.failed)} | ${fmt(totals.pending + totals.todo)} |`, '');
    }
    md.push(
      `Quarantine: **${quarantined.size}** suites (\`${QUARANTINE_FILE}\`), removals only. ` +
      `Floors: ${fmt(quarantine.minSuites)} suites, ${fmt(quarantine.minTests)} tests. ` +
      `Refusal ceiling: ${Number.isInteger(quarantine.maxRefusedConnections) ? fmt(quarantine.maxRefusedConnections) : '_not pinned yet (report only)_'}.`,
      ''
    );
    md.push('| Check | Result | Detail |', '|---|---|---|');
    for (const c of checks) md.push(`| ${c.id} | ${c.ok ? 'pass' : '**FAIL**'} | ${c.detail.split('\n').join('<br>')} |`);
    if (failing.length) md.push('', '**Failing suites:**', ...failing.map((f) => `- \`${f}\``));
    if (diagnostics.length) md.push('', '<details><summary>Refused network connections</summary>', '', '```', ...diagnostics, '```', '', '</details>');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }

  process.exitCode = allOk ? 0 : 1;
}

try {
  main();
} catch (err) {
  // Any input this script cannot read is a failed gate, never a pass.
  console.error(`jest-gate-check: FAILED (${err.message ?? err})`);
  process.exitCode = 1;
}
