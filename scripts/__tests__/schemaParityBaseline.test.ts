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
const BEFORE = 'supabase/baseline/before-schema.sql';
const AFTER = 'supabase/baseline/after-schema.sql';

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
  /** [from, to) of every top-level dollar body's contents (DV-3 uses them). */
  readonly bodies: ReadonlyArray<readonly [number, number]>;
}

/** Blank comments (and optionally literal contents) without moving any offset. */
export function scrubSql(input: string): Scrubbed {
  const code = input.split('');
  const bare = input.split('');
  const bodies: Array<readonly [number, number]> = [];
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
      bodies.push([i + tag[0].length, end]);
      i = close === -1 ? n : close + tag[0].length;
    } else {
      i++;
    }
  }
  return { code: code.join(''), bare: bare.join(''), bodies };
}

/**
 * scrubSql applied inside every dollar body as well, so a DO block's own
 * comments and strings are blanked too. `code` keeps strings and the code of
 * every body; `bare` also blanks string contents. Offsets never move.
 */
export function deepScrub(input: string): Scrubbed {
  const top = scrubSql(input);
  const code = top.code.split('');
  const bare = top.bare.split('');
  for (const [from, to] of top.bodies) {
    const inner = deepScrub(input.slice(from, to));
    for (let k = 0; k < inner.code.length; k++) {
      code[from + k] = inner.code[k];
      bare[from + k] = inner.bare[k];
    }
  }
  return { code: code.join(''), bare: bare.join(''), bodies: top.bodies };
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

  // P26 carries the postgres-owned event triggers, tags sorted (SA R-7).
  const p26 = codeBlocks.get('P26') ?? '';
  const evtBranch = /SELECT 'P26',\s*format\('event trigger \|[\s\S]*?FROM pg_event_trigger AS evt\s*WHERE ([^\n]*)/.exec(p26);
  if (!evtBranch) {
    problems.push('P26: no pg_event_trigger branch');
  } else {
    if (evtBranch[1].trim() !== "evt.evtowner = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')") {
      problems.push('P26: the event trigger branch is not filtered to owner postgres');
    }
    if (!/array\(SELECT evt_tag\.tag_name FROM unnest\(evt\.evttags\) AS evt_tag \(tag_name\)\s+ORDER BY evt_tag\.tag_name COLLATE "C"\)/.test(evtBranch[0])) {
      problems.push('P26: event trigger tags are not sorted with COLLATE "C"');
    }
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
// The apply fragments (DV-3): before-schema.sql and after-schema.sql
// ───────────────────────────────────────────────────────────────────────────

/** Staging's six platform event triggers, sorted COLLATE "C" (SA R-6). */
const STAGING_EVENT_TRIGGERS = [
  'issue_graphql_placeholder',
  'issue_pg_cron_access',
  'issue_pg_graphql_access',
  'issue_pg_net_access',
  'pgrst_ddl_watch',
  'pgrst_drop_watch',
];

/**
 * The five buckets: id, public, size limit in bytes. All five are in tracked
 * migrations. Pinned here because a private bucket must never come out public.
 */
const BUCKETS: ReadonlyArray<readonly [string, boolean, number]> = [
  ['avatars', true, 4194304],
  ['website-images', true, 5242880],
  ['contact-documents', false, 52428800],
  ['business-data-exports', false, 52428800],
  ['business-purge-snapshots', false, 524288000],
];

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The code of one `DO $tag$ ... $tag$;` block, comments blanked. '' when absent. */
function doBlock(deepCode: string, tag: string): string {
  return new RegExp(`DO \\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$;`).exec(deepCode)?.[1] ?? '';
}

/**
 * Rules every U5 fragment keeps (SA C-2, C-4, F-1, OQ-15, R-4, R-10). The
 * atomicity precondition: the first statement is SAVEPOINT, the last releases
 * it, and nothing in between controls the transaction, so a run without
 * --single-transaction stops before anything runs.
 */
export function auditFragment(raw: string, savepoint: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const problems: string[] = [];
  const top = scrubSql(text);
  const deep = deepScrub(text);

  const statements = top.bare.split(';').map(squash).filter((s) => s.length > 0);
  if (statements[0] !== `SAVEPOINT ${savepoint}`) {
    problems.push(`savepoint: the first statement is not SAVEPOINT ${savepoint} (found ${statements[0] ?? 'nothing'})`);
  }
  if (statements[statements.length - 1] !== `RELEASE SAVEPOINT ${savepoint}`) {
    problems.push(`release: the last statement is not RELEASE SAVEPOINT ${savepoint}`);
  }
  const opens = statements.filter((s) => /^SAVEPOINT\b/i.test(s)).length;
  const releases = statements.filter((s) => /^RELEASE\b/i.test(s)).length;
  if (opens !== 1 || releases !== 1) problems.push(`savepoint: ${opens} opened and ${releases} released, expected 1 and 1`);

  // Transaction control. BEGIN and END are plpgsql block syntax inside a DO
  // body, so they are refused at the top level only.
  const control = deep.bare.match(/\b(COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/gi);
  if (control) problems.push(`transaction control ${[...new Set(control.map(squash))].join(', ')}`);
  const blocks = top.bare.match(/\b(BEGIN|END)\b/gi);
  if (blocks) problems.push(`transaction control ${[...new Set(blocks)].join(', ')} at the top level`);
  if (deep.bare.includes('\\')) problems.push('psql meta-command: a backslash outside strings and comments');
  const remote = deep.code.match(/\b(dblink\w*|pg_background\w*)\b/gi);
  if (remote) problems.push(`an autonomous-transaction escape ${[...new Set(remote)].join(', ')}`);

  // The O-1 tripwire and paste hygiene (whole text, comments included).
  if (/security\s+definer/i.test(text)) problems.push('SECURITY DEFINER guard: the phrase appears');
  if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(text)) problems.push('defines a function');
  if (!isAscii(text)) problems.push('a non-ASCII character');
  if (!/^-- PSQL ONLY\. Never paste this file in the Supabase SQL editor/m.test(text) || !/standalone word "into"/.test(text)) {
    problems.push('header: does not say psql only and name the editor word problem');
  }

  // Nothing silently skipped on a project that is not empty (SA C-1).
  const silent = top.bare.match(/\bIF\s+NOT\s+EXISTS\b|\bON\s+CONFLICT\b|\bOR\s+REPLACE\b/gi);
  if (silent) problems.push(`silent no-op: ${[...new Set(silent.map(squash))].join(', ')}`);
  if (/\bEXCEPTION\s+WHEN\b/i.test(deep.code)) problems.push('a DO block has an exception handler, so its refusal could be swallowed');

  // Grants come from the dump only. The neutraliser's REVOKE is built at run
  // time from the catalog, so the file carries no grant list (SA A-1).
  const grants = deep.bare.match(/\b(GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES)\b/gi);
  if (grants) problems.push(`a fixed grant list: ${[...new Set(grants.map(squash))].join(', ')}`);
  if (/\bALTER\s+ROLE\b/i.test(deep.bare)) problems.push('ALTER ROLE: the API-role settings already match (SA R-10)');
  if (/\bALTER\s+EXTENSION\b/i.test(deep.bare)) problems.push('ALTER EXTENSION: a version moves only by a migration applied to both (SA R-8)');
  const destroys = deep.bare.match(/\b(DELETE|TRUNCATE|DROP)\b/gi);
  if (destroys) problems.push(`a destructive statement ${[...new Set(destroys)].join(', ')} (SA R-4: buckets are never deleted by SQL)`);
  const secretWrite = deep.code.match(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|COPY|MERGE\s+INTO)\s+"?operator_private\b/gi);
  if (secretWrite) problems.push(`a data statement names operator_private: ${secretWrite.map(squash).join(', ')}`);

  // Every relation is schema-qualified: the dump empties search_path (SA C-4).
  const refs = /\b(FROM|JOIN|INTO|UPDATE|ON|EXECUTE\s+FUNCTION|MATERIALIZED\s+VIEW)\s+(?:LATERAL\s+|ONLY\s+)?([A-Za-z_"][\w$"]*(?:\s*\.\s*[A-Za-z_"][\w$"]*)?)/gi;
  for (const m of deep.bare.matchAll(refs)) {
    if (/^ARRAY$/i.test(m[2])) continue;
    if (!m[2].includes('.')) problems.push(`unqualified name after ${squash(m[1])}: ${m[2]}`);
  }
  return problems;
}

/** before-schema.sql: the guard, the pinned extensions, the default-ACL end state (SA C-1, R-6, R-8, A-1). */
export function auditBeforeSchema(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const problems = auditFragment(text, 'baseline_before_schema');
  const top = scrubSql(text);
  const deep = deepScrub(text);

  // The guard: no handler, and every refusal SA C-1 and R-6 named.
  const guard = doBlock(deep.code, 'guard');
  if (!guard) problems.push('guard: no DO $guard$ block');
  const guardRules: ReadonlyArray<readonly [string, RegExp]> = [
    ['not connected as postgres', /IF current_user <> 'postgres' THEN/],
    ['rows in auth.users', /IF EXISTS \(SELECT 1 FROM auth\.users\) THEN/],
    ['public resolved by name', /public_oid oid := \(SELECT nsp\.oid FROM pg_catalog\.pg_namespace AS nsp WHERE nsp\.nspname = 'public'\)/],
    ['a relation in public', /FROM pg_catalog\.pg_class AS rel\s+WHERE rel\.relnamespace = public_oid/],
    ['a function in public', /FROM pg_catalog\.pg_proc AS fn\s+WHERE fn\.pronamespace = public_oid/],
    ['a type in public', /FROM pg_catalog\.pg_type AS typ\s+WHERE typ\.typnamespace = public_oid/],
    ['any object in public (namespace census)', /dep\.refobjid = public_oid\s+AND dep\.deptype = 'n'/],
    ['operator_private exists', /WHERE nsp\.nspname = 'operator_private'\) THEN/],
    ['vector or btree_gist installed', /WHERE ext\.extname IN \('vector', 'btree_gist'\)\) THEN/],
    ['pg_graphql installed', /WHERE ext\.extname = 'pg_graphql'\) THEN/],
    ['a trigger on auth.users', /WHERE trg\.tgrelid = 'auth\.users'::regclass\s+AND NOT trg\.tgisinternal/],
    ['event trigger names sorted', /array_agg\(evt\.evtname::text ORDER BY evt\.evtname::text COLLATE "C"\)\s+FROM pg_catalog\.pg_event_trigger AS evt/],
    ['the refusal raises', /IF pg_catalog\.cardinality\(refusals\) > 0 THEN\s+RAISE EXCEPTION/],
  ];
  for (const [name, rule] of guardRules) {
    if (!rule.test(guard)) problems.push(`guard: does not refuse on ${name}`);
  }
  // Only extension members are excluded, in each of the four object checks.
  if ((guard.match(/deptype = 'e'/g) ?? []).length < 5) problems.push('guard: an object check lost its extension-member exclusion');
  const buckets = /FROM storage\.buckets AS bkt\s+WHERE bkt\.id IN \(([^)]*)\)/.exec(guard);
  const guardIds = [...(buckets?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  if (JSON.stringify(guardIds) !== JSON.stringify(BUCKETS.map((b) => b[0]).sort())) {
    problems.push(`guard: does not refuse on exactly our five bucket ids (found ${guardIds.join(',') || 'none'})`);
  }
  const expectedSet = /IF event_trigger_names IS DISTINCT FROM ARRAY\[([^\]]*)\]::text\[\] THEN/.exec(guard);
  const names = [...(expectedSet?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (JSON.stringify(names) !== JSON.stringify(STAGING_EVENT_TRIGGERS)) {
    problems.push(`event triggers: the guard expects ${names.join(',') || 'nothing'}, not exactly staging's six (SA R-6)`);
  }

  // The extensions, pinned (SA R-8), and checked after they are created.
  const creates = top.code.match(/^CREATE EXTENSION .*$/gm) ?? [];
  if (JSON.stringify(creates) !== JSON.stringify([
    "CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.0';",
    "CREATE EXTENSION btree_gist WITH SCHEMA public VERSION '1.7';",
  ])) {
    problems.push(`extensions: expected vector 0.8.0 then btree_gist 1.7 in public, found ${creates.join(' / ') || 'none'}`);
  }
  const extCheck = doBlock(deep.code, 'extensions');
  if (!/ext\.extname = 'vector' AND ext\.extversion = '0\.8\.0'/.test(extCheck)
    || !/ext\.extname = 'btree_gist' AND ext\.extversion = '1\.7'/.test(extCheck)
    || !/<> 2 THEN\s+RAISE EXCEPTION/.test(extCheck)) {
    problems.push('extensions: the installed versions are not asserted');
  }

  // The neutraliser: read from the catalog, postgres only, our schemas only.
  const neutralise = doBlock(deep.code, 'neutralise');
  const neutraliseRules: ReadonlyArray<readonly [string, RegExp]> = [
    ['reads pg_default_acl', /FROM pg_catalog\.pg_default_acl AS def\s+JOIN pg_catalog\.pg_namespace AS nsp ON nsp\.oid = def\.defaclnamespace\s+CROSS JOIN LATERAL pg_catalog\.aclexplode\(def\.defaclacl\) AS acl/],
    ['for postgres', /WHERE def\.defaclrole = \(SELECT rol\.oid FROM pg_catalog\.pg_roles AS rol WHERE rol\.rolname = 'postgres'\)/],
    ['in our schemas', /AND nsp\.nspname IN \('public', 'operator_private'\)/],
    ['every object type', /WHEN 'r' THEN 'TABLES'\s+WHEN 'S' THEN 'SEQUENCES'\s+WHEN 'f' THEN 'FUNCTIONS'\s+WHEN 'T' THEN 'TYPES'/],
    ['refusing an unknown type', /IF dacl\.object_kind IS NULL THEN\s+RAISE EXCEPTION/],
    ['revoking every grantee', /EXECUTE pg_catalog\.format\('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON %s FROM %s',/],
  ];
  if (!neutralise) problems.push('neutralise: no DO $neutralise$ block');
  for (const [name, rule] of neutraliseRules) {
    if (!rule.test(neutralise)) problems.push(`neutralise: not ${name}`);
  }
  if (/\bGRANT\b/i.test(neutralise)) problems.push('neutralise: it grants');

  // The end state (SA A-1): no row for postgres in our schemas or globally.
  const endState = doBlock(deep.code, 'end_state');
  if (!/postgres_oid oid := \(SELECT rol\.oid FROM pg_catalog\.pg_roles AS rol WHERE rol\.rolname = 'postgres'\)/.test(endState)
    || !/WHERE def\.defaclrole = postgres_oid\s+AND nsp\.nspname IN \('public', 'operator_private'\)\s*\) THEN\s+RAISE EXCEPTION/.test(endState)) {
    problems.push('end state: no refusal when postgres keeps a default ACL in our schemas (SA A-1)');
  }
  if (!/WHERE def\.defaclrole = postgres_oid\s+AND def\.defaclnamespace = 0\s*\) THEN\s+RAISE EXCEPTION/.test(endState)) {
    problems.push('end state: no refusal when postgres has a global default ACL (SA A-1)');
  }

  // Order: savepoint, guard, extensions, neutralise, end state, release. Nothing
  // is created or changed before the guard has run.
  const at = (re: RegExp) => top.code.search(re);
  const order: ReadonlyArray<readonly [string, number]> = [
    ['savepoint', at(/^SAVEPOINT baseline_before_schema;$/m)],
    ['guard', at(/^DO \$guard\$$/m)],
    ['extensions', at(/^CREATE EXTENSION vector\b/m)],
    ['neutralise', at(/^DO \$neutralise\$$/m)],
    ['end state', at(/^DO \$end_state\$$/m)],
    ['release', at(/^RELEASE SAVEPOINT baseline_before_schema;$/m)],
  ];
  order.forEach(([name, pos], k) => {
    if (pos === -1) problems.push(`order: ${name} not found`);
    else if (k > 0 && order[k - 1][1] !== -1 && pos <= order[k - 1][1]) problems.push(`order: ${name} runs before ${order[k - 1][0]}`);
  });
  const guardAt = order[1][1];
  if (guardAt > 0 && /\b(CREATE|ALTER|INSERT|UPDATE|COMMENT|SECURITY)\b/i.test(top.bare.slice(0, guardAt))) {
    problems.push('order: a statement changes the project before the guard runs');
  }
  return problems;
}

/** after-schema.sql: the trigger, the buckets, the initialisation row and the after-dump assertions. */
export function auditAfterSchema(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n');
  const problems = auditFragment(text, 'baseline_after_schema');
  const top = scrubSql(text);
  const deep = deepScrub(text);

  // OQ-1: the one object of ours outside our schemas, as on staging (P19).
  const triggers = [...top.code.matchAll(/CREATE TRIGGER[^;]*;/g)].map((m) => squash(m[0]));
  if (JSON.stringify(triggers) !== JSON.stringify([
    'CREATE TRIGGER create_user_settings_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_user_settings();',
  ])) {
    problems.push(`trigger: expected exactly the auth.users signup trigger, found ${triggers.join(' / ') || 'none'}`);
  }

  // Only two writes: the bucket rows and the initialisation row (OQ-15 class b).
  const inserts = [...top.code.matchAll(/\bINSERT INTO ([\w."]+)/gi)].map((m) => m[1]);
  if (JSON.stringify(inserts) !== JSON.stringify(['storage.buckets', 'public.bos_cron_run_recording'])) {
    problems.push(`inserts: expected storage.buckets then public.bos_cron_run_recording, found ${inserts.join(',') || 'none'}`);
  }
  if (/\bUPDATE\b|\bCOPY\b/i.test(deep.bare)) problems.push('a data statement other than the two inserts');

  // The five buckets (P20): ids equal names, and the public flag and size are pinned.
  const bucketStmt = /INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s+VALUES([\s\S]*?);/.exec(top.code)?.[1] ?? '';
  const rows = [...bucketStmt.matchAll(/\('([a-z-]+)', '([a-z-]+)', (true|false), (\d+),\s*ARRAY\[[^\]]+\]::text\[\]\)/g)];
  const found = rows.map((m) => [m[1], m[3] === 'true', Number(m[4])] as const);
  if (rows.some((m) => m[1] !== m[2])) problems.push('buckets: an id differs from its name');
  if (JSON.stringify(found) !== JSON.stringify(BUCKETS)) {
    problems.push(`buckets: expected ${BUCKETS.map((b) => b.join(':')).join(',')}, found ${found.map((b) => b.join(':')).join(',') || 'none'}`);
  }
  const landed = doBlock(deep.code, 'buckets');
  const landedIds = [...(/WHERE bkt\.id IN \(([^)]*)\)\) <> 5 THEN\s+RAISE EXCEPTION/.exec(landed)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  if (JSON.stringify(landedIds) !== JSON.stringify(BUCKETS.map((b) => b[0]).sort())) {
    problems.push('buckets: the five rows are not counted after the insert');
  }

  // OQ-15 class (b): the migration's own statement, never a copy of a value.
  if (!/^INSERT INTO public\.bos_cron_run_recording DEFAULT VALUES;$/m.test(top.code)) {
    problems.push('bos_cron_run_recording: the initialisation row is not the DEFAULT VALUES insert');
  }

  // SA A-2 and SA code review item 8.
  const afterDump = doBlock(deep.code, 'after_dump');
  if (!/WHERE def\.defaclrole = \(SELECT rol\.oid FROM pg_catalog\.pg_roles AS rol WHERE rol\.rolname = 'postgres'\)\s+AND def\.defaclnamespace = 0\s*\) THEN\s+RAISE EXCEPTION/.test(afterDump)) {
    problems.push('global default ACLs: no assertion after the dump (SA A-2)');
  }
  if (!/WHERE nsp\.nspname IN \('public', 'operator_private'\)\s+AND rel\.relkind = 'm'\s+AND NOT rel\.relispopulated\s*\) THEN\s+RAISE EXCEPTION/.test(afterDump)) {
    problems.push('materialized views: no refusal for one left unpopulated (SA code review item 8)');
  }
  // SA DV-3 ruling 7: a REFRESH runs after the seed, so the message must not send it here.
  if (!/REFRESH MATERIALIZED VIEW line at the end of seed-import\.psql, after the seed rows and before its RELEASE/.test(afterDump)) {
    problems.push('materialized views: the refusal does not send the REFRESH to the end of seed-import.psql (SA ruling 7)');
  }

  if (!/^NOTIFY pgrst, 'reload schema';$/m.test(top.code)) problems.push('NOTIFY: PostgREST is not told to reload its schema');
  return problems;
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

const checker = readRepoFile(CHECKER);
const proof = readRepoFile(PROOF);
const step = readRepoFile(STEP);
const checkerRows = Number(/returns exactly (\d+) rows/.exec(checker)?.[1] ?? NaN);
const beforeSchema = readRepoFile(BEFORE);
const afterSchema = readRepoFile(AFTER);

describe('scripts/check-schema-parity.sql', () => {
  it('passes every structural rule', () => {
    expect(auditChecker(checker)).toEqual([]);
  });

  it('states 39 rows: VERDICT, P00 to P26, G1, the two keys and I1 to I8', () => {
    expect(checkerRows).toBe(1 + 27 + 1 + 2 + 8);
  });

  // SA R-7: postgres-owned event triggers move P26 (and so the PARITY KEY),
  // with no new section row. Platform event triggers stay in I5, info only.
  it('P26 has a pg_event_trigger branch for postgres-owned event triggers only (SA R-7)', () => {
    const text = checker.replace(/\r\n?/g, '\n');
    const { code } = scrubSql(text);
    const p26 = blocksOf(text, code).get('P26') ?? '';
    const branch = /SELECT 'P26',\s*format\('event trigger \|[\s\S]*?FROM pg_event_trigger AS evt\s*WHERE ([^\n]*)/.exec(p26);
    expect(branch).not.toBeNull();
    expect(branch?.[1].trim()).toBe("evt.evtowner = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')");
    // The "char" column goes through format(), never ||.
    expect(branch?.[0]).toMatch(/evt\.evtenabled/);
    expect(branch?.[0]).not.toMatch(/\|\|/);
    // No new row: the sections and the 39-row count are unchanged.
    expect(sectionRows(code).map((r) => r.code)).toEqual(SECTION_CODES);
    expect(checkerRows).toBe(39);
  });
});

describe('supabase/baseline/prove-checker-can-fail.psql', () => {
  it('passes every structural rule', () => {
    expect(auditProof(proof, step, checkerRows)).toEqual([]);
  });
});

describe('.gitattributes pins LF on the baseline files', () => {
  const attributes = readRepoFile('.gitattributes').split('\n');
  it.each([[CHECKER], [PROOF], [STEP], [BEFORE], [AFTER]])('%s', (file) => {
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
    // SA R-7: the P26 event trigger branch.
    ['P26: the event trigger branch removed', (s) => s.replace("format('event trigger | ", "format('evt | "), /P26: no pg_event_trigger branch/],
    ['P26: event triggers of every owner', (s) => s.replace("WHERE evt.evtowner = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')", 'WHERE true'), /P26: the event trigger branch is not filtered to owner postgres/],
    ['P26: tags unsorted', (s) => s.replace(/array\(SELECT evt_tag\.tag_name FROM unnest\(evt\.evttags\) AS evt_tag \(tag_name\)\s+ORDER BY evt_tag\.tag_name COLLATE "C"\)/, 'evt.evttags'), /P26: event trigger tags are not sorted/],
    ['P26: tags sorted without COLLATE "C"', (s) => s.replace('ORDER BY evt_tag.tag_name COLLATE "C")', 'ORDER BY evt_tag.tag_name)'), /P26: event trigger tags are not sorted with COLLATE "C"/],
    ['P26: evtenabled joined without ::text', (s) => s.replace("evt.evtenabled, evt.evtfoid::regproc)", "'x' || evt.evtenabled, evt.evtfoid::regproc)"), /planner: .*evtenabled/],
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

  it('deepScrub blanks comments and strings inside a dollar body and keeps its code', () => {
    const sample = "DO $t$\nBEGIN\n  -- on it\n  RAISE EXCEPTION 'from x';\nEND\n$t$;";
    const { code, bare } = deepScrub(sample);
    expect(code.length).toBe(sample.length);
    expect(code).not.toMatch(/on it/);
    expect(code).toContain("'from x'");
    expect(bare).not.toContain('from x');
    expect(bare).toMatch(/BEGIN[\s\S]*RAISE EXCEPTION[\s\S]*END/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DV-3: the apply fragments (T9, T15 to T17 in workplan section 15)
// ───────────────────────────────────────────────────────────────────────────

describe('supabase/baseline/before-schema.sql (T9, T15, T17)', () => {
  it('passes every rule: atomicity, the empty-target guard, pinned extensions, the default-ACL end state', () => {
    expect(auditBeforeSchema(beforeSchema)).toEqual([]);
  });

  // The guard compares against an array sorted COLLATE "C", so the expected
  // list must be in byte order too, or no project could ever pass.
  it('lists staging\'s six event triggers in byte order (SA R-6)', () => {
    expect([...STAGING_EVENT_TRIGGERS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(STAGING_EVENT_TRIGGERS);
  });
});

describe('supabase/baseline/after-schema.sql (T15, T16, T17)', () => {
  it('passes every rule: atomicity, the trigger, the buckets, the initialisation row, the after-dump assertions', () => {
    expect(auditAfterSchema(afterSchema)).toEqual([]);
  });
});

describe('the fragment audits can fail', () => {
  type Mutation = readonly [string, (s: string) => string, RegExp];

  const beforeBreaks: Mutation[] = [
    // SA C-2: atomicity.
    ['the opening SAVEPOINT removed', (s) => s.replace('SAVEPOINT baseline_before_schema;\n', ''), /savepoint: the first statement/],
    ['the RELEASE removed', (s) => s.replace('RELEASE SAVEPOINT baseline_before_schema;\n', ''), /release: the last statement/],
    ['a BEGIN at the top', (s) => s.replace('SAVEPOINT baseline_before_schema;', 'BEGIN;\nSAVEPOINT baseline_before_schema;'), /transaction control BEGIN at the top level/],
    ['a COMMIT before the release', (s) => s.replace('RELEASE SAVEPOINT baseline_before_schema;', 'COMMIT;\nRELEASE SAVEPOINT baseline_before_schema;'), /transaction control COMMIT/],
    ['END on its own', (s) => `${s}END;\n`, /transaction control END at the top level/],
    ['a ROLLBACK inside a DO body', (s) => s.replace('  END LOOP;\nEND\n$neutralise$;', '  END LOOP;\n  ROLLBACK;\nEND\n$neutralise$;'), /transaction control ROLLBACK/],
    ['a \\c reconnect', (s) => s.replace('-- 3. Extensions', '\\c postgres\n-- 3. Extensions'), /psql meta-command/],
    ['a dblink call', (s) => s.replace('-- 3. Extensions', "SELECT dblink_exec('x', 'y');\n-- 3. Extensions"), /autonomous-transaction escape dblink_exec/],
    // SA C-1 and R-6: the guard.
    ['the guard removed', (s) => s.replace(/DO \$guard\$[\s\S]*?\$guard\$;\n/, ''), /guard: no DO \$guard\$ block/],
    ['the guard given an exception handler', (s) => s.replace("|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEND\n$guard$;", "|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$guard$;"), /exception handler/],
    ['the auth.users check removed', (s) => s.replace('IF EXISTS (SELECT 1 FROM auth.users) THEN', 'IF false THEN'), /guard: does not refuse on rows in auth\.users/],
    ['the current_user check removed', (s) => s.replace("IF current_user <> 'postgres' THEN", 'IF false THEN'), /guard: does not refuse on not connected as postgres/],
    ['the pg_graphql check removed', (s) => s.replace("WHERE ext.extname = 'pg_graphql') THEN", "WHERE ext.extname = 'none') THEN"), /guard: does not refuse on pg_graphql/],
    ['the type check removed', (s) => s.replace('WHERE typ.typnamespace = public_oid', 'WHERE false'), /guard: does not refuse on a type in public/],
    ['the census removed', (s) => s.replace("AND dep.refobjid = public_oid\n      AND dep.deptype = 'n'", 'AND false'), /guard: does not refuse on any object in public/],
    // SA DV-3 review F-1: one break for every guard refusal that had none.
    ['the relation check removed', (s) => s.replace('WHERE rel.relnamespace = public_oid', 'WHERE false'), /guard: does not refuse on a relation in public/],
    ['the function check removed', (s) => s.replace('WHERE fn.pronamespace = public_oid', 'WHERE false'), /guard: does not refuse on a function in public/],
    ['the operator_private check removed', (s) => s.replace("WHERE nsp.nspname = 'operator_private') THEN", "WHERE nsp.nspname = 'none') THEN"), /guard: does not refuse on operator_private exists/],
    ['the installed-extensions check removed', (s) => s.replace("WHERE ext.extname IN ('vector', 'btree_gist')) THEN", "WHERE ext.extname IN ('none')) THEN"), /guard: does not refuse on vector or btree_gist installed/],
    ['the auth.users trigger check removed', (s) => s.replace("WHERE trg.tgrelid = 'auth.users'::regclass", 'WHERE trg.tgrelid = 0'), /guard: does not refuse on a trigger on auth\.users/],
    ['the refusal downgraded to a notice', (s) => s.replace('IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE EXCEPTION', 'IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE NOTICE'), /guard: does not refuse on the refusal raises/],
    ['an extension-member exclusion dropped', (s) => s.replace(/\n      AND NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_depend AS dep\n\s+WHERE dep\.classid = 'pg_catalog\.pg_class'::regclass\n\s+AND dep\.objid = rel\.oid AND dep\.deptype = 'e'\)/, ''), /guard: an object check lost its extension-member exclusion/],
    ['a bucket id dropped from the guard', (s) => s.replace("WHERE bkt.id IN ('avatars', ", 'WHERE bkt.id IN ('), /guard: does not refuse on exactly our five bucket ids/],
    ['an event trigger name dropped', (s) => s.replace("'pgrst_ddl_watch', 'pgrst_drop_watch']::text[] THEN", "'pgrst_ddl_watch']::text[] THEN"), /event triggers: the guard expects/],
    ['the automatic-RLS trigger allowed', (s) => s.replace("ARRAY[\n       'issue_graphql_placeholder'", "ARRAY[\n       'ensure_rls', 'issue_graphql_placeholder'"), /event triggers: the guard expects/],
    ['the event trigger names unsorted', (s) => s.replace('ORDER BY evt.evtname::text COLLATE "C"', 'ORDER BY evt.evtname::text'), /guard: does not refuse on event trigger names sorted/],
    // SA R-8: the pins.
    ['vector unpinned', (s) => s.replace("CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.0';", 'CREATE EXTENSION vector WITH SCHEMA public;'), /extensions: expected vector 0\.8\.0/],
    ['btree_gist pinned to another version', (s) => s.replace("btree_gist WITH SCHEMA public VERSION '1.7';", "btree_gist WITH SCHEMA public VERSION '1.8';"), /extensions: expected/],
    ['an extension created IF NOT EXISTS', (s) => s.replace('CREATE EXTENSION vector WITH', 'CREATE EXTENSION IF NOT EXISTS vector WITH'), /silent no-op: IF NOT EXISTS/],
    ['the version assertion removed', (s) => s.replace("AND ext.extversion = '0.8.0'", ''), /extensions: the installed versions are not asserted/],
    ['an ALTER EXTENSION UPDATE added', (s) => s.replace('-- 4a.', 'ALTER EXTENSION vector UPDATE;\n-- 4a.'), /ALTER EXTENSION/],
    // SA A-1: neutralise, then assert the end state.
    ['the neutraliser removed', (s) => s.replace(/DO \$neutralise\$[\s\S]*?\$neutralise\$;\n/, ''), /neutralise: no DO \$neutralise\$ block/],
    ['the neutraliser reaches other roles', (s) => s.replace("WHERE def.defaclrole = (SELECT rol.oid FROM pg_catalog.pg_roles AS rol WHERE rol.rolname = 'postgres')\n      AND nsp.nspname", 'WHERE true\n      AND nsp.nspname'), /neutralise: not for postgres/],
    ['the neutraliser grants', (s) => s.replace('REVOKE ALL ON %s FROM %s', 'GRANT ALL ON %s TO %s'), /neutralise: (not revoking every grantee|it grants)/],
    ['a fixed REVOKE list added', (s) => s.replace('-- 4b.', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;\n-- 4b.'), /a fixed grant list/],
    ['the end-state assertion removed', (s) => s.replace(/DO \$end_state\$[\s\S]*?\$end_state\$;\n/, ''), /end state: no refusal when postgres keeps/],
    ['the global half of the end state removed', (s) => s.replace('AND def.defaclnamespace = 0', 'AND false'), /end state: no refusal when postgres has a global default ACL/],
    // SA DV-3 review F-1, suggested.
    ['the neutraliser limited to public', (s) => s.replace("AND nsp.nspname IN ('public', 'operator_private')\n  LOOP", "AND nsp.nspname IN ('public')\n  LOOP"), /neutralise: not in our schemas/],
    ['the per-schema half of the end state removed', (s) => s.replace("AND nsp.nspname IN ('public', 'operator_private')\n  ) THEN", 'AND false\n  ) THEN'), /end state: no refusal when postgres keeps a default ACL in our schemas/],
    // Order, qualification, the tripwire.
    ['the extensions created before the guard', (s) => s.replace('DO $guard$\n', "CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.0';\nDO $guard$\n").replace(/(\$guard\$;\n[\s\S]*?)CREATE EXTENSION vector WITH SCHEMA public VERSION '0\.8\.0';\n/, '$1'), /order: (extensions runs before guard|a statement changes the project before the guard)/],
    ['an unqualified table', (s) => s.replace('FROM storage.buckets AS bkt', 'FROM buckets AS bkt'), /unqualified name after FROM: buckets/],
    ['a function defined', (s) => s.replace('-- 3. Extensions', 'CREATE FUNCTION public.x() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$;\n-- 3. Extensions'), /defines a function/],
    ['the SECURITY DEFINER phrase in a comment', (s) => s.replace('-- 3. Extensions', '-- security definer\n-- 3. Extensions'), /SECURITY DEFINER guard/],
    ['the psql-only header removed', (s) => s.replace('-- PSQL ONLY. Never paste this file in the Supabase SQL editor', '-- Never paste this file'), /header: does not say psql only/],
  ];

  it.each(beforeBreaks)('before-schema: %s', (_name, mutate, complaint) => {
    const broken = mutate(beforeSchema);
    expect(broken).not.toBe(beforeSchema);
    expect(auditBeforeSchema(broken).join('\n')).toMatch(complaint);
  });

  const afterBreaks: Mutation[] = [
    ['the opening SAVEPOINT removed', (s) => s.replace('SAVEPOINT baseline_after_schema;\n', ''), /savepoint: the first statement/],
    ['the RELEASE removed', (s) => s.replace('RELEASE SAVEPOINT baseline_after_schema;\n', ''), /release: the last statement/],
    ['a ROLLBACK at the end', (s) => `${s}ROLLBACK;\n`, /transaction control ROLLBACK/],
    ['the trigger made BEFORE INSERT', (s) => s.replace('AFTER INSERT ON auth.users', 'BEFORE INSERT ON auth.users'), /trigger: expected exactly/],
    ['the trigger function unqualified', (s) => s.replace('EXECUTE FUNCTION public.create_user_settings()', 'EXECUTE FUNCTION create_user_settings()'), /unqualified name after EXECUTE FUNCTION: create_user_settings/],
    ['a bucket dropped', (s) => s.replace(/  \('business-data-exports'[\s\S]*?ARRAY\['application\/zip'\]::text\[\]\),\n/, ''), /buckets: expected/],
    ['a private bucket made public', (s) => s.replace("('business-purge-snapshots', 'business-purge-snapshots', false,", "('business-purge-snapshots', 'business-purge-snapshots', true,"), /buckets: expected/],
    ['the bucket count removed', (s) => s.replace(/DO \$buckets\$[\s\S]*?\$buckets\$;\n/, ''), /buckets: the five rows are not counted/],
    ['ON CONFLICT added to the bucket insert', (s) => s.replace("ARRAY['application/json']::text[]);", "ARRAY['application/json']::text[])\nON CONFLICT (id) DO NOTHING;"), /silent no-op: ON CONFLICT/],
    ['the initialisation row removed', (s) => s.replace('INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;\n', ''), /bos_cron_run_recording: the initialisation row/],
    ['the initialisation row copied with a value', (s) => s.replace('INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;', "INSERT INTO public.bos_cron_run_recording (id, installed_at) VALUES (1, '2026-01-01');"), /bos_cron_run_recording: the initialisation row/],
    ['the global default ACL assertion removed', (s) => s.replace('AND def.defaclnamespace = 0', 'AND false'), /global default ACLs: no assertion/],
    ['the materialized view assertion removed', (s) => s.replace('AND NOT rel.relispopulated', 'AND false'), /materialized views: no refusal/],
    ['the materialized view message points at after-schema.sql', (s) => s.replace('line at the end of seed-import.psql, after the seed rows and before its RELEASE', 'line for it to after-schema.sql'), /materialized views: the refusal does not send the REFRESH to the end of seed-import\.psql/],
    ['a bucket id that differs from its name', (s) => s.replace("('avatars', 'avatars', true", "('avatars', 'avatar', true"), /buckets: an id differs from its name/],
    ['NOTIFY removed', (s) => s.replace("NOTIFY pgrst, 'reload schema';\n", ''), /NOTIFY/],
    ['an ALTER ROLE added', (s) => s.replace('-- 6. PostgREST', "ALTER ROLE anon SET statement_timeout = '3s';\n-- 6. PostgREST"), /ALTER ROLE/],
    ['a write to operator_private', (s) => s.replace('-- 6. PostgREST', "INSERT INTO operator_private.secrets VALUES ('x');\n-- 6. PostgREST"), /a data statement names operator_private/],
    ['a bucket deleted', (s) => s.replace('-- 6. PostgREST', "DELETE FROM storage.buckets WHERE storage.buckets.id = 'x';\n-- 6. PostgREST"), /a destructive statement DELETE/],
    ['an UPDATE added', (s) => s.replace('-- 6. PostgREST', 'UPDATE storage.buckets SET public = true;\n-- 6. PostgREST'), /a data statement other than the two inserts/],
    ['an exception handler swallowing the bucket count', (s) => s.replace("did not all land';\n  END IF;\nEND\n$buckets$;", "did not all land';\n  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$buckets$;"), /exception handler/],
  ];

  it.each(afterBreaks)('after-schema: %s', (_name, mutate, complaint) => {
    const broken = mutate(afterSchema);
    expect(broken).not.toBe(afterSchema);
    expect(auditAfterSchema(broken).join('\n')).toMatch(complaint);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DV-2, DV-4, DV-5 (seed half): the seed checker, the seed export and import,
// and the seed checker's proof (T8, T18 to T21 in workplan section 15)
// ───────────────────────────────────────────────────────────────────────────

const SEED_CHECKER = 'scripts/check-baseline-seed.sql';
const SEED_EXPORT = 'supabase/baseline/seed-export.psql';
const SEED_IMPORT = 'supabase/baseline/seed-import.psql';
const SEED_PROOF = 'supabase/baseline/prove-seed-checker-can-fail.psql';
const SEED_STEP = 'supabase/baseline/prove-seed-checker-step.psql';

interface SeedTable {
  readonly name: string;
  /** The primary key the export orders by (OQ-5, SA R-2). */
  readonly pk: string;
  /** Columns nulled at the source (SA R-2). A table with any goes through jsonb. */
  readonly nulled: readonly string[];
}

/** The 19 seed tables in load order, parents before children (workplan section 6.1). */
const SEED_TABLES: readonly SeedTable[] = [
  { name: 'ai_model_pricing', pk: 'id', nulled: ['proposal_id', 'proposal_line_id'] },
  { name: 'ais_system_config', pk: 'config_key', nulled: ['updated_by'] },
  { name: 'ais_scoring_weights', pk: 'id', nulled: ['updated_by'] },
  { name: 'ais_normalization_ranges', pk: 'id', nulled: [] },
  { name: 'pricing_config', pk: 'id', nulled: [] },
  { name: 'system_settings_config', pk: 'id', nulled: ['updated_by'] },
  { name: 'memory_config', pk: 'id', nulled: [] },
  { name: 'model_routing_config', pk: 'id', nulled: [] },
  { name: 'boost_packs', pk: 'id', nulled: [] },
  { name: 'storage_plans', pk: 'id', nulled: [] },
  { name: 'reward_config', pk: 'id', nulled: [] },
  { name: 'reward_settings', pk: 'id', nulled: [] },
  { name: 'exchange_rates', pk: 'id', nulled: ['updated_by'] },
  { name: 'capabilities', pk: 'id', nulled: [] },
  { name: 'capability_building_blocks', pk: 'id', nulled: [] },
  { name: 'help_articles', pk: 'id', nulled: [] },
  { name: 'helpbot_page_contexts', pk: 'page_route', nulled: [] },
  { name: 'plugin_semantic_ops', pk: 'id', nulled: [] },
  { name: 'website_archetypes', pk: 'id', nulled: [] },
];
const SEED_NAMES = SEED_TABLES.map((t) => t.name);
/** FK children and their parents (OQ-5): the parent must load first. */
const SEED_PARENTS: ReadonlyArray<readonly [string, string]> = [
  ['capabilities', 'capability_building_blocks'],
  ['reward_config', 'reward_settings'],
];
const SEED_NULLED = SEED_TABLES.flatMap((t) => t.nulled.map((c) => `${t.name}.${c}`));
const SEED_JSONB = SEED_TABLES.filter((t) => t.nulled.length > 0).map((t) => t.name);
const SEED_SEQUENCES = 'ais_scoring_weights.id,help_articles.id';
const SEED_CODES = Array.from({ length: 22 }, (_, i) => `S${pad(i)}`);
const SEED_SETTINGS = ['TimeZone', 'DateStyle', 'IntervalStyle', 'extra_float_digits', 'bytea_output', 'server_encoding'];
/** The settings both seed files pin, so a value reads back as it was written (SA B-9). */
const SEED_CONTEXT_PINS = [
  "SET LOCAL client_encoding = 'UTF8';",
  "SET LOCAL TimeZone = 'UTC';",
  "SET LOCAL DateStyle = 'ISO, MDY';",
  "SET LOCAL IntervalStyle = 'postgres';",
  'SET LOCAL extra_float_digits = 1;',
  "SET LOCAL bytea_output = 'hex';",
];
/** The psql meta-commands the export and import may use, and the only \set lines. */
const SEED_META = ['set', 'pset', 'o', 'ir', 'copy'];
const SEED_SET_LINES = ['\\set ON_ERROR_STOP on', '\\set QUIET on', '\\set QUIET off'];
const ADMIN_USERS_EMPTIED = "(CASE WHEN src.key = 'admin_users' THEN jsonb_set(to_jsonb(src), ARRAY['value'], '[]'::jsonb) ELSE to_jsonb(src) END)";
const subtraction = (cols: readonly string[]) => `- ARRAY[${cols.map((c) => `'${c}'`).join(', ')}]::text[]`;
const quotedList = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const norm = (s: string) => s.replace(/\r\n?/g, '\n');
/** Blank every psql meta-command line, so only SQL is left. Offsets never move. */
const sqlOnly = (s: string) => s.replace(/^[ \t]*\\.*$/gm, (line) => ' '.repeat(line.length));

/** Names after FROM, JOIN, INTO, UPDATE or ON that are not schema-qualified (SA C-4). */
function unqualifiedNames(sql: string): string[] {
  const refs = /\b(FROM|JOIN|INTO|UPDATE|ON|EXECUTE\s+FUNCTION|MATERIALIZED\s+VIEW)\s+(?:LATERAL\s+|ONLY\s+)?([A-Za-z_"][\w$"]*(?:\s*\.\s*[A-Za-z_"][\w$"]*)?)/gi;
  const found: string[] = [];
  for (const m of sql.matchAll(refs)) {
    if (/^ARRAY$/i.test(m[2])) continue;
    if (!m[2].includes('.')) found.push(`${squash(m[1])} ${m[2]}`);
  }
  return found;
}

/** Rules every seed psql file keeps: hygiene, the meta-command allow-list, no escape hatch. */
function seedPsqlProblems(text: string, deep: Scrubbed, allowed: readonly string[], setLines: readonly string[] | null): string[] {
  const problems: string[] = [];
  if (/security\s+definer/i.test(text)) problems.push('SECURITY DEFINER guard: the phrase appears');
  if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(text)) problems.push('defines a function');
  if (!isAscii(text)) problems.push('a non-ASCII character');
  if (!/^-- PSQL ONLY\. Never paste this file in the Supabase SQL editor/m.test(text) || !/standalone word "into"/.test(text)) {
    problems.push('header: does not say psql only and name the editor word problem');
  }
  for (const m of deep.bare.matchAll(/\\([A-Za-z]+|[^A-Za-z\s])/g)) {
    if (!allowed.includes(m[1])) problems.push(`psql meta-command \\${m[1]} is not on the allow-list`);
  }
  if (setLines) {
    for (const m of deep.bare.matchAll(/^[ \t]*\\set\b.*$/gm)) {
      if (!setLines.includes(m[0].trim())) problems.push(`psql: ${m[0].trim()} is not one of the allowed \\set lines`);
    }
  }
  const remote = deep.code.match(/\b(dblink\w*|pg_background\w*)\b/gi);
  if (remote) problems.push(`an autonomous-transaction escape ${[...new Set(remote)].join(', ')}`);
  if (/\boperator_private\b/i.test(deep.code)) problems.push('names operator_private');
  return problems;
}

// ── The seed checker (DV-2) ────────────────────────────────────────────────

interface SeedSectionRow {
  readonly sortOrder: number;
  readonly code: string;
  readonly title: string;
  readonly kind: string;
  readonly display: string;
}

function seedSectionRows(code: string): SeedSectionRow[] {
  const start = code.indexOf('sections (sort_order, code, title, kind, display) AS (');
  if (start === -1) return [];
  const body = code.slice(start, closeParen(code, code.indexOf('(', code.indexOf('AS (', start))));
  return [...body.matchAll(/\((\d+), '(S[0-9]+)', '([^']*)', '([a-z]+)', '([a-z]+)'\)/g)].map((m) => ({
    sortOrder: Number(m[1]),
    code: m[2],
    title: m[3],
    kind: m[4],
    display: m[5],
  }));
}

/** Every problem found in the seed checker text. The real file must return []. */
export function auditSeedChecker(raw: string): string[] {
  const text = norm(raw);
  const problems: string[] = [];
  const { code, bare } = scrubSql(text);
  const blocks = blocksOf(text, code);

  // Read-only, one statement, and no transaction control: the import runs it
  // inside the apply transaction, and U5r inside an outer BEGIN ... ROLLBACK.
  const firstLine = code.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine !== 'SET default_transaction_read_only = on;') {
    problems.push('read-only: the first statement is not SET default_transaction_read_only = on;');
  }
  const sets = bare.match(/\bSET\b/gi) ?? [];
  if (sets.length !== 1) problems.push(`read-only: expected exactly 1 SET statement, found ${sets.length}`);
  const writes = bare.match(
    /\b(insert|update|delete|merge|create|alter|drop|grant|revoke|truncate|copy|comment|vacuum|analyze|reindex|cluster|lock|call|do|execute|prepare|refresh|reset|begin|commit|rollback|abort|savepoint|release|listen|notify|import|security)\b/gi,
  );
  if (writes) problems.push(`write or transaction keyword outside comments and strings: ${[...new Set(writes)].join(', ')}`);
  if (/client_min_messages/i.test(code)) problems.push('warnings: client_min_messages is set (warnings must stay visible)');

  // Paste safety and the SECURITY DEFINER tripwire (whole text, comments included).
  if (/\binto\b/i.test(text)) problems.push('paste safety: the word into appears');
  if (/security\s+definer/i.test(text)) problems.push('SECURITY DEFINER guard: the phrase appears');
  if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(text)) problems.push('creates a function');
  if (!isAscii(text)) problems.push('paste safety: a non-ASCII character');
  if (/^[ \t]*\\/m.test(code)) problems.push('paste safety: a psql meta-command');
  const oneLetter = bare.match(/\bAS\s+[A-Za-z](?![A-Za-z0-9_])/g);
  if (oneLetter) problems.push(`paste safety: single-letter alias ${oneLetter.join(', ')}`);
  for (const hit of uncastCharConcats(code)) problems.push(`planner: "char" column joined with || without ::text: ${hit}`);
  if (/\boperator_private\b/i.test(code)) problems.push('names operator_private');

  // Sections: S00 context, S01 to S19 the seed tables in load order, S20, S21.
  const rows = seedSectionRows(code);
  if (JSON.stringify(rows.map((r) => r.code)) !== JSON.stringify(SEED_CODES)) {
    problems.push(`sections: expected ${SEED_CODES.join(',')} got ${rows.map((r) => r.code).join(',')}`);
  }
  rows.forEach((r, k) => {
    if (r.sortOrder <= 0) problems.push(`sections: ${r.code} sorts at or before VERDICT`);
    if (k > 0 && r.sortOrder <= rows[k - 1].sortOrder) problems.push(`sections: ${r.code} out of order`);
  });
  const want = (c: string, kind: string, display: string) => {
    const row = rows.find((r) => r.code === c);
    if (!row || row.kind !== kind || row.display !== display) problems.push(`sections: ${c} is not ${kind} / ${display}`);
  };
  want('S00', 'context', 'value');
  want('S20', 'single', 'rows');
  want('S21', 'sequence', 'value');
  SEED_TABLES.forEach((t, k) => {
    const c = `S${pad(k + 1)}`;
    want(c, 'seed', 'count');
    const title = rows.find((r) => r.code === c)?.title;
    if (title !== t.name) problems.push(`sections: ${c} is titled ${title ?? 'nothing'}, the load order says ${t.name}`);

    // T8 / SA R-2, R-3: the row as to_jsonb, minus exactly the nulled columns.
    const block = blocks.get(c) ?? '';
    if (!new RegExp(`FROM public\\.${t.name} AS src\\b`).test(block)) problems.push(`${c}: does not read public.${t.name}`);
    if (!block.includes('to_jsonb(src)')) problems.push(`${c}: does not hash the row as to_jsonb`);
    const minus = [...block.matchAll(/- ARRAY\[[^\]]*\]::text\[\]/g)].map((m) => m[0]);
    const expected = t.nulled.length ? [subtraction(t.nulled)] : [];
    if (JSON.stringify(minus) !== JSON.stringify(expected)) {
      problems.push(`${c}: subtracts ${minus.join(' ') || 'nothing'}, expected ${expected.join(' ') || 'nothing'} (SA R-2)`);
    }
  });
  if (!squash(blocks.get('S06') ?? '').includes(ADMIN_USERS_EMPTIED.replace(/^\(|\)$/g, ''))) {
    problems.push('S06: the admin_users key is not emptied the way the export empties it (SA R-3)');
  }

  // S20: existence only, never the content (OQ-15 class b).
  const s20 = blocks.get('S20') ?? '';
  if (!/SELECT 'S20', 'initialisation row', true\s+FROM public\.bos_cron_run_recording AS src/.test(s20) || s20.includes('to_jsonb')) {
    problems.push('S20: not a constant line per bos_cron_run_recording row');
  }
  if (!/WHEN summary\.kind = 'single' THEN CASE WHEN summary\.line_count = 1 THEN 'PASS' ELSE 'FAIL' END/.test(code)) {
    problems.push('S20: the single row is not gated at exactly one');
  }

  // S21: both serial sequences clear, and no other owned sequence (SA R-2).
  const s21 = squash(blocks.get('S21') ?? '');
  for (const t of ['ais_scoring_weights', 'help_articles']) {
    if (!s21.includes(`(SELECT max(src.id) FROM public.${t} AS src)::bigint, pg_sequence_last_value(pg_get_serial_sequence('public.${t}', 'id')::regclass)`)) {
      problems.push(`S21: the ${t} sequence is not checked against its highest id`);
    }
  }
  if (!s21.includes('coalesce(seq_check.last_used, 0) >= coalesce(seq_check.max_id, 0) FROM')) {
    problems.push('S21: the collision gate is not the line gate');
  }
  if (!s21.includes(`coalesce(owned.column_list, 'none') = '${SEED_SEQUENCES}'`)) problems.push('S21: the owned-sequence list is not pinned');
  const inList = /AND tbl\.relname IN \(([^)]*)\)/.exec(blocks.get('S21') ?? '');
  if (JSON.stringify(quotedList(inList?.[1] ?? '')) !== JSON.stringify(SEED_NAMES)) problems.push('S21: the owned-sequence scan does not cover exactly the 19 seed tables');
  if (!/WHEN summary\.line_count > 0 AND summary\.gates_ok THEN 'PASS'/.test(code)) problems.push('gates: a section passes without its line gates');

  // Only the seed tables and the initialisation table are read.
  const read = new Set([...code.matchAll(/\bpublic\.([A-Za-z_]+)\b/g)].map((m) => m[1]));
  for (const name of read) {
    if (!SEED_NAMES.includes(name) && name !== 'bos_cron_run_recording') problems.push(`reads public.${name}, which is not seed`);
  }

  // Context, determinism and the keys (SA B-9).
  const s00 = blocks.get('S00') ?? '';
  for (const s of SEED_SETTINGS) if (!s00.includes(`current_setting('${s}')`)) problems.push(`S00: ${s} is missing`);
  if (!/string_agg\(seed_lines\.line, chr\(10\) ORDER BY seed_lines\.line COLLATE "C"\)/.test(code)) {
    problems.push('determinism: seed lines are not sorted COLLATE "C" before hashing');
  }
  const report = blocks.get('report') ?? '';
  if (!/SELECT 0 AS sort_order, 'VERDICT'::text AS check_name/.test(report)) problems.push('VERDICT is not the first report row at sort order 0');
  if (!/'CONTEXT KEY'[\s\S]*?WHERE graded\.code = 'S00'\)/.test(report)) problems.push('CONTEXT KEY: not the S00 hash');
  if (!/'SEED KEY'[\s\S]*?WHERE graded\.kind = 'seed'\)/.test(report)) problems.push('SEED KEY: not computed over the seed tables only');
  if (!/ORDER BY report\.sort_order;\s*$/.test(code)) problems.push('report: not ordered by sort_order');

  const stated = /Returns exactly (\d+) rows/.exec(text);
  if (!stated || Number(stated[1]) !== 1 + rows.length + 2) {
    problems.push(`row count: header states ${stated?.[1] ?? 'nothing'}, sections give ${1 + rows.length + 2}`);
  }
  return problems;
}

// ── The seed export (DV-4) ─────────────────────────────────────────────────

export function auditSeedExport(raw: string): string[] {
  const text = norm(raw);
  const top = scrubSql(text);
  const deep = deepScrub(text);
  const problems = seedPsqlProblems(text, deep, SEED_META, SEED_SET_LINES);
  const sql = sqlOnly(top.bare);

  if (text.split('\n').find((l) => l.trim() && !l.startsWith('--')) !== '\\set ON_ERROR_STOP on') {
    problems.push('psql: the first command is not \\set ON_ERROR_STOP on');
  }
  if (!/^-- NEVER PART OF U5r OR U5\./m.test(text)) problems.push('header: does not say it is never part of the U5r or U5 file list');
  if (/client_min_messages/i.test(deep.code)) problems.push('warnings: client_min_messages is set (warnings must stay visible)');

  // Its own read-only snapshot, and nothing that writes or commits.
  const control = [...sql.matchAll(/^[ \t]*(BEGIN|COMMIT|END|ABORT|START TRANSACTION|ROLLBACK)\b([^;\n]*);/gim)].map((m) => squash(`${m[1]}${m[2]}`).toUpperCase());
  if (JSON.stringify(control) !== JSON.stringify(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK'])) {
    problems.push(`transaction: expected BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY then ROLLBACK, found ${control.join(', ') || 'none'}`);
  }
  const hatches = deep.bare.match(/\b(COMMIT|ABORT|PREPARE\s+TRANSACTION|SAVEPOINT|RELEASE)\b/gi);
  if (hatches) problems.push(`transaction control ${[...new Set(hatches.map(squash))].join(', ')}`);
  const writes = deep.bare.match(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|REFRESH|LOCK|CALL|VACUUM)\b/gi);
  if (writes) problems.push(`a write statement ${[...new Set(writes)].join(', ')}`);

  // SA B-9: the same pins as the import, inside the transaction, before the guard.
  const at = (s: string) => text.indexOf(s);
  const begin = at('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
  const guardAt = at('DO $guard$');
  for (const pin of SEED_CONTEXT_PINS) {
    const p = at(pin);
    if (p === -1 || p < begin || p > guardAt) problems.push(`context: ${pin} is not pinned between BEGIN and the guard`);
  }

  // The guard: no handler, and every refusal.
  const guard = doBlock(deep.code, 'guard');
  if (!guard) problems.push('guard: no DO $guard$ block');
  if (/\bEXCEPTION\s+WHEN\b/i.test(guard)) problems.push('guard: it has an exception handler');
  const pkRows = [...(/FROM \(VALUES([\s\S]*?)\) AS want \(table_name, pk_column\)/.exec(guard)?.[1] ?? '').matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
  if (JSON.stringify(pkRows) !== JSON.stringify(SEED_TABLES.map((t) => `${t.name}:${t.pk}`))) problems.push('guard: the primary-key list is not the 19 seed tables and their keys');
  const arrayOf = (name: string) => quotedList(new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]*)\\]::text\\[\\];`).exec(guard)?.[1] ?? '');
  if (JSON.stringify(arrayOf('seed_tables')) !== JSON.stringify(SEED_NAMES)) problems.push('guard: seed_tables is not the 19 seed tables');
  if (JSON.stringify(arrayOf('nulled_columns')) !== JSON.stringify(SEED_NULLED)) problems.push('guard: nulled_columns is not the six nulled columns (SA R-2)');
  if (JSON.stringify(arrayOf('jsonb_copied')) !== JSON.stringify(SEED_JSONB)) problems.push('guard: jsonb_copied is not the tables with nulled columns');
  const guardRules: ReadonlyArray<readonly [string, RegExp]> = [
    ['its own read-only transaction', /current_setting\('transaction_read_only'\) <> 'on'\s+OR pg_catalog\.current_setting\('transaction_isolation'\) <> 'repeatable read' THEN/],
    ['a missing table or another primary key', /WHERE pg_catalog\.to_regclass\('public\.' \|\| want\.table_name\) IS NULL\s+OR[\s\S]*?idx\.indisprimary\) IS DISTINCT FROM want\.pk_column/],
    ['a nulled column that does not exist', /FROM pg_catalog\.unnest\(nulled_columns\) AS want \(qualified\)\s+WHERE NOT EXISTS/],
    ['a foreign key out of the seed set', /WHERE con\.contype = 'f'[\s\S]*?<> ALL \(nulled_columns\)\)/],
    ['a settings value that is not jsonb', /att\.attname = 'value'\s+AND att\.atttypid = 'pg_catalog\.jsonb'::pg_catalog\.regtype/],
    ['a generated or identity column', /AND \(att\.attgenerated <> '' OR att\.attidentity <> ''\)/],
    ['a json column copied through jsonb', /rel\.relname::text = ANY \(jsonb_copied\)[\s\S]*?'pg_catalog\.json'::pg_catalog\.regtype/],
    ['the refusal raises', /IF pg_catalog\.cardinality\(refusals\) > 0 THEN\s+RAISE EXCEPTION/],
  ];
  for (const [name, rule] of guardRules) if (!rule.test(guard)) problems.push(`guard: does not refuse on ${name}`);

  // T8: the 19 copies, in load order, each ordered by its key, the nulled
  // columns nulled at the source and the admin_users key emptied.
  const copyLines = text.split('\n').filter((l) => /^\\copy\b/.test(l));
  const shape = /^\\copy \(SELECT (rec|src)\.\* FROM public\.(\w+) AS src(.*) ORDER BY src\.(\w+)::text COLLATE "C"\) TO 'seed-([\w]+)\.csv' WITH \(FORMAT csv, HEADER\)$/;
  const parsed = copyLines.map((l) => shape.exec(l));
  if (parsed.some((m) => !m)) problems.push('copy: a \\copy line is not a read of one seed table to its own file');
  const order = parsed.map((m) => m?.[2] ?? '?');
  if (JSON.stringify(order) !== JSON.stringify(SEED_NAMES)) problems.push(`copy: expected the 19 seed tables in load order, found ${order.join(',')}`);
  for (const [parent, child] of SEED_PARENTS) {
    if (order.indexOf(parent) > order.indexOf(child)) problems.push(`copy: ${child} comes before its parent ${parent}`);
  }
  parsed.forEach((m) => {
    if (!m) return;
    const t = SEED_TABLES.find((s) => s.name === m[2]);
    if (!t) return;
    if (m[5] !== t.name) problems.push(`copy: ${t.name} is written to seed-${m[5]}.csv`);
    if (m[4] !== t.pk) problems.push(`copy: ${t.name} is ordered by ${m[4]}, not its primary key ${t.pk}`);
    if (t.nulled.length === 0) {
      if (m[1] !== 'src' || m[3] !== '') problems.push(`copy: ${t.name} is not copied as it is`);
      return;
    }
    const source = t.name === 'system_settings_config' ? `${ADMIN_USERS_EMPTIED} ` : 'to_jsonb(src) ';
    const lateral = ` CROSS JOIN LATERAL jsonb_populate_record(NULL::public.${t.name}, ${source}${subtraction(t.nulled)}) AS rec`;
    if (m[1] !== 'rec' || m[3] !== lateral) problems.push(`copy: ${t.name} does not null exactly ${t.nulled.join(', ')} at the source${t.name === 'system_settings_config' ? ' and empty the admin_users key' : ''}`);
  });

  // The checker, in the same snapshot, after the last copy and before the ROLLBACK.
  const run = /\\set QUIET on\n\\pset format csv\n\\pset tuples_only on\n\\o seed-check-export\.csv\n\\ir \.\.\/\.\.\/scripts\/check-baseline-seed\.sql\n\\o\n/.exec(text);
  const lastCopy = text.lastIndexOf('\n\\copy ');
  const rollback = text.search(/^ROLLBACK;$/m);
  if (!run) problems.push('checker: the export does not write the seed checker rows to seed-check-export.csv');
  else if (run.index < lastCopy || run.index > rollback) problems.push('checker: not run after the last copy and before the ROLLBACK');
  if (begin === -1 || guardAt < begin || text.indexOf('\n\\copy ') < guardAt) problems.push('order: the guard does not run inside the transaction before the first copy');
  return problems;
}

// ── The seed import (DV-4), a U5 fragment ──────────────────────────────────

export function auditSeedImport(raw: string, checkerRows: number): string[] {
  const text = norm(raw);
  const top = scrubSql(text);
  const deep = deepScrub(text);
  const problems = seedPsqlProblems(text, deep, SEED_META, SEED_SET_LINES);
  const sqlTop = sqlOnly(top.bare);
  const sqlDeep = sqlOnly(deep.bare);

  if (text.split('\n').find((l) => l.trim() && !l.startsWith('--')) !== '\\set ON_ERROR_STOP on') {
    problems.push('psql: the first command is not \\set ON_ERROR_STOP on');
  }
  // SA C-2: the savepoint precondition, and no transaction control anywhere
  // (U5r wraps the run in an outer BEGIN ... ROLLBACK).
  const statements = sqlTop.split(';').map(squash).filter((s) => s.length > 0);
  if (statements[0] !== 'SAVEPOINT baseline_seed_import') problems.push(`savepoint: the first statement is not SAVEPOINT baseline_seed_import (found ${statements[0] ?? 'nothing'})`);
  if (statements[statements.length - 1] !== 'RELEASE SAVEPOINT baseline_seed_import') problems.push('release: the last statement is not RELEASE SAVEPOINT baseline_seed_import');
  const opens = statements.filter((s) => /^SAVEPOINT\b/i.test(s)).length;
  const releases = statements.filter((s) => /^RELEASE\b/i.test(s)).length;
  if (opens !== 1 || releases !== 1) problems.push(`savepoint: ${opens} opened and ${releases} released, expected 1 and 1`);
  const control = sqlDeep.match(/\b(COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/gi);
  if (control) problems.push(`transaction control ${[...new Set(control.map(squash))].join(', ')}`);
  const blocks = sqlTop.match(/\b(BEGIN|END)\b/gi);
  if (blocks) problems.push(`transaction control ${[...new Set(blocks)].join(', ')} at the top level`);
  if (/client_min_messages/i.test(deep.code)) problems.push('warnings: client_min_messages is set (warnings must stay visible)');

  // Nothing silent, nothing granted, nothing destroyed, no trigger disabled (SA C-1, A-1, R-2, R-4).
  const silent = sqlTop.match(/\bIF\s+NOT\s+EXISTS\b|\bON\s+CONFLICT\b|\bOR\s+REPLACE\b/gi);
  if (silent) problems.push(`silent no-op: ${[...new Set(silent.map(squash))].join(', ')}`);
  if (/\bEXCEPTION\s+WHEN\b/i.test(deep.code)) problems.push('a DO block has an exception handler, so its refusal could be swallowed');
  const grants = sqlDeep.match(/\b(GRANT|REVOKE|ALTER\s+DEFAULT\s+PRIVILEGES|ALTER\s+ROLE|ALTER\s+EXTENSION)\b/gi);
  if (grants) problems.push(`a grant or role change: ${[...new Set(grants.map(squash))].join(', ')}`);
  const destroys = sqlDeep.match(/\b(DELETE|TRUNCATE|DROP|INSERT|UPDATE)\b/gi);
  if (destroys) problems.push(`a data statement other than \\copy: ${[...new Set(destroys)].join(', ')}`);
  if (/\b(DISABLE|ENABLE)\s+TRIGGER\b/i.test(sqlDeep) || /session_replication_role/i.test(deep.code)) problems.push('a trigger is switched (SA R-2: none is disabled)');
  for (const hit of unqualifiedNames(sqlDeep)) problems.push(`unqualified name after ${hit}`);

  if (!/^SET LOCAL lock_timeout = '10s';$/m.test(text)) problems.push('lock timeout: SET LOCAL lock_timeout is not set');
  const guardAt = text.indexOf('DO $guard$');
  for (const pin of SEED_CONTEXT_PINS) {
    const p = text.indexOf(pin);
    if (p === -1 || p > guardAt) problems.push(`context: ${pin} is not pinned before the guard`);
  }

  // The guard.
  const guard = doBlock(deep.code, 'guard');
  if (!guard) problems.push('guard: no DO $guard$ block');
  const seedArray = quotedList(/seed_tables text\[\] := ARRAY\[([^\]]*)\]::text\[\];/.exec(guard)?.[1] ?? '');
  if (JSON.stringify(seedArray) !== JSON.stringify(SEED_NAMES)) problems.push('guard: seed_tables is not the 19 seed tables');
  const guardRules: ReadonlyArray<readonly [string, RegExp]> = [
    ['not connected as postgres', /IF current_user <> 'postgres' THEN/],
    ['rows in auth.users', /IF EXISTS \(SELECT 1 FROM auth\.users\) THEN/],
    ['an export that is not 25 passing rows', new RegExp(`FROM pg_temp\\.seed_check_export\\) <> ${checkerRows}\\s+OR NOT EXISTS[\\s\\S]*?exported\\.check_name = 'VERDICT' AND exported\\.result = 'PASS'\\) THEN`)],
    ['a missing seed table', /rel\.relname::text = ANY \(seed_tables\)\) <> 19 THEN/],
    ['a seed table that is not empty', /AND pg_catalog\.pg_relation_size\(rel\.oid\) > 0/],
    ['a generated or identity column', /AND \(att\.attgenerated <> '' OR att\.attidentity <> ''\)/],
    ['a user trigger firing on INSERT', /AND NOT trg\.tgisinternal\s+AND \(trg\.tgtype & 4\) <> 0/],
    ['other owned sequences', new RegExp(`IF owned_list IS DISTINCT FROM '${SEED_SEQUENCES}' THEN`)],
    ['the refusal raises', /IF pg_catalog\.cardinality\(refusals\) > 0 THEN\s+RAISE EXCEPTION/],
  ];
  for (const [name, rule] of guardRules) if (!rule.test(guard)) problems.push(`guard: does not refuse on ${name}`);

  // T8: the 19 loads in order, each from its own file, header matched.
  const loads = text.split('\n').filter((l) => /^\\copy public\./.test(l));
  const parsed = loads.map((l) => /^\\copy public\.(\w+) FROM 'seed-(\w+)\.csv' WITH \(FORMAT csv, HEADER MATCH\)$/.exec(l));
  if (parsed.some((m) => !m || m[1] !== m[2])) problems.push('load: a \\copy is not one seed table from its own file with HEADER MATCH');
  const order = parsed.map((m) => m?.[1] ?? '?');
  if (JSON.stringify(order) !== JSON.stringify(SEED_NAMES)) problems.push(`load: expected the 19 seed tables in load order, found ${order.join(',')}`);
  for (const [parent, child] of SEED_PARENTS) {
    if (order.indexOf(parent) > order.indexOf(child)) problems.push(`load: ${child} loads before its parent ${parent}`);
  }

  // Order: export rows, guard, loads, sequences, checker, comparison, REFRESH slot, release.
  const exportLoad = text.indexOf("\\copy pg_temp.seed_check_export (check_name, result, detail) FROM 'seed-check-export.csv' WITH (FORMAT csv)");
  const firstLoad = text.indexOf('\n\\copy public.');
  const lastLoad = text.lastIndexOf('\n\\copy public.');
  const sequences = doBlock(deep.code, 'sequences');
  const sequencesAt = text.indexOf('DO $sequences$');
  const checkerRun = /\\set QUIET on\n\\pset format csv\n\\pset tuples_only on\n\\o seed-check-import\.csv\n\\ir \.\.\/\.\.\/scripts\/check-baseline-seed\.sql\n\\o\n/.exec(text);
  const importLoad = text.indexOf("\\copy pg_temp.seed_check_import (check_name, result, detail) FROM 'seed-check-import.csv' WITH (FORMAT csv)");
  const proofAt = text.indexOf('DO $seed_proof$');
  const refreshAt = text.search(/^-- REFRESH MATERIALIZED VIEW line here, after the seed rows and before the$/m);
  const releaseAt = text.search(/^RELEASE SAVEPOINT baseline_seed_import;$/m);
  const steps: ReadonlyArray<readonly [string, number]> = [
    ['the export rows loaded', exportLoad],
    ['the guard', guardAt],
    ['the first load', firstLoad],
    ['the last load', lastLoad],
    ['the sequences set', sequencesAt],
    ['the checker run', checkerRun?.index ?? -1],
    ['this project\'s rows loaded', importLoad],
    ['the comparison', proofAt],
    ['the REFRESH slot (SA DV-3 ruling 7)', refreshAt],
    ['the release', releaseAt],
  ];
  steps.forEach(([name, pos], k) => {
    if (pos === -1) problems.push(`order: ${name} not found`);
    else if (k > 0 && steps[k - 1][1] !== -1 && pos <= steps[k - 1][1]) problems.push(`order: ${name} runs before ${steps[k - 1][0]}`);
  });

  // SA R-2: the two serial sequences, set to the highest id loaded.
  for (const t of ['ais_scoring_weights', 'help_articles']) {
    if (!squash(sequences).includes(`PERFORM pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.${t}', 'id'), (SELECT pg_catalog.max(src.id) FROM public.${t} AS src));`)) {
      problems.push(`sequences: ${t} is not set to its highest id`);
    }
  }

  // The comparison with the export: the run of record.
  const proof = doBlock(deep.code, 'seed_proof');
  const proofRules: ReadonlyArray<readonly [string, RegExp]> = [
    ['this project not 25 passing rows', new RegExp(`FROM pg_temp\\.seed_check_import\\) <> ${checkerRows}\\s+OR NOT EXISTS[\\s\\S]*?imported\\.result = 'PASS'\\) THEN\\s+RAISE EXCEPTION`)],
    ['a different context (VOID)', /imported\.check_name = 'CONTEXT KEY'\)\s+IS DISTINCT FROM\s+\(SELECT exported\.detail FROM pg_temp\.seed_check_export AS exported WHERE exported\.check_name = 'CONTEXT KEY'\) THEN\s+RAISE EXCEPTION/],
    ['any row that differs', /FULL JOIN pg_temp\.seed_check_export AS exported ON exported\.check_name = imported\.check_name\s+WHERE imported\.result IS DISTINCT FROM exported\.result\s+OR imported\.detail IS DISTINCT FROM exported\.detail\);\s+IF differing IS NOT NULL THEN\s+RAISE EXCEPTION/],
  ];
  if (!proof) problems.push('comparison: no DO $seed_proof$ block');
  for (const [name, rule] of proofRules) if (!rule.test(proof)) problems.push(`comparison: does not refuse on ${name}`);
  return problems;
}

// ── The seed checker's proof (DV-5, seed half: F6) ─────────────────────────

export function auditSeedProof(raw: string, step: string, checkerRows: number): string[] {
  const text = norm(raw);
  const stepText = norm(step);
  const problems: string[] = [];
  const { code, bare } = scrubSql(text);
  const stepScrub = scrubSql(stepText);

  for (const [name, body] of [['proof', text], ['step', stepText]] as const) {
    if (/security\s+definer/i.test(body)) problems.push(`${name}: the SECURITY DEFINER phrase appears`);
    if (/\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i.test(body)) problems.push(`${name}: defines a function`);
    if (!isAscii(body)) problems.push(`${name}: a non-ASCII character`);
  }
  if (!/^-- PSQL ONLY\. Never paste this file in the Supabase SQL editor/m.test(text)) problems.push('proof: the header does not say psql only');
  // SA S-3: its ROLLBACK would end the apply transaction.
  if (!/^-- NEVER PART OF U5r OR U5\. This file is never in the file list of the$/m.test(text)) {
    problems.push('proof: the header does not say it is never part of the U5r or U5 file list');
  }

  // One transaction at a time, always rolled back, never committed.
  const control = [...bare.matchAll(/^[ \t]*(BEGIN|COMMIT|END|ABORT|START TRANSACTION|ROLLBACK)\b([^;\n]*);/gim)]
    .map((m) => `${m[1].toUpperCase()}${m[2]}`.trim())
    .filter((t) => !/^ROLLBACK TO SAVEPOINT/i.test(t))
    .map((t) => t.split(' ')[0]);
  if (JSON.stringify(control) !== JSON.stringify(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK'])) {
    problems.push(`transaction: expected BEGIN, ROLLBACK, BEGIN, ROLLBACK and found ${control.join(', ')}`);
  }
  for (const [name, live, withStrings] of [['proof', bare, code], ['step', stepScrub.bare, stepScrub.code]] as const) {
    const ends = (live.match(/\bEND\b/gi) ?? []).length;
    const cases = (live.match(/\bCASE\b/gi) ?? []).length;
    const hatch = live.match(/\b(COMMIT|ABORT|PREPARE\s+TRANSACTION|COMMIT\s+PREPARED)\b/gi);
    if (hatch) problems.push(`${name}: transaction control ${[...new Set(hatch)].join(', ')}`);
    if (ends > cases) problems.push(`${name}: an END that closes no CASE (${ends} END, ${cases} CASE)`);
    const remote = withStrings.match(/\b(dblink\w*|pg_background\w*)\b/gi);
    if (remote) problems.push(`${name}: an autonomous-transaction escape ${[...new Set(remote)].join(', ')}`);
    for (const m of live.matchAll(/\\([A-Za-z]+|[^A-Za-z\s])/g)) {
      if (!ALLOWED_META.includes(m[1])) problems.push(`${name}: psql meta-command \\${m[1]} is not on the allow-list`);
    }
    if (/\b(GRANT|REVOKE|ALTER\s+ROLE)\b/i.test(withStrings)) problems.push(`${name}: grants or names a role`);
  }

  // The staging guard and the lock timeout come before the first savepoint.
  const firstBegin = code.indexOf('BEGIN READ WRITE;');
  const firstSavepoint = code.search(/^SAVEPOINT seed_proof_step;$/m);
  const opening = firstBegin === -1 || firstSavepoint === -1 ? '' : code.slice(firstBegin, firstSavepoint);
  const guard = /DO \$guard\$([\s\S]*?)\$guard\$;/.exec(opening)?.[1] ?? '';
  if (!/IF EXISTS \(SELECT 1 FROM auth\.users\) THEN\s+RAISE EXCEPTION/.test(guard)) {
    problems.push('staging guard: no DO block refusing a project with rows in auth.users before the first step');
  }
  if (/\bEXCEPTION\s+WHEN\b/i.test(guard)) problems.push('staging guard: it has an exception handler, so it could not stop the run');
  if (!/^SET LOCAL lock_timeout = '3s';$/m.test(opening)) problems.push('lock timeout: SET LOCAL lock_timeout is not set before the first step');
  const quietOpens = (code.match(/^BEGIN READ WRITE;\n(?:[ \t]*\n)*(?:--[^\n]*\n)*SET client_min_messages = error;$/gm) ?? []).length;
  if (quietOpens !== 2) problems.push(`notices: ${quietOpens} of 2 transactions set client_min_messages = error`);

  const opened = (code.match(/^SAVEPOINT seed_proof_step;$/gm) ?? []).length;
  const undone = (code.match(/^ROLLBACK TO SAVEPOINT seed_proof_step;$/gm) ?? []).length;
  const released = (code.match(/^RELEASE SAVEPOINT seed_proof_step;$/gm) ?? []).length;
  if (opened === 0 || opened !== undone || opened !== released) problems.push(`savepoints: ${opened} opened, ${undone} rolled back, ${released} released`);

  // Every step is expected, run and summarised.
  const runs = [...code.matchAll(/^SET seed_proof\.run = '(\w+)';$/gm)].map((m) => m[1]);
  const expected = [...code.matchAll(/^\s+\('(\w+)', '([^']*)', ARRAY/gm)].map((m) => ({ e: m[1], target: m[2] }));
  const summarised = [...code.matchAll(/\(\d+, '(\w+)', :'res_(\w+)'\)/g)].map((m) => ({ e: m[1], v: m[2] }));
  const wanted = [...expected.map((x) => x.e), 'AFTER'];
  if (JSON.stringify([...runs].sort()) !== JSON.stringify([...wanted].sort())) problems.push(`steps: run labels ${runs.join(',')} do not match the expectations plus AFTER`);
  if (new Set(runs).size !== runs.length) problems.push('steps: a run label is used twice');
  if (JSON.stringify(summarised.map((s) => s.e)) !== JSON.stringify(runs)) problems.push(`summary: lists ${summarised.map((s) => s.e).join(',')} but the run is ${runs.join(',')}`);
  for (const s of summarised) {
    if (s.v !== s.e.toLowerCase()) problems.push(`summary: ${s.e} reads res_${s.v}`);
    if (!new RegExp(`(\\\\set res_${s.v} :step_result|AS res_${s.v}\\b)`).test(code)) problems.push(`summary: res_${s.v} is never set`);
  }

  // Coverage: the context, a content change (F6), a removed row, and both gates.
  const targets = new Set(expected.map((x) => x.target.split(' ')[0]));
  for (const c of ['S00', 'S16', 'S19', 'S20', 'S21']) if (!targets.has(c)) problems.push(`coverage: no deliberate change targets ${c}`);
  const f6 = expected.find((x) => /\(F6\)/.test(x.target));
  if (!f6 || !f6.target.startsWith('S19') || !/SET seed_proof\.run = 'E01';[\s\S]*?UPDATE public\.website_archetypes SET/.test(text)) {
    problems.push('F6: no step edits one website_archetypes row and expects S19 to move');
  }
  if (/\bsetval\s*\(/i.test(code)) problems.push('a sequence is moved with setval, which a rollback does not undo');

  if (!/^\\set ON_ERROR_STOP on$/m.test(code)) problems.push('psql: ON_ERROR_STOP is not set');
  if (!/^\\set QUIET on$/m.test(code)) problems.push('psql: QUIET is not set, command tags would reach the CSV');
  const rowsVar = /^\\set expected_rows (\d+)$/m.exec(code);
  if (!rowsVar || Number(rowsVar[1]) !== checkerRows) problems.push(`row count: expected_rows is ${rowsVar?.[1] ?? 'unset'}, the seed checker states ${checkerRows}`);
  for (const [name, body] of [['proof', code], ['step', stepText]] as const) {
    if (!body.includes('\\ir ../../scripts/check-baseline-seed.sql')) problems.push(`${name}: does not run the seed checker`);
  }
  if (!stepText.includes('\\pset tuples_only on') || !stepText.includes('\\gset')) problems.push('step: does not load and record its result');
  return problems;
}

const seedChecker = readRepoFile(SEED_CHECKER);
const seedExport = readRepoFile(SEED_EXPORT);
const seedImport = readRepoFile(SEED_IMPORT);
const seedProof = readRepoFile(SEED_PROOF);
const seedStep = readRepoFile(SEED_STEP);
const seedCheckerRows = Number(/Returns exactly (\d+) rows/.exec(seedChecker)?.[1] ?? NaN);

describe('scripts/check-baseline-seed.sql (T1, T2, T18)', () => {
  it('passes every rule: read-only, the 19 tables in load order, the R-2 and R-3 transforms, the gates and keys', () => {
    expect(auditSeedChecker(seedChecker)).toEqual([]);
  });

  it('states 25 rows: VERDICT, S00 to S21 and the two keys', () => {
    expect(seedCheckerRows).toBe(1 + 22 + 2);
  });
});

describe('supabase/baseline/seed-export.psql (T8, T19)', () => {
  it('passes every rule: one read-only snapshot, the guard, the 19 copies, the checker', () => {
    expect(auditSeedExport(seedExport)).toEqual([]);
  });
});

describe('supabase/baseline/seed-import.psql (T8, T15, T17, T20)', () => {
  it('passes every rule: atomicity, the guard, the 19 loads, the sequences, the comparison with the export', () => {
    expect(auditSeedImport(seedImport, seedCheckerRows)).toEqual([]);
  });
});

describe('supabase/baseline/prove-seed-checker-can-fail.psql (T21, F6)', () => {
  it('passes every rule', () => {
    expect(auditSeedProof(seedProof, seedStep, seedCheckerRows)).toEqual([]);
  });
});

describe('the seed files: LF, and no artefact left in the repo', () => {
  const attributes = readRepoFile('.gitattributes').split('\n');
  it.each([[SEED_CHECKER], [SEED_EXPORT], [SEED_IMPORT], [SEED_PROOF], [SEED_STEP]])('%s is pinned eol=lf', (file) => {
    expect(attributes).toContain(`${file} text eol=lf`);
  });

  // The export, the import and both proofs write their files to the current
  // folder, which must be the private baseline folder. One run from the repo by
  // mistake would leave staging reference data where it can be committed.
  it('holds no seed, proof or dump artefact in the repo root or supabase/baseline', () => {
    const artefact = /^(seed-[\w-]+\.csv|parity-proof-run\.csv|seed-proof-run\.csv|schema\.(sql|dump|list|filtered\.list)|.*\.dump)$/;
    const found = ['.', 'supabase/baseline']
      .flatMap((dir) => fs.readdirSync(path.join(ROOT, dir)).map((f) => `${dir}/${f}`))
      .filter((f) => artefact.test(path.basename(f)));
    expect(found).toEqual([]);
  });
});

describe('the seed audits can fail', () => {
  type Mutation = readonly [string, (s: string) => string, RegExp];

  const checkerBreaks: Mutation[] = [
    ['the read-only SET removed', (s) => s.replace('SET default_transaction_read_only = on;\n', ''), /read-only/],
    ['a COMMIT added (SA: no transaction control)', (s) => `${s}COMMIT;\n`, /write or transaction keyword.*commit/i],
    ['a ROLLBACK added', (s) => `${s}ROLLBACK;\n`, /write or transaction keyword.*rollback/i],
    ['client_min_messages raised (SA: warnings stay visible)', (s) => s.replace('WITH seed_lines AS (', "SELECT set_config('client_min_messages', 'error', false)\nWITH seed_lines AS ("), /client_min_messages/],
    ['the word into in a comment', (s) => s.replace('-- HOW TO READ IT', '-- HOW TO READ IT, read into it'), /into/],
    ['a table dropped from the sections', (s) => s.replace("    (109, 'S09', 'boost_packs', 'seed', 'count'),\n", ''), /sections: expected/],
    ['two tables swapped in the load order', (s) => s.replace("'S14', 'capabilities'", "'S14', 'capability_building_blocks'"), /S14 is titled capability_building_blocks/],
    ['a nulled column no longer subtracted', (s) => s.replace("SELECT 'S13', (to_jsonb(src) - ARRAY['updated_by']::text[])::text, true", "SELECT 'S13', to_jsonb(src)::text, true"), /S13: subtracts nothing, expected - ARRAY\['updated_by'\]/],
    ['one proposal column no longer subtracted', (s) => s.replace("ARRAY['proposal_id', 'proposal_line_id']::text[]", "ARRAY['proposal_id']::text[]"), /S01: subtracts/],
    ['a column subtracted from a table that nulls none', (s) => s.replace("SELECT 'S16', to_jsonb(src)::text, true", "SELECT 'S16', (to_jsonb(src) - ARRAY['body']::text[])::text, true"), /S16: subtracts/],
    ['the admin_users key not emptied', (s) => s.replace("CASE WHEN src.key = 'admin_users' THEN jsonb_set(to_jsonb(src), ARRAY['value'], '[]'::jsonb)", "CASE WHEN src.key = 'none' THEN jsonb_set(to_jsonb(src), ARRAY['value'], '[]'::jsonb)"), /S06: the admin_users key/],
    ['S20 hashes the row content', (s) => s.replace("SELECT 'S20', 'initialisation row', true", "SELECT 'S20', to_jsonb(src)::text, true"), /S20: not a constant line/],
    ['S20 gated at one or more', (s) => s.replace("CASE WHEN summary.line_count = 1 THEN 'PASS'", "CASE WHEN summary.line_count >= 1 THEN 'PASS'"), /S20: the single row is not gated/],
    ['a sequence check dropped', (s) => s.replace("pg_sequence_last_value(pg_get_serial_sequence('public.help_articles', 'id')::regclass))", "NULL::bigint)"), /S21: the help_articles sequence/],
    ['the owned-sequence list unpinned', (s) => s.replace("= 'ais_scoring_weights.id,help_articles.id'", '<> \'\''), /S21: the owned-sequence list is not pinned/],
    ['the line gates ignored', (s) => s.replace("WHEN summary.line_count > 0 AND summary.gates_ok THEN 'PASS'", "WHEN summary.line_count > 0 THEN 'PASS'"), /gates: a section passes without its line gates/],
    ['a non-seed table read', (s) => s.replace("FROM public.memory_config AS src", 'FROM public.profiles AS src'), /reads public\.profiles/],
    ['operator_private read', (s) => s.replace("FROM public.memory_config AS src", 'FROM operator_private.secrets AS src'), /names operator_private/],
    ['S00 loses IntervalStyle', (s) => s.replace("current_setting('IntervalStyle'),", "'x',"), /S00: IntervalStyle/],
    ['lines hashed unsorted', (s) => s.replace('string_agg(seed_lines.line, chr(10) ORDER BY seed_lines.line COLLATE "C")', 'string_agg(seed_lines.line, chr(10))'), /determinism/],
    ['the context folded in the SEED KEY', (s) => s.replace("FROM graded WHERE graded.kind = 'seed')", "FROM graded WHERE graded.kind IN ('seed', 'context'))"), /SEED KEY: not computed over the seed tables only/],
    ['the stated row count drifts', (s) => s.replace('Returns exactly 25 rows', 'Returns exactly 24 rows'), /row count/],
    ['a single-letter alias', (s) => s.replace('FROM public.boost_packs AS src', 'FROM public.boost_packs AS b'), /single-letter alias/],
  ];

  it.each(checkerBreaks)('seed checker: %s', (_name, mutate, complaint) => {
    const broken = mutate(seedChecker);
    expect(broken).not.toBe(seedChecker);
    expect(auditSeedChecker(broken).join('\n')).toMatch(complaint);
  });

  const exportBreaks: Mutation[] = [
    ['the snapshot is not repeatable read', (s) => s.replace('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'BEGIN READ ONLY;'), /transaction: expected BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/],
    ['the snapshot is read-write', (s) => s.replace('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'BEGIN ISOLATION LEVEL REPEATABLE READ;'), /transaction: expected/],
    ['the ROLLBACK becomes COMMIT', (s) => s.replace(/^ROLLBACK;$/m, 'COMMIT;'), /transaction/],
    ['a write added', (s) => s.replace('-- 6. Read only', 'UPDATE public.pricing_config SET id = id;\n-- 6. Read only'), /a write statement UPDATE/],
    ['client_min_messages raised', (s) => s.replace("SET LOCAL bytea_output = 'hex';", "SET LOCAL bytea_output = 'hex';\nSET LOCAL client_min_messages = error;"), /client_min_messages/],
    ['the never-in-U5 header removed (SA c)', (s) => s.replace('-- NEVER PART OF U5r OR U5.', '-- Not part of the apply.'), /never part of the U5r or U5 file list/],
    ['a context pin removed', (s) => s.replace("SET LOCAL DateStyle = 'ISO, MDY';\n", ''), /context: SET LOCAL DateStyle/],
    ['the guard given an exception handler', (s) => s.replace("|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEND\n$guard$;", "|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$guard$;"), /guard: it has an exception handler/],
    ['the read-only check removed', (s) => s.replace("<> 'repeatable read' THEN", "<> 'x' THEN"), /guard: does not refuse on its own read-only transaction/],
    ['a primary key changed', (s) => s.replace("('helpbot_page_contexts', 'page_route')", "('helpbot_page_contexts', 'id')"), /guard: the primary-key list/],
    ['a nulled column dropped from the guard', (s) => s.replace("'exchange_rates.updated_by']::text[];", "'exchange_rates.created_by']::text[];"), /guard: nulled_columns/],
    ['the foreign-key check removed', (s) => s.replace("WHERE con.contype = 'f'", 'WHERE false'), /guard: does not refuse on a foreign key out of the seed set/],
    ['the identity check removed', (s) => s.replace("AND (att.attgenerated <> '' OR att.attidentity <> '')", 'AND false'), /guard: does not refuse on a generated or identity column/],
    ['the json check removed', (s) => s.replace("'pg_catalog.json'::pg_catalog.regtype, ", ''), /guard: does not refuse on a json column/],
    ['the refusal downgraded', (s) => s.replace('IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE EXCEPTION', 'IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE NOTICE'), /guard: does not refuse on the refusal raises/],
    ['updated_by copied as it is (a staging user id reaches the file)', (s) => s.replace("\\copy (SELECT rec.* FROM public.exchange_rates AS src CROSS JOIN LATERAL jsonb_populate_record(NULL::public.exchange_rates, to_jsonb(src) - ARRAY['updated_by']::text[]) AS rec ORDER BY", '\\copy (SELECT src.* FROM public.exchange_rates AS src ORDER BY'), /copy: exchange_rates does not null exactly updated_by/],
    ['the admin_users key exported as it is', (s) => s.replace("jsonb_populate_record(NULL::public.system_settings_config, (CASE WHEN src.key = 'admin_users' THEN jsonb_set(to_jsonb(src), ARRAY['value'], '[]'::jsonb) ELSE to_jsonb(src) END) - ARRAY", 'jsonb_populate_record(NULL::public.system_settings_config, to_jsonb(src) - ARRAY'), /copy: system_settings_config does not null exactly updated_by at the source and empty the admin_users key/],
    ['a table dropped', (s) => s.replace(/^\\copy \(SELECT src\.\* FROM public\.storage_plans .*\n/m, ''), /copy: expected the 19 seed tables in load order/],
    ['a child copied before its parent', (s) => {
      const parent = /^\\copy \(SELECT src\.\* FROM public\.capabilities .*\n/m.exec(s)?.[0] ?? '';
      return s.replace(parent, '').replace(/^(\\copy \(SELECT src\.\* FROM public\.capability_building_blocks .*\n)/m, `$1${parent}`);
    }, /capability_building_blocks comes before its parent capabilities/],
    ['a table written to another file', (s) => s.replace("TO 'seed-boost_packs.csv'", "TO 'seed-boost.csv'"), /copy: boost_packs is written to seed-boost\.csv/],
    ['a copy ordered by another column', (s) => s.replace('FROM public.website_archetypes AS src ORDER BY src.id::text', 'FROM public.website_archetypes AS src ORDER BY src.name::text'), /copy: website_archetypes is ordered by name/],
    ['a \\copy FROM sneaks in', (s) => s.replace('-- 5. The seed checker', "\\copy public.pricing_config FROM 'x.csv' WITH (FORMAT csv)\n-- 5. The seed checker"), /copy: a \\copy line is not a read/],
    ['the checker run removed', (s) => s.replace('\\o seed-check-export.csv\n', ''), /checker: the export does not write/],
    ['a shell escape', (s) => s.replace('-- 6. Read only', '\\! echo x\n-- 6. Read only'), /meta-command \\! is not on the allow-list/],
    ['ON_ERROR_STOP switched off', (s) => s.replace('\\set QUIET off', '\\set ON_ERROR_STOP off'), /\\set ON_ERROR_STOP off is not one of the allowed/],
    ['operator_private read', (s) => s.replace('-- 6. Read only', "\\copy (SELECT src.* FROM operator_private.secrets AS src) TO 'x.csv'\n-- 6. Read only"), /names operator_private/],
    // SA code review S-1: every export guard refusal can fail.
    ['the jsonb settings-value check removed', (s) => s.replace("\n      AND att.atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype", ''), /guard: does not refuse on a settings value that is not jsonb/],
    ['the missing-table half of the table check removed', (s) => s.replace("WHERE pg_catalog.to_regclass('public.' || want.table_name) IS NULL\n       OR", 'WHERE false\n       OR'), /guard: does not refuse on a missing table or another primary key/],
  ];

  it.each(exportBreaks)('seed export: %s', (_name, mutate, complaint) => {
    const broken = mutate(seedExport);
    expect(broken).not.toBe(seedExport);
    expect(auditSeedExport(broken).join('\n')).toMatch(complaint);
  });

  const importBreaks: Mutation[] = [
    // SA C-2 and the runbook constraint (b): no transaction control.
    ['the opening SAVEPOINT removed', (s) => s.replace('SAVEPOINT baseline_seed_import;\n', ''), /savepoint: the first statement/],
    ['the RELEASE removed', (s) => s.replace('RELEASE SAVEPOINT baseline_seed_import;\n', ''), /release: the last statement/],
    ['a COMMIT before the release', (s) => s.replace('RELEASE SAVEPOINT baseline_seed_import;', 'COMMIT;\nRELEASE SAVEPOINT baseline_seed_import;'), /transaction control COMMIT/],
    ['a ROLLBACK at the end', (s) => `${s}ROLLBACK;\n`, /transaction control ROLLBACK/],
    ['a BEGIN at the top', (s) => s.replace('SAVEPOINT baseline_seed_import;', 'BEGIN;\nSAVEPOINT baseline_seed_import;'), /transaction control BEGIN at the top level/],
    ['END on its own', (s) => `${s}END;\n`, /transaction control END at the top level/],
    // The runbook constraint (a): warnings stay visible.
    ['client_min_messages raised', (s) => s.replace("SET LOCAL bytea_output = 'hex';", "SET LOCAL bytea_output = 'hex';\nSET LOCAL client_min_messages = error;"), /client_min_messages/],
    ['a \\set AUTOCOMMIT', (s) => s.replace('\\set QUIET off', '\\set AUTOCOMMIT on'), /\\set AUTOCOMMIT on is not one of the allowed/],
    ['a \\c reconnect', (s) => s.replace('-- 5. The 19 tables', '\\c postgres\n-- 5. The 19 tables'), /meta-command \\c is not on the allow-list/],
    ['the lock timeout removed', (s) => s.replace("SET LOCAL lock_timeout = '10s';\n", ''), /lock timeout/],
    ['a context pin removed', (s) => s.replace("SET LOCAL TimeZone = 'UTC';\n", ''), /context: SET LOCAL TimeZone/],
    // SA R-2: no trigger is disabled.
    ['triggers disabled for the load', (s) => s.replace('-- 5. The 19 tables', 'ALTER TABLE public.exchange_rates DISABLE TRIGGER USER;\n-- 5. The 19 tables'), /a trigger is switched/],
    ['session_replication_role used', (s) => s.replace("SET LOCAL bytea_output = 'hex';", "SET LOCAL bytea_output = 'hex';\nSET LOCAL session_replication_role = replica;"), /a trigger is switched/],
    // The guard.
    ['the guard given an exception handler', (s) => s.replace("|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEND\n$guard$;", "|| pg_catalog.array_to_string(refusals, '; ');\n  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$guard$;"), /exception handler/],
    ['the auth.users check removed', (s) => s.replace('IF EXISTS (SELECT 1 FROM auth.users) THEN', 'IF false THEN'), /guard: does not refuse on rows in auth\.users/],
    ['the export rows not checked', (s) => s.replace("FROM pg_temp.seed_check_export) <> 25", 'FROM pg_temp.seed_check_export) < 0'), /guard: does not refuse on an export that is not 25 passing rows/],
    ['the emptiness check removed', (s) => s.replace('AND pg_catalog.pg_relation_size(rel.oid) > 0', 'AND false'), /guard: does not refuse on a seed table that is not empty/],
    ['the INSERT trigger check removed', (s) => s.replace('AND (trg.tgtype & 4) <> 0', 'AND false'), /guard: does not refuse on a user trigger firing on INSERT/],
    ['the owned-sequence check loosened', (s) => s.replace("IF owned_list IS DISTINCT FROM 'ais_scoring_weights.id,help_articles.id' THEN", 'IF false THEN'), /guard: does not refuse on other owned sequences/],
    ['a seed table missing from the guard', (s) => s.replace("'plugin_semantic_ops', 'website_archetypes']::text[];\n  owned_list", "'plugin_semantic_ops']::text[];\n  owned_list"), /guard: seed_tables is not the 19/],
    // T8: the loads.
    ['a load dropped', (s) => s.replace(/^\\copy public\.memory_config .*\n/m, ''), /load: expected the 19 seed tables in load order/],
    ['a child loaded before its parent', (s) => {
      const parent = /^\\copy public\.reward_config .*\n/m.exec(s)?.[0] ?? '';
      return s.replace(parent, '').replace(/^(\\copy public\.reward_settings .*\n)/m, `$1${parent}`);
    }, /reward_settings loads before its parent reward_config/],
    ['HEADER MATCH dropped', (s) => s.replace("FROM 'seed-help_articles.csv' WITH (FORMAT csv, HEADER MATCH)", "FROM 'seed-help_articles.csv' WITH (FORMAT csv, HEADER)"), /load: a \\copy is not one seed table from its own file with HEADER MATCH/],
    ['a load from another table file', (s) => s.replace("\\copy public.boost_packs FROM 'seed-boost_packs.csv'", "\\copy public.boost_packs FROM 'seed-storage_plans.csv'"), /load: a \\copy is not one seed table from its own file/],
    ['an INSERT added', (s) => s.replace('-- 6. The two serial', "INSERT INTO public.boost_packs SELECT * FROM public.boost_packs;\n-- 6. The two serial"), /a data statement other than \\copy: INSERT/],
    ['ON CONFLICT added', (s) => s.replace('-- 6. The two serial', "INSERT INTO public.boost_packs DEFAULT VALUES ON CONFLICT DO NOTHING;\n-- 6. The two serial"), /silent no-op: ON CONFLICT/],
    ['an unqualified table', (s) => s.replace('FROM public.help_articles AS src));', 'FROM help_articles AS src));'), /unqualified name after FROM help_articles/],
    // SA R-2: the sequences.
    ['a sequence not set', (s) => s.replace(/  PERFORM pg_catalog\.setval\(pg_catalog\.pg_get_serial_sequence\('public\.help_articles'[\s\S]*?AS src\)\);\n/, ''), /sequences: help_articles is not set/],
    ['the sequences set before the loads', (s) => {
      const block = /-- 6\. The two serial[\s\S]*?\$sequences\$;\n/.exec(s)?.[0] ?? '';
      return s.replace(block, '').replace('-- 5. The 19 tables', `${block}-- 5. The 19 tables`);
    }, /order: (the first load runs before the sequences set|the sequences set runs before the last load)/],
    // The comparison with the export.
    ['the comparison removed', (s) => s.replace(/DO \$seed_proof\$[\s\S]*?\$seed_proof\$;\n/, ''), /comparison: no DO \$seed_proof\$ block/],
    ['the context compare dropped', (s) => s.replace("IS DISTINCT FROM\n     (SELECT exported.detail FROM pg_temp.seed_check_export AS exported WHERE exported.check_name = 'CONTEXT KEY') THEN", "IS NULL THEN"), /comparison: does not refuse on a different context/],
    ['differences only reported', (s) => s.replace("IF differing IS NOT NULL THEN\n    RAISE EXCEPTION", "IF differing IS NOT NULL THEN\n    RAISE NOTICE"), /comparison: does not refuse on any row that differs/],
    ['the checker not run on this project', (s) => s.replace('\\o seed-check-import.csv\n', ''), /order: the checker run not found/],
    ['the REFRESH slot moved after the release (SA DV-3 ruling 7)', (s) => {
      const slot = /-- 8\. Materialized views[\s\S]*?\(SA DV-3 ruling 7\)\.\n/.exec(s)?.[0] ?? '';
      return `${s.replace(slot, '')}${slot}`;
    }, /order: the release runs before the REFRESH slot/],
    ['operator_private written', (s) => s.replace('-- 6. The two serial', "\\copy operator_private.secrets FROM 'x.csv'\n-- 6. The two serial"), /names operator_private/],
    // SA code review S-1: every import guard and comparison refusal can fail.
    ['the guard refusal downgraded to a notice', (s) => s.replace('IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE EXCEPTION', 'IF pg_catalog.cardinality(refusals) > 0 THEN\n    RAISE NOTICE'), /guard: does not refuse on the refusal raises/],
    ['the not-postgres check removed', (s) => s.replace("IF current_user <> 'postgres' THEN", 'IF false THEN'), /guard: does not refuse on not connected as postgres/],
    ['the 19-table count removed', (s) => s.replace('rel.relname::text = ANY (seed_tables)) <> 19 THEN', 'rel.relname::text = ANY (seed_tables)) < 0 THEN'), /guard: does not refuse on a missing seed table/],
    ['the generated-or-identity check removed', (s) => s.replace("AND (att.attgenerated <> '' OR att.attidentity <> '')", 'AND false'), /guard: does not refuse on a generated or identity column/],
    ['the export VERDICT PASS half dropped', (s) => s.replace("WHERE exported.check_name = 'VERDICT' AND exported.result = 'PASS') THEN", "WHERE exported.check_name = 'VERDICT') THEN"), /guard: does not refuse on an export that is not 25 passing rows/],
    ['the comparison row count dropped', (s) => s.replace('FROM pg_temp.seed_check_import) <> 25', 'FROM pg_temp.seed_check_import) < 0'), /comparison: does not refuse on this project not 25 passing rows/],
    ['the comparison VERDICT PASS half dropped', (s) => s.replace("WHERE imported.check_name = 'VERDICT' AND imported.result = 'PASS') THEN", "WHERE imported.check_name = 'VERDICT') THEN"), /comparison: does not refuse on this project not 25 passing rows/],
  ];

  it.each(importBreaks)('seed import: %s', (_name, mutate, complaint) => {
    const broken = mutate(seedImport);
    expect(broken).not.toBe(seedImport);
    expect(auditSeedImport(broken, seedCheckerRows).join('\n')).toMatch(complaint);
  });

  const proofBreaks: Mutation[] = [
    ['the final ROLLBACK becomes COMMIT', (s) => s.replace(/ROLLBACK;\n\n-- Summary/, 'COMMIT;\n\n-- Summary'), /transaction/],
    ['a savepoint left open', (s) => s.replace('ROLLBACK TO SAVEPOINT seed_proof_step;\n', ''), /savepoints/],
    ['a step missing from the summary', (s) => s.replace("    (4, 'E02', :'res_e02'),\n", ''), /summary: lists/],
    ['the F6 step retargeted', (s) => s.replace("('E01', 'S19 a row edited (F6)'", "('E01', 'S18 a row edited (F6)'"), /(coverage: no deliberate change targets S19|F6: no step edits)/],
    ['the F6 step edits another table', (s) => s.replace("format('UPDATE public.website_archetypes SET", "format('UPDATE public.help_articles SET"), /F6: no step edits one website_archetypes row/],
    ['the sequence step uses setval', (s) => s.replace('  UPDATE public.help_articles\n  SET id =', "  PERFORM setval('x', 1);\n  UPDATE public.help_articles\n  SET id ="), /setval/],
    ['the staging guard removed', (s) => s.replace(/DO \$guard\$[\s\S]*?\$guard\$;\n/, ''), /staging guard: no DO block/],
    ['the staging guard given an exception handler', (s) => s.replace(/  END IF;\nEND\n\$guard\$;/, '  END IF;\nEXCEPTION WHEN OTHERS THEN\n  NULL;\nEND\n$guard$;'), /staging guard: it has an exception handler/],
    ['the lock timeout removed', (s) => s.replace("SET LOCAL lock_timeout = '3s';\n", ''), /lock timeout/],
    ['the row count drifts from the checker', (s) => s.replace('\\set expected_rows 25', '\\set expected_rows 24'), /row count/],
    ['a \\gexec in the proof', (s) => s.replace("WHERE seed_proof_rows.run_label = 'BASE' \\gset\n\nROLLBACK;", "WHERE seed_proof_rows.run_label = 'BASE' \\gexec\n\nROLLBACK;"), /meta-command \\gexec is not on the allow-list/],
    ['COMMIT mid-line', (s) => s.replace("SET seed_proof.run = 'POST';", "SET seed_proof.run = 'POST'; COMMIT;"), /proof: transaction control COMMIT/],
    ['a grant added', (s) => s.replace('-- POST: every', 'GRANT SELECT ON public.help_articles TO anon;\n-- POST: every'), /proof: grants or names a role/],
    // SA code review S-1 and S-3.
    ['the staging guard downgraded to a notice', (s) => s.replace('IF EXISTS (SELECT 1 FROM auth.users) THEN\n    RAISE EXCEPTION', 'IF EXISTS (SELECT 1 FROM auth.users) THEN\n    RAISE NOTICE'), /staging guard: no DO block refusing/],
    ['the never-in-U5 header removed', (s) => s.replace('-- NEVER PART OF U5r OR U5. This file is never in the file list of the', '-- This file is never in the file list of the'), /never part of the U5r or U5 file list/],
  ];

  it.each(proofBreaks)('seed proof: %s', (_name, mutate, complaint) => {
    const broken = mutate(seedProof);
    expect(broken).not.toBe(seedProof);
    expect(auditSeedProof(broken, seedStep, seedCheckerRows).join('\n')).toMatch(complaint);
  });

  const stepBreaks: Mutation[] = [
    ['COMMIT in the step file', (s) => `${s}COMMIT;\n`, /step: transaction control COMMIT/],
    ['a \\! shell escape in the step file', (s) => s.replace('\\o\n', '\\o\n\\! echo x\n'), /step: psql meta-command \\! is not on the allow-list/],
    ['the step runs the parity checker instead', (s) => s.replace('\\ir ../../scripts/check-baseline-seed.sql', '\\ir ../../scripts/check-schema-parity.sql'), /step: does not run the seed checker/],
  ];

  it.each(stepBreaks)('seed step: %s', (_name, mutate, complaint) => {
    const broken = mutate(seedStep);
    expect(broken).not.toBe(seedStep);
    expect(auditSeedProof(seedProof, broken, seedCheckerRows).join('\n')).toMatch(complaint);
  });
});
