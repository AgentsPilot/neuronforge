/**
 * Text test for the PROD-2 schema parity checker (DV-1).
 *
 * Files under test:
 *   scripts/check-schema-parity.sql               the empty-diff checker
 *   supabase/baseline/prove-checker-can-fail.psql  one deliberate difference per section
 *   supabase/baseline/prove-checker-step.psql      the step the proof repeats
 *
 * There is no database here. The live proof is the psql run on production
 * (workplan section 7.4). What this test pins is the STRUCTURE that makes the
 * live proof meaningful and the paste safe:
 *
 *   - the checker opens read-only, holds no write keyword and creates nothing
 *   - the word "into" and the SECURITY DEFINER phrase appear nowhere (the SQL
 *     editor misparses the first, the SECURITY DEFINER guard tripwire scans
 *     every .sql file outside the migration folders for the second)
 *   - every section P00 to P26, G1 and I1 to I8 exists, in order, and the
 *     header states the row count the sections add up to
 *   - VERDICT sorts first
 *   - no privilege section prints a count (SA B-4)
 *   - ACLs are exploded with the right NULL handling for each catalog (SA B-6)
 *   - function bodies and comments are CR-stripped before hashing
 *   - the sections that can be legitimately empty carry an anchor (SA B-2)
 *   - the proof covers every section, never commits and names no object
 *
 * "The audits can fail" applies each break to the real text and expects the
 * matching complaint, so a vacuous audit goes red.
 *
 * Pure fs and string work: no network, milliseconds. Line endings are
 * normalised before any check, so a CRLF checkout cannot change a result; LF
 * on disk is pinned by the .gitattributes lines instead.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const CHECKER = 'scripts/check-schema-parity.sql';
const PROOF = 'supabase/baseline/prove-checker-can-fail.psql';
const STEP = 'supabase/baseline/prove-checker-step.psql';

const readRepoFile = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8').replace(/\r\n?/g, '\n');

const pad = (n: number) => String(n).padStart(2, '0');
const P_CODES = Array.from({ length: 27 }, (_, i) => `P${pad(i)}`);
const I_CODES = Array.from({ length: 8 }, (_, i) => `I${i + 1}`);
const SECTION_CODES = [...P_CODES, 'G1', ...I_CODES];
const ANCHORED = ['P05', 'P10', 'P15', 'P19', 'P21', 'P22', 'P23'];
/** The only steps where a platform refusal reads NOT RUN (SA code review 4). */
const MAY_REFUSE = ['D16', 'D17', 'D19', 'D20', 'D21', 'D22', 'D23', 'DG1'];
/** The only psql meta-commands either .psql file may use (SA code review 5). */
const ALLOWED_META = ['set', 'pset', 'o', 'ir', 'copy', 'gset'];
const P00_SETTINGS = [
  'search_path',
  'TimeZone',
  'DateStyle',
  'IntervalStyle',
  'extra_float_digits',
  'quote_all_identifiers',
  'standard_conforming_strings',
  'bytea_output',
  'server_encoding',
];

// ───────────────────────────────────────────────────────────────────────────
// A length-preserving SQL scrub
// ───────────────────────────────────────────────────────────────────────────

interface Scrubbed {
  /** Comments blanked; strings, identifiers and dollar bodies kept. */
  readonly code: string;
  /** Comments, string contents and dollar-body contents blanked. */
  readonly bare: string;
}

/** Blank comments (and optionally literal contents) without moving any offset. */
export function scrubSql(input: string): Scrubbed {
  const code = input.split('');
  const bare = input.split('');
  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  let i = 0;
  const n = input.length;
  while (i < n) {
    const two = input.slice(i, i + 2);
    if (two === '--') {
      let j = input.indexOf('\n', i);
      if (j === -1) j = n;
      blank(code, i, j);
      blank(bare, i, j);
      i = j;
    } else if (two === '/*') {
      let j = input.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(code, i, j);
      blank(bare, i, j);
      i = j;
    } else if (input[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (input[j] === "'" && input[j + 1] === "'") j += 2;
        else if (input[j] === "'") break;
        else j++;
      }
      blank(bare, i + 1, j);
      i = j + 1;
    } else if (input[i] === '"') {
      const j = input.indexOf('"', i + 1);
      i = j === -1 ? n : j + 1;
    } else if (input[i] === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(input.slice(i));
      if (!tag) {
        i++;
        continue;
      }
      const close = input.indexOf(tag[0], i + tag[0].length);
      const end = close === -1 ? n : close;
      blank(bare, i + tag[0].length, end);
      i = close === -1 ? n : close + tag[0].length;
    } else {
      i++;
    }
  }
  return { code: code.join(''), bare: bare.join('') };
}

/** Split on `-- [block NAME]` markers. Text before the first marker is `preamble`. */
function blocksOf(raw: string, view: string): Map<string, string> {
  const marks = [...raw.matchAll(/^[ \t]*-- \[block ([A-Za-z0-9_]+)\]/gm)];
  const blocks = new Map<string, string>();
  blocks.set('preamble', view.slice(0, marks[0]?.index ?? view.length));
  marks.forEach((mark, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].index : view.length;
    blocks.set(mark[1], view.slice(mark.index, end));
  });
  return blocks;
}

/** Index just past the parenthesis that closes the one opened at `open`. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '(') depth++;
    else if (s[k] === ')') {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

const isAscii = (s: string) => [...s].every((ch) => ch.charCodeAt(0) < 128);

/**
 * Catalog columns of type "char". `text || "char"` has no unique operator, so
 * PostgreSQL refuses the whole query at plan time (SQLSTATE 42725). DO-1b hit
 * this on staging at two sites that the text rules above could not see. A text
 * test cannot catch planner errors in general: this rule closes this one class
 * only, and DO-1b stays the gate.
 */
const CHAR_COLUMNS = [
  'relkind', 'relpersistence', 'relreplident', 'contype', 'confupdtype', 'confdeltype', 'confmatchtype',
  'prokind', 'provolatile', 'proparallel', 'polcmd', 'typtype', 'typcategory', 'typalign', 'typstorage',
  'typdelim', 'tgenabled', 'attidentity', 'attgenerated', 'attstorage', 'attalign', 'attcompression',
  'deptype', 'defaclobjtype', 'evtenabled', 'aggkind', 'ev_type', 'ev_enabled', 'amtype', 'castcontext',
  'castmethod', 'collprovider', 'datlocprovider',
];

/** Every "char" column joined with || without a ::text cast. Pass comment-free text. */
export function uncastCharConcats(code: string): string[] {
  const cols = CHAR_COLUMNS.join('|');
  const after = new RegExp(`\\|\\|\\s*\\(?\\s*\\w+\\.(${cols})\\b(?!\\s*::\\s*text)`, 'g');
  const before = new RegExp(`\\b\\w+\\.(${cols})\\b(?!\\s*::)\\s*\\|\\|`, 'g');
  return [...code.matchAll(after), ...code.matchAll(before)].map((m) => m[0].replace(/\s+/g, ' ').trim());
}

// ───────────────────────────────────────────────────────────────────────────
// The checker audit
// ───────────────────────────────────────────────────────────────────────────

interface SectionRow {
  readonly sortOrder: number;
  readonly code: string;
  readonly kind: string;
  readonly display: string;
}

function sectionRows(code: string): SectionRow[] {
  const start = code.indexOf('sections (sort_order, code, title, kind, display) AS (');
  if (start === -1) return [];
  const body = code.slice(start, closeParen(code, code.indexOf('(', code.indexOf('AS (', start))));
  return [...body.matchAll(/\((\d+), '([A-Z][0-9]+)', '[^']*', '([a-z]+)', '([a-z0-9]+)'\)/g)].map((m) => ({
    sortOrder: Number(m[1]),
    code: m[2],
    kind: m[3],
    display: m[4],
  }));
}

/** Every problem found in a checker text. The real file must return []. */
export function auditChecker(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const problems: string[] = [];
  const { code, bare } = scrubSql(text);
  const codeBlocks = blocksOf(text, code);

  // Read-only, and nothing else that writes.
  const firstLine = code.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine !== 'SET default_transaction_read_only = on;') {
    problems.push('read-only: the first statement is not SET default_transaction_read_only = on;');
  }
  const sets = bare.match(/\bSET\b/gi) ?? [];
  if (sets.length !== 1) problems.push(`read-only: expected exactly 1 SET statement, found ${sets.length}`);
  const writes = bare.match(
    /\b(insert|update|delete|merge|create|alter|drop|grant|revoke|truncate|copy|comment|vacuum|analyze|reindex|cluster|lock|call|do|execute|prepare|refresh|reset|begin|commit|rollback|savepoint|listen|notify|import|security)\b/gi,
  );
  if (writes) problems.push(`write keyword outside comments and strings: ${[...new Set(writes)].join(', ')}`);

  // Paste safety and the SECURITY DEFINER tripwire (whole text, comments included).
  if (/\binto\b/i.test(text)) problems.push('paste safety: the word into appears');
  if (/security\s+definer/i.test(text)) problems.push('SECURITY DEFINER guard: the phrase appears');
  if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(text)) problems.push('creates a function');
  if (!isAscii(text)) problems.push('paste safety: a non-ASCII character');
  if (/^[ \t]*\\/m.test(code)) problems.push('paste safety: a psql meta-command');
  const oneLetter = bare.match(/\bAS\s+[A-Za-z](?![A-Za-z0-9_])/g);
  if (oneLetter) problems.push(`paste safety: single-letter alias ${oneLetter.join(', ')}`);
  for (const hit of uncastCharConcats(code)) problems.push(`planner: "char" column joined with || without ::text: ${hit}`);

  // Sections: complete, ordered, kinds right.
  const rows = sectionRows(code);
  const codes = rows.map((r) => r.code);
  if (JSON.stringify(codes) !== JSON.stringify(SECTION_CODES)) {
    problems.push(`sections: expected ${SECTION_CODES.join(',')} got ${codes.join(',')}`);
  }
  rows.forEach((r, k) => {
    if (r.sortOrder <= 0) problems.push(`sections: ${r.code} sorts at or before VERDICT`);
    if (k > 0 && r.sortOrder <= rows[k - 1].sortOrder) problems.push(`sections: ${r.code} out of order`);
    const wantKind = r.code === 'P00' ? ['context'] : r.code === 'G1' ? ['grantor'] : r.code.startsWith('I') ? ['info'] : ['structure', 'acl'];
    if (!wantKind.includes(r.kind)) problems.push(`sections: ${r.code} has kind ${r.kind}`);
  });

  // Every section is produced, and every non-ACL section has its block header.
  const aclBlock = codeBlocks.get('acl_items') ?? '';
  const aclCodes = new Set([...aclBlock.matchAll(/SELECT\s+'([A-Z][0-9]+)'/g)].map((m) => m[1]));
  for (const c of SECTION_CODES) {
    if (!new RegExp(`SELECT\\s+(DISTINCT\\s+)?'${c}'`).test(code)) problems.push(`section ${c} produces no line`);
    if (!aclCodes.has(c) && !codeBlocks.has(c)) problems.push(`section ${c} has no block header`);
  }

  // VERDICT first.
  const report = codeBlocks.get('report') ?? '';
  const firstSelect = /SELECT\s+(\d+)\s+AS sort_order,\s*0 AS sub_order,\s*'([A-Z ]+)'/.exec(report);
  if (!firstSelect || firstSelect[2] !== 'VERDICT' || firstSelect[1] !== '0') {
    problems.push('VERDICT is not the first report row at sort order 0');
  }
  const keyOrders = [...report.matchAll(/SELECT\s+(\d+),\s*0,\s*'(CONTEXT KEY|PARITY KEY)'/g)];
  if (keyOrders.length !== 2) problems.push('report: CONTEXT KEY and PARITY KEY rows not found');
  if (!/ORDER BY report\.sort_order, report\.sub_order/.test(code)) problems.push('VERDICT: the report is not ordered by sort_order');

  // Privilege sections never print a count (SA B-4).
  const kindOf = new Map(rows.map((r) => [r.code, r]));
  const aclKinds = rows.filter((r) => r.kind === 'acl').map((r) => r.code);
  if (JSON.stringify([...aclCodes].sort()) !== JSON.stringify([...aclKinds].sort())) {
    problems.push(`ACL: sections built in acl_items (${[...aclCodes]}) differ from the acl kind (${aclKinds})`);
  }
  for (const c of aclKinds) {
    if (kindOf.get(c)?.display !== 'md5') problems.push(`ACL: section ${c} prints a count (display is not md5)`);
  }
  for (const [name, block] of codeBlocks) {
    const explodes = block.includes('aclexplode(');
    const readsAcl = /FROM acl_items\b/.test(block);
    if ((explodes || readsAcl) && block.includes('count(')) problems.push(`ACL: block ${name} carries count(`);
    if (explodes && name !== 'acl_items') {
      for (const m of block.matchAll(/SELECT\s+(?:DISTINCT\s+)?'([A-Z][0-9]+)'/g)) {
        if (kindOf.get(m[1])?.display !== 'md5') problems.push(`ACL: ${m[1]} in block ${name} is not md5-only`);
      }
    }
  }
  const countPrinters = code.match(/summary\.line_count \|\|/g) ?? [];
  if (countPrinters.length !== 1 || !/WHEN summary\.display = 'count' THEN summary\.line_count \|\|/.test(code)) {
    problems.push('ACL: a line count is printed outside the count display');
  }
  if (!/WHEN summary\.kind = 'grantor'\s+THEN CASE WHEN summary\.line_count = 0 THEN 'none'/.test(code)) {
    problems.push('G1: its detail is not none or present');
  }

  // ACL NULL handling per catalog (SA B-6).
  const seen = new Set<string>();
  for (const m of code.matchAll(/aclexplode\(/g)) {
    const open = (m.index ?? 0) + 'aclexplode'.length;
    const arg = code.slice(open + 1, closeParen(code, open) - 1).replace(/\s+/g, ' ').trim();
    const col = /\b(relacl|proacl|typacl|nspacl|attacl|defaclacl)\b/.exec(arg)?.[1];
    if (!col) {
      problems.push(`ACL: aclexplode over an unknown argument ${arg}`);
      continue;
    }
    seen.add(col);
    if (col === 'attacl' || col === 'defaclacl') {
      if (!new RegExp(`^\\w+\\.${col}$`).test(arg)) problems.push(`ACL: ${col} must be exploded as is, not ${arg}`);
    } else if (!new RegExp(`^coalesce\\(\\w+\\.${col}, acldefault\\(`).test(arg)) {
      problems.push(`ACL: ${col} must be exploded as coalesce(${col}, acldefault(...)), not ${arg}`);
    }
  }
  for (const col of ['relacl', 'proacl', 'typacl', 'nspacl', 'attacl', 'defaclacl']) {
    if (!seen.has(col)) problems.push(`ACL: ${col} is never exploded`);
  }

  // CR stripping before hashing.
  const defs = code.match(/pg_get_functiondef\(/g) ?? [];
  const wrappedDefs = code.match(/replace\(pg_get_functiondef\(\w+\.\w+\), chr\(13\), ''\)/g) ?? [];
  if (defs.length === 0 || defs.length !== wrappedDefs.length) {
    problems.push('CR: a pg_get_functiondef is hashed without replace(..., chr(13), ...)');
  }
  const descs = code.match(/\b\w+\.description\b/g) ?? [];
  const wrappedDescs = code.match(/replace\(coalesce\(\w+\.description, ''\), chr\(13\), ''\)/g) ?? [];
  if (descs.length === 0 || descs.length !== wrappedDescs.length) {
    problems.push('CR: a description is hashed without replace(coalesce(...), chr(13), ...)');
  }

  // Committed in summary mode.
  if (!/SELECT 'summary'::text AS run_mode/.test(code)) problems.push('run_mode: the committed mode is not summary');

  // The header states the row count the sections add up to.
  const stated = /returns exactly (\d+) rows/.exec(text);
  const expected = 1 + rows.length + 2;
  if (!stated || Number(stated[1]) !== expected) {
    problems.push(`row count: header states ${stated?.[1] ?? 'nothing'}, sections give ${expected}`);
  }

  // Anchors where a section can be legitimately empty (SA B-2).
  for (const c of ANCHORED) {
    if (!(codeBlocks.get(c) ?? '').includes("'anchor | ")) problems.push(`anchor: section ${c} has no anchor line`);
  }

  // P00 and the keys (SA B-3).
  const p00 = codeBlocks.get('P00') ?? '';
  for (const s of P00_SETTINGS) {
    if (!p00.includes(`current_setting('${s}')`)) problems.push(`P00: ${s} is missing`);
  }
  if (!/'PARITY KEY'[\s\S]*?WHERE summary\.kind IN \('structure', 'acl'\)\)/.test(report)) {
    problems.push('PARITY KEY: not computed over the structure and acl sections only');
  }
  if (!/'CONTEXT KEY'[\s\S]*?WHERE summary\.code = 'P00'\)/.test(report)) {
    problems.push('CONTEXT KEY: not the P00 hash');
  }

  // Lines mode never through execute_sql (SA B-7).
  if (!/Lines mode prints the grant posture\. It is never run through\s+-- execute_sql/.test(text)) {
    problems.push('lines mode: the header does not forbid execute_sql');
  }

  // Deterministic order before hashing.
  if (!/string_agg\(all_lines\.line, chr\(10\) ORDER BY all_lines\.line COLLATE "C"\)/.test(code)) {
    problems.push('determinism: section lines are not sorted COLLATE "C" before hashing');
  }
  return problems;
}

// ───────────────────────────────────────────────────────────────────────────
// The proof audit
// ───────────────────────────────────────────────────────────────────────────

export function auditProof(raw: string, step: string, checkerRows: number): string[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const problems: string[] = [];
  const { code, bare } = scrubSql(text);

  for (const [name, body] of [
    ['proof', text],
    ['step', step],
  ] as const) {
    if (/\binto\b/i.test(body)) problems.push(`${name}: the word into appears`);
    if (/security\s+definer/i.test(body)) problems.push(`${name}: the SECURITY DEFINER phrase appears`);
    if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(body)) problems.push(`${name}: defines a function`);
    if (!isAscii(body)) problems.push(`${name}: a non-ASCII character`);
    if (/^\\i\s/m.test(body)) problems.push(`${name}: an absolute include (use relative includes)`);
  }

  // One transaction at a time, always rolled back, never committed.
  const control = [...bare.matchAll(/^[ \t]*(BEGIN|COMMIT|END|ABORT|START TRANSACTION|ROLLBACK)\b([^;\n]*);/gim)]
    .map((m) => `${m[1].toUpperCase()}${m[2]}`.trim())
    .filter((t) => !/^ROLLBACK TO SAVEPOINT/i.test(t));
  const shape = control.map((t) => t.split(' ')[0]);
  if (JSON.stringify(shape) !== JSON.stringify(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK'])) {
    problems.push(`transaction: expected BEGIN, ROLLBACK, BEGIN, ROLLBACK and found ${shape.join(', ')}`);
  }
  // Escape hatches, anywhere in either file (SA code review 5). `bare` has
  // comments, strings and DO bodies blanked, so only live statements count.
  // END is legitimate only as the end of a CASE, so ENDs may not outnumber CASEs.
  const stepScrub = scrubSql(step.replace(/\r\n?/g, '\n'));
  for (const [name, live, withStrings] of [
    ['proof', bare, code],
    ['step', stepScrub.bare, stepScrub.code],
  ] as const) {
    const ends = (live.match(/\bEND\b/gi) ?? []).length;
    const cases = (live.match(/\bCASE\b/gi) ?? []).length;
    const control = live.match(/\b(COMMIT|ABORT|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED)\b/gi);
    if (control) problems.push(`${name}: transaction control ${[...new Set(control)].join(', ')}`);
    if (ends > cases) problems.push(`${name}: an END that closes no CASE (${ends} END, ${cases} CASE)`);
    const remote = withStrings.match(/\b(dblink\w*|pg_background\w*)\b/gi);
    if (remote) problems.push(`${name}: an autonomous-transaction escape ${[...new Set(remote)].join(', ')}`);
    for (const m of live.matchAll(/\\([A-Za-z]+|[^A-Za-z\s])/g)) {
      if (!ALLOWED_META.includes(m[1])) problems.push(`${name}: psql meta-command \\${m[1]} is not on the allow-list`);
    }
  }

  // The staging guard and the lock timeout come before the first savepoint (SA code review 1).
  const firstBegin = code.indexOf('BEGIN READ WRITE;');
  const firstSavepoint = code.search(/^SAVEPOINT proof_step;$/m);
  const opening = firstBegin === -1 || firstSavepoint === -1 ? '' : code.slice(firstBegin, firstSavepoint);
  const guard = /DO \$guard\$([\s\S]*?)\$guard\$;/.exec(opening)?.[1] ?? '';
  if (!/IF EXISTS \(SELECT 1 FROM auth\.users\) THEN\s+RAISE EXCEPTION/.test(guard)) {
    problems.push('staging guard: no DO block refusing a project with rows in auth.users before the first step');
  }
  if (/\bEXCEPTION\s+WHEN\b/i.test(guard)) problems.push('staging guard: it has an exception handler, so it could not stop the run');
  if (!/^SET LOCAL lock_timeout = '3s';$/m.test(opening)) problems.push('lock timeout: SET LOCAL lock_timeout is not set before the first step');
  const quietOpens = (code.match(/^BEGIN READ WRITE;\n(?:[ \t]*\n)*SET client_min_messages = error;$/gm) ?? []).length;
  if (quietOpens !== 2) problems.push(`notices: ${quietOpens} of 2 transactions set client_min_messages = error`);

  // A refusal reads NOT RUN only on the steps SA allowed.
  const mayRefuse = [...code.matchAll(/^\s+\('(\w+)', '[^']*', ARRAY.*, (?:true|false), (true|false)\)[,;]$/gm)];
  const refusing = mayRefuse.filter((m) => m[2] === 'true').map((m) => m[1]);
  if (mayRefuse.length === 0 || JSON.stringify(refusing) !== JSON.stringify(MAY_REFUSE)) {
    problems.push(`may_refuse: expected exactly ${MAY_REFUSE.join(',')} and found ${refusing.join(',') || 'none'}`);
  }
  if (!/WHEN expect\.may_refuse\s+AND cur\.state ~ '\^refused: /.test(code)) {
    problems.push('may_refuse: the compare view does not gate NOT RUN on may_refuse');
  }

  const opened = (code.match(/^SAVEPOINT proof_step;$/gm) ?? []).length;
  const undone = (code.match(/^ROLLBACK TO SAVEPOINT proof_step;$/gm) ?? []).length;
  const released = (code.match(/^RELEASE SAVEPOINT proof_step;$/gm) ?? []).length;
  if (opened === 0 || opened !== undone || opened !== released) {
    problems.push(`savepoints: ${opened} opened, ${undone} rolled back, ${released} released`);
  }

  // Every step is expected, run and summarised.
  const runs = [...code.matchAll(/^SET proof\.run = '(\w+)';$/gm)].map((m) => m[1]);
  const expected = [...code.matchAll(/^\s+\('(\w+)', '([^']*)', ARRAY/gm)].map((m) => ({ d: m[1], target: m[2] }));
  const summarised = [...code.matchAll(/\(\d+, '(\w+)', :'res_(\w+)'\)/g)].map((m) => ({ d: m[1], v: m[2] }));
  const wanted = [...expected.map((e) => e.d), 'AFTER'];
  if (JSON.stringify([...runs].sort()) !== JSON.stringify([...wanted].sort())) {
    problems.push(`steps: run labels ${runs.join(',')} do not match the expectations plus AFTER`);
  }
  if (new Set(runs).size !== runs.length) problems.push('steps: a run label is used twice');
  if (JSON.stringify(summarised.map((s) => s.d)) !== JSON.stringify(runs)) {
    problems.push(`summary: lists ${summarised.map((s) => s.d).join(',')} but the run is ${runs.join(',')}`);
  }
  for (const s of summarised) {
    if (s.v !== s.d.toLowerCase()) problems.push(`summary: ${s.d} reads res_${s.v}`);
    if (!new RegExp(`(\\\\set res_${s.v} :step_result|AS res_${s.v}\\b)`).test(code)) {
      problems.push(`summary: res_${s.v} is never set`);
    }
  }

  // Every section can be shown to fail (SA B-1).
  const targets = new Set(expected.map((e) => e.target.split(' ')[0]));
  for (const c of [...P_CODES, 'G1']) {
    if (!targets.has(c)) problems.push(`coverage: no deliberate difference targets ${c}`);
  }
  const adds = expected.filter((e) => /grant added/.test(e.target)).map((e) => e.d);
  if (adds.length === 0) problems.push('coverage: no step ADDS a grant (SA A-7)');

  for (const hit of uncastCharConcats(code)) problems.push(`planner: "char" column joined with || without ::text: ${hit}`);

  // No object of ours named in the file.
  const named = code.match(/\b(public|operator_private)\.[A-Za-z_"]/g);
  if (named) problems.push(`names an object of ours: ${named.join(', ')}`);

  // Run settings and the row count shared with the checker.
  if (!/^\\set ON_ERROR_STOP on$/m.test(code)) problems.push('psql: ON_ERROR_STOP is not set');
  if (!/^\\set QUIET on$/m.test(code)) problems.push('psql: QUIET is not set, command tags would reach the CSV');
  const rowsVar = /^\\set expected_rows (\d+)$/m.exec(code);
  if (!rowsVar || Number(rowsVar[1]) !== checkerRows) {
    problems.push(`row count: expected_rows is ${rowsVar?.[1] ?? 'unset'}, the checker states ${checkerRows}`);
  }
  for (const [name, body] of [
    ['proof', code],
    ['step', step],
  ] as const) {
    if (!body.includes('\\ir ../../scripts/check-schema-parity.sql')) problems.push(`${name}: does not run the checker`);
  }
  if (!step.includes('\\pset tuples_only on') || !step.includes('\\gset')) problems.push('step: does not load and record its result');
  return problems;
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

const checker = readRepoFile(CHECKER);
const proof = readRepoFile(PROOF);
const step = readRepoFile(STEP);
const checkerRows = Number(/returns exactly (\d+) rows/.exec(checker)?.[1] ?? NaN);

describe('scripts/check-schema-parity.sql', () => {
  it('passes every structural rule', () => {
    expect(auditChecker(checker)).toEqual([]);
  });

  it('states 39 rows: VERDICT, P00 to P26, G1, the two keys and I1 to I8', () => {
    expect(checkerRows).toBe(1 + 27 + 1 + 2 + 8);
  });
});

describe('supabase/baseline/prove-checker-can-fail.psql', () => {
  it('passes every structural rule', () => {
    expect(auditProof(proof, step, checkerRows)).toEqual([]);
  });
});

describe('.gitattributes pins LF on the three files', () => {
  const attributes = readRepoFile('.gitattributes').split('\n');
  it.each([[CHECKER], [PROOF], [STEP]])('%s', (file) => {
    expect(attributes).toContain(`${file} text eol=lf`);
  });
});

describe('the audits can fail', () => {
  type Mutation = readonly [string, (s: string) => string, RegExp];

  const checkerBreaks: Mutation[] = [
    ['the word into in a comment', (s) => s.replace('-- HOW TO READ IT', '-- HOW TO READ IT, read into it'), /into/],
    ['the SECURITY DEFINER phrase in a comment', (s) => s.replace('-- HOW TO READ IT', '-- HOW TO READ IT security definer'), /SECURITY DEFINER/],
    ['a section row deleted', (s) => s.replace("    (107, 'P07', 'functions', 'structure', 'count'),\n", ''), /sections: expected/],
    ['a section block header deleted', (s) => s.replace('  -- [block P13]\n', ''), /section P13 has no block header/],
    ['the read-only SET removed', (s) => s.replace('SET default_transaction_read_only = on;\n', ''), /read-only/],
    ['a write statement added', (s) => `${s}\nDELETE FROM storage.buckets;\n`, /write keyword/],
    ['VERDICT moved off the top', (s) => s.replace('SELECT 0 AS sort_order, 0 AS sub_order', 'SELECT 999 AS sort_order, 0 AS sub_order'), /VERDICT/],
    ['an ACL section shows its count', (s) => s.replace("(109, 'P09', 'relation ACLs', 'acl', 'md5')", "(109, 'P09', 'relation ACLs', 'acl', 'count')"), /P09 prints a count/],
    [
      'count( attached to the ACL lines',
      (s) => s.replace('acl_items.privilege_type, acl_items.is_grantable)\n  FROM acl_items', "acl_items.privilege_type, acl_items.is_grantable) || count(*) OVER ()\n  FROM acl_items"),
      /block acl_lines carries count/,
    ],
    ['attacl NULL-expanded', (s) => s.replace('aclexplode(att.attacl)', "aclexplode(coalesce(att.attacl, acldefault('c', rel.relowner)))"), /attacl must be exploded as is/],
    ['relacl compared raw', (s) => s.replace(/aclexplode\(coalesce\(rel\.relacl, acldefault\(\(CASE WHEN rel\.relkind = 'S' THEN 's' ELSE 'r' END\)::"char", rel\.relowner\)\)\)/, 'aclexplode(rel.relacl)'), /relacl must be exploded as coalesce/],
    ['a function body hashed with its CRs', (s) => s.replace("md5(replace(pg_get_functiondef(fn.fn_oid), chr(13), ''))", 'md5(pg_get_functiondef(fn.fn_oid))'), /CR: a pg_get_functiondef/],
    ['a comment hashed with its CRs', (s) => s.replace("md5(replace(coalesce(obj_dsc.description, ''), chr(13), ''))", 'md5(obj_dsc.description)'), /CR: a description/],
    ['lines mode committed', (s) => s.replace("SELECT 'summary'::text AS run_mode", "SELECT 'lines'::text AS run_mode"), /run_mode/],
    ['the stated row count drifts', (s) => s.replace('returns exactly 39 rows', 'returns exactly 38 rows'), /row count/],
    ['an anchor dropped', (s) => s.replace("'anchor | storage.%s", "'storage %s"), /anchor: section P21/],
    ['the P15 anchor dropped', (s) => s.replace("'anchor | default ACL scan | %s'", "'default ACL scan | %s'"), /anchor: section P15/],
    ['P00 loses bytea_output', (s) => s.replace("current_setting('bytea_output'),", ''), /P00: bytea_output/],
    ['P00 folded back in the PARITY KEY', (s) => s.replace("WHERE summary.kind IN ('structure', 'acl'))", "WHERE summary.kind IN ('context', 'structure', 'acl'))"), /PARITY KEY/],
    ['a single-letter alias', (s) => s.replace('FROM pg_namespace AS nsp\n  WHERE', 'FROM pg_namespace AS n\n  WHERE'), /single-letter alias/],
    // The two sites DO-1b found on staging (42725), restored to their pre-fix text.
    ['P15: defaclobjtype joined without ::text', (s) => s.replace('dacl.defaclobjtype::text,', 'dacl.defaclobjtype,'), /planner: .*defaclobjtype/],
    ['P13: deptype joined without ::text', (s) => s.replace("' dep=' || own_dep.deptype::text", "' dep=' || own_dep.deptype"), /planner: .*deptype/],
    ['a "char" column on the left of ||', (s) => s.replace("rel.nspname || '.' || rel.relname, rel.relowner,", "rel.relkind || '.' || rel.relname, rel.relowner,"), /planner: .*relkind \|\|/],
  ];

  it.each(checkerBreaks)('checker: %s', (_name, mutate, complaint) => {
    const broken = mutate(checker);
    expect(broken).not.toBe(checker);
    expect(auditChecker(broken).join('\n')).toMatch(complaint);
  });

  const proofBreaks: Mutation[] = [
    ['the final ROLLBACK becomes COMMIT', (s) => s.replace(/ROLLBACK;\n\n-- Summary/, 'COMMIT;\n\n-- Summary'), /transaction/],
    ['a savepoint left open', (s) => s.replace('ROLLBACK TO SAVEPOINT proof_step;\n', ''), /savepoints/],
    ['a step missing from the summary', (s) => s.replace("    (5, 'D03', :'res_d03'),\n", ''), /summary: lists/],
    ['a section with no deliberate difference', (s) => s.replace("  ('D13', 'P13',", "  ('D13', 'P12',"), /coverage: no deliberate difference targets P13/],
    ['an object of ours named', (s) => s.replace('CREATE TEMP VIEW proof_compare AS', 'SELECT 1 FROM public.users;\nCREATE TEMP VIEW proof_compare AS'), /names an object of ours/],
    ['the row count drifts from the checker', (s) => s.replace('\\set expected_rows 39', '\\set expected_rows 38'), /row count/],
    ['the word into in a comment', (s) => s.replace('-- WHAT IT DOES.', '-- WHAT IT DOES, looking into it.'), /into/],
    // SA code review 1: the staging guard and the lock timeout.
    ['the staging guard removed', (s) => s.replace(/DO \$guard\$[\s\S]*?\$guard\$;\n/, ''), /staging guard: no DO block/],
    [
      'the staging guard given an exception handler',
      (s) => s.replace(/  END IF;\nEND\n\$guard\$;/,'  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$guard$;'),
      /staging guard: it has an exception handler/,
    ],
    ["the lock timeout removed", (s) => s.replace("SET LOCAL lock_timeout = '3s';\n", ''), /lock timeout/],
    ['client_min_messages dropped from the AFTER transaction', (s) => s.replace('BEGIN READ WRITE;\nSET client_min_messages = error;\nCREATE', 'BEGIN READ WRITE;\nCREATE'), /notices: 1 of 2/],
    // SA code review 4: NOT RUN on a refusal only where SA allowed it.
    ['D01 allowed to refuse', (s) => s.replace("ARRAY['P01', 'PARITY KEY'], ARRAY[]::text[], false, false)", "ARRAY['P01', 'PARITY KEY'], ARRAY[]::text[], false, true)"), /may_refuse: expected exactly/],
    ['the compare view ignores may_refuse', (s) => s.replace('WHEN expect.may_refuse\n             AND cur.state', 'WHEN true\n             AND cur.state'), /may_refuse: the compare view/],
    // SA code review 5: escape hatches in the proof.
    ['a \\c reconnect in the proof', (s) => s.replace('CREATE TEMP VIEW proof_compare AS', '\\c postgres\nCREATE TEMP VIEW proof_compare AS'), /meta-command \\c is not on the allow-list/],
    ['a \\gexec in the proof', (s) => s.replace("FROM pg_temp.proof_rows\nWHERE proof_rows.run_label = 'BASE' \\gset", "FROM pg_temp.proof_rows\nWHERE proof_rows.run_label = 'BASE' \\gexec"), /meta-command \\gexec is not on the allow-list/],
    ['COMMIT mid-line in the proof', (s) => s.replace('SET proof.run = \'POST\';', "SET proof.run = 'POST'; COMMIT;"), /proof: transaction control COMMIT/],
    ['a dblink call in the proof', (s) => s.replace('CREATE TEMP VIEW proof_compare AS', "SELECT dblink_exec('x', 'y');\nCREATE TEMP VIEW proof_compare AS"), /autonomous-transaction escape dblink_exec/],
  ];

  it.each(proofBreaks)('proof: %s', (_name, mutate, complaint) => {
    const broken = mutate(proof);
    expect(broken).not.toBe(proof);
    expect(auditProof(broken, step, checkerRows).join('\n')).toMatch(complaint);
  });

  const stepBreaks: Mutation[] = [
    ['COMMIT in the step file', (s) => `${s}COMMIT;\n`, /step: transaction control COMMIT/],
    ['END on its own in the step file', (s) => `${s}END;\n`, /step: an END that closes no CASE/],
    ['a \\! shell escape in the step file', (s) => s.replace('\\o\n', '\\o\n\\! echo x\n'), /step: psql meta-command \\! is not on the allow-list/],
  ];

  it.each(stepBreaks)('step: %s', (_name, mutate, complaint) => {
    const broken = mutate(step);
    expect(broken).not.toBe(step);
    expect(auditProof(proof, broken, checkerRows).join('\n')).toMatch(complaint);
  });

  it('scrubSql keeps offsets and blanks comments, strings and dollar bodies', () => {
    const sample = "SELECT 'a -- b' AS x -- into\nDO $t$ BEGIN END $t$;";
    const { code, bare } = scrubSql(sample);
    expect(code.length).toBe(sample.length);
    expect(code).not.toMatch(/into/);
    expect(code).toContain("'a -- b'");
    expect(bare).not.toContain('a -- b');
    expect(bare).not.toMatch(/BEGIN END/);
  });
});
