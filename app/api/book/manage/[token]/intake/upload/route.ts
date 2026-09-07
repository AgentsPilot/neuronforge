/**
 * A file from someone who is not signed in.
 *
 *   POST /api/book/manage/[token]/intake/upload   (multipart)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The client filling an intake has no account. Their only credential is the
 * booking token in the link the business emailed them, so that token is what
 * authorises this — the same JWT the intake page itself is verified with, and
 * checked the same way: decoded, then matched against the booking's own contact
 * email, so a valid token for one booking cannot upload against another.
 *
 * A public signed upload URL would have been less code and a write anyone could
 * make.
 *
 * WHERE THE FILE GOES
 *
 * Into `crm_contact_documents` with `document_type: 'intake_form'`, which means
 * it appears in the contact drawer's Files tab beside everything else about
 * that client. A file that lived only inside a form's answers would be filed
 * somewhere nobody thinks to look for a client's documents — and the category
 * already existed, waiting for something to write it.
 *
 * The answer stores the returned document id, so the intake view and the Files
 * tab are two views of one file rather than two copies of it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module app/api/book/manage/[token]/intake/upload
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { verifyBookingToken } from '@/lib/services/BookingEmailService';
import { contactDocumentsRepository } from '@/lib/repositories/ContactDocumentsRepository';
import { resolveIntakeForSending } from '@/lib/business-os/intake/resolveIntake';

const logger = createLogger({ module: 'API', service: 'IntakeUpload' });

const BUCKET = 'contact-documents';

/** 10MB. Generous for a photograph, mean enough that a video is refused. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * What an intake may carry: images, and the document formats a client actually
 * has. Deliberately narrower than the owner-side uploader — this endpoint is
 * reachable by anyone holding a booking link.
 */
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/gif',
  'application/pdf',
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { token } = await params;
    const payload = verifyBookingToken(token);

    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 401 });
    }

    const { data: booking } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, contact_id, client_email, status, intake_completed_at')
      .eq('id', payload.bookingId)
      .maybeSingle();

    if (!booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    // The token names an email; the booking names an email. They have to agree,
    // or a token is a key to more than the one booking it was minted for.
    if (booking.client_email !== payload.email) {
      requestLogger.warn({ bookingId: booking.id }, 'Token email does not match the booking');
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 401 });
    }

    if (booking.status === 'cancelled') {
      return NextResponse.json({ success: false, error: 'This booking was cancelled' }, { status: 400 });
    }

    // Already answered: accepting more files would attach them to a submission
    // nobody is going to look at again.
    if (booking.intake_completed_at) {
      return NextResponse.json(
        { success: false, error: 'This form has already been submitted' },
        { status: 400 }
      );
    }

    // The same gate as everywhere else. An unpublished form is not collecting.
    const { form } = await resolveIntakeForSending(booking.user_id);
    if (!form) {
      return NextResponse.json(
        { success: false, error: 'This form is no longer being collected' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const questionId = String(formData.get('questionId') || '');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file received' }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'That file is too large. The limit is 10MB.' },
        { status: 400 }
      );
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { success: false, error: 'That file type is not accepted. Send an image or a PDF.' },
        { status: 400 }
      );
    }

    // The question has to be one this form actually asks. Without the check,
    // the id is an arbitrary string a caller chose, and the document's
    // description would describe a question that does not exist.
    const question = form.questions.find(item => item.id === questionId);
    if (!question) {
      return NextResponse.json({ success: false, error: 'Unknown question' }, { status: 400 });
    }

    const extension = file.name.includes('.') ? file.name.split('.').pop() : undefined;
    const storagePath = `${booking.user_id}/${booking.contact_id}/intake/${crypto.randomUUID()}${
      extension ? `.${extension}` : ''
    }`;

    const { error: uploadError } = await supabaseServer.storage
      .from(BUCKET)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      requestLogger.error({ err: uploadError, bookingId: booking.id }, 'Intake upload failed');
      return NextResponse.json({ success: false, error: 'Could not store that file' }, { status: 500 });
    }

    const { data: document, error: documentError } = await contactDocumentsRepository.create({
      user_id: booking.user_id,
      contact_id: booking.contact_id,
      name: file.name,
      document_type: 'intake_form',
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      storage_path: storagePath,
      storage_bucket: BUCKET,
      // Which question it answers, so the Files tab says what it is rather than
      // showing an orphan filename.
      description: question.label,
    });

    if (documentError || !document) {
      /*
       * The bytes are stored and nothing points at them. Removed rather than
       * left: an unreferenced object in a private bucket is invisible to every
       * screen and counts against storage forever.
       */
      await supabaseServer.storage.from(BUCKET).remove([storagePath]);
      requestLogger.error({ err: documentError }, 'Could not record the intake document');
      return NextResponse.json({ success: false, error: 'Could not store that file' }, { status: 500 });
    }

    requestLogger.info(
      { bookingId: booking.id, documentId: document.id, questionId },
      'Intake file uploaded'
    );

    return NextResponse.json({
      success: true,
      data: { documentId: document.id, name: file.name },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Intake upload failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
