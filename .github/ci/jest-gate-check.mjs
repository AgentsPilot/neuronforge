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
  }

  // ── report ────────────────────────────────────────────────────────────────
  const allOk = checks.every((c) => c.ok);
  for (const c of checks) {
    const line = `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`;
    if (c.ok) console.log(line);
    else console.error(line);
  }
  console.log(allOk ? 'jest-gate-check: passed' : 'jest-gate-check: FAILED');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [];
    md.push(`### Jest gate: ${allOk ? 'passed' : 'FAILED'}`, '');
    if (!args.listOnly) {
      md.push('| | Total | Passed | Failed | Skipped |', '|---|---|---|---|---|');
      md.push(`| Suites | ${fmt(totals.suites)} | ${fmt(totals.suites - totals.failedSuites - totals.pendingSuites)} | ${fmt(totals.failedSuites)} | ${fmt(totals.pendingSuites)} |`);
      md.push(`| Tests | ${fmt(totals.tests)} | ${fmt(totals.passed)} | ${fmt(totals.failed)} | ${fmt(totals.pending + totals.todo)} |`, '');
    }
    md.push(`Quarantine: **${quarantined.size}** suites (\`${QUARANTINE_FILE}\`), removals only. Floors: ${fmt(quarantine.minSuites)} suites, ${fmt(quarantine.minTests)} tests.`, '');
    md.push('| Check | Result | Detail |', '|---|---|---|');
    for (const c of checks) md.push(`| ${c.id} | ${c.ok ? 'pass' : '**FAIL**'} | ${c.detail.split('\n').join('<br>')} |`);
    if (failing.length) md.push('', '**Failing suites:**', ...failing.map((f) => `- \`${f}\``));
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
