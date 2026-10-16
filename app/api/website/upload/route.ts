/**
 * Website picture upload.
 *
 * POST - store one picture for the website builder in the business's own
 * folder of the website picture bucket, and record it in the picture library.
 *
 * WHY THE SERVER DECIDES THE TARGET (F-27, `tenant-isolation-guard`).
 * This route writes with the service role, so Storage RLS does not apply to it:
 * the bucket's owner-scoped policies are never consulted on this path. It used
 * to take the bucket and the folder from the caller's form, which let any
 * signed-in account put a file into any bucket, private ones included, under
 * any folder, another account's included. Now no caller-supplied value reaches
 * `.from()` or the object name:
 *   - the bucket is the constant `WEBSITE_IMAGE_BUCKET`. A `bucket` field is
 *     still accepted when it equals that constant (stale browser bundles send
 *     it) and refused otherwise, so a probe fails loudly instead of quietly
 *     succeeding somewhere else (DC-1, ruling Q-6);
 *   - the object name is `<session user id>/[logos/]<uuid>.<ext>`.
 *
 * `folder` IS A SELECTOR, NOT A PATH (DC-2). It is read only to decide whether
 * the picture goes in the owner's `logos/` sub-folder: the setup wizard sends
 * `logos`, the business profile section sends `<user id>/logos`. Whatever else
 * it says is ignored. See `websiteUploadPath`.
 *
 * The type and the stored extension come from the file's first bytes, never
 * from `file.type` or the file name, and SVG is refused (DC-3, DC-4). The limit
 * is 4 MB, checked from `Content-Length` before the body is parsed and from the
 * file afterwards (DC-5). Every client error is a fixed string with a `code`;
 * storage and database messages stay in the logs (DC-6).
 *
 * The success body is top-level `{ success, url, path, bucket }` rather than
 * the usual `{ success, data }`: both browser callers, and every bundle already
 * open in a tab, read `result.url` (ruling Q-5).
 *
 * There is no DELETE. It had no caller anywhere and took the bucket from the
 * query string on a service-role delete, so it was removed rather than
 * hardened (F-27 DC-7, ruling Q-1). Next.js answers 405.
 *
 * Storage stays in the route: CLAUDE.md rule 1 governs database access, and
 * the database write goes through `userMediaRepository` (ruling Q-3).
 *
 * @module app/api/website/upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';
import { IMAGE_SIGNATURE_BYTES, sniffImageSignature } from '@/lib/validation/imageSignature';
import {
  WEBSITE_IMAGE_BUCKET,
  WEBSITE_IMAGE_EXTENSIONS,
  WEBSITE_IMAGE_LOGO_FOLDER,
  WEBSITE_IMAGE_MAX_BYTES,
  WEBSITE_IMAGE_MIME_TYPES,
  websiteUploadPath,
  type WebsiteUploadErrorCode,
} from '@/lib/validation/websiteImage';

const logger = createLogger({ module: 'WebsiteUploadAPI' });

/** Room for the multipart boundaries and the small text fields around the file. */
const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;

/** Stored in `user_media.description`; the file name is the only description an upload has. */
const DESCRIPTION_MAX_CHARS = 120;

/** An empty form field means "not sent", as `|| null` did before (SA-F27-3). */
const emptyIsAbsent = (value: unknown) => (value === '' ? undefined : value);

/*
 * The whole form, a closed set (DC-11). `section` and `aspect` follow the
 * sibling `media/generate` route, since both end up in `user_media` (DC-12).
 */
const UploadFormSchema = z
  .object({
    file: z.instanceof(Blob).refine(file => file.size > 0),
    bucket: z.literal(WEBSITE_IMAGE_BUCKET).optional(),
    folder: z.preprocess(emptyIsAbsent, z.string().max(200).optional()),
    section: z.preprocess(emptyIsAbsent, z.string().trim().max(40).optional()),
    aspect: z.preprocess(emptyIsAbsent, z.enum(['wide', 'portrait', 'square']).optional()),
  })
  .strict();

const MESSAGES: Record<WebsiteUploadErrorCode, string> = {
  unauthorized: 'Unauthorized',
  invalid_request: 'Invalid upload',
  file_type: 'Please choose a PNG, JPEG, WebP or GIF image',
  file_too_large: 'Image must be 4 MB or smaller',
  upload_failed: 'Could not store the picture',
  internal: 'Internal server error',
};

function fail(status: number, code: WebsiteUploadErrorCode, details?: string) {
  return NextResponse.json(
    {
      success: false,
      error: MESSAGES[code],
      code,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return fail(401, 'unauthorized');
    }

    const refuse = (status: number, code: WebsiteUploadErrorCode, reason: string, size?: number) => {
      // `reason` is a fixed code. Never the bucket, folder, file name or path:
      // those are caller text.
      requestLogger.warn({ userId: user.id, reason, size }, 'Website upload refused');
      return fail(status, code);
    };

    // V-1
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('multipart/form-data')) {
      return refuse(400, 'invalid_request', 'not_multipart');
    }

    // V-2: refuse an oversize body before buffering it. Only when the header is
    // present; a chunked body is caught by V-5 instead.
    const declaredLength = Number(request.headers.get('content-length'));
    if (
      request.headers.has('content-length') &&
      Number.isFinite(declaredLength) &&
      declaredLength > WEBSITE_IMAGE_MAX_BYTES + MULTIPART_ALLOWANCE_BYTES
    ) {
      return refuse(413, 'file_too_large', 'content_length_over_limit', declaredLength);
    }

    // V-3
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return refuse(400, 'invalid_request', 'form_unreadable');
    }

    // V-4: every key exactly once, then the closed schema.
    const raw: Record<string, FormDataEntryValue> = {};
    for (const key of new Set(formData.keys())) {
      const values = formData.getAll(key);
      if (values.length !== 1) {
        return refuse(400, 'invalid_request', 'repeated_field');
      }
      raw[key] = values[0];
    }
    const parsed = UploadFormSchema.safeParse(raw);
    if (!parsed.success) {
      const isBucketProbe = parsed.error.issues.some(issue => issue.path[0] === 'bucket');
      return refuse(400, 'invalid_request', isBucketProbe ? 'bucket_not_allowed' : 'invalid_form');
    }
    const { file, folder, section, aspect } = parsed.data;

    // V-5
    if (file.size > WEBSITE_IMAGE_MAX_BYTES) {
      return refuse(413, 'file_too_large', 'file_over_limit', file.size);
    }

    // V-6: the first bytes decide, before the rest of the file is read.
    const head = new Uint8Array(await file.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer());
    const sniffed = sniffImageSignature(head);
    if (!sniffed || !WEBSITE_IMAGE_MIME_TYPES.includes(sniffed)) {
      return refuse(400, 'file_type', 'not_an_allowed_image', file.size);
    }

    const storagePath = websiteUploadPath(user.id, folder, WEBSITE_IMAGE_EXTENSIONS[sniffed], crypto.randomUUID());
    const isLogo = storagePath.startsWith(`${user.id}/${WEBSITE_IMAGE_LOGO_FOLDER}/`);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data, error: uploadError } = await supabaseServer.storage
      .from(WEBSITE_IMAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: sniffed,
        cacheControl: '3600',
        // Never replace an existing object: a fresh uuid per upload means a
        // collision is a fault, not an edit.
        upsert: false,
      });

    if (uploadError || !data) {
      requestLogger.error({ err: uploadError, userId: user.id }, 'Website upload storage write failed');
      return fail(500, 'upload_failed');
    }

    const { data: urlData } = supabaseServer.storage
      .from(WEBSITE_IMAGE_BUCKET)
      .getPublicUrl(data.path);

    /*
     * The business now OWNS this picture, so the library has to know.
     *
     * The file was stored and the URL handed back, and nothing was written to
     * `user_media` — so an uploaded photograph existed only in the one block it
     * was uploaded into. It could not be reused on another page, and it never
     * appeared in the picker, which is the one place an owner looks for "the
     * photo I added last week".
     *
     * Logos are recorded too, as they always have been: they arrive here for
     * the same bucket as every other picture. Whether a logo belongs in the
     * picture library is an open question (F-27 FU-5), not decided here.
     *
     * Never fatal, for the same reason `StockImageService` is not: the file is
     * uploaded and the block is about to render it. Losing the row costs a
     * thumbnail in the library, which is not worth failing an upload for.
     * `record` logs and returns null itself.
     */
    const fileName = 'name' in file && typeof file.name === 'string' ? file.name : '';
    await userMediaRepository.record({
      userId: user.id,
      storagePath: data.path,
      publicUrl: urlData.publicUrl,
      source: 'upload',
      section: section || null,
      aspect: aspect ?? null,
      description: fileName ? fileName.slice(0, DESCRIPTION_MAX_CHARS) : null,
    });

    requestLogger.info(
      { userId: user.id, contentType: sniffed, size: file.size, subFolder: isLogo ? WEBSITE_IMAGE_LOGO_FOLDER : null },
      'Website picture uploaded'
    );

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      path: data.path,
      bucket: WEBSITE_IMAGE_BUCKET,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Website upload failed with exception');
    return fail(500, 'internal', error instanceof Error ? error.message : String(error));
  }
}
