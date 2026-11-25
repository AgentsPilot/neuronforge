'use client';

/**
 * How this client has behaved, beside their name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT KEEPS ITS WORKINGS, AND NO LONGER SHOUTS THEM.
 *
 * This is the one place in the product that makes a claim about a PERSON, and
 * it is read in a drawer an owner may well have open with that person beside
 * them. A badge that said "needs attention" and nothing else would be an
 * accusation the owner could not check, so the counts are never discarded.
 *
 * They are no longer a second line. Under the pill, in the drawer header, they
 * rendered as "3 of 19 meetings not attended · 3 payments past their date"
 * beside the client's own name — a sentence where a badge belongs, in a row
 * laid out for badges, which it broke. They moved to the pill's hover title:
 * no space, no sentence, one gesture to check.
 *
 * ── WHAT IT NEVER RENDERS ───────────────────────────────────────────────────
 * `new` — below the evidence floor there is no pill at all, not a flattering
 * one. One missed session out of one is not a pattern.
 *
 * `reliable` is shown quietly rather than loudly: an owner opening a drawer
 * does not need a green rosette, and a colour on every client would make the
 * two that matter harder to spot.
 *
 * Sessions the BUSINESS called off are not in the reasons at all. They cannot
 * move a band and naming them here would imply they counted.
 *
 * @module components/crm/contact-drawer/ClientStandingBadge
 */

import { useEffect, useState } from 'react';

import { ClientStandingPill } from '@/components/business-os/clients/ClientStandingPill';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ClientStandingBadge' });

type Band = 'new' | 'reliable' | 'watch' | 'at_risk';

interface Reason {
  key: 'missed_sessions' | 'late_payments' | 'overdue_payments';
  count: number;
  of?: number;
}

interface Standing {
  band: Band;
  /** 0–100, the Needs-You card's own firing line at 60. */
  score?: number | null;
  reasons: Reason[];
  /** Null until two pictures far enough apart exist to compare. */
  trend?: 'improving' | 'steady' | 'worsening' | null;
}

export function ClientStandingBadge({ contactId }: { contactId: string }) {
  const { t } = useLanguage();
  const [standing, setStanding] = useState<Standing | null>(null);

  useEffect(() => {
    if (!contactId) return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/crm/contacts/${contactId}/standing`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { success?: boolean; data?: Standing };
        if (body?.success && body.data) setStanding(body.data);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        /* Silent: a drawer about a client must not turn into an error about
           our own reading of them. The rest of the drawer is the point. */
        logger.warn({ err, contactId }, 'Client standing unavailable');
      }
    })();

    return () => controller.abort();
  }, [contactId]);

  if (!standing || standing.band === 'new') return null;

  const fill = (key: string, reason: Reason) =>
    t(key)
      .replace('{count}', String(reason.count))
      .replace('{of}', String(reason.of ?? ''));

  /*
   * The counts, as a title rather than a line.
   *
   * They were a second line under the pill, and in the drawer header that read
   * as a sentence of accusation rather than a badge — "3 of 19 meetings not
   * attended · 3 payments past their date" beside a client's own name, in a
   * header with no room for it. The owner asked for the badge and its score,
   * and nothing else.
   *
   * It is still built, because the module's own rule stands: this is the one
   * place in the product that makes a claim about a PERSON, and a claim the
   * owner cannot check is an accusation. It moves to the pill's hover title,
   * which costs no space and keeps the evidence one gesture away.
   */
  const workings = standing.reasons
    .map(reason => fill(`client.standing.${reason.key}`, reason))
    .join(' · ');

  /* The same pill the Needs-You card draws, from the same component. */
  return (
    <span className="inline-flex min-w-0 self-start">
      <ClientStandingPill
        band={standing.band}
        score={standing.score}
        trend={standing.trend}
        detail={workings || undefined}
      />
    </span>
  );
}
