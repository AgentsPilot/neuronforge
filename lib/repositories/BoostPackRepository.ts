// lib/repositories/BoostPackRepository.ts
// Data-access layer for the `boost_packs` table — the agent-platform Pilot-Credit
// boost catalog edited on `/admin/agentspilot-billing`.
//
// WHY THERE IS NO `.eq('user_id', userId)` HERE (CLAUDE.md rule 4 exemption,
// stated rather than silently skipped):
//
//   `boost_packs` is platform-wide catalog data: one row per pack, the same row
//   for every tenant. The table has NO `user_id` (or any other owner) column, so
//   there is nothing to scope by and no cross-tenant read or write is reachable
//   through this repository.
//
//   `supabaseServer` (service role) is therefore INTENTIONAL: an admin-only
//   catalog surface that bypasses RLS on purpose. Since migration 20261039 the
//   browser roles hold no grant on the table at all, and once 20261040 is
//   applied it has no RLS policy either, so only the service role can read or
//   write it.
//
//   Because scoping cannot protect this table, AUTHORISATION IS THE CALLER'S
//   JOB. The one permitted caller is `app/api/admin/boost-packs/route.ts`, behind
//   the admin gate `requireAdmin` (`lib/admin/requireAdminRoute.ts` →
//   AdminAccessService → the `admin_users` table; never `profiles.role`). Do not
//   add an ungated caller. (`lib/stripe/StripeService.ts` still reads the table
//   directly for the switched-off boost checkout; it predates this repository.)
//
//   No method accepts a caller-supplied filter, table name or column list —
//   only an id and the typed `BoostPackWriteInput` fields, which the route has
//   already narrowed through Zod.
//
//   Server-side only — never import this from a `'use client'` component.
//
// No method throws: every failure comes back as `{ data: null, error }`.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  BoostPack,
  BoostPackWriteInput,
} from './types';

const TABLE = 'boost_packs';

export class BoostPackRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service-role client by design — see the security note at the top of the file.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BoostPackRepository' });
  }

  /** Every pack, active or not, cheapest first — what the admin screen lists. */
  async listAll(): Promise<RepositoryResult<BoostPack[]>> {
    const methodLogger = this.logger.child({ method: 'listAll' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select('*')
        .order('price_usd', { ascending: true });

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0, duration: Date.now() - startTime }, 'Boost packs fetched');
      return { data: (data as BoostPack[]) || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to fetch boost packs');
      return { data: null, error: error as Error };
    }
  }

  /** Insert one pack and return the stored row. */
  async create(input: BoostPackWriteInput): Promise<RepositoryResult<BoostPack>> {
    const methodLogger = this.logger.child({ method: 'create', packKey: input.pack_key });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .insert({ ...input })
        .select()
        .single();

      if (error) throw error;

      methodLogger.debug({ id: (data as BoostPack).id, duration: Date.now() - startTime }, 'Boost pack created');
      return { data: data as BoostPack, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to create boost pack');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Partial update by id; returns the stored row. An id that matches no row is
   * an error (PostgREST `.single()`), as it was when the route queried directly.
   * `updated_at` is deliberately not stamped here: the route never did, and this
   * refactor changes no behaviour.
   */
  async update(id: string, input: BoostPackWriteInput): Promise<RepositoryResult<BoostPack>> {
    const methodLogger = this.logger.child({ method: 'update', id });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update({ ...input })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      methodLogger.debug({ duration: Date.now() - startTime }, 'Boost pack updated');
      return { data: data as BoostPack, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to update boost pack');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Hard delete by id (the table has no soft-delete columns). Succeeds even when
   * no row matched, exactly as the route behaved before.
   */
  async deleteById(id: string): Promise<RepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'deleteById', id });
    const startTime = Date.now();

    try {
      const { error } = await this.supabase.from(TABLE).delete().eq('id', id);

      if (error) throw error;

      methodLogger.debug({ duration: Date.now() - startTime }, 'Boost pack deleted');
      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ err: error, duration: Date.now() - startTime }, 'Failed to delete boost pack');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience
export const boostPackRepository = new BoostPackRepository();
