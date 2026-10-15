/**
 * Website Generation Service
 * LLM-powered service that generates complete website content based on business profile
 *
 * Generates the WORDS:
 * - Hero section (headline, subheadline)
 * - About section
 * - Service descriptions
 * - Process flow steps
 * - SEO metadata
 *
 * And nothing else. Colour, type, scale, radii and layout come from the
 * archetype (`lib/website-builder/archetypes`); which sections appear and in
 * what order comes from the recipe (`lib/website-builder/recipes`). This asked
 * the model for three hex values and a font name until it stopped.
 */

import { createLogger } from '@/lib/logger';
import { adoptBusinessTemplate, adoptBusinessTheme } from '@/lib/business-os/businessTemplate';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { getWebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { getWebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';
import { themeForTemplateId } from '@/lib/website-builder/templates';
import { DEFAULT_ARCHETYPE } from '@/lib/website-builder/archetypes';
import { recipeFor, orderByRecipe, recommendArchetypeId } from '@/lib/website-builder/recipes';
import { repairBlockLinks } from '@/lib/website-builder/linkIntegrity';
import { ctaFor, type CtaIntent } from '@/lib/website-builder/ctaIntent';
import { imageForSection, imagesForSection } from '@/lib/services/StockImageService';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import { buildBosCallContext, type BosLlmOwner } from '@/lib/business-os/llm/callCatalog';
import { withModelFallback } from '@/lib/business-os/llm/modelFallback';
import { resolveBosLlmSettings } from '@/lib/business-os/llm/modelSettings';
import { AI_UNAVAILABLE_WEBSITE_WRITING } from '@/lib/business-os/llm/aiUnavailableMessages';
import { supabaseServer } from '@/lib/supabaseServer';
import { WebsiteContentRepository } from '@/lib/repositories/WebsiteContentRepository';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';

import type { BusinessBrief } from '@/lib/business-os/onboarding/businessBrief';

const logger = createLogger({ service: 'WebsiteGenerationService' });

/**
 * What the model must actually return before `buildBlocks` may touch it.
 *
 * `buildBlocks` dereferences `content.hero.headline` and
 * `content.about.paragraphs.join(...)`. A response missing either threw a
 * TypeError from inside `buildBlocks`, which the OUTER catch swallowed — so a
 * malformed answer failed the entire generation and never reached
 * `getFallbackContent`, the very thing written to handle it.
 *
 * Only the fields that get dereferenced are required. Everything else is
 * defaulted or optional, because a thin answer is worth keeping and a missing
 * headline is not.
 */
const WebsiteContentSchema = z.object({
  title: z.string().min(1),
  metaDescription: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  hero: z.object({
    headline: z.string().min(1),
    subheadline: z.string().default(''),
  }),
  about: z.object({
    paragraphs: z.array(z.string()).min(1),
  }),
  serviceDescriptions: z.record(z.unknown()).default({}),
  processSteps: z.array(z.unknown()).default([]),
  testimonials: z.array(z.unknown()).default([]),
  faq: z.array(z.unknown()).default([]),
}).passthrough();

/** Where a generation's copy came from, so callers can stop guessing. */
export type ContentSource = 'llm' | 'fallback';

interface GeneratedContent {
  content: WebsiteContent;
  source: ContentSource;
  /** Why the fallback was used, when it was. */
  reason?: string;
  /**
   * The website area is switched off (Layer 2 FR-14). Distinct from any other
   * fallback: the caller decides between starter copy and refusing, which is
   * what `onAiDisabled` selects.
   */
  disabled?: true;
}

interface WebsiteContent {
  title: string;
  metaDescription: string;
  keywords: string[];
  hero: {
    headline: string;
    subheadline: string;
  };
  about: {
    paragraphs: string[];
  };
  serviceDescriptions: Record<string, string | { description: string; icon?: string }>;
  /**
   * Copy for the three blocks that used to be filled from a phrasebook.
   *
   * The booking, contact and call-to-action blocks were built from static
   * translations — "Book Your Session" on a site selling only downloads — and
   * the CTA repeated the hero headline word for word. Optional so an older
   * generation still renders; the phrasebook remains the fallback.
   */
  booking?: { title?: string; description?: string };
  contact?: { title?: string; description?: string };
  /**
   * `buttonText` is @deprecated — the closing CTA now draws its label from
   * `buttons`, by intent, so the words and the destination come from one
   * decision. Left on the type because older stored content still carries it.
   */
  cta?: { title?: string; description?: string; buttonText?: string };
  /**
   * The heading above each section.
   *
   * These were the last strings a phrasebook still wrote. They were in the
   * right language — but every business on the platform got the same five
   * headings, so a site whose every paragraph was written for this business
   * announced them under "Services" and "How It Works". Optional, with the
   * phrasebook behind them, so an older generation still renders.
   */
  sectionTitles?: {
    about?: string;
    services?: string;
    process?: string;
    testimonials?: string;
    faq?: string;
  };
  /**
   * What the two buttons above the fold say.
   *
   * The label on a button is the shortest and most-read copy on the page, and
   * it was the least considered: "Book a Session" on a site selling a course,
   * "Book Now" in a header for a business that invoices.
   */
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * NAMED BY INTENT, NOT BY POSITION, AND THAT IS THE POINT.
   *
   * These used to be `heroCta` and `headerCta` — the model naming a button by
   * where it sits, while the code decided where it goes. Nothing made the two
   * agree, and a model asked for "the main button under the headline" has no
   * way to know that button scrolls to the About section. It wrote "Get in
   * Touch"; the code sent it to the services.
   *
   * Asked for by intent instead, the model writes the words for a destination
   * the code has already chosen, and `ctaFor` returns the pair. Which button
   * carries which intent stops being something either side has to guess.
   * ─────────────────────────────────────────────────────────────────────────
   */
  buttons?: {
    /** For a button that sends a visitor to the services, to book. */
    bookCta?: string;
    /** For a button that sends a visitor to the contact form. */
    contactCta?: string;
    /** For a button that carries on into the page, to read about the business. */
    learnMoreCta?: string;
    /**
     * Written by generations before the intent fields existed.
     *
     * @deprecated Nothing reads these. Stored content from an older run still
     * carries them and they are harmless: a missing intent label falls through
     * to the phrasebook, which is the label those sites already show.
     */
    heroCta?: string;
    /** @deprecated See `heroCta`. The header stopped reading it before that. */
    headerCta?: string;
  };
  processSteps: Array<{
    title: string;
    description: string;
    icon: string;
  }>;
  testimonials: Array<{
    quote: string;
    author: string;
    role: string;
  }>;
  faq: Array<{
    question: string;
    answer: string;
  }>;
  /**
   * Removed: the model no longer picks colours.
   *
   * It was asked to *"choose theme colors appropriate for the vertical"* and to
   * return three hex values and a font name — which is asking a language model
   * to do design, with no system to do it inside. The result varied per
   * generation, so there was no consistency, and it had no palette behind it,
   * so there was no quality either. That is precisely why every vertical looked
   * the same AND none of them looked good.
   *
   * Colour, type, scale, radii and layout now come from the archetype. The
   * model writes words.
   */
}

export class WebsiteGenerationService {
  /**
   * Generate complete website for a user based on their business profile.
   *
   * Two callers, and they arrive differently. The onboarding build has nothing
   * yet and lets this create everything. The setup wizard has already created
   * a page and already has a template the owner picked from a gallery — so it
   * passes both, and generation fills that page rather than creating a second
   * one and overruling the choice with the model's colours.
   */
  async generateWebsite(userId: string, options: {
    /**
     * Usage grouping id of the owner action this generation belongs to,
     * minted by the entry point. Required so usage is never recorded without one.
     */
    groupId: string;
    /** Fill this page instead of creating one. Its blocks are replaced. */
    pageId?: string;
    /** The owner's chosen template. Its theme wins over the model's. */
    templateId?: string;
    /**
     * What this page is FOR, when it is not the whole business.
     *
     * A homepage is about the business, and the profile describes that. A
     * landing page is about one thing being promoted — a course, a package, a
     * season — and generating it from the profile alone produces a second
     * homepage under a different slug.
     *
     * Passed straight into the prompt alongside the profile, so the copy is
     * written for the offer while the voice, the trade and the audience still
     * come from the business.
     */
    focus?: { title: string; description?: string };
    /**
     * What to do when the website area's AI is switched off (Layer 2 FR-14,
     * RC-W3). ONE check point: it is decided inside `callLLM`, where the
     * settings are resolved, so there is no pre-check that could race a cache
     * refill between the check and the call.
     *
     *   'fallback' — finish the build with the static starter copy, exactly as
     *                an LLM failure already does. The onboarding build, where
     *                a site with plain words beats no site at all.
     *   'fail'     — write nothing and report `ai_unavailable`, for the
     *                surfaces that can tell the owner and let them retry:
     *                generate-from-profile and the chat mutate path, both
     *                wired in Step 3 with the owner-facing message.
     *
     * Since Step 3 `full_site` is switchable, so both branches are live.
     */
    onAiDisabled?: 'fallback' | 'fail';
  }): Promise<{
    success: boolean;
    homepageId?: string;
    blocksCreated?: number;
    error?: string;
    /** Set only when generation was refused because the area is off. */
    code?: 'ai_unavailable';
    /**
     * Whether the copy came from the model or from the static fallback.
     *
     * Reported because it used to be invisible: an LLM failure returned canned
     * English and the whole call still answered `success: true`, so the caller
     * showed a finished site and the business was never told its site had not
     * actually been written for it.
     */
    contentSource?: ContentSource;
    /** Something the caller should say out loud. Success, but degraded. */
    warning?: string;
  }> {
    try {
      logger.info({ userId, ...options }, 'Starting website generation');

      // 1. Fetch business profile and services
      const profileResult = await businessProfileRepository.findByUserId(userId);
      if (profileResult.error || !profileResult.data) {
        logger.error({ err: profileResult.error, userId }, 'Failed to fetch business profile');
        return { success: false, error: 'Business profile not found' };
      }

      const profile = profileResult.data;

      // Bookable services only — the same rule every public surface uses.
      // Generating a site from every row put a deactivated or draft service in
      // the services block and the process copy, where a client could read
      // about something they can never book.
      /*
       * ───────────────────────────────────────────────────────────────────────
       * DRAFT SERVICES COUNT WHEN THE PAGE IS ITSELF A DRAFT.
       *
       * `activeOnly: true` requires BOTH `is_active` and `status = 'active'`,
       * and onboarding creates every service as a draft for the owner to price
       * and publish. So this returned ZERO for every new account, and the
       * services section was generated as a heading over nothing:
       *
       *     Our Services
       *     Services Offered
       *     (nothing)
       *
       * Measured on a real account: three rows, `status=draft`, each WITH the
       * description the interview collected, and none of them reached the
       * prompt. The copy then had no services to describe, so the process steps
       * fell back to generic ones and the FAQ had nothing to answer.
       *
       * The restriction itself is right, and the reason above this line is
       * right: a client must not read about something they can never book. But
       * that is a risk of a LIVE page. A fresh generation writes
       * `status: 'draft'` (see the create below), so the page and the services
       * are published by the same owner at the same time, and a draft page
       * describing draft services cannot mislead anybody.
       *
       * An UPDATE keeps whatever status the page already has, so it may be
       * live: that path stays bookable-only, which needs no extra query and
       * leaves the conservative behaviour exactly where the risk is.
       * ───────────────────────────────────────────────────────────────────────
       */
      const pageMayBeLive = !!options.pageId;
      const servicesResult = await schedulingServiceRepository.listAll(userId, pageMayBeLive);
      if (servicesResult.error) {
        logger.warn({ err: servicesResult.error, userId }, 'Failed to fetch services (proceeding with empty array)');
      }

      const services = servicesResult.data || [];

      // 2. Generate website content using LLM
      logger.info({ userId, vertical: profile.vertical, language: profile.language }, 'Generating website content with LLM');

      /*
       * Does this business have testimonials it actually collected?
       *
       * Read once here and threaded through both the prompt and the block plan,
       * so the copy we ask for and the sections we build agree. `{}` or a
       * missing row means no — the central store now holds only authored copy.
       */
      const existingContent = await new WebsiteContentRepository(supabaseServer).findByUserId(userId);
      const hasRealTestimonials =
        Array.isArray((existingContent.data?.testimonials as { items?: unknown[] } | undefined)?.items) &&
        ((existingContent.data?.testimonials as { items?: unknown[] }).items?.length ?? 0) > 0;

      const generated = await this.callLLM(
        { userId, groupId: options.groupId },
        profile,
        services,
        hasRealTestimonials,
        options.focus
      );

      /*
       * Nothing has been written yet — the profile and services reads above are
       * reads — so refusing here leaves the site exactly as it was.
       */
      if (generated.disabled && options.onAiDisabled === 'fail') {
        logger.info({ userId, reason: 'disabled' }, 'Website generation refused: the website area AI is switched off');
        /*
         * F-11: the refusal carries an `error` as well as a `code`.
         *
         * Every other unsuccessful return from this method sets `error`, so a
         * caller that logs or shows `result.error` — and several do — printed
         * `undefined` for this one and turned a clear refusal into a blank.
         * The sentence is the English one; a surface with its own translations
         * switches on `code` and ignores this.
         */
        return {
          success: false,
          code: 'ai_unavailable',
          error: AI_UNAVAILABLE_WEBSITE_WRITING.en,
          contentSource: 'fallback',
        };
      }

      const websiteContent = generated.content;

      // 3. Use user_code as subdomain (or generate one if missing)
      let subdomain = profile.user_code;
      if (!subdomain) {
        // Fetch or generate user_code if not present on profile
        const userCodeResult = await businessProfileRepository.getUserCode(userId);
        if (userCodeResult.error || !userCodeResult.data) {
          logger.warn({ userId }, 'Failed to get user_code, falling back to generated subdomain');
          subdomain = this.generateSubdomain(profile.company_name || 'business');
        } else {
          subdomain = userCodeResult.data;
        }
      }

      // 4. Create homepage
      const websitePageRepository = getWebsitePageRepository(supabaseServer);

      /*
       * The design the owner chose, whichever kind of id it is.
       *
       * `templateId` carries either an archetype id from the wizard or one of
       * the legacy template ids stored before the gallery changed.
       * `themeForTemplateId` resolves both to a complete `PageTheme`, so there
       * is no longer a template branch and an archetype branch doing the same
       * thing differently.
       */
      /*
       * Which design this site is built in.
       *
       * ─────────────────────────────────────────────────────────────────────
       * WHY THE VERTICAL GETS A VOTE
       *
       * This read `options.templateId` and nothing else. Onboarding passes no
       * template — it never asks about visual style — so `designId` was null on
       * every onboarding-generated site and every one of them came out Stone.
       * `ARCHETYPE_BY_VERTICAL` existed and was correct the whole time; its only
       * consumer was the templates LISTING endpoint, which used it to sort a
       * card to the front. No generation path ever called it.
       *
       * An explicit choice still wins — the wizard and the templates tab both
       * pass one. The recommendation only fills the silence, and the owner can
       * change it afterwards from the templates tab like any other choice.
       */
      const designId = options.templateId ?? recommendArchetypeId(profile.vertical);
      const chosenTheme = designId ? themeForTemplateId(designId) : null;

      if (designId && !chosenTheme) {
        logger.warn({ userId, templateId: designId }, 'Unknown design id — falling back to the default archetype');
      }

      /*
       * The default, where nothing was chosen.
       *
       * The model used to nominate three hex values here. With it out of the
       * design business, a generation that named no design gets Stone — the
       * only archetype with no accent colour, and so the hardest to make look
       * wrong with someone else's content.
       */
      const pageTheme = chosenTheme ?? DEFAULT_ARCHETYPE;

      /*
       * Adopt, do not override.
       *
       * This wrote the theme unconditionally, so a business that had already
       * published a landing page — and therefore already had a look — had it
       * silently replaced the moment a website was generated. The first surface
       * a business publishes establishes its design; everything made after
       * takes that one.
       *
       * Adopting BY ID wherever there is one, so `business_profiles.template_id`
       * records which design was chosen. It previously took this branch only for
       * a legacy template, which left every archetype pick recorded as no
       * choice at all.
       */
      if (designId && chosenTheme) {
        await adoptBusinessTemplate(userId, designId);
      } else {
        // Asserted because `PageTheme` is an interface with no index signature,
        // and updateBranding stores branding as free-form JSON.
        await adoptBusinessTheme(userId, pageTheme as unknown as Record<string, unknown>);
      }

      // What the copy says about the page, whichever way we get there.
      const pageFacts = {
        title: websiteContent.title,
        meta_description: websiteContent.metaDescription,
        seo_keywords: websiteContent.keywords,
        subdomain,
        website_language: (profile.language || 'en') as 'en' | 'es' | 'he',
        theme: pageTheme,
        /*
         * The template, and the fact that this page has been written.
         *
         * Neither was recorded. `template_id` stayed null forever, so the wizard
         * had nothing to pre-select and fell back to whichever template happened
         * to be first in the array — that is how a parenting school ended up on
         * an academic-tutoring theme. And with no record of a previous
         * generation there was no way to tell a page that has never been written
         * from one whose copy somebody has since edited, which is exactly the
         * distinction that decides whether regenerating is safe.
         */
        /*
         * Which design this page wears.
         *
         * Recorded so the wizard can pre-select it. This read the resolved
         * template object rather than the id that was passed, so an archetype
         * — where there is no template object — stored null, and the wizard
         * fell back to whichever design happened to be first. That is the same
         * failure this field was added to fix, reintroduced one layer up.
         */
        template_id: designId && chosenTheme ? designId : null,
        content_generated_at: new Date().toISOString(),
      };

      const homepageResult = options.pageId
        ? await websitePageRepository.update(options.pageId, userId, pageFacts)
        : await websitePageRepository.create({
            user_id: userId,
            page_type: 'homepage',
            slug: 'home',
            status: 'draft', // Website starts as draft - user must explicitly publish
            ...pageFacts,
          });

      if (homepageResult.error || !homepageResult.data) {
        logger.error({ err: homepageResult.error, userId, pageId: options.pageId }, 'Failed to write homepage');
        return { success: false, error: options.pageId ? 'Failed to update homepage' : 'Failed to create homepage' };
      }

      const homepage = homepageResult.data;
      logger.info({ userId, homepageId: homepage.id, subdomain, filled: Boolean(options.pageId) }, 'Homepage ready');

      // 5. Create website blocks
      //
      // The same plan the prompt was written from, so the copy that came back
      // has somewhere to go and nothing is built that was never asked for.
      const sections = this.planSections(services, hasRealTestimonials);

      /*
       * The photographs, found while the copy is still warm.
       *
       * In parallel and never fatal: each answers null on any failure and the
       * section simply has no picture, which is the state every block already
       * renders. A stock search is a fifth of a second, so this is not worth
       * making progressive — and a site that appears complete is a better first
       * minute than one that fills in while the owner watches.
       */
      /*
       * A gallery only where the recipe asks for one.
       *
       * Reading the recipe rather than the vertical keeps the decision in the
       * one place that already makes it — a trade added to `gallery_led` later
       * gets a gallery without anything here changing.
       */
      const pageRecipe = recipeFor(profile.vertical, options.focus ? 'landing' : 'homepage');
      const wantsGallery = pageRecipe.includes('gallery' as never);
      const wantsStats = pageRecipe.includes('stats' as never);

      const [heroImage, aboutImage, galleryImages] = await Promise.all([
        imageForSection(userId, profile.vertical, 'portrait', 'hero'),
        imageForSection(userId, profile.vertical, 'portrait', 'about'),
        wantsGallery ? imagesForSection(userId, profile.vertical, 'wide', 'gallery', 6) : Promise.resolve([]),
      ]);

      const builtBlocks = this.buildBlocks(
        homepage.id,
        websiteContent,
        services,
        profile.language || 'en',
        profile.company_name || 'Your Business',
        (profile.extracted_data as { needs_intake?: boolean } | null)?.needs_intake === true,
        sections,
        { hero: heroImage, about: aboutImage },
        galleryImages,
        wantsStats,
        /* The interview's answers, so the journey is built from what the
           business sells rather than from whichever rows happen to be
           publishable at this second. */
        this.businessFacts(profile, services),
      );

      /*
       * The ORDER comes from the recipe, not from `buildBlocks`.
       *
       * Every site got the same eleven sections in the same sequence —
       * positions 0 to 10, hardcoded — which is half of why they all read the
       * same. A photographer's gallery belongs third and a consultant should
       * never have one; that was already decided in the 33 templates and was
       * never consulted at generation time.
       *
       * `buildBlocks` still decides what each section SAYS. It no longer
       * decides where it goes.
       */
      /*
       * `focus` is what makes this a landing page rather than a homepage — it
       * is the brief for one offering, and the prompt above already branches on
       * it. The page type was hardcoded to 'homepage' here, so a landing page
       * built through this path was ordered by the homepage recipe and
       * `RECIPES.landing` was unreachable in production.
       */
      const pageType = options.focus ? 'landing' : 'homepage';

      /*
       * ─────────────────────────────────────────────────────────────────────
       * AND EVERY BUTTON POINTS AT A SECTION THIS PAGE ACTUALLY HAS.
       *
       * Checked HERE, after the recipe, so the pass sees the final list. A
       * fragment matching no element is the quietest failure a page has: the
       * browser does not navigate, does not scroll and reports nothing, so the
       * loudest button on a new site silently does nothing at all.
       *
       * It catches LESS than it used to be credited with, and the difference
       * matters. This comment used to say `orderByRecipe` "DROPS the sections
       * this vertical does not get" — it does not, and says so itself: a block
       * the recipe does not name is moved above the footer, never discarded
       * (`recipes.ts`, "NOTHING IS DROPPED"). So on a homepage every section
       * `buildBlocks` emitted is still there and this pass almost never fires.
       *
       * Which is why it is NOT the guard against a button going to the wrong
       * place. It only asks whether a destination EXISTS. A button reading
       * "Get in touch" and pointing at a perfectly real `#services` passes it
       * untouched — that is what `ctaIntent` is for, upstream, where the words
       * and the destination are chosen as one thing.
       *
       * This is the same pass the renderer runs, from the same shared table of
       * section anchors, so what is STORED is already correct rather than
       * corrected on the way out: a dead destination is sent to the best
       * section the page does have, and dropped when it has none — which lets
       * the hero, header and CTA fall through to opening the booking dialog.
       * A dead menu item is removed rather than silently repointed.
       * ─────────────────────────────────────────────────────────────────────
       */
      const ordered = orderByRecipe(
        builtBlocks,
        recipeFor(profile.vertical, pageType),
        (pageTheme.layouts ?? DEFAULT_ARCHETYPE.layouts),
      );

      const { blocks, repairs: linkRepairs } = repairBlockLinks(ordered);

      if (linkRepairs.length > 0) {
        // Loud, because it means `buildBlocks` and the recipe disagreed about
        // which sections this page has — worth knowing even though the page
        // being written is already correct.
        logger.warn(
          { userId, pageType, vertical: profile.vertical, repairs: linkRepairs },
          'Generated buttons named sections the recipe did not install; destinations resolved'
        );
      }
      const websiteBlockRepository = getWebsiteBlockRepository(supabaseServer);

      // A page we were handed already has blocks — the standard set installed
      // when it was created — so writing ours on top would give the site two
      // heroes and two service lists. They are replaced, not appended.
      //
      // After `buildBlocks`, which is pure: if generation is going to fail it
      // should fail before anything is removed. And after the page update
      // above returned data, which is what proves this page is the caller's —
      // `deleteByPageId` takes no user id of its own.
      if (options.pageId) {
        const cleared = await websiteBlockRepository.deleteByPageId(options.pageId);
        if (cleared.error) {
          logger.error({ err: cleared.error, userId, pageId: options.pageId }, 'Failed to clear existing blocks');
          return { success: false, error: 'Failed to replace the existing page content' };
        }
      }

      let blocksCreated = 0;
      for (const block of blocks) {
        const blockResult = await websiteBlockRepository.create(block);

        if (blockResult.error) {
          logger.warn({ err: blockResult.error, blockType: block.block_type }, 'Failed to create block (non-blocking)');
        } else {
          blocksCreated++;
        }
      }

      logger.info(
        { userId, homepageId: homepage.id, blocksCreated, planned: blocks.length, contentSource: generated.source },
        'Website generation completed'
      );

      // Every block insert failed, and the page's previous blocks were already
      // deleted above. That is an empty page, which is data loss rather than a
      // degraded result, so it must not report success.
      if (blocksCreated === 0 && blocks.length > 0) {
        return {
          success: false,
          homepageId: homepage.id,
          blocksCreated: 0,
          contentSource: generated.source,
          error: 'No sections could be saved',
        };
      }

      // 6. Update profile completeness to 75% (website now complete)
      await businessProfileRepository.update(userId, {
        profile_completeness: 75,
      });

      // Succeeded, but say so honestly when it is not the full thing.
      const warnings: string[] = [];
      if (generated.source === 'fallback') {
        warnings.push(`content_fallback${generated.reason ? `: ${generated.reason}` : ''}`);
      }
      if (blocksCreated < blocks.length) {
        warnings.push(`partial_blocks: ${blocksCreated}/${blocks.length}`);
      }

      return {
        success: true,
        homepageId: homepage.id,
        blocksCreated,
        contentSource: generated.source,
        warning: warnings.length > 0 ? warnings.join(' · ') : undefined,
      };

    } catch (error) {
      logger.error({ err: error, userId }, 'Website generation failed');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Call LLM to generate website content
   */
  private async callLLM(
    owner: BosLlmOwner,
    profile: any,
    services: any[],
    hasRealTestimonials = false,
    focus?: { title: string; description?: string }
  ): Promise<GeneratedContent> {
    const facts = this.businessFacts(profile, services);
    const sections = this.planSections(services, hasRealTestimonials, facts);
    const prompt = this.buildPrompt(profile, services, sections, focus, facts);
    const language = profile.language || 'en';

    const systemPrompts: Record<string, string> = {
      en: 'You are a professional website copywriter. Generate compelling, clear, and SEO-optimized website content in English — every field, including section headings and button labels.',
      he: 'אתה כותב תוכן אתרים מקצועי. צור תוכן מושך, ברור ומותאם לקידום אתרים. חובה לכתוב את כל התוכן בעברית בלבד - כל השדות כולל כותרות הסעיפים, תיאורים, שאלות ותשובות, עדויות לקוחות וטקסט הכפתורים.',
      es: 'Eres un redactor profesional de sitios web. Genera contenido atractivo, claro y optimizado para SEO. Todo el contenido debe estar en español - incluyendo los títulos de las secciones, descripciones, preguntas y respuestas, testimonios y el texto de los botones.',
    };

    // Model, temperature and the on/off switch come from the website area row
    // (Layer 2 FR-12). This is the ONE place the switch is read for this call.
    const settings = await resolveBosLlmSettings('website', 'full_site');
    if (!settings.enabled) {
      logger.info({ userId: profile.user_id, language, reason: 'disabled' }, 'Website copywriting AI is switched off');
      return {
        content: this.getFallbackContent(profile, services),
        source: 'fallback',
        reason: 'disabled',
        disabled: true,
      };
    }

    try {
      const factory = getProviderFactory();

      // Use the factory's complete() method directly (not getProvider).
      // Built inside the attempt so a retry carries the model that ran (FR-11).
      const { result: response } = await withModelFallback(settings, (model) => factory.complete({
        model,
        messages: [
          { role: 'system', content: systemPrompts[language] || systemPrompts.en },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
      }, buildBosCallContext({
        userId: owner.userId,
        area: 'website',
        callName: 'full_site',
        groupId: owner.groupId,
      })));

      const parsed = WebsiteContentSchema.safeParse(JSON.parse(response.content));

      if (!parsed.success) {
        // A shape we cannot build from. Falling back here is the whole reason
        // `getFallbackContent` exists; letting it through meant the TypeError
        // surfaced later, from inside `buildBlocks`, where the outer catch read
        // it as "generation failed" and the business got nothing at all.
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
        logger.error({ userId: profile.user_id, language, issues }, 'LLM returned an unusable shape');
        return {
          content: this.getFallbackContent(profile, services),
          source: 'fallback',
          reason: `invalid_shape: ${issues.slice(0, 3).join('; ')}`,
        };
      }

      logger.debug({ userId: profile.user_id, language }, 'LLM website content generated');
      return {
        content: this.fillPlannedGaps(
          parsed.data as unknown as WebsiteContent,
          sections,
          facts,
          services,
          language
        ),
        source: 'llm',
      };

    } catch (error) {
      logger.error({ err: error, userId: profile.user_id }, 'LLM call failed');
      return {
        content: this.getFallbackContent(profile, services),
        source: 'fallback',
        reason: error instanceof Error ? error.message : 'llm_call_failed',
      };
    }
  }

  /**
   * Build LLM prompt for website generation
   * Uses ALL profile data collected during onboarding for comprehensive website content
   */
  /**
   * Which sections this business's site is made of.
   *
   * Made once and used twice — by the prompt, so the model is asked for the
   * copy that will actually be placed, and by the block builder, so nothing is
   * generated that has no home. They used to decide separately: the prompt
   * always asked for a booking heading and testimonials, while the builder
   * dropped the booking block for a business with no services, so a shop was
   * paying for copy nobody would ever read and a client could meet a "Book
   * Your Session" heading over a catalogue of downloads.
   */
  /**
   * What the INTERVIEW established, as distinct from what the catalogue holds.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The plan used to take one input: the list of bookable services. Measured on
   * a real account, that was empty at the moment of generation — three services
   * had been created as drafts five seconds earlier and the first was not
   * activated for another ninety-seven. So `services: false`, `process: false`,
   * the prompt was never asked for service descriptions or process steps, and
   * the page shipped with those sections empty.
   *
   * The onboarding answers were sitting on the profile the whole time:
   * `service_count: 3`, `sells_scheduled: true`, `collection_method: 'invoice'`.
   * A business that answered those sells something, whether or not a row
   * happens to be publishable this second.
   *
   * So the facts come from the answers and the catalogue refines them, rather
   * than the catalogue deciding alone.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private businessFacts(profile: any, services: any[]): {
    sellsSomething: boolean;
    isScheduled: boolean;
    collects: string | null;
    needsIntake: boolean;
    brief?: BusinessBrief;
  } {
    const answers = profile?.extracted_data ?? {};

    return {
      sellsSomething: services.length > 0 || Number(answers.service_count ?? 0) > 0,
      /* The rows win where there are any — a catalogue is a later, more
         specific statement than the one-tap answer that preceded it. */
      isScheduled: services.length
        ? services.some((s: any) => s.is_scheduled !== false)
        : answers.sells_scheduled === true,
      collects: answers.collection_method ?? null,
      needsIntake: answers.needs_intake === true,
      brief: answers.business_brief,
    };
  }

  private planSections(services: any[], hasRealTestimonials = false, facts?: ReturnType<WebsiteGenerationService['businessFacts']>): {
    services: boolean;
    process: boolean;
    booking: boolean;
    testimonials: boolean;
    faq: boolean;
    contact: boolean;
    cta: boolean;
  } {
    /* The answers, where the caller read them; the catalogue alone otherwise,
       which is what every existing caller got. */
    const hasServices = facts?.sellsSomething ?? services.length > 0;

    return {
      services: hasServices,
      /*
       * A process block describes how someone gets what they came for; with
       * nothing to sell there is no process to describe.
       *
       * Also planned where the owner walked us through how the work runs, even
       * with no catalogue: that answer IS a process section, and refusing to
       * plan one throws away the only part of the interview written to fill it.
       */
      process: hasServices || (facts?.brief?.delivery?.length ?? 0) > 0,
      /*
       * Not a default section.
       *
       * This added a page-level booking widget whenever any service was
       * scheduled — but a single inline calendar cannot express what the
       * services now decide individually: one is booked against a time, another
       * is a download, and the widget offered the same appointment for both.
       * The services section already gives each service its own button,
       * resolved from that service's own journey.
       *
       * Kept in the plan shape rather than deleted, so a caller that genuinely
       * wants a standalone calendar can still ask for one and `buildBlocks`
       * knows what to do with it.
       */
      booking: false,
      /*
       * Only where the business actually has reviews.
       *
       * This was `true` for everyone, and the fallback shipped invented quotes
       * — "Amazing experience! Highly recommended." — Sarah M. — onto the public
       * site of a real business that had never had a client. That is a claim its
       * owner did not make and cannot stand behind, published under their name.
       *
       * A business with no reviews now gets no section. The Sections tab's "Add
       * Section" is how they add one once they have something true to put in it.
       */
      testimonials: hasRealTestimonials,
      faq: true,
      contact: true,
      cta: true,
    };
  }

  /**
   * Every string on the page comes back in the business's language.
   *
   * The enumerated list matters more than the blanket rule — a model reads
   * "generate all content in Hebrew", then writes an English button label
   * because nothing named button labels. Each new section is added to all
   * three lists, not just to the JSON contract.
   */
  private buildPrompt(
    profile: any,
    services: any[],
    sections: ReturnType<WebsiteGenerationService['planSections']>,
    focus?: { title: string; description?: string },
    facts?: ReturnType<WebsiteGenerationService['businessFacts']>
  ): string {
    const vertical = profile.vertical || 'business';
    const subVertical = profile.sub_vertical || null;
    const companyName = profile.company_name || 'Business';
    const description = profile.description || `A ${vertical} providing professional services`;
    const language = profile.language || 'en';

    // Extract rich profile data from onboarding
    const painPoints = profile.pain_points || [];
    const goals = profile.goals || [];
    const tools = profile.tools || [];
    const onlinePresenceMode = profile.online_presence_mode || 'full_website';
    const paymentMode = profile.payment_mode || 'none';

    // Extract additional data from extracted_data if available
    const extractedData = profile.extracted_data || {};

    /*
     * WHO IT IS FOR: the brief first, the old guess second.
     * ─────────────────────────────────────────────────────────────────────────
     * Two sources answered this and the weaker one won. `target_audience` was
     * inferred by the story extraction from one sentence, under an instruction
     * to "be GENEROUS in inference", and arrived as a word or two:
     * ["parents", "families"]. `brief.audience` is the owner's reply to a
     * question asked only about this, and arrives as what they actually said:
     * "competitive gymnasts, ages 8 to 16, mostly brought by a parent".
     *
     * The prompt below uses this twice, including "use language that resonates
     * with…", so the difference between the two is the difference between copy
     * written for a demographic and copy written for a person.
     */
    const briefAudience = facts?.brief?.audience ?? [];
    const targetAudience = briefAudience.length ? briefAudience : (extractedData.target_audience || []);

    // A product has no duration and a quoted service has no price, so neither
    // is stated as a fact the copy can lean on — "null minutes" in the prompt
    // becomes "null minutes" on the page.
    const serviceList = services
      .map(s => {
        const parts = [
          s.duration_minutes ? `${s.duration_minutes} minutes` : null,
          s.is_scheduled === false ? 'no appointment needed' : null,
          s.price === null || s.price === undefined
            ? 'price agreed per client'
            : s.price > 0 ? `${s.price} ${s.currency}` : 'Free',
        ].filter(Boolean);
        /*
         * The owner's own sentence about the service, where there is one.
         *
         * Without it this line is a name and a price, and the model writes the
         * service card from the name alone: "Personal Training" becomes
         * "professional personal training tailored to your needs". The
         * interview now asks what the service IS precisely so this line has
         * something in it, and the description is put FIRST because it is the
         * part worth writing from.
         */
        const own = typeof s.description === 'string' ? s.description.trim() : '';
        const facts = parts.length ? ` (${parts.join(', ')})` : '';
        return own
          ? `- ${s.service_name}: ${own}${facts}`
          : `- ${s.service_name}: ${parts.join(', ')}`;
      })
      .join('\n');

    const languageInstructions: Record<string, string> = {
      en: 'LANGUAGE REQUIREMENT: Generate ALL content values in English only — including every heading, paragraph, service description, process step, FAQ, testimonial, every section title (sectionTitles), the call-to-action text, and EVERY BUTTON LABEL (buttons.bookCta, buttons.contactCta, buttons.learnMoreCta).',
      he: `
!!! קריטי - דרישת שפה !!!
צור את כל התוכן בעברית בלבד. זה כולל:
- כותרות (headline, subheadline, title)
- פסקאות (paragraphs)
- תיאורי שירותים (serviceDescriptions)
- שלבי תהליך (processSteps - title ו-description)
- שאלות ותשובות (faq - question ו-answer)
- עדויות לקוחות (testimonials - quote ו-role)
- כותרת ותיאור ההזמנה (booking - title ו-description)
- כותרת ותיאור טופס יצירת הקשר (contact - title ו-description)
- קריאה לפעולה (cta - title ו-description)
- כותרות כל הסעיפים (sectionTitles - about, services, process, testimonials, faq)
- טקסט כל הכפתורים (buttons - bookCta, contactCta ו-learnMoreCta)
- מטא תיאור (metaDescription)
- מילות מפתח (keywords)

!!! אל תשתמש באנגלית בשום שדה תוכן !!!
כל הערכים חייבים להיות בעברית.
`.trim(),
      es: `
!!! CRÍTICO - REQUISITO DE IDIOMA !!!
Genera TODO el contenido en español únicamente. Esto incluye:
- Títulos (headline, subheadline, title)
- Párrafos (paragraphs)
- Descripciones de servicios (serviceDescriptions)
- Pasos del proceso (processSteps - title y description)
- Preguntas frecuentes (faq - question y answer)
- Testimonios (testimonials - quote y role)
- Título y descripción de la reserva (booking - title y description)
- Título y descripción del formulario de contacto (contact - title y description)
- Llamada a la acción (cta - title y description)
- Los títulos de TODAS las secciones (sectionTitles - about, services, process, testimonials, faq)
- El TEXTO DE TODOS LOS BOTONES (buttons - bookCta, contactCta y learnMoreCta)
- Meta descripción (metaDescription)
- Palabras clave (keywords)

!!! NO uses inglés en ningún campo de contenido !!!
Todos los valores deben estar en español.
`.trim(),
    };

    // Map pain_points to human-readable descriptions for better LLM context
    const painPointDescriptions: Record<string, string> = {
      no_shows: 'clients missing appointments without notice',
      manual_reminders: 'spending time sending manual appointment reminders',
      payment_collection: 'difficulty collecting payments from clients',
      admin_overhead: 'too much administrative work taking time away from clients',
      client_tracking: 'trouble keeping track of client information and progress',
      no_website: 'no professional online presence',
      scheduling_chaos: 'complicated scheduling and calendar management',
      follow_up: 'difficulty following up with leads and clients',
      retention: 'challenges retaining clients long-term',
    };

    // Map goals to human-readable descriptions
    const goalDescriptions: Record<string, string> = {
      grow_clients: 'grow their client base',
      save_time: 'save time on administrative tasks',
      automation: 'automate repetitive workflows',
      professional_image: 'project a more professional image',
      online_presence: 'establish a strong online presence',
      grow_revenue: 'increase revenue',
      retain_clients: 'improve client retention',
    };

    /*
     * WHAT THE OWNER ACTUALLY SAID ABOUT THE BUSINESS.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The three blocks below — pain points, goals, audience — read from fields
     * the onboarding extraction returns as empty arrays on a real account. They
     * resolve to empty strings, and the model is left writing from a vertical
     * and a one-line description. That is where "Transform Your Fitness
     * Journey" comes from: there was nothing specific to say.
     *
     * The brief is the interview's answer to that — who the clients are, what
     * they get, what makes this business the choice, what stands behind it, and
     * what stops people buying. It goes FIRST, because it is the only part of
     * this prompt that distinguishes one trainer from another.
     *
     * `voice` matters on its own: the generated About copy switched between
     * "our mission", "I bring" and "We work" in a single paragraph because
     * nothing recorded whether this business is an "I" or a "we".
     * ─────────────────────────────────────────────────────────────────────────
     */
    const brief = facts?.brief;
    const briefText = brief
      ? [
          '',
          '=== WHAT THE OWNER TOLD US ===',
          'Use these. They are the specifics that make this page theirs rather than',
          'generic copy for the trade. Do not contradict them and do not add claims',
          'they do not contain.',
          brief.audience?.length ? `Who it is for: ${brief.audience.join('; ')}` : '',
          brief.outcome?.length ? `What the client gets: ${brief.outcome.join('; ')}` : '',
          brief.differentiators?.length
            ? `What makes them the choice: ${brief.differentiators.join('; ')}`
            : '',
          brief.credentials?.length ? `What stands behind it: ${brief.credentials.join('; ')}` : '',
          brief.objections?.length
            ? `What stops people buying (answer these in the FAQ and the reassurance): ${brief.objections.join('; ')}`
            : '',
          /*
           * The one brief field that answers a SECTION rather than a sentence,
           * so it is pointed at that section by name.
           *
           * Before it existed, `processSteps` was filled by `journeySteps()`,
           * which reads the BOOKING journey: "pick a time, get a confirmation,
           * turn up". True of every business here and interesting about none of
           * them. This is the owner describing their actual work, which is what
           * a visitor deciding whether to hire them wants to read.
           */
          brief.delivery?.length
            ? `HOW THE WORK RUNS, in the owner's words. Write processSteps from THIS, in this ` +
              `order, and keep it about the work rather than about booking or paying: ` +
              `${brief.delivery.join('; ')}`
            : '',
          brief.voice === 'individual'
            ? 'VOICE: one person. Write as "I", never "we" or "our team".'
            : brief.voice === 'team'
              ? 'VOICE: a team. Write as "we".'
              : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';

    // Build pain points section if available
    const painPointsText = painPoints.length > 0
      ? `\nBusiness Challenges (problems they solve for clients):\n${painPoints.map((p: string) => `- ${painPointDescriptions[p] || p}`).join('\n')}`
      : '';

    // Build goals section if available
    const goalsText = goals.length > 0
      ? `\nBusiness Goals:\n${goals.map((g: string) => `- ${goalDescriptions[g] || g}`).join('\n')}`
      : '';

    // Build target audience section if available
    const targetAudienceText = targetAudience.length > 0
      ? `\nTarget Audience: ${targetAudience.join(', ')}`
      : '';

    /*
     * NO VOLUME LINE. It was a number nobody gave.
     * ─────────────────────────────────────────────────────────────────────────
     * `clients_per_week` has no question anywhere in onboarding. The story
     * extraction was told to guess it from an adjective ("busy" = 15, "just
     * starting" = 3, "small practice" = 5) and `computeConfiguration` then
     * applied `|| 5`. So this line told the copywriter "Business Volume:
     * Approximately 5 clients per week" about businesses that had never been
     * asked, and a model given a number will use it.
     *
     * Kept as an empty string rather than removed from the template, so a
     * future question that genuinely collects this has somewhere to land.
     */
    const volumeText = '';

    // Build payment context
    const paymentText = paymentMode !== 'none'
      ? `\nPayment Model: ${paymentMode === 'upfront' ? 'Clients pay when booking' : paymentMode === 'invoicing' ? 'Invoice-based billing' : 'Installment payment plans'}`
      : '';

    /*
     * A landing page is about ONE thing, and it comes first.
     *
     * Without this the prompt describes the business and the model writes a
     * second homepage: the same hero, the same services, under a different
     * slug. The offer goes at the top, where it sets what every section is
     * about, while the profile below still supplies the voice, the trade and
     * the audience.
     */
    const focusBrief = focus
      ? `=== THIS PAGE IS PROMOTING ONE THING ===\n` +
        `Title: ${focus.title}\n` +
        (focus.description ? `What it is: ${focus.description}\n` : '') +
        `Write EVERY section about this offer — the hero, the copy, the ` +
        `call to action. The business details below are context for the voice ` +
        `and the audience, not the subject.\n\n`
      : '';

    return `
Generate a complete ${focus ? 'landing page' : 'website'} for a ${subVertical ? `${subVertical} (${vertical})` : vertical} business.

${languageInstructions[language]}

${focusBrief}
=== BUSINESS PROFILE ===
Business Name: ${companyName}
Business Type: ${subVertical || vertical}
Description: ${description}
${targetAudienceText}
${volumeText}
${painPointsText}
${goalsText}
${paymentText}
${briefText}

=== SERVICES OFFERED ===
${serviceList || '- Services to be added'}

=== GENERATION INSTRUCTIONS ===
Generate the following as JSON. Use the business profile information above to:
1. Create a compelling headline that speaks to the target audience
2. Write about section paragraphs that address their challenges and showcase expertise
3. Generate service descriptions that highlight value and outcomes
4. Design process steps that reflect the actual client journey

{
  "title": "Homepage title (50-60 characters, include business name and key value)",
  "metaDescription": "SEO meta description (120-160 characters, highlight unique value proposition)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "hero": {
    "headline": "Compelling headline that speaks to target audience (5-10 words)",
    "subheadline": "Supporting text explaining value proposition and outcomes (15-25 words)"
  },
  "about": {
    "paragraphs": [
      "Paragraph 1: Introduction to the business and its mission",
      "Paragraph 2: Expertise, experience, and what makes them unique",
      "Paragraph 3: Approach to working with clients and expected outcomes"
    ]
  },
${sections.services ? `  "serviceDescriptions": {
    "Service Name": {
      "description": "Benefit-focused description explaining what client gets and why it matters (20-40 words)",
      "icon": "Choose appropriate icon from: MessageCircle, Brain, Target, Dumbbell, Hand, Flower2, Camera, Scale, Palette, Code, BookOpen, Music, Scissors, Sparkles, Heart, Users, Briefcase, GraduationCap, Stethoscope, Calculator, PenTool, Mic, Video, Utensils, Wrench, Car, Home, ShieldCheck, Plane, Dog, Baby, Leaf, Clock, Check, Zap, Eye, Shield, Award, Globe, Lock, CreditCard, Activity, Compass, Moon, Building, Feather, BarChart, Star, TrendingUp"
    }
  },
` : ''}${sections.booking ? `  "booking": {
    "title": "Heading above the booking widget — say what the client is actually doing, not a generic 'Book Now'",
    "description": "One line telling them what happens next (10-20 words)"
  },
` : ''}${sections.contact ? `  "contact": {
    "title": "Heading for the contact form",
    "description": "One line inviting the right kind of enquiry for this business (10-20 words)"
  },
` : ''}${sections.cta ? `  "cta": {
    "title": "Closing call to action — must NOT repeat the hero headline",
    "description": "One line of encouragement specific to this business (10-20 words)"
  },
` : ''}${sections.process ? `  "processSteps": [
    {
      "title": "Step title",
      "description": "Brief description of what happens (10-20 words)",
      "icon": "calendar" // Valid: calendar, clipboard, check, user, phone, mail, heart, star
    }
  ],
` : ''}${sections.testimonials ? `  "testimonials": [
    {
      "quote": "Realistic testimonial quote that reflects the service quality (20-40 words)",
      "author": "First Name L.",
      "role": "Client role or description"
    }
  ],
` : ''}${sections.faq ? `  "faq": [
    {
      "question": "Common question clients might ask",
      "answer": "Clear, helpful answer (20-50 words)"
    }
  ],
` : ''}
  "sectionTitles": {
    "about": "Heading for the about section — 2-5 words in this business's own language, not the generic word for 'About'"${sections.services ? `,
    "services": "Heading for the services section (2-4 words)"` : ''}${sections.process ? `,
    "process": "Heading for the how-it-works section (2-5 words)"` : ''}${sections.testimonials ? `,
    "testimonials": "Heading for the testimonials section (2-5 words)"` : ''}${sections.faq ? `,
    "faq": "Heading for the questions section (2-5 words)"` : ''}
  },
  "buttons": {
    "bookCta": "Words for a button that takes the visitor to the list of services, to book or buy — 2-4 words, naming what they get",
    "contactCta": "Words for a button that takes the visitor to the contact form — 2-4 words",
    "learnMoreCta": "Words for a button that carries the visitor further down the page, to read about this business — 2-4 words"
  },
}

=== CONTENT QUALITY GUIDELINES ===
- Write in the appropriate tone for a ${subVertical || vertical} (professional but approachable)
- Focus on client outcomes and benefits, not just features
- Address potential client concerns implicitly in the about section
- Make the process steps feel welcoming and low-friction
- Use language that resonates with ${targetAudience.length > 0 ? targetAudience.join(', ') : 'the target audience'}
${painPoints.length > 0 ? `- Subtly address these pain points in the messaging: ${painPoints.join(', ')}` : ''}
${goals.length > 0 ? `- Align content with these business goals: ${goals.join(', ')}` : ''}

${sections.testimonials ? `=== TESTIMONIALS GUIDELINES ===
- Use ONLY reviews this business has actually collected, supplied above.
- Never invent a quote, a name or a role.

` : `=== TESTIMONIALS ===
- Do NOT produce testimonials. This business has none to show, and an invented
  endorsement is a claim its owner cannot stand behind, published under their
  name. The section exists on the page for them to fill in themselves.

`}=== FAQ GUIDELINES ===
- Generate 3-4 common questions relevant to this ${subVertical || vertical} business
${brief?.objections?.length
  ? `- ANSWER THESE FIRST. They are what the owner says actually stops people buying:\n${brief.objections.map((o: string) => `    · ${o}`).join('\n')}`
  : '- Questions should address: booking process, what to expect, pricing/payment, preparation'}
- Answers should be concise, helpful, and reduce friction to booking

Generate compelling, professional content that clearly communicates the value proposition and encourages visitors to ${services.length > 0 ? 'book a session' : 'get in touch'}.

=== FINAL LANGUAGE REMINDER ===
${language === 'he' ? 'זכור: כל התוכן חייב להיות בעברית בלבד. לא אנגלית!' : language === 'es' ? 'Recuerda: Todo el contenido debe estar en español únicamente. ¡No inglés!' : 'Remember: All content must be in English.'}
    `.trim();
  }


  /**
   * The icon a generated service card carries.
   *
   * One icon for every service, matching what `/api/website/blocks/services`
   * serves on a live page — see the long note there for why guessing from the
   * name was dropped. In short: the keyword list missed most real service names
   * even with Hebrew in it (`קורס` was never in it), so a page ended up with one
   * meaningful glyph beside a row of fallback stars, and the odd one out reads
   * as a bug.
   *
   * Kept as a method rather than inlined so the day services carry an
   * owner-chosen icon, there is one place to read it from.
   */
  private getDefaultIconForService(_serviceName: string): string {
    return 'Sparkles';
  }

  /**
   * Build website blocks from generated content
   */
  /**
   * @param images the photographs found for this site, by section. Absent or
   *   null for any section means that section has no picture — which is what
   *   every block already handled, because until now it was the only case.
   */
  private buildBlocks(pageId: string, content: WebsiteContent, services: any[], language: string = 'en', companyName: string = 'Your Business', needsIntake: boolean = false, sections?: ReturnType<WebsiteGenerationService['planSections']>, images: Partial<Record<'hero' | 'about', string | null>> = {}, gallery: string[] = [], wantsStats = false, facts?: ReturnType<WebsiteGenerationService['businessFacts']>): any[] {
    const plan = sections ?? this.planSections(services);
    // Block title translations
    const blockTitles: Record<string, Record<string, string>> = {
      about: { en: 'About', he: 'אודות', es: 'Acerca de' },
      gallery: { en: 'Work', he: 'עבודות', es: 'Trabajos' },
      stats: { en: 'Our Impact', he: 'ההשפעה שלנו', es: 'Nuestro Impacto' },
      services: { en: 'Services', he: 'שירותים', es: 'Servicios' },
      process: { en: 'How It Works', he: 'איך זה עובד', es: 'Cómo Funciona' },
      booking: { en: 'Book Your Session', he: 'קבעו פגישה', es: 'Reserva tu Sesión' },
      bookingDescription: { en: 'Choose a time that works for you', he: 'בחרו זמן שמתאים לכם', es: 'Elige un horario que te convenga' },
      cta: { en: 'Ready to get started?', he: 'מוכנים להתחיל?', es: '¿Listo para comenzar?' },
      ctaBooking: { en: 'Book a Session', he: 'קבעו פגישה', es: 'Reservar Sesión' },
      ctaContact: { en: 'Contact Us', he: 'צרו קשר', es: 'Contáctanos' },
      ctaSchedule: { en: 'Schedule Now', he: 'קבעו עכשיו', es: 'Agendar Ahora' },
      ctaGetInTouch: { en: 'Get in Touch', he: 'צרו קשר', es: 'Contáctanos' },
      ctaLearnMore: { en: 'Learn More', he: 'קראו עוד', es: 'Saber Más' },
      contact: { en: 'Contact', he: 'יצירת קשר', es: 'Contacto' },
      testimonials: { en: 'What Clients Say', he: 'מה הלקוחות אומרים', es: 'Lo que Dicen los Clientes' },
      faq: { en: 'Frequently Asked Questions', he: 'שאלות נפוצות', es: 'Preguntas Frecuentes' },
    };

    // Navigation menu item translations
    const menuLabels: Record<string, Record<string, string>> = {
      about: { en: 'About', he: 'אודות', es: 'Acerca de' },
      gallery: { en: 'Work', he: 'עבודות', es: 'Trabajos' },
      stats: { en: 'Our Impact', he: 'ההשפעה שלנו', es: 'Nuestro Impacto' },
      services: { en: 'Services', he: 'שירותים', es: 'Servicios' },
      process: { en: 'How It Works', he: 'איך זה עובד', es: 'Cómo Funciona' },
      contact: { en: 'Contact', he: 'יצירת קשר', es: 'Contacto' },
      bookNow: { en: 'Book Now', he: 'הזמן עכשיו', es: 'Reservar' },
    };

    const t = (key: string) => blockTitles[key]?.[language] || blockTitles[key]?.en || key;
    const menu = (key: string) => menuLabels[key]?.[language] || menuLabels[key]?.en || key;

    /**
     * The AI's heading for a section, or the phrasebook's.
     *
     * Trimmed and length-checked rather than trusted: a heading is rendered in
     * display type, and a model that answers with a sentence would break the
     * layout of a page nobody is going to proofread before it is published.
     */
    const heading = (key: keyof NonNullable<WebsiteContent['sectionTitles']>, fallbackKey: string) => {
      const written = content.sectionTitles?.[key]?.trim();
      return written && written.length <= 40 ? written : t(fallbackKey);
    };

    /**
     * A button: its words and where it goes, as one value.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The code chooses the INTENT — it is the only side that knows which
     * sections this page installs and whether the business has anything to
     * sell. The model wrote the words for each intent. `ctaFor` pairs them.
     *
     * Written this way so a destination cannot be edited without its label
     * coming too. Before, each button named its own anchor as a literal
     * beside a label the model had chosen, and the pair drifted: a closing
     * call to action reading "Get in Touch" that scrolled to the services.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const cta = (intent: CtaIntent) => {
      const written = {
        book: content.buttons?.bookCta,
        contact: content.buttons?.contactCta,
        learnMore: content.buttons?.learnMoreCta,
      }[intent];

      const fallback = {
        book: menu('bookNow'),
        contact: t('ctaGetInTouch'),
        learnMore: t('ctaLearnMore'),
      }[intent];

      return ctaFor(intent, { hasBookingSection: plan.booking, written, fallback });
    };

    /** The ask this page makes of a visitor: buy if there is anything to buy. */
    const primaryIntent: CtaIntent = services.length > 0 ? 'book' : 'contact';

    /*
     * The three buttons, resolved once each.
     *
     * The header and the closing block make the page's primary ask; the hero
     * reads on; the footer is the last chance to talk to a person, which is
     * the contact form whatever else the page is selling.
     */
    const headerCta = cta(primaryIntent);
    const heroCta = cta('learnMore');
    const closingCta = cta(plan.booking ? 'book' : primaryIntent);
    const footerCta = cta('contact');

    return [
      // Header block with navigation menu
      {
        page_id: pageId,
        block_type: 'header',
        position: 0,
        content: {
          logo_text: companyName,
          menu_items: [
            { label: menu('about'), anchor: '#about' },
            { label: menu('services'), anchor: '#services' },
            { label: menu('process'), anchor: '#process' },
            { label: menu('contact'), anchor: '#contact' },
          ],
          /*
           * Booking starts at the services list, not at a booking section.
           *
           * These pointed at `#booking`, which was a page-level widget this
           * page no longer installs — so every "book" button on a generated
           * site scrolled to nothing. `#services` is where the booking now
           * lives: each service carries its own button, opening the journey
           * that service actually has. A CTA that says "book" must land
           * somewhere a booking can start.
           */
          /*
           * ───────────────────────────────────────────────────────────────────
           * THE LABEL AND THE DESTINATION ARE DECIDED TOGETHER.
           *
           * The model wrote this button's words while the code hardcoded its
           * link, so the two could disagree — and did: a header reading
           * "Contact Us" pointing at `#services`. The words are the promise a
           * visitor acts on, and no amount of fixing the button's behaviour
           * helps while its text describes a different destination from its
           * href.
           *
           * So the destination is no longer decided apart from the words, for
           * the same reason the pricing section's heading is not: one field,
           * two authors, and the visible half was wrong. A business with
           * something to book goes to the services; a business without goes to
           * the form — and `ctaFor` writes the label that belongs to whichever
           * of those it is. The model still supplies the wording; what it no
           * longer does is name a button whose destination it cannot see.
           *
           * A header with no button at all was the previous answer for a
           * business with no services, which left those businesses — the ones
           * reaching clients by conversation rather than a catalogue — with no
           * call to action anywhere above the fold.
           */
          cta_button: headerCta,
          style: 'blur',
        },
      },

      // Hero block
      {
        page_id: pageId,
        block_type: 'hero',
        position: 1,
        content: {
          headline: content.hero.headline,
          subheadline: content.hero.subheadline,
          /*
           * The hero introduces the business, so its button reads on.
           *
           * It used to say "book a session" and anchor at `#booking` — a
           * section this page no longer installs — so the loudest button on the
           * site scrolled nowhere. Booking has two homes of its own: the header
           * button, present on every screen, and the closing call to action
           * after the reader knows what is on offer. Asking someone to book in
           * the first sentence, before the services are read, is the wrong
           * moment anyway.
           *
           * `learnMore` is therefore the intent, and the model writes its
           * words. It used to write them against `heroCta` — "the main button
           * under the headline" — with no way to know that button reads on
           * rather than books, so it answered with whatever the business most
           * wanted to say and the label stopped matching the destination.
           */
          cta_text: heroCta.text,
          cta_link: heroCta.link,
          /*
           * The hero photograph, and the reason it matters more than it looks.
           *
           * `HeroBlock` reads `split = layout === 'split' && Boolean(background_image)`,
           * so an absent picture does not merely leave a gap — it switches the
           * layout off. Warm and Bold both declare a split hero, and because
           * generation never set an image, every site either of them dressed
           * rendered the stacked hero instead of the design that was chosen.
           */
          ...(images.hero ? { background_image: images.hero, background_type: 'image' } : {}),
        },
      },

      /*
       * Facts.
       *
       * Emitted empty on purpose. `WebsiteBlockEnrichmentService` fills it from
       * the business's real client and booking counts, and `StatsSection`
       * renders nothing while it is empty — so a new business shows no section
       * and the same business shows one once it has something true to say.
       *
       * It was ordered by `proof_led` and `offer_led` and emitted by nothing, so
       * two of the five recipes have always named a section that could not
       * appear however many clients the business had.
       */
      /*
       * Stats: not built, because nothing can fill it.
       *
       * There is no `stats` key anywhere in the prompt — the model is never
       * asked — and this emitted `stats: []` regardless, so "Our Impact"
       * rendered as a heading over nothing on every site that ordered it.
       *
       * The numbers a stats block wants are claims: how many clients, how many
       * years, how many sessions. Inventing them is the testimonials problem
       * with figures instead of names. When the platform can count something
       * true — bookings taken, clients on the books — this can come back
       * reading from that.
       *
       * `wantsStats` stays in the signature so the recipes that order one are
       * not quietly rewritten; it simply no longer produces an empty section.
       */

      /*
       * Gallery.
       *
       * Only when there are pictures for it. `gallery_led` — photographers,
       * designers, beauty — has ordered a gallery since recipes existed, and
       * `buildBlocks` never emitted one, so for those three trades the recipe
       * has always ordered a section that does not exist. Emitting an EMPTY
       * gallery would be worse than that, which is why this is conditional: the
       * shape renders nothing without images, leaving a heading over a void.
       */
      ...(gallery.length
        ? [
            {
              page_id: pageId,
              block_type: 'gallery',
              position: 2,
              content: {
                title: t('gallery'),
                images: gallery.map(url => ({ url, alt: '' })),
              },
            },
          ]
        : []),

      // About block
      {
        page_id: pageId,
        block_type: 'about',
        position: 2,
        content: {
          title: heading('about', 'about'),
          // AboutBlock expects 'content' as a string, not 'paragraphs' array
          content: content.about.paragraphs.join('\n\n'),
          // Portrait: the about section pairs prose with a tall picture in every
          // archetype, and a wide crop in that column reads as a mistake.
          ...(images.about ? { image: images.about } : {}),
        },
      },

      // Services block
      {
        page_id: pageId,
        block_type: 'services',
        position: 3,
        content: {
          title: heading('services', 'services'),
          services: services.map(s => {
            const serviceData = content.serviceDescriptions[s.service_name];
            // Handle both old format (string) and new format (object with description and icon)
            const written = typeof serviceData === 'string'
              ? serviceData
              : serviceData?.description || '';
            // The owner's own words win.
            //
            // They know what they sell and the model is guessing from a name.
            // The AI copy is the fallback for a service nobody has described
            // yet — which is also why the description is now asked for after
            // onboarding: it is the source text for this section, not decoration.
            const description = s.description?.trim() || written;
            /*
             * `||`, not a branch. The AI is not asked for a service icon — only
             * for feature icons — so this was `undefined` on that path, and a
             * card with no icon renders no icon TILE at all. Next to cards that
             * have one, the row looks broken in a third way.
             */
            const icon =
              (typeof serviceData === 'object' ? serviceData?.icon : undefined) ||
              this.getDefaultIconForService(s.service_name);
            return {
              id: s.id,
              name: s.service_name,
              description,
              icon,
              duration: s.duration_minutes,
              durationMinutes: s.duration_minutes, // For ServicesBlock to show formatted duration
              priceRaw: s.price, // Raw price for booking modal
              price: s.price ? `${s.currency === 'ILS' ? '₪' : s.currency === 'EUR' ? '€' : '$'}${s.price}` : null,
              currency: s.currency,
              // The two facts that decide this service's journey, carried to
              // the public page so it can describe the journey the booking
              // widget will actually run rather than one page-wide story.
              is_scheduled: s.is_scheduled !== false,
              collection: s.collection ?? null,
            };
          }),
        },
      },

      // Process flow block
      {
        page_id: pageId,
        block_type: 'process',
        position: 4,
        content: {
          title: heading('process', 'process'),
          steps: content.processSteps,
          // Built from what the business actually sells, not from a default.
          //
          // This was always `scheduling, client_info, confirmation` for anyone
          // with services — so a shop selling only downloads got a page whose
          // process block described picking a time, and a business that asked
          // for an intake form never collected one, because `intake` was not in
          // the list this page's booking reads.
          //
          // The booking journey itself comes from the service now; what is left
          // here is what the page describes and whether an intake form is
          // collected, so both follow the same facts.
          /*
           * Built from what the business SELLS, which the interview answered
           * even when the catalogue was still drafts.
           *
           * This read `services.length` alone. On a real account that was zero
           * at the moment of generation — three services created five seconds
           * earlier, none activated for another ninety-seven — so the whole
           * journey collapsed to `['confirmation']` and the page described
           * nothing. `sells_scheduled: true` and `collection_method: 'invoice'`
           * were on the profile the entire time.
           *
           * Rows still refine it where there are any: a catalogue is a later
           * and more specific statement than the one-tap answer.
           */
          client_flow: facts?.sellsSomething || services.length > 0
            ? [
                ...(services.length
                  ? services.some(s => s.is_scheduled !== false) ? ['scheduling'] : []
                  : facts?.isScheduled ? ['scheduling'] : []),
                'client_info',
                ...(services.length
                  ? services.some(s => s.collection === 'online' && (s.price || 0) > 0) ? ['payment'] : []
                  : facts?.collects && facts.collects !== 'none' ? ['payment'] : []),
                ...(needsIntake || facts?.needsIntake ? ['intake'] : []),
                'confirmation',
              ]
            : ['confirmation'],
          services_only: !(facts?.sellsSomething || services.length > 0),
        },
      },

      /*
       * Testimonials: the SECTION is created, and it is left empty on purpose.
       *
       * ─────────────────────────────────────────────────────────────────────
       * Everything else on this page is written for the owner. This one cannot
       * be: a named endorsement is a claim only a real client can make, and
       * the previous fallback published "Amazing experience! Highly
       * recommended." — Sarah M. onto the site of a business that had never had
       * a client. Live testing showed the model still inventing three of them
       * when the prompt left the door open, which is why the prompt now closes
       * it explicitly.
       *
       * So the heading exists and the editor has somewhere to put real ones,
       * and nothing is generated into it. `content.testimonials` is read only
       * where the business supplied its own.
       * ─────────────────────────────────────────────────────────────────────
       */
      {
        page_id: pageId,
        block_type: 'testimonials',
        position: 5,
        content: {
          title: heading('testimonials', 'testimonials'),
          testimonials: plan.testimonials ? content.testimonials || [] : [],
        },
      },

      // FAQ block with AI-generated content
      {
        page_id: pageId,
        block_type: 'faq',
        position: 6,
        content: {
          title: heading('faq', 'faq'),
          questions: content.faq || [],
        },
      },

      // Booking widget block (if services exist)
      ...(plan.booking ? [{
        page_id: pageId,
        block_type: 'booking_widget',
        position: 7,
        content: {
          title: content.booking?.title || t('booking'),
          description: content.booking?.description || t('bookingDescription'),
        },
      }] : []),

      // Contact form block
      {
        page_id: pageId,
        block_type: 'contact_form',  // Must match block registry key
        position: 8,
        content: {
          title: content.contact?.title || t('contact'),
          description: content.contact?.description,
          fields: ['name', 'email', 'phone', 'message'],
        },
      },

      // CTA block
      {
        page_id: pageId,
        block_type: 'cta',
        position: 9,
        content: {
          // The closing call to action repeated the hero headline word for
          // word, so a visitor scrolling the whole page read the same sentence
          // twice.
          title: content.cta?.title || content.hero.headline,
          description: content.cta?.description || t('cta'),
          /*
           * THE BUTTON THIS WHOLE CHANGE IS ABOUT.
           *
           * The comment here used to claim the text and the destination were
           * "decided together". They were not. The coordination lived only on
           * the `||` FALLBACK branch — and the prompt asked the model for
           * `cta.buttonText`, so the fallback almost never ran. In the ordinary
           * case the label was the model's, the link was still `#services`, and
           * a closing button reading "Get in Touch" scrolled to the services
           * list. That is the reported bug, verbatim.
           *
           * Now there is no second expression to disagree with the first: the
           * intent decides both halves, and the model's words are the words
           * for that intent.
           */
          cta_text: closingCta.text,
          cta_link: closingCta.link,
        },
      },

      // Footer block
      {
        page_id: pageId,
        block_type: 'footer',
        position: 10,
        content: {
          company_name: companyName,
          tagline: content.metaDescription,
          copyright_year: new Date().getFullYear(),
          menu_items: [
            { label: menu('about'), anchor: '#about' },
            { label: menu('services'), anchor: '#services' },
            { label: menu('contact'), anchor: '#contact' },
          ],
          /*
           * The mark, and one last ask.
           *
           * The footer wore neither. It closed a page that had spent its whole
           * length persuading somebody with a copyright line — no way to act,
           * and no sign of whose site they had just read.
           *
           * Contact details, opening hours and the registered number are NOT
           * set here on purpose: they are resolved on every render from the
           * business profile, because hours baked in at generation go on
           * naming days the business stopped working months ago.
           */
          show_logo: true,
          cta_text: footerCta.text,
          cta_link: footerCta.link,
          show_powered_by: true,
        },
      },
    ];
  }

  /**
   * Generate URL-friendly subdomain from company name
   * Uses transliteration for non-Latin characters (Hebrew, Arabic, etc.)
   */
  private generateSubdomain(companyName: string): string {
    // Transliterate Hebrew characters to Latin
    const hebrewToLatin: Record<string, string> = {
      'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
      'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm',
      'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'p',
      'צ': 'ts', 'ץ': 'ts', 'ק': 'k', 'ר': 'r', 'ש': 'sh', 'ת': 't',
    };

    // Transliterate the company name
    let slug = companyName
      .split('')
      .map(char => hebrewToLatin[char] || char)
      .join('')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^a-z0-9\s-]/g, '')    // Remove remaining special characters
      .replace(/\s+/g, '-')             // Replace spaces with hyphens
      .replace(/-+/g, '-')              // Replace multiple hyphens with single
      .replace(/^-|-$/g, '')            // Remove leading/trailing hyphens
      .substring(0, 40);                // Limit length

    // If slug is empty after processing, use a fallback
    if (!slug) {
      slug = 'my-business';
    }

    // Add a short unique suffix (4 chars) to avoid collisions
    const uniqueSuffix = uuid().substring(0, 4);
    return `${slug}-${uniqueSuffix}`;
  }

  /**
   * Get fallback content if LLM fails
   * Uses available profile data to generate meaningful fallback content
   */
  /**
   * Nothing the plan asked for may reach the page empty.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `getFallbackContent` covers the whole response failing. This covers the
   * commoner case: a response that parsed, with one section missing from it.
   * The schema defaults those to `[]` — which is the right call for a schema
   * and the wrong thing to publish, because the block builder then writes a
   * heading over nothing and the site looks broken rather than thin.
   *
   * Written from facts the platform already holds, never invented:
   *
   *   · process steps come from the journey the interview described, which is
   *     the same sequence `client_flow` renders;
   *   · a service's description comes from its own name, length and price.
   *
   * Testimonials are NOT filled, here or anywhere. An absent endorsement is the
   * one gap that must stay a gap.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private fillPlannedGaps(
    content: WebsiteContent,
    plan: ReturnType<WebsiteGenerationService['planSections']>,
    facts: ReturnType<WebsiteGenerationService['businessFacts']>,
    services: any[],
    language: string
  ): WebsiteContent {
    const filled: WebsiteContent = { ...content };

    if (plan.process && !(content.processSteps?.length)) {
      const steps = this.journeySteps(facts, services, language);
      if (steps.length) {
        logger.info({ steps: steps.length }, 'Process steps were missing; written from the journey');
        filled.processSteps = steps as WebsiteContent['processSteps'];
      }
    }

    /*
     * A planned FAQ with nothing in it.
     *
     * Reported as "FAQ is missing content". The FAQ is written from
     * `brief.objections` — what the owner says actually stops people buying —
     * and on a measured account that field came back `[]`, so the model had no
     * question to answer and returned none. The section was planned, so the
     * heading shipped over empty space.
     *
     * Filled from the answers the owner DID give: whether clients book a time,
     * how the money arrives, whether there is a form first. Those are facts,
     * not invention, and they are the three things a first-time visitor
     * actually asks. `journeySteps` fills the process block the same way and
     * for the same reason.
     */
    if (plan.faq && !(content.faq?.length)) {
      const asked = this.faqFromFacts(facts, services, language);
      if (asked.length) filled.faq = asked as WebsiteContent['faq'];
    }

    if (plan.services && services.length && !Object.keys(content.serviceDescriptions ?? {}).length) {
      const written: Record<string, { description: string; icon: string }> = {};
      for (const service of services) {
        written[service.service_name] = {
          description: this.serviceSentence(service, language),
          icon: this.getDefaultIconForService(service.service_name),
        };
      }
      logger.info({ services: services.length }, 'Service descriptions were missing; written from the catalogue');
      filled.serviceDescriptions = written as WebsiteContent['serviceDescriptions'];
    }

    return filled;
  }

  /**
   * The journey in words — the same steps `client_flow` draws, as prose.
   *
   * Deliberately plain. This runs only when the model returned nothing, and a
   * true, dull sentence about booking a time beats a heading over a void.
   */
  /**
   * The questions a first-time visitor asks, answered from what we were told.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Only ever a FALLBACK: the FAQ the model writes from `brief.objections` is
   * better, because it answers what this owner says actually stops people. This
   * runs when that came back empty, which on a measured account it did.
   *
   * Every answer here is read off an answer the owner gave: do clients book a
   * time, how does the money arrive, is there a form first. Nothing is claimed
   * about price, speed, results or qualifications, because we do not know any
   * of those and a published FAQ is exactly where an invented one would be
   * believed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private faqFromFacts(
    facts: ReturnType<WebsiteGenerationService['businessFacts']>,
    services: any[],
    language: string
  ): Array<{ question: string; answer: string }> {
    const copy = {
      en: {
        book: ['How do I book?', 'Pick a time that suits you on this page, and you will get a confirmation straight away.'],
        enquire: ['How do I get started?', 'Send a message through this page and you will hear back with the next step.'],
        payOnline: ['How do I pay?', 'You pay by card when you book, so nothing is left to sort out afterwards.'],
        payInvoice: ['How do I pay?', 'An invoice follows, with everything agreed in writing.'],
        free: ['Does it cost anything?', 'No. There is nothing to pay.'],
        intake: ['Do I need to fill anything in first?', 'Yes, a short form before we meet, so the first session is ready for you.'],
      },
      he: {
        book: ['איך קובעים?', 'בוחרים בדף הזה זמן שמתאים לכם, ומקבלים אישור מיד.'],
        enquire: ['איך מתחילים?', 'שולחים הודעה מהדף הזה ומקבלים חזרה את הצעד הבא.'],
        payOnline: ['איך משלמים?', 'משלמים בכרטיס בזמן ההזמנה, כך שלא נשאר מה להסדיר אחר כך.'],
        payInvoice: ['איך משלמים?', 'נשלחת חשבונית, עם כל מה שסוכם בכתב.'],
        free: ['האם זה עולה כסף?', 'לא. אין מה לשלם.'],
        intake: ['צריך למלא משהו לפני?', 'כן, טופס קצר לפני המפגש, כדי שהמפגש הראשון יהיה מוכן בשבילכם.'],
      },
      es: {
        book: ['¿Cómo reservo?', 'Elige en esta página la hora que te convenga y recibirás la confirmación al momento.'],
        enquire: ['¿Cómo empiezo?', 'Envía un mensaje desde esta página y te responderemos con el siguiente paso.'],
        payOnline: ['¿Cómo pago?', 'Pagas con tarjeta al reservar, así no queda nada pendiente.'],
        payInvoice: ['¿Cómo pago?', 'Recibirás una factura con todo lo acordado por escrito.'],
        free: ['¿Tiene algún costo?', 'No. No hay nada que pagar.'],
        intake: ['¿Tengo que rellenar algo antes?', 'Sí, un formulario breve antes de vernos, para que la primera sesión esté lista.'],
      },
    }[language === 'he' ? 'he' : language === 'es' ? 'es' : 'en'];

    const scheduled = services.length
      ? services.some(s => s.is_scheduled !== false)
      : facts?.isScheduled;
    const collects = facts?.collects;

    const asked: Array<{ question: string; answer: string }> = [];

    asked.push(scheduled
      ? { question: copy.book[0], answer: copy.book[1] }
      : { question: copy.enquire[0], answer: copy.enquire[1] });

    /*
     * `facts.collects` is `collection_method`, whose values are
     * `card_online | invoice | in_person | mixed | none`. Checking it for
     * 'online' matches nothing — written that way once here and caught only
     * because the field was read before it was trusted.
     *
     * `null` means they never said, and that is not a question to answer: a
     * guess about how to pay is the one FAQ answer a visitor would act on.
     */
    if (collects === 'none') {
      asked.push({ question: copy.free[0], answer: copy.free[1] });
    } else if (collects === 'card_online' || collects === 'mixed') {
      asked.push({ question: copy.payOnline[0], answer: copy.payOnline[1] });
    } else if (collects === 'invoice' || collects === 'in_person') {
      asked.push({ question: copy.payInvoice[0], answer: copy.payInvoice[1] });
    }

    if (facts?.needsIntake) asked.push({ question: copy.intake[0], answer: copy.intake[1] });

    return asked;
  }

  private journeySteps(
    facts: ReturnType<WebsiteGenerationService['businessFacts']>,
    services: any[],
    language: string
  ): Array<{ title: string; description: string; icon: string }> {
    const copy = {
      en: {
        book: ['Get in touch', 'Choose a time that suits you and tell us what you are after.'],
        details: ['Tell us about yourself', 'A few details so the first session is ready for you.'],
        pay: ['Settle up', 'An invoice follows, with everything agreed in writing.'],
        done: ['You are booked', 'A confirmation arrives, and we see you then.'],
      },
      he: {
        book: ['יוצרים קשר', 'בוחרים זמן שמתאים לכם ומספרים מה אתם מחפשים.'],
        details: ['מספרים קצת על עצמכם', 'כמה פרטים כדי שהמפגש הראשון יהיה מוכן בשבילכם.'],
        pay: ['מסדירים תשלום', 'נשלחת חשבונית, עם כל מה שסוכם בכתב.'],
        done: ['נקבע!', 'מגיע אישור, ונתראה.'],
      },
      es: {
        book: ['Ponte en contacto', 'Elige la hora que te convenga y cuéntanos qué buscas.'],
        details: ['Cuéntanos sobre ti', 'Unos datos para que la primera sesión esté lista.'],
        pay: ['Haz el pago', 'Recibirás una factura con todo lo acordado por escrito.'],
        done: ['Reserva confirmada', 'Te llega la confirmación y nos vemos.'],
      },
    }[language === 'he' ? 'he' : language === 'es' ? 'es' : 'en'];

    const scheduled = services.length
      ? services.some(s => s.is_scheduled !== false)
      : facts?.isScheduled;
    const collects = facts?.collects && facts.collects !== 'none';

    const steps: Array<{ title: string; description: string; icon: string }> = [];

    if (scheduled) steps.push({ title: copy.book[0], description: copy.book[1], icon: 'calendar' });
    steps.push({ title: copy.details[0], description: copy.details[1], icon: 'user' });
    if (collects) steps.push({ title: copy.pay[0], description: copy.pay[1], icon: 'clipboard' });
    steps.push({ title: copy.done[0], description: copy.done[1], icon: 'check' });

    return steps;
  }

  /** One service, described from what it actually is. */
  private serviceSentence(service: any, language: string): string {
    const minutes = service.duration_minutes;
    const price = service.price;

    const parts = {
      en: {
        length: minutes ? `${minutes} minutes` : null,
        quoted: 'Priced for each client',
        free: 'Free',
      },
      he: {
        length: minutes ? `${minutes} דקות` : null,
        quoted: 'המחיר נקבע מול כל לקוח',
        free: 'חינם',
      },
      es: {
        length: minutes ? `${minutes} minutos` : null,
        quoted: 'Precio acordado con cada cliente',
        free: 'Gratis',
      },
    }[language === 'he' ? 'he' : language === 'es' ? 'es' : 'en'];

    const money =
      price === null || price === undefined
        ? parts.quoted
        : price > 0
          ? `${service.currency ?? ''} ${price}`.trim()
          : parts.free;

    return [service.service_name, parts.length, money].filter(Boolean).join(' · ');
  }

  private getFallbackContent(profile: any, services: any[]): WebsiteContent {
    const companyName = profile.company_name || 'Business';
    const vertical = profile.vertical || 'business';
    const subVertical = profile.sub_vertical || null;
    const description = profile.description || null;
    const language = profile.language || 'en';

    // Get display vertical name
    const displayVertical = subVertical || vertical;
    const capitalizedVertical = displayVertical.charAt(0).toUpperCase() + displayVertical.slice(1).replace(/_/g, ' ');

    // Generate about paragraphs using description if available
    const aboutParagraphs = description
      ? [
          description,
          `At ${companyName}, we are committed to delivering excellent results and personalized attention to each client.`,
          services.length > 0
            ? 'Book your session today and experience the difference.'
            : 'Contact us today to learn more about how we can help you.',
        ]
      : [
          `${companyName} provides professional ${capitalizedVertical.toLowerCase()} services with a focus on quality and client satisfaction.`,
          'We are committed to delivering excellent results and personalized attention to each client.',
          services.length > 0
            ? 'Book your session today and experience the difference.'
            : 'Contact us today to get started.',
        ];

    // Generate service descriptions
    const serviceDescriptions = services.reduce((acc, s) => {
      acc[s.service_name] = `Professional ${s.service_name.toLowerCase()} service${s.duration_minutes ? ` (${s.duration_minutes} minutes)` : ''}.`;
      return acc;
    }, {} as Record<string, string>);

    // Localized process step titles
    const processStepTitles: Record<string, { step1: string; step2: string; step3: string }> = {
      en: {
        step1: services.length > 0 ? 'Book Your Session' : 'Get in Touch',
        step2: 'Prepare',
        step3: 'Get Started',
      },
      he: {
        step1: services.length > 0 ? 'קבעו פגישה' : 'צרו קשר',
        step2: 'התכוננו',
        step3: 'התחילו',
      },
      es: {
        step1: services.length > 0 ? 'Reserva tu Sesión' : 'Contáctanos',
        step2: 'Prepárate',
        step3: 'Comienza',
      },
    };

    const steps = processStepTitles[language] || processStepTitles.en;

    // Localized testimonials
    // Localized FAQ
    const faqTemplates: Record<string, Array<{ question: string; answer: string }>> = {
      en: [
        { question: 'How do I book a session?', answer: 'Simply click on the "Book Now" button and choose a time that works for you.' },
        { question: 'What should I expect?', answer: 'We\'ll guide you through every step of the process. Just bring yourself and an open mind!' },
        { question: 'What is your cancellation policy?', answer: 'We ask for 24 hours notice for cancellations to allow us to offer the slot to others.' },
      ],
      he: [
        { question: 'איך אני קובע/ת פגישה?', answer: 'פשוט לחצו על "הזמן עכשיו" ובחרו זמן שמתאים לכם.' },
        { question: 'מה לצפות?', answer: 'נלווה אתכם בכל שלב בתהליך. פשוט תגיעו עם מוטיבציה וראש פתוח!' },
        { question: 'מהי מדיניות הביטולים?', answer: 'אנחנו מבקשים הודעה של 24 שעות מראש לביטולים כדי שנוכל להציע את המקום לאחרים.' },
      ],
      es: [
        { question: '¿Cómo reservo una sesión?', answer: 'Simplemente haga clic en "Reservar" y elija un horario que le convenga.' },
        { question: '¿Qué debo esperar?', answer: 'Te guiaremos en cada paso del proceso. ¡Solo trae una mente abierta!' },
        { question: '¿Cuál es la política de cancelación?', answer: 'Pedimos 24 horas de aviso para cancelaciones.' },
      ],
    };

    return {
      title: `${companyName} - ${capitalizedVertical} Services`,
      metaDescription: description
        ? description.substring(0, 160)
        : `${companyName} provides professional ${capitalizedVertical.toLowerCase()} services. Book your session today.`,
      keywords: [vertical, subVertical, 'professional services', 'booking', companyName.toLowerCase()].filter(Boolean) as string[],
      hero: {
        headline: `Welcome to ${companyName}`,
        subheadline: description
          ? description.substring(0, 100)
          : `Professional ${capitalizedVertical.toLowerCase()} services tailored to your needs`,
      },
      about: {
        paragraphs: aboutParagraphs,
      },
      serviceDescriptions,
      processSteps: [
        {
          title: steps.step1,
          description: services.length > 0 ? 'Choose a time that works for you' : 'Reach out to discuss your needs',
          icon: services.length > 0 ? 'calendar' : 'mail',
        },
        {
          title: steps.step2,
          description: 'We\'ll send you all the details',
          icon: 'clipboard',
        },
        {
          title: steps.step3,
          description: 'Meet at your scheduled time',
          icon: 'check',
        },
      ],
      // No invented reviews. A business with none gets no section at all
      // (see planSections); shipping "Sarah M." under its name is a claim its
      // owner never made.
      testimonials: [],
      faq: faqTemplates[language] || faqTemplates.en,
      // No theme. Fallback CONTENT is still content; the look is the
      // archetype's whether the copy came from the model or from here.
    };
  }
}
