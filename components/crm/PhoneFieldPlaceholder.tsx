'use client';

import { loadPhoneLib } from '@/components/crm/usePhoneLib';

/**
 * Holds the phone field's place while the phone library is still arriving.
 *
 * Seen only if a contact or booking surface is opened before the library's
 * after-paint download has finished, or after that download failed (see
 * `components/crm/usePhoneLib.ts`). It reuses the library's own class names
 * (`PhoneInput`, `PhoneInputInput`) plus the caller's, so the surrounding
 * styles give it the same height and border as the real input and the form
 * does not jump when the field arrives. It is inert: nothing typed here could
 * be lost, because nothing can be typed.
 *
 * Pressing it retries the download (SA O-1). The handler sits on the wrapper
 * because a disabled input does not receive pointer events in every browser.
 */
export function PhoneFieldPlaceholder({ className }: { className: string }) {
  return (
    <div
      className={`PhoneInput ${className}`}
      aria-busy="true"
      onPointerDown={() => {
        void loadPhoneLib();
      }}
    >
      <input type="tel" className="PhoneInputInput" disabled aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
