/**
 * Website Media Upload API
 * POST - Upload images/files to Supabase Storage
 * DELETE - Remove uploaded file
 *
 * This endpoint handles file uploads for website blocks (hero images, gallery, team photos, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { userMediaRepository } from '@/lib/repositories/UserMediaRepository';

const logger = createLogger({ module: 'WebsiteUploadAPI' });

// Allowed MIME types
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml'
];

// Max file size: 5MB
const MAX_SIZE = 5 * 1024 * 1024;

// Default bucket
const DEFAULT_BUCKET = 'website-images';

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const folder = (formData.get('folder') as string) || user.id;
    const bucket = (formData.get('bucket') as string) || DEFAULT_BUCKET;
    // What the picture is FOR, when the caller knows. Recorded with the row so
    // the picker can offer a hero crop back for a hero slot.
    const section = (formData.get('section') as string) || null;
    const aspect = (formData.get('aspect') as string) || null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      requestLogger.warn({ fileType: file.type }, 'Invalid file type');
      return NextResponse.json(
        { success: false, error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP, SVG' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_SIZE) {
      requestLogger.warn({ fileSize: file.size }, 'File too large');
      return NextResponse.json(
        { success: false, error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Generate unique filename with user prefix for security
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const extension = originalName.split('.').pop() || 'jpg';
    const fileName = `${folder}/${timestamp}-${randomStr}.${extension}`;

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    const { data, error: uploadError } = await supabaseServer.storage
      .from(bucket)
      .upload(fileName, buffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      requestLogger.error({ err: uploadError, fileName, bucket }, 'Upload failed');
      return NextResponse.json(
        { success: false, error: uploadError.message },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from(bucket)
      .getPublicUrl(data.path);

    /*
     * The business now OWNS this picture, so the library has to know.
     *
     * The file was stored and the URL handed back, and nothing was written to
     * `user_media` — so an uploaded photograph existed only in the one block it
     * was uploaded into. It could not be reused on another page, and it never
     * appeared in the picker, which is the one place an owner looks for "the
     * photo I added last week". Stock photographs found for a business were
     * recorded from the start; the owner's own were not.
     *
     * Only for the website bucket. This endpoint also takes logo uploads, and a
     * logo is not one of the pictures to offer for a hero slot.
     *
     * Never fatal, for the same reason `StockImageService` is not: the file is
     * uploaded and the block is about to render it. Losing the row costs a
     * thumbnail in the library, which is not worth failing an upload for.
     */
    if (bucket === DEFAULT_BUCKET) {
      await userMediaRepository.record({
        userId: user.id,
        storagePath: data.path,
        publicUrl: urlData.publicUrl,
        source: 'upload',
        section,
        aspect,
        description: file.name,
      });
    }

    requestLogger.info(
      { userId: user.id, fileName, bucket, path: data.path },
      'File uploaded successfully'
    );

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      path: data.path,
      bucket
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Upload failed with exception');
    return NextResponse.json(
      { success: false, error: 'Upload failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    const bucket = searchParams.get('bucket') || DEFAULT_BUCKET;

    if (!path) {
      return NextResponse.json(
        { success: false, error: 'No path provided' },
        { status: 400 }
      );
    }

    // Security check: Only allow deletion of files in user's folder
    if (!path.startsWith(`${user.id}/`)) {
      requestLogger.warn({ path, userId: user.id }, 'Unauthorized delete attempt');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabaseServer.storage
      .from(bucket)
      .remove([path]);

    if (deleteError) {
      requestLogger.error({ err: deleteError, path, bucket }, 'Delete failed');
      return NextResponse.json(
        { success: false, error: deleteError.message },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id, path, bucket }, 'File deleted successfully');

    return NextResponse.json({ success: true });
  } catch (error) {
    requestLogger.error({ err: error }, 'Delete failed with exception');
    return NextResponse.json(
      { success: false, error: 'Delete failed' },
      { status: 500 }
    );
  }
}
