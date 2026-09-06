/**
 * Turning a template's building block into a row.
 *
 * Lifted out of `app/api/website/pages/route.ts` unchanged, because the page
 * CAPABILITY has to build exactly the blocks the API builds. A second
 * conversion would be a second answer to "what does a new homepage contain",
 * and the two would drift — the services-block rule below is precisely the kind
 * of detail that gets left out of a copy.
 *
 * @module lib/website-builder/blockInsert
 */

import type { WebsiteBlockInsert } from '@/lib/repositories/WebsiteBlockRepository';
import type { BuildingBlock } from '@/lib/website-builder/building-blocks';
import { translateBlockContent } from '@/lib/i18n/website-block-translations';
import type { Locale } from '@/lib/i18n/config';

export function convertTemplateBlockToInsert(
  block: BuildingBlock,
  pageId: string,
  position: number,
  locale: Locale = 'en'
): WebsiteBlockInsert {
  const rawContent = block.content as Record<string, unknown>;

  // Translate content based on page language
  const content = translateBlockContent(rawContent, locale);

  // For services block, strip mockup services - real services come from Scheduling
  if (block.block_type === 'services') {
    const { services, ...rest } = content;
    return {
      page_id: pageId,
      block_type: block.block_type as WebsiteBlockInsert['block_type'],
      content: rest as WebsiteBlockInsert['content'],
      styles: (block.styles || {}) as WebsiteBlockInsert['styles'],
      position,
      enabled: true
    };
  }

  // For other blocks, keep translated template content as defaults
  return {
    page_id: pageId,
    block_type: block.block_type as WebsiteBlockInsert['block_type'],
    content: content as WebsiteBlockInsert['content'],
    styles: (block.styles || {}) as WebsiteBlockInsert['styles'],
    position,
    enabled: true
  };
}
