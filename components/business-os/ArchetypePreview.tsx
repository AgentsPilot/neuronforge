'use client';

/**
 * A design, drawn small.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COMPONENT AND NOT FOUR COPIES
 *
 * A design is chosen in four places — the website setup wizard, the Templates
 * tab, the new-page dialog and the landing page wizard — and all four drew the
 * same two diagonal colour swatches. Which was an honest picture of the old
 * catalogue, where thirty-three templates differed only in accent colour, and a
 * badly misleading one now: the four archetypes differ in ground, typeface,
 * type scale and corner radius, and a swatch shows none of those.
 *
 * WHAT IT DRAWS
 *
 * The design's own background, a headline in its real typeface at its real
 * weight, two rules standing in for a paragraph so the ground and the ink read
 * as a pairing, and a filled button plus an outlined one carrying its corner
 * radius — Aster's 14px against Lumen's 30px is legible even at this size.
 *
 * Every value is passed in rather than looked up, so this knows nothing about
 * archetypes, verticals or where the list came from. The three call sites that
 * still receive a legacy template with three hex values and no font pass what
 * they have, and it degrades to a plain colour card.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Check } from 'lucide-react';

interface ArchetypePreviewProps {
  /** Shown as the headline, in the design's own face. */
  name: string;
  /** The page ground. */
  background?: string;
  /** Heading and body ink. */
  ink?: string;
  inkMuted?: string;
  /** The brand colour, on the filled button. */
  brand: string;
  /** The accent, on the outlined one. */
  accent?: string;
  /** The heading typeface. Absent falls back to the platform's. */
  headingFont?: string;
  /** The design's corner radius, which the buttons carry. */
  radius?: string;
  selected?: boolean;
  /** Tailwind height. Galleries differ: the setup wizard is denser. */
  heightClass?: string;
}

export function ArchetypePreview({
  name,
  background = '#FFFFFF',
  ink = '#111111',
  inkMuted,
  brand,
  accent,
  headingFont,
  radius = '8px',
  selected = false,
  heightClass = 'h-28',
}: ArchetypePreviewProps) {
  const muted = inkMuted || ink;

  return (
    <div
      className={`${heightClass} relative overflow-hidden px-3 py-3 flex flex-col justify-between`}
      style={{ backgroundColor: background }}
      aria-hidden="true"
    >
      <div>
        <div
          className="text-[13px] leading-tight font-bold truncate"
          style={{
            color: ink,
            fontFamily: headingFont ? `'${headingFont}', system-ui, sans-serif` : undefined,
          }}
        >
          {name}
        </div>

        <div className="mt-1.5 space-y-1">
          <div className="h-1 w-full rounded-full" style={{ backgroundColor: muted, opacity: 0.28 }} />
          <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: muted, opacity: 0.28 }} />
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="h-4 w-12" style={{ backgroundColor: brand, borderRadius: radius }} />
        <div
          className="h-4 w-8 border"
          style={{ borderColor: accent || brand, borderRadius: radius }}
        />
      </div>

      {selected && (
        <div className="absolute top-1.5 end-1.5 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow-md">
          <Check className="w-3 h-3 text-[#4F6EF7]" />
        </div>
      )}
    </div>
  );
}

/**
 * The typefaces a gallery needs, in one request.
 *
 * Without this every card draws its headline in the platform's own face and the
 * four designs look alike again — the typeface is half of what separates them,
 * and it is the half that never rendered on a public page either, until the
 * theme emitter was fixed.
 *
 * Heebo is already loaded by the root layout, so asking for it again is a
 * wasted round trip.
 */
export function ArchetypeFontLinks({ families }: { families: (string | undefined)[] }) {
  const unique = [
    ...new Set(
      families
        .map(family => family?.trim())
        .filter((family): family is string => Boolean(family))
        .filter(family => family.toLowerCase() !== 'heebo')
    ),
  ];

  if (unique.length === 0) return null;

  const query = unique
    .map(family => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700`)
    .join('&');

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?${query}&display=swap`} />
    </>
  );
}
