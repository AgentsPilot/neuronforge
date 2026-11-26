'use client';

/**
 * Copy helpers shared by the deletion drawer, the pending view and Keep my
 * account (DE-10b.2; moved here in DL-2a so the three render `{support}` the
 * same way).
 *
 * @module components/business-os/account-deletion/copyLine
 */

import React from 'react';
// TEMP-ERASURE-CONTACT: the one definition is in lib/business-os/supportContact.ts.
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';

export type CopyFn = (key: string, vars?: Record<string, string | number>) => string;

/** Render a copy line, turning `{support}` into the one support mailto (always left to right). */
export function WithSupport({ text }: { text: string }) {
  const parts = text.split('{support}');
  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <a href={`mailto:${PLACEHOLDER_ERASURE_CONTACT}`} className="underline font-medium" dir="ltr">
              {PLACEHOLDER_ERASURE_CONTACT}
            </a>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

/** `tr` with `{support}` left in place for `WithSupport`. */
export const line = (tr: CopyFn, key: string, vars?: Record<string, string | number>) => tr(key, { support: '{support}', ...vars });
