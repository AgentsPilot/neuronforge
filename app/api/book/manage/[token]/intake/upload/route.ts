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
 *
 * ERRORS CARRY A CODE, NOT JUST A SENTENCE
 *
 * This page is read by the business's client, in the business's language. An
 * English sentence from an API is not a message that page can show — so every
 * refusal names a `code`, and the page owns the wording. `error` stays for the
 * log and for anything that is not the page.
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
import {
  INTAKE_UPLOAD_MAX_BYTES,
  INTAKE_UPLOAD_MIME_TYPES,
} from '@/lib/business-os/intake/types';

const logger = createLogger({ module: 'API', service: 'IntakeUpload' });

const BUCKET = 'contact-documents';

const MAX_BYTES = INTAKE_UPLOAD_MAX_BYTES;

/**
 * What an intake may carry.
 *
 * The list itself lives in `intake/types.ts`, because the picker on the public
 * page uses it too and the two must not disagree — a file the browser offers
 * and the server then refuses is the worst version of this.
 *
 * It was images and PDF only, which is not what a client has to hand. People
 * are asked for a form they filled in Word, a spreadsheet of measurements, a
 * scan their doctor emailed them; refusing those tells someone their own
 * document is the wrong kind of document, and the business never receives it.
 *
 * What stays out is what the type cannot vouch for — archives hide their
 * contents from this check, and executables have no business in an intake
 * answer. This endpoint is reachable by anyone holding a booking link, so it is
 * an allow-list rather than a deny-list.
 */
const ALLOWED = new Set<string>(INTAKE_UPLOAD_MIME_TYPES);

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

    /*
     * The client's email comes from the CONTACT, not the booking.
     *
     * `scheduling_bookings.client_email` was dropped — crm_contacts is the
     * single source of truth for client data, and the booking joins to it. This
     * selected the dropped column, and because the error was discarded (only
     * `data` was destructured) a `42703` arrived here as `booking === null` and
     * was reported to the client as "Booking not found" — a 404 for a booking
     * that exists and is confirmed.
     */
    const { data: booking, error: bookingError } = await supabaseServer
      .from('scheduling_bookings')
      .select('id, user_id, contact_id, status, intake_completed_at, contact:crm_contacts(email)')
      .eq('id', payload.bookingId)
      .maybeSingle<{
        id: string;
        user_id: string;
        contact_id: string;
        status: string;
        intake_completed_at: string | null;
        contact: { email: string | null } | null;
      }>();

    if (bookingError) {
      // Never a 404. A query that failed is not a booking that is absent, and
      // saying so cost an afternoon.
      requestLogger.error(
        { err: bookingError, bookingId: payload.bookingId },
        'Could not read the booking for an intake upload'
      );
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }

    if (!booking) {
      return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
    }

    // The token names an email; the contact names an email. They have to agree,
    // or a token is a key to more than the one booking it was minted for.
    if (booking.contact?.email !== payload.email) {
      requestLogger.warn({ bookingId: booking.id }, 'Token email does not match the booking');
      return NextResponse.json({ success: false, error: 'Invalid link' }, { status: 401 });
    }

    if (booking.status === 'cancelled') {
      return NextResponse.json(
        { success: false, code: 'cancelled', error: 'This booking was cancelled' },
        { status: 400 }
      );
    }

    // Already answered: accepting more files would attach them to a submission
    // nobody is going to look at again.
    if (booking.intake_completed_at) {
      return NextResponse.json(
        { success: false, code: 'already_submitted', error: 'This form has already been submitted' },
        { status: 400 }
      );
    }

    // The same gate as everywhere else. An unpublished form is not collecting.
    const { form } = await resolveIntakeForSending(booking.user_id);
    if (!form) {
      return NextResponse.json(
        { success: false, code: 'not_collecting', error: 'This form is no longer being collected' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const questionId = String(formData.get('questionId') || '');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, code: 'no_file', error: 'No file received' },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, code: 'file_too_large', error: 'That file is too large. The limit is 10MB.' },
        { status: 400 }
      );
    }

    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        {
          success: false,
          code: 'file_type',
          error: 'That file type is not accepted.',
        },
        { status: 400 }
      );
    }

    // The question has to be one this form actually asks. Without the check,
    // the id is an arbitrary string a caller chose, and the document's
    // description would describe a question that does not exist.
    const question = form.questions.find(item => item.id === questionId);
    if (!question) {
      return NextResponse.json(
        { success: false, code: 'unknown_question', error: 'Unknown question' },
        { status: 400 }
      );
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
