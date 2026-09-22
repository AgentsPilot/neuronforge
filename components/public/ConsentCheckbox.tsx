'use client';

/**
 * The marketing consent tick, on every public form.
 *
 * Four properties, each of which is the difference between consent that counts
 * and consent that does not:
 *
 * UNTICKED. The parent holds `useState(false)` and there is no `defaultChecked`
 * here. A pre-ticked box is not consent in any of the jurisdictions this
 * product operates in, and it is the single most likely "improvement" someone
 * makes to this component for conversion reasons. Do not.
 *
 * OPTIONAL. Never `required`, and never a reason to block a submit. Consent
 * conditioned on getting the appointment is not freely given, which voids it —
 * so a checkbox that gates the form destroys the very thing it collects.
 *
 * THE STATEMENT IS THE LABEL. Not "I agree to the terms" with the terms
 * elsewhere: the sentence the person is agreeing to is the thing they read.
 *
 * SEPARATE FROM EVERYTHING ELSE. Never bundled with terms acceptance, treatment
 * consent or anything else. Bundling makes each of them unspecific, and takes
 * the others down with it.
 *
 * @module components/public/ConsentCheckbox
 */

import React, { useId } from 'react';

export interface ConsentCopy {
  text: string;
  locale: string;
  version: number;
  privacyPolicyUrl: string | null;
  /** The link's own words, in the visitor's language. */
  privacyLinkLabel?: string;
}

interface Props {
  copy: ConsentCopy;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  isRTL?: boolean;
  className?: string;
}

export function ConsentCheckbox({ copy, checked, onChange, disabled, isRTL, className }: Props) {
  const id = useId();

  if (!copy.text?.trim()) return null;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        // Logical, not `left`/`right`: Hebrew is live.
        textAlign: 'start',
        marginBlockStart: '0.75rem',
      }}
      dir={isRTL ? 'rtl' : undefined}
    >
      <input
        id={id}
        type="checkbox"
        // No defaultChecked. See the note at the top of this file.
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ marginBlockStart: '0.2rem', flexShrink: 0, cursor: 'pointer' }}
      />
      <label
        htmlFor={id}
        style={{
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          color: 'var(--ap-text-muted, #64748b)',
          cursor: 'pointer',
        }}
      >
        {copy.text}
        {copy.privacyPolicyUrl && (
          <>
            {' '}
            <a
              href={copy.privacyPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
              // Stops the label's click from toggling the box when someone is
              // trying to read the notice before deciding.
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--ap-primary, #4F6EF7)', textDecoration: 'underline' }}
            >
              {copy.privacyLinkLabel || 'Privacy notice'}
            </a>
          </>
        )}
      </label>
    </div>
  );
}
