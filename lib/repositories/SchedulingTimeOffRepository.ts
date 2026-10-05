/**
 * Days the business is closed, or open for less than usual.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS NOW
 *
 * `scheduling_availability_exceptions` has been in the schema since 20260722
 * with full row-level security and exactly the right shape — and nothing in the
 * platform read it or wrote it. Its only other appearances in the tree were
 * `businessOwnedTables.ts` and the purge descriptors: the registries that would
 * delete it.
 *
 * So a business closed for a holiday went on publishing bookable slots for it,
 * and a client could take a time the owner was away. The owner's only defence
 * was to notice and cancel.
 *
 * Reading is what fixes that; `windowsForDate` in lib/scheduling/
 * availabilityWindows.ts applies the rows to a date. This repository is only
 * the access layer, per the project's rule that nothing outside
 * `lib/repositories` touches Supabase.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/repositories/SchedulingTimeOffRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'SchedulingTimeOffRepository' });

export type TimeOffType = 'unavailable' | 'custom_hours';

export interface TimeOff {
  id: string;
  user_id: string;
  exception_type: TimeOffType;
  /** `YYYY-MM-DD`, inclusive, in the business's own calendar. */
  start_date: string;
  end_date: string;
  /** Present for `custom_hours`: the hours this date actually has. */
  custom_hours: { start: string; end: string } | null;
  reason: string | null;
  created_at: string;
}

export interface TimeOffInsert {
  user_id: string;
  exception_type: TimeOffType;
  start_date: string;
  end_date: string;
  custom_hours?: { start: string; end: string } | null;
  reason?: string | null;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class SchedulingTimeOffRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Everything that could affect a window of dates.
   *
   * `from`/`to` are inclusive date keys and the overlap is deliberately
   * generous: an entry that STARTS before the window and ENDS inside it still
   * closes days in it. Asking for `start_date >= from` would have missed a
   * two-week holiday the window falls in the middle of — which is the only kind
   * of entry that matters for a long-range view like a package's six dates.
   *
   * Called with no window it returns everything, which is what the settings
   * screen shows.
   */
  async list(
    userId: string,
    window?: { from: string; to: string }
  ): Promise<RepositoryResult<TimeOff[]>> {
    try {
      let query = this.supabase
        .from('scheduling_availability_exceptions')
        .select('*')
        .eq('user_id', userId)
        .order('start_date', { ascending: true });

      if (window) {
        query = query.lte('start_date', window.to).gte('end_date', window.from);
      }

      const { data, error } = await query;
      if (error) throw error;

      return { data: (data || []) as TimeOff[], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list time off');
      return { data: null, error: error as Error };
    }
  }

  async create(entry: TimeOffInsert): Promise<RepositoryResult<TimeOff>> {
    try {
      const { data, error } = await this.supabase
        .from('scheduling_availability_exceptions')
        .insert({
          user_id: entry.user_id,
          exception_type: entry.exception_type,
          start_date: entry.start_date,
          end_date: entry.end_date,
          /*
           * Null for a closed day, not an empty object: the column is read by
           * `windowsForDate`, which treats an unreadable `custom_hours` as a
           * closed date. An `{}` on an `unavailable` row would be harmless
           * today and a trap the first time anything reads the two together.
           */
          custom_hours: entry.exception_type === 'custom_hours' ? entry.custom_hours ?? null : null,
          reason: entry.reason ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(
        { userId: entry.user_id, type: entry.exception_type, from: entry.start_date, to: entry.end_date },
        'Time off recorded'
      );
      return { data: data as TimeOff, error: null };
    } catch (error) {
      logger.error({ err: error, userId: entry.user_id }, 'Failed to record time off');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Remove one entry.
   *
   * A hard delete, deliberately: unlike a booking or an invoice, a day off is
   * not a record of something that happened. Removing it means "I am working
   * that day after all", and keeping a tombstone would leave the date readable
   * as closed by anything that forgot to filter.
   */
  async delete(id: string, userId: string): Promise<RepositoryResult<void>> {
    try {
      const { error } = await this.supabase
        .from('scheduling_availability_exceptions')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ id, userId }, 'Time off removed');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to remove time off');
      return { data: null, error: error as Error };
    }
  }
}

export const schedulingTimeOffRepository = new SchedulingTimeOffRepository(supabaseServer);
