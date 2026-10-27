/**
 * Words for the Environment page (admin environment view EC-2; workplan §2.7,
 * D2-1 to D2-4; SA E2-1, E2-2, Q2-2).
 */

import {
  describeDisplay,
  entriesWords,
  ENVIRONMENT_LABEL_WORDS,
  isEnvironmentViewPayload,
  platformHiddenLine,
  scopeWords,
  seeAlsoLink,
} from '../environmentDisplay';
import type { EnvDisplay, EnvironmentLabel } from '@/lib/admin/environment-types';

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
      environment: { label: 'preview', facts: { host: null, region: null, branch: null, commit: null } },
      groups: [],
      uncategorised: [],
      counts: { rows: 0, set: 0, notSet: 0, uncategorised: 0, platformHidden: 0 },
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
    const goodRow = { name: 'A_X', role: 'Role.', scope: 'server', group: 'features', sensitivity: 'config', expectedIn: null, display: { kind: 'shown', text: 'x' } };
    const base = {
      environment: { label: 'preview', facts: { host: 'h.example.test', region: null, branch: null, commit: null } },
      groups: [{ id: 'features', label: 'Feature switches', description: 'D.', rows: [goodRow] }],
      uncategorised: [goodRow],
      counts: { rows: 2, set: 2, notSet: 0, uncategorised: 1, platformHidden: 0 },
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
    ];
    for (const [label, payload] of bad) expect({ label, ok: isEnvironmentViewPayload(payload) }).toEqual({ label, ok: false });
  });
});
