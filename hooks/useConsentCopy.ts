'use client';

/**
 * Fetches the consent sentence for a public form.
 *
 * Returns `null` until it has one, and `null` forever if the business has
 * capture switched off or the request fails. Every caller renders the checkbox
 * only when this is non-null, which means the failure mode is a form with no
 * checkbox rather than a form with an unlabelled one.
 *
 * That is the right way round: a missing checkbox loses a consent record; a
 * checkbox with no statement records a consent to nothing, which is worse than
 * useless — it is evidence that says nothing while looking like evidence.
 *
 * @module hooks/useConsentCopy
 */

import { useEffect, useState } from 'react';
import type { ConsentCopy } from '@/components/public/ConsentCheckbox';

export function useConsentCopy(params: {
  subdomain?: string | null;
  userCode?: string | null;
  locale?: string;
}): ConsentCopy | null {
  const { subdomain, userCode, locale } = params;
  const [copy, setCopy] = useState<ConsentCopy | null>(null);

  useEffect(() => {
    if (!subdomain && !userCode) return;

    let cancelled = false;
    const query = new URLSearchParams();
    if (subdomain) query.set('subdomain', subdomain);
    if (userCode) query.set('userCode', userCode);
    if (locale) query.set('locale', locale);

    fetch(`/api/public/consent-copy?${query.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.success || !json.data?.enabled) return;
        setCopy({
          text: json.data.text,
          locale: json.data.locale,
          version: json.data.version,
          privacyPolicyUrl: json.data.privacyPolicyUrl ?? null,
        });
      })
      .catch(() => {
        // Silent: a form that cannot reach this still has to work.
      });

    return () => {
      cancelled = true;
    };
  }, [subdomain, userCode, locale]);

  return copy;
}

/** What a form sends back. Shaped to `lib/validation/consent.ts`. */
export function consentPayload(copy: ConsentCopy | null, granted: boolean) {
  if (!copy) return undefined;
  return {
    granted,
    statement_text: copy.text,
    statement_locale: copy.locale,
    statement_version: copy.version,
    privacy_policy_url: copy.privacyPolicyUrl ?? undefined,
  };
}
