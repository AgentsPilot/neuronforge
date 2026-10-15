'use client';

import { useCallback, useRef, useState } from 'react';
// The router is here for ONE thing: `replace`, to take `section` back off the
// address when a link-opened drawer closes (settings drawer review C-3). It never
// pushes: a cleanup that added a Back entry would let Back reopen the drawer just
// closed.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { settingsUrlWithoutSection } from '@/components/business-os/settings/settingsSectionUrl';

/**
 * Open state for one settings drawer that a `?section=` link can also open
 * (settings drawer review C-3; SA S-1 code review finding 2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A HOOK
 *
 * S-1 wrote this pair inline for the plan drawer. S-2's password drawer needs
 * the same thing, and two hand copies of "remember the link opened it, take
 * `section` off on close" is how one of them drifts (a push instead of a
 * replace, a forgotten flag reset). So it lives here once, with its own test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULES (C-3, SA-2, SA S-1 Q-2 / W-3)
 *
 * - Opening from the row never writes the address.
 * - Opening from the link marks the drawer link-opened EVERY time, even when it
 *   is already open: something else (the plan checkout) may have written
 *   `section` into the address of a row-opened drawer, and a reload must not
 *   reopen it (Q-6 (a)).
 * - Closing a link-opened drawer removes `section` and nothing else (`checkout`
 *   and `tab` belong to others), with `replace` and no scroll. The flag is used
 *   once.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface LinkOpenedDrawer {
  open: boolean;
  /** Open from the page's own row. Never touches the address. */
  openFromRow: () => void;
  /** Open because the address carries `?section=…`. */
  openFromLink: () => void;
  /** Pass to the drawer's `onOpenChange`. */
  onOpenChange: (next: boolean) => void;
}

export function useLinkOpenedDrawer(): LinkOpenedDrawer {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  // A ref, because only the close handler reads it and it must not re-render.
  const openedByLink = useRef(false);

  // Stable, so the page's deep-link effect can depend on it without re-running.
  const openFromRow = useCallback(() => setOpen(true), []);

  const openFromLink = useCallback(() => {
    openedByLink.current = true;
    setOpen(true);
  }, []);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next || !openedByLink.current) return;
      openedByLink.current = false;
      router.replace(settingsUrlWithoutSection(pathname, searchParams), { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { open, openFromRow, openFromLink, onOpenChange };
}
