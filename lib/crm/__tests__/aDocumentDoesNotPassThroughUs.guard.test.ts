/**
 * A document goes from the browser to Storage, and never through our server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Reported from a phone: "error uploading the document", with nothing else.
 * The file was a 4.47MB PDF.
 *
 * It was base64-encoded into a JSON body and posted to a serverless function.
 * Two numbers nobody could see decided the outcome:
 *
 *   · the platform caps a serverless request body at 4.5MB, and applies the cap
 *     at the EDGE — the handler never runs, so it cannot explain itself;
 *   · base64 adds a third, so the real ceiling was about 3.3MB.
 *
 * Meanwhile the picker, the route's Zod schema and the bucket all said 50MB.
 * Everything between 3.3MB and 50MB failed, and failed SILENTLY: the reply to
 * an over-cap request is not JSON, so `response.json()` threw and the catch
 * printed a generic message with no reason in it.
 *
 * It also defeated the fix that shipped hours earlier. Scans and phone photos
 * had just been added to the allow-list, and both are routinely larger than
 * 3.3MB — the type was accepted and the size killed it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The cap belongs to the hosting platform. It cannot be reproduced in jest:
 * there is no serverless boundary in a test, so a 50MB base64 body posts
 * perfectly happily to a mocked route. What can be pinned is the SHAPE that
 * avoids it — no file in the request body, a signed URL instead — and the
 * checks that keep that shape safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const ticketRoute = read('app/api/crm/contacts/[id]/documents/upload-url/route.ts');
const documentsRoute = read('app/api/crm/contacts/[id]/documents/route.ts');
const types = read('lib/crm/attachableDocumentTypes.ts');

/** The drawer's upload handler, on its own. */
const uploadHandler = drawer.slice(
  drawer.indexOf('const handleFileUpload = async'),
  drawer.indexOf('const handleDeleteDocument')
);

describe('the file does not travel through our server', () => {
  it('is uploaded straight to Storage on a signed URL', () => {
    expect(uploadHandler).toMatch(/uploadToSignedUrl\(/);
    expect(uploadHandler).toMatch(/documents\/upload-url/);
  });

  it('sends the PATH to the documents route, not the file', () => {
    /*
     * The whole fix in one assertion. `file_content` in this handler means the
     * bytes are back in the request body and the 4.5MB cap is back with them.
     */
    expect(uploadHandler).toMatch(/storage_path: ticket\.data\.path/);
    expect(uploadHandler).not.toMatch(/file_content/);
  });

  it('does not base64 the file any more', () => {
    // readAsDataURL was the first step of the old path, and the 33% overhead.
    expect(uploadHandler).not.toMatch(/readAsDataURL/);
  });
});

describe('the signed URL is permission for one path, not for the bucket', () => {
  it('the caller does not choose where the file lands', () => {
    // The path is built here from the authenticated user and the contact, so a
    // caller cannot aim an upload at somebody else's folder.
    expect(ticketRoute).toMatch(/const storagePath = `\$\{user\.id\}\/\$\{contactId\}\//);
    expect(ticketRoute).toMatch(/createSignedUploadUrl\(storagePath\)/);
  });

  it('refuses a type or a size before issuing one', () => {
    expect(ticketRoute).toMatch(/ATTACHABLE_DOCUMENT_TYPES\.includes\(validated\.mime_type\)/);
    expect(ticketRoute).toMatch(/validated\.file_size > MAX_DOCUMENT_BYTES/);
  });

  it('checks the contact belongs to the caller', () => {
    // CLAUDE.md rule 4. The signed URL is a write into this account's folder.
    expect(ticketRoute).toMatch(/crmContactRepository\.findById\(\s*contactId,\s*user\.id\s*\)/);
  });
});

describe('the recorded path is verified, not trusted', () => {
  it('must sit inside this user and this contact folder', () => {
    expect(documentsRoute).toMatch(/const folder = `\$\{user\.id\}\/\$\{contactId\}\/`/);
    expect(documentsRoute).toMatch(/startsWith\(folder\)/);
  });

  it('must point at an object that is actually there', () => {
    /*
     * Without this a caller could record a document row pointing at nothing,
     * which reads as a successful upload and fails only when someone opens it.
     */
    expect(documentsRoute).toMatch(/no such object in storage/);
  });

  it('still accepts an inline file, so the V1 drawer keeps working', () => {
    expect(documentsRoute).toMatch(/file_content: z\.string\(\)\.min\(1\)\.optional\(\)/);
    expect(documentsRoute).toMatch(/storage_path: z\.string\(\)\.min\(1\)\.optional\(\)/);
  });

  it('insists on exactly one of them', () => {
    // Neither means no file; both means two sources of truth for one document.
    expect(documentsRoute).toMatch(
      /Boolean\(body\.file_content\) !== Boolean\(body\.storage_path\)/
    );
  });
});

describe('the picker says why, before anything is sent', () => {
  it('rejects an oversized file itself', () => {
    expect(drawer).toMatch(/candidate\.size > MAX_DOCUMENT_BYTES/);
    expect(drawer).toMatch(/crm\.drawer\.upload_too_large/);
  });

  it('names the limit in the message rather than hiding it', () => {
    expect(drawer).toMatch(/replace\('\{max\}', String\(MAX_DOCUMENT_MB\)\)/);
  });

  it('shows what it refused', () => {
    expect(drawer).toMatch(/\{fileError\}/);
  });

  it('reads the limit from the leaf both sides share', () => {
    /*
     * Not from `ContactDocumentService`: that imports `supabaseServer`, so a
     * client component reading it from there would pull the service-role
     * client into the browser bundle.
     */
    expect(types).toMatch(/export const MAX_DOCUMENT_BYTES/);
    expect(drawer).toMatch(/from '@\/lib\/crm\/attachableDocumentTypes'/);
    expect(read('lib/services/ContactDocumentService.ts')).toMatch(
      /from '@\/lib\/crm\/attachableDocumentTypes'/
    );
  });
});
