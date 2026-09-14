/**
 * The reordering pass, tested against the cases that made it necessary.
 *
 * The ordering is pure, so it lives beside the recipes rather than inside the
 * 1,300-line generation service — which also means it can be tested without
 * dragging that service's ESM dependencies through jest.
 */

import { recipeFor, orderByRecipe } from '../recipes';
import { STONE, LUMEN } from '../archetypes';

const block = (block_type: string, extra: Record<string, unknown> = {}) => ({
  page_id: 'p1',
  block_type,
  position: 99,
  content: {},
  ...extra,
});

describe('orderByRecipe', () => {
  const run = orderByRecipe;

  it('puts a photographer’s gallery third and renumbers from zero', () => {
    const built = [
      block('header'), block('hero'), block('about'),
      block('services'), block('gallery'), block('footer'),
    ];

    const out = run(built, recipeFor('photographer'), LUMEN.layouts);

    expect(out.map((b: any) => b.block_type)).toEqual([
      'header', 'hero', 'gallery', 'services', 'about', 'footer',
    ]);
    expect(out.map((b: any) => b.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('puts services before about for a consultant, and after it for a therapist', () => {
    const built = [block('header'), block('about'), block('services'), block('footer')];

    const consultant = run(built, recipeFor('consultant'), STONE.layouts)
      .map((b: any) => b.block_type);
    expect(consultant.indexOf('services')).toBeLessThan(consultant.indexOf('about'));

    const therapist = run(built, recipeFor('therapist'), STONE.layouts)
      .map((b: any) => b.block_type);
    expect(therapist.indexOf('about')).toBeLessThan(therapist.indexOf('services'));
  });

  it('writes the archetype’s layout onto the five blocks that switch on one', () => {
    const built = [block('hero'), block('services'), block('cta'), block('gallery'), block('pricing')];
    const out = run(built, recipeFor('photographer'), LUMEN.layouts);
    const byType = Object.fromEntries(out.map((b: any) => [b.block_type, b.styles?.layout]));

    expect(byType.hero).toBe(LUMEN.layouts!.hero);
    expect(byType.services).toBe(LUMEN.layouts!.services);
    expect(byType.cta).toBe(LUMEN.layouts!.cta);
    expect(byType.gallery).toBe(LUMEN.layouts!.gallery);
    expect(byType.pricing).toBe(LUMEN.layouts!.pricing);
  });

  it('leaves the other sixteen block types without a layout', () => {
    // They change appearance through the tokens alone; a layout name they do
    // not implement would be a value nothing reads.
    const out = run([block('about'), block('faq'), block('stats')], recipeFor('coach'), STONE.layouts);
    out.forEach((b: any) => expect(b.styles?.layout).toBeUndefined());
  });

  it('keeps whatever styles the builder already set', () => {
    const built = [block('hero', { styles: { padding: 'py-24', alignment: 'left' } })];
    const [hero] = run(built, recipeFor('coach'), STONE.layouts);

    expect(hero.styles.padding).toBe('py-24');
    expect(hero.styles.alignment).toBe('left');
    expect(hero.styles.layout).toBe(STONE.layouts!.hero);
  });

  it('never drops a block the recipe does not name', () => {
    // The builder only ever produces a block because the data asked for one.
    // Binning it would be a section the business filled in and never saw again.
    const built = [block('header'), block('video'), block('team'), block('footer')];
    const out = run(built, recipeFor('lawyer'), STONE.layouts);

    expect(out).toHaveLength(4);
    expect(out.map((b: any) => b.block_type)).toEqual(
      expect.arrayContaining(['video', 'team'])
    );
  });

  it('is untroubled by a recipe naming sections this business does not have', () => {
    const out = run([block('header'), block('hero'), block('footer')], recipeFor('trainer'), STONE.layouts);
    expect(out.map((b: any) => b.block_type)).toEqual(['header', 'hero', 'footer']);
  });

  it('writes no layout at all when the theme carries none', () => {
    // Every theme stored before archetypes existed. Its blocks render in their
    // own defaults, exactly as they did.
    const out = run([block('hero')], recipeFor('coach'), undefined);
    expect(out[0].styles.layout).toBeUndefined();
  });
});

/*
 * The ordering bug that hid hand-added sections.
 *
 * Every recipe ends with the footer, and unnamed block types were appended
 * after the ordered list — so a Team or Video section an owner added from the
 * editor landed BELOW the copyright line. No recipe names those types, which
 * makes the sections most likely to be hand-added exactly the ones that ended
 * up in the one place nobody scrolls to.
 */
describe('sections the recipe does not name', () => {
  it('sit above the footer, not after it', () => {
    const blocks = [
      { block_type: 'header', position: 0 },
      { block_type: 'hero', position: 1 },
      { block_type: 'footer', position: 2 },
      { block_type: 'team', position: 3 },
      { block_type: 'video', position: 4 },
    ];

    const ordered = orderByRecipe(blocks, ['header', 'hero', 'cta', 'footer'] as never);
    const types = ordered.map(block => block.block_type);

    expect(types[types.length - 1]).toBe('footer');
    expect(types.indexOf('team')).toBeLessThan(types.indexOf('footer'));
    expect(types.indexOf('video')).toBeLessThan(types.indexOf('footer'));
  });

  it('still appends when the page has no footer at all', () => {
    const blocks = [
      { block_type: 'hero', position: 0 },
      { block_type: 'team', position: 1 },
    ];
    const types = orderByRecipe(blocks, ['hero'] as never).map(b => b.block_type);
    expect(types).toEqual(['hero', 'team']);
  });
});
