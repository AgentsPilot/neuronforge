import Image from 'next/image';
import { WORDMARK, LOGO_HEIGHT, widthForHeight, type LogoPlacement } from '@/lib/brand/logo';

/**
 * The AgentsPilot logo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE THEME SWAP IS CSS AND NOT A HOOK
 *
 * Dark mode here is a `dark` class on `<html>` (`darkMode: 'class'`), set by
 * the theme provider after mount from localStorage. A component that read the
 * theme in JS to choose a `src` would render the light logo on the server and
 * swap it on the client — a visible flash on every load for every dark-mode
 * user, and a hydration mismatch besides.
 *
 * So both files render and CSS shows one. That costs a second request for a
 * ~20KB asset and buys a logo that is right in the first frame.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SIZES ARE LITERAL CLASS STRINGS
 *
 * They were `h-[${height}px]` first, which is broken in a way that compiles
 * fine and renders nothing: Tailwind's JIT scans source text for whole class
 * names, so a class assembled at runtime is never generated and the element
 * ends up with no height at all.
 *
 * Hence `SIZING` below — every class written out in full so the scanner can see
 * it. The numbers still live in `LOGO_HEIGHT`; the guard test holds the two in
 * agreement.
 *
 * Not a client component: no state, no effects, no JavaScript shipped. The
 * theme and responsive behaviour is entirely CSS.
 */

/**
 * Literal Tailwind classes per placement. Must match `LOGO_HEIGHT` —
 * `lib/brand/__tests__/logo.guard.test.ts` fails if they drift.
 */
const SIZING: Record<LogoPlacement, { responsive: string; fixed: string }> = {
  header: { responsive: 'h-[22px] sm:h-[28px] w-auto', fixed: 'h-[28px] w-auto' },
  compact: { responsive: 'h-[22px] w-auto', fixed: 'h-[22px] w-auto' },
};

interface LogoProps {
  /**
   * Where this is being shown — which decides the height. Call sites choose a
   * PLACE, not a number, so two headers cannot quietly disagree.
   */
  placement?: LogoPlacement;
  /**
   * Shrink on narrow viewports. On by default: a 5.5:1 lockup at full header
   * height eats a phone's width and the page title loses.
   */
  responsive?: boolean;
  /** Above the fold — the app headers are. */
  priority?: boolean;
  className?: string;
}

export function Logo({
  placement = 'header',
  responsive = true,
  priority = false,
  className = '',
}: LogoProps) {
  const height = LOGO_HEIGHT[placement];
  const sizing = responsive ? SIZING[placement].responsive : SIZING[placement].fixed;

  const light = WORDMARK.light;
  /*
   * No light-text export exists yet, so dark mode reuses the charcoal one
   * rather than rendering nothing. Tracked in `MISSING_ASSETS`; when the file
   * lands, setting `WORDMARK.dark` is the only change needed.
   */
  const dark = WORDMARK.dark;

  /*
   * `width`/`height` describe the IMAGE's own ratio, which is the contract
   * Next.js wants — they are not the box. The CSS class above does the sizing,
   * and `w-auto` keeps the ratio intact. Passing a square for a 5.5:1 asset is
   * exactly what produced the aspect-ratio warning this replaces.
   */
  const intrinsic = { width: widthForHeight(light, height), height };

  return (
    <>
      <Image
        {...intrinsic}
        src={light.src}
        alt="AgentsPilot"
        priority={priority}
        className={`${sizing} ${dark ? 'dark:hidden' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      />
      {dark && (
        <Image
          width={widthForHeight(dark, height)}
          height={height}
          src={dark.src}
          alt="AgentsPilot"
          priority={priority}
          className={`hidden dark:block ${sizing} ${className}`.replace(/\s+/g, ' ').trim()}
        />
      )}
    </>
  );
}
