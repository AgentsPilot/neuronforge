/**
 * Words for the Environment page (admin environment view EC-2; workplan §2.7,
 * D2-1 to D2-4; SA E2-1, E2-2, Q2-2).
 */

import {
  checkedNote,
  describeDisplay,
  DIAGNOSTIC_WORDS,
  entriesWords,
  ENVIRONMENT_LABEL_WORDS,
  GROUP_FILTER_IDS,
  isEnvironmentViewPayload,
  isGroupFilter,
  kpiTiles,
  matchesSearch,
  platformHiddenLine,
  rowValueWords,
  scopeWords,
  seeAlsoLink,
  visibleView,
} from '../environmentDisplay';
import type { EnvDisplay, EnvironmentLabel, EnvironmentViewPayload, EnvRow } from '@/lib/admin/environment-types';

const ZERO_COUNTS = {
  rows: 0,
  set: 0,
  notSet: 0,
  uncategorised: 0,
  platformHidden: 0,
  requiredNotSet: 0,
  shouldNotBeSet: 0,
  unrecognisedFlags: 0,
  surroundingWhitespace: 0,
};

describe('environmentDisplay', () => {
  it('D2-1 every environment label has words and a tone; only Unknown is amber', () => {
    const labels: EnvironmentLabel[] = ['production', 'preview', 'vercel-development', 'local', 'unknown'];
    for (const label of labels) {
      expect(ENVIRONMENT_LABEL_WORDS[label].text.length).toBeGreaterThan(0);
    }
    expect(labels.filter((l) => ENVIRONMENT_LABEL_WORDS[l].tone === 'warn')).toEqual(['unknown']);
    expect(labels.filter((l) => ENVIRONMENT_LABEL_WORDS[l].tone === 'info')).toHaveLength(4);
  });

  it('D2-2 every display kind and reason has words', () => {
    const cases: Array<[EnvDisplay, { chip: string | null; note: string | null; mono: string | null }]> = [
      [{ kind: 'shown', text: 'example.test' }, { chip: null, note: null, mono: 'example.test' }],
      [{ kind: 'status', set: true }, { chip: 'Set', note: null, mono: null }],
      [{ kind: 'status', set: false }, { chip: 'Not set', note: null, mono: null }],
      [{ kind: 'flag', state: 'on', source: 'set' }, { chip: 'On', note: null, mono: null }],
      [{ kind: 'flag', state: 'off', source: 'default' }, { chip: 'Off', note: '(default)', mono: null }],
      [{ kind: 'flag', state: 'off', source: 'unrecognised' }, { chip: 'Off', note: 'Set, not a recognised value: reads as Off', mono: null }],
      // Q2-2: follows the state, so a default-on flag reads On.
      [{ kind: 'flag', state: 'on', source: 'unrecognised' }, { chip: 'On', note: 'Set, not a recognised value: reads as On', mono: null }],
      [{ kind: 'count', entries: 3 }, { chip: null, note: '3 entries', mono: null }],
      [{ kind: 'hidden', reason: 'not-plain-config' }, { chip: 'Set', note: 'Hidden: does not look like plain configuration', mono: null }],
      // E2-1: a classification error is not guaranteed set, so no Set chip.
      [{ kind: 'hidden', reason: 'classification-error' }, { chip: null, note: 'Hidden: could not be checked', mono: null }],
    ];
    for (const [display, expected] of cases) {
      const words = describeDisplay(display);
      expect({ display, chip: words.chip?.text ?? null, note: words.note, mono: words.mono }).toEqual({ display, ...expected });
    }
    expect(describeDisplay({ kind: 'status', set: false }).chip?.tone).toBe('unknown');
  });

  it('D2-3 count, scope and platform wording', () => {
    expect(entriesWords(1)).toBe('1 entry');
    expect(entriesWords(0)).toBe('0 entries');
    expect(entriesWords(12)).toBe('12 entries');
    expect(scopeWords('browser-inlined')).toBe('Built into the browser bundle');
    expect(scopeWords('server')).toBe('Server');
    expect(platformHiddenLine(12)).toBe('12 settings set by the hosting platform or operating system are not shown.');
    expect(platformHiddenLine(1)).toBe('1 setting set by the hosting platform or operating system is not shown.');
    expect(platformHiddenLine(0)).toMatch(/^No settings/);
  });

  it('D2-4 only shown.text reaches the words; nothing else carries a payload string', () => {
    // A display carrying an extra field (a malformed payload) never surfaces it.
    const smuggled = { kind: 'status', set: true, text: 'FAKE-smuggled-text' } as unknown as EnvDisplay;
    expect(JSON.stringify(describeDisplay(smuggled))).not.toContain('FAKE');
  });

  it('E2-2 links only paths on the allow-list', () => {
    expect(seeAlsoLink('/admin/settings')).toEqual({ href: '/admin/settings', label: 'See Admin users' });
    for (const path of ['/admin/other', 'https://example.test', 'javascript:alert(1)', '__proto__', 'constructor', '', undefined]) {
      expect({ path, link: seeAlsoLink(path) }).toEqual({ path, link: null });
    }
  });

  it('the payload guard accepts the shape and refuses anything else', () => {
    const good = {
      environment: { label: 'preview', checkedAgainst: 'preview', facts: { host: null, region: null, branch: null, commit: null } },
      groups: [],
      uncategorised: [],
      counts: ZERO_COUNTS,
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(isEnvironmentViewPayload(good)).toBe(true);
    expect(isEnvironmentViewPayload(null)).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, groups: null })).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, uncategorised: 'x' })).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, environment: { label: 'staging', facts: {} } })).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, counts: undefined })).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, counts: { ...good.counts, platformHidden: '12' } })).toBe(false);
    expect(isEnvironmentViewPayload({ ...good, counts: { rows: 0 } })).toBe(false);
  });

  it('QA §6.2: an unknown display kind gets the fixed words and echoes nothing', () => {
    const unknown = { kind: 'mystery', text: 'FAKE-echo-text', note: 'FAKE-echo-note', set: true } as unknown as EnvDisplay;
    expect(describeDisplay(unknown)).toEqual({ chip: null, mono: null, note: 'Hidden: could not be checked' });
    // An unknown hidden reason reads the same fixed words.
    const oddReason = { kind: 'hidden', reason: 'FAKE-reason' } as unknown as EnvDisplay;
    expect(describeDisplay(oddReason)).toEqual({ chip: null, mono: null, note: 'Hidden: could not be checked' });
  });

  it('QA §6.2: the guard checks every row, display and fact deeply', () => {
    const goodRow = { name: 'A_X', role: 'Role.', scope: 'server', group: 'features', sensitivity: 'config', expectedIn: null, display: { kind: 'shown', text: 'x' }, diagnostics: [] };
    const base = {
      environment: { label: 'preview', checkedAgainst: 'preview', facts: { host: 'h.example.test', region: null, branch: null, commit: null } },
      groups: [{ id: 'features', label: 'Feature switches', description: 'D.', rows: [goodRow] }],
      uncategorised: [goodRow],
      counts: { ...ZERO_COUNTS, rows: 2, set: 2, uncategorised: 1 },
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(isEnvironmentViewPayload(base)).toBe(true);
    const withRow = (row: unknown) => ({ ...base, groups: [{ ...base.groups[0], rows: [row] }] });
    const bad: Array<[string, unknown]> = [
      ['rows not an array', { ...base, groups: [{ ...base.groups[0], rows: 'nope' }] }],
      ['display null', withRow({ ...goodRow, display: null })],
      ['shown.text an object', withRow({ ...goodRow, display: { kind: 'shown', text: {} } })],
      ['status.set a string', withRow({ ...goodRow, display: { kind: 'status', set: 'yes' } })],
      ['flag state odd', withRow({ ...goodRow, display: { kind: 'flag', state: 'maybe', source: 'set' } })],
      ['count.entries a string', withRow({ ...goodRow, display: { kind: 'count', entries: '3' } })],
      ['hidden reason missing', withRow({ ...goodRow, display: { kind: 'hidden' } })],
      ['unknown kind', withRow({ ...goodRow, display: { kind: 'mystery' } })],
      ['name a number', withRow({ ...goodRow, name: 7 })],
      ['role missing', withRow({ ...goodRow, role: undefined })],
      ['scope odd', withRow({ ...goodRow, scope: 'client' })],
      ['seeAlsoPath an object', withRow({ ...goodRow, seeAlsoPath: {} })],
      ['group label missing', { ...base, groups: [{ ...base.groups[0], label: undefined }] }],
      ['uncategorised row bad', { ...base, uncategorised: [{ ...goodRow, display: null }] }],
      ['fact an object', { ...base, environment: { ...base.environment, facts: { ...base.environment.facts, host: {} } } }],
      ['fact missing', { ...base, environment: { ...base.environment, facts: { host: null } } }],
      ['platformHidden negative', { ...base, counts: { ...base.counts, platformHidden: -1 } }],
      // D4-4 (SA E4-3): codes, checkedAgainst and the EC-4 counts.
      ['diagnostics missing', withRow({ ...goodRow, diagnostics: undefined })],
      ['diagnostics not an array', withRow({ ...goodRow, diagnostics: 'required-not-set' })],
      ['an unknown code', withRow({ ...goodRow, diagnostics: ['FAKE-code'] })],
      ['a prototype key as a code', withRow({ ...goodRow, diagnostics: ['__proto__'] })],
      ['an unknown code on an uncategorised row', { ...base, uncategorised: [{ ...goodRow, diagnostics: ['toString'] }] }],
      ['checkedAgainst odd', { ...base, environment: { ...base.environment, checkedAgainst: 'staging' } }],
      ['checkedAgainst missing', { ...base, environment: { label: 'preview', facts: base.environment.facts } }],
      ['requiredNotSet a string', { ...base, counts: { ...base.counts, requiredNotSet: '1' } }],
      ['unrecognisedFlags null', { ...base, counts: { ...base.counts, unrecognisedFlags: null } }],
      ['surroundingWhitespace missing', { ...base, counts: { ...base.counts, surroundingWhitespace: undefined } }],
    ];
    for (const [label, payload] of bad) expect({ label, ok: isEnvironmentViewPayload(payload) }).toEqual({ label, ok: false });
    // SA Q4-8: exactly the two expectation counts may be null.
    expect(isEnvironmentViewPayload({ ...base, counts: { ...base.counts, requiredNotSet: null, shouldNotBeSet: null } })).toBe(true);
    expect(isEnvironmentViewPayload({ ...base, environment: { ...base.environment, checkedAgainst: null } })).toBe(true);
    expect(isEnvironmentViewPayload(withRow({ ...goodRow, diagnostics: ['required-not-set', 'surrounding-whitespace'] }))).toBe(true);
  });
});

// ── EC-4 (workplan §4.7 D4-1 to D4-5) ──────────────────────────────────────────

function payloadWith(rows: EnvRow[], counts: Partial<EnvironmentViewPayload['counts']> = {}, uncategorised: EnvRow[] = []): EnvironmentViewPayload {
  return {
    environment: { label: 'production', checkedAgainst: 'production', facts: { host: null, region: null, branch: null, commit: null } },
    groups: [
      { id: 'payments', label: 'Payments (Stripe)', description: 'D.', rows },
      { id: 'email', label: 'Email', description: 'D.', rows: [] },
    ],
    uncategorised,
    counts: { ...ZERO_COUNTS, ...counts },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function envRow(name: string, display: EnvDisplay, diagnostics: EnvRow['diagnostics'] = []): EnvRow {
  return { name, group: 'payments', role: 'Role.', sensitivity: 'secret', scope: 'server', expectedIn: null, display, diagnostics };
}

describe('environmentDisplay: EC-4', () => {
  it('D4-1 every code has fixed, non-empty words, and every warning is amber', () => {
    const codes = Object.keys(DIAGNOSTIC_WORDS);
    expect(codes.sort()).toEqual(['required-not-set', 'should-not-be-set', 'surrounding-whitespace', 'unrecognised-flag']);
    for (const code of codes) expect(DIAGNOSTIC_WORDS[code as keyof typeof DIAGNOSTIC_WORDS].text.length).toBeGreaterThan(5);

    const required = rowValueWords({ display: { kind: 'status', set: false }, diagnostics: ['required-not-set'] });
    expect(required.chip).toEqual({ text: 'Required, not set', tone: 'warn' });
    expect(required.warnings).toEqual([]);

    const flag = rowValueWords({ display: { kind: 'flag', state: 'off', source: 'unrecognised' }, diagnostics: ['unrecognised-flag', 'surrounding-whitespace'] });
    expect(flag.chip).toEqual({ text: 'Off', tone: 'neutral' });
    expect(flag.note).toBeNull();
    expect(flag.warnings.map((w) => [w.code, w.chip.text, w.chip.tone])).toEqual([
      ['unrecognised-flag', 'Set, not a recognised value: reads as Off', 'warn'],
      ['surrounding-whitespace', 'Spaces or line breaks around the value', 'warn'],
    ]);

    const forbidden = rowValueWords({ display: { kind: 'status', set: true }, diagnostics: ['should-not-be-set'] });
    expect(forbidden.chip?.text).toBe('Set');
    expect(forbidden.warnings.map((w) => w.chip)).toEqual([{ text: 'Should not be set on this environment', tone: 'warn' }]);
  });

  it('D4-2 tiles: amber above 0, neutral at 0, "not measured" at null, never green; targets follow the visible rows', () => {
    const rows = [
      envRow('A_REQ', { kind: 'status', set: false }, ['required-not-set']),
      envRow('B_PAD', { kind: 'status', set: true }, ['surrounding-whitespace']),
    ];
    const data = payloadWith(rows, { set: 1, rows: 2, notSet: 1, requiredNotSet: 1, shouldNotBeSet: 0, surroundingWhitespace: 1, uncategorised: 0 });
    const tiles = kpiTiles(data, visibleView(data, { group: '', search: '' }));
    expect(tiles.map((t) => [t.testId, t.value, t.status, t.href])).toEqual([
      ['kpi-set', '1', null, null],
      ['kpi-required-not-set', '1', 'amber', '#env-row-A_REQ'],
      ['kpi-should-not-be-set', '0', null, null],
      ['kpi-values-to-check', '1', 'amber', '#env-row-B_PAD'],
      ['kpi-uncategorised', '0', null, '#uncategorised'],
    ]);
    expect(tiles.some((t) => t.status === 'green')).toBe(false);
    expect(tiles[0].sub).toBe('of 2 listed');
    expect(tiles[3].sub).toBe('0 unrecognised switch values, 1 with spaces around');

    // Filtered out: the value stays, the link goes (K-6).
    const filtered = kpiTiles(data, visibleView(data, { group: '', search: 'B_' }));
    expect(filtered[1]).toMatchObject({ value: '1', status: 'amber', href: null });
    expect(filtered[3].href).toBe('#env-row-B_PAD');
    // Another group chosen: the Uncategorised card is hidden, so its tile has no target.
    expect(kpiTiles(data, visibleView(data, { group: 'email', search: '' }))[4].href).toBeNull();

    // Not checked (SA Q4-8).
    const unknown = { ...data, environment: { ...data.environment, label: 'unknown' as const, checkedAgainst: null }, counts: { ...data.counts, requiredNotSet: null, shouldNotBeSet: null } };
    const notChecked = kpiTiles(unknown, visibleView(unknown, { group: '', search: '' }));
    for (const tile of [notChecked[1], notChecked[2]]) {
      expect(tile).toMatchObject({ value: null, status: 'not_measured', href: null, sub: 'Not checked: the environment is not recognised' });
    }
  });

  it('D4-3 search matches the name only, case-insensitively and trimmed; the group filter narrows the cards', () => {
    expect(matchesSearch('STRIPE_SECRET_KEY', ' stripe ')).toBe(true);
    expect(matchesSearch('STRIPE_SECRET_KEY', 'Payments')).toBe(false);
    expect(matchesSearch('ANY', '')).toBe(true);
    const data = payloadWith([envRow('A_ONE', { kind: 'status', set: true }), envRow('B_TWO', { kind: 'status', set: true })], {}, [
      envRow('ZZ_UNKNOWN', { kind: 'status', set: true }),
    ]);
    expect(visibleView(data, { group: '', search: 'two' }).groups.map((g) => [g.id, g.rows.map((r) => r.name)])).toEqual([['payments', ['B_TWO']]]);
    const onlyEmail = visibleView(data, { group: 'email', search: '' });
    expect(onlyEmail.groups.map((g) => g.id)).toEqual(['email']);
    expect(onlyEmail.showUncategorised).toBe(false);
    const onlyUncat = visibleView(data, { group: 'uncategorised', search: '' });
    expect(onlyUncat.groups).toEqual([]);
    expect(onlyUncat.uncategorised.map((r) => r.name)).toEqual(['ZZ_UNKNOWN']);
    expect(visibleView(data, { group: '', search: 'nothing-matches' }).empty).toBe(true);
    expect(visibleView(data, { group: '', search: '' }).empty).toBe(false);
    // U-4: an unknown group id is ignored.
    expect(visibleView(data, { group: 'staging', search: '' }).groups.map((g) => g.id)).toEqual(['payments', 'email']);
  });

  it('D4-4 the group id list matches the type, and the guard helpers refuse unknown ids', () => {
    expect(GROUP_FILTER_IDS).toHaveLength(15);
    expect(GROUP_FILTER_IDS).toContain('uncategorised');
    expect(isGroupFilter('payments')).toBe(true);
    for (const raw of ['staging', '__proto__', 'constructor', '']) expect({ raw, ok: isGroupFilter(raw) }).toEqual({ raw, ok: false });
  });

  it('D4-5 the checked note: off for an unknown environment, local expectations for Vercel development', () => {
    const data = payloadWith([]);
    expect(checkedNote(data)).toBeNull();
    expect(checkedNote({ ...data, environment: { ...data.environment, label: 'unknown', checkedAgainst: null } })).toMatch(/off, because this environment is not recognised/);
    expect(checkedNote({ ...data, environment: { ...data.environment, label: 'vercel-development', checkedAgainst: 'local' } })).toBe(
      'Checked against the local expectations.'
    );
  });
});
