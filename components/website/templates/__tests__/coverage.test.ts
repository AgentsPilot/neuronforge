import { TEMPLATES, TEMPLATE_SECTIONS, templateRendererFor } from '@/components/website/templates/registry';
import { getArchetype } from '@/lib/website-builder/archetypes';
import { BLOCK_TYPES } from '@/components/website/blocks/types';

/*
 * The four sections that keep their own components on purpose: each carries
 * real state — availability, a multi-step journey, a payment intent, a
 * submitting form — and is dressed by the stylesheet instead. Plus services and
 * pricing, which choose their own arrangement from `theme.layouts` and own the
 * booking handler.
 */
const DRESSED_NOT_DRAWN = [
  'booking_widget', 'process_flow', 'payment_button', 'contact_form',
  'services', 'pricing',
];

describe('template coverage', () => {
  it('every shipped template draws every section it is responsible for', () => {
    const missing: string[] = [];
    TEMPLATES.forEach(id => {
      const theme = getArchetype(id);
      expect(theme).not.toBeNull();
      TEMPLATE_SECTIONS.forEach(section => {
        if (!templateRendererFor(theme, section)) missing.push(`${id}/${section}`);
      });
    });
    expect(missing).toEqual([]);
  });

  it('accounts for all 21 section types — drawn by a template, or deliberately not', () => {
    const unaccounted = BLOCK_TYPES.filter(
      t => !TEMPLATE_SECTIONS.includes(t) && !DRESSED_NOT_DRAWN.includes(t)
    );
    expect(unaccounted).toEqual([]);
  });

  it('draws nothing for a theme that names no design, so old pages are untouched', () => {
    expect(templateRendererFor(null, 'hero')).toBeNull();
    expect(templateRendererFor({ colors: {}, fonts: {} } as never, 'hero')).toBeNull();
  });
});
