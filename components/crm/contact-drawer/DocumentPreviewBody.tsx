'use client';

/**
 * What a document looks like when you look at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 *
 * The quote builder has shown a preview of the file being attached since the
 * day attachments arrived: a PDF in a frame, an image inline, and — for a Word
 * document, which no browser renders — a sentence saying so with a download
 * beside it. That last case is the one worth keeping: a blank frame reads as a
 * broken upload rather than an unpreviewable format.
 *
 * The Files tab had nothing. A document there was a name, a size and a date,
 * and the only ways to see it were "download" and "open in a new tab" — both of
 * which leave the drawer. Clicking the row itself did nothing at all.
 *
 * Giving it a second implementation of the same three rules is how the two
 * drift, and this codebase has paid for that twice over in one day: a file-type
 * allow-list that existed in three places refused a scan from one of them, and
 * a dark-mode rule in six places left the task date icon black because the two
 * local copies out-specified the four that had been corrected.
 *
 * So the rules live here and both callers render them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE URL IS WHATEVER THE CALLER HAS
 *
 * The quote builder passes a local object URL for a file not yet uploaded; the
 * Files tab passes a signed URL for one already in Storage. Neither distinction
 * matters here — both are URLs a browser can render — which is exactly why this
 * takes a string and asks no questions about where it came from.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { FileText } from 'lucide-react';

interface DocumentPreviewBodyProps {
  /** Object URL, signed URL, anything the browser can fetch. */
  url: string;
  /** Shown as the download name and the image's alt text. */
  name: string;
  /** The MIME type, which decides which of the three cases this is. */
  mimeType: string | null | undefined;
  t: (key: string) => string;
}

export function DocumentPreviewBody({ url, name, mimeType, t }: DocumentPreviewBodyProps) {
  const isPdf = mimeType === 'application/pdf';
  const isImage = Boolean(mimeType?.startsWith('image/'));

  if (isPdf) {
    /* An iframe, not <embed>: both the object URL and the signed URL render a
       PDF inline from one in every browser this runs in. */
    return (
      <iframe
        src={url}
        title={name}
        className="h-full w-full rounded-lg border"
        style={{ borderColor: 'var(--v2-border)', minHeight: '420px' }}
      />
    );
  }

  if (isImage) {
    return (
      <img
        src={url}
        alt={name}
        className="mx-auto max-h-full rounded-lg object-contain"
      />
    );
  }

  /*
   * Word documents, spreadsheets and the rest. No browser renders these
   * inline, and a blank frame reads as a broken file rather than a format that
   * cannot be shown — so it says which it is, and offers the way to read it.
   */
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileText className="h-10 w-10 text-[var(--v2-text-muted)]" />
      <p className="text-sm text-[var(--v2-text-secondary)]">
        {t('proposal.preview_unavailable')}
      </p>
      <a
        href={url}
        download={name}
        className="text-sm font-medium text-[var(--v2-primary)] hover:underline"
      >
        {t('proposal.download_to_check')}
      </a>
    </div>
  );
}
