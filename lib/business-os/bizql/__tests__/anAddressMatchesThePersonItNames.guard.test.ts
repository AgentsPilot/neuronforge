/**
 * An address finds the person it belongs to, and nobody else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE FAULTS, ONE FIELD
 *
 * The spreadsheet importer looks a contact up by email before filing them. It
 * filed the same client four times in two days, and each time the lookup was
 * the thing that failed:
 *
 *  1. WHITESPACE. The sheet held `eomer3@walla.co.il ` with a trailing space.
 *     The CRM held the address clean. Two different strings to an exact match,
 *     so the dedupe concluded it had never seen them. Fixed at both seams —
 *     what is written is trimmed (`resolveWriteValue`) and what is matched is
 *     trimmed (`resolveValue`), because either alone leaves the question
 *     carrying a space the answer no longer does.
 *
 *  2. CASE. Measured on production, 2026-11-24: `email=eq.EOMER3@walla.co.il`
 *     returns nothing against a stored `eomer3@walla.co.il`. A spreadsheet
 *     saying `Person3@company.net` against a CRM holding
 *     `person3@company.net` is the same duplicate from a different cause —
 *     and `CRMContactRepository` had always matched with `ilike`, so the two
 *     paths disagreed about whether a client existed.
 *
 *  3. THE WILDCARDS IN THE CURE. `ilike` treats `_` as "any one character",
 *     and `_` is legal and common in an address. Measured the same day:
 *     `email=ilike.eomer3@walla.co.i_` MATCHES `eomer3@walla.co.il`. So the
 *     naive fix for (2) makes a lookup for `tal_omer@x.com` return
 *     `talXomer@x.com` — a different person's record, handed back under the
 *     name of the one asked for. That is worse than the duplicate it cures.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SOURCE GUARD, BECAUSE THE BEHAVIOUR LIVES IN POSTGRES
 *
 * What each rule does can only be proved against a database — which is where
 * all three facts above were measured. What this file protects is that the
 * rules are still THERE and still paired: trimming one side only, or matching
 * case-insensitively without escaping, each reintroduces a fault that looks
 * like nothing at all from the code.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const COMPILER = read('lib/business-os/bizql/compiler.ts');
const MUTATE = read('lib/business-os/bizql/mutate/MutateExecutor.ts');
const CONTACTS = read('lib/repositories/CRMContactRepository.ts');

describe('whitespace', () => {
  it('is trimmed on the way in', () => {
    expect(MUTATE).toContain("if (field.column === 'email' && typeof value === 'string') {");
    expect(MUTATE).toContain('const trimmed = value.trim();');
  });

  it('is trimmed on the way out, or the pair is useless', () => {
    /*
     * Pinned together on purpose. Trimming only the write leaves every
     * existing lookup asking for a value that is no longer stored anywhere,
     * which is a different miss rather than a fix.
     */
    expect(COMPILER).toContain(
      "if (field.column === 'email' && typeof value === 'string') return value.trim();"
    );
  });
});

describe('case', () => {
  it('is ignored when an address is matched', () => {
    expect(COMPILER).toContain('builder.ilike(column, literal)');
    expect(COMPILER).toContain("builder.not(column, 'ilike', literal)");
  });

  it('is only ignored for eq and neq, which take one pattern', () => {
    /* `in` carries a list and `ilike` takes a single pattern. Expanding a
       list into an `or` of patterns here would be a different change. */
    expect(COMPILER).toContain("(op === 'eq' || op === 'neq')");
  });
});

describe('the wildcards', () => {
  it('are escaped in the compiler, so ilike is an exact comparison', () => {
    /*
     * `\`, `%`, `_` and `*` — PostgREST maps `*` onto `%`, so it is a
     * wildcard here too. Any of them left raw turns a lookup into a search.
     *
     * Asserted as the literal line rather than a pattern: a regex describing
     * a regex full of backslashes is a test nobody can read and everybody
     * mistrusts.
     */
    expect(COMPILER).toContain(
      "const literal = value.replace(/[\\\\%_*]/g, match => `\\\\${match}`);"
    );
  });

  it('are escaped in the repository, which has matched this way all along', () => {
    /*
     * That path already lowercased and used `ilike`; what it never did was
     * escape `_`. It dropped addresses containing a comma or a bracket —
     * right, because those change the shape of the `or` list — and let an
     * underscore through into a pattern.
     */
    expect(CONTACTS).toContain(".map((email) => email.replace(/_/g, '\\\\_'));");
  });

  it('keeps dropping what would break the query shape', () => {
    /* Escaping `_` must not have replaced the existing filter: a comma or a
       bracket changes the `or` list itself, and those are not legal in an
       unquoted address anyway. */
    expect(CONTACTS).toContain("!/[,()\"'*%\\\\]/.test(email)");
  });
});
