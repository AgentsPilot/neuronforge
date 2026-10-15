/**
 * @jest-environment jsdom
 */

/**
 * `SettingsDrawer` (settings drawer review C-1, C-4; S-1 workplan, SA W-4).
 *
 * The harness plays the page: an opener row whose ref is the return target,
 * and the drawer's `onOpenChange` recorded so a refused close is visible as a
 * call that never happened.
 */

import fs from 'fs';
import path from 'path';
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { TabFooter } from '@/components/business-os/settings/TabFooter';

const TITLE = 'Your plan';
// Not "Close": the sheet's built-in X (hidden by `[&>button]:hidden` in a browser, not in
// jsdom) is named that, and the label must visibly come from the prop.
const CLOSE = 'Close this drawer';

let onOpenChange: jest.Mock;

interface HarnessProps {
  isBusy?: boolean;
  isRTL?: boolean;
  meta?: React.ReactNode;
  withReturnRef?: boolean;
  withFooter?: boolean;
}

function Harness({ isBusy = false, isRTL = false, meta, withReturnRef = true, withFooter = false }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <button type="button">Elsewhere</button>
      <SettingsDrawer
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setOpen(next);
        }}
        title={TITLE}
        meta={meta}
        isBusy={isBusy}
        isRTL={isRTL}
        closeLabel={CLOSE}
        returnFocusRef={withReturnRef ? opener : undefined}
        testId="settings-test-drawer"
      >
        <p>Drawer body</p>
        <button type="button">Inside</button>
        {withFooter ? (
          <TabFooter message={<span>Footer message</span>}>
            <button type="button">Footer save</button>
          </TabFooter>
        ) : null}
      </SettingsDrawer>
    </>
  );
}

async function openDrawer(): Promise<{ opener: HTMLElement; dialog: HTMLElement }> {
  const opener = screen.getByRole('button', { name: 'Opener' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  return { opener, dialog };
}

/**
 * Radix registers its outside-pointer listener on a timer after mount, so an
 * outside press sent straight away is never seen and a "does not close"
 * assertion would pass for nothing (SA test-plan note). Wait it out first.
 */
async function letRadixSettle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  onOpenChange = jest.fn();
});

describe('SettingsDrawer: the shell', () => {
  it('closed: renders no dialog', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Drawer body')).toBeNull();
  });

  it('open: a dialog named by the title, with the children inside', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    expect(screen.getByRole('dialog', { name: TITLE })).toBe(dialog);
    expect(within(dialog).getByText('Drawer body')).toBeTruthy();
    expect(dialog.getAttribute('data-testid')).toBe('settings-test-drawer');
  });

  it("MoneyDetailDrawer's shell classes", async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const classes = dialog.className.split(/\s+/);
    for (const cls of ['w-full', 'sm:max-w-xl', 'p-0', 'overflow-hidden', 'flex', 'flex-col', '[&>button]:hidden']) {
      expect({ cls, present: classes.includes(cls) }).toEqual({ cls, present: true });
    }
  });

  it('left to right: right side, dir ltr', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    expect(dialog.getAttribute('data-side')).toBe('right');
    expect(dialog.getAttribute('dir')).toBe('ltr');
  });

  it('right to left: left side, dir rtl', async () => {
    render(<Harness isRTL />);
    const { dialog } = await openDrawer();
    expect(dialog.getAttribute('data-side')).toBe('left');
    expect(dialog.getAttribute('dir')).toBe('rtl');
  });

  // S-3, W-4: a child's `TabFooter` lands in the fixed bar after the scroll
  // body, so Save never scrolls away from the form.
  it("a child's TabFooter renders outside the scroll body, inside the dialog", async () => {
    render(<Harness withFooter />);
    const { dialog } = await openDrawer();
    const save = within(dialog).getByRole('button', { name: 'Footer save' });
    const body = within(dialog).getByText('Drawer body').parentElement as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.contains(save)).toBe(false);
    expect(dialog.contains(save)).toBe(true);
    expect(within(dialog).getByText('Footer message')).toBeTruthy();
    // The bar comes after the body, as a sibling.
    expect(body.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a drawer with no TabFooter has an empty footer slot (hidden by empty:hidden)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    const body = within(dialog).getByText('Drawer body').parentElement as HTMLElement;
    const slot = body.nextElementSibling as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.className).toContain('empty:hidden');
    expect(slot.childNodes.length).toBe(0);
  });

  it('meta renders as the description; without it there is no aria-describedby', async () => {
    const { unmount } = render(<Harness meta="Founding Partner, monthly" />);
    let { dialog } = await openDrawer();
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Founding Partner, monthly');
    unmount();

    render(<Harness />);
    ({ dialog } = await openDrawer());
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('SettingsDrawer: closing', () => {
  it('the own X carries the close label and calls onOpenChange(false)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    fireEvent.click(within(dialog).getByRole('button', { name: CLOSE }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape calls onOpenChange(false)', async () => {
    render(<Harness />);
    const { dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('an outside press closes it when not busy (the control for the busy case)', async () => {
    render(<Harness />);
    await openDrawer();
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('focus returns to the opener row on close', async () => {
    render(<Harness />);
    const { opener, dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('focus goes to the return target even when it was not the element focused before', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    // The link-opened case: something else held focus when the drawer opened.
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe('SettingsDrawer: busy refusal (C-4)', () => {
  it('the X is disabled and does not close', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    const close = within(dialog).getByRole('button', { name: CLOSE }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Escape does not close', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await letRadixSettle();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('an outside press does not close', async () => {
    render(<Harness isBusy />);
    await openDrawer();
    await letRadixSettle();
    fireEvent.pointerDown(document.body);
    await letRadixSettle();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('the body says it is busy', async () => {
    render(<Harness isBusy />);
    const { dialog } = await openDrawer();
    expect(within(dialog).getByText('Drawer body').parentElement?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('SettingsDrawer: source guard (C-1)', () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'components/business-os/settings/SettingsDrawer.tsx'),
    'utf8'
  );
  // Comments explain what the wrapper is NOT; strip them so the explanation
  // cannot fail its own guard.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('strips comments before matching', () => {
    expect(raw).toContain('MoneyDetailDrawer');
    expect(code).not.toContain('MoneyDetailDrawer');
  });

  it('imports nothing from the entitlements module (type-only included)', () => {
    expect(code).not.toMatch(/business-os\/entitlements/);
  });

  // SA ruling Q-3 / W-4, S-3 C-8: the `Provider` ban is relaxed for exactly one
  // name, `TabFooterSlotProvider`, imported from the `TabFooter` module (an
  // existing portal slot, not shared state). `createContext` and `useContext`
  // stay banned.
  it('has no context, and no provider but TabFooterSlotProvider', () => {
    expect(code).not.toContain('createContext');
    expect(code).not.toContain('useContext');
    const providers = code.match(/\w*Provider\b/g) ?? [];
    expect(providers.length).toBeGreaterThan(0);
    expect(new Set(providers)).toEqual(new Set(['TabFooterSlotProvider']));
    expect(code).toMatch(
      /import\s*\{[^}]*\bTabFooterSlotProvider\b[^}]*\}\s*from\s*'@\/components\/business-os\/settings\/TabFooter'/
    );
  });

  it('does not log, and never keeps hidden content mounted', () => {
    expect(code).not.toContain('console.');
    expect(code).not.toContain('forceMount');
  });

  // C-5: the guard is a prompt inside the drawer, nothing that reaches the
  // browser or the router, and not a shared hook.
  it('the discard guard uses no browser confirm, unload hook or router', () => {
    expect(code).not.toContain('window.confirm');
    expect(code).not.toMatch(/(^|[^\w.])confirm\(/m);
    expect(code).not.toContain('beforeunload');
    expect(code).not.toContain('next/navigation');
    expect(code).not.toContain('useRouter');
    expect(code).not.toContain('history.');
    expect(code).not.toMatch(/export\s+(function|const)\s+use\w*/);
  });

  it('the bare-confirm matcher is not vacuous', () => {
    expect('if (confirm("Discard?")) close();').toMatch(/(^|[^\w.])confirm\(/m);
    expect('setConfirmOpen(true);').not.toMatch(/(^|[^\w.])confirm\(/m);
  });

  it('the prompt is the shared dialog, rendered inside SheetContent (SA ruling 1)', () => {
    expect(code).toMatch(/from\s*'@\/components\/ui\/dialog'/);
    const start = code.indexOf('<SheetContent');
    const end = code.indexOf('</SheetContent>');
    const dialog = code.indexOf('<Dialog ');
    expect(start).toBeGreaterThan(-1);
    expect(dialog).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(dialog);
  });

  it('the footer slot sits after the scroll body, not inside it, and inside SheetContent (W-4)', () => {
    const body = code.indexOf('overflow-y-auto');
    const bodyEnd = code.indexOf('{children}', body);
    const slot = code.indexOf('<TabFooterSlot ');
    const end = code.indexOf('</SheetContent>');
    expect(body).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(bodyEnd);
    // The body's closing tag comes between the children and the slot.
    expect(code.slice(bodyEnd, slot)).toContain('</div>');
    expect(end).toBeGreaterThan(slot);
  });

  it("keeps MoneyDetailDrawer's width and hides the sheet's built-in X", () => {
    expect(code).toContain('[&>button]:hidden');
    expect(code).toContain('sm:max-w-xl');
  });
});

/**
 * C-5 / SA C-8: the discard guard is not a shared hook. No file in the settings
 * folder may DEFINE or CALL a `use…Dirty`, `use…Unsaved` or `use…Discard`,
 * matched on comment-stripped contents (not file names), so a comment saying
 * what is not there cannot fail it.
 */
describe('settings folder: no discard / dirty hook (C-5, SA C-8)', () => {
  const HOOK_NAME = /\buse\w*(Dirty|Unsaved|Discard)/i;
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  const files = sourceFiles(path.join(process.cwd(), 'components/business-os/settings'));

  it('finds the folder\'s files (the scan is not empty)', () => {
    expect(files.some((file) => file.endsWith('SettingsDrawer.tsx'))).toBe(true);
    expect(files.some((file) => file.endsWith('MarketingConsentDrawer.tsx'))).toBe(true);
  });

  it('no file defines or calls one', () => {
    const offenders = files.filter((file) => HOOK_NAME.test(strip(fs.readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  describe('negative controls', () => {
    it('a synthetic useDiscardGuard( fails', () => {
      expect(strip('const guard = useDiscardGuard(isDirty);')).toMatch(HOOK_NAME);
      expect(strip('export function useUnsavedChanges() {}')).toMatch(HOOK_NAME);
      expect(strip('const d = useIsDirty();')).toMatch(HOOK_NAME);
    });

    it('the same name only in a comment passes, and ordinary names pass', () => {
      expect(strip('// no useDiscardGuard here\n/* nor useDirty */')).not.toMatch(HOOK_NAME);
      expect('const [isDirty, setIsDirty] = useState(false); handleDiscard();').not.toMatch(HOOK_NAME);
    });
  });
});
