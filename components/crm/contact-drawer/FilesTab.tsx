'use client';

import { useState } from 'react';
import {
  FileText, Upload, Download, Trash2, ClipboardList,
  File, FileImage, ChevronDown, ChevronUp, ExternalLink, FolderOpen
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '../CollapsibleSection';
import type { ContactDocument, IntakeResponses } from './types';

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
  isLoading = false,
  isOpen,
  onToggle
}: FilesTabProps) {
  const [expandedIntake, setExpandedIntake] = useState<string | null>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
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
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 p-3 border border-[var(--v2-border)] rounded-lg hover:border-[#8B5CF6]/30 transition-colors"
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

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
    </CollapsibleSection>
  );
}
