// lib/server/website-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  WebsitePageRepository,
  type WebsitePage,
  type WebsitePageInsert,
  type WebsitePageUpdate,
} from '@/lib/repositories/WebsitePageRepository';
import {
  WebsiteBlockRepository,
  type WebsiteBlock,
  type BlockContent,
} from '@/lib/repositories/WebsiteBlockRepository';
import { WebsiteAnalyticsRepository } from '@/lib/repositories/WebsiteAnalyticsRepository';

const pluginName = 'website';

/**
 * Internal Website plugin executor.
 *
 * Repository-backed content-management surface for the current Business OS account: its website
 * pages, each page's on-page blocks, and read-only traffic analytics. No external API and no OAuth —
 * gated by the `db_active` access strategy, so `connection.user_id` is a verified BOS tenant by the
 * time an action runs. Website tables carry no cross-capability triggers (only `updated_at` bumps),
 * so nothing to delegate.
 *
 * GUARDRAILS:
 * - **W0.2 (no cached getters).** Repos are instantiated directly with `supabaseServer` — the
 *   `get*Repository()` singleton getters pin the first-injected client, which would be wrong for a
 *   service-role executor. Mirrors the REST routes.
 * - **G3 (block tenant isolation, load-bearing).** `website_blocks` has NO `user_id` column — a
 *   block's owner is only reachable via `page_id → website_pages.user_id`, normally enforced by RLS.
 *   Service role bypasses RLS, so this executor is the SOLE tenant boundary for blocks. Every block
 *   op resolves page ownership via `assertPageOwned` / `resolveBlockOwnedPage` and fails closed
 *   (`access_denied`) before delegating. (Option A — see workplan §4.2.)
 * - **M1 (page allow-lists, load-bearing security).** `create_page` / `update_page` build their
 *   payload field-by-field from an explicit allow-list — raw `params` is NEVER forwarded. `user_id`
 *   is always the authenticated id (never from params), `id` is never taken from params on create,
 *   and `status` / `published` / `custom_domain_verified` can never be injected. Mirrors
 *   `IntakePluginExecutor.updateSettings`.
 * - **M2 (ownership reads branch on `!data`).** `WebsitePageRepository.findById` uses `.single()`
 *   and does NOT special-case PGRST116, so a not-owned/not-found page returns
 *   `{ data: null, error: <PGRST116> }`. The ownership guards branch on `!data` (treating a non-null
 *   error AND a null data as not-owned) and throw `access_denied` — they never pipe the raw error
 *   through `unwrap` (which would surface a generic 500 instead of the `access_denied` contract).
 * - **M5 (informational).** `get_page_analytics` scopes by `.eq('user_id', userId)`, so a foreign
 *   pageId returns a zeroed summary (no data leak); no ownership pre-check is added.
 */
export class WebsitePluginExecutor extends BasePluginExecutor {
  private pageRepo: WebsitePageRepository;
  private blockRepo: WebsiteBlockRepository;
  private analyticsRepo: WebsiteAnalyticsRepository;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
    // W0.2: instantiate directly — do NOT use the caching get*Repository() getters.
    this.pageRepo = new WebsitePageRepository(supabaseServer);
    this.blockRepo = new WebsiteBlockRepository(supabaseServer);
    this.analyticsRepo = new WebsiteAnalyticsRepository(supabaseServer);
  }

  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    const userId: string | undefined = connection?.user_id;
    if (!userId) {
      throw new Error('access_denied: missing user context for Website operation');
    }
    const params = parameters || {};

    switch (actionName) {
      // ---------------- PAGES ----------------
      case 'list_pages':
        return this.unwrap(await this.pageRepo.listByUser(userId)) || [];

      case 'get_page': {
        this.requireParam(params.id, 'id');
        // M2: findById returns a non-null PGRST116 error for a not-owned/not-found page — branch on
        // `!data` (do NOT use `unwrap`, which would rethrow the raw error) and fail closed.
        return this.assertPageOwned(params.id, userId);
      }

      case 'create_page':
        return this.createPage(userId, params);

      case 'update_page':
        return this.updatePage(userId, params);

      case 'publish_page': {
        this.requireParam(params.id, 'id');
        return this.unwrap(await this.pageRepo.publish(params.id, userId));
      }

      case 'unpublish_page': {
        this.requireParam(params.id, 'id');
        return this.unwrap(await this.pageRepo.unpublish(params.id, userId));
      }

      // ---------------- BLOCKS (G3 — ownership pre-checks) ----------------
      case 'list_blocks': {
        this.requireParam(params.page_id, 'page_id');
        await this.assertPageOwned(params.page_id, userId);
        return this.unwrap(await this.blockRepo.findByPageId(params.page_id, params.enabled_only === true)) || [];
      }

      case 'toggle_block': {
        this.requireParam(params.block_id, 'block_id');
        this.requireParam(params.enabled, 'enabled');
        await this.resolveBlockOwnedPage(params.block_id, userId);
        return this.unwrap(await this.blockRepo.toggleEnabled(params.block_id, params.enabled === true));
      }

      case 'update_block_content': {
        this.requireParam(params.block_id, 'block_id');
        this.requireParam(params.content, 'content');
        await this.resolveBlockOwnedPage(params.block_id, userId);
        return this.unwrap(await this.blockRepo.updateContent(params.block_id, params.content as Partial<BlockContent>));
      }

      // ---------------- ANALYTICS ----------------
      case 'get_analytics_summary':
        return this.unwrap(await this.analyticsRepo.getSummary(userId, params.subdomain));

      case 'get_page_analytics': {
        this.requireParam(params.page_id, 'page_id');
        // M5: scoped by user_id in the repo — a foreign pageId returns a zeroed summary (no leak).
        return this.unwrap(await this.analyticsRepo.getPageSummary(params.page_id, userId));
      }

      default:
        throw new Error(`Action ${actionName} not supported`);
    }
  }

  /** Internal plugins hold no token — trivial active status. */
  protected async performConnectionTest(connection: any): Promise<any> {
    return { status: 'active', internal: true, user_id: connection?.user_id };
  }

  // ---------------- G3 ownership helpers (Option A, load-bearing) ----------------

  /**
   * M2: assert `pageId` belongs to `userId`. `findById` fails closed to `{ data: null }` for both a
   * not-owned and a not-found page (it returns a non-null PGRST116 error, so we branch on `!data`
   * rather than piping through `unwrap`). Fail closed → `access_denied`.
   */
  private async assertPageOwned(pageId: string, userId: string): Promise<WebsitePage> {
    const result = await this.pageRepo.findById(pageId, userId);
    if (!result.data) {
      throw new Error('access_denied: page not owned by this account');
    }
    return result.data;
  }

  /**
   * Resolve a block's owning page and assert the caller owns it. Reads the block by id (the only
   * lookup `website_blocks` supports), then verifies `page_id` ownership. A missing block or a
   * not-owned page both fail closed → `access_denied`. Returns the block. Used before the id-only
   * block mutations (`toggleEnabled` / `updateContent`), which never reassign `page_id` — no TOCTOU.
   */
  private async resolveBlockOwnedPage(blockId: string, userId: string): Promise<WebsiteBlock> {
    const result = await this.blockRepo.findById(blockId);
    if (!result.data) {
      throw new Error('access_denied: no block with that id');
    }
    await this.assertPageOwned(result.data.page_id, userId);
    return result.data;
  }

  // ---------------- M1 page allow-lists ----------------

  /**
   * M1: build the insert from an EXPLICIT allow-list of editable fields — raw `params` is never
   * forwarded. `user_id` is always the authenticated id; `id` / `status` / `published` /
   * `custom_domain_verified` can never be injected.
   */
  private async createPage(userId: string, params: any): Promise<any> {
    this.requireParam(params.page_type, 'page_type');
    this.requireParam(params.slug, 'slug');
    this.requireParam(params.title, 'title');

    const page: WebsitePageInsert = {
      user_id: userId,
      page_type: params.page_type,
      slug: params.slug,
      title: params.title,
    };
    if (params.meta_description !== undefined) page.meta_description = params.meta_description;
    if (params.seo_keywords !== undefined) page.seo_keywords = params.seo_keywords;
    if (params.theme !== undefined) page.theme = params.theme;
    if (params.subdomain !== undefined) page.subdomain = params.subdomain;
    if (params.favicon_url !== undefined) page.favicon_url = params.favicon_url;
    if (params.og_image_url !== undefined) page.og_image_url = params.og_image_url;
    if (params.website_language !== undefined) page.website_language = params.website_language;

    return this.unwrap(await this.pageRepo.create(page));
  }

  /**
   * M1: build the update patch from an EXPLICIT allow-list — raw `params` is never forwarded, so no
   * caller can inject `user_id` (page hand-off), `status`, `published`, or `custom_domain_verified`.
   */
  private async updatePage(userId: string, params: any): Promise<any> {
    this.requireParam(params.id, 'id');

    const updates: WebsitePageUpdate = {};
    if (params.page_type !== undefined) updates.page_type = params.page_type;
    if (params.slug !== undefined) updates.slug = params.slug;
    if (params.title !== undefined) updates.title = params.title;
    if (params.meta_description !== undefined) updates.meta_description = params.meta_description;
    if (params.seo_keywords !== undefined) updates.seo_keywords = params.seo_keywords;
    if (params.theme !== undefined) updates.theme = params.theme;
    if (params.subdomain !== undefined) updates.subdomain = params.subdomain;
    if (params.custom_domain !== undefined) updates.custom_domain = params.custom_domain;
    if (params.favicon_url !== undefined) updates.favicon_url = params.favicon_url;
    if (params.og_image_url !== undefined) updates.og_image_url = params.og_image_url;
    if (params.website_language !== undefined) updates.website_language = params.website_language;

    return this.unwrap(await this.pageRepo.update(params.id, userId, updates));
  }

  // ---------------- helpers ----------------

  private unwrap<T>(result: { data: T | null; error: Error | null }): T | null {
    if (result.error) throw result.error;
    return result.data;
  }

  private requireParam(value: unknown, name: string): void {
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }
}
