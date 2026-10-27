/**
 * The Supabase project table behind the Environment page's project label
 * (admin environment view EC-6; requirement FR-6.1 to FR-6.4; SA OQ-1, OQ-2,
 * OQ-5, SA-L3).
 *
 * Maps a Supabase project ref to a display label and the project's intended
 * role. The label is chosen by us; it is never read from Supabase. A ref is not
 * a secret: it is part of the public Supabase address the browser already
 * receives. This file holds refs and our own labels only, never a key or any
 * other value.
 *
 * Wording rule (OQ-5): a label and any comment here state the project's
 * intended role only, never which deployment or environment uses it.
 *
 * PURE DATA, type-only imports, like `catalogue.ts`. Never imported by the
 * page (SA-C11): the page learns only the label and role the server sends.
 *
 * A `ReadonlyMap`, not a plain object, so a ref such as `constructor` or
 * `toString` can never find an inherited property (SA-L3).
 *
 * Adding a project: one entry here, in its own small PR. A new role also needs
 * its words in `app/admin/environment/environmentDisplay.ts`.
 *
 * @module lib/admin/environment/supabaseProjects
 */

import type { EnvSupabaseRole } from '@/lib/admin/environment-types';

export interface SupabaseProjectEntry {
  /** Our name for the project, 1 to 60 characters. */
  label: string;
  role: EnvSupabaseRole;
}

/** The only two rows that can carry a project label (FR-6.5). */
export const SUPABASE_URL_ROW_NAMES: readonly string[] = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'];

export const SUPABASE_PROJECTS: ReadonlyMap<string, SupabaseProjectEntry> = new Map<string, SupabaseProjectEntry>([
  ['jgccgkyhpwirgknnceoh', { label: 'AgentsPilot-dev', role: 'development-staging' }],
]);
