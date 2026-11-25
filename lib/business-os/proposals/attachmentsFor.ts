/**
 * The files attached to a quote — from both places they can live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE READER, TWO ERAS
 *
 * A quote written before 2026-11-10 carries at most one file, in
 * `proposals.document_id`. A quote written after carries any number, in
 * `proposal_attachments`. Three live quotes are in the first group.
 *
 * Every caller goes through this function so none of them has to know which is
 * which. That is the whole reason it exists: the alternative is three call
 * sites each remembering to check two places, and the one that forgets drops a
 * client's file silently.
 *
 * `document_id` comes FIRST. On an old quote it is the only file; on a new one
 * it is unset. It is never both, so the order is stable either way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERVER ONLY
 *
 * Reaches `supabaseServer` with the service role, because one caller is the
 * client's quote page, where there is no session and the signed token is the
 * authorisation. Every query is still scoped by `user_id` — the owner of the
 * quote — so a document id from another business resolves to nothing.
 *
 * @module lib/business-os/proposals
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'proposalAttachments' });

export interface ProposalAttachment {
  /** The `contact_documents` id. */
  id: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  storagePath: string | null;
  storageBucket: string | null;
}

/**
 * What a quote has attached, in the order the owner arranged it.
 *
 * Returns `[]` rather than throwing when a document row has gone missing: a
 * quote whose file was deleted is still a quote, and refusing to render it
 * would make the client's page unopenable over a missing attachment.
 */
export async function attachmentsFor(proposal: {
  id: string;
  user_id: string;
  document_id?: string | null;
}): Promise<ProposalAttachment[]> {
  const { data: joins, error: joinError } = await supabaseServer
    .from('proposal_attachments')
    .select('document_id, position')
    .eq('proposal_id', proposal.id)
    .eq('user_id', proposal.user_id)
    .order('position', { ascending: true });

  if (joinError) {
    /*
     * Logged and survived rather than thrown. Before the table exists — the
     * window between this code deploying and its migration running — this is
     * the error, and a quote that still has its `document_id` must go on
     * showing it rather than failing outright.
     */
    logger.warn({ err: joinError, proposalId: proposal.id }, 'Could not read proposal attachments');
  }

  const ordered: string[] = [];
  if (proposal.document_id) ordered.push(proposal.document_id);
  for (const join of joins ?? []) {
    if (join.document_id && !ordered.includes(join.document_id)) ordered.push(join.document_id);
  }

  if (ordered.length === 0) return [];

  const { data: docs } = await supabaseServer
    .from('contact_documents')
    .select('id, file_name, file_size, mime_type, storage_path, storage_bucket')
    /* Scoped to the quote's owner: a document id belonging to another business
       resolves to nothing rather than to their file. */
    .eq('user_id', proposal.user_id)
    .in('id', ordered);

  const byId = new Map((docs ?? []).map(doc => [doc.id, doc]));

  /* Mapped over `ordered`, not over `docs`, so the owner's arrangement wins
     over whatever order Postgres returned. A missing row drops out. */
  return ordered.flatMap(id => {
    const doc = byId.get(id);
    if (!doc) return [];
    return [
      {
        id: doc.id,
        fileName: doc.file_name,
        fileSize: doc.file_size,
        mimeType: doc.mime_type,
        storagePath: doc.storage_path,
        storageBucket: doc.storage_bucket,
      },
    ];
  });
}
