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

  /*
   * State-specific styles.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY EVERY TINT IS MIXED AGAINST `--v2-surface`
   *
   * The mockup this came from was light-only, so the lit and learning states
   * were translucent washes (`rgba(34,197,139,.08)`) while the unlit state was
   * an opaque `--v2-surface`. Over a light page those land in the same place and
   * the hierarchy reads correctly.
   *
   * In dark mode they came apart: `--v2-surface` (#1E293B) is LIGHTER than the
   * strip behind it (#0F172A), while an 8% wash over that strip stays darker
   * than both. The vectors being actively read receded and the dead ones popped
   * — the ranking inverted, which is the opposite of what this strip exists to
   * say.
   *
   * Mixing each tint into `--v2-surface` puts all three states on one base, so
   * they differ by hue and strength only and the order holds in either theme.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const getStyles = () => {
    switch (vector.state) {
      case 'lit':
        return {
          bg: 'color-mix(in srgb, #22C58B 14%, var(--v2-surface))',
          border: 'color-mix(in srgb, #22C58B 45%, var(--v2-surface))',
          color: 'var(--v2-text-primary)',
          fontWeight: 600,
          dotBg: '#22C58B',
          dotSize: 8,
          dotBorder: 'none',
          // Mixed too: a fixed rgba halo sat as a dark smudge on a dark pill.
          dotShadow: '0 0 0 3px color-mix(in srgb, #22C58B 28%, transparent)',
        };
      case 'learn':
        return {
          bg: 'color-mix(in srgb, #F59E0B 9%, var(--v2-surface))',
          border: 'color-mix(in srgb, #F59E0B 40%, var(--v2-surface))',
          color: 'var(--v2-text-secondary)',
          fontWeight: 400,
          // The dot is a hollow ring, so it takes the pill's own background
          // rather than the card's — otherwise it reads as a hole in dark mode.
          dotBg: 'color-mix(in srgb, #F59E0B 9%, var(--v2-surface))',
          dotSize: 10,
          dotBorder: '2px dotted #F59E0B',
          dotShadow: 'none',
        };
      default:
        /*
         * Not yet reading this one: the quietest of the three, but still a word
         * the reader has to be able to read.
         *
         * This was `--v2-text-muted`, which is #9CA3AF in light and #94A3B8 in
         * dark. On the pill's white surface that is 2.5:1 — well under WCAG AA
         * — so the four unlit vector names were a pale smudge. The same token
         * on the dark surface is 5.7:1 and looks fine, which is why the strip
         * read correctly in dark mode and washed out in light.
         *
         * `--v2-text-secondary` is 4.8:1 light and 9.9:1 dark, and stays
         * plainly quieter than the lit state, which is near-black and bold.
         */
        return {
          bg: 'var(--v2-surface)',
          border: 'var(--v2-border)',
          color: 'var(--v2-text-secondary)',
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
      /*
       * Namespaced, and it has to stay that way.
       *
       * `VectorState` is `'dark' | 'learn' | 'lit'`, so interpolating it raw
       * put `class="vec dark"` on every vector this business is not reading
       * yet — and `globals-v2.css` defines the whole dark palette on a bare
       * `.dark` selector, for Radix portals that render outside the themed
       * container. Each unlit pill therefore redefined `--v2-surface`,
       * `--v2-text-secondary` and the rest ON ITSELF and painted navy with
       * pale text, in the middle of a light page. Dark mode looked correct
       * because there the override happened to agree with the theme.
       *
       * The state is presentational here anyway — every colour comes from
       * `getStyles()` below, and nothing selects on these class names.
       */
      className={`vec vec--${vector.state}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        borderRadius: '20px',
        // Logical, not physical: the tight side belongs next to the dot, and
        // the dot leads in both directions.
        paddingBlock: '6px',
        paddingInlineStart: '10px',
        paddingInlineEnd: '12px',
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
