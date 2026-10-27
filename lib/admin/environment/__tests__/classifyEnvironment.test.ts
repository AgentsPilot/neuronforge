/**
 * The environment classifier (admin environment view EC-1; workplan §1.8.1,
 * cases C-1 to C-28; SA-C1 to SA-C8, RC-1, RC-2).
 *
 * Every value here is made up. Fixture secrets are obviously fake strings.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  checkedAgainstOf,
  classifyEnvironment,
  environmentLabelOf,
  MAX_SHOWN_LENGTH,
  nameLooksSecret,
  SECRET_NAME_TOKENS,
  UNCATALOGUED_ROLE,
  type EnvSource,
} from '../classifyEnvironment';
import { ENVIRONMENT_CATALOGUE, ENVIRONMENT_GROUP_ORDER, type EnvCatalogueEntry, type EnvConfigShape } from '../catalogue';
import { parseAdminEmails } from '@/lib/admin/adminEmailsEnv';
import type { EnvDisplay, EnvRow } from '@/lib/admin/environment-types';

const OPT = { production: 'optional', preview: 'optional', local: 'optional' } as const;
const FIXED_NOW = () => new Date('2026-01-02T03:04:05.000Z');

function cfg(name: string, shape: Exclude<EnvConfigShape, 'enum'>): EnvCatalogueEntry {
  return { name, group: 'features', role: 'Test entry.', sensitivity: 'config', shape, scope: 'server', expectedIn: OPT };
}
function cfgEnum(name: string, enumValues: string[]): EnvCatalogueEntry {
  return { name, group: 'features', role: 'Test entry.', sensitivity: 'config', shape: 'enum', enumValues, scope: 'server', expectedIn: OPT };
}
function flagEntry(name: string, flagParser: 'lenient' | 'strict-true', flagDefault: boolean): EnvCatalogueEntry {
  return { name, group: 'features', role: 'Test entry.', sensitivity: 'flag', flagParser, flagDefault, scope: 'server', expectedIn: OPT };
}
function secretEntry(name: string): EnvCatalogueEntry {
  return { name, group: 'tokens', role: 'Test entry.', sensitivity: 'secret', scope: 'server', expectedIn: OPT };
}
function personalEntry(name: string, personalKind: 'single' | 'list-admin-emails' | 'list-boost-accounts'): EnvCatalogueEntry {
  return { name, group: 'admin', role: 'Test entry.', sensitivity: 'personal', personalKind, scope: 'server', expectedIn: OPT };
}

/** Classify one injected entry with one value; return its display. */
function displayOf(entry: EnvCatalogueEntry, value: string | undefined): EnvDisplay {
  const env: EnvSource = value === undefined ? {} : { [entry.name]: value };
  const { payload } = classifyEnvironment(env, { catalogue: [entry], now: FIXED_NOW });
  const row = payload.groups.flatMap((g) => g.rows).find((r) => r.name === entry.name);
  if (!row) throw new Error('row missing');
  return row.display;
}

function allRows(env: EnvSource): EnvRow[] {
  const { payload } = classifyEnvironment(env, { now: FIXED_NOW });
  return [...payload.groups.flatMap((g) => g.rows), ...payload.uncategorised];
}

const HIDDEN = { kind: 'hidden', reason: 'not-plain-config' };

describe('classifyEnvironment: the name pattern (SA-C1)', () => {
  it('C-1 masks a config entry whose name contains SECRET, even with a plain value', () => {
    const d = displayOf(cfg('SOME_SECRET_MODE', 'identifier'), 'plainword');
    expect(d).toEqual({ kind: 'status', set: true });
    expect(JSON.stringify(d)).not.toContain('plainword');
  });

  it('C-2 a NEXT_PUBLIC_ prefix does not lift the rule', () => {
    expect(displayOf(cfg('NEXT_PUBLIC_THING_KEY', 'identifier'), 'plainword')).toEqual({ kind: 'status', set: true });
  });

  it('C-3 every token, in any case, makes an uncatalogued name status-only', () => {
    for (const token of SECRET_NAME_TOKENS) {
      for (const name of [`X_${token}_Y`, `x_${token.toLowerCase()}_y`]) {
        expect(nameLooksSecret(name)).toBe(true);
        const { payload } = classifyEnvironment({ [name]: 'plainword' }, { catalogue: [cfg('UNRELATED', 'identifier')], isNoise: () => false });
        expect(payload.uncategorised).toHaveLength(1);
        expect(payload.uncategorised[0].display).toEqual({ kind: 'status', set: true });
      }
    }
  });

  it('C-3b a personal entry whose name matches is status, not a count', () => {
    expect(displayOf(personalEntry('ACCOUNT_TOKEN_LIST', 'list-boost-accounts'), 'a,b,c')).toEqual({ kind: 'status', set: true });
  });

  it('C-4 a flag whose name matches still shows On / Off', () => {
    expect(displayOf(flagEntry('ALLOW_SESSION_THING', 'lenient', false), 'true')).toEqual({ kind: 'flag', state: 'on', source: 'set' });
  });
});

describe('classifyEnvironment: config shape gates (SA-C2, SA-C4, RC-2)', () => {
  it('C-5 hides a JWT-shaped value', () => {
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'eyJfakeHeader.eyJfakePayload.fakeSignatureXyz')).toEqual(HIDDEN);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'eyJ.x')).toEqual(HIDDEN);
    // SA CR-2: the opening is caught anywhere, not only at the start or after a dot.
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'prefix:eyJfakeHeader.fakePayload_with-dash.sig')).toEqual(HIDDEN);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'path/eyJfake.x')).toEqual(HIDDEN);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'fakeSegOne_.fakeSegTwo-.fakeSegThree')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), 'fakeSegOne1.fakeSegTwo2.fakeSegThree')).toEqual(HIDDEN);
    // An ordinary three-label host stays visible.
    expect(displayOf(cfg('H_X', 'host'), 'deploy-x.example.test')).toEqual({ kind: 'shown', text: 'deploy-x.example.test' });
  });

  it('C-6 hides an unbroken run of 40 key characters, shows 39', () => {
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'A'.repeat(40))).toEqual(HIDDEN);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), 'A'.repeat(39))).toEqual({ kind: 'shown', text: 'A'.repeat(39) });
  });

  it('C-7 hides over-long values, whitespace and every quote character', () => {
    const long = 'a-'.repeat(Math.ceil((MAX_SHOWN_LENGTH + 1) / 2)).slice(0, MAX_SHOWN_LENGTH + 1);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), long)).toEqual(HIDDEN);
    for (const bad of ['two words', 'tab\there', "it's", 'say"hi', 'back`tick']) {
      expect(displayOf(cfg('PLAIN_ID', 'identifier'), bad)).toEqual(HIDDEN);
    }
  });

  it('C-8 reduces a URL to its origin (user-info, path, query, fragment dropped)', () => {
    const d = displayOf(cfg('APP_ADDRESS', 'url'), 'https://fakeuser:fakepw@example.test:8443/hook/fakepath?q=fakequery#frag');
    expect(d).toEqual({ kind: 'shown', text: 'https://example.test:8443' });
  });

  it('C-9 hides a URL that does not parse, and a non-http scheme', () => {
    expect(displayOf(cfg('APP_ADDRESS', 'url'), 'not a url')).toEqual(HIDDEN);
    expect(displayOf(cfg('APP_ADDRESS', 'url'), 'notaurl')).toEqual(HIDDEN);
    expect(displayOf(cfg('APP_ADDRESS', 'url'), 'ftp://example.test')).toEqual(HIDDEN);
    // SA QF-2: parses as a URL, but is not an address.
    expect(displayOf(cfg('APP_ADDRESS', 'url'), 'https:opaqueword')).toEqual(HIDDEN);
    expect(displayOf(cfg('APP_ADDRESS', 'url'), 'HTTPS://Example.test/x')).toEqual({ kind: 'shown', text: 'https://example.test' });
  });

  it('C-10 shows an enum in the catalogue spelling; hides an out-of-set value', () => {
    expect(displayOf(cfgEnum('MODE_X', ['alpha', 'beta']), '  BETA ')).toEqual({ kind: 'shown', text: 'beta' });
    expect(displayOf(cfgEnum('MODE_X', ['alpha', 'beta']), 'gamma')).toEqual(HIDDEN);
  });

  it('C-11 gitSha: 40 hex shown, 39 hidden; identifier given 40 hex hidden by the run rule', () => {
    const sha = 'abcdef0123456789abcdef0123456789abcdef01';
    expect(displayOf(cfg('COMMIT_X', 'gitSha'), sha)).toEqual({ kind: 'shown', text: sha });
    expect(displayOf(cfg('COMMIT_X', 'gitSha'), sha.slice(1))).toEqual(HIDDEN);
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), sha)).toEqual(HIDDEN);
  });

  it('C-12 integer, host, region and identifier positive and negative cases', () => {
    expect(displayOf(cfg('N_X', 'integer'), '465')).toEqual({ kind: 'shown', text: '465' });
    expect(displayOf(cfg('N_X', 'integer'), '4.5')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), 'mail.example.test:587')).toEqual({ kind: 'shown', text: 'mail.example.test:587' });
    expect(displayOf(cfg('H_X', 'host'), 'https://example.test')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), '12345')).toEqual(HIDDEN);
    expect(displayOf(cfg('R_X', 'region'), 'abc1')).toEqual({ kind: 'shown', text: 'abc1' });
    expect(displayOf(cfg('R_X', 'region'), 'xx-west-2')).toEqual({ kind: 'shown', text: 'xx-west-2' });
    expect(displayOf(cfg('R_X', 'region'), 'somewhereelse')).toEqual(HIDDEN);
    expect(displayOf(cfg('I_X', 'identifier'), 'feature/some-branch')).toEqual({ kind: 'shown', text: 'feature/some-branch' });
    // RC-2: an address-shaped value under an identifier entry is hidden.
    expect(displayOf(cfg('I_X', 'identifier'), 'someone@example.test')).toEqual(HIDDEN);
  });

  it('C-12b SA QF-1: key-shaped mixed runs are hidden under identifier and host; capitals hide a host', () => {
    // Hidden: an sk-proj style fake broken up by dashes, an AWS-access-key-shaped fake, a capitalised host.
    expect(displayOf(cfg('I_X', 'identifier'), 'sk-proj-FAKEab12CDef34GHij56KLmn-78opQRst90UVwx')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), 'ZZFAKEKEY0EXAMPLE123')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), 'Mail.Example.test')).toEqual(HIDDEN);
    expect(displayOf(cfg('H_X', 'host'), 'mailFAKEab12CDef34GHij56.example.test')).toEqual(HIDDEN);
    // Still shown: a Google-style lower-case client id, a UUID, a branch name.
    const googleStyle = '123456789012-abcdefghij0123456789abcdefghij.apps.example.test';
    expect(displayOf(cfg('I_X', 'identifier'), googleStyle)).toEqual({ kind: 'shown', text: googleStyle });
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(displayOf(cfg('I_X', 'identifier'), uuid)).toEqual({ kind: 'shown', text: uuid });
    expect(displayOf(cfg('I_X', 'identifier'), 'feature/some-branch')).toEqual({ kind: 'shown', text: 'feature/some-branch' });
    // A 19-character mixed run is below the floor.
    expect(displayOf(cfg('I_X', 'identifier'), 'Ab1Ab1Ab1Ab1Ab1Ab1A')).toEqual({ kind: 'shown', text: 'Ab1Ab1Ab1Ab1Ab1Ab1A' });
  });

  it('an unset config is Not set, never hidden', () => {
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), undefined)).toEqual({ kind: 'status', set: false });
    expect(displayOf(cfg('PLAIN_ID', 'identifier'), '   ')).toEqual({ kind: 'status', set: false });
  });
});

describe('classifyEnvironment: personal (OQ-10)', () => {
  it('C-13 ADMIN_EMAILS-style list counts with parseAdminEmails', () => {
    const raw = 'a@example.test, b@example.test;;c@example.test  ,';
    const entry = { ...personalEntry('ADMIN_LIST_X', 'list-admin-emails'), seeAlsoPath: '/admin/settings' } as EnvCatalogueEntry;
    const { payload } = classifyEnvironment({ ADMIN_LIST_X: raw }, { catalogue: [entry] });
    const row = payload.groups.flatMap((g) => g.rows)[0];
    expect(row.display).toEqual({ kind: 'count', entries: parseAdminEmails(raw).size });
    expect(row.seeAlsoPath).toBe('/admin/settings');
    expect(JSON.stringify(payload)).not.toContain('example.test');
  });

  it('the real ADMIN_EMAILS entry links to Admin users', () => {
    const row = allRows({ ADMIN_EMAILS: 'a@example.test' }).find((r) => r.name === 'ADMIN_EMAILS');
    expect(row?.display).toEqual({ kind: 'count', entries: 1 });
    expect(row?.seeAlsoPath).toBe('/admin/settings');
  });

  it('C-14 / D-10 the boost list counts valid account ids only, as the checkout does; unset is Not set', () => {
    const e = personalEntry('LIST_X', 'list-boost-accounts');
    const idA = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const idB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(displayOf(e, `${idA}, someone@example.test ,${idB}`)).toEqual({ kind: 'count', entries: 2 });
    expect(displayOf(e, `${idA},${idA.toUpperCase()}`)).toEqual({ kind: 'count', entries: 1 });
    expect(displayOf(e, 'someone@example.test,other@example.test')).toEqual({ kind: 'count', entries: 0 });
    expect(displayOf(e, undefined)).toEqual({ kind: 'status', set: false });
    expect(displayOf(e, '   ')).toEqual({ kind: 'status', set: false });
  });

  it('C-15 a single personal value is Set / Not set', () => {
    expect(displayOf(personalEntry('ONE_X', 'single'), 'someone@example.test')).toEqual({ kind: 'status', set: true });
    expect(displayOf(personalEntry('ONE_X', 'single'), undefined)).toEqual({ kind: 'status', set: false });
  });
});

describe('classifyEnvironment: flags (SA-C3, Q-1)', () => {
  it('C-16 lenient parser', () => {
    const e = flagEntry('LENIENT_X', 'lenient', false);
    expect(displayOf(e, undefined)).toEqual({ kind: 'flag', state: 'off', source: 'default' });
    expect(displayOf(e, 'TRUE')).toEqual({ kind: 'flag', state: 'on', source: 'set' });
    expect(displayOf(e, ' 1 ')).toEqual({ kind: 'flag', state: 'on', source: 'set' });
    expect(displayOf(e, '0')).toEqual({ kind: 'flag', state: 'off', source: 'set' });
    expect(displayOf(e, 'false')).toEqual({ kind: 'flag', state: 'off', source: 'set' });
    expect(displayOf(e, 'yes')).toEqual({ kind: 'flag', state: 'off', source: 'unrecognised' });
    expect(displayOf(e, '')).toEqual({ kind: 'flag', state: 'off', source: 'default' });
    const onByDefault = flagEntry('LENIENT_Y', 'lenient', true);
    expect(displayOf(onByDefault, undefined)).toEqual({ kind: 'flag', state: 'on', source: 'default' });
    expect(displayOf(onByDefault, 'yes')).toEqual({ kind: 'flag', state: 'on', source: 'unrecognised' });
  });

  it('C-17 strict-true parser', () => {
    const e = flagEntry('STRICT_X', 'strict-true', false);
    expect(displayOf(e, 'true')).toEqual({ kind: 'flag', state: 'on', source: 'set' });
    expect(displayOf(e, 'TRUE')).toEqual({ kind: 'flag', state: 'off', source: 'unrecognised' });
    expect(displayOf(e, '1')).toEqual({ kind: 'flag', state: 'off', source: 'unrecognised' });
    expect(displayOf(e, 'false')).toEqual({ kind: 'flag', state: 'off', source: 'set' });
    expect(displayOf(e, undefined)).toEqual({ kind: 'flag', state: 'off', source: 'default' });
  });

  it('C-18 a flag display carries kind, state and source only', () => {
    const d = displayOf(flagEntry('LENIENT_X', 'lenient', false), 'FAKE-flag-garbage-value');
    expect(Object.keys(d).sort()).toEqual(['kind', 'source', 'state']);
    expect(JSON.stringify(d)).not.toContain('FAKE');
  });
});

describe('classifyEnvironment: errors fail closed (SA-C6, M-4)', () => {
  it('C-19 a row that throws is hidden, its error reported by class only', () => {
    const bad = { ...cfg('BROKEN_X', 'identifier'), shape: 'no-such-shape' } as unknown as EnvCatalogueEntry;
    const { payload, rowErrors } = classifyEnvironment({ BROKEN_X: 'FAKE-row-secret-zzz' }, { catalogue: [bad] });
    expect(payload.groups.flatMap((g) => g.rows)[0].display).toEqual({ kind: 'hidden', reason: 'classification-error' });
    expect(rowErrors).toEqual([{ name: 'BROKEN_X', errorClass: 'EnvClassificationError' }]);
    expect(JSON.stringify({ payload, rowErrors })).not.toContain('FAKE-row-secret');
  });

  it('an unknown sensitivity masks too', () => {
    const bad = { ...cfg('ODD_X', 'identifier'), sensitivity: 'mystery' } as unknown as EnvCatalogueEntry;
    const { payload, rowErrors } = classifyEnvironment({ ODD_X: 'plainword' }, { catalogue: [bad] });
    expect(payload.groups.flatMap((g) => g.rows)[0].display).toEqual({ kind: 'hidden', reason: 'classification-error' });
    expect(rowErrors).toHaveLength(1);
  });

  it('an empty catalogue throws: never an unmasked list', () => {
    expect(() => classifyEnvironment({ ANY: 'x' }, { catalogue: [] })).toThrow();
  });
});

describe('classifyEnvironment: precedence and the deny-list (OQ-4, RC-1)', () => {
  it('C-20 a catalogued name that the deny-list would match is listed, not counted', () => {
    const rows = allRows({ VERCEL_ENV: 'preview', AWS_REGION: 'xx-west-2', NODE_ENV: 'production' });
    for (const name of ['VERCEL_ENV', 'AWS_REGION', 'NODE_ENV']) {
      expect(rows.find((r) => r.name === name)?.group).not.toBe('uncategorised');
    }
    const { payload } = classifyEnvironment({ VERCEL_ENV: 'preview', AWS_REGION: 'xx-west-2', NODE_ENV: 'production' });
    expect(payload.counts.platformHidden).toBe(0);
  });

  it('C-21 platform names in any case are counted, not listed', () => {
    const env = { Path: 'x', windir: 'x', npm_config_cache: 'x', AWS_SESSION_TOKEN: 'FAKE-session-token-value' };
    const { payload } = classifyEnvironment(env);
    expect(payload.counts.platformHidden).toBe(4);
    const text = JSON.stringify(payload);
    for (const name of Object.keys(env)) expect(text).not.toContain(`"${name}"`);
    expect(text).not.toContain('FAKE-session');
  });

  it('C-21b RC-1: an uncatalogued NEXT_PUBLIC_ name is Uncategorised, not hidden', () => {
    const { payload } = classifyEnvironment({ NEXT_PUBLIC_SOMETHING_NEW: 'plainword', NEXT_RUNTIME: 'nodejs' });
    expect(payload.uncategorised.map((r) => r.name)).toEqual(['NEXT_PUBLIC_SOMETHING_NEW']);
    expect(payload.uncategorised[0].display).toEqual({ kind: 'status', set: true });
    expect(payload.uncategorised[0].scope).toBe('browser-inlined');
    expect(payload.counts.platformHidden).toBe(1);
  });

  it('C-21c SA CR-3: app names that share a tool prefix stay in Uncategorised, masked', () => {
    const appNames = ['CLAUDE_MODEL', 'ONEDRIVE_CLIENT_ID', 'PYTHON_SERVICE_URL', 'PROGRAM_NAME'];
    const toolNames = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'OneDrive', 'PYTHONPATH', 'ProgramFiles(x86)', 'CommonProgramW6432'];
    const env: Record<string, string> = {};
    for (const name of [...appNames, ...toolNames]) env[name] = 'plainword';
    const { payload } = classifyEnvironment(env);
    expect(payload.uncategorised.map((r) => r.name)).toEqual([...appNames].sort());
    for (const row of payload.uncategorised) expect(row.display).toEqual({ kind: 'status', set: true });
    expect(payload.counts.platformHidden).toBe(toolNames.length);
  });

  it('C-22 an uncatalogued non-noise name is Uncategorised, masked, with the fixed role', () => {
    const { payload } = classifyEnvironment({ ZEBRA_SETTING: 'plainword', ALPHA_SETTING: '' });
    expect(payload.uncategorised.map((r) => r.name)).toEqual(['ALPHA_SETTING', 'ZEBRA_SETTING']);
    expect(payload.uncategorised[1]).toEqual({
      name: 'ZEBRA_SETTING',
      group: 'uncategorised',
      role: UNCATALOGUED_ROLE,
      sensitivity: 'secret',
      scope: 'server',
      expectedIn: null,
      display: { kind: 'status', set: true },
      diagnostics: [],
    });
    expect(payload.uncategorised[0].display).toEqual({ kind: 'status', set: false });
  });

  it('C-22b SA QF-3: a lower-case next_public_ name is listed (not noise) with scope server', () => {
    const { payload } = classifyEnvironment({ next_public_x: 'plainword' });
    expect(payload.uncategorised.map((r) => [r.name, r.scope])).toEqual([['next_public_x', 'server']]);
    expect(payload.counts.platformHidden).toBe(0);
  });

  it('C-23 every catalogued entry appears even when the environment is empty', () => {
    const rows = allRows({});
    expect(rows).toHaveLength(ENVIRONMENT_CATALOGUE.length);
    for (const row of rows) {
      if (row.display.kind === 'flag') expect(row.display.source).toBe('default');
      else expect(row.display).toEqual({ kind: 'status', set: false });
    }
  });
});

describe('classifyEnvironment: label, facts, order, counts', () => {
  it.each([
    [{ VERCEL_ENV: 'production', NODE_ENV: 'production' }, 'production'],
    [{ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, 'preview'],
    [{ VERCEL_ENV: 'development' }, 'vercel-development'],
    [{ NODE_ENV: 'development' }, 'local'],
    [{ NODE_ENV: 'production' }, 'unknown'],
    [{ VERCEL_ENV: 'something-else' }, 'unknown'],
    [{}, 'unknown'],
  ])('C-24 %j is %s', (env, label) => {
    expect(environmentLabelOf(env as EnvSource)).toBe(label);
  });

  it('C-25 facts come from shown rows only', () => {
    const sha = 'abcdef0123456789abcdef0123456789abcdef01';
    const { payload } = classifyEnvironment({
      VERCEL_URL: 'deploy-x.example.test',
      VERCEL_REGION: 'abc1',
      VERCEL_GIT_COMMIT_REF: 'feature/x',
      VERCEL_GIT_COMMIT_SHA: sha,
    });
    expect(payload.environment.facts).toEqual({ host: 'deploy-x.example.test', region: 'abc1', branch: 'feature/x', commit: sha });
    const hidden = classifyEnvironment({ VERCEL_URL: 'not a host', VERCEL_GIT_COMMIT_SHA: 'nothex' });
    expect(hidden.payload.environment.facts).toEqual({ host: null, region: null, branch: null, commit: null });
  });

  it('C-26 groups follow the catalogue order and Uncategorised is always an array', () => {
    const { payload } = classifyEnvironment({});
    expect(payload.groups.map((g) => g.id)).toEqual([...ENVIRONMENT_GROUP_ORDER]);
    expect(payload.uncategorised).toEqual([]);
    expect(payload.generatedAt).toEqual(expect.any(String));
  });

  it('C-27 counts agree with the rows', () => {
    const env = { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'FAKE-x', NEW_THING: 'y', Path: 'p' };
    const { payload } = classifyEnvironment(env, { now: FIXED_NOW });
    expect(payload.counts).toEqual({
      rows: ENVIRONMENT_CATALOGUE.length + 1,
      set: 3,
      notSet: ENVIRONMENT_CATALOGUE.length + 1 - 3,
      uncategorised: 1,
      platformHidden: 1,
      // NODE_ENV=production with no VERCEL_ENV is an Unknown label: not checked (SA Q4-8).
      requiredNotSet: null,
      shouldNotBeSet: null,
      unrecognisedFlags: 0,
      surroundingWhitespace: 0,
    });
    expect(payload.generatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('C-28 the classifier never names the global environment and is server-only', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'classifyEnvironment.ts'), 'utf8');
    expect(source).not.toMatch(/process\s*\.\s*env/);
    expect(source).toMatch(/^\s*import 'server-only';/m);
  });
});

// ── EC-4 diagnostics (workplan §4.3; SA Q4-1 to Q4-9, E4-1, E4-3) ──────────────

const LABEL_ENV: Record<'production' | 'preview' | 'local' | 'vercel-development' | 'unknown', EnvSource> = {
  production: { VERCEL_ENV: 'production', NODE_ENV: 'production' },
  preview: { VERCEL_ENV: 'preview', NODE_ENV: 'production' },
  local: { NODE_ENV: 'development' },
  'vercel-development': { VERCEL_ENV: 'development' },
  unknown: { NODE_ENV: 'production' },
};

function withExpect(entry: EnvCatalogueEntry, p: 'R' | 'O' | 'X', v: 'R' | 'O' | 'X', l: 'R' | 'O' | 'X'): EnvCatalogueEntry {
  const word = { R: 'required', O: 'optional', X: 'forbidden' } as const;
  return { ...entry, expectedIn: { production: word[p], preview: word[v], local: word[l] } } as EnvCatalogueEntry;
}

/** The single injected row, classified under a label, with an optional value. */
function rowUnder(entry: EnvCatalogueEntry, label: keyof typeof LABEL_ENV, value?: string) {
  const env: Record<string, string | undefined> = { ...LABEL_ENV[label] };
  if (value !== undefined) env[entry.name] = value;
  const { payload } = classifyEnvironment(env, { catalogue: [entry], now: FIXED_NOW });
  return { row: payload.groups.flatMap((g) => g.rows)[0], payload };
}

const CODES = ['required-not-set', 'should-not-be-set', 'unrecognised-flag', 'surrounding-whitespace'];

describe('classifyEnvironment: EC-4 diagnostics', () => {
  it('D-1 required and unset is flagged only where it is required, and counted', () => {
    const e = withExpect(cfg('REQ_X', 'identifier'), 'R', 'O', 'O');
    expect(rowUnder(e, 'production').row.diagnostics).toEqual(['required-not-set']);
    expect(rowUnder(e, 'production').payload.counts.requiredNotSet).toBe(1);
    expect(rowUnder(e, 'preview').row.diagnostics).toEqual([]);
    expect(rowUnder(e, 'preview').payload.counts.requiredNotSet).toBe(0);
    expect(rowUnder(e, 'local').row.diagnostics).toEqual([]);
    expect(rowUnder(e, 'production', 'plainword').row.diagnostics).toEqual([]);
    // Whitespace only is not set (EC-1 rule), so still required-not-set, plus M-7 (c).
    expect(rowUnder(e, 'production', '   ').row.diagnostics).toEqual(['required-not-set', 'surrounding-whitespace']);
  });

  it('D-2 forbidden and set is flagged only there; unset is not', () => {
    const e = withExpect(secretEntry('FORBID_X'), 'X', 'O', 'O');
    expect(rowUnder(e, 'production', 'FAKE-forbidden-zz').row.diagnostics).toEqual(['should-not-be-set']);
    expect(rowUnder(e, 'production', 'FAKE-forbidden-zz').payload.counts.shouldNotBeSet).toBe(1);
    expect(rowUnder(e, 'preview', 'FAKE-forbidden-zz').row.diagnostics).toEqual([]);
    expect(rowUnder(e, 'production').row.diagnostics).toEqual([]);
  });

  it('D-3 an Unknown label checks no expectation: checkedAgainst and both counts are null; value checks stay on', () => {
    const req = withExpect(cfg('REQ_X', 'identifier'), 'R', 'R', 'R');
    const forbid = withExpect(flagEntry('FORBID_FLAG', 'lenient', false), 'X', 'X', 'X');
    const { payload } = classifyEnvironment({ NODE_ENV: 'production', FORBID_FLAG: ' maybe ' }, { catalogue: [req, forbid] });
    expect(payload.environment.label).toBe('unknown');
    expect(payload.environment.checkedAgainst).toBeNull();
    expect(payload.counts.requiredNotSet).toBeNull();
    expect(payload.counts.shouldNotBeSet).toBeNull();
    const rows = payload.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.name === 'REQ_X')?.diagnostics).toEqual([]);
    // SA Q4-2: the unrecognised-flag and whitespace checks do not depend on the label.
    expect(rows.find((r) => r.name === 'FORBID_FLAG')?.diagnostics).toEqual(['unrecognised-flag', 'surrounding-whitespace']);
    expect(payload.counts.unrecognisedFlags).toBe(1);
    expect(payload.counts.surroundingWhitespace).toBe(1);
  });

  it('D-4 vercel-development is checked against local (SA Q4-1); the other labels against their own column', () => {
    expect(checkedAgainstOf('vercel-development')).toBe('local');
    expect(checkedAgainstOf('local')).toBe('local');
    expect(checkedAgainstOf('production')).toBe('production');
    expect(checkedAgainstOf('preview')).toBe('preview');
    expect(checkedAgainstOf('unknown')).toBeNull();
    const e = withExpect(cfg('REQ_LOCAL', 'identifier'), 'O', 'O', 'R');
    expect(rowUnder(e, 'vercel-development').row.diagnostics).toEqual(['required-not-set']);
    expect(rowUnder(e, 'vercel-development').payload.environment.checkedAgainst).toBe('local');
  });

  it('D-5 an unrecognised flag value is a code; a recognised or unset flag is not', () => {
    const lenient = flagEntry('LEN_X', 'lenient', false);
    const strict = flagEntry('STR_X', 'strict-true', false);
    expect(rowUnder(lenient, 'production', 'FAKE-garbage').row.diagnostics).toEqual(['unrecognised-flag']);
    expect(rowUnder(strict, 'production', 'TRUE').row.diagnostics).toEqual(['unrecognised-flag']);
    expect(rowUnder(lenient, 'production', 'true').row.diagnostics).toEqual([]);
    expect(rowUnder(lenient, 'production').row.diagnostics).toEqual([]);
  });

  it('D-6 surrounding whitespace on every catalogued class (M-7); internal whitespace alone is not a code', () => {
    const entries = [
      secretEntry('S_X'),
      cfg('C_SHOWN', 'identifier'),
      cfg('C_HIDDEN', 'integer'),
      flagEntry('F_X', 'lenient', false),
      personalEntry('P_X', 'single'),
    ];
    for (const entry of entries) {
      for (const pad of [' ', '\t', '\r', '\n', '\r\n']) {
        expect({ name: entry.name, codes: rowUnder(entry, 'local', `${pad}FAKEvalue1`).row.diagnostics }).toEqual({
          name: entry.name,
          codes: entry.sensitivity === 'flag' ? ['unrecognised-flag', 'surrounding-whitespace'] : ['surrounding-whitespace'],
        });
        expect(rowUnder(entry, 'local', `FAKEvalue1${pad}`).row.diagnostics).toContain('surrounding-whitespace');
      }
      expect(rowUnder(entry, 'local', 'FAKE value').row.diagnostics).not.toContain('surrounding-whitespace');
    }
    // The shown text stays trimmed, as in EC-1; the code adds one boolean only.
    expect(rowUnder(cfg('C_SHOWN', 'identifier'), 'local', ' plainword\n').row.display).toEqual({ kind: 'shown', text: 'plainword' });
  });

  it('D-7 a forbidden flag set to an off value is still flagged (SA Q4-4, literal FR-18)', () => {
    const e = withExpect(flagEntry('TEST_FLAG_X', 'lenient', false), 'X', 'X', 'O');
    expect(rowUnder(e, 'production', 'false').row.diagnostics).toEqual(['should-not-be-set']);
    expect(rowUnder(e, 'production', 'true').row.diagnostics).toEqual(['should-not-be-set']);
    expect(rowUnder(e, 'local', 'true').row.diagnostics).toEqual([]);
  });

  it('D-8 the four counts equal the tallies of codes in the rows', () => {
    const env: EnvSource = {
      VERCEL_ENV: 'production',
      NODE_ENV: 'production',
      NODE_TLS_REJECT_UNAUTHORIZED: 'FAKE-tls-zz',
      ADMIN_BUSINESS_DELETE_ENABLED: 'FAKE-garbage',
      STRIPE_SECRET_KEY: ' FAKE-padded-key ',
    };
    const { payload } = classifyEnvironment(env, { now: FIXED_NOW });
    const rows = payload.groups.flatMap((g) => g.rows);
    const count = (code: string) => rows.filter((r) => r.diagnostics.includes(code as never)).length;
    expect(payload.counts.requiredNotSet).toBe(count('required-not-set'));
    expect(payload.counts.requiredNotSet).toBeGreaterThan(0);
    expect(payload.counts.shouldNotBeSet).toBe(count('should-not-be-set'));
    expect(rows.find((r) => r.name === 'NODE_TLS_REJECT_UNAUTHORIZED')?.diagnostics).toEqual(['should-not-be-set']);
    expect(payload.counts.unrecognisedFlags).toBe(count('unrecognised-flag'));
    expect(payload.counts.surroundingWhitespace).toBe(count('surrounding-whitespace'));
    expect(payload.counts.surroundingWhitespace).toBe(1);
  });

  it('D-9 every row: distinct codes from the closed set in the fixed order; uncategorised rows always []', () => {
    // A fake preview-forbidden secret beside the real catalogue. (The real one of that
    // shape is pinned to a single reader by its own guard, so this test does not name it.)
    const previewForbidden = withExpect(secretEntry('FAKE_PREVIEW_FORBIDDEN'), 'O', 'X', 'O');
    const env: EnvSource = {
      VERCEL_ENV: 'preview',
      FAKE_PREVIEW_FORBIDDEN: ' FAKE-x ',
      ZZ_PADDED_UNCATALOGUED: ' FAKE-y ',
      ADMIN_BUSINESS_DELETE_ENABLED: ' nope ',
    };
    const { payload } = classifyEnvironment(env, { catalogue: [...ENVIRONMENT_CATALOGUE, previewForbidden], now: FIXED_NOW });
    for (const row of payload.groups.flatMap((g) => g.rows)) {
      expect(new Set(row.diagnostics).size).toBe(row.diagnostics.length);
      const order = row.diagnostics.map((c) => CODES.indexOf(c));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    expect(payload.groups.flatMap((g) => g.rows).find((r) => r.name === 'FAKE_PREVIEW_FORBIDDEN')?.diagnostics).toEqual([
      'should-not-be-set',
      'surrounding-whitespace',
    ]);
    expect(payload.uncategorised.map((r) => [r.name, r.diagnostics])).toEqual([['ZZ_PADDED_UNCATALOGUED', []]]);
  });

  it('D-11 a row whose classification throws carries no diagnostics', () => {
    const bad = withExpect({ ...cfg('BROKEN_X', 'identifier'), shape: 'no-such-shape' } as unknown as EnvCatalogueEntry, 'O', 'O', 'O');
    const { row } = rowUnder(bad, 'production', ' FAKE-row-secret ');
    expect(row.display).toEqual({ kind: 'hidden', reason: 'classification-error' });
    expect(row.diagnostics).toEqual([]);
  });

  it('E4-3 every row has exactly the DTO keys: nothing spread from the entry', () => {
    const required = ['diagnostics', 'display', 'expectedIn', 'group', 'name', 'role', 'scope', 'sensitivity'];
    const optional = ['docLink', 'seeAlsoPath'];
    const { payload } = classifyEnvironment({ VERCEL_ENV: 'production', ZZ_ODD: 'x' }, { now: FIXED_NOW });
    for (const row of [...payload.groups.flatMap((g) => g.rows), ...payload.uncategorised]) {
      const keys = Object.keys(row).sort();
      expect({ name: row.name, missing: required.filter((k) => !keys.includes(k)) }).toEqual({ name: row.name, missing: [] });
      expect({ name: row.name, extra: keys.filter((k) => !required.includes(k) && !optional.includes(k)) }).toEqual({ name: row.name, extra: [] });
      expect(Object.keys(row.display).every((k) => ['kind', 'text', 'set', 'state', 'source', 'entries', 'reason'].includes(k))).toBe(true);
    }
    // `consumedBy`, `shape`, `flagParser` and other catalogue fields never reach a row.
    expect(JSON.stringify(payload)).not.toMatch(/consumedBy|flagParser|personalKind|"shape"|enumValues/);
  });
});
