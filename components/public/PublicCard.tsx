// components/public/PublicCard.tsx

interface PublicCardProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * The element to render. `section` by default, because most of these are a
   * titled region of the page; `div` for a card that carries no heading, `li`
   * inside a list.
   */
  as?: 'section' | 'div' | 'li' | 'article';
  /**
   * The lead card of a set. Bold is the only composition that does anything
   * with it today (a brand-coloured edge), which is the point: a composition
   * may mark emphasis however it likes, or not at all.
   */
  lead?: boolean;
  children: React.ReactNode;
}

/**
 * A surface on a public page, drawn by the business's TEMPLATE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Five components painted their own card, each inlining the same three
 * declarations:
 *
 *   background: var(--ap-surface)
 *   border: 1px solid var(--ap-border)
 *   borderRadius: var(--ap-radius-lg)
 *
 * Those are exactly the three a composition owns, and an inline style cannot
 * be overridden by one. So the whole composition layer — three sets of bones
 * plus per-archetype overrides, all of it already written and tested — reached
 * the portal, the invoice and the proposal not at all. An owner who switched
 * template got different colours and identical furniture, which is the
 * complaint this work started from.
 *
 * Rendering `apc-panel` instead hands those three properties back to the
 * template. Stone draws a transparent panel with a single hairline above it
 * and square corners; warm draws an 18px card; bold draws a 20px card and can
 * mark a lead. None of that is new code — it is the composition layer finally
 * being allowed to apply.
 *
 * WHAT A CALLER MUST NOT DO
 *
 * Do not pass background, border or border-radius, in `style` or as a Tailwind
 * class. That is the whole point: the composition decides, and an inline style
 * would silently win. Padding is also the composition's where one is active,
 * so a caller's padding class applies only on palette-only themes — set it for
 * that case, but do not rely on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PublicCard({
  as = 'section',
  lead = false,
  className = '',
  children,
  ...rest
}: PublicCardProps) {
  const Tag = as;
  return (
    <Tag className={`apc-panel${lead ? ' apc-panel--lead' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </Tag>
  );
}
