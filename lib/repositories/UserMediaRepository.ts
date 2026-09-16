import 'server-only';

/**
 * A business's pictures, as rows.
 *
 * Every read and write is scoped to one `user_id`. The bucket these point at is
 * public-read by design — a website's photographs have to load for a visitor
 * with no session — so the table is the only thing that knows WHICH business a
 * picture belongs to, and it is the boundary that has to hold.
 *
 * @module lib/repositories/UserMediaRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

export interface UserMedia {
  id: string;
  user_id: string;
  storage_path: string;
  public_url: string;
  source: 'stock' | 'generated' | 'upload';
  source_ref: string | null;
  section: string | null;
  aspect: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface RecordMediaInput {
  userId: string;
  storagePath: string;
  publicUrl: string;
  source: UserMedia['source'];
  sourceRef?: string | null;
  section?: string | null;
  aspect?: string | null;
  description?: string | null;
  width?: number | null;
  height?: number | null;
}

export class UserMediaRepository {
  private readonly supabase: SupabaseClient;
  private readonly logger: Logger;

  constructor(supabase: SupabaseClient = defaultSupabase) {
    this.supabase = supabase;
    this.logger = createLogger({ service: 'UserMediaRepository' });
  }

  /**
   * A picture this business already has from the same source.
   *
   * What stops a rebuild fetching, storing and paying for a photograph it chose
   * the first time. Null on any failure, because a duplicate is a far smaller
   * problem than a build that stops.
   */
  async findBySourceRef(userId: string, sourceRef: string): Promise<UserMedia | null> {
    try {
      const { data, error } = await this.supabase
        .from('user_media')
        .select('*')
        .eq('user_id', userId)
        .eq('source_ref', sourceRef)
        .maybeSingle();

      if (error) throw error;
      return (data as UserMedia) ?? null;
    } catch (error) {
      this.logger.warn({ err: error, userId, sourceRef }, 'Could not look up an existing picture');
      return null;
    }
  }

  /**
   * Remember that this business owns this picture.
   *
   * Never throws. The file is already stored and already rendering by the time
   * this runs — losing the row costs the owner a thumbnail in their library and
   * risks fetching the same photograph twice, neither of which is worth failing
   * a website build for.
   *
   * That tolerance hid a real bug once: the reuse index shipped PARTIAL
   * (`WHERE source_ref IS NOT NULL`), which PostgreSQL cannot infer from the
   * bare `ON CONFLICT (user_id, source_ref)` this sends — so every insert was
   * rejected, silently, and the library stayed empty while pictures rendered
   * fine on the page. Fixed in `20260926_user_media_conflict_target.sql`. The
   * lesson for anything added here: an upsert's conflict target must be a
   * complete, non-partial unique index.
   *
   * It now logs at ERROR rather than WARN. A row that does not write is not a
   * cosmetic loss — it is a picture the owner cannot find again.
   */
  async record(input: RecordMediaInput): Promise<UserMedia | null> {
    try {
      const { data, error } = await this.supabase
        .from('user_media')
        .upsert(
          {
            user_id: input.userId,
            storage_path: input.storagePath,
            public_url: input.publicUrl,
            source: input.source,
            source_ref: input.sourceRef ?? null,
            section: input.section ?? null,
            aspect: input.aspect ?? null,
            description: input.description ?? null,
            width: input.width ?? null,
            height: input.height ?? null,
          },
          { onConflict: 'user_id,source_ref', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (error) throw error;
      return data as UserMedia;
    } catch (error) {
      this.logger.error({ err: error, userId: input.userId }, 'Could not record a picture');
      return null;
    }
  }

  /**
   * How many pictures this business has GENERATED since a given moment.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS COUNTS ROWS RATHER THAN KEEPING A TALLY
   *
   * Every generated picture already writes a row here, with its source and its
   * timestamp. A separate counter would be a second source of truth that can
   * drift from the thing it counts — and the first time it drifts, an owner is
   * either billed for pictures they do not have or locked out of ones they
   * never made.
   *
   * `head: true` asks PostgREST for the count alone, so this stays one cheap
   * query regardless of how many pictures a business has accumulated.
   *
   * Returns `null` when the count cannot be read. That is deliberately NOT
   * zero: a caller enforcing a limit must be able to tell "none today" from "I
   * do not know", and treating the second as the first hands out free
   * generations whenever the database hiccups.
   */
  async countGeneratedSince(userId: string, since: Date): Promise<number | null> {
    try {
      const { count, error } = await this.supabase
        .from('user_media')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'generated')
        .gte('created_at', since.toISOString());

      if (error) throw error;
      return count ?? 0;
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Could not count generated pictures');
      return null;
    }
  }

  /**
   * This business's pictures, newest first, for the editor's own-images picker.
   *
   * `null` means the list could not be read; an empty array means there are
   * genuinely none. This returned `[]` for both, so an unapplied migration —
   * no `user_media` table — looked exactly like a business that had never added
   * a picture. Generation appeared to work (the file uploads, the URL comes
   * back, the block takes it) while nothing ever showed in the library, and
   * there was no way to tell those two states apart from the outside.
   */
  async listForUser(userId: string, limit = 60): Promise<UserMedia[] | null> {
    try {
      const { data, error } = await this.supabase
        .from('user_media')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(0, limit - 1);

      if (error) throw error;
      return (data as UserMedia[]) ?? [];
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Could not list a business\'s pictures');
      return null;
    }
  }
}

export const userMediaRepository = new UserMediaRepository();
