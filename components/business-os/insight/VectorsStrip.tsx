'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { VectorStatus } from '@/lib/business-os/insight/repository/InsightRepository';
// The hook's shape, not the repository's: this renders what the API returned,
// which may be a response cached from before a field existed. The repository
// type is the server's guarantee and is stricter than anything a client holds.
import type { VectorMaturityData } from '@/hooks/useInsights';

// ===========================
// Types
// ===========================

interface VectorsStripProps {
  vectorMaturity: VectorMaturityData;
  /** If true, renders as standalone card. If false, renders as section inside parent card */
  standalone?: boolean;
}

// ===========================
// Component (matching mockup .vecs-wrap exactly)
// CSS Reference from mockup:
// .vecs-wrap{border-top:1px solid var(--line);background:#FBFCFE;padding:15px 22px 17px}
// .vecs-h{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:11px}
// .vecs{display:flex;flex-wrap:wrap;gap:8px}
// .vec{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;border-radius:20px;padding:6px 12px 6px 10px;font-size:12.5px;color:#9AA1B2}
// .vec-dot{width:8px;height:8px;border-radius:50%;background:#DDE1EA;flex:none}
// .vec.lit{color:var(--text);font-weight:600;border-color:#CFEDDF;background:#F5FCF9}
// .vec.lit .vec-dot{background:var(--green);box-shadow:0 0 0 3px rgba(34,197,139,.16)}
// .vec.learn{color:#8A7A5E;border-color:#F0E2CC;background:#FFFCF7}
// .vec.learn .vec-dot{background:#fff;border:2px dotted var(--amber);width:10px;height:10px}
// .vec-note{font-size:12.5px;color:var(--muted);margin-top:11px;line-height:1.45}
// ===========================

export function VectorsStrip({ vectorMaturity, standalone = false }: VectorsStripProps) {
  const { t, isRTL } = useLanguage();

  // Defensive: ensure vectorMaturity and vectors exist
  if (!vectorMaturity || !vectorMaturity.vectors) {
    return null;
  }

  const { vectors, note, noteKey, noteLearning, litCount } = vectorMaturity;

  /**
   * The note, in the reader's language.
   *
   * It used to arrive as finished English prose built in the repository, where
   * there is no reader and therefore no language — so a Hebrew business was
   * told "Reading 0 of 7. I start watching the moment you publish" in English.
   * The server now sends a key and, for the partial case, the vector KEYS still
   * learning, which localise through the same `insight.vector.{key}` lookup the
   * pills already use.
   *
   * Falls back to the English `note` if a response predates `noteKey`.
   */
  const localizedNote = (() => {
    if (!noteKey) return note;

    const sentence = t(noteKey, { lit: litCount });

    if (noteKey !== 'vecs.note.partial' || !noteLearning?.length) return sentence;

    const names = noteLearning.map(key => {
      const nameKey = `insight.vector.${key}`;
      const translated = t(nameKey);
      return translated !== nameKey ? translated : key;
    });

    // A separate sentence rather than a clause, so no language has to agree a
    // verb with a list whose length changes.
    return `${sentence} ${t('vecs.note.learning', { list: names.join(', ') })}`;
  })();

  return (
    <div
      className="vecs-wrap"
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-bg)',
        borderTop: standalone ? 'none' : '1px solid var(--v2-border)',
        border: standalone ? '1px solid var(--v2-border)' : undefined,
        borderRadius: standalone ? '18px' : undefined,
        padding: '15px 22px 17px',
      }}
    >
      {/* Header: .vecs-h */}
      <div
        className="vecs-h"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: 'var(--v2-text-secondary)',
          marginBottom: '11px',
          fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
        }}
      >
        {t('insight.vectors.title') || "What I'm watching"}
      </div>

      {/* Vectors Row: .vecs */}
      <div
        className="vecs"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {vectors.map((vector) => (
          <VectorPill key={vector.key} vector={vector} isRTL={isRTL} t={t} />
        ))}
      </div>

      {/* Explanation Note: .vec-note */}
      {localizedNote && (
        <div
          className="vec-note"
          style={{
            fontSize: '12.5px',
            color: 'var(--v2-text-secondary)',
            marginTop: '11px',
            lineHeight: 1.45,
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
          }}
        >
          {localizedNote}
        </div>
      )}
    </div>
  );
}

// ===========================
// Sub-component: VectorPill (matching mockup .vec exactly)
// ===========================

interface VectorPillProps {
  vector: VectorStatus;
  isRTL: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function VectorPill({ vector, isRTL, t }: VectorPillProps) {
  // Get localized vector name
  const getVectorName = () => {
    const key = `insight.vector.${vector.key}`;
    const translated = t(key);
    return translated !== key ? translated : vector.name;
  };

  // State-specific styles matching mockup exactly
  const getStyles = () => {
    switch (vector.state) {
      case 'lit':
        // .vec.lit{color:var(--text);font-weight:600;border-color:#CFEDDF;background:#F5FCF9}
        return {
          bg: 'rgba(34, 197, 139, 0.08)',
          border: 'rgba(34, 197, 139, 0.30)',
          color: 'var(--v2-text-primary)',
          fontWeight: 600,
          dotBg: '#22C58B', // var(--green)
          dotSize: 8,
          dotBorder: 'none',
          dotShadow: '0 0 0 3px rgba(34,197,139,0.16)',
        };
      case 'learn':
        // .vec.learn{color:#8A7A5E;border-color:#F0E2CC;background:#FFFCF7}
        // .vec.learn .vec-dot{background:#fff;border:2px dotted var(--amber);width:10px;height:10px}
        return {
          bg: 'rgba(245, 158, 11, 0.08)',
          border: 'rgba(245, 158, 11, 0.30)',
          color: 'var(--v2-text-secondary)',
          fontWeight: 400,
          dotBg: 'var(--v2-surface)',
          dotSize: 10,
          dotBorder: '2px dotted #FFB24D',
          dotShadow: 'none',
        };
      default: // dark
        // .vec{...border:1px solid var(--line);background:#fff;...color:#9AA1B2}
        // .vec-dot{...background:#DDE1EA}
        return {
          bg: 'var(--v2-surface)',
          border: 'var(--v2-border)',
          color: 'var(--v2-text-muted)',
          fontWeight: 400,
          dotBg: 'var(--v2-border)',
          dotSize: 8,
          dotBorder: 'none',
          dotShadow: 'none',
        };
    }
  };

  const styles = getStyles();

  return (
    <span
      className={`vec ${vector.state}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        borderRadius: '20px',
        padding: '6px 12px 6px 10px',
        fontSize: '12.5px',
        color: styles.color,
        fontWeight: styles.fontWeight,
        fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
      }}
      title={vector.note}
    >
      {/* Dot: .vec-dot */}
      <i
        className="vec-dot"
        style={{
          width: `${styles.dotSize}px`,
          height: `${styles.dotSize}px`,
          borderRadius: '50%',
          background: styles.dotBg,
          border: styles.dotBorder,
          boxShadow: styles.dotShadow,
          flexShrink: 0,
          display: 'block',
        }}
      />

      {/* Vector Name */}
      {getVectorName()}
    </span>
  );
}
