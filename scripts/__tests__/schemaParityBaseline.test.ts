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
