/**
 * The file types the store accepts, said the same way in every place that says it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: "can't save proposal if loading a proposal file" — a scanned TIFF,
 * refused with "Failed to upload file".
 *
 * Four places held this fact and they had drifted:
 *
 *   the file picker      `accept=".pdf,.doc,.docx,image/*"` — narrower AND wider
 *                        than the truth at once. It hid spreadsheets and text
 *                        files the store takes, and offered every image format
 *                        in existence, including the ones it refuses.
 *   the upload route     a copy of the list, used only when CREATING the bucket,
 *                        and no check of its own on the way in.
 *   ContactDocumentService  another copy, which did check.
 *   the SQL migration    the list the live bucket actually enforces.
 *
 * So a TIFF passed the picker, passed the request — which validated the type as
 * `z.string().min(1)` — and was refused several steps later by Supabase Storage.
 * That refusal became a 500 reading "Failed to upload file", which describes the
 * system failing rather than the file being unsuitable, and gives the owner
 * nothing to act on.
 *
 * WHAT IS PINNED HERE
 *
 * That the one list is the one every side reads, and that the SQL agrees with
 * it. The SQL is unavoidably a separate statement — a bucket's allow-list lives
 * in the database, and `createBucket`'s options apply at creation only, so
 * widening the TypeScript list does nothing to a bucket that already exists.
 * That asymmetry is the whole reason the drift was invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { ATTACHABLE_DOCUMENT_TYPES, ATTACHABLE_ACCEPT } from '../attachableDocumentTypes';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('the list', () => {
  it('takes a scanner\'s output', () => {
    // The format that was reported. A scanned quote is exactly what the
    // attachment field asks for.
    expect(ATTACHABLE_DOCUMENT_TYPES).toContain('image/tiff');
  });

  it('and a phone camera\'s', () => {
    /*
     * An iPhone produces HEIC by default. A business photographing a document
     * on their phone is the most likely upload there is, and it was refused the
     * same way a TIFF was — this was found while fixing that, not reported.
     */
    expect(ATTACHABLE_DOCUMENT_TYPES).toContain('image/heic');
    expect(ATTACHABLE_DOCUMENT_TYPES).toContain('image/heif');
  });

  it('keeps everything it already took', () => {
    // Widening must not quietly narrow: every type the bucket was created with
    // still has to be here.
    for (const original of [
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
    ]) {
      expect(ATTACHABLE_DOCUMENT_TYPES).toContain(original);
    }
  });

  it('has no imports of its own, so a client component can read it', () => {
    /*
     * The point of the module. `ContactDocumentService` imports
     * `supabaseServer`, so a `'use client'` picker importing the list from
     * there would pull the service-role client into the browser bundle.
     */
    expect(read('lib/crm/attachableDocumentTypes.ts')).not.toMatch(/^import /m);
  });
});

describe('every side reads it', () => {
  it('the picker, for its accept attribute', () => {
    const modal = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');

    expect(modal).toContain('accept={ATTACHABLE_ACCEPT}');
    // Never a hand-written list beside it, which is what it was.
    expect(modal).not.toMatch(/accept="\.pdf/);
  });

  it('the picker, to refuse early rather than after the quote is written', () => {
    const modal = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');

    expect(modal).toMatch(/ATTACHABLE_DOCUMENT_TYPES\.includes\(chosen\.type\)/);
    /*
     * Only a type the browser actually reported. An unknown type arrives as an
     * empty string, and guessing from the filename here would refuse files the
     * server would have taken.
     */
    expect(modal).toMatch(/chosen\.type && !ATTACHABLE_DOCUMENT_TYPES/);
  });

  it('the route, before it uploads anything', () => {
    const route = read('app/api/crm/contacts/[id]/documents/route.ts');

    expect(route).toMatch(/ALLOWED_MIME_TYPES\.includes\(validated\.mime_type\)/);
    // And no second copy of the list left in it.
    expect(route).not.toMatch(/allowedMimeTypes: \[/);
  });

  it('the service, which writes to the same bucket', () => {
    const service = read('lib/services/ContactDocumentService.ts');

    // Imported AND re-exported: a bare `export … from` would not bind the name
    // in that module, and it is used there twice.
    expect(service).toMatch(/import \{ ATTACHABLE_DOCUMENT_TYPES \}/);
    expect(service).toMatch(/export const ALLOWED_MIME_TYPES = ATTACHABLE_DOCUMENT_TYPES/);
  });
});

describe('and the refusal says what is wrong', () => {
  const route = read('app/api/crm/contacts/[id]/documents/route.ts');
  const modal = read('components/crm/contact-drawer/ProposalBuilderModal.tsx');

  it('answers 400 with a code, not 500 with "Failed to upload file"', () => {
    expect(route).toContain("code: 'unsupported_file_type'");
    // The type itself, so the message can name what was refused.
    expect(route).toMatch(/mime_type: validated\.mime_type,/);
  });

  it('and the owner reads it in their own language', () => {
    expect(modal).toMatch(/uploaded\.code === 'unsupported_file_type'/);
    expect(modal).toContain("t('proposal.error_file_type')");
  });

  it('without swallowing any other failure', () => {
    // An unexpected error must still reach the owner rather than being
    // replaced by a wrong explanation.
    expect(modal).toMatch(/refusedType \|\| uploaded\.error \|\| t\('proposal\.error_upload'\)/);
  });

  it('in all three languages', () => {
    // `t()` returns the key when a phrase is missing, so a gap here shows the
    // owner "proposal.error_file_type" instead of a sentence.
    for (const lang of ['en', 'es', 'he']) {
      const dictionary = read(`lib/business-os/translations/${lang}.ts`);
      expect(dictionary).toContain("'proposal.error_file_type':");
      // It names the type, which is the half that makes it actionable.
      expect(dictionary).toMatch(/'proposal\.error_file_type': '[^']*\{type\}/);
    }
  });
});

describe('the bucket the database actually enforces', () => {
  /*
   * `createBucket`'s `allowedMimeTypes` applies at CREATION only, so for a
   * bucket that already exists the TypeScript list is advisory and the SQL is
   * the law. Widening one without the other moves the same failure a step
   * later instead of fixing it.
   */
  const migration = read(
    'supabase/migrations/20261058_contact_documents_accept_scans_and_phone_photos.sql'
  );

  it('is widened by a migration, since code alone cannot', () => {
    expect(migration).toMatch(/UPDATE storage\.buckets/);
    expect(migration).toMatch(/id = 'contact-documents'/);
  });

  it('adds exactly the types the list gained', () => {
    for (const added of ['image/tiff', 'image/heic', 'image/heif']) {
      expect(migration).toContain(added);
    }
  });

  it('appends rather than replaces, so nothing accepted today breaks', () => {
    expect(migration).toMatch(/allowed_mime_types \|\| ARRAY\[/);
    expect(migration).toMatch(/SELECT DISTINCT unnest/);
  });

  it('leaves an unrestricted bucket unrestricted', () => {
    /*
     * A NULL list means "no restriction" in Supabase. Replacing that with a
     * three-element array would TIGHTEN a bucket that accepts everything.
     */
    expect(migration).toMatch(/allowed_mime_types IS NOT NULL/);
  });
});

describe('the accept attribute', () => {
  it('is built from the list rather than written beside it', () => {
    expect(ATTACHABLE_ACCEPT).toBe(ATTACHABLE_DOCUMENT_TYPES.join(','));
  });
});
