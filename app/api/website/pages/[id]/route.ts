/**
 * Website Page API
 * GET - Get page by ID
 * PUT - Update page
 * DELETE - Delete page
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { claimBusinessSubdomain } from '@/lib/business-os/businessSubdomain';
import { validatePrefix, normalizePrefix } from '@/lib/business-os/reservedPrefixes';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { completeTheme } from '@/lib/branding/theme';
import { WebsitePageRepository, WebsitePageUpdate } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteContentRepository } from '@/lib/repositories/WebsiteContentRepository';
import { z } from 'zod';
import { bustSiteCache } from '@/lib/website-builder/siteCache';
import {
  HERO_LAYOUTS,
  SERVICES_LAYOUTS,
  CTA_LAYOUTS,
  GALLERY_LAYOUTS,
  PRICING_LAYOUTS,
  COMPOSITIONS,
} from '@/lib/website-builder/pageTheme';

const logger = createLogger({ module: 'WebsitePageAPI' });

const UpdatePageSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  page_type: z.enum(['homepage', 'landing', 'about', 'services', 'blog_post']).optional(),
  slug: z.string().min(1).max(100).optional(),
  meta_description: z.string().max(160).nullable().optional(),
  seo_keywords: z.array(z.string()).optional(),
  /*
   * The business's web address, validated HERE rather than only by the
   * availability checker.
   *
   * This was `z.string().min(3).max(30)` and nothing else, so the checker was
   * advisory: `PATCH {subdomain:"app"}` succeeded and would have shadowed the
   * platform's own hostname once `{prefix}.agentspilot.ai` went live. It also
   * accepted `"My Site"`, uppercase and `"a.b"` — and a dot turns one DNS label
   * into two, which defeats the prefix extraction in middleware.
   *
   * `validatePrefix` is the same function the checker and middleware use, so
   * what is offered, what is accepted and what is served can no longer diverge.
   */
  subdomain: z
    .string()
    .nullable()
    .optional()
    .refine((value) => value === null || value === undefined || validatePrefix(value).ok, {
      message:
        'Use 3-30 lowercase letters, numbers and hyphens, starting and ending with a letter or number. Some names are reserved.',
    }),

  /*
   * `custom_domain` is deliberately NOT accepted any more.
   *
   * Businesses do not bring their own address: every public page is served at
   * `{prefix}.agentspilot.ai`. The column stays in the database (it is null on
   * every row, so nothing is lost and nothing needs migrating) but nothing may
   * set it — an unsettable field that URL building still branched on is exactly
   * how five different domains came to coexist unnoticed.
   */
  website_language: z.enum(['en', 'es', 'he']).optional(),
  /*
   * The whole design, not only its palette.
   *
   * Zod strips what a schema does not declare, so the four fields an archetype
   * adds — its id, its type scale, its layout arrangement and the Hebrew faces
   * substituted where the Latin one carries no Hebrew glyphs — would be dropped
   * on every save from the editor. The page would keep its colours and quietly
   * lose its typography and its layout, which is the hardest kind of bug to
   * notice: nothing errors, the page just drifts back towards the default.
   */
  theme: z.object({
    id: z.string().optional(),
    source: z.string().optional(),
    /*
     * Validated against the same runtime array the stylesheets are keyed on, for
     * the reason the layout enums below give: a `z.string()` here would accept a
     * composition no stylesheet implements and store it, and the page would then
     * render in the fallback bones with nothing anywhere saying why.
     */
    composition: z.enum(COMPOSITIONS).optional(),
    /*
     * Every colour optional, individually.
     *
     * `completeTheme` merges key by key precisely so a partial theme works: its
     * own note says a theme carrying only `colors.primary` must still yield a
     * full seven-colour palette. Requiring all seven here contradicted that and
     * forced every caller to send values it does not edit — which is how the
     * design tab came to carry a pre-archetype `#FFFFFF` and `0.5rem` through a
     * form that changes neither.
     */
    colors: z.object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      background: z.string().optional(),
      surface: z.string().optional(),
      text: z.string().optional(),
      textSecondary: z.string().optional()
    }).optional(),
    fonts: z.object({
      heading: z.string().optional(),
      body: z.string().optional(),
      hebrewHeading: z.string().optional(),
      hebrewBody: z.string().optional()
    }).optional(),
    scale: z.object({
      h1: z.string(),
      h2: z.string(),
      h3: z.string(),
      body: z.string(),
      small: z.string()
    }).optional(),
    // Validated against the same arrays the block components' types come from,
    // so a name no block implements is refused at the door rather than stored
    // and silently ignored at render time.
    layouts: z.object({
      hero: z.enum(HERO_LAYOUTS),
      services: z.enum(SERVICES_LAYOUTS),
      cta: z.enum(CTA_LAYOUTS),
      gallery: z.enum(GALLERY_LAYOUTS),
      pricing: z.enum(PRICING_LAYOUTS)
    }).optional(),
    borderRadius: z.string().optional(),
    spacing: z.enum(['compact', 'normal', 'spacious']).optional()
  }).nullable().optional(),
  favicon_url: z.string().nullable().optional(),
  og_image_url: z.string().nullable().optional()
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const pageRepo = new WebsitePageRepository(supabaseServer);
    const blockRepo = new WebsiteBlockRepository(supabaseServer);

    const pageResult = await pageRepo.findById(id, user.id);
    if (pageResult.error || !pageResult.data) {
      return NextResponse.json({ success: false, error: 'Page not found' }, { status: 404 });
    }

    const blocksResult = await blockRepo.findByPageId(id);

    return NextResponse.json({
      success: true,
      page: pageResult.data,
      blocks: blocksResult.data || []
    });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to get page');
    return NextResponse.json(
      { success: false, error: 'Failed to get page' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = UpdatePageSchema.parse(body);

    const pageRepo = new WebsitePageRepository(supabaseServer);

    const updates: WebsitePageUpdate = {};
    if (validated.title !== undefined) updates.title = validated.title;
    if (validated.page_type !== undefined) updates.page_type = validated.page_type;
    if (validated.slug !== undefined) updates.slug = validated.slug;
    if (validated.meta_description !== undefined) updates.meta_description = validated.meta_description;
    if (validated.seo_keywords !== undefined) updates.seo_keywords = validated.seo_keywords;
    /*
     * Stored lowercased, because a hostname is case-insensitive but a database
     * comparison is not: `JoesGym` and `joesgym` are the same address to a
     * browser and two different rows to us.
     */
    if (validated.subdomain !== undefined) {
      updates.subdomain = validated.subdomain === null ? null : normalizePrefix(validated.subdomain);
    }
    // `custom_domain` is no longer writable — see the schema above.
    /*
     * A theme is stored whole, never in pieces.
     *
     * The editor sends only what changed — often a single colour — and this
     * wrote that fragment straight into the column, so a page that had a
     * complete design ended up with one field and nothing else. Every surface
     * then fell back to platform defaults for the rest, which reads as the
     * design silently reverting.
     *
     * `completeTheme` fills the gaps key by key, in the order that respects
     * what the business actually chose: the fragment first, then the design its
     * `template_id` names, then the platform defaults. Passing null through
     * unchanged, because clearing a theme is a real instruction.
     */
    if (validated.theme !== undefined) {
      if (validated.theme === null) {
        updates.theme = null;
      } else {
        const existing = await pageRepo.findById(id, user.id);
        updates.theme = completeTheme(
          { ...(existing.data?.theme ?? {}), ...validated.theme },
          existing.data?.template_id
        );
      }
    }
    if (validated.favicon_url !== undefined) updates.favicon_url = validated.favicon_url;
    if (validated.og_image_url !== undefined) updates.og_image_url = validated.og_image_url;
    if (validated.website_language !== undefined) updates.website_language = validated.website_language;

    const result = await pageRepo.update(id, user.id, updates);

    if (result.error || !result.data) {
      throw result.error || new Error('Failed to update page');
    }

    requestLogger.info({ pageId: id, userId: user.id }, 'Updated website page');

    /*
     * Setting a page's address settles the business's, if it had none.
     *
     * This is the path the website's Settings screen saves through, and the one
     * the landing page's publish step uses to write an address before going
     * live. Either way the business now has an address, and everything created
     * afterwards should inherit it rather than mint another.
     */
    if (validated.subdomain) {
      await claimBusinessSubdomain(user.id, validated.subdomain);
    }

    // The visitor-facing page just changed: title, theme, slug or subdomain.
    bustSiteCache(result.data?.subdomain);

    return NextResponse.json({ success: true, page: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, id }, 'Failed to update page');
    return NextResponse.json(
      { success: false, error: 'Failed to update page' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check for mode parameter: 'archive' (deactivate) or 'permanent' (hard delete)
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'archive';
    /*
     * Also throw away the copy this business wrote.
     *
     * `website_content` is per-USER, not per-page, so deleting a page never
     * touches it — right for a rebuild or a template swap, where the point of
     * that table is to outlive the structure. Wrong for "delete my website",
     * where leaving the words behind means the next site silently comes back
     * wearing them.
     *
     * Explicit rather than inferred from the page type: a caller deleting one
     * landing page must not wipe the words on the homepage, and a flag says so
     * where a heuristic would only imply it.
     */
    const purgeContent = searchParams.get('purge_content') === 'true';

    const pageRepo = new WebsitePageRepository(supabaseServer);

    /*
     * Read the subdomain BEFORE the row goes.
     *
     * The cache is keyed on it, and after a hard delete there is nothing left
     * to read it from — the cached page would then be served from a site that
     * no longer exists until the TTL ran out.
     */
    const doomed = await pageRepo.findById(id, user.id);
    const subdomain = doomed.data?.subdomain ?? null;

    if (mode === 'permanent') {
      // Hard delete - for pages with no activity
      const result = await pageRepo.delete(id, user.id);

      if (result.error) {
        throw result.error;
      }

      requestLogger.info({ pageId: id, userId: user.id, mode: 'permanent' }, 'Permanently deleted website page');
    } else {
      // Archive/deactivate - for pages with activity
      const result = await pageRepo.archive(id, user.id);

      if (result.error) {
        throw result.error;
      }

      requestLogger.info({ pageId: id, userId: user.id, mode: 'archive' }, 'Archived website page');
    }

    if (purgeContent) {
      // After the page, so a failure here cannot leave a live site whose copy
      // has been deleted out from under it.
      const contentRepo = new WebsiteContentRepository(supabaseServer);
      const purge = await contentRepo.deleteForUser(user.id);
      if (purge.error) {
        // The page is already gone; say the content survived rather than
        // reporting a clean delete that was not one.
        requestLogger.error({ err: purge.error, userId: user.id }, 'Page deleted but content purge failed');

        // The page is gone even though the copy survived, so this early return
        // still has to stop the cached page being served.
        bustSiteCache(subdomain);

        return NextResponse.json(
          { success: true, mode, contentPurged: false, warning: 'Website deleted, but your saved text could not be removed' }
        );
      }
      requestLogger.info({ userId: user.id, pageId: id }, 'Purged website content');
    }

    // Deleted or archived, the public page must stop being served either way.
    bustSiteCache(subdomain);

    return NextResponse.json({ success: true, mode, contentPurged: purgeContent });
  } catch (error) {
    requestLogger.error({ err: error, id }, 'Failed to delete page');
    return NextResponse.json(
      { success: false, error: 'Failed to delete page' },
      { status: 500 }
    );
  }
}
