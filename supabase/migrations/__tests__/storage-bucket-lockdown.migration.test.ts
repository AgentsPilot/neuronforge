/**
 * Guard over migrations 20261070 (D-3a, F-26: `avatars` bucket lockdown) and
 * 20261071 (F-27a, FU-2: `website-images` bucket lockdown), and the hand-run
 * scripts around them.
 *
 * D-3a removes all eight `avatars` policies on `storage.objects` (three broad
 * `auth.uid() IS NOT NULL` writes, three owner-scoped writes, two public
 * SELECT duplicates), so the bucket is service-role only, like
 * `business-purge-snapshots` (20260916a). Public object URLs keep working
 * because the bucket stays public. It also sets the bucket's own limits:
 * 4194304 bytes and PNG / JPEG / WebP / GIF. Rulings: SA Workplan Review
 * (2026-10-16) in BUSINESS_OS_SETTINGS_DRAWER_D3_WORKPLAN.md, items 1-8.
 *
 * F-27a removes all four `website-images` policies (three authenticated
 * writes and, per SA ruling Q-1 / SA-LK-1, the public SELECT), removes
 * `image/svg+xml` from its type list and keeps the 5 MB limit (generated PNGs
 * can approach 4 MB). Rulings: SA-F27-7 in
 * WEBSITE_UPLOAD_BUCKET_SCOPE_F27_WORKPLAN.md and SA-LK-1 in
 * STORAGE_BUCKET_LOCKDOWN_D3A_F27A_WORKPLAN.md. Public object URLs keep
 * working without a SELECT policy because the bucket stays public.
 *
 * LC-8 (TL, production, 2026-10-16): `storage.objects` and `storage.buckets`
 * are owned by `supabase_storage_admin`; the SQL-editor role `postgres` is not
 * a member and not superuser, but holds UPDATE on `storage.buckets`. So the
 * policy removals (and, on rollback, the re-creations) are done in Dashboard
 * -> Storage -> Policies, and each migration file holds only the bucket
 * UPDATE plus an assertion that the policies are already gone (the 20260916a
 * rule: never ship a file that fails halfway). If a policy is still there,
 * the assertion aborts the transaction and the bucket is left unchanged. The
 * SQL drops and creates are kept as documented alternatives (`alt-sql-*`),
 * each one transaction, so a 42501 leaves nothing applied.
 *
 * The rollback definitions are the CAPTURE TL ran on 2026-10-16 (twelve rows,
 * all PERMISSIVE, all twelve removed by D-3a + F-27a), pinned below. pg_policies prints each expression with one
 * more outer pair of parentheses than the capture as pasted; the meaning is
 * identical.
 *
 * Rollback order: D-3a is rolled back BEFORE D-3 is reverted (the old browser
 * hook needs the broad INSERT and UPDATE policies D-3a removes).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. TL pastes the
 * pre-check, the capture, the migrations, the checkers, the probes and, if
 * ever needed, the rollbacks into the Supabase SQL editor by hand. Same
 * pattern as plugin-connections-token-column-lockdown and
 * boost-packs-drop-dead-policies.
 *
 * The website-images writer guard at the end mirrors SA-D3-5 (avatars): after
 * F-27a no browser policy is left, so a new browser writer would fail in
 * production only. It keeps every writer on the service role.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const SCRIPTS = join(ROOT, 'scripts');

const D3A = join(MIGRATIONS, '20261070_avatars_bucket_lockdown.sql');
const F27A = join(MIGRATIONS, '20261071_website_images_bucket_lockdown.sql');
const D3A_ALT_DROP = join(SCRIPTS, 'alt-sql-drop-avatars-policies.sql');
const F27A_ALT_DROP = join(SCRIPTS, 'alt-sql-drop-website-images-policies.sql');
const D3A_ALT_RECREATE = join(SCRIPTS, 'alt-sql-recreate-avatars-policies.sql');
const F27A_ALT_RECREATE = join(SCRIPTS, 'alt-sql-recreate-website-images-policies.sql');
const D3A_ROLLBACK = join(SCRIPTS, 'rollback-avatars-bucket-lockdown.sql');
const F27A_ROLLBACK = join(SCRIPTS, 'rollback-website-images-bucket-lockdown.sql');
const D3A_CHECKER = join(SCRIPTS, 'check-avatars-bucket-lockdown.sql');
const F27A_CHECKER = join(SCRIPTS, 'check-website-images-bucket-lockdown.sql');
const D3A_PROBE = join(SCRIPTS, 'probe-avatars-bucket-lockdown.sql');
const F27A_PROBE = join(SCRIPTS, 'probe-website-images-bucket-lockdown.sql');
const PRECHECK = join(SCRIPTS, 'precheck-storage-bucket-lockdown.sql');
const CAPTURE = join(SCRIPTS, 'capture-storage-bucket-lockdown-rollback-source.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const AVATAR_POLICIES = [
  'Users can upload avatars',
  'Users can update avatars',
  'Users can delete avatars',
  'Users can upload their own avatar',
  'Users can update their own avatar',
  'Users can delete their own avatar',
  'Avatar images are publicly accessible',
  'Public can view avatars',
];
const AVATAR_CMDS = ['INSERT', 'UPDATE', 'DELETE', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'SELECT'];
const WEBSITE_READ_POLICY = 'Website images are publicly readable';
const WEBSITE_POLICIES = [
  'Users can upload website images',
  'Users can update their website images',
  'Users can delete their website images',
  WEBSITE_READ_POLICY,
];
const WEBSITE_CMDS = ['INSERT', 'UPDATE', 'DELETE', 'SELECT'];

const AVATAR_TYPES = "ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]";
const WEBSITE_TYPES = "ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]";

/** The capture, 2026-10-16: `[name, cmd, roles, USING / WITH CHECK clause]`. */
type CapturedPolicy = [string, string, string, string];
const ANY = '(auth.uid() IS NOT NULL)';
const OWN = '((auth.uid())::text = (storage.foldername(name))[1])';
const WEB_OWN = '((storage.foldername(name))[1] = (auth.uid())::text)';
const CAPTURED_AVATARS: CapturedPolicy[] = [
  ['Users can upload avatars', 'INSERT', 'public', `WITH CHECK (((bucket_id = 'avatars'::text) AND ${ANY}))`],
  ['Users can update avatars', 'UPDATE', 'public', `USING (((bucket_id = 'avatars'::text) AND ${ANY}))`],
  ['Users can delete avatars', 'DELETE', 'public', `USING (((bucket_id = 'avatars'::text) AND ${ANY}))`],
  ['Users can upload their own avatar', 'INSERT', 'public', `WITH CHECK (((bucket_id = 'avatars'::text) AND ${OWN}))`],
  ['Users can update their own avatar', 'UPDATE', 'public', `USING (((bucket_id = 'avatars'::text) AND ${OWN}))`],
  ['Users can delete their own avatar', 'DELETE', 'public', `USING (((bucket_id = 'avatars'::text) AND ${OWN}))`],
  ['Avatar images are publicly accessible', 'SELECT', 'public', "USING ((bucket_id = 'avatars'::text))"],
  ['Public can view avatars', 'SELECT', 'public', "USING ((bucket_id = 'avatars'::text))"],
];
const CAPTURED_WEBSITE: CapturedPolicy[] = [
  [
    'Users can upload website images',
    'INSERT',
    'authenticated',
    `WITH CHECK (((bucket_id = 'website-images'::text) AND ${WEB_OWN}))`,
  ],
  [
    'Users can update their website images',
    'UPDATE',
    'authenticated',
    `USING (((bucket_id = 'website-images'::text) AND ${WEB_OWN}))`,
  ],
  [
    'Users can delete their website images',
    'DELETE',
    'authenticated',
    `USING (((bucket_id = 'website-images'::text) AND ${WEB_OWN}))`,
  ],
  [WEBSITE_READ_POLICY, 'SELECT', 'public', "USING ((bucket_id = 'website-images'::text))"],
];

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The one DO block, and the file without it. */
function splitDoBlock(sql: string): { block: string; rest: string } {
  const blocks = [...sql.matchAll(/DO \$\$[\s\S]*?\n\$\$;/g)];
  expect(blocks).toHaveLength(1);
  return { block: blocks[0][0], rest: sql.replace(blocks[0][0], '') };
}

/** Non-empty statements, whitespace collapsed, without the trailing semicolon. */
function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const drop = (name: string) => `DROP POLICY IF EXISTS "${name}" ON storage.objects`;
const create = ([name, cmd, roles, clause]: CapturedPolicy) =>
  `CREATE POLICY "${name}" ON storage.objects AS PERMISSIVE FOR ${cmd} TO ${roles} ${clause}`;

const FILES: Array<[string, string]> = [
  ['D-3a migration', D3A],
  ['F-27a migration', F27A],
  ['D-3a alternative SQL drops', D3A_ALT_DROP],
  ['F-27a alternative SQL drops', F27A_ALT_DROP],
  ['D-3a alternative SQL recreate', D3A_ALT_RECREATE],
  ['F-27a alternative SQL recreate', F27A_ALT_RECREATE],
  ['D-3a rollback', D3A_ROLLBACK],
  ['F-27a rollback', F27A_ROLLBACK],
  ['D-3a checker', D3A_CHECKER],
  ['F-27a checker', F27A_CHECKER],
  ['D-3a probe', D3A_PROBE],
  ['F-27a probe', F27A_PROBE],
  ['pre-check', PRECHECK],
  ['capture', CAPTURE],
];

const READ_ONLY: Array<[string, string]> = [
  ['D-3a checker', D3A_CHECKER],
  ['F-27a checker', F27A_CHECKER],
  ['D-3a probe', D3A_PROBE],
  ['F-27a probe', F27A_PROBE],
  ['pre-check', PRECHECK],
  ['capture', CAPTURE],
];

describe('SQL-editor safety (TL pastes every file by hand)', () => {
  it.each(FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(FILES)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  // The Supabase SQL editor misreads the word "into" even inside a string
  // literal or an identifier (2026-10-04). No pasted file may contain it.
  it.each(FILES)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(FILES)('%s has an even number of single quotes', (_name, file) => {
    expect((read(file).match(/'/g) ?? []).length % 2).toBe(0);
  });

  it.each(FILES)('%s has no semicolon inside a string literal', (_name, file) => {
    for (const literal of literalsOf(read(file))) expect(literal).not.toContain(';');
  });

  it.each(FILES)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
  });

  it.each(FILES)('%s never says SECURITY DEFINER, GRANT, REVOKE or ALTER', (_name, file) => {
    expect(read(file)).not.toMatch(/SECURITY\s+DEFINER|\bGRANT\b|\bREVOKE\b|\bALTER\b/);
  });
});

describe('the read-only files', () => {
  it.each(READ_ONLY)('%s is read-only from its first statement', (_name, file) => {
    expect(statementsOf(read(file))[0]).toBe('SET default_transaction_read_only = on');
  });

  it.each(READ_ONLY)('%s changes nothing', (_name, file) => {
    const code = read(file).replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(BEGIN|COMMIT|UPDATE|DELETE|INSERT|DROP|CREATE|TRUNCATE)\b/);
  });
});

describe('20261070 D-3a: the avatars bucket becomes service-role only', () => {
  const migration = read(D3A);
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT: lock timeout and the bucket limits; the policies go in the dashboard (LC-8)', () => {
    expect(statements).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      `UPDATE storage.buckets SET file_size_limit = 4194304, allowed_mime_types = ${AVATAR_TYPES} WHERE id = 'avatars'`,
      'COMMIT',
    ]);
  });

  it('holds no policy DDL, never flips the bucket private, and touches no other bucket', () => {
    expect(migration).not.toMatch(/DROP POLICY|CREATE POLICY|\bpublic\s*=|website-images|ON CONFLICT/);
    expect(migration).not.toMatch(/image\/svg/);
    expect(migration.match(/WHERE id = '[^']+'/g)).toEqual(["WHERE id = 'avatars'"]);
  });

  it('the assertion refuses any policy left that names avatars, then checks the bucket row', () => {
    expect(block).toMatch(/LIKE '%avatars%'/);
    expect(block).toMatch(/pg_policies\.schemaname = 'storage'/);
    expect(block).toMatch(/pg_policies\.tablename = 'objects'/);
    expect(block).not.toMatch(/cmd <> 'SELECT'/);
    expect(block).toMatch(/IF lockdown_offenders IS NOT NULL THEN\s+RAISE EXCEPTION/);
    expect(block).toMatch(/storage\.buckets\.public\s/);
    expect(block).toContain('storage.buckets.file_size_limit = 4194304');
    expect(block).toContain(`storage.buckets.allowed_mime_types = ${AVATAR_TYPES}`);
    expect(block).toMatch(/IF lockdown_bucket_rows <> 1 THEN\s+RAISE EXCEPTION/);
  });
});

describe('20261071 F-27a: website-images becomes service-role only and loses SVG', () => {
  const migration = read(F27A);
  const { block, rest } = splitDoBlock(migration);
  const statements = statementsOf(rest);

  it('is one BEGIN ... COMMIT: lock timeout and the type list; the policies go in the dashboard (LC-8)', () => {
    expect(statements).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      `UPDATE storage.buckets SET allowed_mime_types = ${WEBSITE_TYPES} WHERE id = 'website-images'`,
      'COMMIT',
    ]);
  });

  it('keeps the 5 MB limit (SA-F27-7), allows no SVG, holds no policy DDL, touches no other bucket', () => {
    expect(rest).not.toMatch(/file_size_limit/);
    expect(migration).not.toMatch(/image\/svg|DROP POLICY|CREATE POLICY|\bpublic\s*=|avatars/);
    expect(migration.match(/WHERE id = '[^']+'/g)).toEqual(["WHERE id = 'website-images'"]);
  });

  it('the assertion refuses ANY policy left that names website-images (SA-LK-1), then checks the bucket row', () => {
    expect(block).toMatch(/LIKE '%website-images%'/);
    expect(block).toMatch(/pg_policies\.schemaname = 'storage'/);
    expect(block).toMatch(/pg_policies\.tablename = 'objects'/);
    expect(block).not.toMatch(/\bcmd\b/);
    expect(block).toMatch(/IF lockdown_offenders IS NOT NULL THEN\s+RAISE EXCEPTION/);
    expect(block).toContain('storage.buckets.file_size_limit = 5242880');
    expect(block).toContain(`storage.buckets.allowed_mime_types = ${WEBSITE_TYPES}`);
    expect(block).toMatch(/IF lockdown_bucket_rows <> 1 THEN\s+RAISE EXCEPTION/);
  });
});

describe('the alternative SQL drops (only if the dashboard path is not used)', () => {
  it.each([
    [D3A_ALT_DROP, AVATAR_POLICIES],
    [F27A_ALT_DROP, WEBSITE_POLICIES],
  ])('%s is one transaction of exactly the expected drops', (file, names) => {
    expect(statementsOf(read(file))).toEqual(['BEGIN', "SET LOCAL lock_timeout = '5s'", ...names.map(drop), 'COMMIT']);
  });

  it('the website-images drops include the public read policy (SA-LK-1)', () => {
    expect(read(F27A_ALT_DROP)).toContain(drop(WEBSITE_READ_POLICY));
  });
});

describe('the alternative SQL re-creations are the capture, verbatim', () => {
  it.each([
    [D3A_ALT_RECREATE, CAPTURED_AVATARS],
    [F27A_ALT_RECREATE, CAPTURED_WEBSITE],
  ])('%s drops-if-exists then creates each captured policy, in one transaction', (file, captured) => {
    const expected = captured.flatMap((row) => [drop(row[0]), create(row)]);
    expect(statementsOf(read(file))).toEqual(['BEGIN', "SET LOCAL lock_timeout = '5s'", ...expected, 'COMMIT']);
  });

  it('the captured names and commands match the lists the migrations and checkers use', () => {
    expect(CAPTURED_AVATARS.map((row) => [row[0], row[1]])).toEqual(
      AVATAR_POLICIES.map((name, i) => [name, AVATAR_CMDS[i]])
    );
    expect(CAPTURED_WEBSITE.map((row) => [row[0], row[1]])).toEqual(
      WEBSITE_POLICIES.map((name, i) => [name, WEBSITE_CMDS[i]])
    );
  });

  it('re-creates capture row 12, the public read policy, verbatim (SA-LK-1 d)', () => {
    expect(statementsOf(read(F27A_ALT_RECREATE))).toContain(
      `CREATE POLICY "${WEBSITE_READ_POLICY}" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'website-images'::text))`
    );
  });
});

describe('the D-3a rollback restores the bucket, after the policies are back', () => {
  const rollback = read(D3A_ROLLBACK);
  const { block, rest } = splitDoBlock(rollback);

  it('is one BEGIN ... COMMIT of the captured bucket row (no limits, LC-1) and no policy DDL', () => {
    expect(statementsOf(rest)).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      "UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'avatars'",
      'COMMIT',
    ]);
    expect(rollback).not.toMatch(/DROP POLICY|CREATE POLICY|website-images/);
  });

  it('checks in the same transaction that all eight are back', () => {
    for (const name of AVATAR_POLICIES) expect(block).toContain(`'${name}'`);
    expect(block).toMatch(/IF rollback_restored <> 8 THEN\s+RAISE EXCEPTION/);
  });
});

describe('the F-27a rollback restores SVG, after the four policies are back', () => {
  const rollback = read(F27A_ROLLBACK);
  const { block, rest } = splitDoBlock(rollback);

  it('is one BEGIN ... COMMIT of the captured five-type list, 5 MB untouched, no policy DDL', () => {
    expect(statementsOf(rest)).toEqual([
      'BEGIN',
      "SET LOCAL lock_timeout = '5s'",
      "UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']::text[] WHERE id = 'website-images'",
      'COMMIT',
    ]);
    expect(rollback).not.toMatch(/DROP POLICY|CREATE POLICY|file_size_limit|avatars/);
  });

  it('checks in the same transaction that all four are back', () => {
    for (const name of WEBSITE_POLICIES) expect(block).toContain(`'${name}'`);
    expect(block).toMatch(/IF rollback_restored <> 4 THEN\s+RAISE EXCEPTION/);
  });
});

describe('the checkers', () => {
  it('D-3a: VERDICT over every removed name, zero avatars policies, the limits, public kept', () => {
    const checker = read(D3A_CHECKER);
    expect(checker).toMatch(/'VERDICT' AS check_name/);
    for (const name of AVATAR_POLICIES) expect(checker).toContain(`('${name}', `);
    expect(checker).toContain("strpos(object_policies.policy_text, 'avatars') > 0) = 0");
    expect(checker).toContain('bucket_state.size_limit = 4194304');
    expect(checker).toContain(AVATAR_TYPES);
    expect(checker).toMatch(/COALESCE\(bucket_state\.is_public, false\)/);
  });

  it('F-27a: VERDICT over all four removed names, zero policies of any command, 5 MB kept', () => {
    const checker = read(F27A_CHECKER);
    expect(checker).toMatch(/'VERDICT' AS check_name/);
    for (const name of WEBSITE_POLICIES) expect(checker).toContain(`('${name}', `);
    expect(checker).toContain("strpos(object_policies.policy_text, 'website-images') > 0) = 0");
    expect(checker).not.toMatch(/cmd <> 'SELECT'|cmd = 'SELECT'/);
    expect(checker).toContain('bucket_state.size_limit = 5242880');
    expect(checker).toContain(WEBSITE_TYPES);
  });
});

describe('the pre-check (LC-8), the capture and the probes', () => {
  it('the pre-check asks who owns storage objects and buckets, and lists all twelve names', () => {
    const precheck = read(PRECHECK);
    expect(precheck).toContain('run the migration in a NEW tab');
    expect(precheck).toContain('pg_has_role(current_user, storage_tables.owner_name, ');
    expect(precheck).toContain("has_table_privilege(current_user, 'storage.buckets', 'UPDATE')");
    for (const name of [...AVATAR_POLICIES, ...WEBSITE_POLICIES]) {
      expect(precheck).toContain(`('${name}', `);
    }
    expect(precheck).toContain("strpos(storage.objects.name, '/generated/') > 0");
  });

  it('SA-LK-2: the pre-check reports whether the editor role and the cleanup function owner bypass RLS', () => {
    const precheck = read(PRECHECK);
    expect(precheck).toContain("'LC8 current user bypasses rls'");
    expect(precheck).toContain('WHERE pg_roles.rolname = current_user');
    expect(precheck).toContain("'LK2 owner of public operator_test_account_cleanup bypasses rls expected true'");
    expect(precheck).toContain('JOIN pg_roles ON pg_roles.oid = pg_proc.proowner');
    expect(precheck).toContain("WHERE proc_namespace.nspname = 'public'");
    expect(precheck).toContain("AND pg_proc.proname = 'operator_test_account_cleanup'");
    expect(precheck.match(/pg_roles\.rolbypassrls::text/g)).toHaveLength(2);
    expect(precheck.match(/pg_roles\.rolsuper::text/g)).toHaveLength(2);
    expect(precheck).toMatch(/'MISSING'\s*\)\s*\n\s*\n\s*UNION ALL\s*\n\s*SELECT 140/);
  });

  it('the capture prints every storage.objects policy verbatim and as a ready CREATE POLICY, plus both bucket rows', () => {
    const capture = read(CAPTURE);
    for (const column of ['policyname', 'permissive', 'cmd', 'roles', 'qual', 'with_check']) {
      expect(capture).toContain(`pg_policies.${column}`);
    }
    expect(capture).toContain("'CREATE POLICY ' || quote_ident(object_policies.policyname)");
    expect(capture).toContain("WHERE storage.buckets.id IN ('avatars', 'website-images')");
    expect(capture).not.toMatch(/policyname IN|policyname =/);
  });

  it.each([
    ['avatars', D3A_PROBE],
    ['website-images', F27A_PROBE],
  ])('the %s probe reads as anon, then as an owner, and resets the role and the claims', (bucket, file) => {
    const statements = statementsOf(read(file));
    expect(statements.filter((s) => /^SET ROLE (anon|authenticated)$/.test(s))).toEqual([
      'SET ROLE anon',
      'SET ROLE authenticated',
    ]);
    expect(statements.filter((s) => s === 'RESET ROLE')).toHaveLength(2);
    expect(statements).toContain('RESET "request.jwt.claims"');
    expect(statements[statements.length - 1]).toMatch(/^SELECT 'anon rows visible in /);
    // After the slice neither bucket has any policy: anon and owner both see 0.
    expect(statements[statements.length - 1]).toContain("'0' AS expected_after_apply");
    expect(statements[statements.length - 1]).toContain("current_setting('lockdown_probe.owner_rows'), '0'");
    for (const literal of literalsOf(read(file)).filter((l) => /^(avatars|website-images)$/.test(l))) {
      expect(literal).toBe(bucket);
    }
  });
});

/** Every non-test .ts / .tsx file under a directory. */
function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** A source that both names the website-images bucket and makes a storage call. */
function writesWebsiteImages(source: string): boolean {
  return /(['"`])website-images\1|\bWEBSITE_IMAGE_BUCKET\b/.test(source) && /\.storage\b/.test(source);
}

const WEBSITE_IMAGE_WRITERS = [
  'app/api/website/upload/route.ts',
  'lib/services/GeneratedImageService.ts',
  'lib/services/StockImageService.ts',
];

describe('F-27a precondition: every website-images writer is a service-role server file', () => {
  const found = ['app', 'components', 'lib', 'hooks']
    .flatMap((dir) => walk(join(ROOT, dir)))
    .filter((file) => writesWebsiteImages(read(file)))
    .map((file) => relative(ROOT, file).split(sep).join('/'))
    .sort();

  it('the writers are exactly the upload route and the two image services', () => {
    expect(found).toEqual([...WEBSITE_IMAGE_WRITERS].sort());
  });

  it.each(WEBSITE_IMAGE_WRITERS)('%s is server code on supabaseServer', (file) => {
    const source = read(join(ROOT, file));
    expect(source).not.toMatch(/^\s*['"]use client['"]/m);
    expect(source).toMatch(/import \{ supabaseServer \} from '@\/lib\/supabaseServer'/);
  });

  it('the matcher catches a browser writer and ignores a bucket name without a storage call', () => {
    expect(writesWebsiteImages("supabase.storage.from('website-images').upload(p, f)")).toBe(true);
    expect(writesWebsiteImages('supabase.storage.from(WEBSITE_IMAGE_BUCKET)')).toBe(true);
    expect(writesWebsiteImages("const label = 'website-images';")).toBe(false);
    expect(writesWebsiteImages("supabase.storage.from('website-images-old')")).toBe(false);
  });
});
