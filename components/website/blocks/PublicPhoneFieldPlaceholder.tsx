'use client';

import type { FocusEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { loadPhoneLib } from '@/components/crm/usePhoneLib';
import { publicFormCallingCode, type PublicFormCountry } from '@/components/crm/publicFormCountry';

/**
 * Holds the public contact form's phone row while the phone library arrives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `components/crm/PhoneFieldPlaceholder` (BR-2, SA-7 item 3)
 *
 * The owner-side placeholder is `disabled`, `aria-hidden` and `tabIndex={-1}`.
 * That suits a field inside a modal an owner opened a moment ago, but on a
 * public page the phone row is visible at first paint: the label above it must
 * point at something a screen reader can announce, and a visitor who taps it
 * before the library arrives must not lose that tap (FR-2.3, FR-2.4).
 *
 * So the number box here is a real, focusable, READ-ONLY `<input type="tel">`
 * with the label's `id`. Focusing it tells the block that focus is waiting;
 * the block moves focus into the real number box when it mounts. It has no
 * `name`, so nothing typed or sent depends on it.
 *
 * SAME BOX, NO SHIFT (AC-2.3)
 *
 * The country box copies `WebsiteCountrySelect`'s trigger exactly: same
 * element type, the full class string, the inline min-height, the flag and the
 * `+code` text (from `publicFormCallingCode`, pinned to the library by a test).
 * `min-w-[110px]` lets the real trigger grow with its content, so a stub with
 * different content would push the number box sideways when the field
 * arrives. The number box reuses the library's class names inside
 * `.phone-input-contact`, so the block's global styles (SA-8) give it the real
 * input's padding, border, colours and 42 px height in every template.
 *
 * Pressing or focusing it retries a failed download, as the owner side does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Flag emoji from an ISO code, the same arithmetic `WebsiteCountrySelect` uses. */
function flagEmoji(countryCode: string): string {
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}

interface PublicPhoneFieldPlaceholderProps {
  /** The `id` the field's `<label htmlFor>` points at. */
  inputId: string;
  country: PublicFormCountry;
  hasError: boolean;
  /** Focus landed here: hand it to the real number box when it mounts. */
  onFocusWaiting: () => void;
  /** Focus left for another element, so there is nothing to hand over. */
  onFocusMovedAway: () => void;
}

export function PublicPhoneFieldPlaceholder({
  inputId,
  country,
  hasError,
  onFocusWaiting,
  onFocusMovedAway,
}: PublicPhoneFieldPlaceholderProps) {
  const retry = () => {
    void loadPhoneLib();
  };

  return (
    <>
      <div className="relative" dir="ltr">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onPointerDown={retry}
          className={`flex items-center gap-2 px-3 py-2.5 min-w-[110px] ap-card-2 border rounded-lg transition-all text-sm ${
            hasError ? 'border-red-500' : 'ap-line ap-hover-line'
          }`}
          style={{ minHeight: '42px' }}
        >
          <span className="text-xl leading-none">{flagEmoji(country)}</span>
          <span className="ap-ink font-medium">{`+${publicFormCallingCode(country)}`}</span>
          <ChevronDown className="h-4 w-4 ap-ink-3 transition-transform" />
        </button>
      </div>
      <div className={`phone-input-contact flex-1 ${hasError ? 'has-error' : ''}`}>
        <div className="PhoneInput" aria-busy="true" onPointerDown={retry}>
          <input
            id={inputId}
            type="tel"
            readOnly
            className="PhoneInputInput"
            onFocus={() => {
              onFocusWaiting();
              retry();
            }}
            onBlur={(e: FocusEvent<HTMLInputElement>) => {
              /*
               * Only a move to ANOTHER element cancels the hand-off. When the
               * library arrives this input is removed while focused, and
               * browsers (and jsdom) differ on whether that fires a blur; with
               * no `relatedTarget` it is that removal, not the visitor (RC-3).
               */
              if (e.relatedTarget != null) onFocusMovedAway();
            }}
          />
        </div>
      </div>
    </>
  );
}
