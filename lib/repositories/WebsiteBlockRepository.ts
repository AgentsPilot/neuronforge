/**
 * Website Block Repository
 * Handles all database operations for website blocks
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'WebsiteBlockRepository' });

// ==================== TYPES ====================

export type BlockType =
  | 'header'
  | 'hero'
  | 'services'
  | 'cta'
  | 'testimonials'
  | 'pricing'
  | 'faq'
  | 'about'
  | 'features'
  | 'stats'
  | 'booking_widget'
  | 'payment_button'
  | 'team'
  | 'process'
  | 'gallery'
  | 'newsletter'
  | 'logo_cloud'
  | 'video'
  | 'contact_form'
  | 'intake_form';

export interface WebsiteBlock {
  id: string;
  page_id: string;
  block_type: BlockType;
  position: number;
  content: BlockContent;
  styles: BlockStyles | null;
  enabled: boolean;
  capability_config: CapabilityConfig;
  created_at: string;
}

export interface BlockContent {
  // Hero
  headline?: string;
  subheadline?: string;
  cta_text?: string;
  cta_link?: string;
  background_image?: string;
  background_video?: string;

  // Services/Pricing
  title?: string;
  subtitle?: string;
  services?: Array<{
    name: string;
    description: string;
    price?: string;
    duration?: string;
    features?: string[];
  }>;

  // Testimonials
  testimonials?: Array<{
    name: string;
    role?: string;
    company?: string;
    content: string;
    image?: string;
    rating?: number;
  }>;

  // FAQ
  faqs?: Array<{
    question: string;
    answer: string;
  }>;

  // About
  about_text?: string;
  about_image?: string;
  credentials?: string[];
  specialties?: string[];

  // Features
  features?: Array<{
    title: string;
    description: string;
    icon?: string;
  }>;

  // Stats
  stats?: Array<{
    value: string;
    label: string;
    icon?: string;
  }>;

  // Team
  team_members?: Array<{
    name: string;
    role: string;
    bio?: string;
    image?: string;
    social?: Record<string, string>;
  }>;

  // Process
  steps?: Array<{
    number?: number;
    title: string;
    description: string;
    icon?: string;
  }>;

  // Gallery
  images?: Array<{
    url: string;
    alt?: string;
    caption?: string;
  }>;

  // Video
  video_url?: string;
  video_thumbnail?: string;

  // Contact/Intake Form
  form_fields?: Array<{
    name: string;
    type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'radio';
    label: string;
    required?: boolean;
    options?: string[];
    placeholder?: string;
  }>;
  submit_text?: string;
  success_message?: string;

  // Newsletter
  newsletter_title?: string;
  newsletter_subtitle?: string;
  newsletter_cta?: string;

  // Logo Cloud
  logos?: Array<{
    url: string;
    alt: string;
    link?: string;
  }>;

  // Generic
  [key: string]: unknown;
}

export interface BlockStyles {
  alignment?: 'left' | 'center' | 'right';
  padding?: string;
  backgroundColor?: string;
  backgroundGradient?: string;
  textColor?: string;
  containerWidth?: 'narrow' | 'normal' | 'wide' | 'full';
  variant?: string; // Block-specific variant
  animation?: 'none' | 'fade' | 'slide' | 'scale';
}

export interface CapabilityConfig {
  service_ids?: string[];
  price_id?: string;
  booking_calendar?: boolean;
  intake_form_id?: string;
  redirect_url?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface WebsiteBlockInsert {
  page_id: string;
  block_type: BlockType;
  position: number;
  content: BlockContent;
  styles?: BlockStyles | null;
  enabled?: boolean;
  capability_config?: CapabilityConfig;
}

export interface WebsiteBlockUpdate {
  block_type?: BlockType;
  position?: number;
  content?: BlockContent;
  styles?: BlockStyles | null;
  enabled?: boolean;
  capability_config?: CapabilityConfig;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== REPOSITORY CLASS ====================

export class WebsiteBlockRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==================== READ OPERATIONS ====================

  async findById(id: string): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const { data, error } = await this.supabase
        .from('website_blocks')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to find block by id');
      return { data: null, error: error as Error };
    }
  }

  async findByPageId(pageId: string, enabledOnly = false): Promise<RepositoryResult<WebsiteBlock[]>> {
    try {
      let query = this.supabase
        .from('website_blocks')
        .select('*')
        .eq('page_id', pageId)
        .order('position', { ascending: true });

      if (enabledOnly) {
        query = query.eq('enabled', true);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, pageId }, 'Failed to find blocks by page');
      return { data: null, error: error as Error };
    }
  }

  async findByType(pageId: string, blockType: BlockType): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const { data, error } = await this.supabase
        .from('website_blocks')
        .select('*')
        .eq('page_id', pageId)
        .eq('block_type', blockType)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, pageId, blockType }, 'Failed to find block by type');
      return { data: null, error: error as Error };
    }
  }

  // ==================== WRITE OPERATIONS ====================

  async create(block: WebsiteBlockInsert): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const { data, error } = await this.supabase
        .from('website_blocks')
        .insert({
          ...block,
          enabled: block.enabled ?? true,
          capability_config: block.capability_config ?? {}
        })
        .select()
        .single();

      if (error) throw error;
      logger.info({ blockId: data.id, pageId: block.page_id, type: block.block_type }, 'Created website block');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, block }, 'Failed to create block');
      return { data: null, error: error as Error };
    }
  }

  async bulkCreate(blocks: WebsiteBlockInsert[]): Promise<RepositoryResult<WebsiteBlock[]>> {
    try {
      const blocksWithDefaults = blocks.map(block => ({
        ...block,
        enabled: block.enabled ?? true,
        capability_config: block.capability_config ?? {}
      }));

      const { data, error } = await this.supabase
        .from('website_blocks')
        .insert(blocksWithDefaults)
        .select();

      if (error) throw error;
      logger.info({ count: data.length, pageId: blocks[0]?.page_id }, 'Created website blocks');
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, count: blocks.length }, 'Failed to bulk create blocks');
      return { data: null, error: error as Error };
    }
  }

  async update(id: string, updates: WebsiteBlockUpdate): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const { data, error } = await this.supabase
        .from('website_blocks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      logger.info({ blockId: id }, 'Updated website block');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, updates }, 'Failed to update block');
      return { data: null, error: error as Error };
    }
  }

  async updateContent(id: string, content: Partial<BlockContent>): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      // Fetch existing content first
      const existing = await this.findById(id);
      if (existing.error || !existing.data) {
        throw existing.error || new Error('Block not found');
      }

      const mergedContent = { ...existing.data.content, ...content };

      const { data, error } = await this.supabase
        .from('website_blocks')
        .update({ content: mergedContent })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      logger.info({ blockId: id }, 'Updated block content');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update block content');
      return { data: null, error: error as Error };
    }
  }

  async toggleEnabled(id: string, enabled: boolean): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const { data, error } = await this.supabase
        .from('website_blocks')
        .update({ enabled })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      logger.info({ blockId: id, enabled }, 'Toggled block enabled state');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, enabled }, 'Failed to toggle block');
      return { data: null, error: error as Error };
    }
  }

  async reorder(pageId: string, blockIds: string[]): Promise<RepositoryResult<WebsiteBlock[]>> {
    try {
      // Due to unique constraint on (page_id, position), we use a transaction-like approach:
      // 1. First clear all positions by setting them to large negative values
      // 2. Then set the final positions

      // Step 1: Set ALL blocks for this page to temporary negative positions
      // Use a single update to set all to position = -9999 - current_position to ensure uniqueness
      const { error: clearError } = await this.supabase.rpc('clear_block_positions', {
        p_page_id: pageId
      });

      // If RPC doesn't exist, fall back to sequential updates
      if (clearError) {
        logger.warn({ err: clearError }, 'RPC not available, using sequential clear');

        // Get all blocks first
        const allBlocksResult = await this.findByPageId(pageId);
        if (allBlocksResult.error || !allBlocksResult.data) {
          throw allBlocksResult.error || new Error('Failed to fetch blocks');
        }

        // Set each to a unique negative position
        for (let i = 0; i < allBlocksResult.data.length; i++) {
          const { error } = await this.supabase
            .from('website_blocks')
            .update({ position: -(i + 10000) })
            .eq('id', allBlocksResult.data[i].id)
            .eq('page_id', pageId);

          if (error) {
            logger.error({ err: error, blockId: allBlocksResult.data[i].id }, 'Failed to clear position');
            throw error;
          }
        }
      }

      // Step 2: Set the provided blocks to their new positions
      for (let i = 0; i < blockIds.length; i++) {
        const { error } = await this.supabase
          .from('website_blocks')
          .update({ position: i })
          .eq('id', blockIds[i])
          .eq('page_id', pageId);

        if (error) {
          logger.error({ err: error, blockId: blockIds[i], position: i }, 'Failed to set position');
          throw error;
        }
      }

      // Step 3: Handle any blocks that weren't in the provided list (set them to end)
      const allBlocksResult = await this.findByPageId(pageId);
      if (allBlocksResult.data) {
        const providedSet = new Set(blockIds);
        const missingBlocks = allBlocksResult.data.filter(b => !providedSet.has(b.id) && b.position < 0);

        let nextPosition = blockIds.length;
        for (const block of missingBlocks) {
          const { error } = await this.supabase
            .from('website_blocks')
            .update({ position: nextPosition++ })
            .eq('id', block.id)
            .eq('page_id', pageId);

          if (error) {
            logger.error({ err: error, blockId: block.id, position: nextPosition - 1 }, 'Failed to set missing block position');
            throw error;
          }
        }
      }

      logger.info({ pageId, count: blockIds.length }, 'Reordered blocks');

      // Fetch and return updated blocks
      return await this.findByPageId(pageId);
    } catch (error) {
      logger.error({ err: error, pageId }, 'Failed to reorder blocks');
      return { data: null, error: error as Error };
    }
  }

  async moveBlock(pageId: string, blockId: string, direction: 'up' | 'down'): Promise<RepositoryResult<WebsiteBlock[]>> {
    try {
      // Get all blocks for the page
      const blocksResult = await this.findByPageId(pageId);
      if (blocksResult.error || !blocksResult.data) {
        throw blocksResult.error || new Error('No blocks found');
      }

      const blocks = blocksResult.data;
      const currentIndex = blocks.findIndex(b => b.id === blockId);

      if (currentIndex === -1) {
        throw new Error('Block not found');
      }

      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (newIndex < 0 || newIndex >= blocks.length) {
        // Can't move further, return current state
        return blocksResult;
      }

      // Swap positions
      const newOrder = [...blocks];
      [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];

      return await this.reorder(pageId, newOrder.map(b => b.id));
    } catch (error) {
      logger.error({ err: error, pageId, blockId, direction }, 'Failed to move block');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string): Promise<RepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('website_blocks')
        .delete()
        .eq('id', id);

      if (error) throw error;
      logger.info({ blockId: id }, 'Deleted website block');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete block');
      return { data: null, error: error as Error };
    }
  }

  async deleteByPageId(pageId: string): Promise<RepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('website_blocks')
        .delete()
        .eq('page_id', pageId);

      if (error) throw error;
      logger.info({ pageId }, 'Deleted all blocks for page');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, pageId }, 'Failed to delete blocks by page');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CAPABILITY OPERATIONS ====================

  async updateCapabilityConfig(id: string, config: Partial<CapabilityConfig>): Promise<RepositoryResult<WebsiteBlock>> {
    try {
      const existing = await this.findById(id);
      if (existing.error || !existing.data) {
        throw existing.error || new Error('Block not found');
      }

      const mergedConfig = { ...existing.data.capability_config, ...config };

      const { data, error } = await this.supabase
        .from('website_blocks')
        .update({ capability_config: mergedConfig })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      logger.info({ blockId: id }, 'Updated block capability config');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to update capability config');
      return { data: null, error: error as Error };
    }
  }

  async findByCapability(pageId: string, capabilityType: 'booking' | 'payment' | 'contact' | 'intake'): Promise<RepositoryResult<WebsiteBlock[]>> {
    try {
      const blockTypes: BlockType[] = {
        booking: ['booking_widget'],
        payment: ['payment_button', 'pricing'],
        contact: ['contact_form'],
        intake: ['intake_form']
      }[capabilityType] as BlockType[];

      const { data, error } = await this.supabase
        .from('website_blocks')
        .select('*')
        .eq('page_id', pageId)
        .in('block_type', blockTypes);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, pageId, capabilityType }, 'Failed to find blocks by capability');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
let instance: WebsiteBlockRepository | null = null;

export function getWebsiteBlockRepository(supabase: SupabaseClient): WebsiteBlockRepository {
  if (!instance) {
    instance = new WebsiteBlockRepository(supabase);
  }
  return instance;
}
