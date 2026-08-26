'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

interface VerdictCardProps {
  status: 'ok' | 'warn';
  verdict: string;
  verdictSub: string;
  when: string;
}

// ===========================
// Component (matching mockup .lv-verdict)
// ===========================

export function VerdictCard({
  status,
  verdict,
  verdictSub,
  when,
}: VerdictCardProps) {
  const { isRTL } = useLanguage();

  return (
    <div
      className={`lv-verdict ${status === 'warn' ? 'warn' : ''}`}
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        display: 'flex',
        gap: '13px',
        alignItems: 'flex-start',
        background: '#FFFFFF',
        border: '1px solid #E7E9F1',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        marginBottom: '14px',
      }}
    >
      {/* Live pulse dot: .lv-live */}
      <span
        className="lv-live"
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: status === 'warn' ? '#FFB24D' : '#22C58B',
          flexShrink: 0,
          marginTop: '7px',
          position: 'relative',
        }}
      >
        {/* Pulse animation */}
        <span
          style={{
            content: '""',
            position: 'absolute',
            inset: '-5px',
            borderRadius: '50%',
            background: status === 'warn'
              ? 'rgba(255,178,77,0.3)'
              : 'rgba(34,197,139,0.28)',
            animation: 'lvPulse 2.2s ease-out infinite',
          }}
        />
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* When badge: .lv-v-when */}
        <span
          style={{
            display: 'inline-block',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: '#697187',
            background: '#F1F3F8',
            padding: '3px 9px',
            borderRadius: '20px',
            marginBottom: '7px',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {when}
        </span>

        {/* Verdict title: .lv-v-t */}
        <div
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '19px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            marginBottom: '4px',
            color: '#131A2B',
          }}
        >
          {verdict}
        </div>

        {/* Verdict subtext: .lv-v-p */}
        <div
          style={{
            fontSize: '14.5px',
            color: '#697187',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {verdictSub}
        </div>
      </div>

      {/* Global keyframes for pulse animation */}
      <style jsx global>{`
        @keyframes lvPulse {
          0% {
            transform: scale(0.6);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
