/**
 * Editing the words in one section of a website.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CONTENT IS MERGED, NEVER REPLACED
 *
 * A section's `content` is a JSON object whose shape depends on what kind of
 * section it is:
 *
 *   faq          { title, questions: [ … ] }
 *   about        { title, content, about_text }
 *   hero         { headline, subheadline, ctaText, ctaLink }
 *   testimonials { title, testimonials: [ … ] }
 *
 * "Change the FAQ heading" is a statement about ONE key. Writing the object
 * wholesale would take the questions with it — the section would render empty
 * and the words would be gone with no undo. So the stored object is read, the
 * named keys are replaced inside it, and everything else is carried through
 * untouched.
 *
 * WHICH KEY HOLDS THE HEADING is read off the section itself rather than from a
 * table of section types. A hero calls it `headline`, an about calls it `title`,
 * and a type nobody has thought of yet will call it whichever of those it
 * already uses. Deriving it from the row means a new section type works on the
 * day it is added, and a hardcoded map cannot drift away from the renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/WebsiteSectionService
 */

import type { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'WebsiteSectionService' });
const auditTrail = AuditTrailService.getInstance();

/**
 * Keys that hold a heading, most specific first.
 *
 * Order is the preference when a section carries more than one: `title` is the
 * section's own name, `headline` is the banner line a hero leads with.
 */
const HEADING_KEYS = ['title', 'headline'] as const;

/**
 * Keys that hold body text, most specific first.
 *
 * `about_text` before `content` because an about section carries both and the
 * former is the paragraph a person means; `content` is sometimes the whole
 * block's payload.
 */
const TEXT_KEYS = [
  'about_text',
  'content',
  'description',
  'subheadline',
  'subtitle',
  'tagline',
] as const;

export class SectionNotEditableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectionNotEditableError';
  }
}

export interface SetSectionContentParams {
  blockId: string;
  userId: string;
  heading?: unknown;
  text?: unknown;
  request?: NextRequest;
}

export interface SectionOutcome {
  blockId: string;
  blockType: string;
  changed: Record<string, string>;
}

/** The key this section already uses for a heading or a body, or the default. */
function keyFor(
  content: Record<string, unknown>,
  candidates: readonly string[],
  fallback: string
): string {
  return candidates.find((key) => typeof content[key] === 'string') ?? fallback;
}

/**
 * Change the heading and/or the body text of one section.
 *
 * Ownership is verified through the section's PAGE, because `website_blocks`
 * carries no `user_id` of its own — the page is the only thing that knows whose
 * section this is.
 */
export async function setSectionContent(
  params: SetSectionContentParams
): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { blockId, userId, request } = params;

  const heading = typeof params.heading === 'string' ? params.heading.trim() : undefined;
  const text = typeof params.text === 'string' ? params.text.trim() : undefined;

  if (!heading && !text) {
    return {
      data: null,
      error: new SectionNotEditableError(
        'Say what the section should read — a heading, some text, or both.'
      ),
    };
  }

  // The join is the tenant boundary. An inner join on the page means a section
  // whose page belongs to somebody else simply is not returned, rather than
  // being found and then rejected.
  const { data: block, error: readError } = await supabaseServer
    .from('website_blocks')
    .select('id, block_type, content, page_id, website_pages!inner(user_id)')
    .eq('id', blockId)
    .eq('website_pages.user_id', userId)
    .maybeSingle();

  if (readError) return { data: null, error: readError as Error };
  if (!block) {
    return { data: null, error: new Error('Section not found') };
  }

  const content = { ...((block.content as Record<string, unknown>) ?? {}) };
  const changed: Record<string, string> = {};

  if (heading) {
    const key = keyFor(content, HEADING_KEYS, 'title');
    content[key] = heading;
    changed[key] = heading;
  }

  if (text) {
    const key = keyFor(content, TEXT_KEYS, 'content');
    content[key] = text;
    changed[key] = text;
  }

  const { error: writeError } = await supabaseServer
    .from('website_blocks')
    .update({ content })
    .eq('id', blockId);

  if (writeError) return { data: null, error: writeError as Error };

  auditTrail
    .log({
      action: 'WEBSITE_SECTION_UPDATED',
      userId,
      entityType: 'website_page',
      entityId: String(block.page_id),
      resourceName: String(block.block_type),
      details: { blockId, changed: Object.keys(changed) },
      request,
    })
    .catch((err) => logger.warn({ err, blockId }, 'Audit failed (non-blocking)'));

  logger.info(
    { userId, blockId, blockType: block.block_type, keys: Object.keys(changed) },
    'Website section updated'
  );

  return {
    data: { blockId, blockType: String(block.block_type), changed },
    error: null,
  };
}

/**
 * Take a section off the page, or put it back.
 *
 * `enabled` rather than deleting the row: hiding is reversible and the words
 * survive, which is what someone means by "take the FAQ off for now". A section
 * removed outright would take its content with it and there would be nothing to
 * turn back on.
 */
export async function setSectionEnabled(params: {
  blockId: string;
  userId: string;
  enabled: boolean;
  request?: NextRequest;
}): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { blockId, userId, enabled, request } = params;

  // Same inner join, same reason: a section whose page is someone else's is
  // never returned in the first place.
  const { data: block, error: readError } = await supabaseServer
    .from('website_blocks')
    .select('id, block_type, page_id, enabled, website_pages!inner(user_id)')
    .eq('id', blockId)
    .eq('website_pages.user_id', userId)
    .maybeSingle();

  if (readError) return { data: null, error: readError as Error };
  if (!block) return { data: null, error: new Error('Section not found') };

  const { error: writeError } = await supabaseServer
    .from('website_blocks')
    .update({ enabled })
    .eq('id', blockId);

  if (writeError) return { data: null, error: writeError as Error };

  auditTrail
    .log({
      action: enabled ? 'WEBSITE_SECTION_SHOWN' : 'WEBSITE_SECTION_HIDDEN',
      userId,
      entityType: 'website_page',
      entityId: String(block.page_id),
      resourceName: String(block.block_type),
      details: { blockId, enabled },
      request,
    })
    .catch((err) => logger.warn({ err, blockId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, blockId, enabled }, 'Website section visibility changed');

  return {
    data: {
      blockId,
      blockType: String(block.block_type),
      changed: { enabled: String(enabled) },
    },
    error: null,
  };
}

/**
 * Ownership check shared by every section write.
 *
 * `WebsiteBlockRepository` takes no user id — its methods act on a block id
 * alone. That is safe from the UI, which reached the id through a page it had
 * already loaded, and NOT safe from a chat plan, where the id is whatever the
 * planner produced. So every write here resolves the block through its page
 * first, and the inner join means another tenant's section is never returned.
 */
async function ownedPageId(blockId: string, userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from('website_blocks')
    .select('page_id, website_pages!inner(user_id)')
    .eq('id', blockId)
    .eq('website_pages.user_id', userId)
    .maybeSingle();

  return data ? String(data.page_id) : null;
}

/** Is this page the caller's? Needed when adding, where there is no block yet. */
async function ownsPage(pageId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('website_pages')
    .select('id')
    .eq('id', pageId)
    .eq('user_id', userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Add a section to a page.
 *
 * Appended at the end rather than inserted at a position: "add a testimonials
 * section" says nothing about where, and pushing it into the middle would
 * silently move everything below it. Reordering is its own action.
 */
export async function addSection(params: {
  pageId: string;
  userId: string;
  blockType: string;
  heading?: unknown;
  text?: unknown;
  request?: NextRequest;
}): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { pageId, userId, blockType, request } = params;

  if (!(await ownsPage(pageId, userId))) {
    return { data: null, error: new Error('Page not found') };
  }

  const { data: existing } = await supabaseServer
    .from('website_blocks')
    .select('position')
    .eq('page_id', pageId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = ((existing?.position as number) ?? -1) + 1;

  const content: Record<string, unknown> = {};
  if (typeof params.heading === 'string' && params.heading.trim()) {
    content.title = params.heading.trim();
  }
  if (typeof params.text === 'string' && params.text.trim()) {
    content.content = params.text.trim();
  }

  const { data: created, error } = await supabaseServer
    .from('website_blocks')
    .insert({ page_id: pageId, block_type: blockType, position, content, enabled: true })
    .select('id, block_type')
    .single();

  if (error) return { data: null, error: error as Error };

  auditTrail
    .log({
      action: 'WEBSITE_SECTION_ADDED',
      userId,
      entityType: 'website_page',
      entityId: pageId,
      resourceName: blockType,
      details: { blockId: created.id, position },
      request,
    })
    .catch((err) => logger.warn({ err, pageId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, pageId, blockType, position }, 'Website section added');

  return {
    data: {
      blockId: String(created.id),
      blockType: String(created.block_type),
      changed: { position: String(position) },
    },
    error: null,
  };
}

/**
 * Remove a section and its words for good.
 *
 * `hide` is the reversible option and the one to prefer; this is for a section
 * that should not exist. The content goes with it, which is why the action is
 * declared at delete risk and always confirmed.
 */
export async function deleteSection(params: {
  blockId: string;
  userId: string;
  request?: NextRequest;
}): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { blockId, userId, request } = params;

  const pageId = await ownedPageId(blockId, userId);
  if (!pageId) return { data: null, error: new Error('Section not found') };

  const { data: block } = await supabaseServer
    .from('website_blocks')
    .select('block_type')
    .eq('id', blockId)
    .maybeSingle();

  const { error } = await supabaseServer.from('website_blocks').delete().eq('id', blockId);
  if (error) return { data: null, error: error as Error };

  auditTrail
    .log({
      action: 'WEBSITE_SECTION_DELETED',
      userId,
      entityType: 'website_page',
      entityId: pageId,
      resourceName: String(block?.block_type ?? blockId),
      severity: 'warning',
      details: { blockId },
      request,
    })
    .catch((err) => logger.warn({ err, blockId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, blockId, pageId }, 'Website section deleted');

  return {
    data: { blockId, blockType: String(block?.block_type ?? ''), changed: { deleted: 'true' } },
    error: null,
  };
}

/**
 * Move one section up or down the page.
 *
 * Relative movement rather than a target index, because that is how people say
 * it — "move the testimonials above the FAQ" is a swap with a neighbour, and an
 * absolute position would need the user to know the current numbering.
 */
export async function moveSection(params: {
  blockId: string;
  userId: string;
  direction: 'up' | 'down';
  request?: NextRequest;
}): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { blockId, userId, direction, request } = params;

  const pageId = await ownedPageId(blockId, userId);
  if (!pageId) return { data: null, error: new Error('Section not found') };

  const { data: siblings } = await supabaseServer
    .from('website_blocks')
    .select('id, block_type, position')
    .eq('page_id', pageId)
    .order('position', { ascending: true });

  const ordered = siblings ?? [];
  const index = ordered.findIndex((b) => String(b.id) === blockId);
  const swapWith = direction === 'up' ? index - 1 : index + 1;

  if (index === -1 || swapWith < 0 || swapWith >= ordered.length) {
    return {
      data: null,
      error: new Error(
        direction === 'up'
          ? 'That section is already at the top of the page.'
          : 'That section is already at the bottom of the page.'
      ),
    };
  }

  // Swap the two positions. Writing both explicitly rather than renumbering the
  // whole page keeps every other section's position untouched.
  const a = ordered[index];
  const b = ordered[swapWith];

  const first = await supabaseServer
    .from('website_blocks')
    .update({ position: b.position })
    .eq('id', a.id);
  if (first.error) return { data: null, error: first.error as Error };

  const second = await supabaseServer
    .from('website_blocks')
    .update({ position: a.position })
    .eq('id', b.id);
  if (second.error) return { data: null, error: second.error as Error };

  auditTrail
    .log({
      action: 'WEBSITE_SECTION_MOVED',
      userId,
      entityType: 'website_page',
      entityId: pageId,
      resourceName: String(a.block_type),
      details: { blockId, direction, from: a.position, to: b.position },
      request,
    })
    .catch((err) => logger.warn({ err, blockId }, 'Audit failed (non-blocking)'));

  logger.info({ userId, blockId, direction }, 'Website section moved');

  return {
    data: {
      blockId,
      blockType: String(a.block_type),
      changed: { position: String(b.position) },
    },
    error: null,
  };
}

/**
 * Rewrite one field of a section with AI.
 *
 * ONE named field, never the whole section. The generator returns a string, so
 * asking it to "redo the section" would mean writing that string over an object
 * and taking an FAQ's questions with it — the same merge rule as `setContent`,
 * for the same reason.
 *
 * The existing content goes to the generator as context, so a rewrite reads as a
 * revision of what is there rather than something unrelated appearing on the
 * page.
 */
export async function regenerateSectionField(params: {
  blockId: string;
  userId: string;
  field: string;
  language?: string;
  request?: NextRequest;
}): Promise<{ data: SectionOutcome | null; error: Error | null }> {
  const { blockId, userId, field, request } = params;

  const { data: block } = await supabaseServer
    .from('website_blocks')
    .select('id, block_type, content, page_id, website_pages!inner(user_id)')
    .eq('id', blockId)
    .eq('website_pages.user_id', userId)
    .maybeSingle();

  if (!block) return { data: null, error: new Error('Section not found') };

  const content = { ...((block.content as Record<string, unknown>) ?? {}) };

  // Refuse a field the section does not have. Writing one in would add a key
  // the renderer ignores, and report success for a change nobody will ever see.
  if (!(field in content)) {
    return {
      data: null,
      error: new SectionNotEditableError(
        `A ${block.block_type} section has no '${field}' to rewrite. ` +
          `It has: ${Object.keys(content).join(', ') || 'nothing yet'}.`
      ),
    };
  }

  try {
    const { WebsiteAIContentService } = await import('@/lib/services/WebsiteAIContentService');
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('company_name, vertical, description')
      .eq('user_id', userId)
      .maybeSingle();

    const service = new WebsiteAIContentService();
    const generated = await service.regenerateField({
      field,
      blockType: String(block.block_type),
      language: (params.language as 'en' | 'es' | 'he') ?? 'en',
      context: {
        businessName: profile?.company_name ?? undefined,
        vertical: profile?.vertical ?? undefined,
        description: profile?.description ?? undefined,
        existingContent: content,
      },
    } as Parameters<typeof service.regenerateField>[0]);

    if (typeof generated !== 'string' || !generated.trim()) {
      return { data: null, error: new Error('The rewrite came back empty; nothing was changed.') };
    }

    content[field] = generated.trim();

    const { error: writeError } = await supabaseServer
      .from('website_blocks')
      .update({ content })
      .eq('id', blockId);

    if (writeError) return { data: null, error: writeError as Error };

    auditTrail
      .log({
        action: 'WEBSITE_SECTION_UPDATED',
        userId,
        entityType: 'website_page',
        entityId: String(block.page_id),
        resourceName: String(block.block_type),
        details: { blockId, regenerated: field },
        request,
      })
      .catch((err) => logger.warn({ err, blockId }, 'Audit failed (non-blocking)'));

    logger.info({ userId, blockId, field }, 'Website section field regenerated');

    return {
      data: {
        blockId,
        blockType: String(block.block_type),
        changed: { [field]: generated.trim() },
      },
      error: null,
    };
  } catch (error) {
    logger.error({ err: error, blockId, field }, 'Failed to regenerate section field');
    return { data: null, error: new Error('The rewrite could not be generated.') };
  }
}
