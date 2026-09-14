/**
 * Attach a document to the quote waiting on the confirmation card.
 *
 * POST /api/business-os/chat-v4/attach
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT HAPPENS HERE AND NOT EARLIER
 *
 * A file has to land on a CLIENT's record, and until the write is parked there
 * is no client — "send David a quote" carries a described reference, not an id,
 * and the chat resolves it (asking if several match) on the way to the card. By
 * the time the card exists, the quote knows exactly whose it is.
 *
 * So the sequence is: dictate the quote, read the card, attach the document,
 * approve. Attaching REPLACES the parked write with one that carries the file,
 * which means a new preview and a new confirmation id — the thing being
 * approved changed, and the store fingerprints its steps precisely so that an
 * approval can never apply to something the user was not shown.
 *
 * A file attached to a quote that is then cancelled stays on the client's Files
 * tab. That is where documents live; it was a real document, deliberately
 * chosen, and silently deleting it would be the surprising outcome.
 *
 * @module app/api/business-os/chat-v4/attach
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { CATALOG } from '@/lib/business-os/catalog';
import { getConfirmationStore } from '@/lib/business-os/bizql/mutate/ConfirmationStore';
import {
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  uploadContactDocument,
} from '@/lib/services/ContactDocumentService';
import type { MutateQuery } from '@/lib/business-os/bizql/types';

const logger = createLogger({ module: 'BusinessChatAttach' });
const auditTrail = AuditTrailService.getInstance();

const RequestSchema = z.object({
  /** The card the user is looking at. Guards against attaching to a stale write. */
  confirmationId: z.string().min(1),
  file_name: z.string().min(1).max(255),
  mime_type: z.string().refine((value) => ALLOWED_MIME_TYPES.includes(value), {
    message: 'That file type cannot be attached',
  }),
  /** Base64, decoded at this boundary and never passed on encoded. */
  file_content: z.string().min(1),
});

/** The step a document can belong to: a quote being created. */
function quoteStep(steps: MutateQuery[]): MutateQuery | undefined {
  return steps.find(
    (step) =>
      step.entity === 'proposals' &&
      (step.action === 'create' || step.action === 'create_and_send')
  );
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      );
    }

    const confirmations = getConfirmationStore();
    const pending = await confirmations.take(user.id);

    if (!pending || pending.confirmationId !== parsed.data.confirmationId) {
      // Either nothing is parked, or the card on screen is not the one the
      // server is holding. Attaching to the wrong write is worse than refusing.
      return NextResponse.json(
        { success: false, error: 'That quote is no longer waiting for approval' },
        { status: 409 }
      );
    }

    const steps = pending.steps as unknown as MutateQuery[];
    const step = quoteStep(steps);

    if (!step) {
      return NextResponse.json(
        { success: false, error: 'A document can only be attached to a quote' },
        { status: 400 }
      );
    }

    /*
     * The client, read off the write the user was already shown.
     *
     * Described references are resolved before parking, so this is a real id
     * belonging to this user — the same check the drawer's upload does by
     * looking the contact up, arrived at from the other direction.
     */
    const contactId = (step.data as Record<string, unknown> | undefined)?.contact_id;

    if (typeof contactId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'That quote has no client to file the document under' },
        { status: 400 }
      );
    }

    const content = Buffer.from(parsed.data.file_content, 'base64');

    if (content.length > MAX_DOCUMENT_BYTES) {
      return NextResponse.json(
        { success: false, error: 'That file is too large to attach' },
        { status: 400 }
      );
    }

    const uploaded = await uploadContactDocument({
      userId: user.id,
      contactId,
      name: parsed.data.file_name,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      content,
      documentType: 'proposal',
    });

    if (!uploaded.ok) {
      requestLogger.error({ userId: user.id, reason: uploaded.reason }, 'Attachment failed');

      // The write is still parked and still valid — re-park it unchanged so the
      // user's "yes" continues to mean something.
      await confirmations.park({
        userId: user.id,
        steps: pending.steps,
        preview: pending.preview,
        utterance: pending.utterance,
        language: pending.language,
        frozenRows: pending.frozenRows,
        names: pending.names,
      });

      return NextResponse.json(
        { success: false, error: 'The file could not be attached. The quote is unchanged.' },
        { status: 502 }
      );
    }

    /*
     * Re-park with the document, and re-preview.
     *
     * The store fingerprints its steps, so a changed write cannot be approved
     * under the old confirmation — which is the property that makes this safe:
     * the user approves the card that names the file, not the one that did not.
     */
    const label =
      CATALOG.entities.proposals.fields.document_id?.labels[pending.language as 'en'] ??
      'document';

    /*
     * Carried in `params`, not in `data`.
     *
     * `data` is mapped to writable columns, and `document_id` is deliberately
     * not one: a writable foreign key has to declare what it references so the
     * executor can prove the caller owns the row, and `contact_documents` is
     * not a catalog entity. Rather than weaken that rule, the id travels beside
     * the write where no plan can put it, and the handler re-checks ownership
     * against this user and this client before it is used.
     */
    const withDocument = steps.map((s) =>
      s === step
        ? { ...s, params: { ...(s.params ?? {}), document_id: uploaded.document.id } }
        : s
    );

    const parked = await confirmations.park({
      userId: user.id,
      steps: withDocument as never,
      preview: [...pending.preview, `${label}: ${uploaded.document.fileName}`],
      utterance: pending.utterance,
      language: pending.language,
      frozenRows: pending.frozenRows,
      names: pending.names,
    });

    auditTrail
      .log({
        action: 'BUSINESS_CHAT_ATTACHMENT',
        userId: user.id,
        entityType: 'proposal',
        entityId: uploaded.document.id,
        resourceName: uploaded.document.fileName,
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    requestLogger.info(
      { userId: user.id, documentId: uploaded.document.id },
      'Document attached to a pending quote'
    );

    return NextResponse.json({
      success: true,
      confirmation: {
        id: parked.confirmationId,
        message: '',
        preview: parked.preview,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Attachment request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
