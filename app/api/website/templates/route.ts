/**
 * The looks a business can choose from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS USED TO RETURN, AND WHY IT CHANGED
 *
 * Thirty-three templates, filtered by vertical, ordered by a recommender, and
 * sliced to four by the wizard. Each one nominated three hex values and a font
 * name — and the font never rendered, because every public surface hardcoded
 * Heebo at the front of the stack. So a photographer and a lawyer picked from
 * different galleries and got the same site in a different accent colour.
 *
 * It now returns the four archetypes: complete designs — palette, type stack,
 * type scale, radii, spacing register and layout arrangement — that the block
 * components actually switch on. Four real choices rather than thirty-three
 * near-identical ones.
 *
 * The response keeps its old shape on purpose. `templates`, `theme.colors`,
 * `theme.primary_color` and an empty `blocks` array are all still there, so the
 * website page and the setup wizard keep compiling and rendering while they are
 * moved over. What changed is what is IN the list.
 *
 * The vertical still matters — it picks which card is pre-selected — but it no
 * longer filters, because all four suit any trade and an owner who wants the
 * dark one should be able to have it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { archetypeRepository } from '@/lib/repositories/ArchetypeRepository';
import { recommendArchetypeId } from '@/lib/website-builder/recipes';
import { getArchetypeLabel, type TemplateLabelLanguage } from '@/lib/website-builder/templateLabels';
import type { PageTheme } from '@/lib/website-builder/pageTheme';

const logger = createLogger({ module: 'WebsiteTemplatesAPI' });

/**
 * An archetype, in the shape the gallery already reads.
 *
 * `theme` carries both spellings — the flat `primary_color` the wizard's swatch
 * reads and the nested `colors` the preview reads — because both consumers
 * exist today and neither needed changing for this to land.
 */
function toGalleryEntry(archetype: PageTheme, language: TemplateLabelLanguage) {
  // `PageTheme.id` is optional, because a theme stored before archetypes
  // existed has none. Everything this function receives comes from the
  // repository and does carry one, but the gallery needs a stable key either
  // way and a card with no id could not be selected.
  const id = archetype.id ?? 'stone';
  const label = getArchetypeLabel(id, language);

  return {
    id,
    name: label.name,
    description: label.blurb,
    // Not a vertical any more: every look is offered to every trade.
    vertical: '',
    source: archetype.source,
    theme: {
      primary_color: archetype.colors.primary,
      secondary_color: archetype.colors.secondary,
      accent_color: archetype.colors.accent,
      font_family: archetype.fonts.heading,
      colors: archetype.colors,
      fonts: archetype.fonts,
    },
    // The full design, for a gallery card that wants to draw a real preview
    // rather than two diagonal swatches.
    scale: archetype.scale,
    borderRadius: archetype.borderRadius,
    spacing: archetype.spacing,
    layouts: archetype.layouts,
    // The recipe decides which sections a page has, from the data. An archetype
    // has no opinion, and this stays empty so the older consumers do not break.
    blocks: [],
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const vertical = searchParams.get('vertical');
    const language = (searchParams.get('lang') || 'en') as TemplateLabelLanguage;

    // Never empty and never throws: the four in code stand in whenever the
    // table is unmigrated or unreachable, because a gallery with nothing in it
    // is a step of the wizard with no way forward.
    const archetypes = await archetypeRepository.listActive();

    /*
     * Which card opens pre-selected.
     *
     * A recommendation, not a filter. The old route narrowed the gallery to a
     * vertical and then warned when it could not, which meant an unrecognised
     * trade was shown thirty-three templates ordered therapist-first. All four
     * are always offered; the vertical only decides which one is ticked.
     */
    const recommendedTemplateId = recommendArchetypeId(vertical);

    const templates = archetypes
      .slice()
      .sort((a, b) =>
        a.id === recommendedTemplateId ? -1 : b.id === recommendedTemplateId ? 1 : 0
      )
      .map(archetype => toGalleryEntry(archetype, language));

    requestLogger.info(
      { vertical, recommendedTemplateId, count: templates.length },
      'Archetypes listed'
    );

    return NextResponse.json({
      success: true,
      templates,
      // Kept so the older consumers keep compiling. Nothing filters by vertical
      // any more, so there is nothing to populate it with.
      verticals: [],
      recommendedTemplateId,
      total: templates.length,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to list archetypes');
    return NextResponse.json(
      { success: false, error: 'Failed to list designs' },
      { status: 500 }
    );
  }
}
