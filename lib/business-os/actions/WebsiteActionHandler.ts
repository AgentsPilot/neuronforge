/**
 * Website Action Handler
 * Handles website-related intents from the Control Center chat
 *
 * Supported actions:
 * - toggle_block: Enable/disable a website section
 * - update_block_content: Update content within a block
 * - reorder_blocks: Move blocks up/down
 * - publish/unpublish: Publish or unpublish the website
 * - create_page: Create a new page from template
 * - regenerate_content: AI rewrite of block content
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { WebsitePageRepository } from '@/lib/repositories/WebsitePageRepository';
import { WebsiteBlockRepository } from '@/lib/repositories/WebsiteBlockRepository';

const logger = createLogger({ module: 'WebsiteActionHandler' });

// ==================== INTENT TYPES ====================

export type WebsiteIntent =
  | { action: 'toggle_block'; block_type: string; enabled: boolean }
  | { action: 'update_block_content'; block_type: string; field: string; value: string }
  | { action: 'reorder_blocks'; block_type: string; position: 'up' | 'down' | number }
  | { action: 'publish' }
  | { action: 'unpublish' }
  | { action: 'create_page'; template_id?: string; title: string }
  | { action: 'regenerate_content'; block_type?: string };

export interface ActionResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ==================== INTENT PATTERNS ====================

interface IntentPattern {
  patterns: RegExp[];
  extractIntent: (match: RegExpMatchArray, text: string) => WebsiteIntent | null;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Toggle block: "remove/hide/disable the testimonials section"
  {
    patterns: [
      /(?:remove|hide|disable|turn off)\s+(?:the\s+)?(\w+)\s+(?:section|block)/i,
      /(?:don't show|don't display)\s+(?:the\s+)?(\w+)\s+(?:section|block)?/i
    ],
    extractIntent: (match) => ({
      action: 'toggle_block',
      block_type: normalizeBlockType(match[1]),
      enabled: false
    })
  },
  // Enable block: "add/show/enable the testimonials section"
  {
    patterns: [
      /(?:add|show|enable|turn on|display)\s+(?:the\s+)?(\w+)\s+(?:section|block)/i
    ],
    extractIntent: (match) => ({
      action: 'toggle_block',
      block_type: normalizeBlockType(match[1]),
      enabled: true
    })
  },
  // Update content: "change my headline to '...'"
  {
    patterns: [
      /(?:change|update|edit|set)\s+(?:my\s+|the\s+)?(?:(\w+)\s+)?(?:to|as)\s+['""](.+)['""]?/i,
      /(?:change|update|edit)\s+(?:the\s+)?(\w+)\s+(?:text|content)\s+(?:to|as)\s+['""](.+)['""]?/i
    ],
    extractIntent: (match) => {
      const fieldMap: Record<string, { block_type: string; field: string }> = {
        headline: { block_type: 'hero', field: 'headline' },
        title: { block_type: 'hero', field: 'headline' },
        subheadline: { block_type: 'hero', field: 'subheadline' },
        subtitle: { block_type: 'hero', field: 'subheadline' },
        cta: { block_type: 'hero', field: 'cta_text' },
        button: { block_type: 'hero', field: 'cta_text' }
      };

      const fieldName = match[1]?.toLowerCase() || 'headline';
      const mapping = fieldMap[fieldName] || { block_type: 'hero', field: 'headline' };

      return {
        action: 'update_block_content',
        block_type: mapping.block_type,
        field: mapping.field,
        value: match[2]
      };
    }
  },
  // Reorder blocks: "move the FAQ above/before the contact form"
  {
    patterns: [
      /move\s+(?:the\s+)?(\w+)\s+(?:section\s+)?(?:up|before|above)/i
    ],
    extractIntent: (match) => ({
      action: 'reorder_blocks',
      block_type: normalizeBlockType(match[1]),
      position: 'up'
    })
  },
  {
    patterns: [
      /move\s+(?:the\s+)?(\w+)\s+(?:section\s+)?(?:down|after|below)/i
    ],
    extractIntent: (match) => ({
      action: 'reorder_blocks',
      block_type: normalizeBlockType(match[1]),
      position: 'down'
    })
  },
  // Publish: "publish my website" / "go live"
  {
    patterns: [
      /(?:publish|launch|make live|go live)/i
    ],
    extractIntent: () => ({ action: 'publish' })
  },
  // Unpublish: "unpublish my website" / "take offline"
  {
    patterns: [
      /(?:unpublish|take offline|take down)/i
    ],
    extractIntent: () => ({ action: 'unpublish' })
  },
  // Regenerate content: "rewrite/regenerate the services section"
  {
    patterns: [
      /(?:rewrite|regenerate|improve|refresh)\s+(?:the\s+)?(\w+)\s+(?:section|block|content)?/i
    ],
    extractIntent: (match) => ({
      action: 'regenerate_content',
      block_type: normalizeBlockType(match[1])
    })
  },
  // Create page: "create a landing page for my new course"
  {
    patterns: [
      /(?:create|make|build)\s+(?:a\s+)?(?:new\s+)?(?:landing\s+)?page\s+(?:for\s+)?(?:my\s+)?(.+)/i
    ],
    extractIntent: (match) => ({
      action: 'create_page',
      title: match[1].trim()
    })
  }
];

// Block type normalization
function normalizeBlockType(input: string): string {
  const typeMap: Record<string, string> = {
    hero: 'hero',
    header: 'hero',
    services: 'services',
    service: 'services',
    cta: 'cta',
    calltoaction: 'cta',
    testimonials: 'testimonials',
    testimonial: 'testimonials',
    reviews: 'testimonials',
    contact: 'contact_form',
    contactform: 'contact_form',
    pricing: 'pricing',
    prices: 'pricing',
    faq: 'faq',
    faqs: 'faq',
    about: 'about',
    features: 'features',
    feature: 'features',
    stats: 'stats',
    statistics: 'stats',
    booking: 'booking_widget',
    calendar: 'booking_widget',
    payment: 'payment_button',
    team: 'team',
    process: 'process',
    steps: 'process',
    gallery: 'gallery',
    photos: 'gallery',
    images: 'gallery',
    newsletter: 'newsletter',
    video: 'video'
  };

  return typeMap[input.toLowerCase().replace(/[_\s-]/g, '')] || input.toLowerCase();
}

// ==================== ACTION HANDLER CLASS ====================

export class WebsiteActionHandler {
  private pageRepo: WebsitePageRepository;
  private blockRepo: WebsiteBlockRepository;

  constructor(supabase: SupabaseClient) {
    this.pageRepo = new WebsitePageRepository(supabase);
    this.blockRepo = new WebsiteBlockRepository(supabase);
  }

  /**
   * Parse natural language text into a website intent
   */
  parseIntent(text: string): WebsiteIntent | null {
    for (const { patterns, extractIntent } of INTENT_PATTERNS) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const intent = extractIntent(match, text);
          if (intent) {
            logger.debug({ text, intent }, 'Parsed website intent');
            return intent;
          }
        }
      }
    }

    logger.debug({ text }, 'No website intent matched');
    return null;
  }

  /**
   * Execute a website intent
   */
  async handleIntent(intent: WebsiteIntent, userId: string): Promise<ActionResult> {
    logger.info({ intent, userId }, 'Handling website intent');

    try {
      switch (intent.action) {
        case 'toggle_block':
          return await this.toggleBlock(intent.block_type, intent.enabled, userId);

        case 'update_block_content':
          return await this.updateBlockContent(intent.block_type, intent.field, intent.value, userId);

        case 'reorder_blocks':
          return await this.reorderBlocks(intent.block_type, intent.position, userId);

        case 'publish':
          return await this.publishSite(userId);

        case 'unpublish':
          return await this.unpublishSite(userId);

        case 'create_page':
          return await this.createPage(intent.title, intent.template_id, userId);

        case 'regenerate_content':
          return await this.regenerateContent(intent.block_type, userId);

        default:
          return {
            success: false,
            message: 'Unknown website action'
          };
      }
    } catch (error) {
      logger.error({ err: error, intent }, 'Failed to handle website intent');
      return {
        success: false,
        message: 'An error occurred while processing your request'
      };
    }
  }

  // ==================== ACTION IMPLEMENTATIONS ====================

  private async toggleBlock(blockType: string, enabled: boolean, userId: string): Promise<ActionResult> {
    // Get the user's homepage
    const pageResult = await this.pageRepo.getHomepage(userId);
    if (pageResult.error || !pageResult.data) {
      return { success: false, message: 'You don\'t have a website yet. Would you like to create one?' };
    }

    // Get blocks for the page
    const blocksResult = await this.blockRepo.findByPageId(pageResult.data.id);
    if (blocksResult.error) {
      return { success: false, message: 'Failed to load website sections' };
    }

    // Find the block by type
    const block = blocksResult.data?.find(b => b.block_type === blockType);
    if (!block) {
      return {
        success: false,
        message: `I couldn't find a ${blockType} section on your website.`
      };
    }

    // Toggle the block
    const result = await this.blockRepo.toggleEnabled(block.id, enabled);
    if (result.error) {
      return { success: false, message: `Failed to ${enabled ? 'show' : 'hide'} the ${blockType} section` };
    }

    const action = enabled ? 'added' : 'removed';
    return {
      success: true,
      message: `Done! I've ${action} the ${blockType} section from your website.`,
      data: { block: result.data }
    };
  }

  private async updateBlockContent(
    blockType: string,
    field: string,
    value: string,
    userId: string
  ): Promise<ActionResult> {
    // Get the user's homepage
    const pageResult = await this.pageRepo.getHomepage(userId);
    if (pageResult.error || !pageResult.data) {
      return { success: false, message: 'You don\'t have a website yet.' };
    }

    // Get blocks for the page
    const blocksResult = await this.blockRepo.findByPageId(pageResult.data.id);
    if (blocksResult.error || !blocksResult.data) {
      return { success: false, message: 'Failed to load website sections' };
    }

    // Find the block by type
    const block = blocksResult.data.find(b => b.block_type === blockType);
    if (!block) {
      return {
        success: false,
        message: `I couldn't find a ${blockType} section on your website.`
      };
    }

    // Update the content
    const updatedContent = { ...block.content, [field]: value };
    const result = await this.blockRepo.updateContent(block.id, updatedContent);
    if (result.error) {
      return { success: false, message: 'Failed to update the content' };
    }

    return {
      success: true,
      message: `Done! Your ${field} is now "${value}". Want me to publish this change?`,
      data: { block: result.data }
    };
  }

  private async reorderBlocks(
    blockType: string,
    position: 'up' | 'down' | number,
    userId: string
  ): Promise<ActionResult> {
    // Get the user's homepage
    const pageResult = await this.pageRepo.getHomepage(userId);
    if (pageResult.error || !pageResult.data) {
      return { success: false, message: 'You don\'t have a website yet.' };
    }

    // Get blocks for the page
    const blocksResult = await this.blockRepo.findByPageId(pageResult.data.id);
    if (blocksResult.error || !blocksResult.data) {
      return { success: false, message: 'Failed to load website sections' };
    }

    // Find the block by type
    const block = blocksResult.data.find(b => b.block_type === blockType);
    if (!block) {
      return {
        success: false,
        message: `I couldn't find a ${blockType} section on your website.`
      };
    }

    // Calculate new position
    const currentPosition = block.position;
    const direction = position === 'up' ? -1 : 1;
    const newPosition = typeof position === 'number'
      ? position
      : Math.max(0, currentPosition + direction);

    const result = await this.blockRepo.moveBlock(block.id, newPosition);
    if (result.error) {
      return { success: false, message: 'Failed to reorder sections' };
    }

    return {
      success: true,
      message: `Done! I've moved the ${blockType} section ${position === 'up' ? 'up' : 'down'}.`,
      data: { block: result.data }
    };
  }

  private async publishSite(userId: string): Promise<ActionResult> {
    const pageResult = await this.pageRepo.getHomepage(userId);
    if (pageResult.error || !pageResult.data) {
      return { success: false, message: 'You don\'t have a website to publish yet.' };
    }

    if (!pageResult.data.subdomain) {
      return {
        success: false,
        message: 'Your website needs a subdomain before publishing. Go to Website settings to set one up.'
      };
    }

    const result = await this.pageRepo.publish(pageResult.data.id, userId);
    if (result.error) {
      return { success: false, message: 'Failed to publish your website' };
    }

    return {
      success: true,
      message: `Your website is now live at ${pageResult.data.subdomain}.agentpilot.io!`,
      data: { page: result.data }
    };
  }

  private async unpublishSite(userId: string): Promise<ActionResult> {
    const pageResult = await this.pageRepo.getHomepage(userId);
    if (pageResult.error || !pageResult.data) {
      return { success: false, message: 'You don\'t have a website.' };
    }

    const result = await this.pageRepo.unpublish(pageResult.data.id, userId);
    if (result.error) {
      return { success: false, message: 'Failed to unpublish your website' };
    }

    return {
      success: true,
      message: 'Your website is now unpublished. Visitors will see a "Coming Soon" page.',
      data: { page: result.data }
    };
  }

  private async createPage(title: string, templateId: string | undefined, userId: string): Promise<ActionResult> {
    // TODO: Implement full page creation with AI content generation
    // For now, return a helpful message
    return {
      success: false,
      message: `To create a new "${title}" page, go to Website settings and click "Add Page". I can help you design the content once it's created!`
    };
  }

  private async regenerateContent(blockType: string | undefined, userId: string): Promise<ActionResult> {
    // TODO: Implement AI content regeneration using WebsiteAutoBuildService
    return {
      success: false,
      message: blockType
        ? `I can rewrite your ${blockType} section. This feature is coming soon!`
        : 'I can help rewrite your website content. This feature is coming soon!'
    };
  }
}

// ==================== RESPONSE TEMPLATES ====================

export const CHAT_RESPONSE_TEMPLATES = {
  block_disabled: (blockType: string) =>
    `Done! I've removed the ${blockType} section from your website.`,

  block_enabled: (blockType: string) =>
    `Done! I've added the ${blockType} section to your website.`,

  content_updated: (field: string, value: string) =>
    `Your ${field} is now "${value}". Want me to publish this change?`,

  blocks_reordered: (blockType: string, direction: string) =>
    `Done! I've moved the ${blockType} section ${direction}.`,

  published: (subdomain: string) =>
    `Your website is now live at ${subdomain}.agentpilot.io!`,

  unpublished: () =>
    `Your website is now unpublished. Visitors will see a "Coming Soon" page.`,

  page_created: (title: string, subdomain: string) =>
    `I've created a new "${title}" landing page with booking and payment integrated. View it at ${subdomain}.agentpilot.io/${title.toLowerCase().replace(/\s+/g, '-')}`,

  no_website: () =>
    `You don't have a website yet. Would you like me to create one based on your business profile?`,

  needs_subdomain: () =>
    `Your website needs a subdomain before publishing. Go to Website settings to set one up.`
};
