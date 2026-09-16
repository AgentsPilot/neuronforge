'use client';

/**
 * Choose a typeface, and see it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COMPONENT RATHER THAN TWO MORE `<SelectItem>` LISTS
 *
 * The Design tab had the families written out twice as literal items, and none
 * of them was a face any template uses — so a business on Bloom saw an empty
 * dropdown where "Josefin Sans" should have been, because Radix had no item to
 * match the saved value against. Both lists now come from one catalogue derived
 * from the archetypes, and both are rendered by this.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FACE HAS TO BE LOADED TO BE CHOSEN
 *
 * A list of family names tells an owner nothing. Lora and Merriweather are the
 * same word to anyone who has not set type before, and the choice is only
 * meaningful when it is visible — so every row renders in its own face, and the
 * faces are fetched for this page the same way a published page fetches them.
 *
 * Both scripts are shown on every row. Most of the popular Latin faces on
 * Google Fonts have no Hebrew at all, and picking one is not a small compromise
 * for a Hebrew-speaking business — every heading falls back to a system face
 * and the page stops looking like its template. A row whose Hebrew sample
 * renders in a different face is showing exactly that, and it is labelled as
 * well, because a reader who does not know the face cannot be expected to spot
 * the substitution.
 *
 * @module components/website/FontPicker
 */

import { useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FONT_SAMPLES,
  allCatalogueFamilies,
  fontChoicesWith,
  fontStack,
  type FontChoice,
} from '@/lib/website-builder/fontCatalogue';

/** One stylesheet for the whole catalogue, added once per document. */
const LINK_ID = 'ap-font-catalogue';

/**
 * Pull every offered face into this page.
 *
 * `next/font` cannot take a family name that is only known at runtime, which is
 * why the public pages use a stylesheet link too (`PublicFontLinks`). This is
 * the editor's equivalent, and it loads the whole catalogue rather than the two
 * selected faces: the point of the control is comparing faces the owner has not
 * chosen yet.
 *
 * Appended to `document.head` rather than rendered, so React cannot duplicate
 * it when the two pickers mount together, and so it survives the tab switching
 * away and back.
 */
function useCatalogueFonts(extra: string | undefined | null) {
  useEffect(() => {
    const families = allCatalogueFamilies([extra]);
    if (families.length === 0) return;

    const query = families
      .map(family => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;500;600;700`)
      .join('&');
    const href = `https://fonts.googleapis.com/css2?${query}&display=swap`;

    const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (existing) {
      // A saved face outside the catalogue changes the query. Cheap to reassign
      // and the browser serves the unchanged families from cache.
      if (existing.href !== href) existing.href = href;
      return;
    }

    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    // Deliberately not removed on unmount: the faces are wanted again the
    // moment the tab is reopened, and a removed stylesheet reflows every
    // sample on the way out.
  }, [extra]);
}

interface FontPickerProps {
  label: string;
  value: string;
  choices: FontChoice[];
  /** Said on a row whose face cannot set Hebrew, e.g. "Latin only". */
  latinOnlyLabel: string;
  onChange: (family: string) => void;
}

export function FontPicker({ label, value, choices, latinOnlyLabel, onChange }: FontPickerProps) {
  // The saved face belongs in the list whether or not the catalogue knows it —
  // otherwise the control shows a placeholder and the next save quietly
  // replaces a font the owner never meant to change.
  const offered = fontChoicesWith(choices, value);
  useCatalogueFonts(value);

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--v2-text-secondary)] mb-2">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {offered.map(choice => (
            <SelectItem key={choice.family} value={choice.family}>
              {/* One row: the name, then the face doing its job in both
                  scripts. `min-w-0` and truncation because this same markup is
                  cloned into the trigger, which is narrower than the list. */}
              <span className="flex items-center gap-3 min-w-0 w-full">
                <span className="text-sm shrink-0" style={{ fontFamily: fontStack(choice.family) }}>
                  {choice.family}
                </span>
                <span
                  className="text-sm text-[var(--v2-text-muted)] truncate"
                  style={{ fontFamily: fontStack(choice.family) }}
                  aria-hidden="true"
                >
                  {FONT_SAMPLES.latin}
                </span>
                <span
                  className="text-sm text-[var(--v2-text-muted)] truncate"
                  style={{ fontFamily: fontStack(choice.family) }}
                  dir="rtl"
                  aria-hidden="true"
                >
                  {FONT_SAMPLES.hebrew}
                </span>
                {!choice.hebrew && (
                  <span className="ms-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    {latinOnlyLabel}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default FontPicker;
