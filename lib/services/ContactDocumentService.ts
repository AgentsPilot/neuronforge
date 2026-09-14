/**
 * Put a file on a client's record — one implementation, two doors.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The Files tab has always uploaded through `POST /api/crm/contacts/[id]/
 * documents`. The chat can now attach a document to a quote it is about to
 * send, and the two paths have to agree about every part of this: which bucket,
 * how the path is built, what happens to the stored object when the row fails
 * to insert. A second copy would drift on the first of those anyone changed,
 * and the drift would be silent — an orphaned file in storage, or a row
 * pointing at nothing.
 *
 * The caller owns AUTHORISATION. This takes a userId and a contactId that the
 * caller has already established belong together, because the two doors check
 * that differently: the route looks the contact up, and the chat reads it off a
 * write the user has already been shown.
 *
 * @module lib/services
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  contactDocumentsRepository,
  type DocumentType,
} from '@/lib/repositories/ContactDocumentsRepository';

const logger = createLogger({ service: 'ContactDocumentService' });

const BUCKET = 'contact-documents';

/** 50MB, matching the bucket's own limit. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** What the bucket will accept. Kept beside the bucket it configures. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
];

export interface UploadedDocument {
  id: string;
  fileName: string;
}

export type UploadOutcome =
  | { ok: true; document: UploadedDocument }
  | { ok: false; reason: 'storage' | 'record' | 'unsupported_type' };

async function ensureBucket(): Promise<boolean> {
  const { data: buckets } = await supabaseServer.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) return true;

  const { error } = await supabaseServer.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_DOCUMENT_BYTES,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });

  if (error) {
    logger.error({ err: error, bucket: BUCKET }, 'Failed to create storage bucket');
    return false;
  }

  logger.info({ bucket: BUCKET }, 'Created storage bucket');
  return true;
}

/**
 * Store a file against a contact and record it.
 *
 * @param content the file's bytes, already decoded — the callers receive base64
 *   over the wire and decode at their own boundary, so this never sees an
 *   encoding it has to guess about.
 */
export async function uploadContactDocument(args: {
  userId: string;
  contactId: string;
  name: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  documentType?: DocumentType;
  description?: string;
  tags?: string[];
}): Promise<UploadOutcome> {
  if (!ALLOWED_MIME_TYPES.includes(args.mimeType)) {
    return { ok: false, reason: 'unsupported_type' };
  }

  if (!(await ensureBucket())) return { ok: false, reason: 'storage' };

  // Namespaced by owner and contact, so a listing is scoped by prefix and two
  // files of the same name never collide.
  const safeName = args.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `${args.userId}/${args.contactId}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabaseServer.storage
    .from(BUCKET)
    .upload(storagePath, args.content, { contentType: args.mimeType, upsert: false });

  if (uploadError) {
    logger.error({ err: uploadError, userId: args.userId }, 'Failed to upload file to storage');
    return { ok: false, reason: 'storage' };
  }

  const result = await contactDocumentsRepository.create({
    user_id: args.userId,
    contact_id: args.contactId,
    name: args.name,
    document_type: args.documentType || 'other',
    file_name: args.fileName,
    file_size: args.content.length,
    mime_type: args.mimeType,
    storage_path: storagePath,
    description: args.description,
    tags: args.tags,
  });

  if (result.error || !result.data) {
    // The object outlives the row it was meant to have, so remove it. A file
    // nothing points at is invisible, permanent and paid for.
    await supabaseServer.storage.from(BUCKET).remove([storagePath]);
    logger.error({ err: result.error, userId: args.userId }, 'Failed to create document record');
    return { ok: false, reason: 'record' };
  }

  return {
    ok: true,
    document: { id: result.data.id as string, fileName: args.fileName },
  };
}
