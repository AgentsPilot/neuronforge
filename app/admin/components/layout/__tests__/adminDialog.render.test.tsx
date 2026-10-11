/**
 * @jest-environment jsdom
 */

/**
 * The shared admin dialog classes (Admin Layout Standard C-10; F-88, F-89).
 *
 * jsdom cannot compute Tailwind, so the contrast itself is the browser check
 * (workplan V-7, SA S-3). What this file proves: the `[&>button]` selectors
 * reach the corner close (it is a DIRECT child of the dialog element), the
 * classes reach the elements, and the class string can never switch off the
 * primitive's own layout (SA M-2).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import {
  ADMIN_DIALOG_CLASS,
  ADMIN_DIALOG_DESCRIPTION_CLASS,
  ADMIN_DIALOG_TITLE_CLASS,
} from '@/app/admin/components/layout/adminDialog';

const GREEN = /(?<![\w-])(?:bg|text|border|from|to|via|shadow|outline|decoration|divide|ring|fill|stroke)-(?:green|emerald)-/;
const ALL = [ADMIN_DIALOG_CLASS, ADMIN_DIALOG_TITLE_CLASS, ADMIN_DIALOG_DESCRIPTION_CLASS];

function renderDialog() {
  render(
    <Dialog open>
      <DialogContent className={ADMIN_DIALOG_CLASS}>
        <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>Drain this queue now?</DialogTitle>
        <DialogDescription className={ADMIN_DIALOG_DESCRIPTION_CLASS}>What it does.</DialogDescription>
        <DialogFooter>
          <button type="button">Confirm</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return screen.getByRole('dialog');
}

describe('ADMIN_DIALOG_CLASS', () => {
  it('never contains "flex": DialogContent would drop its grid, padding and scroll (SA M-2)', () => {
    expect(ADMIN_DIALOG_CLASS.includes('flex')).toBe(false);
  });

  it('carries the palette, the dark scheme and the corner-close fix', () => {
    const classes = ADMIN_DIALOG_CLASS.split(/\s+/);
    for (const expected of [
      '!border-slate-700',
      '!bg-slate-900',
      '!text-slate-100',
      '[color-scheme:dark]',
      '[&>button]:text-slate-300',
      '[&>button]:opacity-100',
      '[&>button:focus]:ring-purple-500',
      '[&>button]:ring-offset-slate-900',
    ]) {
      expect(classes).toContain(expected);
    }
  });

  it('no constant holds a --v2- token, a dark: variant or a green class', () => {
    for (const value of ALL) {
      expect(value).not.toMatch(/var\(--v2-/);
      expect(value).not.toMatch(/(?<![\w-])dark:/);
      expect(value).not.toMatch(GREEN);
    }
  });
});

describe('on a real ui/dialog', () => {
  it('the dialog element carries the class, and keeps the primitive grid layout', () => {
    const dialog = renderDialog();
    expect(dialog.className).toContain('[color-scheme:dark]');
    expect(dialog.className).toContain('[&>button]:text-slate-300');
    expect(dialog.className).toContain('[&>button:focus]:ring-purple-500');
    // The primitive's own layout survives because the class has no "flex".
    expect(dialog.className).toContain('grid');
    expect(dialog.className).toContain('overflow-y-auto');
  });

  it('the corner close is a direct child button of the dialog, so [&>button] reaches it', () => {
    const dialog = renderDialog();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.parentElement).toBe(dialog);
    const directButtons = Array.from(dialog.children).filter((child) => child.tagName === 'BUTTON');
    expect(directButtons).toEqual([close]);
  });

  it('a button inside the body is not a direct child, so the selector does not restyle it', () => {
    const dialog = renderDialog();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.parentElement).not.toBe(dialog);
  });

  it('the title and description carry their constants', () => {
    renderDialog();
    expect(screen.getByText('Drain this queue now?').className).toContain('!text-white');
    expect(screen.getByText('What it does.').className).toContain('!text-slate-400');
  });
});
