/**
 * Unit tests for scripts/lib/migrationForeignKeys.ts: the tokenizer and every
 * replay rule of SA-5 (docs/requirements/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_REQUIREMENT.md).
 * Pure: synthetic SQL only, no files.
 */

import {
  compareFileNames,
  defaultForeignKeyName,
  makeObjectName,
  replayMigrations,
  tokenize,
  type ForeignKey,
  type MigrationFile,
} from '@/scripts/lib/migrationForeignKeys';

const one = (sql: string, file = '20990101_a.sql'): MigrationFile[] => [{ file, sql }];
const names = (fks: readonly ForeignKey[]): string[] => fks.map((fk) => `${fk.childSchema}.${fk.childTable}.${fk.constraint}`);
const replayNames = (files: MigrationFile[]): string[] => names(replayMigrations(files).foreignKeys);
const kinds = (sql: string) => tokenize(sql).tokens.map((t) => [t.kind, t.text]);

describe('tokenize', () => {
  it('splits words, punctuation and numbers, folding words to lower case', () => {
    expect(kinds('ALTER TABLE Public.T (a, 12);')).toEqual([
      ['word', 'alter'],
      ['word', 'table'],
      ['word', 'public'],
      ['punct', '.'],
      ['word', 't'],
      ['punct', '('],
      ['word', 'a'],
      ['punct', ','],
      ['other', '12'],
      ['punct', ')'],
      ['punct', ';'],
    ]);
  });

  it('reads a nested block comment as one comment', () => {
    const { tokens, error } = tokenize('/* outer /* inner */ still comment REFERENCES x(id) */ SELECT');
    expect(error).toBeNull();
    expect(tokens.map((t) => t.kind)).toEqual(['comment', 'word']);
  });

  it("reads E'\\'' as one string (backslash escape)", () => {
    const { tokens, error } = tokenize("SELECT E'it\\'s', 'plain''s';");
    expect(error).toBeNull();
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(["it\\'s", "plain's"]);
  });

  it('reads a dollar tag with digits, and a $1 parameter is not a tag', () => {
    const { tokens, error } = tokenize('AS $fn1$ BEGIN $$ inner $$ END $fn1$; SELECT $1;');
    expect(error).toBeNull();
    expect(tokens.filter((t) => t.kind === 'dollar').map((t) => t.text)).toEqual([' BEGIN $$ inner $$ END ']);
    expect(tokens.some((t) => t.kind === 'other' && t.text === '$1')).toBe(true);
  });

  it('keeps -- inside a quoted identifier, and the case as written', () => {
    const { tokens, error } = tokenize('CREATE TABLE "Odd--Name" (x int);');
    expect(error).toBeNull();
    expect(tokens.find((t) => t.kind === 'ident')?.text).toBe('Odd--Name');
    expect(tokens.some((t) => t.kind === 'comment')).toBe(false);
  });

  it('a -- inside a string is not a comment', () => {
    expect(tokenize("SELECT '-- not a comment';").tokens.map((t) => t.kind)).toEqual(['word', 'string', 'punct']);
  });

  it.each([
    ['block comment', 'SELECT 1; /* open /* nested */', 'unterminated block comment'],
    ['string', "SELECT 'open", 'unterminated string literal'],
    ['E string', "SELECT E'open\\'", 'unterminated E string'],
    ['quoted identifier', 'SELECT "open', 'unterminated quoted identifier'],
    ['dollar body', 'DO $tag1$ BEGIN', 'unterminated dollar-quoted body $tag1$'],
  ])('reports an unterminated %s', (_kind, sql, message) => {
    expect(tokenize(sql).error?.message).toBe(message);
  });
});

describe('file order (SA-5.1)', () => {
  it('sorts by code unit, not locale: hyphenated and upper-case names first', () => {
    const files = ['20260212_b.sql', '2026-08-14_a.sql', 'a.sql', 'B.sql'];
    expect([...files].sort(compareFileNames)).toEqual(['2026-08-14_a.sql', '20260212_b.sql', 'B.sql', 'a.sql']);
  });

  it('replays in that order whatever order the input has', () => {
    const files: MigrationFile[] = [
      { file: '20990102_drop.sql', sql: 'ALTER TABLE t DROP CONSTRAINT t_p_fkey;' },
      { file: '20990101_add.sql', sql: 'CREATE TABLE t (p uuid REFERENCES parent(id));' },
    ];
    expect(replayNames(files)).toEqual([]);
  });
});

describe('identifiers (SA-5.2)', () => {
  it('folds unquoted names, keeps quoted ones, and defaults the schema to public', () => {
    const [fk] = replayMigrations(one('CREATE TABLE Child ("Parent_Id" uuid REFERENCES Auth.Users);')).foreignKeys;
    expect(fk).toMatchObject({
      childSchema: 'public',
      childTable: 'child',
      childColumns: ['Parent_Id'],
      parentSchema: 'auth',
      parentTable: 'users',
      parentColumns: null,
      constraint: 'child_Parent_Id_fkey',
    });
  });

  it('records file and line', () => {
    const [fk] = replayMigrations(one('-- header\n\nALTER TABLE t\n  ADD COLUMN p uuid\n    REFERENCES parent(id);\n')).foreignKeys;
    expect(fk).toMatchObject({ file: '20990101_a.sql', line: 5, parentColumns: ['id'] });
  });
});

describe('the four ways a migration declares an FK (FR-1)', () => {
  it('inline column REFERENCES in CREATE TABLE, with and without CONSTRAINT', () => {
    expect(
      replayNames(one('CREATE TABLE IF NOT EXISTS public.t (id uuid PRIMARY KEY, a uuid NOT NULL REFERENCES p(id) ON DELETE CASCADE, b numeric(10, 2), c uuid CONSTRAINT named_c REFERENCES p);')),
    ).toEqual(['public.t.named_c', 'public.t.t_a_fkey']);
  });

  it('table-level FOREIGN KEY, named and unnamed', () => {
    expect(
      replayNames(one('CREATE TABLE t (a uuid, b uuid, CONSTRAINT t_named FOREIGN KEY (a) REFERENCES p(id), FOREIGN KEY (a, b) REFERENCES q (x, y));')),
    ).toEqual(['public.t.t_a_b_fkey', 'public.t.t_named']);
  });

  it('ALTER TABLE ADD [COLUMN] ... REFERENCES and ADD [CONSTRAINT n] FOREIGN KEY', () => {
    expect(
      replayNames(
        one(
          'ALTER TABLE ONLY public.t ADD COLUMN a uuid REFERENCES p(id), ADD b uuid REFERENCES p(id);\n' +
            'ALTER TABLE IF EXISTS t ADD CONSTRAINT t_c FOREIGN KEY (c) REFERENCES p(id) NOT VALID;\n' +
            'ALTER TABLE t ADD FOREIGN KEY (d) REFERENCES p(id);',
        ),
      ),
    ).toEqual(['public.t.t_a_fkey', 'public.t.t_b_fkey', 'public.t.t_c', 'public.t.t_d_fkey']);
  });

  it('ignores FK text in comments and in COMMENT ON prose', () => {
    const result = replayMigrations(
      one(
        '-- ALTER TABLE t ADD COLUMN a uuid REFERENCES p(id);\n' +
          '/* ALTER TABLE t ADD CONSTRAINT x FOREIGN KEY (a) REFERENCES p(id); */\n' +
          "COMMENT ON COLUMN t.a IS 'Foreign key to p. This column references p(id).';\n",
      ),
    );
    expect(result).toEqual({ foreignKeys: [], problems: [], dynamic: [], unmatched: [] });
  });
});

describe('DO bodies run as DDL (SA-5.3)', () => {
  it('the IF NOT EXISTS ... THEN ALTER TABLE idiom adds the FK', () => {
    const sql =
      'DO $do$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = \'t_owner_fk\') THEN\n' +
      '    ALTER TABLE public.t ADD CONSTRAINT t_owner_fk FOREIGN KEY (user_id) REFERENCES public.p(user_id);\n  END IF;\nEND $do$;';
    const result = replayMigrations(one(sql));
    expect(names(result.foreignKeys)).toEqual(['public.t.t_owner_fk']);
    expect(result.foreignKeys[0].line).toBe(4);
    expect(result.dynamic).toEqual([]);
  });

  it('a DROP inside a DO body applies too', () => {
    expect(
      replayNames([
        { file: '1.sql', sql: 'CREATE TABLE t (a uuid REFERENCES p(id));' },
        { file: '2.sql', sql: 'DO $$ BEGIN ALTER TABLE t DROP CONSTRAINT IF EXISTS t_a_fkey; END $$;' },
      ]),
    ).toEqual([]);
  });
});

describe('IF NOT EXISTS behaves as Postgres does (SA-5.4)', () => {
  it('CREATE TABLE IF NOT EXISTS on a table the replay holds adds nothing', () => {
    expect(
      replayNames([
        { file: '1.sql', sql: 'CREATE TABLE t (a uuid);' },
        { file: '2.sql', sql: 'CREATE TABLE IF NOT EXISTS t (a uuid REFERENCES p(id));' },
      ]),
    ).toEqual([]);
  });

  it('ADD COLUMN IF NOT EXISTS on an existing column adds no FK, on a new one it does', () => {
    expect(
      replayNames([
        { file: '1.sql', sql: 'CREATE TABLE t (a uuid);' },
        { file: '2.sql', sql: 'ALTER TABLE t ADD COLUMN IF NOT EXISTS a uuid REFERENCES p(id), ADD COLUMN IF NOT EXISTS b uuid REFERENCES p(id);' },
      ]),
    ).toEqual(['public.t.t_b_fkey']);
  });

  it('a skipped definition is not unattributed FK syntax', () => {
    const result = replayMigrations([
      { file: '1.sql', sql: 'CREATE TABLE t (a uuid);' },
      { file: '2.sql', sql: 'CREATE TABLE IF NOT EXISTS t (a uuid REFERENCES p(id));' },
    ]);
    expect(result.problems).toEqual([]);
  });
});

describe('default names (SA-5.5, FR-2)', () => {
  it('AC-3: ADD COLUMN replaces_meeting_id on scheduling_meetings', () => {
    expect(
      replayNames(one('ALTER TABLE scheduling_meetings ADD COLUMN replaces_meeting_id uuid REFERENCES scheduling_meetings(id);')),
    ).toEqual(['public.scheduling_meetings.scheduling_meetings_replaces_meeting_id_fkey']);
  });

  it('shortens the longer part until the name fits in 63 bytes', () => {
    const table = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'; // 52
    const name = defaultForeignKeyName(table, ['user_id']);
    expect(name).toBe('abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwx_user_id_fkey');
    expect(name).toHaveLength(63);
  });

  it('on a tie Postgres shortens the column part', () => {
    const forty = 'a'.repeat(40);
    const name = makeObjectName(forty, 'b'.repeat(40), 'fkey');
    expect(name).toBe(`${'a'.repeat(29)}_${'b'.repeat(28)}_fkey`);
  });

  it('counts bytes, not characters, and never splits a character', () => {
    const name = makeObjectName('é'.repeat(40), 'id', 'fkey');
    expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(63);
    expect(name).toBe(`${'é'.repeat(27)}_id_fkey`);
  });

  it('adds a numeric suffix on collision, from the names the table already holds', () => {
    expect(defaultForeignKeyName('t', ['a'], new Set(['t_a_fkey', 't_a_fkey1']))).toBe('t_a_fkey2');
    expect(replayNames(one('CREATE TABLE t (a uuid REFERENCES p(id), FOREIGN KEY (a) REFERENCES q(id));'))).toEqual([
      'public.t.t_a_fkey',
      'public.t.t_a_fkey1',
    ]);
  });

  it('a long name over 63 bytes from a real-looking replay', () => {
    const table = 'agent_prompt_workflow_generation_sessions_history';
    const [fk] = replayMigrations(one(`CREATE TABLE ${table} (calibration_session_id uuid REFERENCES p(id));`)).foreignKeys;
    // 49 + 22 bytes plus `_` `_fkey` is 77: the table part (the longer) loses 14.
    expect(fk.constraint).toBe('agent_prompt_workflow_generation_se_calibration_session_id_fkey');
    expect(Buffer.byteLength(fk.constraint)).toBe(63);
  });
});

describe('later changes (SA-5.6, FR-3)', () => {
  const base: MigrationFile = { file: '1.sql', sql: 'CREATE TABLE t (id uuid PRIMARY KEY, a uuid REFERENCES p(id), b uuid REFERENCES p(id));' };

  it('AC-4: DROP CONSTRAINT [IF EXISTS] removes it', () => {
    expect(replayNames([base, { file: '2.sql', sql: 'ALTER TABLE public.t DROP CONSTRAINT t_a_fkey, DROP CONSTRAINT IF EXISTS t_b_fkey;' }])).toEqual([]);
  });

  it('AC-5: RENAME CONSTRAINT checks it under its final name', () => {
    expect(replayNames([base, { file: '2.sql', sql: 'ALTER TABLE t RENAME CONSTRAINT t_a_fkey TO t_a_renamed;' }])).toEqual([
      'public.t.t_a_renamed',
      'public.t.t_b_fkey',
    ]);
  });

  it('DROP COLUMN drops the FKs on that column', () => {
    expect(replayNames([base, { file: '2.sql', sql: 'ALTER TABLE t DROP COLUMN IF EXISTS a;' }])).toEqual(['public.t.t_b_fkey']);
  });

  it('RENAME COLUMN changes the recorded column only', () => {
    const [fk] = replayMigrations([base, { file: '2.sql', sql: 'ALTER TABLE t RENAME COLUMN a TO a2; ALTER TABLE t DROP COLUMN b;' }]).foreignKeys;
    expect(fk).toMatchObject({ constraint: 't_a_fkey', childColumns: ['a2'] });
  });

  it('RENAME TO moves the child key, keeps constraint names, and FKs into the table follow it', () => {
    const result = replayMigrations([
      base,
      { file: '2.sql', sql: 'CREATE TABLE u (t_id uuid REFERENCES t(id));' },
      { file: '3.sql', sql: 'ALTER TABLE t RENAME TO t2;' },
    ]);
    expect(names(result.foreignKeys)).toEqual(['public.t2.t_a_fkey', 'public.t2.t_b_fkey', 'public.u.u_t_id_fkey']);
    expect(result.foreignKeys.find((fk) => fk.childTable === 'u')?.parentTable).toBe('t2');
  });

  it('DROP TABLE removes its own FKs and every FK pointing at it', () => {
    expect(
      replayNames([
        base,
        { file: '2.sql', sql: 'CREATE TABLE u (t_id uuid REFERENCES t(id), p_id uuid REFERENCES p(id));' },
        { file: '3.sql', sql: 'DROP TABLE IF EXISTS public.t CASCADE;' },
      ]),
    ).toEqual(['public.u.u_p_id_fkey']);
  });

  it('a re-added constraint after a drop is present again', () => {
    expect(
      replayNames([
        base,
        { file: '2.sql', sql: 'ALTER TABLE t DROP CONSTRAINT t_a_fkey, DROP CONSTRAINT t_b_fkey;' },
        { file: '3.sql', sql: 'ALTER TABLE t ADD CONSTRAINT t_a_fkey FOREIGN KEY (a) REFERENCES p(id);' },
      ]),
    ).toEqual(['public.t.t_a_fkey']);
  });
});

describe('fail closed (SA-5.7) and dynamic SQL (SA-4)', () => {
  it('FK syntax in a statement the replay does not understand is a problem with file and line', () => {
    const result = replayMigrations(one('SELECT 1;\nCREATE TYPE pair AS (a int REFERENCES p(id));'));
    expect(result.problems).toEqual([
      { file: '20990101_a.sql', line: 2, kind: 'unattributed', message: expect.stringContaining('foreign key syntax outside a statement') },
    ]);
  });

  it('an unterminated construct is a problem naming the file', () => {
    expect(replayMigrations(one("SELECT 1;\nSELECT 'never closed;")).problems).toEqual([
      { file: '20990101_a.sql', line: 2, kind: 'unterminated', message: 'unterminated string literal' },
    ]);
  });

  it('GRANT ... REFERENCES, EXECUTE FUNCTION and prose do not trip anything', () => {
    const result = replayMigrations(
      one(
        'GRANT SELECT, REFERENCES, TRIGGER ON TABLE t TO r;\n' +
          'REVOKE REFERENCES ON TABLE t FROM r;\n' +
          'CREATE TRIGGER x AFTER DELETE ON t FOR EACH ROW EXECUTE FUNCTION f();\n' +
          "DO $$ BEGIN RAISE NOTICE 'this references the agents table and its foreign keys'; END $$;\n" +
          "CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'it references nothing at all'; RETURN NEW; END $$;\n",
      ),
    );
    expect(result.problems).toEqual([]);
    expect(result.dynamic).toEqual([]);
  });

  it('a string ENDING in "references <name>" is flagged: it may be the first half of a concatenated FK (fail closed)', () => {
    expect(replayMigrations(one("SELECT 'ALTER TABLE t ADD COLUMN a uuid REFERENCES public.p' || ' (id)';")).dynamic).toHaveLength(1);
  });

  it('FK syntax inside a string literal is dynamic, at any depth', () => {
    const result = replayMigrations(
      one("DO $$\nBEGIN\n  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES %I(id)', a, b, c);\nEND $$;"),
    );
    expect(result.dynamic.map((d) => d.line)).toEqual([3]);
    expect(result.foreignKeys).toEqual([]);
  });

  it('FK syntax in code inside a function body is dynamic, not executed', () => {
    const result = replayMigrations(
      one('CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $fn$\nBEGIN\n  ALTER TABLE t ADD COLUMN a uuid REFERENCES p(id);\nEND $fn$;'),
    );
    expect(result.dynamic.map((d) => d.line)).toEqual([3]);
    expect(result.foreignKeys).toEqual([]);
  });

  it('a top-level string with REFERENCES <name>( is dynamic too', () => {
    expect(replayMigrations(one("SELECT 'ALTER TABLE t ADD COLUMN a uuid REFERENCES p(id)';")).dynamic).toHaveLength(1);
  });

  it.each(['NOT NULL', 'NULL', 'DEFAULT NULL', 'CHECK (true)', 'UNIQUE', 'PRIMARY KEY', 'CONSTRAINT x'])(
    'REFERENCES <name> followed by the column constraint %s is dynamic (SA re-review)',
    (tail) => {
      expect(replayMigrations(one(`SELECT 'ALTER TABLE t ADD COLUMN a uuid REFERENCES p ${tail}';`)).dynamic).toHaveLength(1);
    },
  );

  it('prose after REFERENCES <name> is still not dynamic', () => {
    expect(replayMigrations(one("SELECT 'this column references contacts and nothing else';")).dynamic).toEqual([]);
  });

  // SA code review 1: four shapes that evaded the string check.
  it('(a) adjacent constants across a newline are judged as one text, at the line where the FK starts', () => {
    const sql =
      "DO $$\nBEGIN\n EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I '\n '(user_id) REFERENCES '\n 'public.crm_contacts(id)', 'a', 'b');\nEND $$;";
    const { dynamic } = replayMigrations(one(sql));
    expect(dynamic.map((d) => d.line)).toEqual([4]);
    expect(dynamic[0].excerpt).toContain('REFERENCES public.crm_contacts(id)');
  });

  it('(b) a || chain is judged as one text, a non-literal operand standing in as %s', () => {
    const sql =
      "DO $$\nBEGIN\n EXECUTE 'ALTER TABLE public.x ADD CONSTRAINT y ' || 'FOREIGN KEY ' || '(c) REFERENCES ' || quote_ident('crm_contacts') || '(id)';\nEND $$;";
    const { dynamic } = replayMigrations(one(sql));
    expect(dynamic).toHaveLength(1);
    expect(dynamic[0].excerpt).toBe('ALTER TABLE public.x ADD CONSTRAINT y FOREIGN KEY (c) REFERENCES %s(id)');
  });

  it('(c) positional format() specifiers count as a name', () => {
    const sql = "DO $$\nBEGIN\n EXECUTE format('ALTER TABLE public.%1$I ADD COLUMN c uuid REFERENCES public.%2$I(id)', 'a', 'b');\nEND $$;";
    expect(replayMigrations(one(sql)).dynamic).toHaveLength(1);
  });

  it('(d) REFERENCES <name>; inside a string is dynamic', () => {
    const sql = "DO $$\nBEGIN\n EXECUTE 'ALTER TABLE public.x ADD COLUMN c uuid REFERENCES crm_contacts;';\nEND $$;";
    expect(replayMigrations(one(sql)).dynamic).toHaveLength(1);
  });

  // SA re-review R-1: shapes the joiner cannot see through, caught by the cast skip or the EXECUTE backstop.
  it("R-1: a '…'::text || … cast chain is dynamic", () => {
    const sql =
      "DO $$\nBEGIN\n EXECUTE 'ALTER TABLE public.x ADD CONSTRAINT y FOREIGN KEY '::text || '(c) REFERENCES '::text || quote_ident('crm_contacts') || '(id)';\nEND $$;";
    const { dynamic } = replayMigrations(one(sql));
    expect(dynamic.map((d) => d.line)).toEqual([3]);
    expect(dynamic[0].excerpt).toBe('ALTER TABLE public.x ADD CONSTRAINT y FOREIGN KEY (c) REFERENCES %s(id)');
  });

  it("R-1: EXECUTE concat('… FOREIGN KEY ', '(c) REFERENCES ', t, '(id)') is dynamic (EXECUTE backstop)", () => {
    const sql = "DO $$\nBEGIN\n EXECUTE concat('ALTER TABLE public.x ADD CONSTRAINT y FOREIGN KEY ', '(c) REFERENCES ', t, '(id)');\nEND $$;";
    expect(replayMigrations(one(sql)).dynamic.map((d) => d.line)).toEqual([3]);
  });

  it('R-1: the backstop ignores EXECUTE FUNCTION / PROCEDURE and statements without EXECUTE', () => {
    const result = replayMigrations(
      one(
        "CREATE TRIGGER t1 AFTER DELETE ON t FOR EACH ROW EXECUTE FUNCTION f('clears references');\n" +
          "CREATE TRIGGER t2 AFTER DELETE ON t FOR EACH ROW EXECUTE PROCEDURE f('foreign key cleanup');\n" +
          "DO $$ BEGIN RAISE NOTICE 'checked % references', concat('a', 'b'); END $$;\n",
      ),
    );
    expect(result.dynamic).toEqual([]);
  });

  it('constants on one line, or a chain of prose, are not joined into FK syntax', () => {
    const result = replayMigrations(
      one("SELECT 'a' 'b';\nDO $$ BEGIN RAISE NOTICE '% references % rows', 'it' || ' still', n; END $$;\nGRANT REFERENCES ON t TO r;"),
    );
    expect(result.dynamic).toEqual([]);
  });
});

describe('tokenize: string continuation (Postgres quotecontinue)', () => {
  it('joins constants separated by whitespace holding a newline, -- comments included', () => {
    const { tokens, error } = tokenize("SELECT 'ab'\n  'cd' -- note\n\t'ef', 'gh' 'ij';");
    expect(error).toBeNull();
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(['abcdef', 'gh', 'ij']);
  });

  it('keeps E-string escapes across the join', () => {
    const { tokens } = tokenize("SELECT E'it\\'s'\n'\\n';");
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(["it\\'s\\n"]);
  });

  it('an unterminated continuation fails', () => {
    expect(tokenize("SELECT 'a'\n'b").error?.message).toBe('unterminated string literal');
  });
});

describe('ALTER TABLE ... SET SCHEMA (SA code review 2)', () => {
  it('moves the table key, its FKs, and the FKs pointing at it', () => {
    const result = replayMigrations([
      { file: '1.sql', sql: 'CREATE TABLE public.k (id uuid PRIMARY KEY, c uuid REFERENCES public.crm_contacts(id), s uuid REFERENCES public.k(id));' },
      { file: '2.sql', sql: 'CREATE TABLE public.u (k_id uuid REFERENCES public.k(id));' },
      { file: '3.sql', sql: 'ALTER TABLE IF EXISTS public.k SET SCHEMA other;' },
    ]);
    expect(
      result.foreignKeys.map((fk) => `${fk.childSchema}.${fk.childTable}.${fk.constraint}->${fk.parentSchema}.${fk.parentTable}`),
    ).toEqual(['other.k.k_c_fkey->public.crm_contacts', 'other.k.k_s_fkey->other.k', 'public.u.u_k_id_fkey->other.k']);
  });

  it('later statements find the table under its new schema', () => {
    expect(
      replayNames([
        { file: '1.sql', sql: 'CREATE TABLE k (c uuid REFERENCES p(id));' },
        { file: '2.sql', sql: 'ALTER TABLE k SET SCHEMA archive; ALTER TABLE archive.k DROP CONSTRAINT k_c_fkey;' },
      ]),
    ).toEqual([]);
  });
});

describe('adjustments (SA-4)', () => {
  const base: MigrationFile = { file: '1.sql', sql: 'CREATE TABLE t (a uuid CONSTRAINT repo_name REFERENCES p(id));' };

  it('inject adds an FK at that file, later statements still apply to it', () => {
    const result = replayMigrations(
      [
        { file: '1.sql', sql: 'SELECT 1;' },
        { file: '2.sql', sql: 'ALTER TABLE u RENAME CONSTRAINT injected TO injected_final;' },
      ],
      [{ file: '1.sql', kind: 'inject', fk: { childTable: 'u', childColumns: ['user_id'], parentTable: 'p', parentColumns: null, constraint: 'injected' } }],
    );
    expect(result.foreignKeys).toEqual([expect.objectContaining({ childTable: 'u', constraint: 'injected_final', origin: 'injected', file: '1.sql' })]);
    expect(result.unmatched).toEqual([]);
  });

  it('rename and remove apply after the file, and report what they did not find', () => {
    const rename = { file: '1.sql', kind: 'rename', childTable: 't', from: 'repo_name', to: 'live_name' } as const;
    const missing = { file: '1.sql', kind: 'remove', childTable: 't', constraint: 'nope' } as const;
    const noFile = { file: '9.sql', kind: 'remove', childTable: 't', constraint: 'live_name' } as const;
    const result = replayMigrations([base], [rename, missing, noFile]);
    expect(names(result.foreignKeys)).toEqual(['public.t.live_name']);
    expect(result.unmatched).toEqual([noFile, missing]);
  });

  it('remove deletes the FK', () => {
    expect(names(replayMigrations([base], [{ file: '1.sql', kind: 'remove', childTable: 't', constraint: 'repo_name' }]).foreignKeys)).toEqual([]);
  });
});
