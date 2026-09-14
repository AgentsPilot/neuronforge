/**
 * The archetypes and recipes, as a table of expectations.
 *
 * Two of these exist to catch the specific mistake that makes the whole scheme
 * fall apart: a `layouts` value that names a variant no block implements, and a
 * recipe naming a block type that does not exist. Both compile fine and both
 * render a page with a section silently missing.
 */

import {
  ARCHETYPES,
  DEFAULT_ARCHETYPE,
  STONE,
  BLOOM,
  LUMEN,
  ASTER,
  WARM,
  BOLD,
  getArchetype,
  isArchetypeId,
} from '../archetypes';
import { RECIPES, DEFAULT_RECIPE, recipeIdFor, recipeFor } from '../recipes';
import { BLOCK_TYPES } from '@/components/website/blocks/types';

// Read from the vocabulary rather than restated here. A hand-copied list in a
// test passes happily while the real union says something else, which is the
// exact failure this test exists to catch.
import {
  COMPOSITIONS,
  HERO_LAYOUTS as HERO,
  SERVICES_LAYOUTS as SERVICES,
  CTA_LAYOUTS as CTA,
  GALLERY_LAYOUTS as GALLERY,
  PRICING_LAYOUTS as PRICING,
} from '../pageTheme';

describe('the archetypes', () => {
  it('are six, in gallery order, and each has an id', () => {
    expect(ARCHETYPES).toHaveLength(6);
    expect(ARCHETYPES.map(a => a.id)).toEqual(['stone', 'warm', 'bloom', 'bold', 'lumen', 'aster']);
  });

  /*
   * Four were taken from MIT templates and owe that notice. Warm and Bold were
   * drawn for this platform and owe nobody — asserting MIT on those would be
   * asserting a licence claim that is not true, so the obligation is checked
   * against the four that actually carry it.
   */
  it('credit their MIT source, which is the whole licence obligation', () => {
    [STONE, BLOOM, LUMEN, ASTER].forEach(archetype => {
      expect(archetype.source).toMatch(/MIT/);
    });
  });

  it('do not claim a licence they were never given', () => {
    [WARM, BOLD].forEach(archetype => {
      expect(archetype.source).not.toMatch(/MIT/);
      expect(archetype.source).toBeTruthy();
    });
  });

  /*
   * The point of the whole exercise: an archetype that names no composition is
   * a recolour, which is what every archetype was before compositions existed.
   */
  it('each name a composition the stylesheets implement', () => {
    ARCHETYPES.forEach(({ id, composition }) => {
      expect(composition).toBeTruthy();
      expect(COMPOSITIONS).toContain(composition!);
      expect(id).toBeTruthy();
    });
  });

  it('share three compositions between six looks', () => {
    expect(new Set(ARCHETYPES.map(a => a.composition)).size).toBe(3);
  });

  it('name only layouts the vocabulary contains', () => {
    ARCHETYPES.forEach(({ id, layouts }) => {
      expect(HERO).toContain(layouts!.hero);
      expect(SERVICES).toContain(layouts!.services);
      expect(CTA).toContain(layouts!.cta);
      expect(GALLERY).toContain(layouts!.gallery);
      expect(PRICING).toContain(layouts!.pricing);
      expect(id).toBeTruthy();
    });
  });

  it('carry a Hebrew face wherever the Latin one has no Hebrew glyphs', () => {
    // Montserrat and Josefin Sans carry none at all; without a substitute a
    // Hebrew paragraph renders in two faces.
    expect(LUMEN.fonts.hebrewHeading).toBe('Rubik');
    expect(BLOOM.fonts.hebrewHeading).toBe('Varela Round');
  });

  /*
   * Not one-per-archetype any more: six looks share three sets of bones, so two
   * can legitimately agree on a radius. What must hold is that no two are the
   * same DESIGN — same composition AND same ground AND same radius would be two
   * cards in the gallery a owner cannot tell apart.
   */
  it('differ in the ways that actually read as different designs', () => {
    const fingerprints = ARCHETYPES.map(
      a => `${a.composition}|${a.colors.background}|${a.borderRadius}`
    );
    expect(new Set(fingerprints).size).toBe(ARCHETYPES.length);

    // Both grounds are represented: a gallery of six pale cards is not a choice.
    const darks = ARCHETYPES.filter(a => /^#(0|1|2)/.test(a.colors.background));
    expect(darks.length).toBeGreaterThanOrEqual(2);
    expect(darks.length).toBeLessThan(ARCHETYPES.length);
  });

  it('defaults to the one with no accent colour', () => {
    expect(DEFAULT_ARCHETYPE).toBe(STONE);
    // Stone's whole palette is the stone scale — nothing in it is a hue.
    expect(STONE.colors.primary).toBe(STONE.colors.text);
  });

  it('resolves by id, and says so when it cannot', () => {
    expect(getArchetype('aster')).toBe(ASTER);
    expect(getArchetype('nonexistent')).toBeNull();
    expect(getArchetype(null)).toBeNull();
    expect(isArchetypeId('bloom')).toBe(true);
    expect(isArchetypeId('bloomm')).toBe(false);
  });
});

describe('the recipes', () => {
  it('contain only block types the renderer knows', () => {
    const known = new Set<string>(BLOCK_TYPES);
    Object.entries(RECIPES).forEach(([id, blocks]) => {
      blocks.forEach(block => {
        expect(known.has(block)).toBe(true);
        if (!known.has(block)) throw new Error(`${id} names an unknown block: ${block}`);
      });
    });
  });

  it('open with a header and close with a footer', () => {
    Object.values(RECIPES).forEach(blocks => {
      expect(blocks[0]).toBe('header');
      expect(blocks[blocks.length - 1]).toBe('footer');
    });
  });

  it('never repeat a block', () => {
    Object.values(RECIPES).forEach(blocks => {
      expect(new Set(blocks).size).toBe(blocks.length);
    });
  });

  it('puts the gallery third for a photographer, as all four of its templates did', () => {
    const blocks = recipeFor('photographer');
    expect(blocks[2]).toBe('gallery');
  });

  it('never gives a lawyer a gallery — none of their templates had one', () => {
    expect(recipeFor('lawyer')).not.toContain('gallery');
    expect(recipeFor('consultant')).not.toContain('gallery');
  });

  it('puts services before about for a consultant, and after it for a therapist', () => {
    const consultant = recipeFor('consultant');
    expect(consultant.indexOf('services')).toBeLessThan(consultant.indexOf('about'));

    const therapist = recipeFor('therapist');
    expect(therapist.indexOf('about')).toBeLessThan(therapist.indexOf('services'));
  });

  it('gives a trainer a price list', () => {
    expect(recipeFor('trainer')).toContain('pricing');
  });

  it('lets the page type win outright', () => {
    // A landing page for a therapist is still a landing page: one offer, no
    // biography, nothing between the reader and the price.
    expect(recipeIdFor('therapist', 'landing')).toBe('landing');
    expect(recipeFor('photographer', 'landing')).not.toContain('gallery');
    expect(RECIPES.landing).not.toContain('about');
    expect(RECIPES.landing).not.toContain('process');
  });

  it('falls back to the forgiving order for a trade it does not know', () => {
    expect(recipeIdFor('blacksmith')).toBe(DEFAULT_RECIPE);
    expect(recipeIdFor(null)).toBe(DEFAULT_RECIPE);
    expect(recipeIdFor(undefined)).toBe(DEFAULT_RECIPE);
  });
});
