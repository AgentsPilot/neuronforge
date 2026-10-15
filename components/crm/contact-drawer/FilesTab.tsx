'use client';

import { useState } from 'react';
import {
  FileText, Upload, Download, Trash2, ClipboardList,
  File, FileImage, ChevronDown, ChevronUp, ExternalLink, FolderOpen, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '../CollapsibleSection';
import type { ContactDocument, IntakeResponses } from './types';
import { DocumentPreviewBody } from './DocumentPreviewBody';

interface FilesTabProps {
  documents: ContactDocument[];
  intakeResponses: Array<{
    booking_id: string;
    booking_date: string | null;
    service_name: string;
    intake: IntakeResponses;
  }>;
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onUploadDocument?: () => void;
  onDownloadDocument?: (documentId: string) => void;
  /**
   * Fetch a URL this document can be VIEWED from.
   *
   * Asked for when the card is clicked rather than listed up front: the list
   * endpoint does not sign URLs, and signing one per document on every render
   * of the tab would mint links for files nobody opens. Returns null when the
   * document cannot be reached.
   */
  onPreviewDocument?: (documentId: string) => Promise<string | null>;
  onDeleteDocument?: (documentId: string) => void;
  isLoading?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

const FILE_ICONS: Record<string, typeof File> = {
  'application/pdf': FileText,
  'image/png': FileImage,
  'image/jpeg': FileImage,
  'image/gif': FileImage,
  'image/webp': FileImage
};

export function FilesTab({
  documents,
  intakeResponses,
  t,
  isRTL,
  language,
  onUploadDocument,
  onDownloadDocument,
  onDeleteDocument,
  onPreviewDocument,
  isLoading = false,
  isOpen,
  onToggle
}: FilesTabProps) {
  const [expandedIntake, setExpandedIntake] = useState<string | null>(null);

  /*
   * THE DOCUMENT BEING LOOKED AT, and the URL it is being looked at through.
   *
   * Two pieces of state rather than one, because they do not arrive together:
   * the document is known the instant the card is clicked and the URL has to
   * be fetched. Opening the dialog on the click and filling it a moment later
   * is what makes the wait legible — a dialog that appears only once the URL
   * lands reads as a click that did nothing.
   */
  const [previewing, setPreviewing] = useState<ContactDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const openPreview = async (doc: ContactDocument) => {
    if (!onPreviewDocument) return;

    setPreviewing(doc);
    setPreviewUrl(null);
    setPreviewFailed(false);

    const url = await onPreviewDocument(doc.id);

    /* The owner may have closed it, or clicked another file, while this was in
       flight — in which case this answer is about a document nobody is looking
       at any more and must not replace the one they are. */
    setPreviewing(current => {
      if (current?.id !== doc.id) return current;
      if (url) setPreviewUrl(url);
      else setPreviewFailed(true);
      return current;
    });
  };

  const closePreview = () => {
    setPreviewing(null);
    setPreviewUrl(null);
    setPreviewFailed(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /*
   * Nullable, because `booking_date` is.
   *
   * An intake submission can be attached to a booking with no slot — a product
   * purchase has none at all — and `new Date(null)` is the epoch, so the row
   * would have dated the client's form "1 Jan 1970" rather than admit it had no
   * date. Returning an empty string lets the separator before it collapse
   * instead.
   */
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';

    return new Date(dateString).toLocaleDateString(language, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getFileIcon = (mimeType: string) => {
    return FILE_ICONS[mimeType] || FileText;
  };

  /**
   * An answer, as a line of text.
   *
   * The three helpers this replaces existed to translate labels out of a
   * shared, trilingual catalogue and to turn stored option CODES into words.
   * Neither job remains: the form is written in one language, and an answer to
   * a choice question stores the option's own label.
   */
  const translateValue = (value: unknown): string => {
    if (typeof value === 'boolean') {
      return value ? t('common.yes') || 'Yes' : t('common.no') || 'No';
    }
    if (typeof value === 'string') {
      // Older submissions stored these words rather than a boolean.
      if (value.toLowerCase() === 'yes') return t('common.yes') || 'Yes';
      if (value.toLowerCase() === 'no') return t('common.no') || 'No';
      return value;
    }
    if (Array.isArray(value)) {
      // Uploaded files arrive as `{documentId, name}`; the name is the readable
      // half, and the file itself is a row in this very tab.
      return value
        .map(item =>
          item && typeof item === 'object' && 'name' in item
            ? String((item as { name: unknown }).name)
            : String(item)
        )
        .join(', ');
    }
    return String(value);
  };

  // Count total files (documents + intake forms)
  const totalFiles = documents.length + intakeResponses.length;

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_files') || 'Files & Documents'}
      icon={<FolderOpen className="h-4 w-4" />}
      defaultOpen={false}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
      badge={
        totalFiles > 0 && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {totalFiles}
          </span>
        )
      }
      actionButton={
        onUploadDocument && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUploadDocument();
            }}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
          >
            <Upload className="h-4 w-4 me-1" />
            {t('crm.files.upload') || 'Upload'}
          </Button>
        )
      }
    >
      <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Intake Forms Section */}
        {intakeResponses.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-muted)] uppercase mb-3">
              <ClipboardList className="h-3.5 w-3.5" />
              {t('crm.files.intake_forms') || 'Intake Forms'}
            </h4>
            <div className="space-y-3">
              {intakeResponses.map((item) => {
                const isExpanded = expandedIntake === item.booking_id;

                return (
                  <div
                    key={item.booking_id}
                    className="border border-[var(--v2-border)] rounded-lg overflow-hidden"
                  >
                    {/* Header */}
                    <button
                      type="button"
                      onClick={() => setExpandedIntake(isExpanded ? null : item.booking_id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-[var(--v2-surface)] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center">
                          <ClipboardList className="h-4 w-4 text-[#8B5CF6]" />
                        </div>
                        <div className="text-start">
                          <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {t('crm.files.intake_form') || 'Intake Form'}
                          </p>
                          <p className="text-xs text-[var(--v2-text-muted)]">
                            <bdi>{item.service_name}</bdi>
                            <span className="mx-1">•</span>
                            <bdi>{formatDate(item.booking_date)}</bdi>
                          </p>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      )}
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="p-4 pt-0 border-t border-[var(--v2-border)]">
                        <div className="mt-3 space-y-3">
                          {Object.entries(item.intake.responses || {}).map(([key, value]) => {
                            /*
                             * The label comes from the submission itself.
                             *
                             * This looked the question up in a template fetched
                             * separately and cached — so an answer was
                             * unreadable until that arrived, and unreadable for
                             * good once the form was edited. The questions now
                             * travel with the answers.
                             */
                            const question = item.intake.questions?.find(q => q.id === key);
                            const label = question?.label ?? key.replace(/_/g, ' ');

                            return (
                              <div key={key} className="flex flex-col gap-0.5">
                                <span className="text-xs font-medium text-[var(--v2-text-secondary)] uppercase">
                                  {label}
                                </span>
                                <span className="text-sm text-[var(--v2-text-primary)]">
                                  {translateValue(value)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Documents Section */}
        <div>
          <h4 className="flex items-center gap-2 text-xs font-medium text-[var(--v2-text-muted)] uppercase mb-3">
            <FileText className="h-3.5 w-3.5" />
            {t('crm.files.documents') || 'Documents'}
          </h4>

          {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                <div className="w-10 h-10 bg-[var(--v2-border)] rounded-lg" />
                <div className="flex-1">
                  <div className="h-4 bg-[var(--v2-border)] rounded w-3/4 mb-1" />
                  <div className="h-3 bg-[var(--v2-border)] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-[var(--v2-border)] rounded-lg">
            <FileText className="h-8 w-8 text-[var(--v2-text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--v2-text-muted)]">
              {t('crm.files.no_documents') || 'No documents uploaded'}
            </p>
            {onUploadDocument && (
              <Button
                type="button"
                onClick={onUploadDocument}
                size="sm"
                className="mt-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                <Upload className="h-4 w-4 me-1" />
                {t('crm.files.upload_first') || 'Upload first document'}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const Icon = getFileIcon(doc.mime_type);

              return (
                /*
                  THE CARD ITSELF OPENS THE FILE.
                  ───────────────────────────────────────────────────────────
                  It used to do nothing. A document was a name, a size and a
                  date, and the only ways to see it — download, open in a new
                  tab — both leave the drawer, and both were behind a hover on
                  a device that may not have one. Clicking the thing you want
                  to look at is the gesture everybody tries first.

                  A `div` with a handler, plus the keyboard half done
                  explicitly: a button cannot wrap this row, because the row
                  already ENDS in buttons and nesting them is invalid.
                */
                <div
                  key={doc.id}
                  role={onPreviewDocument ? 'button' : undefined}
                  tabIndex={onPreviewDocument ? 0 : undefined}
                  onClick={onPreviewDocument ? () => openPreview(doc) : undefined}
                  onKeyDown={
                    onPreviewDocument
                      ? event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openPreview(doc);
                          }
                        }
                      : undefined
                  }
                  className={`group flex items-center gap-3 p-3 border border-[var(--v2-border)] rounded-lg hover:border-[#8B5CF6]/30 transition-colors ${
                    onPreviewDocument ? 'cursor-pointer' : ''
                  }`}
                >
                  {/* File icon */}
                  <div className="w-10 h-10 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center">
                    <Icon className="h-5 w-5 text-[var(--v2-text-muted)]" />
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                      {doc.name || doc.file_name}
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      <bdi>{t(`crm.document.type.${doc.document_type}`) !== `crm.document.type.${doc.document_type}`
                        ? t(`crm.document.type.${doc.document_type}`)
                        : doc.document_type}</bdi>
                      <span className="mx-1">•</span>
                      <bdi>{formatFileSize(doc.file_size)}</bdi>
                      <span className="mx-1">•</span>
                      <bdi>{formatDate(doc.created_at)}</bdi>
                    </p>
                  </div>

                  {/*
                    ACTIONS THAT APPEAR ON HOVER DO NOT EXIST ON A PHONE.

                    ─────────────────────────────────────────────────────────
                    These three — download, open, delete — were `opacity-0`
                    until `group-hover`. A touch screen never hovers, so on a
                    phone the row showed a document's name, its size and its
                    date, and offered no way to open it. The file was listed and
                    unreachable, which reads as a broken feature rather than a
                    hidden control: there is nothing on screen to suggest
                    anything is there.

                    Keyed to `hover: hover` rather than to a WIDTH. The question
                    is whether the device can hover, not how big it is — a touch
                    laptop and a tablet in landscape are wide and still have no
                    pointer, and a `sm:` breakpoint would leave both of them
                    exactly as broken. Visible by default, so any device the
                    media query does not match is the safe way round.

                    `group-focus-within` as well, so tabbing to the buttons on a
                    pointer device reveals them instead of moving focus to
                    something invisible.
                    ─────────────────────────────────────────────────────────
                  */}
                  {/* `stopPropagation`, or deleting a file would also open it. */}
                  <div
                    onClick={event => event.stopPropagation()}
                    className="flex items-center gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                    {onDownloadDocument && (
                      <button
                        type="button"
                        onClick={() => onDownloadDocument(doc.id)}
                        className="p-2 text-[var(--v2-text-muted)] hover:text-[#8B5CF6] transition-colors"
                        title={t('crm.files.download') || 'Download'}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    {doc.download_url && (
                      <a
                        href={doc.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-[var(--v2-text-muted)] hover:text-[#8B5CF6] transition-colors"
                        title={t('crm.files.open') || 'Open'}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    {onDeleteDocument && (
                      <button
                        type="button"
                        onClick={() => onDeleteDocument(doc.id)}
                        className="p-2 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                        title={t('crm.files.delete') || 'Delete'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/*
        THE PREVIEW ITSELF.
        ───────────────────────────────────────────────────────────────────────
        Rendered through `DocumentPreviewBody`, which is the quote builder's
        preview — a PDF in a frame, an image inline, and a sentence for the
        formats no browser renders. One implementation, so the two surfaces
        cannot disagree about what a Word document looks like.

        Inside the section rather than at the page root, which is where a
        `Dialog` would want to be. It is fixed and on its own layer, so the
        position in the tree costs nothing and the state stays beside the list
        it belongs to.
      */}
      {previewing && (
        <div
          /*
            BOUND TO THE VISIBLE VIEWPORT, not to the page's full height.
            ───────────────────────────────────────────────────────────────────
            `inset-0` on a fixed element is the LARGE viewport — the height the
            page would have with the address bar collapsed — while `100dvh` is
            what the visitor can actually see. A panel capped at `90vh` and
            centred inside a box taller than the screen ends up offset by half
            the address bar, with its header above the top edge: exactly the
            fault `components/ui/__tests__/mobileSizing.guard.test.ts` records
            for the configuration shell.

            `items-stretch` below `sm`, so on a phone the preview fills the
            screen rather than floating in it — which is also the whole point of
            a preview: see the document, not the dialog around it.
          */
          className="fixed inset-x-0 top-0 z-[80] h-[100dvh] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={previewing.name || previewing.file_name}
          onClick={closePreview}
        >
          {/*
            A REAL HEIGHT, not a cap. The body is `flex-1` and the PDF frame
            inside it is `h-full`: against `max-h` alone the panel sizes to its
            content, flex-1 resolves to nothing, and the frame collapses to its
            420px floor in the middle of a tall empty dialog.
          */}
          <div
            className="flex h-full w-full flex-col overflow-hidden border-0 sm:h-[88dvh] sm:max-w-5xl sm:rounded-xl sm:border"
            style={{ borderColor: 'var(--v2-border)', background: 'var(--v2-bg)' }}
            onClick={event => event.stopPropagation()}
          >
            <div
              className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
              style={{ borderColor: 'var(--v2-border)' }}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--v2-text-primary)]">
                {previewing.name || previewing.file_name}
              </span>
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={event => event.stopPropagation()}
                  className="shrink-0 text-xs text-[var(--v2-primary)] hover:underline"
                >
                  {t('proposal.open_in_tab')}
                </a>
              )}
              <button
                type="button"
                onClick={closePreview}
                aria-label={t('common.close') || 'Close'}
                /* A thumb-sized target on a phone. `p-1` around a 16px icon
                   is a 24px tap area, well under what a finger can hit
                   reliably; the pointer device keeps the tighter one. */
                className="shrink-0 rounded p-2.5 text-[var(--v2-text-muted)] transition-colors hover:bg-[var(--v2-surface)] hover:text-[var(--v2-text-primary)] sm:p-1"
              >
                <X className="h-5 w-5 sm:h-4 sm:w-4" />
              </button>
            </div>

            {/* `overscroll-contain`: scrolling to the end of a document must
                not then start scrolling the drawer behind it, which on a phone
                reads as the preview sliding away under the finger. */}
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
              {previewUrl ? (
                <DocumentPreviewBody
                  url={previewUrl}
                  name={previewing.file_name}
                  mimeType={previewing.mime_type}
                  t={t}
                />
              ) : previewFailed ? (
                /* Said, rather than left as an empty frame: a blank panel reads
                   as a file that is broken rather than one we could not reach. */
                <p className="py-12 text-center text-sm text-[var(--v2-text-secondary)]">
                  {t('crm.files.preview_failed') || 'This file could not be opened.'}
                </p>
              ) : (
                <p className="py-12 text-center text-sm text-[var(--v2-text-muted)]">
                  {t('common.loading') || 'Loading...'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}
