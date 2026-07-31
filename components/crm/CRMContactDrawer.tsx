'use client';

import { useState, useEffect, useRef } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  X, Plus, Mail, User, Bot, Globe, Facebook, Search as SearchIcon,
  Users as UsersIcon, Phone as PhoneIcon, MessageCircle, Trash2,
  Calendar, CreditCard, Clock, FileText, AlertCircle, Check,
  Upload, Download, Eye, MoreVertical, FolderOpen, UserX, Send,
  StickyNote, Video, CheckSquare, Circle, Flag, ClipboardList,
  ChevronDown, ChevronUp, Edit2, ArrowUpDown
} from 'lucide-react';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';
import PhoneInput from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from './SearchableCountrySelect';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMActivity } from '@/lib/repositories/CRMActivityRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';
import type { Country } from 'react-phone-number-input';

interface CRMContactDrawerProps {
  contact: CRMContact;
  stages: CRMPipelineStage[];
  enabledCapabilities?: string[];
  isOpen: boolean;
  onClose: () => void;
  onContactUpdated: () => void;
  defaultTab?: 'details' | 'activity' | 'appointments' | 'payments' | 'documents' | 'tasks' | 'intake';
}

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  description?: string;
}

interface IntakeResponses {
  template_id: string;
  template_key: string;
  responses: Record<string, unknown>;
}

interface IntakeTemplateField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es: string;
  label_he: string;
  required?: boolean;
  options?: Array<{
    value: string;
    label_en: string;
    label_es: string;
    label_he: string;
  }>;
}

interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  fields: IntakeTemplateField[];
}

interface Appointment {
  id: string;
  service_id: string;
  client_first_name: string;
  client_last_name?: string;
  start_time: string;
  end_time: string;
  timezone?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  intake_responses?: IntakeResponses;
  intake_completed_at?: string;
  // Service info from join
  service?: {
    service_name: string;
  };
}

interface ContactTask {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date: string | null;
  created_by: string;
  created_at: string;
}

interface ContactEmail {
  id: string;
  subject: string;
  to_email: string;
  status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
  sent_at: string | null;
  opened_at: string | null;
  created_at: string;
}

interface ContactDocument {
  id: string;
  name: string;
  document_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  download_url?: string;
}

const DOCUMENT_TYPES = [
  { value: 'contract', labelKey: 'crm.document.type.contract', icon: FileText, color: 'text-purple-500 dark:text-purple-400' },
  { value: 'intake_form', labelKey: 'crm.document.type.intake_form', icon: FileText, color: 'text-blue-500 dark:text-blue-400' },
  { value: 'invoice', labelKey: 'crm.document.type.invoice', icon: FileText, color: 'text-green-500 dark:text-green-400' },
  { value: 'receipt', labelKey: 'crm.document.type.receipt', icon: FileText, color: 'text-emerald-500 dark:text-emerald-400' },
  { value: 'id_document', labelKey: 'crm.document.type.id_document', icon: FileText, color: 'text-orange-500 dark:text-orange-400' },
  { value: 'medical', labelKey: 'crm.document.type.medical', icon: FileText, color: 'text-red-500 dark:text-red-400' },
  { value: 'insurance', labelKey: 'crm.document.type.insurance', icon: FileText, color: 'text-cyan-500 dark:text-cyan-400' },
  { value: 'other', labelKey: 'crm.document.type.other', icon: FileText, color: 'text-slate-500 dark:text-slate-400' }
];

// Custom file type icon components that look like real file icons
const FileTypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const baseClass = `${className || 'w-10 h-10'} rounded-lg flex items-center justify-center font-bold text-white text-[10px] uppercase tracking-tight`;

  switch (type) {
    case 'pdf':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-red-500 to-red-600`}>
          PDF
        </div>
      );
    case 'doc':
    case 'docx':
    case 'word':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-blue-500 to-blue-600`}>
          DOC
        </div>
      );
    case 'xls':
    case 'xlsx':
    case 'excel':
    case 'csv':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-green-500 to-green-600`}>
          XLS
        </div>
      );
    case 'ppt':
    case 'pptx':
    case 'powerpoint':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-orange-500 to-orange-600`}>
          PPT
        </div>
      );
    case 'image':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-pink-500 to-pink-600`}>
          IMG
        </div>
      );
    case 'video':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-purple-500 to-purple-600`}>
          VID
        </div>
      );
    case 'audio':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-amber-500 to-amber-600`}>
          MP3
        </div>
      );
    case 'zip':
    case 'archive':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-yellow-500 to-yellow-600`}>
          ZIP
        </div>
      );
    case 'txt':
    case 'text':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-slate-500 to-slate-600`}>
          TXT
        </div>
      );
    case 'code':
      return (
        <div className={`${baseClass} bg-gradient-to-br from-emerald-500 to-emerald-600`}>
          {'</>'}
        </div>
      );
    default:
      return (
        <div className={`${baseClass} bg-gradient-to-br from-slate-400 to-slate-500`}>
          FILE
        </div>
      );
  }
};

// Get file type from mime type
const getFileType = (mimeType: string): string => {
  if (!mimeType) return 'file';

  // PDF
  if (mimeType === 'application/pdf') return 'pdf';

  // Images
  if (mimeType.startsWith('image/')) return 'image';

  // Videos
  if (mimeType.startsWith('video/')) return 'video';

  // Audio
  if (mimeType.startsWith('audio/')) return 'audio';

  // Word documents
  if (mimeType.includes('word') || mimeType === 'application/msword' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'word';
  }

  // Excel/Spreadsheets
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet') || mimeType === 'application/vnd.ms-excel' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'excel';
  }

  // CSV
  if (mimeType === 'text/csv') return 'csv';

  // PowerPoint/Presentations
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation') || mimeType === 'application/vnd.ms-powerpoint' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    return 'powerpoint';
  }

  // Code files
  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html') || mimeType.includes('css')) {
    return 'code';
  }

  // Plain text
  if (mimeType === 'text/plain') return 'txt';

  // Archives
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('gzip') || mimeType.includes('compressed')) {
    return 'archive';
  }

  return 'file';
};

// Format activity title - handles database-stored titles like "Booking: ServiceName"
const formatActivityTitle = (
  title: string,
  activityType: string,
  t: (key: string) => string
): string => {
  // Handle "Booking: ServiceName"
  if (activityType === 'booking') {
    const bookingMatch = title.match(/^Booking:\s*(.+)$/);
    if (bookingMatch) {
      return `${t('crm.activity.title.booking')}: ${bookingMatch[1]}`;
    }
  }

  // Handle "Booking Confirmed: ServiceName"
  const confirmedMatch = title.match(/^Booking Confirmed:\s*(.+)$/);
  if (confirmedMatch) {
    return `${t('crm.activity.title.booking_confirmed')}: ${confirmedMatch[1]}`;
  }

  // Handle "Booking Cancelled"
  if (title === 'Booking Cancelled') {
    return t('crm.activity.title.booking_cancelled');
  }

  // Handle "No-Show"
  if (title === 'No-Show') {
    return t('crm.activity.title.no_show');
  }

  // Handle "Payment Received: $100"
  if (activityType === 'payment') {
    const paymentMatch = title.match(/^Payment Received:\s*(.+)$/);
    if (paymentMatch) {
      return `${t('crm.activity.title.payment_received')}: ${paymentMatch[1]}`;
    }
  }

  // Handle "Email Sent: Subject"
  if (activityType === 'email') {
    const emailMatch = title.match(/^Email Sent:\s*(.+)$/);
    if (emailMatch) {
      return `${t('crm.activity.title.email_sent')}: ${emailMatch[1]}`;
    }
  }

  // Handle "Website Contact Form Submission"
  if (title === 'Website Contact Form Submission') {
    return t('crm.activity.title.website_contact_form');
  }

  // Return as-is for other titles
  return title;
};

// Format activity description - handles both old format and new JSON format
const formatActivityDescription = (
  description: string | null | undefined,
  activityType: string,
  t: (key: string) => string
): string | null => {
  if (!description) return null;

  // For document_uploaded activities, try to parse JSON format first
  if (activityType === 'document_uploaded') {
    // Try to parse as JSON (new format)
    try {
      const data = JSON.parse(description);
      if (data.document_type && data.file_name) {
        const typeLabel = t('crm.activity.desc.type');
        const fileLabel = t('crm.activity.desc.file');
        const docTypeTranslation = t(`crm.document.type.${data.document_type}`);
        const docType = docTypeTranslation !== `crm.document.type.${data.document_type}`
          ? docTypeTranslation
          : data.document_type;
        return `${typeLabel}: ${docType} | ${fileLabel}: ${data.file_name}`;
      }
    } catch {
      // Not JSON, try old format
    }

    // Handle old format: "Type: xxx | File: yyy"
    const oldFormatMatch = description.match(/^Type:\s*(\w+)\s*\|\s*File:\s*(.+)$/);
    if (oldFormatMatch) {
      const typeLabel = t('crm.activity.desc.type');
      const fileLabel = t('crm.activity.desc.file');
      const docTypeTranslation = t(`crm.document.type.${oldFormatMatch[1]}`);
      const docType = docTypeTranslation !== `crm.document.type.${oldFormatMatch[1]}`
        ? docTypeTranslation
        : oldFormatMatch[1];
      return `${typeLabel}: ${docType} | ${fileLabel}: ${oldFormatMatch[2]}`;
    }
  }

  // For contact_created activities, parse JSON and translate
  if (activityType === 'contact_created') {
    try {
      const data = JSON.parse(description);
      const sourceKey = `crm.source.${data.source}`;
      const sourceTranslation = t(sourceKey);
      const source = sourceTranslation !== sourceKey ? sourceTranslation : data.source;
      const stageKey = `crm.stage.${data.stage}`;
      const stageTranslation = t(stageKey);
      const stage = stageTranslation !== stageKey ? stageTranslation : data.stage;
      return `${t('crm.activity.desc.source')}: ${source} | ${t('crm.activity.desc.stage')}: ${stage}`;
    } catch {
      // Not JSON, return as-is
    }
  }

  // For booking activities, translate common English phrases
  if (activityType === 'booking') {
    // Translate "No reason provided"
    if (description === 'No reason provided') {
      return t('crm.activity.desc.no_reason');
    }
    // Translate "Client did not attend scheduled session"
    if (description === 'Client did not attend scheduled session') {
      return t('crm.activity.desc.client_no_show');
    }
    // Translate "Scheduled for YYYY-MM-DD HH:MM"
    const scheduledMatch = description.match(/^Scheduled for (.+)$/);
    if (scheduledMatch) {
      return `${t('crm.activity.desc.scheduled_for')} ${scheduledMatch[1]}`;
    }
    // Translate "Booked via website for DATE (paid)"
    const bookedViaPaidMatch = description.match(/^Booked via website for (.+) \(paid\)$/);
    if (bookedViaPaidMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaPaidMatch[1]} (${t('crm.activity.desc.paid')})`;
    }
    // Translate "Booked via website for DATE - Paid CURRENCY AMOUNT"
    const bookedViaCurrencyMatch = description.match(/^Booked via website for (.+) - Paid (.+)$/);
    if (bookedViaCurrencyMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaCurrencyMatch[1]} - ${t('crm.activity.desc.paid')} ${bookedViaCurrencyMatch[2]}`;
    }
    // Translate "Booked via website for DATE"
    const bookedViaMatch = description.match(/^Booked via website for (.+)$/);
    if (bookedViaMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaMatch[1]}`;
    }
  }

  // Return as-is for other activity types
  return description;
};

// Document Upload Modal Component
interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (file: File, name: string, type: string, description: string) => Promise<void>;
  uploading: boolean;
  t: (key: string) => string;
}

function DocumentUploadModal({ isOpen, onClose, onUpload, uploading, t }: DocumentUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState('');
  const [docType, setDocType] = useState('other');
  const [description, setDescription] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      setFile(droppedFile);
      if (!docName) {
        setDocName(droppedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!docName) {
        setDocName(selectedFile.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleSubmit = async () => {
    if (file && docName) {
      await onUpload(file, docName, docType, description);
      // Reset form on success
      setFile(null);
      setDocName('');
      setDocType('other');
      setDescription('');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6 max-w-lg w-full mx-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('crm.document.upload_title')}
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Drag & Drop Zone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive
                ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                : file
                ? 'border-green-500 bg-green-500/10'
                : 'border-[var(--v2-border)] hover:border-[#8B5CF6]/50'
            }`}
          >
            <input
              type="file"
              onChange={handleFileSelect}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
            />
            {file ? (
              <div className="space-y-2">
                <File className="h-10 w-10 mx-auto text-green-500" />
                <p className="font-medium text-[var(--v2-text-primary)]">{file.name}</p>
                <p className="text-sm text-[var(--v2-text-muted)]">{formatFileSize(file.size)}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="text-sm text-red-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-[var(--v2-text-muted)]" />
                <p className="text-[var(--v2-text-secondary)]">
                  {t('crm.document.drag_drop')}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {t('crm.document.max_size')} • {t('crm.document.supported_formats')}
                </p>
              </div>
            )}
          </div>

          {/* Document Name */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.name')} <span className="text-red-500 dark:text-red-400">*</span>
            </Label>
            <Input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder={t('crm.document.name_placeholder')}
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
            />
          </div>

          {/* Document Type */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.type')}
            </Label>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_TYPES.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setDocType(type.value)}
                  className={`px-3 py-1.5 text-xs font-medium border transition-all ${
                    docType === type.value
                      ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t(type.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.description')}
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('crm.document.description_placeholder')}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 resize-none"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={uploading}
            className="border-[var(--v2-border)]"
          >
            {t('button.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!file || !docName || uploading}
            className="text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
          >
            {uploading ? t('crm.drawer.uploading') : t('crm.drawer.upload_document')}
          </Button>
        </div>
      </div>
    </div>
  );
}

const SOURCE_OPTIONS = [
  { value: 'google', labelKey: 'crm.source.google', icon: SearchIcon },
  { value: 'facebook', labelKey: 'crm.source.facebook', icon: Facebook },
  { value: 'instagram', labelKey: 'crm.source.instagram', icon: MessageCircle },
  { value: 'website', labelKey: 'crm.source.website', icon: Globe },
  { value: 'referral', labelKey: 'crm.source.referral', icon: UsersIcon },
  { value: 'phone_call', labelKey: 'crm.source.phone_call', icon: PhoneIcon },
  { value: 'in_person', labelKey: 'crm.source.in_person', icon: User }
];

export function CRMContactDrawer({ contact, stages, enabledCapabilities = [], isOpen, onClose, onContactUpdated, defaultTab }: CRMContactDrawerProps) {
  // Helper to check if a capability is enabled
  // If no capabilities are provided (empty array), show all tabs for backward compatibility
  const hasCapability = (capability: string) => {
    if (enabledCapabilities.length === 0) return true; // Show all if not configured
    return enabledCapabilities.includes(capability);
  };
  const { t, isRTL, language } = useLanguage();
  const [activeTab, setActiveTab] = useState<string>(defaultTab || 'details');
  const [intakeTemplates, setIntakeTemplates] = useState<Record<string, IntakeTemplate>>({});
  const [expandedIntake, setExpandedIntake] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    stage: 'lead',
    source: '',
    tags: [] as string[],
    notes: '',
    custom_fields: {} as Record<string, any>
  });
  const [newTag, setNewTag] = useState('');
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<Country>('US');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // Quick activity input state
  const [quickActivityType, setQuickActivityType] = useState<'note' | 'call' | 'email' | 'meeting'>('note');
  const [quickActivityText, setQuickActivityText] = useState('');
  const [savingActivity, setSavingActivity] = useState(false);

  // Booking modal state
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState<SchedulingBooking | undefined>(undefined);
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [availability, setAvailability] = useState<Record<string, { start: string; end: string }[]> | undefined>(undefined);
  const [appointmentSort, setAppointmentSort] = useState<'date_desc' | 'date_asc' | 'service'>('date_desc');

  // Email history state
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [activitySubTab, setActivitySubTab] = useState<'activity' | 'emails'>('activity');

  // Auto-save notes state
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Computed values for deactivation/deletion checks
  const futureBookings = appointments.filter(apt =>
    apt.status === 'confirmed' && new Date(apt.start_time) > new Date()
  );
  const pendingPayments = payments.filter(p => p.status === 'pending');
  const hasActiveItems = futureBookings.length > 0 || pendingPayments.length > 0;

  useEffect(() => {
    if (contact && isOpen) {
      setFormData({
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        stage: contact.stage,
        source: contact.source || '',
        tags: contact.tags || [],
        notes: contact.custom_fields?.notes || '',
        custom_fields: contact.custom_fields || {}
      });
      setActiveTab(defaultTab || 'details');
      setShowDeleteConfirm(false);
      setShowDeactivateConfirm(false);
      setErrorMessage('');
      setSuccessMessage('');
      fetchActivities(contact.id);
      fetchPayments(contact.id);
      fetchAppointments(contact.id);
      fetchDocuments(contact.id);
      fetchTasks(contact.id);
      fetchServices();
      fetchAvailability();
      fetchEmails(contact.id);
    }
  }, [contact, isOpen, defaultTab]);

  const fetchTasks = async (contactId: string) => {
    try {
      setLoadingTasks(true);
      const response = await fetch(`/api/crm/tasks?contact_id=${contactId}&include_completed=true&limit=20`);
      const data = await response.json();

      if (data.success) {
        setTasks(data.tasks);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;

    setSavingTask(true);
    try {
      const response = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          title: newTaskTitle.trim(),
          priority: newTaskPriority,
          due_date: newTaskDueDate || null
        })
      });

      const data = await response.json();

      if (data.success) {
        setNewTaskTitle('');
        setNewTaskDueDate('');
        setNewTaskPriority('medium');
        fetchTasks(contact.id);
      } else {
        setErrorMessage(data.error || t('crm.drawer.task_create_error'));
      }
    } catch (error) {
      console.error('Failed to create task:', error);
      setErrorMessage(t('crm.drawer.task_create_error'));
    } finally {
      setSavingTask(false);
    }
  };

  const handleToggleTaskStatus = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';

    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      const data = await response.json();

      if (data.success) {
        fetchTasks(contact.id);
      }
    } catch (error) {
      console.error('Failed to update task:', error);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (data.success) {
        fetchTasks(contact.id);
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  const fetchActivities = async (contactId: string) => {
    try {
      setLoadingActivities(true);
      const response = await fetch(`/api/crm/activities?contact_id=${contactId}&limit=20`);
      const data = await response.json();

      if (data.success) {
        setActivities(data.activities);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoadingActivities(false);
    }
  };

  const handleQuickActivity = async () => {
    if (!quickActivityText.trim() || !contact?.id) return;

    try {
      setSavingActivity(true);
      const response = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          activity_type: quickActivityType,
          title: t(`crm.activity.type.${quickActivityType}`),
          description: quickActivityText.trim()
        })
      });

      const data = await response.json();
      if (data.success) {
        setQuickActivityText('');
        // Refresh activities list
        fetchActivities(contact.id);
      }
    } catch (error) {
      console.error('Failed to create activity:', error);
    } finally {
      setSavingActivity(false);
    }
  };

  // Auto-save notes with debounce
  const autoSaveNotes = async (notes: string) => {
    if (!contact?.id) return;

    try {
      setSavingNotes(true);
      setNotesSaved(false);

      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_fields: {
            ...formData.custom_fields,
            notes
          }
        })
      });

      if (response.ok) {
        setNotesSaved(true);
        // Hide the saved indicator after 2 seconds
        setTimeout(() => setNotesSaved(false), 2000);
      }
    } catch (error) {
      console.error('Failed to auto-save notes:', error);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newNotes = e.target.value;
    setFormData(prev => ({ ...prev, notes: newNotes }));

    // Clear existing timeout
    if (notesTimeoutRef.current) {
      clearTimeout(notesTimeoutRef.current);
    }

    // Set new timeout for auto-save (1.5 seconds after user stops typing)
    notesTimeoutRef.current = setTimeout(() => {
      autoSaveNotes(newNotes);
    }, 1500);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (notesTimeoutRef.current) {
        clearTimeout(notesTimeoutRef.current);
      }
    };
  }, []);

  const fetchPayments = async (contactId: string) => {
    try {
      setLoadingPayments(true);
      const response = await fetch(`/api/payments/transactions?contact_id=${contactId}&limit=20`);
      const data = await response.json();

      if (data.success) {
        setPayments(data.transactions || []);
      }
    } catch (error) {
      console.error('Failed to fetch payments:', error);
    } finally {
      setLoadingPayments(false);
    }
  };

  const fetchAppointments = async (contactId: string) => {
    try {
      setLoadingAppointments(true);
      const response = await fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=20`);
      const data = await response.json();

      if (data.success) {
        setAppointments(data.bookings || []);
      }
    } catch (error) {
      console.error('Failed to fetch appointments:', error);
    } finally {
      setLoadingAppointments(false);
    }
  };

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success) {
        setServices(data.services || []);
      }
    } catch (error) {
      console.error('Failed to fetch services:', error);
    }
  };

  const fetchAvailability = async () => {
    try {
      const response = await fetch('/api/scheduling/availability');
      const data = await response.json();
      if (data.success && data.availability) {
        setAvailability(data.availability);
      }
    } catch (error) {
      console.error('Failed to fetch availability:', error);
    }
  };

  const fetchEmails = async (contactId: string) => {
    try {
      setLoadingEmails(true);
      const response = await fetch(`/api/crm/emails?contact_id=${contactId}&limit=50`);
      const data = await response.json();
      if (data.success) {
        setEmails(data.emails || []);
      }
    } catch (error) {
      console.error('Failed to fetch emails:', error);
    } finally {
      setLoadingEmails(false);
    }
  };

  // Compute sorted appointments based on selected sort option
  const sortedAppointments = [...appointments].sort((a, b) => {
    switch (appointmentSort) {
      case 'date_asc':
        return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
      case 'date_desc':
        return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
      case 'service':
        return (a.service?.service_name || '').localeCompare(b.service?.service_name || '');
      default:
        return new Date(b.start_time).getTime() - new Date(a.start_time).getTime();
    }
  });

  const fetchDocuments = async (contactId: string) => {
    try {
      setLoadingDocuments(true);
      const response = await fetch(`/api/crm/contacts/${contactId}/documents?limit=50`);
      const data = await response.json();

      if (data.success) {
        setDocuments(data.documents || []);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoadingDocuments(false);
    }
  };

  // Fetch intake template by ID (with caching)
  const fetchIntakeTemplate = async (templateId: string): Promise<IntakeTemplate | null> => {
    // Check cache first
    if (intakeTemplates[templateId]) {
      return intakeTemplates[templateId];
    }

    try {
      const response = await fetch(`/api/intake/templates/${templateId}`);
      const data = await response.json();

      if (data.success && data.template) {
        const template = data.template as IntakeTemplate;
        setIntakeTemplates(prev => ({ ...prev, [templateId]: template }));
        return template;
      }
    } catch (error) {
      console.error('Failed to fetch intake template:', error);
    }
    return null;
  };

  // Get field label based on current language
  const getFieldLabel = (field: IntakeTemplateField): string => {
    switch (language) {
      case 'es': return field.label_es || field.label_en;
      case 'he': return field.label_he || field.label_en;
      default: return field.label_en;
    }
  };

  // Get option label based on current language
  const getOptionLabel = (option: { label_en: string; label_es: string; label_he: string }): string => {
    switch (language) {
      case 'es': return option.label_es || option.label_en;
      case 'he': return option.label_he || option.label_en;
      default: return option.label_en;
    }
  };

  // Get template name based on current language
  const getTemplateName = (template: IntakeTemplate): string => {
    switch (language) {
      case 'es': return template.name_es || template.name_en;
      case 'he': return template.name_he || template.name_en;
      default: return template.name_en;
    }
  };

  // Get bookings with intake responses
  const bookingsWithIntake = appointments.filter(a => a.intake_responses && a.intake_completed_at);

  // Fetch intake templates for bookings that have intake responses
  useEffect(() => {
    bookingsWithIntake.forEach(appointment => {
      const templateId = appointment.intake_responses?.template_id;
      if (templateId && !intakeTemplates[templateId]) {
        fetchIntakeTemplate(templateId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments]); // Re-run when appointments change

  const handleFileUpload = async (file: File, docName: string, docType: string, description: string) => {
    try {
      setUploadingDocument(true);
      setErrorMessage('');

      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data:mime;base64, prefix
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      const base64Content = await base64Promise;

      const response = await fetch(`/api/crm/contacts/${contact.id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: docName,
          document_type: docType,
          description: description || undefined,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          file_content: base64Content
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(t('crm.drawer.upload_success'));
        setShowUploadModal(false);
        fetchDocuments(contact.id);
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.upload_error'));
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      setErrorMessage(t('crm.drawer.upload_error'));
    } finally {
      setUploadingDocument(false);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}/documents/${documentId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(t('crm.drawer.document_deleted'));
        fetchDocuments(contact.id);
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.delete_error'));
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
      setErrorMessage(t('crm.drawer.delete_error'));
    }
  };

  const handleDownloadDocument = async (documentId: string) => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}/documents/${documentId}`);
      const data = await response.json();

      if (data.success && data.document.download_url) {
        window.open(data.document.download_url, '_blank');
      }
    } catch (error) {
      console.error('Failed to get download URL:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getDocumentTypeConfig = (type: string) => {
    return DOCUMENT_TYPES.find(dt => dt.value === type) || DOCUMENT_TYPES[DOCUMENT_TYPES.length - 1];
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      // Include notes in custom_fields
      const updatedCustomFields = {
        ...formData.custom_fields,
        notes: formData.notes
      };

      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          custom_fields: updatedCustomFields
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(t('crm.drawer.contact_updated'));
        onContactUpdated();
        setTimeout(() => {
          setSuccessMessage('');
        }, 2000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.save_error'));
      }
    } catch (error) {
      console.error('Failed to save contact:', error);
      setErrorMessage(t('crm.drawer.save_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok && data.success) {
        onContactUpdated();
        onClose();
      } else {
        setErrorMessage(data.error || t('crm.drawer.delete_error'));
      }
    } catch (error) {
      console.error('Failed to delete contact:', error);
      setErrorMessage(t('crm.drawer.delete_error'));
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    // Deactivate by moving to the last stage in the pipeline
    const lastStage = stages.length > 0 ? stages[stages.length - 1].stage_key : 'inactive';
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: lastStage })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(t('crm.drawer.contact_deactivated'));
        onContactUpdated();
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.save_error'));
      }
    } catch (error) {
      console.error('Failed to deactivate contact:', error);
      setErrorMessage(t('crm.drawer.save_error'));
    } finally {
      setDeactivating(false);
      setShowDeactivateConfirm(false);
    }
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(isRTL ? 'he-IL' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(amount / 100);
  };

  const getInitials = () => {
    const first = formData.first_name?.[0] || '';
    const last = formData.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  const totalRevenue = payments
    .filter(p => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <>
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        className="w-full sm:max-w-3xl bg-[var(--v2-bg)] border-[var(--v2-border)] p-0 flex flex-col overflow-hidden"
      >
        {/* Sticky Header */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] p-6">
          <div className="flex items-center gap-4" dir={isRTL ? 'rtl' : 'ltr'}>
            {/* Avatar */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
            >
              {getInitials()}
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start">
                {formData.first_name} {formData.last_name}
              </SheetTitle>
              <p className="text-sm text-[var(--v2-text-muted)] text-start">
                {t(`crm.stage.${formData.stage}`)}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--v2-text-muted)]">
                <span>{t('crm.drawer.created_at')}: {new Date(contact.created_at).toLocaleDateString()}</span>
                <span>•</span>
                <span>{t('crm.drawer.updated_at')}: {new Date(contact.updated_at).toLocaleDateString()}</span>
                {appointments.length > 0 && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {t('crm.drawer.bookings_count').replace('{count}', String(appointments.length))}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-green-500/20 border border-green-500/40 text-green-600 dark:text-green-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
            {successMessage}
          </div>
        )}
        {errorMessage && (
          <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-red-500/20 border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
            {errorMessage}
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="flex-shrink-0 px-6 pt-4 pb-3">
            <TabsList className="bg-transparent p-0 h-auto inline-flex gap-2 w-full flex-wrap">
              {/* Details tab - always shown (part of CRM capability) */}
              <TabsTrigger
                value="details"
                className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
              >
                <FileText className="h-4 w-4" />
                {t('crm.drawer.tab_details')}
              </TabsTrigger>
              {/* Activity tab - always shown (part of CRM capability) */}
              <TabsTrigger
                value="activity"
                className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
              >
                <Clock className="h-4 w-4" />
                {t('crm.drawer.tab_activity')}
              </TabsTrigger>
              {/* Payments tab - only if payments capability is enabled */}
              {hasCapability('payments') && (
                <TabsTrigger
                  value="payments"
                  className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
                >
                  <CreditCard className="h-4 w-4" />
                  {t('crm.drawer.tab_payments')}
                </TabsTrigger>
              )}
              {/* Appointments tab - only if scheduling capability is enabled */}
              {hasCapability('scheduling') && (
                <TabsTrigger
                  value="appointments"
                  className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
                >
                  <Calendar className="h-4 w-4" />
                  {t('crm.drawer.tab_appointments')}
                </TabsTrigger>
              )}
              {/* Intake tab - only if scheduling capability is enabled */}
              {hasCapability('scheduling') && (
                <TabsTrigger
                  value="intake"
                  className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
                >
                  <ClipboardList className="h-4 w-4" />
                  {t('crm.drawer.tab_intake')}
                </TabsTrigger>
              )}
              {/* Documents tab - always shown (part of CRM capability) */}
              <TabsTrigger
                value="documents"
                className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
              >
                <FolderOpen className="h-4 w-4" />
                {t('crm.drawer.tab_documents')}
              </TabsTrigger>
              {/* Tasks tab - always shown (part of CRM capability) */}
              <TabsTrigger
                value="tasks"
                className="flex items-center gap-2 px-1 pb-2 text-sm font-medium text-[var(--v2-text-secondary)] border-b-2 border-transparent data-[state=active]:text-[#8B5CF6] data-[state=active]:border-[#8B5CF6] transition-all bg-transparent hover:text-[var(--v2-text-primary)] rounded-none"
              >
                <CheckSquare className="h-4 w-4" />
                {t('crm.drawer.tab_tasks')}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Scrollable Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Details Tab */}
            <TabsContent value="details" className="m-0 p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
              {/* Personal Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide text-start">
                  {t('crm.modal.personal_info')}
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="first_name" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                      {t('crm.modal.first_name')} <span className="text-red-500 dark:text-red-400">*</span>
                    </Label>
                    <Input
                      id="first_name"
                      value={formData.first_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                      placeholder={t('crm.modal.first_name_placeholder')}
                      required
                      className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6] text-start"
                    />
                  </div>
                  <div>
                    <Label htmlFor="last_name" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                      {t('crm.modal.last_name')} <span className="text-red-500 dark:text-red-400">*</span>
                    </Label>
                    <Input
                      id="last_name"
                      value={formData.last_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                      placeholder={t('crm.modal.last_name_placeholder')}
                      required
                      className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6] text-start"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="email" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                    {t('crm.modal.email')} <span className="text-red-500 dark:text-red-400">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      placeholder={t('crm.modal.email_placeholder')}
                      required
                      className="ps-10 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6] text-start"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="phone" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                    {t('crm.modal.phone')} <span className="text-red-500 dark:text-red-400">*</span>
                  </Label>
                  <div className="flex gap-2" dir="ltr">
                    <SearchableCountrySelect
                      value={phoneCountry}
                      onChange={setPhoneCountry}
                      labels={en}
                    />
                    <PhoneInput
                      international
                      countryCallingCodeEditable={false}
                      country={phoneCountry}
                      value={formData.phone}
                      onChange={(value) => setFormData(prev => ({ ...prev, phone: value || '' }))}
                      className="phone-input-crm flex-1"
                    />
                  </div>
                </div>
              </div>

              {/* Contact Details */}
              <div className="space-y-4 pt-4 border-t border-[var(--v2-border)]">
                <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide text-start">
                  {t('crm.modal.contact_details')}
                </h3>

                {/* Pipeline Stage - Clickable Items */}
                <div>
                  <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                    {t('crm.modal.pipeline_stage')}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {stages.map(stage => (
                      <button
                        key={stage.stage_key}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, stage: stage.stage_key }))}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border transition-all ${
                          formData.stage === stage.stage_key
                            ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                            : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: stage.color || '#64748B' }}
                        />
                        {t(`crm.stage.${stage.stage_key}`) !== `crm.stage.${stage.stage_key}`
                          ? t(`crm.stage.${stage.stage_key}`)
                          : stage.stage_label}
                        {formData.stage === stage.stage_key && <Check className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source - Clickable Items */}
                <div>
                  <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                    {t('crm.modal.how_found')}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map(source => {
                      const Icon = source.icon;
                      return (
                        <button
                          key={source.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, source: source.value }))}
                          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border transition-all ${
                            formData.source === source.value
                              ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                              : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                          }`}
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Icon className="h-4 w-4" />
                          {t(source.labelKey)}
                          {formData.source === source.value && <Check className="h-4 w-4" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Notes with Auto-Save */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="notes" className="text-[var(--v2-text-secondary)] block text-start">
                      {t('crm.drawer.notes')}
                    </Label>
                    {/* Auto-save status indicator */}
                    <div className="flex items-center gap-1.5 text-xs">
                      {savingNotes && (
                        <span className="flex items-center gap-1 text-[var(--v2-text-muted)]">
                          <div className="w-3 h-3 border-2 border-[#8B5CF6] border-t-transparent rounded-full animate-spin" />
                          {t('crm.drawer.notes_saving')}
                        </span>
                      )}
                      {notesSaved && !savingNotes && (
                        <span className="flex items-center gap-1 text-green-500">
                          <Check className="h-3 w-3" />
                          {t('crm.drawer.notes_saved')}
                        </span>
                      )}
                    </div>
                  </div>
                  <textarea
                    id="notes"
                    value={formData.notes}
                    onChange={handleNotesChange}
                    placeholder={t('crm.drawer.notes_placeholder')}
                    rows={4}
                    className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 resize-none text-start"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>

                {/* Tags */}
                <div>
                  <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
                    {t('crm.modal.tags')}
                  </Label>
                  {formData.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                      {formData.tags.map(tag => (
                        <Badge key={tag} className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 gap-1 px-3 py-1">
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="hover:bg-[#8B5CF6]/30 rounded-full p-0.5 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                      placeholder={t('crm.modal.add_tag_placeholder')}
                      className="flex-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6] text-start"
                    />
                    <Button
                      type="button"
                      onClick={handleAddTag}
                      className="px-4 text-white"
                      style={{
                        background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)'
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              {/* Sub-tabs for Activity and Emails */}
              <div className="flex gap-2 mb-4 border-b border-[var(--v2-border)]">
                <button
                  onClick={() => setActivitySubTab('activity')}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-all ${
                    activitySubTab === 'activity'
                      ? 'text-[#8B5CF6] border-[#8B5CF6]'
                      : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  <Clock className="h-4 w-4" />
                  {t('crm.drawer.subtab_activity')}
                </button>
                <button
                  onClick={() => setActivitySubTab('emails')}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-all ${
                    activitySubTab === 'emails'
                      ? 'text-[#8B5CF6] border-[#8B5CF6]'
                      : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)]'
                  }`}
                >
                  <Mail className="h-4 w-4" />
                  {t('crm.drawer.subtab_emails')}
                  {emails.length > 0 && (
                    <span className="bg-[#8B5CF6]/20 text-[#8B5CF6] text-xs px-1.5 py-0.5 rounded-full">
                      {emails.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Activity Sub-tab Content */}
              {activitySubTab === 'activity' && (
                <>
                  {/* Quick Activity Input */}
                  <div className="mb-6 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                    {/* Activity Type Selector - Pill buttons */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {([
                        { type: 'note', icon: StickyNote, label: t('crm.quick_activity.note') },
                        { type: 'call', icon: PhoneIcon, label: t('crm.quick_activity.call') },
                        { type: 'email', icon: Mail, label: t('crm.quick_activity.email') },
                        { type: 'meeting', icon: Video, label: t('crm.quick_activity.meeting') }
                      ] as const).map(({ type, icon: Icon, label }) => (
                        <button
                          key={type}
                          onClick={() => setQuickActivityType(type)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-all ${
                            quickActivityType === type
                              ? 'bg-[#8B5CF6] text-white'
                              : 'bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-border)]'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Input with send button */}
                    <div className="flex gap-2">
                      <Input
                        value={quickActivityText}
                        onChange={(e) => setQuickActivityText(e.target.value)}
                        placeholder={t(`crm.quick_activity.placeholder.${quickActivityType}`)}
                        className="flex-1 bg-[var(--v2-bg)] border-[var(--v2-border)]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && quickActivityText.trim()) {
                            e.preventDefault();
                            handleQuickActivity();
                          }
                        }}
                        disabled={savingActivity}
                      />
                      <Button
                        onClick={handleQuickActivity}
                        disabled={!quickActivityText.trim() || savingActivity}
                        className="px-4 text-white"
                        style={{
                          background: quickActivityText.trim()
                            ? 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)'
                            : undefined
                        }}
                      >
                        {savingActivity ? (
                          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {loadingActivities ? (
                      <div className="text-center py-12 text-[var(--v2-text-muted)]">
                        {t('crm.modal.loading_activities')}
                      </div>
                    ) : activities.length > 0 ? (
                      activities.map(activity => {
                        // Translate the activity title (handles patterns like "Booking: ServiceName")
                        const displayTitle = formatActivityTitle(activity.title, activity.activity_type, t);

                        // Activity type icons and colors
                        const activityConfig: Record<string, { icon: React.ReactNode; color: string }> = {
                          note: { icon: <StickyNote className="h-3.5 w-3.5" />, color: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' },
                          email: { icon: <Mail className="h-3.5 w-3.5" />, color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
                          call: { icon: <PhoneIcon className="h-3.5 w-3.5" />, color: 'bg-green-500/20 text-green-600 dark:text-green-400' },
                          meeting: { icon: <Video className="h-3.5 w-3.5" />, color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400' },
                          booking: { icon: <Calendar className="h-3.5 w-3.5" />, color: 'bg-teal-500/20 text-teal-600 dark:text-teal-400' },
                          payment: { icon: <CreditCard className="h-3.5 w-3.5" />, color: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
                          document_uploaded: { icon: <FileText className="h-3.5 w-3.5" />, color: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' },
                          contact_created: { icon: <User className="h-3.5 w-3.5" />, color: 'bg-slate-500/20 text-slate-600 dark:text-slate-400' }
                        };
                        const config = activityConfig[activity.activity_type] || { icon: <Clock className="h-3.5 w-3.5" />, color: 'bg-slate-500/20 text-slate-600 dark:text-slate-400' };
                        const activityDate = new Date(activity.activity_date);

                        return (
                        <div
                          key={activity.id}
                          className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-[var(--v2-text-primary)] text-sm truncate flex-1 me-2">
                              {displayTitle}
                            </span>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-xs ${config.color}`}>
                                <span className="flex items-center gap-1">
                                  {config.icon}
                                  {t(`crm.activity.type.${activity.activity_type}`) !== `crm.activity.type.${activity.activity_type}`
                                    ? t(`crm.activity.type.${activity.activity_type}`)
                                    : activity.activity_type}
                                </span>
                              </Badge>
                              {activity.auto_logged ? (
                                <Badge className="text-xs gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30">
                                  <Bot className="h-3 w-3" />
                                  {t('crm.activity.auto')}
                                </Badge>
                              ) : (
                                <Badge className="text-xs gap-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">
                                  <User className="h-3 w-3" />
                                  {t('crm.activity.manual')}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {activity.description && (
                            <p className="text-sm text-[var(--v2-text-secondary)] mb-2 text-start">
                              {formatActivityDescription(activity.description, activity.activity_type, t)}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-[var(--v2-text-muted)] text-xs">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {activityDate.toLocaleDateString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {activityDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                      })
                    ) : (
                      <div className="text-center py-12 text-[var(--v2-text-muted)]">
                        <Clock className="h-10 w-10 mx-auto mb-3 opacity-40" />
                        <p>{t('crm.modal.no_activity')}</p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Emails Sub-tab Content */}
              {activitySubTab === 'emails' && (
                <div className="space-y-3">
                  {loadingEmails ? (
                    <div className="text-center py-12 text-[var(--v2-text-muted)]">
                      {t('crm.drawer.loading_emails')}
                    </div>
                  ) : emails.length > 0 ? (
                    emails.map(email => {
                      const sentDate = email.sent_at ? new Date(email.sent_at) : new Date(email.created_at);
                      const statusColors: Record<string, string> = {
                        sent: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
                        delivered: 'bg-green-500/20 text-green-600 dark:text-green-400',
                        opened: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
                        clicked: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
                        bounced: 'bg-red-500/20 text-red-600 dark:text-red-400',
                        failed: 'bg-red-500/20 text-red-600 dark:text-red-400',
                        pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                      };

                      return (
                        <div
                          key={email.id}
                          className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-[var(--v2-text-primary)] text-sm truncate flex-1 me-2">
                              {email.subject}
                            </span>
                            <Badge className={`text-xs ${statusColors[email.status] || 'bg-slate-500/20 text-slate-600'}`}>
                              {t(`crm.email.status.${email.status}`)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-[var(--v2-text-muted)] text-xs">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {email.to_email}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {sentDate.toLocaleDateString()} {sentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {email.opened_at && (
                            <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              {t('crm.email.opened_at')} {new Date(email.opened_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-[var(--v2-text-muted)]">
                      <Mail className="h-10 w-10 mx-auto mb-3 opacity-40" />
                      <p>{t('crm.drawer.no_emails')}</p>
                      <p className="text-xs mt-2">{t('crm.drawer.no_emails_hint')}</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* Payments Tab - only render if payments capability is enabled */}
            {hasCapability('payments') && (
            <TabsContent value="payments" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="space-y-3">
                {loadingPayments ? (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    {t('crm.drawer.loading_payments')}
                  </div>
                ) : payments.length > 0 ? (
                  payments.map(payment => (
                    <div
                      key={payment.id}
                      className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-[var(--v2-text-primary)]">
                          {formatCurrency(payment.amount, payment.currency)}
                        </span>
                        <Badge className={`text-xs ${
                          payment.status === 'succeeded' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                          payment.status === 'pending' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' :
                          'bg-red-500/20 text-red-600 dark:text-red-400'
                        }`}>
                          {payment.status}
                        </Badge>
                      </div>
                      {payment.description && (
                        <p className="text-sm text-[var(--v2-text-secondary)] mb-2 text-start">
                          {payment.description}
                        </p>
                      )}
                      <div className="text-[var(--v2-text-muted)] text-xs text-start">
                        {formatDate(payment.created_at)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>{t('crm.drawer.no_payments')}</p>
                  </div>
                )}
              </div>
            </TabsContent>
            )}

            {/* Appointments Tab - only render if scheduling capability is enabled */}
            {hasCapability('scheduling') && (
            <TabsContent value="appointments" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="space-y-3">
                {/* Header with Sort and Add Meeting */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
                    <Select value={appointmentSort} onValueChange={(value: 'date_desc' | 'date_asc' | 'service') => setAppointmentSort(value)}>
                      <SelectTrigger className="w-[140px] h-8 text-xs bg-[var(--v2-surface)] border-[var(--v2-border)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date_desc">{t('crm.drawer.sort_date_desc')}</SelectItem>
                        <SelectItem value="date_asc">{t('crm.drawer.sort_date_asc')}</SelectItem>
                        <SelectItem value="service">{t('crm.drawer.sort_service')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingBooking(undefined);
                      setShowBookingModal(true);
                    }}
                    className="h-8 px-3 text-xs bg-[#14B8A6] hover:bg-[#0D9488] text-white"
                  >
                    <Plus className="h-3.5 w-3.5 me-1" />
                    {t('crm.drawer.new_meeting')}
                  </Button>
                </div>

                {loadingAppointments ? (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    {t('crm.drawer.loading_appointments')}
                  </div>
                ) : sortedAppointments.length > 0 ? (
                  sortedAppointments.map(appointment => {
                    const startDate = new Date(appointment.start_time);
                    const endDate = new Date(appointment.end_time);
                    const duration = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

                    return (
                    <div
                      key={appointment.id}
                      onClick={() => {
                        // Convert appointment to SchedulingBooking format for editing
                        setEditingBooking({
                          id: appointment.id,
                          user_id: '',
                          service_id: appointment.service_id,
                          contact_id: contact.id,
                          client_first_name: appointment.client_first_name,
                          client_last_name: appointment.client_last_name || null,
                          client_email: contact.email,
                          client_phone: contact.phone || null,
                          start_time: appointment.start_time,
                          end_time: appointment.end_time,
                          timezone: appointment.timezone || 'UTC',
                          status: appointment.status,
                          notes: appointment.notes || null,
                          cancellation_reason: null,
                          payment_status: 'pending',
                          payment_id: null,
                          internal_notes: null,
                          booking_source: 'manual',
                          reminder_24hr_sent: false,
                          reminder_2hr_sent: false,
                          external_calendar_event_id: null,
                          calendar_sync_provider: null,
                          calendar_synced_at: null,
                          calendar_sync_error: null,
                          intake_responses: appointment.intake_responses || null,
                          intake_completed_at: appointment.intake_completed_at || null,
                          created_at: '',
                          updated_at: ''
                        } as SchedulingBooking);
                        setShowBookingModal(true);
                      }}
                      className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg cursor-pointer hover:border-[#14B8A6] hover:bg-[#14B8A6]/5 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-[var(--v2-text-primary)]">
                          {appointment.service?.service_name || t('crm.drawer.booking')}
                        </span>
                        <Badge className={`text-xs ${
                          appointment.status === 'confirmed' ? 'bg-green-500/20 text-green-600 dark:text-green-400' :
                          appointment.status === 'completed' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' :
                          appointment.status === 'cancelled' ? 'bg-red-500/20 text-red-600 dark:text-red-400' :
                          appointment.status === 'no_show' ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                          'bg-slate-500/20 text-slate-600 dark:text-slate-400'
                        }`}>
                          {t(`scheduling.status.${appointment.status}`)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[var(--v2-text-muted)] text-xs">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {startDate.toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span>{duration} {t('scheduling.service.minutes')}</span>
                      </div>
                      {appointment.notes && (
                        <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
                          {appointment.notes}
                        </p>
                      )}
                      {/* Intake indicator button */}
                      {appointment.intake_responses && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedIntake(expandedIntake === appointment.id ? null : appointment.id);
                            }}
                            className="mt-3 w-full justify-between text-xs bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400"
                          >
                            <span className="flex items-center gap-1.5">
                              <ClipboardList className="h-3.5 w-3.5" />
                              {t('crm.drawer.intake_completed')}
                            </span>
                            {expandedIntake === appointment.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                          {/* Expanded intake details */}
                          {expandedIntake === appointment.id && (
                            <div className="mt-3 pt-3 border-t border-[var(--v2-border)] space-y-2">
                              {(() => {
                                const template = appointment.intake_responses?.template_id
                                  ? intakeTemplates[appointment.intake_responses.template_id]
                                  : null;
                                return template?.fields ? (
                                  template.fields.map((field) => {
                                    const value = appointment.intake_responses?.responses[field.key];
                                    if (value === undefined || value === null || value === '') return null;
                                    let displayValue: string;
                                    if (field.type === 'checkbox') {
                                      displayValue = value ? '✓' : '✗';
                                    } else if (field.type === 'select' || field.type === 'radio') {
                                      const option = field.options?.find(o => o.value === value);
                                      displayValue = option ? getOptionLabel(option) : String(value);
                                    } else if (Array.isArray(value)) {
                                      displayValue = value.join(', ');
                                    } else {
                                      displayValue = String(value);
                                    }
                                    return (
                                      <div key={field.key} className="text-xs">
                                        <span className="text-[var(--v2-text-muted)] font-medium">
                                          {getFieldLabel(field)}:
                                        </span>
                                        <span className="text-[var(--v2-text-primary)] ms-2">
                                          {displayValue}
                                        </span>
                                      </div>
                                    );
                                  })
                                ) : (
                                  // Fallback: render raw key-value pairs
                                  appointment.intake_responses?.responses && Object.entries(appointment.intake_responses.responses).map(([key, value]) => (
                                    <div key={key} className="text-xs">
                                      <span className="text-[var(--v2-text-muted)] font-medium capitalize">
                                        {key.replace(/_/g, ' ')}:
                                      </span>
                                      <span className="text-[var(--v2-text-primary)] ms-2">
                                        {Array.isArray(value) ? value.join(', ') : String(value)}
                                      </span>
                                    </div>
                                  ))
                                );
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                  })
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <Calendar className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>{t('crm.drawer.no_appointments')}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingBooking(undefined);
                        setShowBookingModal(true);
                      }}
                      className="mt-3 text-xs border-[var(--v2-border)]"
                    >
                      <Plus className="h-3.5 w-3.5 me-1" />
                      {t('crm.drawer.new_meeting')}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
            )}

            {/* Intake Tab - only render if scheduling capability is enabled */}
            {hasCapability('scheduling') && (
            <TabsContent value="intake" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="space-y-4">
                {loadingAppointments ? (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    {t('crm.drawer.loading_intake')}
                  </div>
                ) : bookingsWithIntake.length > 0 ? (
                  bookingsWithIntake.map(appointment => {
                    const startDate = new Date(appointment.start_time);
                    const completedDate = appointment.intake_completed_at
                      ? new Date(appointment.intake_completed_at)
                      : null;
                    const isExpanded = expandedIntake === appointment.id;
                    const template = appointment.intake_responses?.template_id
                      ? intakeTemplates[appointment.intake_responses.template_id]
                      : null;

                    return (
                      <div
                        key={appointment.id}
                        className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <ClipboardList className="h-4 w-4 text-[#8B5CF6]" />
                            <span className="font-semibold text-[var(--v2-text-primary)]">
                              {template ? getTemplateName(template) : appointment.intake_responses?.template_key}
                            </span>
                          </div>
                          <Badge className="text-xs bg-green-500/20 text-green-600 dark:text-green-400">
                            {t('crm.drawer.intake_completed')}
                          </Badge>
                        </div>

                        {/* Booking info */}
                        <div className="flex items-center gap-3 text-[var(--v2-text-muted)] text-xs mb-3">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {t('crm.drawer.intake_from_booking')} {startDate.toLocaleDateString()}
                          </span>
                          {completedDate && (
                            <span className="flex items-center gap-1">
                              <Check className="h-3 w-3" />
                              {completedDate.toLocaleDateString()}
                            </span>
                          )}
                        </div>

                        {/* Expand/Collapse button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedIntake(isExpanded ? null : appointment.id)}
                          className="w-full justify-between text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                        >
                          <span>{isExpanded ? t('crm.drawer.intake_hide_details') : t('crm.drawer.intake_view_details')}</span>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>

                        {/* Responses */}
                        {isExpanded && appointment.intake_responses?.responses && (
                          <div className="mt-4 pt-4 border-t border-[var(--v2-border)] space-y-3">
                            {template?.fields ? (
                              // Render with field labels from template
                              template.fields.map((field) => {
                                const value = appointment.intake_responses?.responses[field.key];
                                if (value === undefined || value === null || value === '') return null;

                                // Format the value based on type
                                let displayValue: string;
                                if (field.type === 'checkbox') {
                                  displayValue = value ? '✓' : '✗';
                                } else if (field.type === 'select' || field.type === 'radio') {
                                  const option = field.options?.find(o => o.value === value);
                                  displayValue = option ? getOptionLabel(option) : String(value);
                                } else if (Array.isArray(value)) {
                                  displayValue = value.join(', ');
                                } else {
                                  displayValue = String(value);
                                }

                                return (
                                  <div key={field.key} className="text-sm">
                                    <span className="text-[var(--v2-text-muted)] font-medium">
                                      {getFieldLabel(field)}:
                                    </span>
                                    <span className="text-[var(--v2-text-primary)] ms-2">
                                      {displayValue}
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              // Fallback: render raw key-value pairs
                              Object.entries(appointment.intake_responses.responses).map(([key, value]) => (
                                <div key={key} className="text-sm">
                                  <span className="text-[var(--v2-text-muted)] font-medium capitalize">
                                    {key.replace(/_/g, ' ')}:
                                  </span>
                                  <span className="text-[var(--v2-text-primary)] ms-2">
                                    {typeof value === 'boolean'
                                      ? (value ? '✓' : '✗')
                                      : Array.isArray(value)
                                        ? value.join(', ')
                                        : String(value)}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>{t('crm.drawer.no_intake')}</p>
                    <p className="text-xs mt-1 opacity-60">{t('crm.drawer.no_intake_desc')}</p>
                  </div>
                )}
              </div>
            </TabsContent>
            )}

            {/* Documents Tab */}
            <TabsContent value="documents" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              <div className="space-y-4">
                {/* Upload Button */}
                <Button
                  onClick={() => setShowUploadModal(true)}
                  className="w-full text-white"
                  style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
                >
                  <Upload className="h-4 w-4 me-2" />
                  {t('crm.drawer.upload_document')}
                </Button>

                {/* Documents List */}
                {loadingDocuments ? (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    {t('crm.drawer.loading_documents')}
                  </div>
                ) : documents.length > 0 ? (
                  <div className="space-y-3">
                    {documents.map(doc => {
                      const typeConfig = getDocumentTypeConfig(doc.document_type);
                      const fileType = getFileType(doc.mime_type);
                      return (
                        <div
                          key={doc.id}
                          className="p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg hover:border-[#8B5CF6]/50 transition-colors group"
                        >
                          <div className="flex items-start gap-3">
                            {/* File Type Icon */}
                            <FileTypeIcon type={fileType} />

                            {/* Document Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-[var(--v2-text-primary)] truncate">
                                  {doc.name}
                                </span>
                              </div>
                              <div className="flex items-center flex-wrap gap-2 text-xs text-[var(--v2-text-muted)]">
                                <Badge variant="outline" className={`text-[10px] px-2 py-0 ${typeConfig.color}`}>
                                  {t(typeConfig.labelKey)}
                                </Badge>
                                <span>{formatFileSize(doc.file_size)}</span>
                                <span>•</span>
                                <span>{formatDate(doc.created_at)}</span>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDownloadDocument(doc.id)}
                                className="h-8 w-8 p-0 text-[var(--v2-text-muted)] hover:text-[#8B5CF6]"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm(t('crm.drawer.delete_document_confirm'))) {
                                    handleDeleteDocument(doc.id);
                                  }
                                }}
                                className="h-8 w-8 p-0 text-[var(--v2-text-muted)] hover:text-red-500"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 text-[var(--v2-text-muted)]">
                    <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">{t('crm.drawer.no_documents')}</p>
                    <p className="text-sm mt-1">{t('crm.drawer.no_documents_desc')}</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tasks Tab */}
            <TabsContent value="tasks" className="m-0 p-6" dir={isRTL ? 'rtl' : 'ltr'}>
              {/* Add Task Form */}
              <div className="mb-6 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                <h4 className="text-sm font-medium text-[var(--v2-text-primary)] mb-3">{t('crm.drawer.add_task')}</h4>
                <div className="space-y-3">
                  <Input
                    placeholder={t('crm.drawer.task_title_placeholder')}
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="bg-[var(--v2-bg)] border-[var(--v2-border)]"
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="bg-[var(--v2-bg)] border-[var(--v2-border)]"
                      />
                    </div>
                    <Select
                      value={newTaskPriority}
                      onValueChange={(value) => setNewTaskPriority(value as 'low' | 'medium' | 'high' | 'urgent')}
                    >
                      <SelectTrigger className="w-[140px] bg-[var(--v2-bg)] border-[var(--v2-border)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('crm.drawer.priority_low')}</SelectItem>
                        <SelectItem value="medium">{t('crm.drawer.priority_medium')}</SelectItem>
                        <SelectItem value="high">{t('crm.drawer.priority_high')}</SelectItem>
                        <SelectItem value="urgent">{t('crm.drawer.priority_urgent')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleCreateTask}
                      disabled={!newTaskTitle.trim() || savingTask}
                      className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                    >
                      {savingTask ? t('crm.drawer.adding') : t('crm.drawer.add')}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Tasks List */}
              {loadingTasks ? (
                <div className="text-center py-8 text-[var(--v2-text-muted)]">
                  {t('crm.drawer.loading_tasks')}
                </div>
              ) : tasks.length > 0 ? (
                <div className="space-y-2">
                  {tasks.map(task => {
                    const isCompleted = task.status === 'completed';
                    const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !isCompleted;

                    return (
                      <div
                        key={task.id}
                        className={`flex items-start gap-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] group ${isCompleted ? 'opacity-60' : ''}`}
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                      >
                        <button
                          onClick={() => handleToggleTaskStatus(task.id, task.status)}
                          className={`mt-0.5 flex-shrink-0 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                            isCompleted
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-[var(--v2-border)] hover:border-[#8B5CF6]'
                          }`}
                        >
                          {isCompleted && <Check className="h-3 w-3" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${isCompleted ? 'line-through text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-primary)]'}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {task.due_date && (
                              <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-red-500' : 'text-[var(--v2-text-muted)]'}`}>
                                <Clock className="h-3 w-3" />
                                {new Date(task.due_date).toLocaleDateString(isRTL ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              task.priority === 'urgent' ? 'bg-red-500/20 text-red-500' :
                              task.priority === 'high' ? 'bg-orange-500/20 text-orange-500' :
                              task.priority === 'medium' ? 'bg-blue-500/20 text-blue-500' :
                              'bg-slate-500/20 text-slate-500'
                            }`}>
                              {t(`crm.drawer.priority_${task.priority}`)}
                            </span>
                            {task.created_by !== 'manual' && (
                              <Badge className="text-xs gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30">
                                <Bot className="h-3 w-3" />
                                AI
                              </Badge>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteTask(task.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--v2-text-muted)] hover:text-red-500 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 text-[var(--v2-text-muted)]">
                  <CheckSquare className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">{t('crm.drawer.no_tasks')}</p>
                  <p className="text-sm mt-1">{t('crm.drawer.no_tasks_desc')}</p>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* Upload Document Modal */}
        {showUploadModal && (
          <DocumentUploadModal
            isOpen={showUploadModal}
            onClose={() => setShowUploadModal(false)}
            onUpload={handleFileUpload}
            uploading={uploadingDocument}
            t={t}
          />
        )}

        {/* Sticky Footer */}
        <div className="flex-shrink-0 p-6 border-t border-[var(--v2-border)]" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 me-2" />
                {t('crm.drawer.delete')}
              </Button>
              {/* Hide deactivate button if already at last stage (deactivated) */}
              {stages.length > 0 && formData.stage !== stages[stages.length - 1].stage_key && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowDeactivateConfirm(true)}
                  className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                >
                  <UserX className="h-4 w-4 me-2" />
                  {t('crm.drawer.deactivate')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]"
              >
                {t('button.cancel')}
              </Button>
              <Button
                onClick={() => handleSubmit()}
                disabled={loading || !formData.first_name || !formData.last_name || !formData.email || !formData.phone}
                className="text-white disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)'
                }}
              >
                {loading ? t('crm.modal.saving') : t('crm.modal.save_changes')}
              </Button>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
            <div className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6 max-w-md w-full mx-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
              <div className="flex items-center gap-3 mb-4 text-red-500">
                <AlertCircle className="h-6 w-6" />
                <h3 className="text-lg font-semibold">{t('crm.drawer.delete_confirm_title')}</h3>
              </div>
              <p className="text-[var(--v2-text-secondary)] mb-4">
                {t('crm.drawer.delete_confirm_message')}
              </p>

              {/* Warning about data loss */}
              {(appointments.length > 0 || payments.length > 0 || documents.length > 0 || activities.length > 0 || emails.length > 0) && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 mb-6" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                  <p className="text-amber-600 dark:text-amber-400 font-medium mb-2 text-sm">
                    {t('crm.drawer.delete_data_warning_title')}
                  </p>
                  <ul className="text-sm text-amber-600/80 dark:text-amber-400/80 space-y-1">
                    {appointments.length > 0 && (
                      <li className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {t('crm.drawer.delete_data_bookings').replace('{count}', String(appointments.length))}
                      </li>
                    )}
                    {payments.length > 0 && (
                      <li className="flex items-center gap-2">
                        <CreditCard className="h-3.5 w-3.5" />
                        {t('crm.drawer.delete_data_payments').replace('{count}', String(payments.length))}
                      </li>
                    )}
                    {emails.length > 0 && (
                      <li className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        {t('crm.drawer.delete_data_emails').replace('{count}', String(emails.length))}
                      </li>
                    )}
                    {documents.length > 0 && (
                      <li className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        {t('crm.drawer.delete_data_documents').replace('{count}', String(documents.length))}
                      </li>
                    )}
                    {activities.length > 0 && (
                      <li className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5" />
                        {t('crm.drawer.delete_data_activities').replace('{count}', String(activities.length))}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="border-[var(--v2-border)]"
                >
                  {t('button.cancel')}
                </Button>
                <Button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-red-500 hover:bg-red-600 text-white"
                >
                  {deleting ? t('crm.drawer.deleting') : t('crm.drawer.delete_confirm')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Deactivate Confirmation Modal */}
        {showDeactivateConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
            <div className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6 max-w-md w-full mx-4" style={{ borderRadius: 'var(--v2-radius-card)' }}>
              <div className="flex items-center gap-3 mb-4 text-amber-500">
                <UserX className="h-6 w-6" />
                <h3 className="text-lg font-semibold">{t('crm.drawer.deactivate_confirm_title')}</h3>
              </div>

              {hasActiveItems ? (
                <>
                  <div className="bg-red-500/10 border border-red-500/30 p-4 mb-4" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <p className="text-red-600 dark:text-red-400 font-medium mb-2">
                      {t('crm.drawer.deactivate_blocked_title')}
                    </p>
                    <ul className="text-sm text-red-600/80 dark:text-red-400/80 space-y-1">
                      {futureBookings.length > 0 && (
                        <li className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          {t('crm.drawer.deactivate_blocked_bookings').replace('{count}', String(futureBookings.length))}
                        </li>
                      )}
                      {pendingPayments.length > 0 && (
                        <li className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          {t('crm.drawer.deactivate_blocked_payments').replace('{count}', String(pendingPayments.length))}
                        </li>
                      )}
                    </ul>
                  </div>
                  <p className="text-[var(--v2-text-secondary)] mb-6 text-sm">
                    {t('crm.drawer.deactivate_blocked_message')}
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setShowDeactivateConfirm(false)}
                      className="border-[var(--v2-border)]"
                    >
                      {t('button.close')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[var(--v2-text-secondary)] mb-6">
                    {t('crm.drawer.deactivate_confirm_message')}
                  </p>
                  <div className="flex justify-end gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setShowDeactivateConfirm(false)}
                      className="border-[var(--v2-border)]"
                    >
                      {t('button.cancel')}
                    </Button>
                    <Button
                      onClick={handleDeactivate}
                      disabled={deactivating}
                      className="bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      {deactivating ? t('crm.drawer.deactivating') : t('crm.drawer.deactivate_confirm')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <style jsx global>{`
          /* react-phone-number-input custom styling for V2 design system */
          .phone-input-crm {
            display: flex;
          }

          .phone-input-crm .PhoneInputCountry {
            display: none;
          }

          .phone-input-crm .PhoneInputInput {
            flex: 1;
            background: var(--v2-surface);
            border: 1px solid var(--v2-border);
            border-radius: var(--v2-radius-button);
            padding: 0.5rem 0.75rem;
            color: var(--v2-text-primary);
            font-size: 0.875rem;
            outline: none;
            transition: all 0.2s ease;
          }

          .phone-input-crm .PhoneInputInput:focus {
            border-color: #8B5CF6;
            box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
          }

          .phone-input-crm .PhoneInputInput::placeholder {
            color: var(--v2-text-muted);
          }
        `}</style>
      </SheetContent>
    </Sheet>

    {/* Booking Modal - rendered outside Sheet for proper z-index stacking */}
    <SchedulingBookingModal
      booking={editingBooking}
      services={services}
      isOpen={showBookingModal}
      onClose={() => {
        setShowBookingModal(false);
        setEditingBooking(undefined);
      }}
      onBookingUpdated={() => {
        fetchAppointments(contact.id);
        fetchActivities(contact.id);
        setShowBookingModal(false);
        setEditingBooking(undefined);
      }}
      availability={availability}
      prefilledContact={{
        id: contact.id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        phone: contact.phone
      }}
      existingBookings={appointments.map(apt => ({
        id: apt.id,
        user_id: '',
        service_id: apt.service_id,
        contact_id: contact.id,
        client_first_name: apt.client_first_name,
        client_last_name: apt.client_last_name || null,
        client_email: contact.email,
        client_phone: contact.phone || null,
        start_time: apt.start_time,
        end_time: apt.end_time,
        timezone: apt.timezone || 'UTC',
        status: apt.status,
        notes: apt.notes || null,
        cancellation_reason: null,
        payment_status: 'pending',
        payment_id: null,
        internal_notes: null,
        booking_source: 'manual',
        reminder_24hr_sent: false,
        reminder_2hr_sent: false,
        external_calendar_event_id: null,
        calendar_sync_provider: null,
        calendar_synced_at: null,
        calendar_sync_error: null,
        intake_responses: apt.intake_responses || null,
        intake_completed_at: apt.intake_completed_at || null,
        created_at: '',
        updated_at: ''
      }) as SchedulingBooking)}
    />
    </>
  );
}
