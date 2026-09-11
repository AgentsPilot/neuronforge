'use client';

import { Check } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types (matching mockup data structure)
// ===========================

export interface HandledEntry {
  /** Main text, e.g. "Answered 9 enquiries" */
  title: string;
  /** Subtext, e.g. "about two minutes each, day and night" */
  detail: string;
}

interface HandledSectionProps {
  entries: HandledEntry[];
  /** If true, renders as standalone card. If false, renders as section inside parent card */
  standalone?: boolean;
}

// ===========================
// Component (matching mockup .hdl exactly)
// CSS Reference from mockup:
// .hdl{border-top:1px solid var(--line);padding:15px 22px 18px}
// .hdl-h{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
// .hdl-row{display:flex;gap:10px;align-items:flex-start;padding:7px 0}
// .hdl-tick{width:18px;height:18px;border-radius:50%;background:#E6F8F0;flex:none;display:grid;place-items:center;margin-top:1px}
// .hdl-tick svg{width:10px;height:10px;stroke:#1B9A6C;fill:none;stroke-width:3.2}
// .hdl-row b{font-size:13.5px;font-weight:600;display:block}
// .hdl-row small{font-size:12.5px;color:var(--muted)}
// ===========================

export function HandledSection({ entries, standalone = false }: HandledSectionProps) {
  const { t, isRTL } = useLanguage();

  if (!entries || entries.length === 0) {
    return null;
  }

  return (
    <div
      className="hdl"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: standalone ? 'var(--v2-surface)' : undefined,
        border: standalone ? '1px solid var(--v2-border)' : undefined,
        borderTop: standalone ? undefined : '1px solid var(--v2-border)',
        borderRadius: standalone ? '18px' : undefined,
        padding: '15px 22px 18px',
      }}
    >
      {/* Header: .hdl-h */}
      <div
        className="hdl-h"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--v2-text-secondary)',
          marginBottom: '10px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {t('handled.title') || "What I've handled for you today"}
      </div>

      {/* Items */}
      <div>
        {entries.map((entry, index) => (
          <div
            key={index}
            className="hdl-row"
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              padding: '7px 0',
            }}
          >
            {/* Green checkmark circle: .hdl-tick */}
            <span
              className="hdl-tick"
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: 'rgba(34, 197, 139, 0.12)',
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                marginTop: '1px',
              }}
            >
              <Check
                style={{
                  width: '10px',
                  height: '10px',
                  color: '#22C58B',
                  strokeWidth: 3.2,
                }}
              />
            </span>

            {/* Text container */}
            <span>
              <b
                style={{
                  fontSize: '13.5px',
                  fontWeight: 600,
                  display: 'block',
                  color: 'var(--v2-text-primary)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {entry.title}
              </b>
              <small
                style={{
                  fontSize: '12.5px',
                  color: 'var(--v2-text-secondary)',
                  display: 'block',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {entry.detail}
              </small>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
