import 'server-only';

/**
 * The profile-picture files: the only code that names the `avatars` bucket
 * (settings drawer D-3, C-19, C-20).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SERVICE ROLE (`supabaseServer`, storage RLS bypassed)
 *
 * The bucket was created in the dashboard and its policies are not in the
 * repository. The live check (LC-2, 2026-10-16) found them broad enough that
 * any signed-in account can write or delete any object (F-26, closed by slice
 * D-3a). Nothing here may depend on what the bucket happens to allow. So the
 * upload goes to a path built only from the SESSION user's id and a random
 * UUID, never overwrites (`upsert: false`), and every delete of an older file
 * passes our own ownership check first (`ownedAvatarObjectPath`).
 *
 * The old file to delete is named by `profiles.avatar_url`, which the browser
 * can still write (F-14, F-28). On a service-role path that value is a
 * caller-supplied id (`tenant-isolation-guard`), which is why the check exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPES A DELETE ACCEPTS (SA-D3-8: deliberately narrower than C-20)
 *
 * C-20 says "delete only if the path is `<userId>/…` or the legacy root form".
 * This accepts less than that, on purpose, and only these two exact shapes,
 * with the user id compared as a plain string prefix (never built into a
 * regex):
 *
 *   folder   `<userId>/<uuid>.(png|jpg|webp|gif)`   written by D-3 only
 *   legacy   `<userId>-<digits>.<letters/digits>`   written by the old hook
 *
 * Both are anchored, and what follows the user id admits no `/`, no `..` and
 * no `%`, so a traversal (`<me>/../<other>/x.png`, encoded or not) cannot pass
 * by construction. D-3 is the only writer of folder files, so an odd file in
 * an account's own folder is not ours to guess about: it is skipped and logged
 * with its classification only, never deleted.
 *
 * The URL must also be this project's public URL for the bucket: the origin of
 * `NEXT_PUBLIC_SUPABASE_URL` (the same value `supabaseServer` and therefore
 * `getPublicUrl` use, so a URL this module writes is a URL it can delete) and
 * the exact `/storage/v1/object/public/avatars/` prefix. A missing env value
 * fails closed: nothing is deleted.
 *
 * Logs never carry a URL or an object path, only the user id, the kind of
 * path and a reduced storage error (`{ code, message }`).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Shape copied from `GeneratedImageService` (one bucket, `supabaseServer`,
 * `getPublicUrl`) and the intake upload route (random path, remove the new
 * file if its record fails).
 *
 * @module lib/services/AvatarService
 */

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { AVATAR_EXTENSIONS, type AvatarMimeType } from '@/lib/validation/avatar';

/** The one place the bucket is named (SA-D3-5 guard). */
export const AVATAR_BUCKET = 'avatars';

const PUBLIC_PATH_PREFIX = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

/** What follows `<userId>/` in a folder-form object name. */
const FOLDER_FILE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

/** What follows `<userId>-` in a legacy root object name. */
const LEGACY_ROOT_FILE = /^\d+\.[A-Za-z0-9]+$/;

/** Any account's folder or legacy name, used only to tell `other_account` from `unrecognised_path` in a log. */
const ANY_ACCOUNT_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[/-]/i;

export type AvatarPathKind = 'folder' | 'legacy';
export type AvatarSkipReason = 'external' | 'other_account' | 'unrecognised_path';

export type AvatarOwnership =
  | { owned: true; path: string; kind: AvatarPathKind }
  | { owned: false; reason: AvatarSkipReason };

/** A storage error reduced to what may be logged. Never returned to a client. */
export interface SafeStorageError {
  code: string | undefined;
  message: string;
}

export function safeStorageError(error: unknown): SafeStorageError {
  if (error && typeof error === 'object') {
    const e = error as { statusCode?: unknown; status?: unknown; name?: unknown; message?: unknown };
    const code = [e.statusCode, e.status, e.name].find((v) => typeof v === 'string' || typeof v === 'number');
    return {
      code: code === undefined ? undefined : String(code),
      message: typeof e.message === 'string' ? e.message : 'Unknown storage error',
    };
  }
  return { code: undefined, message: String(error) };
}

/**
 * Decide whether a stored avatar URL names a file this user owns in our
 * bucket. `null` when there is nothing stored. Pure; exported for its tests.
 */
export function classifyStoredAvatarUrl(
  storedUrl: string | null | undefined,
  userId: string,
  supabaseUrl: string | undefined
): AvatarOwnership | null {
  if (!storedUrl) return null;
  // Fail closed: without our own origin, or a user id, nothing can be proven ours.
  if (!supabaseUrl || !userId) return { owned: false, reason: 'unrecognised_path' };

  let url: URL;
  let ourOrigin: string;
  try {
    url = new URL(storedUrl);
    ourOrigin = new URL(supabaseUrl).origin;
  } catch {
    return { owned: false, reason: 'unrecognised_path' };
  }
  // Query and fragment are ignored: they do not name a different object (Q-11).
  if (url.origin !== ourOrigin || !url.pathname.startsWith(PUBLIC_PATH_PREFIX)) {
    return { owned: false, reason: 'external' };
  }

  let name: string;
  try {
    // `getPublicUrl` applies `encodeURI`, so the stored form is encoded.
    name = decodeURIComponent(url.pathname.slice(PUBLIC_PATH_PREFIX.length));
  } catch {
    return { owned: false, reason: 'unrecognised_path' };
  }

  const folderPrefix = `${userId}/`;
  if (name.startsWith(folderPrefix) && FOLDER_FILE.test(name.slice(folderPrefix.length))) {
    return { owned: true, path: name, kind: 'folder' };
  }
  const legacyPrefix = `${userId}-`;
  if (name.startsWith(legacyPrefix) && LEGACY_ROOT_FILE.test(name.slice(legacyPrefix.length))) {
    return { owned: true, path: name, kind: 'legacy' };
  }
  if (ANY_ACCOUNT_PREFIX.test(name) && !name.startsWith(folderPrefix) && !name.startsWith(legacyPrefix)) {
    return { owned: false, reason: 'other_account' };
  }
  return { owned: false, reason: 'unrecognised_path' };
}

/**
 * C-20: the object path to delete for this stored URL, or `null` meaning "do
 * not delete". `supabaseUrl` is `process.env.NEXT_PUBLIC_SUPABASE_URL`, read
 * by the caller at call time.
 */
export function ownedAvatarObjectPath(
  storedUrl: string | null | undefined,
  userId: string,
  supabaseUrl: string | undefined
): string | null {
  const result = classifyStoredAvatarUrl(storedUrl, userId, supabaseUrl);
  return result && result.owned ? result.path : null;
}

export interface AvatarUploadResult {
  path: string;
  publicUrl: string;
}

export type AvatarRemoveOutcome = 'none' | 'skipped' | 'removed' | 'failed';

export class AvatarService {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || supabaseServer;
    this.logger = createLogger({ service: 'AvatarService' });
  }

  /**
   * Store a new picture at `<userId>/<uuid>.<ext>`. `contentType` is the
   * SNIFFED type, never the browser's claim, and the extension comes from it.
   * Never overwrites. Never throws.
   */
  async upload(
    userId: string,
    bytes: ArrayBuffer,
    contentType: AvatarMimeType
  ): Promise<{ data: AvatarUploadResult | null; error: SafeStorageError | null }> {
    const path = `${userId}/${randomUUID()}.${AVATAR_EXTENSIONS[contentType]}`;
    try {
      const bucket = this.supabase.storage.from(AVATAR_BUCKET);
      const { error } = await bucket.upload(path, bytes, {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw error;
      const { data } = bucket.getPublicUrl(path);
      return { data: { path, publicUrl: data.publicUrl }, error: null };
    } catch (error) {
      const safe = safeStorageError(error);
      this.logger.error({ userId, err: safe }, 'Avatar upload failed');
      return { data: null, error: safe };
    }
  }

  /**
   * Remove the file `upload` just created, because its URL could not be saved
   * (C-19, the intake route's precedent). Only a path inside the user's own
   * folder is accepted. A failure is logged and leaves an orphan in that folder.
   */
  async removeOwnNew(userId: string, path: string): Promise<boolean> {
    if (!path.startsWith(`${userId}/`)) {
      this.logger.error({ userId }, 'Refused to remove a new avatar outside the account folder');
      return false;
    }
    try {
      const { error } = await this.supabase.storage.from(AVATAR_BUCKET).remove([path]);
      if (error) throw error;
      return true;
    } catch (error) {
      this.logger.error({ userId, err: safeStorageError(error) }, 'Could not remove the new avatar after a failed save');
      return false;
    }
  }

  /**
   * Delete the file a previously stored URL names, only if C-20 proves it is
   * this user's (see the header). Anything else is skipped and logged at info
   * with its classification, never the URL. A storage failure is logged at
   * warn and reported, never thrown: the caller's response does not change.
   */
  async removeIfOwned(userId: string, storedUrl: string | null | undefined): Promise<AvatarRemoveOutcome> {
    const ownership = classifyStoredAvatarUrl(storedUrl, userId, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!ownership) return 'none';
    if (!ownership.owned) {
      this.logger.info({ userId, reason: ownership.reason }, 'Previous avatar not deleted');
      return 'skipped';
    }
    try {
      const { error } = await this.supabase.storage.from(AVATAR_BUCKET).remove([ownership.path]);
      if (error) throw error;
      return 'removed';
    } catch (error) {
      this.logger.warn(
        { userId, kind: ownership.kind, err: safeStorageError(error) },
        'Could not delete the previous avatar'
      );
      return 'failed';
    }
  }
}

export const avatarService = new AvatarService();
