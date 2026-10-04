// lib/repositories/CreditTransactionRepository.ts
// Repository for `credit_transactions`. READ-ONLY, by design.
//
// `credit_transactions` is a Pilot-Credit (agent platform) table. Its writes stay
// where they are: CreditService, rewardService and the Stripe routes. This
// repository exists so the GDPR data export reads it through the repository
// layer (CLAUDE.md rule 1; DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md OP-1).
//
// Business OS must not read or write this table through this repository: its
// credits live in the business_os_credit_* tables (B-8 / RD-2). Adding any write
// method here needs SA review.
//
// Service role, on purpose: it defaults to `supabaseServer`, as its siblings do.
// The tenant boundary is `.eq('user_id', userId)` on every read, where the caller
// passes the AUTHENTICATED user id, never a request value.
//
// Server-only: never import from a 'use client' file.

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

export class CreditTransactionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'CreditTransactionRepository' });
  }

  /**
   * GDPR export only (GET /api/user/data-export, Art. 15 / 20). The caller's
   * credit transactions since `since` (an ISO timestamp the route computes),
   * every column, newest first, at most 5000. The column set and the cap are
   * fixed; changing them changes what the export holds, which is a privacy
   * decision.
   */
  async listForUserDataExport(userId: string, since: string): Promise<RepositoryResult<Record<string, unknown>[]>> {
    try {
      const { data, error } = await this.supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;
      return { data: (data ?? []) as Record<string, unknown>[], error: null };
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Failed to list credit transactions for the data export');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton instance for convenience (mirrors the rest of lib/repositories).
export const creditTransactionRepository = new CreditTransactionRepository();
