/**
 * The pure admin window module (Admin Layout Standard C-8, U-6 to U-8): the
 * parse table of the L-1c workplan §3.1, serialising, resolving through the
 * shared presets, and the linked-window wording.
 */

import {
  ADMIN_WINDOW_EXTRA_LABELS,
  ADMIN_WINDOW_EXTRAS,
  boundForm,
  linkedWindowLabel,
  parseWindow,
  resolveWindow,
  serialiseWindow,
  windowEquals,
  windowFilter,
  type AdminWindowValue,
} from '@/app/admin/components/layout/adminWindow';
import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';

/** A `get` over a plain query string (no aliasing: the hook does that). */
const getter = (query: string) => {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) || null;
};
const parse = (query: string) => parseWindow(getter(query));

describe('parseWindow', () => {
  it('a known range is a preset, and any from / to beside it is dropped', () => {
    expect(parse('range=7d')).toEqual({ kind: 'preset', preset: '7d' });
    expect(parse('range=this_month&from=2026-10-01&to=2026-10-05')).toEqual({ kind: 'preset', preset: 'this_month' });
    for (const preset of ['today', '7d', '30d', 'this_month']) {
      expect(parse(`range=${preset}`)).toEqual({ kind: 'preset', preset });
    }
  });

  it('whole dates are a custom window, with range absent, custom or unknown (custom implied, U-7)', () => {
    const expected = { kind: 'custom', from: '2026-10-01', to: '2026-10-05' };
    expect(parse('from=2026-10-01&to=2026-10-05')).toEqual(expected);
    expect(parse('range=custom&from=2026-10-01&to=2026-10-05')).toEqual(expected);
    expect(parse('range=bogus&from=2026-10-01&to=2026-10-05')).toEqual(expected);
  });

  it('one-sided whole dates are allowed', () => {
    expect(parse('from=2026-10-01')).toEqual({ kind: 'custom', from: '2026-10-01', to: null });
    expect(parse('range=custom&to=2026-10-05')).toEqual({ kind: 'custom', from: null, to: '2026-10-05' });
  });

  it('reversed whole dates are ignored (U-4)', () => {
    expect(parse('from=2026-10-05&to=2026-10-01')).toBeUndefined();
  });

  it('a minute or an instant bound makes a linked window, kept byte for byte, with no ordering check', () => {
    expect(parse('from=2026-09-25T10:30&to=2026-09-26T10:30')).toEqual({
      kind: 'linked',
      from: '2026-09-25T10:30',
      to: '2026-09-26T10:30',
    });
    expect(parse('to=2026-09-29T16:51')).toEqual({ kind: 'linked', from: null, to: '2026-09-29T16:51' });
    expect(parse('from=2026-09-25T10:30')).toEqual({ kind: 'linked', from: '2026-09-25T10:30', to: null });
    expect(parse('from=2026-10-05T10:00&to=2026-10-01T10:00')).toEqual({
      kind: 'linked',
      from: '2026-10-05T10:00',
      to: '2026-10-01T10:00',
    });
    expect(parse('from=2026-09-25T10:30:15.123Z')).toEqual({ kind: 'linked', from: '2026-09-25T10:30:15.123Z', to: null });
    expect(parse('from=2026-09-25T12:30:00%2B02:00')).toEqual({ kind: 'linked', from: '2026-09-25T12:30:00+02:00', to: null });
    // A date beside a minute: linked, both kept.
    expect(parse('from=2026-09-25&to=2026-09-26T10:30')).toEqual({ kind: 'linked', from: '2026-09-25', to: '2026-09-26T10:30' });
  });

  it('a bound of any other form is ignored (U-4, SA M-4)', () => {
    expect(parse('from=garbage')).toBeUndefined();
    expect(parse('from=2026-02-30')).toBeUndefined();
    expect(parse('from=2026-09-25T25:00')).toBeUndefined();
    expect(parse('from=2026-09-25T10:60')).toBeUndefined();
    // Date.parse accepts these, but they are none of the three U-7 forms.
    expect(parse('from=2026-09-25 10:30')).toBeUndefined();
    expect(parse('from=2026-09-25T10:30:00')).toBeUndefined();
    // An unencoded "+" decodes to a space (SA N-1): ignored.
    expect(parse('from=2026-09-25T12:30:00+02:00')).toBeUndefined();
    // The usable bound survives an unusable one.
    expect(parse('from=garbage&to=2026-10-05')).toEqual({ kind: 'custom', from: null, to: '2026-10-05' });
  });

  it('range=custom with no usable bound, or nothing at all, is the default', () => {
    expect(parse('range=custom')).toBeUndefined();
    expect(parse('range=bogus')).toBeUndefined();
    expect(parse('')).toBeUndefined();
  });
});

describe('boundForm', () => {
  it('classifies the three forms', () => {
    expect(boundForm('2026-10-05')).toBe('date');
    expect(boundForm('2026-10-05T23:59')).toBe('minute');
    expect(boundForm('2026-10-05T23:59:59Z')).toBe('instant');
    expect(boundForm('2026-10-05T23:59:59.999999Z')).toBe('instant');
    expect(boundForm('2026-10-05T23:59-05:00')).toBe('instant');
    expect(boundForm('2026-10-05T24:00')).toBeNull();
  });
});

describe('serialiseWindow and the round trip', () => {
  const roundTrip = (value: AdminWindowValue) => {
    const params = new URLSearchParams(serialiseWindow(value) as Record<string, string>);
    return parse(params.toString());
  };

  it('writes range for a preset, range=custom plus the set bounds otherwise, nothing for none', () => {
    expect(serialiseWindow({ kind: 'preset', preset: '30d' })).toEqual({ range: '30d' });
    expect(serialiseWindow({ kind: 'custom', from: '2026-10-01', to: null })).toEqual({ range: 'custom', from: '2026-10-01' });
    expect(serialiseWindow({ kind: 'linked', from: null, to: '2026-09-29T16:51' })).toEqual({ range: 'custom', to: '2026-09-29T16:51' });
    expect(serialiseWindow({ kind: 'none' })).toEqual({});
  });

  it.each<AdminWindowValue>([
    { kind: 'preset', preset: 'today' },
    { kind: 'custom', from: '2026-10-01', to: '2026-10-05' },
    { kind: 'custom', from: '2026-10-01', to: null },
    { kind: 'custom', from: null, to: '2026-10-05' },
    { kind: 'linked', from: '2026-09-25T10:30', to: '2026-09-26T10:30' },
    { kind: 'linked', from: '2026-09-25T12:30:00+02:00', to: null },
    { kind: 'linked', from: null, to: '2026-09-29T16:51:00.000Z' },
  ])('round trips %j byte for byte', (value) => {
    expect(roundTrip(value)).toEqual(value);
  });

  it('the instant offset is written encoded, so it survives the address bar', () => {
    const params = new URLSearchParams(serialiseWindow({ kind: 'linked', from: '2026-09-25T12:30:00+02:00', to: null }) as Record<string, string>);
    expect(params.toString()).toBe('range=custom&from=2026-09-25T12%3A30%3A00%2B02%3A00');
  });
});

describe('windowEquals and windowFilter', () => {
  it('compares by value', () => {
    expect(windowEquals({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(windowEquals({ kind: 'preset', preset: '7d' }, { kind: 'preset', preset: '7d' })).toBe(true);
    expect(windowEquals({ kind: 'preset', preset: '7d' }, { kind: 'preset', preset: '30d' })).toBe(false);
    expect(windowEquals({ kind: 'custom', from: 'a', to: null }, { kind: 'custom', from: 'a', to: null })).toBe(true);
    expect(windowEquals({ kind: 'custom', from: 'a', to: null }, { kind: 'linked', from: 'a', to: null })).toBe(false);
    expect(windowEquals({ kind: 'none' }, { kind: 'preset', preset: '7d' })).toBe(false);
  });

  it('owns range, from and to, with the aliases it is given', () => {
    const field = windowFilter({ defaultValue: { kind: 'none' }, aliases: { date_from: 'from', date_to: 'to' } });
    expect(field.keys).toEqual(['range', 'from', 'to']);
    expect(field.aliases).toEqual({ date_from: 'from', date_to: 'to' });
    expect(field.defaultValue).toEqual({ kind: 'none' });
    expect(field.equals).toBe(windowEquals);
  });
});

describe('resolveWindow', () => {
  const NOW = new Date('2026-10-11T09:15:00.000Z');

  it('a preset resolves through the shared presets (inclusive UTC dates)', () => {
    expect(resolveWindow({ kind: 'preset', preset: 'today' }, NOW)).toEqual({ kind: 'dates', from: '2026-10-11', to: '2026-10-11' });
    expect(resolveWindow({ kind: 'preset', preset: '7d' }, NOW)).toEqual({ kind: 'dates', from: '2026-10-05', to: '2026-10-11' });
    expect(resolveWindow({ kind: 'preset', preset: '30d' }, NOW)).toEqual({ kind: 'dates', from: '2026-09-12', to: '2026-10-11' });
    expect(resolveWindow({ kind: 'preset', preset: 'this_month' }, NOW)).toEqual({ kind: 'dates', from: '2026-10-01', to: '2026-10-11' });
  });

  it('crosses a month boundary exactly as the shared presets do', () => {
    const now = new Date('2026-03-02T00:30:00.000Z');
    for (const preset of ['today', '7d', '30d', 'this_month'] as const) {
      expect(resolveWindow({ kind: 'preset', preset }, now)).toEqual({ kind: 'dates', ...resolveAdminWindow(preset, now) });
    }
    expect(resolveWindow({ kind: 'preset', preset: '7d' }, now)).toEqual({ kind: 'dates', from: '2026-02-24', to: '2026-03-02' });
  });

  it('custom gives its dates, linked its raw bounds, none nothing', () => {
    expect(resolveWindow({ kind: 'custom', from: '2026-10-01', to: null }, NOW)).toEqual({ kind: 'dates', from: '2026-10-01', to: null });
    expect(resolveWindow({ kind: 'linked', from: '2026-09-25T10:30', to: null }, NOW)).toEqual({ kind: 'linked', from: '2026-09-25T10:30', to: null });
    expect(resolveWindow({ kind: 'none' }, NOW)).toEqual({ kind: 'none' });
  });
});

describe('linkedWindowLabel', () => {
  it('shows a minute with a space, never through Date (independent of the test timezone)', () => {
    expect(linkedWindowLabel({ from: '2026-09-25T10:30', to: '2026-09-26T10:30' })).toBe(
      'Linked window 2026-09-25 10:30 to 2026-09-26 10:30 UTC',
    );
  });

  it('shows a Z instant and an offset instant in UTC', () => {
    expect(linkedWindowLabel({ from: '2026-09-25T10:30:00.000Z', to: null })).toBe('Linked window from 2026-09-25 10:30 UTC');
    expect(linkedWindowLabel({ from: null, to: '2026-09-25T12:30:00+02:00' })).toBe('Linked window up to 2026-09-25 10:30 UTC');
  });

  it('is one-sided both ways, and shows a date as is', () => {
    expect(linkedWindowLabel({ from: null, to: '2026-09-29T16:51' })).toBe('Linked window up to 2026-09-29 16:51 UTC');
    expect(linkedWindowLabel({ from: '2026-09-25', to: '2026-09-26T10:30' })).toBe('Linked window 2026-09-25 to 2026-09-26 10:30 UTC');
  });
});

describe('window extras (L-2a, D-2 (b))', () => {
  const withExtras = (query: string) => parseWindow(getter(query), ['24h', '90d']);

  it('are 24 hours and 90 days, labelled in words', () => {
    expect(ADMIN_WINDOW_EXTRAS).toEqual(['24h', '90d']);
    expect(ADMIN_WINDOW_EXTRA_LABELS).toEqual({ '24h': '24 hours', '90d': '90 days' });
  });

  it('range=24h / range=90d parse only when the page lists them (U-4 for every other page)', () => {
    expect(withExtras('range=24h')).toEqual({ kind: 'extra', extra: '24h' });
    expect(withExtras('range=90d')).toEqual({ kind: 'extra', extra: '90d' });
    expect(parse('range=24h')).toBeUndefined();
    expect(parse('range=90d')).toBeUndefined();
    expect(parseWindow(getter('range=90d'), ['24h'])).toBeUndefined();
    // A preset is still a preset, and an unknown range still falls through to the bounds.
    expect(withExtras('range=7d')).toEqual({ kind: 'preset', preset: '7d' });
    expect(withExtras('range=48h&from=2026-10-01&to=2026-10-05')).toEqual({ kind: 'custom', from: '2026-10-01', to: '2026-10-05' });
  });

  it('a listed extra wins over bounds beside it, as a preset does', () => {
    expect(withExtras('range=90d&from=2026-10-01&to=2026-10-05')).toEqual({ kind: 'extra', extra: '90d' });
  });

  it('serialises to range, compares by value, and round trips', () => {
    expect(serialiseWindow({ kind: 'extra', extra: '24h' })).toEqual({ range: '24h' });
    expect(serialiseWindow({ kind: 'extra', extra: '90d' })).toEqual({ range: '90d' });
    expect(windowEquals({ kind: 'extra', extra: '90d' }, { kind: 'extra', extra: '90d' })).toBe(true);
    expect(windowEquals({ kind: 'extra', extra: '90d' }, { kind: 'extra', extra: '24h' })).toBe(false);
    expect(windowEquals({ kind: 'extra', extra: '90d' }, { kind: 'preset', preset: '30d' })).toBe(false);
    for (const extra of ADMIN_WINDOW_EXTRAS) {
      const params = new URLSearchParams(serialiseWindow({ kind: 'extra', extra }) as Record<string, string>);
      expect(withExtras(params.toString())).toEqual({ kind: 'extra', extra });
    }
  });

  it('windowFilter parses the extras it is given, and none by default', () => {
    const listed = windowFilter({ defaultValue: { kind: 'none' }, extras: ['90d'] });
    const unlisted = windowFilter({ defaultValue: { kind: 'none' } });
    expect(listed.parse(getter('range=90d'))).toEqual({ kind: 'extra', extra: '90d' });
    expect(listed.parse(getter('range=24h'))).toBeUndefined();
    expect(unlisted.parse(getter('range=90d'))).toBeUndefined();
    expect(unlisted.parse(getter('range=7d'))).toEqual({ kind: 'preset', preset: '7d' });
  });

  it('resolveWindow: 90 days is the last 90 UTC calendar days including today; 24 hours is now minus 24 h to now', () => {
    const now = new Date('2026-10-11T09:15:00.000Z');
    expect(resolveWindow({ kind: 'extra', extra: '90d' }, now)).toEqual({ kind: 'dates', from: '2026-07-14', to: '2026-10-11' });
    expect(resolveWindow({ kind: 'extra', extra: '24h' }, now)).toEqual({
      kind: 'linked',
      from: '2026-10-10T09:15:00.000Z',
      to: '2026-10-11T09:15:00.000Z',
    });
    // Across a year boundary, in UTC whatever the clock's local zone.
    expect(resolveWindow({ kind: 'extra', extra: '90d' }, new Date('2026-01-01T00:30:00.000Z'))).toEqual({
      kind: 'dates',
      from: '2025-10-04',
      to: '2026-01-01',
    });
  });
});
