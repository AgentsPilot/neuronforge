'use client';

/**
 * A tab that cannot work yet, said once and with a way forward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SIGNPOST, NOT A LOCKED DOOR.
 *
 * Money, Online presence and Business overview all read from a business that
 * has sold something. On an account whose catalogue is still drafts they are
 * three pages of zeroes and empty charts, and an owner who opens one learns
 * nothing except that the product looks broken.
 *
 * Hiding the tabs was the alternative and is worse: the owner cannot see what
 * the platform will do for them, and a tab that appears later with no
 * explanation reads as a feature that was being withheld. So the tab stays, it
 * opens, and it says the one true thing about itself plus the step that fills
 * it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE IS "NOTHING HAS EVER BEEN PUBLISHED", and it is deliberately not
 * `isReadyForClients`.
 *
 * A business trading for months can fail the readiness test by having one
 * compulsory field emptied, and replacing its money page with a setup prompt
 * would be a far worse bug than the one this fixes. `setup-status` answers the
 * narrow question: is the `services` step complete, which counts only
 * `status = 'active'`. No active service has ever existed, or one has.
 *
 * FAILS OPEN. If the check cannot run, the page renders. A gate that appears
 * because a request timed out would take a working business's money page away.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useLanguage } from '@/lib/business-os/LanguageContext';

type Verdict = 'checking' | 'open' | 'gated';

interface Props {
  /** Which tab is asking, so the sentence is about this page. */
  area: 'money' | 'presence' | 'overview';
  children: React.ReactNode;
}

export function NotYetGate({ area, children }: Props) {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const [verdict, setVerdict] = useState<Verdict>('checking');

  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/business-os/setup-status');
        if (!response.ok) { if (!cancelled) setVerdict('open'); return; }

        const body = await response.json();
        const status = body?.status;
        if (!body?.success || !status) { if (!cancelled) setVerdict('open'); return; }

        const steps: Array<{ id: string; complete: boolean }> = status.steps ?? [];

        /*
         * ───────────────────────────────────────────────────────────────────
         * A TAB OPENS WHEN ITS OWN CONFIGURATION IS DONE.
         *
         * Not "relevant", which is a softer test and the wrong one: a card
         * business with no processor has a highly relevant money page and
         * nothing that works on it.
         *
         * `setup-status` is the right source because it already filters the
         * steps by `applies` — the graph's own rule for what a business needs.
         * So an ABSENT step is not an unfinished one, it is a step this
         * business will never owe:
         *
         *   · an invoice-only shop has no `payments` step at all, because
         *     `payments.applies` is `collectsOnline`. Its money page opens,
         *     correctly, with no Stripe anywhere in sight.
         *   · a card business with no processor has `payments` present and
         *     incomplete, and waits.
         *
         * Reading an absence as "not done" is how a business that declined a
         * thing gets locked out of the page for it, permanently.
         * ───────────────────────────────────────────────────────────────────
         */
        const done = (id: string) => {
          const step = steps.find(candidate => candidate.id === id);
          return !step || step.complete === true;
        };

        const ready =
          area === 'money'
            ? done('payments')
            : area === 'presence'
              /*
               * ANYTHING LIVE, not `done('website')`.
               *
               * This gated the page on the website step, which is the step this
               * page EXISTS to finish. The dashboard's "being found" card sends
               * an owner here with `?view=links` to make their booking link,
               * and the gate met them with "your page opens when it is
               * published" — a sign telling them to go and do the thing they
               * had just pressed a button to start.
               *
               * A gate on the page that performs the work is always wrong. The
               * honest condition is whether there is anything to put on a page:
               * `services` is complete once one service is active, and before
               * that a booking link would point at an empty catalogue.
               */
              ? done('services')
              /*
               * ANYTHING LIVE, not `allComplete`.
               *
               * This read `status.allComplete`, and that was a bug waiting for
               * a real account: the list includes `design`, the brand look,
               * which is recommended and not required. A business trading for a
               * year that never opened the theme editor has `allComplete`
               * false forever, and would have found its Business overview
               * replaced by a setup prompt.
               *
               * The honest condition is the one the page is about: has anything
               * ever been sold. `services` is complete when at least one
               * service is `active`, which is exactly that.
               */
              : done('services');

        if (!cancelled) setVerdict(ready ? 'open' : 'gated');
      } catch {
        if (!cancelled) setVerdict('open');
      }
    })();

    return () => { cancelled = true; };
  }, [area]);

  /*
   * Nothing is drawn while the answer is unknown.
   *
   * Rendering the page and then replacing it with a gate, or the other way
   * round, is a flash of the wrong answer on every visit. The check is one
   * cheap request.
   */
  if (verdict === 'checking') return null;
  if (verdict === 'open') return <>{children}</>;

  const LINES: Record<Props['area'], { title: string; body: string }> = {
    money: {
      title: tr('gate.money.title', 'Money starts here once something is live'),
      body: tr(
        'gate.money.body',
        'Invoices, payments and what you are owed all follow a client buying something. Publish your first service and this fills itself in.'
      ),
    },
    presence: {
      title: tr('gate.presence.title', 'Your page goes live with your first service'),
      body: tr(
        'gate.presence.body',
        'A page needs something to show. Finish a service and publish it, and your booking page has something for a client to pick.'
      ),
    },
    overview: {
      title: tr('gate.overview.title', 'Numbers arrive once clients do'),
      body: tr(
        'gate.overview.body',
        'This reads what actually happened: bookings, revenue, where people came from. Publish your first service and it starts recording.'
      ),
    },
  };

  const copy = LINES[area];

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        maxWidth: '560px',
        margin: '0 auto',
        padding: '56px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: '19px',
          fontWeight: 600,
          color: 'var(--v2-text-primary)',
          fontFamily: isRTL
            ? '"Heebo", system-ui, sans-serif'
            : '"Space Grotesk", system-ui, sans-serif',
          letterSpacing: '-0.015em',
        }}
      >
        {copy.title}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: '13.5px',
          lineHeight: 1.5,
          color: 'var(--v2-text-secondary)',
        }}
      >
        {copy.body}
      </p>

      <button
        type="button"
        onClick={() => router.push('/business-os')}
        className="ap-primary-lift"
        style={{
          marginTop: '6px',
          border: 'none',
          background: 'var(--v2-primary)',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
          padding: '10px 17px',
          borderRadius: '11px',
          cursor: 'pointer',
        }}
      >
        {tr('gate.cta', 'Finish your first service')}
      </button>

      {/* Nothing is being withheld, and saying so costs one line. */}
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--v2-text-muted)' }}>
        {tr('gate.note', 'Nothing is locked. There is simply nothing here to show yet.')}
      </p>
    </div>
  );
}
