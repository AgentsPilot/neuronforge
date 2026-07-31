/**
 * Website Page Repository
 * Handles all database operations for website pages
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'WebsitePageRepository' });

// ==================== TYPES ====================

export type PageStatus = 'draft' | 'live' | 'archived';
export type PageType = 'homepage' | 'landing' | 'about' | 'services' | 'blog_post';

export type WebsiteLanguage = 'en' | 'es' | 'he';

export interface WebsitePage {
  id: string;
  user_id: string;
  page_type: PageType;
  slug: string;
  title: string;
  meta_description: string | null;
  seo_keywords: string[];
  published: boolean;
  published_at: string | null;
  template_id: string | null;
  theme: PageTheme | null;
  subdomain: string | null;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  status: PageStatus;
  last_published_at: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  website_language: WebsiteLanguage;
  created_at: string;
  updated_at: string;
}

export interface PageTheme {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  borderRadius: string;
  spacing: 'compact' | 'normal' | 'spacious';
}

export interface WebsitePageInsert {
  user_id: string;
  page_type: PageType;
  slug: string;
  title: string;
  meta_description?: string | null;
  seo_keywords?: string[];
  template_id?: string | null;
  theme?: PageTheme | null;
  subdomain?: string | null;
  status?: PageStatus;
  favicon_url?: string | null;
  og_image_url?: string | null;
  website_language?: WebsiteLanguage;
}

export interface WebsitePageUpdate {
  page_type?: PageType;
  slug?: string;
  title?: string;
  meta_description?: string | null;
  seo_keywords?: string[];
  theme?: PageTheme | null;
  subdomain?: string | null;
  custom_domain?: string | null;
  status?: PageStatus;
  favicon_url?: string | null;
  og_image_url?: string | null;
  website_language?: WebsiteLanguage;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== REPOSITORY CLASS ====================

export class WebsitePageRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==================== READ OPERATIONS ====================

  async findById(id: string, userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to find page by id');
      return { data: null, error: error as Error };
    }
  }

  async findBySubdomain(subdomain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('subdomain', subdomain)
        .eq('status', 'live')
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, subdomain }, 'Failed to find page by subdomain');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find page by subdomain regardless of status (for analytics tracking)
   */
  async findBySubdomainAny(subdomain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('subdomain', subdomain)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, subdomain }, 'Failed to find page by subdomain (any status)');
      return { data: null, error: error as Error };
    }
  }

  async findByCustomDomain(domain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('custom_domain', domain)
        .eq('custom_domain_verified', true)
        .eq('status', 'live')
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, domain }, 'Failed to find page by custom domain');
      return { data: null, error: error as Error };
    }
  }

  async listByUser(userId: string): Promise<RepositoryResult<WebsitePage[]>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'archived')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list pages by user');
      return { data: null, error: error as Error };
    }
  }

  async getHomepage(userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('user_id', userId)
        .eq('page_type', 'homepage')
        .neq('status', 'archived')
        .single();

      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get homepage');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all landing pages for a user
   */
  async getLandingPages(userId: string): Promise<RepositoryResult<WebsitePage[]>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('user_id', userId)
        .eq('page_type', 'landing')
        .neq('status', 'archived')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get landing pages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a page by type (homepage, landing, etc.)
   */
  async findByType(userId: string, pageType: PageType): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('user_id', userId)
        .eq('page_type', pageType)
        .neq('status', 'archived')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, pageType }, 'Failed to find page by type');
      return { data: null, error: error as Error };
    }
  }

  async checkSubdomainAvailable(subdomain: string): Promise<RepositoryResult<boolean>> {
    try {
      const { data, error } = await this.supabase
        .rpc('check_subdomain_available', { subdomain_to_check: subdomain });

      if (error) throw error;
      return { data: data as boolean, error: null };
    } catch (error) {
      logger.error({ err: error, subdomain }, 'Failed to check subdomain availability');
      return { data: null, error: error as Error };
    }
  }

  async generateSubdomain(businessName: string): Promise<RepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .rpc('generate_subdomain', { business_name: businessName });

      if (error) throw error;
      return { data: data as string, error: null };
    } catch (error) {
      logger.error({ err: error, businessName }, 'Failed to generate subdomain');
      return { data: null, error: error as Error };
    }
  }

  // ==================== WRITE OPERATIONS ====================

  async create(page: WebsitePageInsert): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .insert(page)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: data.id, userId: page.user_id }, 'Created website page');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, page }, 'Failed to create page');
      return { data: null, error: error as Error };
    }
  }

  async update(id: string, userId: string, updates: WebsitePageUpdate): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Updated website page');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, updates }, 'Failed to update page');
      return { data: null, error: error as Error };
    }
  }

  async publish(id: string, userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update({
          status: 'live',
          published: true,
          published_at: new Date().toISOString(),
          last_published_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Published website page');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to publish page');
      return { data: null, error: error as Error };
    }
  }

  async unpublish(id: string, userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update({
          status: 'draft',
          published: false
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Unpublished website page');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to unpublish page');
      return { data: null, error: error as Error };
    }
  }

  async archive(id: string, userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update({
          status: 'archived',
          published: false
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Archived website page');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to archive page');
      return { data: null, error: error as Error };
    }
  }

  async delete(id: string, userId: string): Promise<RepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('website_pages')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Deleted website page');
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to delete page');
      return { data: null, error: error as Error };
    }
  }

  // ==================== DOMAIN OPERATIONS ====================

  async setSubdomain(id: string, userId: string, subdomain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      // Check availability first
      const available = await this.checkSubdomainAvailable(subdomain);
      if (!available.data) {
        throw new Error('Subdomain is not available');
      }

      const { data, error } = await this.supabase
        .from('website_pages')
        .update({ subdomain })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId, subdomain }, 'Set subdomain');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, subdomain }, 'Failed to set subdomain');
      return { data: null, error: error as Error };
    }
  }

  async setCustomDomain(id: string, userId: string, domain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update({
          custom_domain: domain,
          custom_domain_verified: false
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId, domain }, 'Set custom domain');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, domain }, 'Failed to set custom domain');
      return { data: null, error: error as Error };
    }
  }

  async verifyCustomDomain(id: string, userId: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .update({ custom_domain_verified: true })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId }, 'Verified custom domain');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to verify custom domain');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
let instance: WebsitePageRepository | null = null;

export function getWebsitePageRepository(supabase: SupabaseClient): WebsitePageRepository {
  if (!instance) {
    instance = new WebsitePageRepository(supabase);
  }
  return instance;
}
