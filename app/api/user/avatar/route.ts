/**
 * POST / DELETE /api/user/avatar
 *
 * The profile picture, server-side (settings drawer D-3, C-19, C-20, C-23).
 * The hook `useAvatarUpload` used to read and write `profiles` and the public
 * `avatars` bucket from the browser (CLAUDE.md rule 1), accepted any `image/*`
 * including SVG (F-16), and its Remove deleted a path that does not exist, so
 * a removed picture stayed public (F-8).
 *
 *   POST    multipart/form-data with exactly one field, `file`. The type is
 *           decided by the file's first bytes (PNG, JPEG, WebP, GIF), never by
 *           the browser's claim or the file name (SA ruling Q-1). Max 4 MB.
 *           Stored at `<userId>/<uuid>.<ext>`. Returns `{ avatar_url }`.
 *   DELETE  no body, no query. Clears the stored URL, then deletes the file.
 *
 * Order (C-19). POST: read the old URL, upload the new file, save its URL (on
 * failure remove the new file), then delete the old file under the C-20
 * ownership check. DELETE: read, clear, then delete under C-20. A failed
 * old-file delete is logged, never fatal: it leaves an orphan, never a broken
 * profile.
 *
 * The user id comes from `getUser()` only. Any query string is a 400, and the
 * form may hold nothing but `file`, so a request that tries to name an
 * account (`userId`, `path`, `bucket`) is refused, not ignored (C-23, Q-10).
 *
 * Storage is reached only through `AvatarService` (the one owner of the
 * bucket, service role, reason in its header); the table only through
 * `UserProfileRepository`. No storage or database message reaches the client
 * in any environment; refusals log `{ userId, code }` only (SA-D3-9), never a
 * file name, a claimed type, a URL or a path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger, type Logger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { avatarService } from '@/lib/services/AvatarService';
import { AVATAR_MAX_BYTES, AVATAR_SNIFF_BYTES, sniffImageType } from '@/lib/validation/avatar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'UserAvatarAPI' });
const auditTrail = AuditTrailService.getInstance();

/** Room for the multipart boundary and part headers around a 4 MB file (V-2). */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

type RefusalCode = 'invalid_request' | 'file_type' | 'file_too_large' | 'unauthorized';

const MESSAGES = {
  invalid_request: 'Invalid upload',
  file_type: 'Please choose a PNG, JPEG, WebP or GIF image',
  file_too_large: 'Image must be 4 MB or smaller',
  unauthorized: 'Unauthorized',
  upload_failed: 'Could not store the picture',
  save_failed: 'Could not save the picture',
} as const;

/**
 * V-4: the form's keys are exactly `['file']` (one entry), and that entry is a
 * non-empty Blob. `z.instanceof(Blob)`, not `File`, which is not a global on
 * every Node the tests run on.
 */
const avatarFormSchema = z.object({
  keys: z.tuple([z.literal('file')]),
  files: z.tuple([z.instanceof(Blob).refine((blob) => blob.size > 0)]),
});

function refuse(requestLogger: Logger, userId: string, status: 400 | 413, code: Exclude<RefusalCode, 'unauthorized'>) {
  // SA-D3-9: the code only. Never the claimed type, the file name or a field value.
  requestLogger.info({ userId, code }, 'Avatar request refused');
  return NextResponse.json({ success: false, error: MESSAGES[code], code }, { status });
}

function unauthorized() {
  return NextResponse.json({ success: false, error: MESSAGES.unauthorized, code: 'unauthorized' }, { status: 401 });
}

function serverError(code: 'upload_failed' | 'save_failed') {
  return NextResponse.json({ success: false, error: MESSAGES[code], code }, { status: 500 });
}

function internalError(error: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Internal server error',
      code: 'internal',
      details:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    },
    { status: 500 }
  );
}

/** A query string on either method names nothing we read, so it is refused (Q-10). */
function hasQuery(request: NextRequest): boolean {
  return request.nextUrl.search.length > 0;
}

/**
 * V-2 (SA-D3-6): only a header that parses as a non-negative integer is
 * checked. Missing or unparsable goes on, and the file-size check (V-5) is the
 * authoritative one.
 */
function declaredBodyTooLarge(request: NextRequest): boolean {
  const header = request.headers.get('content-length');
  if (!header || !/^\d+$/.test(header.trim())) return false;
  return Number(header.trim()) > AVATAR_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return unauthorized();
    const userId = user.id;

    if (hasQuery(request)) return refuse(requestLogger, userId, 400, 'invalid_request');

    // V-1
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return refuse(requestLogger, userId, 400, 'invalid_request');
    }

    // V-2, before the body is buffered.
    if (declaredBodyTooLarge(request)) return refuse(requestLogger, userId, 413, 'file_too_large');

    // V-3
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return refuse(requestLogger, userId, 400, 'invalid_request');
    }

    // V-4
    const parsed = avatarFormSchema.safeParse({ keys: [...form.keys()], files: form.getAll('file') });
    if (!parsed.success) return refuse(requestLogger, userId, 400, 'invalid_request');
    const [file] = parsed.data.files;

    // V-5: authoritative. Exactly 4 MB is allowed.
    if (file.size > AVATAR_MAX_BYTES) return refuse(requestLogger, userId, 413, 'file_too_large');

    // V-6: the bytes decide. The first bytes are read before the whole file.
    const head = new Uint8Array(await file.slice(0, AVATAR_SNIFF_BYTES).arrayBuffer());
    const sniffed = sniffImageType(head);
    if (!sniffed) return refuse(requestLogger, userId, 400, 'file_type');

    const previous = await userProfileRepository.findAvatarUrl(userId);
    if (previous.error) {
      // Already reduced to { code, message } by the repository (CR-1).
      requestLogger.error({ userId, err: previous.error }, 'Avatar URL read failed');
      return serverError('save_failed');
    }

    const uploaded = await avatarService.upload(userId, await file.arrayBuffer(), sniffed);
    if (uploaded.error || !uploaded.data) {
      // AvatarService logged the reduced storage error.
      return serverError('upload_failed');
    }
    const { path, publicUrl } = uploaded.data;

    const saved = await userProfileRepository.setAvatarUrl(userId, publicUrl);
    if (saved.error) {
      requestLogger.error({ userId, err: saved.error }, 'Avatar URL save failed');
      // Nothing points at the new file: remove it rather than leave an orphan.
      await avatarService.removeOwnNew(userId, path);
      return serverError('save_failed');
    }

    // C-20: only a file proven to be this user's. Never fatal.
    await avatarService.removeIfOwned(userId, previous.data);

    auditTrail
      .log({
        action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
        entityType: 'user',
        entityId: userId,
        userId,
        details: { fields: ['avatar_url'], change: 'uploaded' },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId, change: 'uploaded', contentType: sniffed, bytes: file.size }, 'Avatar uploaded');
    return NextResponse.json({ success: true, data: { avatar_url: publicUrl } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Avatar upload request failed');
    return internalError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return unauthorized();
    const userId = user.id;

    // The body is never read.
    if (hasQuery(request)) return refuse(requestLogger, userId, 400, 'invalid_request');

    const previous = await userProfileRepository.findAvatarUrl(userId);
    if (previous.error) {
      requestLogger.error({ userId, err: previous.error }, 'Avatar URL read failed');
      return serverError('save_failed');
    }

    if (!previous.data) {
      // Nothing stored (or no profiles row): idempotent, nothing to clear or delete.
      requestLogger.info({ userId }, 'No avatar to remove');
      return NextResponse.json({ success: true, data: { avatar_url: null } });
    }

    const cleared = await userProfileRepository.clearAvatarUrl(userId);
    if (cleared.error) {
      requestLogger.error({ userId, err: cleared.error }, 'Avatar URL clear failed');
      return serverError('save_failed');
    }

    // C-20, after the clear: the profile never points at a deleted file.
    await avatarService.removeIfOwned(userId, previous.data);

    auditTrail
      .log({
        action: AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED,
        entityType: 'user',
        entityId: userId,
        userId,
        details: { fields: ['avatar_url'], change: 'removed' },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info({ userId, change: 'removed' }, 'Avatar removed');
    return NextResponse.json({ success: true, data: { avatar_url: null } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Avatar removal request failed');
    return internalError(error);
  }
}
