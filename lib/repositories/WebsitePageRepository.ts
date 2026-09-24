/**
 * Website Page Repository
 * Handles all database operations for website pages
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import type { PageTheme } from '@/lib/website-builder/pageTheme';
import { publicSiteHost, platformOrigin } from '@/lib/utils/origins';
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
  /**
   * When AI last wrote this page's content.
   *
   * NULL means never — the page holds the static scaffold that page creation
   * installs, and writing it is safe. Non-null means regenerating would delete
   * every block and replace copy the business may have edited since, so it has
   * to be asked for rather than done on the way past.
   */
  content_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Re-exported from the canonical definition — see `lib/website-builder/pageTheme`. */
export type { PageTheme };

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
  /* `custom_domain` is not updatable — see the note where its methods were. */
  status?: PageStatus;
  favicon_url?: string | null;
  og_image_url?: string | null;
  website_language?: WebsiteLanguage;
  /**
   * The template this page is styled from.
   *
   * Declared on `WebsitePageInsert` but not here, while `apply-template` wrote
   * it on every call — the one update that route exists to make. It reached the
   * database because the column is real and PostgREST does not check
   * TypeScript, but every caller was told the field did not exist.
   */
  template_id?: string | null;
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

  /**
   * Landing pages, from a set of ids, that this user owns and has not archived.
   *
   * Used when working out what a service deletion would break. Archived pages
   * are excluded — they are already not served, so offering to take one down
   * is noise.
   */
  async findLandingPagesByIds(
    pageIds: string[],
    userId: string
  ): Promise<RepositoryResult<WebsitePage[]>> {
    try {
      if (!pageIds.length) return { data: [], error: null };

      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .in('id', pageIds)
        .eq('user_id', userId)
        .eq('page_type', 'landing')
        .neq('status', 'archived');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find landing pages by ids');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Take pages out of public view without destroying them.
   *
   * `status` is the gate the public renderer actually reads (`findBySubdomain`
   * filters `status = 'live'`), so this is what stops a page being served. The
   * `published` boolean on the same table is read nowhere and is left alone
   * rather than half-maintained — see the delete flow in
   * `lib/services/ServiceReferenceService.ts`.
   */
  async unpublishMany(pageIds: string[], userId: string): Promise<RepositoryResult<number>> {
    try {
      if (!pageIds.length) return { data: 0, error: null };

      const { error } = await this.supabase
        .from('website_pages')
        .update({ status: 'draft' })
        .in('id', pageIds)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId, count: pageIds.length }, 'Unpublished landing pages');
      return { data: pageIds.length, error: null };
    } catch (error) {
      logger.error({ err: error, userId, pageIds }, 'Failed to unpublish landing pages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Destroy these pages for good.
   *
   * For the one case where keeping them is worse than losing them: a landing
   * page is GENERATED for a single service — its headline, its copy, its
   * objections and its closing section are all written about that one thing —
   * so when the service is deleted the page is not a page missing a product,
   * it is an article about something that no longer exists. Unpublishing it
   * would leave the owner a draft they can never usefully republish, and a
   * growing list of them.
   *
   * A service moved to DRAFT is the opposite case and must NOT come here: that
   * is temporary, the copy is still true, and `unpublishMany` is what it wants.
   *
   * Blocks go with the page through `website_blocks.page_id` — declared
   * `ON DELETE CASCADE`, so they are not deleted here.
   */
  async deleteMany(pageIds: string[], userId: string): Promise<RepositoryResult<number>> {
    try {
      if (!pageIds.length) return { data: 0, error: null };

      const { error } = await this.supabase
        .from('website_pages')
        .delete()
        .in('id', pageIds)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ userId, count: pageIds.length }, 'Deleted landing pages with their service');
      return { data: pageIds.length, error: null };
    } catch (error) {
      logger.error({ err: error, userId, pageIds }, 'Failed to delete landing pages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The page served at this address.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT `.single()`
   *
   * It was, and `.single()` ERRORS when it matches more than one row. A
   * business is meant to have one live page per subdomain, but nothing enforces
   * that — a live landing page sharing the subdomain is enough — and the error
   * was caught, returned as a failure, and read by the public route as "no page
   * found". So a second live page did not shadow the homepage: it took the
   * whole site down to a Coming Soon screen, for the address the owner had
   * already given to clients.
   *
   * The homepage wins where there is one, and the oldest page otherwise, so the
   * answer is stable rather than whatever the database happened to return
   * first. A site that is merely misconfigured now serves something.
   */
  async findBySubdomain(subdomain: string): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('subdomain', subdomain)
        .eq('status', 'live')
        .order('page_type', { ascending: true })   // 'homepage' before 'landing'
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) {
        return { data: null, error: new Error('No live page for this subdomain') };
      }
      return { data: data[0], error: null };
    } catch (error) {
      logger.error({ err: error, subdomain }, 'Failed to find page by subdomain');
      return { data: null, error: error as Error };
    }
  }

  /**
   * A live landing page at this address and slug.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY LANDING PAGES NEEDED THEIR OWN LOOKUP
   *
   * There was exactly one public route — `/site/[subdomain]` — and landing
   * pages share the business's single subdomain with its homepage. So a landing
   * page was only ever reachable if it happened to be the one row
   * `findBySubdomain` returned, which meant a business could publish a landing
   * page OR a website, never both. Publishing the second one did not shadow the
   * first; it made the address ambiguous.
   *
   * The `slug` column has been on every row since the table was created and
   * nothing read it publicly. This is that read.
   */
  async findLiveLandingBySlug(
    subdomain: string,
    slug: string
  ): Promise<RepositoryResult<WebsitePage>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('*')
        .eq('subdomain', subdomain)
        .eq('slug', slug)
        .eq('page_type', 'landing')
        .eq('status', 'live')
        // Same reason as `findBySubdomain`: `.single()` errors on a duplicate
        // and the caller reads that as "no page", taking down an address the
        // owner has already shared.
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) {
        return { data: null, error: new Error('No live landing page at that slug') };
      }
      return { data: data[0], error: null };
    } catch (error) {
      logger.error({ err: error, subdomain, slug }, 'Failed to find a landing page by slug');
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
      // First get the current page to modify the slug
      const { data: currentPage, error: fetchError } = await this.supabase
        .from('website_pages')
        .select('slug')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;

      // Append timestamp to slug to free up the URL for new pages
      const archivedSlug = `${currentPage.slug}-archived-${Date.now()}`;

      const { data, error } = await this.supabase
        .from('website_pages')
        .update({
          status: 'archived',
          published: false,
          slug: archivedSlug
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ pageId: id, userId, originalSlug: currentPage.slug, archivedSlug }, 'Archived website page');
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

  /*
   * `setCustomDomain` and `verifyCustomDomain` were removed here.
   *
   * Businesses do not bring their own web address — every public page is served
   * at `{prefix}.agentspilot.ai` — so both were unreachable: neither had a
   * single caller anywhere in the codebase, and `website_pages.custom_domain` is
   * null on every row. The columns stay in the database, dormant, in case
   * custom domains ever become something we sell.
   */

  /**
   * The public hostnames this user's pages are served on.
   *
   * Used to detect whether a connected analytics property already measures a
   * page AgentPilot tracks itself — which decides whether the two collectors'
   * visit counts are duplicates or genuinely additive.
   */
  async getHostedHosts(userId: string): Promise<RepositoryResult<string[]>> {
    try {
      const { data, error } = await this.supabase
        .from('website_pages')
        .select('subdomain')
        .eq('user_id', userId)
        .not('subdomain', 'is', null);

      if (error) throw error;

      /*
       * `custom_domain` is no longer read here.
       *
       * Businesses do not bring their own address — every page is served at
       * `{prefix}.agentspilot.ai` — and the column is null on every row, so the
       * branch that preferred it had never once been taken. The host itself now
       * comes from the one resolver rather than from
       * `NEXT_PUBLIC_WEBSITE_BASE_HOST || 'agentpilot.io'`, a default that named
       * a domain this platform has never served.
       */
      const siteHost = publicSiteHost();
      const platformHost = platformOrigin().replace(/^https?:\/\//, '');
      const hosts = new Set<string>();

      for (const page of (data as any[]) || []) {
        if (!page.subdomain) continue;

        /*
         * Without a configured public-site host there is no wildcard DNS, so
         * every page is served from the platform's own host under a path. They
         * collapse to one entry, which is exactly what analytics would report.
         */
        hosts.add(
          siteHost ? `${String(page.subdomain).toLowerCase()}.${siteHost}` : platformHost
        );
      }

      return { data: [...hosts], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to resolve hosted hosts');
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
