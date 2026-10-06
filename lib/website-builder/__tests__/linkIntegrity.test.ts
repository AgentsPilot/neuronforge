/**
 * A generated button cannot point nowhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The cases below are the real shapes, taken from the live pages: a header
 * wordmark at `href="#"`, a hero whose "Explore Services" goes to `#about`, a
 * footer menu of `{ label, anchor }` items, and a landing page whose sections
 * are header/hero/features/pricing/faq/booking_widget/contact_form.
 *
 * A fragment naming no element is silent — the browser does not navigate, does
 * not scroll and reports nothing — so the only way to catch it is to ask, of
 * the page as it will be rendered, whether each destination is on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { repairBlockLinks } from '../linkIntegrity';
import { anchorForBlockType, pageAnchors } from '../sectionAnchors';

type Block = { block_type: string; content?: Record<string, unknown> | null; enabled?: boolean | null };

/** The live homepage of "Avital_AI consulting", section for section. */
const HOMEPAGE: Block[] = [
  { block_type: 'header', content: { cta_button: { link: '#services', text: 'Book Now' } } },
  { block_type: 'hero', content: { cta_link: '#about', cta_text: 'Explore Services' } },
  { block_type: 'services', content: {} },
  { block_type: 'about', content: {} },
  { block_type: 'cta', content: { cta_link: '#services', cta_text: 'Automate Now' } },
  { block_type: 'contact_form', content: {} },
  {
    block_type: 'footer',
    content: {
      cta_link: '#contact',
      menu_items: [
        { label: 'About', anchor: '#about' },
        { label: 'Services', anchor: '#services' },
        { label: 'Contact', anchor: '#contact' },
      ],
    },
  },
];

describe('the anchor table is the one the renderer stamps', () => {
  it('names the sections whose anchor is not their type', () => {
    expect(anchorForBlockType('contact_form')).toBe('contact');
    expect(anchorForBlockType('booking_widget')).toBe('booking');
  });

  it('falls back for a section with no entry, as the renderer always did', () => {
    expect(anchorForBlockType('logo_cloud')).toBe('logo-cloud');
  });

  it('does not count a section the owner switched off', () => {
    const anchors = pageAnchors([
      { block_type: 'services', enabled: true },
      { block_type: 'about', enabled: false },
    ]);
    expect(anchors.has('services')).toBe(true);
    expect(anchors.has('about')).toBe(false);
  });
});

describe('a page whose destinations are all real', () => {
  it('is returned untouched, by identity', () => {
    const { blocks, repairs } = repairBlockLinks(HOMEPAGE);
    expect(repairs).toEqual([]);
    expect(blocks).toBe(HOMEPAGE);
  });
});

describe('a fragment that names nothing', () => {
  it('is repaired, including the bare # the templated wordmark carried', () => {
    const { blocks, repairs } = repairBlockLinks([
      { block_type: 'header', content: { cta_button: { link: '#', text: 'Book Now' } } },
      { block_type: 'hero', content: { cta_link: '#', cta_text: 'Start' } },
      { block_type: 'booking_widget', content: {} },
    ]);

    expect(repairs.map(r => r.field)).toEqual(expect.arrayContaining(['cta_button.link', 'cta_link']));
    // A page with a booking section sends a dead conversion button there.
    expect((blocks[1].content as Record<string, unknown>).cta_link).toBe('#booking');
    expect((blocks[0].content as { cta_button: { link: string; text: string } }).cta_button).toEqual({
      link: '#booking',
      text: 'Book Now',
    });
  });

  it('treats an empty string the same way', () => {
    const { repairs } = repairBlockLinks([
      { block_type: 'cta', content: { cta_link: '   ' } },
      { block_type: 'services', content: {} },
    ]);
    expect(repairs).toHaveLength(1);
  });
});

describe('an anchor for a section this page does not have', () => {
  /*
   * The generator writes `#booking` from the SERVICE — whether it is bookable —
   * while whether a `booking_widget` section exists is decided elsewhere. The
   * two disagree for a course sold without a slot.
   */
  it('is sent to the best section the page does have', () => {
    const { blocks, repairs } = repairBlockLinks([
      { block_type: 'header', content: { cta_button: { link: '#booking', text: 'Book Now' } } },
      { block_type: 'hero', content: { cta_link: '#booking', cta_text: 'Book Now' } },
      { block_type: 'pricing', content: {} },
      { block_type: 'contact_form', content: {} },
    ]);

    expect(repairs).toHaveLength(2);
    // No booking section, so pricing — where someone pressing "book" was going.
    expect((blocks[1].content as Record<string, unknown>).cta_link).toBe('#pricing');
  });

  it('prefers booking, then services, then pricing, then contact', () => {
    const only = (type: string) =>
      repairBlockLinks([
        { block_type: 'hero', content: { cta_link: '#nope' } },
        { block_type: type, content: {} },
      ]).blocks[0].content as Record<string, unknown>;

    expect(only('booking_widget').cta_link).toBe('#booking');
    expect(only('services').cta_link).toBe('#services');
    expect(only('pricing').cta_link).toBe('#pricing');
    expect(only('contact_form').cta_link).toBe('#contact');
  });

  it('counts a disabled section as absent', () => {
    const { blocks } = repairBlockLinks([
      { block_type: 'hero', content: { cta_link: '#services' }, enabled: true },
      { block_type: 'services', content: {}, enabled: false },
      { block_type: 'contact_form', content: {}, enabled: true },
    ]);
    expect((blocks[0].content as Record<string, unknown>).cta_link).toBe('#contact');
  });
});

describe('a page with nowhere to send anybody', () => {
  /*
   * The field is REMOVED rather than left dead: the hero, the CTA and the
   * header all resolve their own control when they have no link, and that
   * resolution opens the booking dialog where the page has one. A dropped dead
   * link is an upgrade.
   */
  it('drops the destination instead of keeping a dead one', () => {
    const { blocks, repairs } = repairBlockLinks([
      { block_type: 'hero', content: { cta_link: '#services', cta_text: 'Book' } },
      { block_type: 'faq', content: {} },
    ]);

    const content = blocks[0].content as Record<string, unknown>;
    expect('cta_link' in content).toBe(false);
    expect(content.cta_text).toBe('Book');          // the words stay
    expect(repairs[0].to).toBeNull();
  });
});

describe('a menu item', () => {
  it('is dropped, not redirected, when its section is gone', () => {
    const { blocks } = repairBlockLinks([
      {
        block_type: 'footer',
        content: {
          menu_items: [
            { label: 'About', anchor: '#about' },
            { label: 'Services', anchor: '#services' },
          ],
        },
      },
      { block_type: 'about', content: {} },
    ]);

    // Renaming "Services" to point at About would misdescribe what it links to.
    expect((blocks[0].content as { menu_items: unknown[] }).menu_items).toEqual([
      { label: 'About', anchor: '#about' },
    ]);
  });

  it('leaves an item that states no destination alone', () => {
    const items = [{ label: 'Follow us' }, { label: 'About', anchor: '#about' }];
    const { blocks } = repairBlockLinks([
      { block_type: 'footer', content: { menu_items: items } },
      { block_type: 'about', content: {} },
    ]);
    expect((blocks[0].content as { menu_items: unknown[] }).menu_items).toHaveLength(2);
  });
});

describe('a destination this module has no standing to judge', () => {
  it('leaves paths and absolute URLs exactly as they are', () => {
    const { blocks, repairs } = repairBlockLinks([
      {
        block_type: 'footer',
        content: {
          cta_link: '/site/acme/book',
          menu_items: [{ label: 'Instagram', link: 'https://instagram.com/acme' }],
        },
      },
      { block_type: 'services', content: {} },
    ]);

    expect(repairs).toEqual([]);
    expect(blocks[0].content).toEqual({
      cta_link: '/site/acme/book',
      menu_items: [{ label: 'Instagram', link: 'https://instagram.com/acme' }],
    });
  });
});
