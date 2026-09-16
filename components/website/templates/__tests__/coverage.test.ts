import { TEMPLATES, TEMPLATE_SECTIONS, templateRendererFor } from '@/components/website/templates/registry';
import { getArchetype } from '@/lib/website-builder/archetypes';
import { BLOCK_TYPES } from '@/components/website/blocks/types';

/*
 * The sections that keep their own components on purpose, and are dressed by
 * the stylesheet instead.
 *
 * Four carry real state — availability, a multi-step journey, a payment intent,
 * a submitting form. Services and pricing choose their own arrangement from
 * `theme.layouts` and own the booking handler.
 *
 * Testimonials is here because a shape took it over and should not have:
 * `TestimonialsBlock` defaults to a CAROUSEL, with auto-play, RTL-aware
 * controls and dot indicators, and the static shape that shadowed it turned
 * rotating quotes into a column. Behaviour that is part of a section's design
 * is state, whatever the block is called — which is the rule this list encodes,
 * and the one the shape broke.
 */
const DRESSED_NOT_DRAWN = [
  'booking_widget', 'process_flow', 'payment_button', 'contact_form',
  'services', 'pricing', 'testimonials',
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

/*
 * A section is not "covered" by drawing it — it is covered by still working.
 *
 * The shape that replaced the testimonials carousel satisfied every assertion
 * above: the registry had an entry, coverage was complete, and the section
 * rendered. It had simply stopped rotating. So the list is checked against the
 * thing that actually makes these sections different — that they hold state or
 * own a layout decision — rather than being trusted as a list.
 */
describe('sections that own their behaviour keep their own component', () => {
  it.each(DRESSED_NOT_DRAWN)('%s is not shadowed by a shape', section => {
    TEMPLATES.forEach(id => {
      expect(templateRendererFor(getArchetype(id), section as never)).toBeNull();
    });
  });
});
