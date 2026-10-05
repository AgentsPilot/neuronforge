import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/Logo';

/**
 * The frame every `/invite` screen sits in: a soft brand-tinted page, and one
 * card with the AgentPilot wordmark on a dark band and a brand-gradient rule
 * under it. Presentation only: no state, no requests, no copy.
 *
 * ── Why the wordmark sits on a dark band ────────────────────────────────────
 * `<Logo>` follows the `dark` class on `<html>` by default, but this page's
 * card is white whatever the visitor's theme. `surface="dark"` on a band that
 * is always slate-900 shows the right file in every theme, the way the admin
 * console does.
 *
 * ── Why literal Tailwind colours and not `var(--v2-…)` ──────────────────────
 * The V2 tokens are declared in `app/v2/globals-v2.css`, which `/invite` does
 * not load. `indigo-600` / `violet-500` are the same values as
 * `--v2-primary-dark` / `--v2-secondary`, so the page matches the app.
 *
 * Not a client component: the client invite page and the server
 * awaiting-payment page both render it.
 */
export function InviteShell({
  children,
  locale,
  dir,
  testId,
}: {
  children: ReactNode;
  locale: string;
  dir: 'ltr' | 'rtl';
  testId?: string;
}) {
  return (
    <main
      data-testid={testId}
      lang={locale}
      dir={dir}
      className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-50 px-4 py-8 text-slate-900 sm:py-14"
    >
      <div className="mx-auto w-full max-w-xl">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-indigo-100/60">
          <div className="flex items-center bg-slate-900 px-6 py-4 sm:px-8">
            <Logo surface="dark" placement="compact" responsive={false} priority />
          </div>
          <div className="h-1 bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600" aria-hidden="true" />
          <div className="space-y-6 p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </main>
  );
}

/** The primary button look on these screens, for a `<button>` or an `<a>`. */
export const INVITE_PRIMARY_BUTTON =
  'inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 sm:w-auto';

/** The secondary (outline) button look. */
export const INVITE_SECONDARY_BUTTON =
  'inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 sm:w-auto';

/** A state's icon: a tinted circle the heading sits beside. */
export function InviteStateIcon({ tone, children }: { tone: 'brand' | 'warning' | 'neutral' | 'success'; children: ReactNode }) {
  const tones = {
    brand: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
    warning: 'bg-amber-50 text-amber-600 ring-amber-100',
    neutral: 'bg-slate-100 text-slate-500 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  } as const;
  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-full ring-4 ${tones[tone]}`} aria-hidden="true">
      {children}
    </div>
  );
}
