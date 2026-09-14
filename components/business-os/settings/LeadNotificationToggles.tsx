'use client';

/**
 * How this business hears about a new enquiry, and what happens next.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SWITCHES, AND THE LINE BETWEEN THEM IS "MUST YOU ACT?"
 *
 *   straight away  an enquiry or a quote request — somebody waiting on the
 *                  owner personally. ON for everyone: not being told was the
 *                  bug this whole piece of work exists to fix.
 *   the briefing   everything else. Bookings, money owed, intake not returned.
 *                  News, not errands, and once a morning is the right cadence
 *                  for it.
 *
 * A booking deliberately appears in neither as an immediate email: it has
 * already resolved itself and is in the owner's calendar. Six "things went
 * right" emails a day is how somebody learns to filter the sender, taking the
 * one that mattered with it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Permission for the platform to write to a client on the business's behalf.
 * That is not a notification preference, and asking for it on a settings screen
 * gets the worst of both: somebody has to imagine a situation and legislate for
 * it, with no idea how often it would come up. It is asked instead by the
 * operational advisor, next to the count of things it would clear — where
 * "three invoices are past due, shall I chase them?" is a decision rather than
 * a checkbox.
 *
 * Held locally and reverted on refusal, the same way `DailyBriefingCard` does
 * it: a switch that reports success the server never granted is worse than a
 * slow one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

type Field = 'lead_alert_email_enabled' | 'daily_briefing_email_enabled';

export function LeadNotificationToggles() {
  const { t } = useLanguage();

  // Alert defaults on, auto-reply defaults off — matching the column defaults,
  // so the first paint agrees with what the server will say.
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [briefingEnabled, setBriefingEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/business-os/business-profile')
      .then(response => response.json())
      .then(data => {
        if (!data?.success) return;
        setAlertEnabled(data.lead_alert_email_enabled ?? true);
        setBriefingEnabled(Boolean(data.daily_briefing_email_enabled));
      })
      .catch(() => {
        /* Leave the defaults showing rather than an empty panel. */
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = async (field: Field, next: boolean, revert: (value: boolean) => void) => {
    try {
      const response = await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      const data = await response.json();
      if (!data?.success) revert(!next);
    } catch {
      revert(!next);
    }
  };

  return (
    <div className="space-y-4" aria-busy={!loaded}>
      <Toggle
        checked={alertEnabled}
        onChange={next => {
          setAlertEnabled(next);
          save('lead_alert_email_enabled', next, setAlertEnabled);
        }}
        label={t('leads.alert_toggle')}
        hint={t('leads.alert_hint')}
      />

      <Toggle
        checked={briefingEnabled}
        onChange={next => {
          setBriefingEnabled(next);
          save('daily_briefing_email_enabled', next, setBriefingEnabled);
        }}
        label={t('leads.briefing_toggle')}
        hint={t('leads.briefing_hint')}
      />

    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-sm text-[var(--v2-text-primary)]">{label}</span>
        <span className="block text-xs text-[var(--v2-text-muted)] mt-0.5">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 shrink-0 accent-[var(--v2-primary)]"
      />
    </label>
  );
}
