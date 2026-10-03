/**
 * Response shape of `GET /api/admin/admins`, shared by the route and the
 * read-only Admin users page (`app/admin/settings/page.tsx`).
 *
 * Types only: no runtime exports and no imports, so the page can pull it in
 * with `import type` and nothing reaches the client bundle (SA W-5).
 *
 * Deliberately absent: the row `id`, `user_id`, `granted_by`, `updated_at`,
 * `is_active` and any profile or auth data. The route builds this shape by
 * explicit field picking, never by spreading a row (condition C-3).
 *
 * @module lib/admin/adminList-types
 */

/** One active row of the `admin_users` table. */
export interface AdminListTableEntry {
  /** As stored. The page shows it unchanged. */
  email: string;
  /** True once the row is bound to an auth user (first admin request, or seeding). */
  linkedToLogin: boolean;
  /** The row's `created_at`, ISO string. */
  addedAt: string;
  notes: string | null;
  /**
   * The address is also in `ADMIN_EMAILS`, so deactivating the row alone does
   * not revoke access: the environment setting grants it on its own.
   */
  alsoInEnv: boolean;
}

/** An address granted only by the `ADMIN_EMAILS` environment setting. */
export interface AdminListEnvEntry {
  email: string;
}

export interface AdminListData {
  tableAdmins: AdminListTableEntry[];
  envOnlyAdmins: AdminListEnvEntry[];
}

export type AdminListResponse =
  | { success: true; data: AdminListData }
  | { success: false; error: string; details?: string };
