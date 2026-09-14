'use client';

import { useId, useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Switch } from '@/components/ui/switch';

interface DailyBriefingCardProps {
  /** One fact per line, already in the reader's language. */
  lines: string[];
  /** Formatted for display, e.g. "Monday, 8 September". */
  dateLabel: string;
  /** Whether this briefing is also emailed each morning. */
  emailEnabled?: boolean;
  /**
   * The business's timezone, named in the hint so "morning" is unambiguous.
   * Undefined means none is set, and the switch cannot be turned on.
   */
  timezone?: string;
}

/**
 * Today, as a list of facts.
 *
 * Sits beside the weekly verdict rather than above it: the two describe
 * different periods, and stacking them made one long block of prose where the
 * reader could not tell which sentence covered which span. Side by side, each
 * card carries its own period label and the comparison is the layout.
 *
 * A list rather than a paragraph because that is how this gets read — scanned
 * in a few seconds for the one line that needs acting on, not read through.
 */
export function DailyBriefingCard({
  lines,
  dateLabel,
  emailEnabled = false,
  timezone,
}: DailyBriefingCardProps) {
  const { t, isRTL } = useLanguage();

  /*
   * Held locally so the switch responds immediately, and reverted if the save
   * is refused — a control that reports success the server never granted is
   * worse than a slow one.
   */
  const [enabled, setEnabled] = useState(emailEnabled);
  const [saving, setSaving] = useState(false);
  // Stable id so the label targets this switch and not another card's.
  const switchId = useId();

  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  const canEnable = Boolean(timezone);

  const toggleEmail = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);

    try {
      const res = await fetch('/api/business-os/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_briefing_email_enabled: next }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch {
      setEnabled(previous);
    } finally {
      setSaving(false);
    }
  };

  if (lines.length === 0) return null;

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        minWidth: 0,
        // Column flex so the opt-in can be pushed to the bottom edge with
        // `marginTop: auto` however tall the grid row turns out to be.
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '10px',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--v2-text-secondary)',
            background: 'var(--v2-bg)',
            padding: '3px 9px',
            borderRadius: '20px',
            fontFamily: bodyFont,
          }}
        >
          {t('briefing.today') || 'Today'}
        </span>

        <span style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)', fontFamily: bodyFont }}>
          {dateLabel}
        </span>
      </div>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
        }}
      >
        {lines.map((line, index) => (
          <li
            key={index}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              fontSize: '13.5px',
              lineHeight: 1.45,
              color: 'var(--v2-text-primary)',
              fontFamily: bodyFont,
            }}
          >
            {/*
              A dot rather than a bullet glyph: it sits on the text baseline in
              both scripts, where a "•" drifts in Hebrew and needs per-locale
              nudging to look centred.
            */}
            <span
              aria-hidden
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: 'var(--v2-border)',
                flexShrink: 0,
                marginTop: '7px',
              }}
            />
            <span style={{ minWidth: 0 }}>{line}</span>
          </li>
        ))}
      </ul>

      {/*
        The email opt-in lives here rather than in settings: this is the thing
        being subscribed to, and it is where someone reading it decides they
        would rather have it in their inbox. `marginTop: auto` pins it to the
        bottom so the card can stretch to match the one beside it without the
        control floating in the middle.
      */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginTop: 'auto',
          paddingTop: '14px',
          opacity: canEnable ? 1 : 0.6,
        }}
      >
        <label
          htmlFor={switchId}
          style={{ minWidth: 0, cursor: canEnable ? 'pointer' : 'not-allowed' }}
        >
          <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--v2-text-primary)', fontFamily: bodyFont }}>
            {t('briefing.email_toggle') || 'Email this to me each morning'}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: '2px',
              fontSize: '11px',
              color: 'var(--v2-text-muted)',
              fontFamily: bodyFont,
              lineHeight: 1.4,
            }}
          >
            {canEnable
              ? (t('briefing.email_hint') || 'Sent each morning, {timezone}. Quiet days are skipped.')
                  .replace('{timezone}', timezone as string)
              : t('briefing.email_needs_timezone') ||
                'Choose your timezone first, so this arrives in your morning.'}
          </span>
        </label>

        {/*
          `dir="ltr"` on the switch itself, deliberately.

          The shared Switch moves its thumb with `translate-x-[20px]`, which is
          a fixed rightward shift. Inside this card's RTL container the track
          lays out right-to-left, so the thumb starts at the right edge and that
          shift would carry it out of the track entirely. Pinning the control to
          LTR keeps the thumb travelling within its own track; the row around it
          still mirrors, so the switch sits on the correct side of the label.
        */}
        <div dir="ltr" style={{ flexShrink: 0 }}>
          <Switch
            id={switchId}
            checked={enabled}
            disabled={saving || !canEnable}
            onCheckedChange={toggleEmail}
          />
        </div>
      </div>
    </div>
  );
}
