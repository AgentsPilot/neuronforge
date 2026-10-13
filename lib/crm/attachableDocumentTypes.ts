/**
 * What may be stored in `contact-documents`, in one place both sides can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 *
 * The list had three copies: the upload route's bucket-creation options, the
 * `ContactDocumentService`, and the SQL migration that actually made the bucket.
 * They had drifted — which is how a scanned TIFF could be offered by the file
 * picker, accepted by the request, and then refused by Supabase Storage as an
 * upload error that surfaced as "Failed to upload file".
 *
 * It cannot live in `ContactDocumentService`: that module imports
 * `supabaseServer`, so a `'use client'` component importing the list from there
 * would pull the service-role client into the browser bundle. A leaf with no
 * imports of its own can be read by the picker and by the route alike, which is
 * the only way the two can be guaranteed to agree.
 *
 * The SQL remains a fourth statement of the same fact, unavoidably — a bucket's
 * allow-list lives in the database and `createBucket` options apply at creation
 * only. A guard test pins the two together.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const ATTACHABLE_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  /*
   * A SCAN AND A PHONE PHOTO, which is how most of these actually arrive.
   *
   * `image/tiff` is what a desk scanner produces, and attaching a scanned quote
   * to a proposal is exactly what the attachment field asks for.
   *
   * `image/heic` / `image/heif` are what an iPhone camera produces by default,
   * so a business photographing a document on their phone — the most likely
   * upload there is — was being turned away.
   *
   * Neither needs to render in a browser: the documents list offers them for
   * download and a proposal attaches them to an email.
   */
  'image/tiff',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
];

/**
 * The `accept` attribute for a file picker.
 *
 * Built from the list rather than written beside it. It read
 * `.pdf,.doc,.docx,image/*`, which is both narrower and wider than the truth at
 * once: it hid spreadsheets and text files the store accepts, while offering
 * every image format in existence including several it does not.
 *
 * `accept` is only ever a filter — a phone's share sheet will hand over files
 * that do not match it — so this reduces wrong choices rather than preventing
 * them. The refusal still has to be stated in words by whoever receives the
 * file.
 */
export const ATTACHABLE_ACCEPT = ATTACHABLE_DOCUMENT_TYPES.join(',');
