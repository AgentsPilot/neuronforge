/**
 * The small labels this screen leans on: provenance, configured state, locks.
 *
 * ── Why not `components/ui/badge.tsx` ────────────────────────────────────
 * Two reasons, both measured rather than assumed:
 *  1. Its `outline` variant is coloured with `--v2-border` / `--v2-text-secondary`,
 *     which are declared in `app/v2/globals-v2.css` — a stylesheet the `/admin`
 *     tree does not load. Under this layout those tokens are undefined.
 *  2. `cn()` in `lib/utils.ts` is a plain `join`, not `tailwind-merge`, so
 *     passing a `className` to override a variant's colour ships BOTH classes
 *     and lets stylesheet order decide which wins.
 *
 * So the chip follows the palette the existing admin pages already use
 * (translucent accent over slate), which is the convention on every one of the
 * 21 sibling pages.
 */

const TONES = {
  neutral: 'bg-slate-700/60 text-slate-200 border-slate-600/60',
  info: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  accent: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  quiet: 'bg-slate-800/60 text-slate-400 border-slate-700',
} as const;

interface Props {
  tone: keyof typeof TONES;
  children: React.ReactNode;
  /** Hover text. Never the ONLY place a reason appears (AC-12). */
  title?: string;
  testId?: string;
}

export function Chip({ tone, children, title, testId }: Props) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
