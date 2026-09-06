'use client';

import type { ReactNode } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * One fact about the setup, on a card.
 *
 * The same card is read three times: on the plan, where it states what is about
 * to happen and can still be changed; during the build, where it reports what
 * actually happened; and — for the one kind of work the platform cannot do —
 * afterwards, still open, saying what is left.
 *
 * That repetition is the point. The plan used to be one tall summary card and
 * the build a list of ticking rows, so the screen a user studied was thrown
 * away by the screen that followed it. Keeping the same six cards in the same
 * order means the build proves the plan rather than replacing it.
 */

export type FactState =
  /** On the plan: a decision, still changeable. */
  | 'plan'
  /** Queued, nothing happening yet. */
  | 'pending'
  /** Being created right now. Only ever one at a time. */
  | 'busy'
  | 'done'
  | 'error';

interface SetupFactCardProps {
  /** The colour of the part of the platform this fact belongs to. */
  color: string;
  icon: ReactNode;
  title: string;
  /** What will happen, or what did — a sentence, never a setting name. */
  value?: ReactNode;
  /** Short pills under the value: services, pipeline stages. */
  chips?: ReactNode;
  state?: FactState;
  /**
   * Work only this person can do — their identity, their credentials, their
   * bank account. Drawn apart from the rest and never turned green by the
   * build, because the build cannot do it.
   */
  yours?: boolean;
  /** A time estimate, or what is still outstanding. */
  note?: string;
  /** Present only where the fact can still be changed. */
  onChange?: () => void;
  changeLabel?: string;
  /** Progress 0-1 while busy. Omitted for an indeterminate wait. */
  progress?: number;
}

export function SetupFactCard({
  color,
  icon,
  title,
  value,
  chips,
  state = 'plan',
  yours = false,
  note,
  onChange,
  changeLabel,
  progress,
}: SetupFactCardProps) {
  const { isRTL } = useLanguage();
  const bodyFont = isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif';

  const accent = yours ? '#C2410C' : color;
  const tinted = (alpha: number) => {
    const hex = accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '14px 16px',
        borderRadius: '14px',
        background: yours ? tinted(0.05) : 'var(--v2-surface)',
        border: `1px solid ${yours ? tinted(0.4) : 'var(--v2-border)'}`,
        // Only what is waiting recedes. A finished card stays at full strength:
        // it is evidence, and evidence should not fade.
        opacity: state === 'pending' ? 0.45 : 1,
        transition: 'opacity 0.3s',
      }}
    >
      {onChange && (
        <button
          onClick={onChange}
          style={{
            position: 'absolute',
            insetInlineEnd: '12px',
            top: '13px',
            fontFamily: bodyFont,
            fontSize: '10.5px',
            color: 'var(--v2-text-muted)',
            border: '1px solid var(--v2-border)',
            borderRadius: '999px',
            padding: '2px 9px',
            background: 'var(--v2-surface)',
            cursor: 'pointer',
          }}
        >
          {changeLabel}
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
        <span
          style={{
            width: 27,
            height: 27,
            borderRadius: '9px',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            background: tinted(0.12),
            color: accent,
          }}
        >
          {icon}
        </span>
        <h4
          style={{
            fontFamily: bodyFont,
            fontSize: '13.5px',
            fontWeight: 600,
            color: 'var(--v2-text-primary)',
            margin: 0,
            minWidth: 0,
          }}
        >
          {title}
        </h4>
      </div>

      {value && (
        <p style={{ fontFamily: bodyFont, fontSize: '13px', lineHeight: 1.45, color: 'var(--v2-text-secondary)', margin: 0 }}>
          {value}
        </p>
      )}

      {chips && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>{chips}</div>}

      {/* Only the card actually working shows a bar, and it is that card's own
          colour — so the eye goes to the one thing happening rather than to
          several competing spinners. */}
      {state === 'busy' && (
        <div style={{ height: '3px', borderRadius: '999px', background: 'var(--v2-border)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: progress === undefined ? '45%' : `${Math.round(progress * 100)}%`,
              borderRadius: '999px',
              background: accent,
              transition: 'width 0.4s ease',
              animation: progress === undefined ? 'setup-fact-slide 1400ms ease-in-out infinite' : undefined,
            }}
          />
        </div>
      )}

      {(state !== 'plan' || note) && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontFamily: bodyFont,
            fontSize: '11px',
            color:
              state === 'done' ? '#1F7A55'
                : state === 'error' ? '#B4442E'
                  : yours ? accent
                    : 'var(--v2-text-muted)',
          }}
        >
          {state === 'done' && <Check style={{ width: 12, height: 12 }} strokeWidth={3} />}
          {state === 'busy' && <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />}
          {state === 'error' && <AlertCircle style={{ width: 12, height: 12 }} />}
          {note}
        </span>
      )}

      <style jsx global>{`
        /* An indeterminate wait still has to look like something is happening,
           without claiming a percentage nobody can compute. */
        @keyframes setup-fact-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(220%); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes setup-fact-slide {
            0%, 100% { transform: none; }
          }
        }
      `}</style>
    </div>
  );
}

/** The deck the cards sit in — one column on a phone, filling out as it can. */
export function SetupFactDeck({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
      }}
    >
      {children}
    </div>
  );
}
