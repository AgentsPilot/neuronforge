/**
 * SmartLinkRepository
 * Repository for smart_links and smart_link_clicks tables
 * Handles CRUD operations for trackable short links with attribution
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { resolveChannel } from '@/lib/business-os/channel-insights/channelFromReferrer';

const logger = createLogger({ service: 'SmartLinkRepository' });

/**
 * Destinations whose arrivals are already recorded as page views. Counting a
 * click to one of these as well would count the same person twice.
 *
 * Only the public website mounts the page-view tracker, so everything else a
 * smart link can point at goes uncounted without this.
 */
const TRACKED_ELSEWHERE = new Set(['website', 'landing']);

/** Clicks per channel per day, shaped like the page-view equivalent. */
export interface SmartLinkVisitRow {
  channel: string;
  metric_date: string;
  views: number;
  visitors: number;
  /** Distinct visitor hashes, so uniques can be counted across the period. */
  visitorIds: string[];
}

export interface SmartLinkMetadata {
  journeyType?: 'contact-only' | 'full';
  serviceIds?: string[];
  flow?: string[];
  destinationType?: 'form' | 'booking';
}

export interface SmartLink {
  id: string;
  user_id: string;
  code: string;
  name: string | null;
  destination_url: string;
  destination_type: 'booking' | 'form' | 'payment' | 'landing' | 'website' | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  click_count: number;
  conversion_count: number;
  revenue_cents: number;
  is_active: boolean;
  metadata: SmartLinkMetadata | null;
  created_at: string;
  updated_at: string;
}

export interface SmartLinkCreate {
  name?: string;
  destination_url: string;
  destination_type?: SmartLink['destination_type'];
  /**
   * Whether the link is live on creation. Defaults to true — the column's own
   * default — because a link is normally made to be used immediately. Passed as
   * false when the journey behind it cannot run yet, so it is created switched
   * off rather than created broken.
   */
  is_active?: boolean;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  metadata?: SmartLinkMetadata;
}

export interface SmartLinkUpdate {
  name?: string;
  destination_url?: string;
  destination_type?: SmartLink['destination_type'];
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  is_active?: boolean;
  metadata?: SmartLinkMetadata;
}

export interface SmartLinkClick {
  id: string;
  smart_link_id: string;
  clicked_at: string;
  ip_hash: string | null;
  user_agent: string | null;
  referer: string | null;
  device_type: 'desktop' | 'mobile' | 'tablet' | null;
  country_code: string | null;
  session_id: string | null;
  converted: boolean;
  conversion_type: string | null;
  converted_at: string | null;
}

export interface SmartLinkRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class SmartLinkRepository {
  private supabase = supabaseServer;

  /**
   * Generate a unique short code for a smart link
   */
  private generateCode(length: number = 6): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create a new smart link
   */
  async create(userId: string, input: SmartLinkCreate): Promise<SmartLinkRepositoryResult<SmartLink>> {
    try {
      // Generate unique code with retry
      let code = this.generateCode(6);
      let attempts = 0;

      while (attempts < 5) {
        const { data: existing } = await this.supabase
          .from('smart_links')
          .select('id')
          .eq('code', code)
          .single();

        if (!existing) break;
        code = this.generateCode(attempts > 2 ? 8 : 6);
        attempts++;
      }

      const { data, error } = await this.supabase
        .from('smart_links')
        .insert({
          user_id: userId,
          code,
          name: input.name || null,
          destination_url: input.destination_url,
          destination_type: input.destination_type || null,
          source: input.source || null,
          medium: input.medium || null,
          campaign: input.campaign || null,
          content: input.content || null,
          metadata: input.metadata || {},
          ...(input.is_active === undefined ? {} : { is_active: input.is_active })
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { userId, linkId: data.id, code: data.code, destinationType: data.destination_type },
        'Smart link created'
      );

      return { data: data as SmartLink, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to create smart link');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find smart link by ID
   */
  async findById(linkId: string, userId: string): Promise<SmartLinkRepositoryResult<SmartLink>> {
    try {
      const { data, error } = await this.supabase
        .from('smart_links')
        .select('*')
        .eq('id', linkId)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as SmartLink, error: null };
    } catch (error) {
      logger.error({ err: error, linkId, userId }, 'Failed to find smart link');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find smart link by code (for public redirect)
   * No user_id required - this is used by the public redirect endpoint
   */
  async findByCode(code: string): Promise<SmartLinkRepositoryResult<SmartLink>> {
    try {
      const { data, error } = await this.supabase
        .from('smart_links')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          logger.debug({ code }, 'Smart link not found');
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as SmartLink, error: null };
    } catch (error) {
      logger.error({ err: error, code }, 'Failed to find smart link by code');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all smart links for a user
   */
  async listByUser(
    userId: string,
    options?: {
      activeOnly?: boolean;
      destinationType?: SmartLink['destination_type'];
      limit?: number;
      offset?: number;
    }
  ): Promise<SmartLinkRepositoryResult<SmartLink[]>> {
    try {
      let query = this.supabase
        .from('smart_links')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (options?.activeOnly) {
        query = query.eq('is_active', true);
      }

      if (options?.destinationType) {
        query = query.eq('destination_type', options.destinationType);
      }

      if (options?.limit) {
        const offset = options.offset || 0;
        query = query.range(offset, offset + options.limit - 1);
      }

      const { data, error } = await query;

      if (error) throw error;

      return { data: data as SmartLink[], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list smart links');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a smart link
   */
  async update(
    linkId: string,
    userId: string,
    updates: SmartLinkUpdate
  ): Promise<SmartLinkRepositoryResult<SmartLink>> {
    try {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString()
      };

      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.destination_url !== undefined) updateData.destination_url = updates.destination_url;
      if (updates.destination_type !== undefined) updateData.destination_type = updates.destination_type;
      if (updates.source !== undefined) updateData.source = updates.source;
      if (updates.medium !== undefined) updateData.medium = updates.medium;
      if (updates.campaign !== undefined) updateData.campaign = updates.campaign;
      if (updates.content !== undefined) updateData.content = updates.content;
      if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
      if (updates.metadata !== undefined) updateData.metadata = updates.metadata;

      const { data, error } = await this.supabase
        .from('smart_links')
        .update(updateData)
        .eq('id', linkId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ linkId, userId }, 'Smart link updated');
      return { data: data as SmartLink, error: null };
    } catch (error) {
      logger.error({ err: error, linkId, userId }, 'Failed to update smart link');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a smart link (soft delete by setting is_active = false)
   */
  async delete(linkId: string, userId: string): Promise<SmartLinkRepositoryResult<void>> {
    try {
      /*
       * A real delete, not a deactivation.
       *
       * This used to set `is_active: false`, which spent the one flag the
       * product needs for switching a link on and off: "Delete" and
       * "Deactivate" became the same action under two names, and nothing could
       * actually remove a link. Activate/Deactivate now own `is_active`, and
       * this owns removal.
       *
       * `smart_link_clicks.smart_link_id` is ON DELETE CASCADE, so this also
       * removes that link's click history and the revenue attributed to it.
       * That is the point of a delete and it is not recoverable — the caller
       * must confirm before reaching here.
       */
      const { error } = await this.supabase
        .from('smart_links')
        .delete()
        .eq('id', linkId)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ linkId, userId }, 'Smart link deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, linkId, userId }, 'Failed to delete smart link');
      return { data: null, error: error as Error };
    }
  }

  // ==================== CLICK TRACKING ====================

  /**
   * Record a click on a smart link
   * This is called by the public redirect endpoint
   */
  async recordClick(
    smartLinkId: string,
    clickData: {
      ipHash?: string;
      userAgent?: string;
      referer?: string;
      deviceType?: 'desktop' | 'mobile' | 'tablet';
      countryCode?: string;
      sessionId?: string;
    }
  ): Promise<SmartLinkRepositoryResult<SmartLinkClick>> {
    try {
      const { data, error } = await this.supabase
        .from('smart_link_clicks')
        .insert({
          smart_link_id: smartLinkId,
          ip_hash: clickData.ipHash || null,
          user_agent: clickData.userAgent || null,
          referer: clickData.referer || null,
          device_type: clickData.deviceType || null,
          country_code: clickData.countryCode || null,
          session_id: clickData.sessionId || null
        })
        .select()
        .single();

      if (error) throw error;

      // Note: click_count is auto-incremented by a trigger in the database
      logger.debug({ smartLinkId, clickId: data.id }, 'Click recorded');
      return { data: data as SmartLinkClick, error: null };
    } catch (error) {
      logger.error({ err: error, smartLinkId }, 'Failed to record click');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark a click as converted
   */
  async markConversion(
    sessionId: string,
    conversionType: 'booking' | 'form' | 'payment',
    revenueAmountCents?: number
  ): Promise<SmartLinkRepositoryResult<void>> {
    try {
      // Update the click record
      const { data: click, error: clickError } = await this.supabase
        .from('smart_link_clicks')
        .update({
          converted: true,
          conversion_type: conversionType,
          converted_at: new Date().toISOString()
        })
        .eq('session_id', sessionId)
        .select('smart_link_id')
        .single();

      if (clickError) {
        if (clickError.code === 'PGRST116') {
          // No click found with this session - not an error, might be direct traffic
          logger.debug({ sessionId }, 'No click found for session');
          return { data: null, error: null };
        }
        throw clickError;
      }

      // Update the smart link's conversion count and revenue
      const updates: Record<string, unknown> = {
        conversion_count: this.supabase.rpc('increment', { x: 1 }),
        updated_at: new Date().toISOString()
      };

      if (revenueAmountCents) {
        // Use raw SQL increment for revenue
        await this.supabase.rpc('increment_revenue', {
          link_id: click.smart_link_id,
          amount: revenueAmountCents
        });
      } else {
        await this.supabase
          .from('smart_links')
          .update({ conversion_count: this.supabase.rpc('increment', { x: 1 }) })
          .eq('id', click.smart_link_id);
      }

      logger.info({ sessionId, smartLinkId: click.smart_link_id, conversionType }, 'Conversion marked');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Failed to mark conversion');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get click stats for a smart link
   */
  async getClickStats(
    linkId: string,
    userId: string,
    days: number = 30
  ): Promise<SmartLinkRepositoryResult<{
    totalClicks: number;
    uniqueVisitors: number;
    conversions: number;
    conversionRate: number;
    clicksByDay: Array<{ date: string; clicks: number }>;
    clicksByDevice: Record<string, number>;
    clicksBySource: Record<string, number>;
  }>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Verify ownership
      const { data: link } = await this.supabase
        .from('smart_links')
        .select('id')
        .eq('id', linkId)
        .eq('user_id', userId)
        .single();

      if (!link) {
        return { data: null, error: new Error('Link not found') };
      }

      // Get all clicks for this link in the time range
      const { data: clicks, error } = await this.supabase
        .from('smart_link_clicks')
        .select('clicked_at, ip_hash, device_type, referer, converted')
        .eq('smart_link_id', linkId)
        .gte('clicked_at', startDate.toISOString());

      if (error) throw error;

      // Calculate stats
      const totalClicks = clicks?.length || 0;
      const uniqueIps = new Set(clicks?.map(c => c.ip_hash).filter(Boolean));
      const uniqueVisitors = uniqueIps.size;
      const conversions = clicks?.filter(c => c.converted).length || 0;
      const conversionRate = totalClicks > 0 ? (conversions / totalClicks) * 100 : 0;

      // Clicks by day
      const clicksByDayMap = new Map<string, number>();
      clicks?.forEach(c => {
        const date = c.clicked_at.split('T')[0];
        clicksByDayMap.set(date, (clicksByDayMap.get(date) || 0) + 1);
      });
      const clicksByDay = Array.from(clicksByDayMap.entries())
        .map(([date, clicks]) => ({ date, clicks }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Clicks by device
      const clicksByDevice: Record<string, number> = {};
      clicks?.forEach(c => {
        const device = c.device_type || 'unknown';
        clicksByDevice[device] = (clicksByDevice[device] || 0) + 1;
      });

      // Clicks by source (from referer domain)
      const clicksBySource: Record<string, number> = {};
      clicks?.forEach(c => {
        if (c.referer) {
          try {
            const domain = new URL(c.referer).hostname.replace('www.', '');
            clicksBySource[domain] = (clicksBySource[domain] || 0) + 1;
          } catch {
            clicksBySource['direct'] = (clicksBySource['direct'] || 0) + 1;
          }
        } else {
          clicksBySource['direct'] = (clicksBySource['direct'] || 0) + 1;
        }
      });

      return {
        data: {
          totalClicks,
          uniqueVisitors,
          conversions,
          conversionRate: Math.round(conversionRate * 100) / 100,
          clicksByDay,
          clicksByDevice,
          clicksBySource
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, linkId, userId }, 'Failed to get click stats');
      return { data: null, error: error as Error };
    }
  }

  // ==================== DEFAULT LINKS ====================

  /**
   * Get or create default smart links for a user's conversion pages
   * These are auto-generated links for booking, contact, payment
   */
  async getOrCreateDefaultLinks(
    userId: string,
    userCode: string,
    options?: {
      /**
       * The journey the booking link should carry, from how this business
       * collects — so the link a business is handed on day one runs the flow
       * it described in onboarding rather than the page's generic default.
       * Applied only when the link is created; an existing one is left as the
       * business has since arranged it.
       */
      bookingFlow?: string[];
      /**
       * What to call the links, in the business's own language.
       *
       * The repository has no language of its own — it is called from a route
       * that does — so the words come in rather than being chosen here. Without
       * them a Hebrew account got a link named "Booking Link", in a list it
       * reads right-to-left.
       */
      names?: { booking?: string; contact?: string };
    }
  ): Promise<SmartLinkRepositoryResult<{
    booking: SmartLink | null;
    contact: SmartLink | null;
    payment: SmartLink | null;
  }>> {
    try {
      // Get existing default links
      const { data: existing } = await this.supabase
        .from('smart_links')
        .select('*')
        .eq('user_id', userId)
        .in('destination_type', ['booking', 'form', 'payment'])
        .eq('is_active', true);

      const result: {
        booking: SmartLink | null;
        contact: SmartLink | null;
        payment: SmartLink | null;
      } = {
        booking: null,
        contact: null,
        payment: null
      };

      // Find existing links
      result.booking = existing?.find(l => l.destination_type === 'booking') as SmartLink || null;
      result.contact = existing?.find(l => l.destination_type === 'form') as SmartLink || null;
      result.payment = existing?.find(l => l.destination_type === 'payment') as SmartLink || null;

      // Create missing links
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.agentspilot.com';

      /**
       * A link still addressed to this account.
       *
       * The account's `user_code` is what a public link resolves through, and
       * it is regenerated whenever the business profile is recreated — running
       * onboarding again, for instance. The links themselves survive that, so
       * a link built before the reset keeps pointing at a code the account no
       * longer answers to: it exists, this function reports it ready, and it
       * leads nowhere. Existence was never the property worth checking.
       */
      const addressesThisAccount = (link: SmartLink | null) =>
        !!link && link.destination_url.includes(`/c/${userCode}/`);

      const ensure = async (
        existingLink: SmartLink | null,
        name: string,
        destinationType: 'booking' | 'form',
        path: string
      ): Promise<SmartLink | null> => {
        const destinationUrl = `${baseUrl}/c/${userCode}/${path}`;

        if (addressesThisAccount(existingLink)) return existingLink;

        // Repaired rather than replaced: the code in the URL is stale, but the
        // link's own short code may already be written down somewhere, and its
        // click history belongs to this business.
        if (existingLink) {
          // Only the account segment is wrong. A booking link can carry a
          // flow and a set of pre-selected services in its query, and
          // rebuilding the URL from scratch would throw all of that away to
          // fix six characters.
          const repointed = existingLink.destination_url.replace(
            /\/c\/[^/]+\//,
            `/c/${userCode}/`
          );
          const { data: repaired } = await this.update(existingLink.id, userId, {
            destination_url: repointed.includes(`/c/${userCode}/`) ? repointed : destinationUrl
          });
          logger.info(
            { userId, linkId: existingLink.id, destinationType },
            'Repointed a default link at the current user code'
          );
          return repaired || existingLink;
        }

        const flow = destinationType === 'booking' && options?.bookingFlow?.length
          ? `?flow=${options.bookingFlow.join(',')}`
          : '';

        const { data: created } = await this.create(userId, {
          name,
          destination_url: `${destinationUrl}${flow}`,
          destination_type: destinationType,
          ...(flow ? { metadata: { flow: options!.bookingFlow } } : {})
        });
        return created;
      };

      result.booking = await ensure(result.booking, options?.names?.booking || 'Booking Link', 'booking', 'book');
      result.contact = await ensure(result.contact, options?.names?.contact || 'Contact Form', 'form', 'contact');

      // Payment link is optional - only created when requested
      // because it depends on having paid services

      logger.info({ userId, hasBooking: !!result.booking, hasContact: !!result.contact }, 'Default links ready');
      return { data: result, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get or create default links');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Smart link clicks per channel per day, for the visits picture.
   *
   * Excludes destinations that are already counted somewhere else. A click
   * redirects to one of our own surfaces, so a link pointing at the public
   * website produces both a click here and a page view in
   * `website_page_views` — the same person arriving once. Booking, form and
   * payment destinations carry no page-view tracker, so a click is the only
   * record that the arrival happened.
   *
   * @param since ISO timestamp.
   */
  async getClickTotalsByChannelSince(
    userId: string,
    since: string
  ): Promise<SmartLinkRepositoryResult<SmartLinkVisitRow[]>> {
    try {
      const { data: links, error: linksError } = await this.supabase
        .from('smart_links')
        .select('id, source, medium, destination_type')
        .eq('user_id', userId);

      if (linksError) throw linksError;

      const counted = new Map<string, { source: string | null }>();
      for (const link of links || []) {
        if (TRACKED_ELSEWHERE.has(link.destination_type as string)) continue;
        counted.set(link.id, { source: link.source });
      }

      if (counted.size === 0) return { data: [], error: null };

      const { data: clicks, error: clicksError } = await this.supabase
        .from('smart_link_clicks')
        .select('smart_link_id, clicked_at, ip_hash')
        .in('smart_link_id', [...counted.keys()])
        .gte('clicked_at', since);

      if (clicksError) throw clicksError;

      // channel|date -> clicks, plus the distinct hashes seen for that bucket
      const buckets = new Map<
        string,
        { channel: string; date: string; views: number; visitors: Set<string> }
      >();

      for (const click of clicks || []) {
        const date = String(click.clicked_at || '').slice(0, 10);
        if (!date) continue;

        // A smart link carries its own utm_source, which is what the channel
        // vocabulary is built on. There is no referrer to fall back to: the
        // click is recorded at the redirect, before any destination is loaded.
        const source = counted.get(click.smart_link_id)?.source ?? null;
        const { channel } = resolveChannel(null, source);
        const key = `${channel}|${date}`;

        const bucket = buckets.get(key) ?? { channel, date, views: 0, visitors: new Set<string>() };
        bucket.views += 1;
        if (click.ip_hash) bucket.visitors.add(click.ip_hash);
        buckets.set(key, bucket);
      }

      const rows: SmartLinkVisitRow[] = [...buckets.values()].map(b => ({
        channel: b.channel,
        metric_date: b.date,
        views: b.views,
        visitors: b.visitors.size,
        visitorIds: [...b.visitors],
      }));

      return { data: rows, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to load smart link clicks by channel');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
export const smartLinkRepository = new SmartLinkRepository();
