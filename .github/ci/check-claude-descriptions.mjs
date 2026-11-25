#!/usr/bin/env node
// check-claude-descriptions.mjs: fails when a skill or agent description is too
// long for the Claude Code listing.
//
// Claude Code shows each skill (.claude/skills/*/SKILL.md) and subagent
// (.claude/agents/*.md) to the model by its frontmatter `description:` (joined
// with `when_to_use:` when a file has one), and cuts a long one off. Every
// trigger after the cut is hidden. One skill grew to about 2,373 chars and the
// listing stopped at about char 1,525. This check keeps every description at
// or under DESCRIPTION_LIMIT.
//
// What is measured: the value after YAML parsing (a `|` or `>` block loses its
// indentation), with whitespace runs collapsed to one space and the ends
// trimmed, counted in characters (code points), not bytes.
//
// The reader is deliberately small and FAILS CLOSED: a missing frontmatter, a
// missing or empty description, or any shape it does not fully understand (a
// multi-line plain or quoted scalar, an indentation indicator, ` #` or `: `
// inside a plain scalar, a double-quoted value containing a backslash) is a
// failure, never a skip.
//
// It lives in .github/ci/ so a change to it is never skippable (see
// non-deploying-change.sh). Node built-ins only, so CI needs no install.
//
// Usage (run from the repository root):
//   node .github/ci/check-claude-descriptions.mjs              every skill and agent file
//   node .github/ci/check-claude-descriptions.mjs FILE...      only these files
//   node .github/ci/check-claude-descriptions.mjs --self-test  prove it can fail
//
// Exit 0 only if every file passed. The default run also fails if it finds no
// files at all: a guard that reads nothing must be red.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// One limit, no allow-list. It is the description cap of the Agent Skills
// format and leaves about a third of headroom under the observed listing cut.
const DESCRIPTION_LIMIT = 1024;

// Keys the listing shows, measured together in this order.
const MEASURED_KEYS = ['description', 'when_to_use'];

class ParseError extends Error {}

const toDisplayPath = (p) => path.relative(process.cwd(), path.resolve(p)).split(path.sep).join('/');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const charCount = (s) => [...s].length;

// Default file set. Neither listing recurses: skills are exactly one directory
// deep and agents sit directly in agents/, so .claude/worktrees/** and the
// fixtures under .github/ci/ are never read.
function defaultFiles() {
  const files = [];
  const skillsDir = path.join('.claude', 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(file)) files.push(file);
    }
  }
  const agentsDir = path.join('.claude', 'agents');
  if (existsSync(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(agentsDir, entry.name));
    }
  }
  return files.sort();
}

// Returns the frontmatter lines (between the opening and closing `---`).
function frontmatterLines(text) {
  // Normalise CRLF first: a Windows checkout is CRLF while the index and CI are
  // LF, and an un-normalised `---\r` or `|\r` would read differently locally.
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') throw new ParseError('file does not start with a --- frontmatter line');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new ParseError('frontmatter has no closing --- line');
  return lines.slice(1, end);
}

const isIndented = (line) => /^[ \t]/.test(line);
const isBlank = (line) => line.trim() === '';

// Reads one measured key's value. `first` is the text after `key:`, `rest` the
// lines that follow it up to (not including) the next column-0 line.
function readValue(key, first, rest) {
  const continuation = rest.filter((l) => !isBlank(l));

  // Block scalar: `|` or `>`, optional `-`/`+` chomping, nothing else.
  if (first.startsWith('|') || first.startsWith('>')) {
    if (/^[|>][+-]?[0-9]/.test(first)) {
      throw new ParseError(`${key} uses a block indentation indicator, which this reader does not support`);
    }
    if (!/^[|>][+-]?$/.test(first)) {
      throw new ParseError(`${key} block header "${first}" is not one of | |- |+ > >- >+`);
    }
    if (continuation.length === 0) throw new ParseError(`${key} block is empty`);
    if (rest.some((l) => /^\t/.test(l))) throw new ParseError(`${key} block is indented with a tab`);
    // For a measurement that collapses whitespace, | and > read the same: the
    // indentation and the line breaks both become single spaces.
    return collapse(rest.join(' '));
  }

  // Every other form is one line. An indented line after it is a multi-line
  // scalar, which this reader does not support.
  if (continuation.length > 0) {
    throw new ParseError(`${key} continues onto the next line (multi-line scalar), which this reader does not support`);
  }
  if (first === '') throw new ParseError(`${key} is empty`);

  if (first.startsWith("'")) {
    if (first.length < 2 || !first.endsWith("'")) {
      throw new ParseError(`${key} single-quoted value does not close on the same line`);
    }
    const inner = first.slice(1, -1);
    // Inside single quotes a quote is written twice; a lone one ends the scalar.
    if (/'/.test(inner.replace(/''/g, ''))) {
      throw new ParseError(`${key} single-quoted value has text after its closing quote`);
    }
    return collapse(inner.replace(/''/g, "'"));
  }

  if (first.startsWith('"')) {
    if (first.includes('\\')) {
      throw new ParseError(`${key} double-quoted value contains a backslash escape, which this reader does not unescape`);
    }
    if (first.length < 2 || !first.endsWith('"')) {
      throw new ParseError(`${key} double-quoted value does not close on the same line`);
    }
    const inner = first.slice(1, -1);
    if (inner.includes('"')) throw new ParseError(`${key} double-quoted value has text after its closing quote`);
    return collapse(inner);
  }

  // Plain scalar. A value counts as quoted only when its FIRST character is a
  // quote, so quotes mid-value are ordinary text here.
  if (/^[[\]{}&*!%@`?#,]|^-( |$)/.test(first)) {
    throw new ParseError(`${key} starts with a YAML indicator character, which this reader does not support`);
  }
  // A tab before `#` also starts a comment in YAML. It is left unhandled on
  // purpose: the comment text is then counted, which over-counts (the safe side).
  if (first.includes(' #')) throw new ParseError(`${key} plain value contains " #" (a YAML comment)`);
  if (first.includes(': ') || first.endsWith(':')) {
    throw new ParseError(`${key} plain value contains ": " (invalid in a plain YAML scalar; quote it or use a block)`);
  }
  return collapse(first);
}

// Returns { length, keys } for one file, or throws ParseError.
function measure(text) {
  const lines = frontmatterLines(text);
  const found = new Map();

  // True while the lines since the last key may be its column-0 sequence items:
  // the key had an empty value, and only `- ` items have followed it.
  let sequenceAllowed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only a column-0 line starts a key. Indented and blank lines belong to the
    // key above; a `: ` inside a block scalar therefore never starts a new key.
    if (isBlank(line) || isIndented(line)) continue;
    // A column-0 comment would end a block scalar early, so the indented text
    // after it would go unmeasured (an under-count). Fail closed instead.
    if (line.startsWith('#')) throw new ParseError(`frontmatter line ${i + 2} is a column-0 comment, which this reader does not support`);
    // A column-0 sequence item is valid only under a key with an empty value
    // (`tools:` then `- Read`). Anywhere else it is invalid YAML.
    if (/^- |^-$/.test(line)) {
      if (!sequenceAllowed) throw new ParseError(`frontmatter line ${i + 2} is a sequence item that does not follow a key with an empty value`);
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(line);
    if (!match) throw new ParseError(`frontmatter line ${i + 2} is not a "key: value" line`);
    const key = match[1];
    sequenceAllowed = (match[2] ?? '').trim() === '';
    if (!MEASURED_KEYS.includes(key)) continue;
    if (found.has(key)) throw new ParseError(`${key} appears more than once`);

    // The value runs until the first non-empty column-0 line.
    let j = i + 1;
    while (j < lines.length && (isBlank(lines[j]) || isIndented(lines[j]))) j++;
    found.set(key, readValue(key, (match[2] ?? '').trim(), lines.slice(i + 1, j)));
  }

  if (!found.has('description')) throw new ParseError('no description key');
  if (found.get('description') === '') throw new ParseError('description is empty');
  const joined = MEASURED_KEYS.filter((k) => found.has(k)).map((k) => found.get(k)).join(' ');
  return { length: charCount(joined), hasWhenToUse: found.has('when_to_use') };
}

// Checks the given files. Prints every failure line, and on success one line per
// file sorted by length. Returns the exit code.
function check(files) {
  if (files.length === 0) {
    console.error(
      `check-claude-descriptions: found 0 files under .claude/skills/*/SKILL.md and .claude/agents/*.md. ` +
        `Run it from the repository root; a guard that reads nothing is a failure.`,
    );
    return 1;
  }

  const results = [];
  const failures = [];
  for (const file of files) {
    const shown = toDisplayPath(file);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      failures.push(`${shown}: could not read frontmatter description (cannot read file: ${err.code ?? err.message})`);
      continue;
    }
    try {
      const { length, hasWhenToUse } = measure(text);
      results.push({ shown, length });
      if (length > DESCRIPTION_LIMIT) {
        failures.push(
          `${shown}: description is ${length} chars (limit ${DESCRIPTION_LIMIT}${hasWhenToUse ? '; when_to_use counted with it' : ''}). ` +
            `Trim the description: long descriptions are cut off in the skill/agent listing, hiding later triggers.`,
        );
      }
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      failures.push(`${shown}: could not read frontmatter description (${err.message})`);
    }
  }

  if (failures.length > 0) {
    for (const line of failures) console.error(line);
    console.error(`check-claude-descriptions: ${failures.length} of ${files.length} file(s) failed.`);
    return 1;
  }

  results.sort((a, b) => b.length - a.length || a.shown.localeCompare(b.shown));
  console.log(`check-claude-descriptions: checked ${files.length} file(s), limit ${DESCRIPTION_LIMIT} chars.`);
  for (const { shown, length } of results) console.log(`  ${String(length).padStart(5)}  ${shown}`);
  console.log(`Longest: ${results[0].shown} at ${results[0].length} chars.`);
  return 0;
}

// --self-test: runs the checker on each committed fixture IN ITS OWN PROCESS
// and requires both the exit code and that fixture's own output line. Exit code
// alone proves nothing: a checker that crashes also exits 1. Spawning the real
// CLI (rather than calling check() in-process) means an edit that makes the
// command line pass everything turns a fixture red. An edit that forces the
// whole script to exit 0 would force this mode to exit 0 too, so the workflow
// step also requires the success line printed at the end of selfTest().
const FIXTURE_EXPECTATIONS = {
  // Both over-limit fixtures parse to exactly 1100 chars.
  'plain-over-limit.md': { code: 1, line: (p) => `${p}: description is 1100 chars` },
  'folded-over-limit.md': { code: 1, line: (p) => `${p}: description is 1100 chars` },
  // Raw block text is over the limit; the parsed value is exactly 900 chars.
  'literal-near-miss.md': { code: 0, line: (p) => `Longest: ${p} at 900 chars.` },
  'no-description.md': { code: 1, line: (p) => `${p}: could not read frontmatter description (no description key)` },
};

function selfTest() {
  const script = process.argv[1];
  const fixtureDir = path.join(path.dirname(script), 'fixtures', 'claude-descriptions');
  const onDisk = existsSync(fixtureDir) ? readdirSync(fixtureDir).filter((f) => f.endsWith('.md')).sort() : [];
  const expected = Object.keys(FIXTURE_EXPECTATIONS).sort();
  const problems = [];

  // The fixture set and the expectations must match exactly, so a fixture can
  // neither go missing nor be added without saying what it must do.
  for (const name of expected) if (!onDisk.includes(name)) problems.push(`fixture ${name} is missing from ${toDisplayPath(fixtureDir)}`);
  for (const name of onDisk) if (!expected.includes(name)) problems.push(`fixture ${name} has no expectation in FIXTURE_EXPECTATIONS`);

  for (const name of expected.filter((n) => onDisk.includes(n))) {
    const fixture = path.join(fixtureDir, name);
    const shown = toDisplayPath(fixture);
    const { code, line } = FIXTURE_EXPECTATIONS[name];
    const run = spawnSync(process.execPath, [script, fixture], { encoding: 'utf8' });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const wantLine = line(shown);
    const lineOk = output.split('\n').some((l) => l.startsWith(wantLine));
    const ok = run.status === code && lineOk;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${shown}: exit ${run.status} (want ${code}), output line [${wantLine}] ${lineOk ? 'present' : 'MISSING'}`);
    for (const l of output.trimEnd().split('\n')) console.log(`        | ${l}`);
    if (!ok) problems.push(`${shown} did not behave as expected`);
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`self-test: ${p}`);
    console.error('check-claude-descriptions --self-test: FAILED. The checker cannot be trusted to fail.');
    return 1;
  }
  console.log(`check-claude-descriptions --self-test: all ${expected.length} fixtures behaved as expected.`);
  return 0;
}

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  process.exitCode = selfTest();
} else if (args.some((a) => a.startsWith('--'))) {
  console.error(`check-claude-descriptions: unknown option ${args.find((a) => a.startsWith('--'))}`);
  process.exitCode = 1;
} else if (args.length > 0) {
  process.exitCode = check(args);
} else {
  process.exitCode = check(defaultFiles());
}
