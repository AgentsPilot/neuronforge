/**
 * The admin table classes and the short-id rule (Admin Layout Standard C-13,
 * §5.7). Pure: no rendering.
 */

import {
  ADMIN_BUTTON,
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';

const classesOf = (value: string) => value.split(/\s+/);

describe('the §5.7 table classes', () => {
  it.each([
    ['ADMIN_TABLE_WRAP', ADMIN_TABLE_WRAP, ['overflow-x-auto', 'rounded-xl', 'border', 'border-slate-700']],
    ['ADMIN_TABLE', ADMIN_TABLE, ['min-w-full', 'text-left', 'text-sm', 'text-slate-300']],
    ['ADMIN_THEAD', ADMIN_THEAD, ['bg-slate-800/60']],
    ['ADMIN_TH', ADMIN_TH, ['px-3', 'py-2', 'text-[11px]', 'font-medium', 'uppercase', 'tracking-wide', 'text-slate-400']],
    ['ADMIN_TBODY', ADMIN_TBODY, ['divide-y', 'divide-slate-800']],
    ['ADMIN_TD', ADMIN_TD, ['px-3', 'py-2', 'align-top']],
    ['ADMIN_TD_ID', ADMIN_TD_ID, ['font-mono', 'text-[11px]', 'text-slate-400']],
    [
      'ADMIN_TH_NUM',
      ADMIN_TH_NUM,
      ['px-3', 'py-2', 'text-right', 'text-[11px]', 'font-medium', 'uppercase', 'tracking-wide', 'text-slate-400'],
    ],
    ['ADMIN_TD_NUM', ADMIN_TD_NUM, ['px-3', 'py-2', 'align-top', 'text-right', 'tabular-nums', 'whitespace-nowrap']],
    ['ADMIN_COUNT_LINE', ADMIN_COUNT_LINE, ['text-xs', 'text-slate-400']],
    [
      'ADMIN_BUTTON',
      ADMIN_BUTTON,
      [
        'rounded-lg',
        'border-slate-700',
        'bg-slate-800',
        'px-3',
        'py-1.5',
        'hover:bg-slate-700',
        'disabled:opacity-60',
        'disabled:cursor-not-allowed',
        'focus-visible:ring-2',
        'focus-visible:ring-purple-500',
      ],
    ],
  ])('%s carries its classes', (_name, value, expected) => {
    for (const cls of expected) expect({ cls, present: classesOf(value).includes(cls) }).toEqual({ cls, present: true });
  });

  it('one density: no constant uses the old card padding (py-4 / px-6)', () => {
    for (const value of [ADMIN_TABLE_WRAP, ADMIN_TABLE, ADMIN_TH, ADMIN_TD, ADMIN_TH_NUM, ADMIN_TD_NUM, ADMIN_TD_ID, ADMIN_BUTTON]) {
      expect(classesOf(value)).not.toContain('py-4');
      expect(classesOf(value)).not.toContain('px-6');
    }
  });

  it('only the id cell is monospace', () => {
    const others = [
      ADMIN_TABLE_WRAP,
      ADMIN_TABLE,
      ADMIN_THEAD,
      ADMIN_TH,
      ADMIN_TH_NUM,
      ADMIN_TBODY,
      ADMIN_TD,
      ADMIN_TD_NUM,
      ADMIN_COUNT_LINE,
      ADMIN_BUTTON,
    ];
    for (const value of others) expect(value).not.toContain('font-mono');
    expect(ADMIN_TD_ID).toContain('font-mono');
  });

  it('the button rings on focus-visible only, never the colourless ring-ring', () => {
    expect(ADMIN_BUTTON).not.toMatch(/(^|\s)focus:/);
    expect(ADMIN_BUTTON).not.toContain('ring-ring');
  });
});

describe('formatShortId (§5.7 Ids)', () => {
  it('shows the first 8 characters and an ellipsis', () => {
    expect(formatShortId('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBe('aaaaaaaa…');
  });

  it('leaves an id of 8 characters or fewer whole (nothing was cut)', () => {
    expect(formatShortId('e-1')).toBe('e-1');
    expect(formatShortId('12345678')).toBe('12345678');
  });

  it('shows an em dash for null and for an empty id', () => {
    expect(formatShortId(null)).toBe('—');
    expect(formatShortId('')).toBe('—');
  });
});
