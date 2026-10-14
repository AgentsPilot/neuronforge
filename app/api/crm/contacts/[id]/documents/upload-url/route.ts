/**
 * POST /api/crm/contacts/[id]/documents/upload-url
 *
 * Hand the browser a one-time URL it can upload a file to directly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE FILE MUST NOT COME THROUGH HERE
 *
 * Uploads used to be base64-encoded into a JSON body and posted to the
 * documents route. Two things made that a hard ceiling nobody could see:
 *
 *   · a serverless function's request body is capped at 4.5MB by the platform,
 *     and the cap is applied at the EDGE — the handler never runs, so it cannot
 *     explain itself. The browser gets a non-JSON error, `response.json()`
 *     throws, and the catch prints a generic failure with no reason in it.
 *
 *   · base64 adds a third. So the real limit was about 3.3MB while the UI, the
 *     Zod schema and the bucket all said 50MB.
 *
 * A 4.47MB PDF was refused that way, and a scan or a phone photo — the two
 * formats this feature was extended to accept — are routinely larger than
 * 3.3MB. The type was allowed and the size killed it.
 *
 * So the file goes from the browser straight to Storage, and this route hands
 * out the permission to do that: a token of a few hundred bytes, which fits in
 * any request body. The platform is no longer in the file's path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS STILL CHECKED HERE
 *
 * Everything that decides whether the upload may happen at all. The signed URL
 * is scoped to ONE path that this route picks, so the browser cannot choose
 * where the file lands or whose folder it lands in:
 *
 *   · the caller owns the contact (`.eq('user_id')`, CLAUDE.md rule 4);
 *   · the type is on `ATTACHABLE_DOCUMENT_TYPES`, the same list the bucket and
 *     the documents route use;
 *   · the size is within the bucket's own limit.
 *
 * Storage enforces the type and the size again on its side — the bucket carries
 * both — so a client that lies about either is refused by the bucket rather
 * than trusted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import {
  ATTACHABLE_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_MB,
} from '@/lib/crm/attachableDocumentTypes';

const logger = createLogger({ module: 'ContactDocumentUploadUrlAPI' });

const BUCKET = 'contact-documents';

const requestSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1),
  file_size: z.number().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id: contactId } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = requestSchema.parse(await request.json());

    /* The contact must be theirs. The signed URL is permission to write into
       this account's folder, so this is the check that scopes it. */
    const { data: contact, error: contactError } = await crmContactRepository.findById(
      contactId,
      user.id
    );

    if (contactError || !contact) {
      return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 });
    }

    /*
     * Refused with a CODE as well as a sentence, matching the documents route:
     * the sentence is a fallback for a caller that just prints `error`, and the
     * code is what a caller with a phrasebook keys off, so a Hebrew owner is
     * not shown an English refusal.
     */
    if (!ATTACHABLE_DOCUMENT_TYPES.includes(validated.mime_type)) {
      requestLogger.warn(
        { userId: user.id, mimeType: validated.mime_type },
        'Upload URL refused: unsupported file type'
      );
      return NextResponse.json(
        {
          success: false,
          code: 'unsupported_file_type',
          mime_type: validated.mime_type,
          error: `That file type (${validated.mime_type}) cannot be attached. Use a PDF, a Word or Excel document, a scan, or a photo.`,
        },
        { status: 400 }
      );
    }

    if (validated.file_size > MAX_DOCUMENT_BYTES) {
      requestLogger.warn(
        { userId: user.id, fileSize: validated.file_size },
        'Upload URL refused: file too large'
      );
      return NextResponse.json(
        {
          success: false,
          code: 'file_too_large',
          max_bytes: MAX_DOCUMENT_BYTES,
          error: `That file is too large. The limit is ${MAX_DOCUMENT_MB}MB.`,
        },
        { status: 400 }
      );
    }

    /*
     * The path, chosen HERE and not by the caller — it is the other half of
     * scoping the permission. Same shape the documents route has always used,
     * so existing objects and new ones live together.
     */
    const timestamp = Date.now();
    const sanitizedFileName = validated.file_name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${user.id}/${contactId}/${timestamp}_${sanitizedFileName}`;

    const { data, error } = await supabaseServer.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      requestLogger.error({ err: error, userId: user.id }, 'Failed to create a signed upload URL');
      return NextResponse.json(
        { success: false, error: 'Could not start the upload' },
        { status: 500 }
      );
    }

    requestLogger.info(
      { userId: user.id, contactId, fileSize: validated.file_size },
      'Signed upload URL issued'
    );

    return NextResponse.json({
      success: true,
      data: { path: data.path, token: data.token, bucket: BUCKET },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined,
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, contactId }, 'Failed to issue a signed upload URL');
    return NextResponse.json(
      { success: false, error: 'Could not start the upload' },
      { status: 500 }
    );
  }
}
