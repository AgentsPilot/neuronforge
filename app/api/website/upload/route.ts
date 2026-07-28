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
