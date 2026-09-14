/**
 * ArchetypeRepository — the looks a business can choose between.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TABLE EXTENDS; THE CODE IS THE SOURCE OF TRUTH FOR WHAT SHIPS
 *
 * The four archetypes live in `lib/website-builder/archetypes.ts` and seed
 * `website_archetypes`. This reads the table so a fifth design can be added by
 * INSERT — thirty token values and four layout names, no deploy — and falls
 * back to the ones in code whenever the table is empty, unmigrated or
 * unreachable.
 *
 * That fallback is not defensive padding. The website wizard asks for this list
 * to draw its gallery, and an empty gallery is a screen with no way forward; a
 * failed read must degrade to the four we know exist rather than to nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/repositories/ArchetypeRepository
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import { ARCHETYPES, DEFAULT_ARCHETYPE, getArchetype } from '@/lib/website-builder/archetypes';
import type { Composition, PageTheme, ThemeLayouts } from '@/lib/website-builder/pageTheme';

export interface ArchetypeRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

/** The row, as stored. `tokens` is a `PageTheme` minus the layouts. */
interface ArchetypeRow {
  id: string;
  name: string;
  source: string | null;
  tokens: Omit<PageTheme, 'id' | 'source' | 'layouts' | 'composition'>;
  layouts: ThemeLayouts;
  /**
   * Which set of section bones the look is built on.
   *
   * A column rather than part of `tokens` because it is not a token: it selects
   * a stylesheet, and the set of valid values is whatever
   * `components/public/compositions.ts` implements. Absent on a row written
   * before the column existed, which resolves to `stone` — the arrangement
   * those rows already rendered in.
   */
  composition: Composition | null;
}

export class ArchetypeRepository {
  private logger: Logger;

  constructor(private supabase: SupabaseClient = defaultSupabase) {
    this.logger = createLogger({ service: 'ArchetypeRepository' });
  }

  /**
   * Every active archetype, in gallery order.
   *
   * Never returns an empty list and never returns an error: a caller drawing a
   * chooser has nothing sensible to do with either, and the ones in code are
   * always a correct answer. That fallback also covers the window between this
   * deploy and the migration that adds `composition` — the select fails, the
   * catch answers from code, and the gallery is complete either way.
   */
  async listActive(): Promise<PageTheme[]> {
    try {
      const { data, error } = await this.supabase
        .from('website_archetypes')
        .select('id, name, source, tokens, layouts, composition')
        .eq('is_active', true)
        .order('position', { ascending: true });

      if (error) throw error;
      if (!data || data.length === 0) return [...ARCHETYPES];

      return (data as ArchetypeRow[]).map(row => ({
        ...row.tokens,
        id: row.id,
        source: row.source ?? undefined,
        layouts: row.layouts,
        composition: row.composition ?? undefined,
      }));
    } catch (error) {
      // Not an error the caller can act on — the gallery still has every look.
      this.logger.warn({ err: error }, 'Could not read archetypes; using the ones in code');
      return [...ARCHETYPES];
    }
  }

  /**
   * One archetype by id, code first.
   *
   * Code first because the ones that ship are those every block was built
   * against, and a row that shadows one of their ids should not be able to
   * change what a published page looks like by accident.
   */
  async find(id: string | null | undefined): Promise<PageTheme | null> {
    const fromCode = getArchetype(id);
    if (fromCode) return fromCode;
    if (!id) return null;

    const all = await this.listActive();
    return all.find(archetype => archetype.id === id) ?? null;
  }

  /** The archetype for an id, or the default. Never null. */
  async resolve(id: string | null | undefined): Promise<PageTheme> {
    return (await this.find(id)) ?? DEFAULT_ARCHETYPE;
  }
}

export const archetypeRepository = new ArchetypeRepository();
