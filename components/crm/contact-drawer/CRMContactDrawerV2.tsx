'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User, FolderOpen, Trash2, UserX, Check, Calendar, X, Upload, File, FileText, MessageSquare
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SchedulingBookingModal } from '@/components/scheduling/SchedulingBookingModal';
import type { SchedulingService, SchedulingBooking } from '@/lib/repositories/SchedulingRepository';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// Import modular sections
import { ClientDetailsSection } from './ClientDetailsSection';
import { NotesSection } from './NotesSection';
import { SessionsSection } from './SessionsSection';
import { TasksSection } from './TasksSection';
import { ActivitySection } from './ActivitySection';
import { FilesTab } from './FilesTab';
import { BookingsTab } from './BookingsTab';
import { PaymentManagementModal } from './PaymentManagementModal';
import { FormSubmissionsSection } from './FormSubmissionsSection';

import type {
  CRMContact,
  CRMActivity,
  CRMPipelineStage,
  ContactFormData,
  SessionCardData,
  SessionPayment,
  ContactTask,
  ContactDocument,
  ContactEmail,
  IntakeResponses,
  IntakeTemplate,
  BookingJourneyStep,
  Appointment
} from './types';

// Extended booking data that includes confirmation email info
interface ExtendedBookingData {
  booking: Appointment;
  payment: SessionPayment | null;
  confirmationEmail?: {
    status: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed' | 'pending';
    sentAt?: string;
    openedAt?: string;
    subject?: string;  // Email subject line
  };
}

// Build journey steps based on booking data
// This determines which steps to show and their status for each booking type
function buildJourneySteps(
  data: ExtendedBookingData,
  language: string = 'en'
): BookingJourneyStep[] {
  const { booking, payment, confirmationEmail } = data;
  const steps: BookingJourneyStep[] = [];
  const isProduct = !booking.start_time || booking.service?.is_product;
  const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;
  const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
  const endDate = booking.end_time ? new Date(booking.end_time) : null;
  const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
  const isCompleted = booking.status === 'completed';
  const isCancelled = booking.status === 'cancelled' || booking.status === 'no_show';

  // Helper to format date and time
  const formatDateTime = (date: Date) => date.toLocaleString(language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Helper to format time only
  const formatTime = (date: Date) => date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });

  // Helper to format currency
  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(language, { style: 'currency', currency }).format(amount);
  };

  // Step 1: Service/Product (always completed - they booked it)
  steps.push({
    id: `${booking.id}-service`,
    key: isProduct ? 'product' : 'service',
    status: 'completed',
    details: booking.service?.service_name,
    timestamp: booking.created_at
  });

  // Step 2: Client Info (captured at booking time)
  const clientName = [booking.client_first_name, booking.client_last_name].filter(Boolean).join(' ');
  const clientDetails = [
    clientName,
    booking.client_email,
    booking.client_phone
  ].filter(Boolean).join(' • ');

  steps.push({
    id: `${booking.id}-client`,
    key: 'client',
    status: 'completed',
    details: clientDetails || clientName,
    timestamp: booking.created_at
  });

  // Step 3: Schedule (only for services with time slot) - include full date and time
  if (!isProduct && booking.start_time && bookingDate) {
    const timeRange = endDate
      ? `${formatTime(bookingDate)} - ${formatTime(endDate)}`
      : formatTime(bookingDate);

    steps.push({
      id: `${booking.id}-schedule`,
      key: 'schedule',
      status: isCompleted ? 'completed' : isCancelled ? 'failed' : 'active',
      details: timeRange,  // Show actual time range
      timestamp: booking.start_time
    });
  }

  // Step 3: Payment (if applicable) - format amount properly with status
  if (payment) {
    const paymentDetails = payment.status === 'free'
      ? undefined
      : formatAmount(payment.amount, payment.currency);

    steps.push({
      id: `${booking.id}-payment`,
      key: 'payment',
      status: payment.status === 'paid' || payment.status === 'free' ? 'completed' :
              payment.status === 'pending' ? 'active' :
              payment.status === 'failed' ? 'failed' : 'pending',
      details: paymentDetails,
      timestamp: payment.paidAt
    });
  }

  // Step 4: Intake Form (only for services, not products)
  // Note: details are not included here as BookingsTab renders intake specially with translated response count
  if (!isProduct) {
    steps.push({
      id: `${booking.id}-intake`,
      key: 'intake',
      status: hasIntake ? 'completed' :
              isUpcoming ? 'active' :
              isCompleted || isCancelled ? 'skipped' : 'pending',
      timestamp: booking.intake_completed_at
    });
  }

  // Step 5: Email Confirmation (booking confirmation email sent to client)
  // This is sent automatically when booking is created
  const emailStatus = confirmationEmail?.status || 'sent'; // Assume sent if no data (auto-sent on booking)
  const emailDetails = confirmationEmail?.subject || undefined;  // Show email subject

  steps.push({
    id: `${booking.id}-confirmation`,
    key: 'confirmation',
    status: emailStatus === 'opened' || emailStatus === 'clicked' ? 'completed' :
            emailStatus === 'delivered' || emailStatus === 'sent' ? 'completed' :
            emailStatus === 'bounced' || emailStatus === 'failed' ? 'failed' :
            emailStatus === 'pending' ? 'active' : 'completed',
    details: emailDetails,
    timestamp: confirmationEmail?.sentAt || booking.created_at  // Email sent when booking created
  });

  // Step 6: Final status (Session for services, Fulfillment for products)
  steps.push({
    id: `${booking.id}-final`,
    key: isProduct ? 'fulfillment' : 'session',
    status: isCompleted ? 'completed' :
            isCancelled ? 'failed' :
            isUpcoming ? 'pending' : 'active'
  });

  return steps;
}

interface CRMContactDrawerV2Props {
  contact: CRMContact;
  stages: CRMPipelineStage[];
  enabledCapabilities?: string[];
  isOpen: boolean;
  onClose: () => void;
  onContactUpdated: () => void;
}

// Document types for upload
const DOCUMENT_TYPES = [
  { value: 'contract', labelKey: 'crm.document.type.contract' },
  { value: 'intake_form', labelKey: 'crm.document.type.intake_form' },
  { value: 'invoice', labelKey: 'crm.document.type.invoice' },
  { value: 'receipt', labelKey: 'crm.document.type.receipt' },
  { value: 'id_document', labelKey: 'crm.document.type.id_document' },
  { value: 'medical', labelKey: 'crm.document.type.medical' },
  { value: 'insurance', labelKey: 'crm.document.type.insurance' },
  { value: 'other', labelKey: 'crm.document.type.other' }
];

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

  const handleClose = () => {
    // Reset form state when closing
    setFile(null);
    setDocName('');
    setDocType('other');
    setDescription('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="bg-[var(--v2-bg)] border-[var(--v2-border)] max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-[var(--v2-text-primary)]">
            {t('crm.document.upload_title') || 'Upload Document'}
          </DialogTitle>
        </DialogHeader>

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
                  {t('crm.document.remove') || 'Remove'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-10 w-10 mx-auto text-[var(--v2-text-muted)]" />
                <p className="text-[var(--v2-text-secondary)]">
                  {t('crm.document.drag_drop') || 'Drag and drop a file, or click to browse'}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)]">
                  {t('crm.document.max_size') || 'Max 10MB'} • {t('crm.document.supported_formats') || 'PDF, DOC, XLS, Images'}
                </p>
              </div>
            )}
          </div>

          {/* Document Name */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.name') || 'Document Name'} <span className="text-red-500 dark:text-red-400">*</span>
            </Label>
            <Input
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              placeholder={t('crm.document.name_placeholder') || 'Enter document name'}
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
            />
          </div>

          {/* Document Type */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.type') || 'Document Type'}
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
                  {t(type.labelKey) || type.value}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <Label className="text-[var(--v2-text-secondary)] mb-2 block">
              {t('crm.document.description') || 'Description'}
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('crm.document.description_placeholder') || 'Optional description...'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/20 resize-none"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
            className="border-[var(--v2-border)]"
          >
            {t('button.cancel') || 'Cancel'}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!file || !docName || uploading}
            className="text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
          >
            {uploading ? (t('crm.drawer.uploading') || 'Uploading...') : (t('crm.drawer.upload_document') || 'Upload Document')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CRMContactDrawerV2({
  contact,
  stages,
  enabledCapabilities = [],
  isOpen,
  onClose,
  onContactUpdated
}: CRMContactDrawerV2Props) {
  const { t, isRTL, language } = useLanguage();

  // Form state
  const [formData, setFormData] = useState<ContactFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    stage: 'lead',
    source: '',
    tags: [],
    notes: '',
    custom_fields: {}
  });

  // Data states
  const [sessions, setSessions] = useState<SessionCardData[]>([]);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [emails, setEmails] = useState<ContactEmail[]>([]);
  const [tasks, setTasks] = useState<ContactTask[]>([]);
  const [documents, setDocuments] = useState<ContactDocument[]>([]);
  const [intakeResponses, setIntakeResponses] = useState<Array<{
    booking_id: string;
    booking_date: string;
    service_name: string;
    intake: IntakeResponses;
    template?: IntakeTemplate;
  }>>([]);
  const [intakeTemplates, setIntakeTemplates] = useState<Record<string, IntakeTemplate>>({});

  // Loading states
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal states
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState<SchedulingBooking | undefined>(undefined);
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [availability, setAvailability] = useState<Record<string, { start: string; end: string }[]> | undefined>(undefined);
  const [allBookings, setAllBookings] = useState<SchedulingBooking[]>([]);

  // Payment management modal state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedBookingForPayment, setSelectedBookingForPayment] = useState<SessionCardData | null>(null);

  // UI states
  const [activeTab, setActiveTab] = useState<'customer' | 'activities'>('customer');
  const [isEditingHeader, setIsEditingHeader] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Accordion state - only one section open at a time
  const [openSection, setOpenSection] = useState<'details' | 'bookings' | 'tasks' | 'forms' | 'files' | null>('bookings');

  // Toggle section - closes others when opening one
  const handleSectionToggle = (section: 'details' | 'bookings' | 'tasks' | 'forms' | 'files') => (isOpen: boolean) => {
    setOpenSection(isOpen ? section : null);
  };

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form data when contact changes
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
      setActiveTab('customer');
      setShowDeleteConfirm(false);
      setShowDeactivateConfirm(false);
      setErrorMessage('');
      setSuccessMessage('');

      // Fetch all data
      fetchSessions(contact.id);
      fetchActivities(contact.id);
      fetchEmails(contact.id);
      fetchTasks(contact.id);
      fetchDocuments(contact.id);
      fetchServices();
      fetchAvailability();
      fetchAllBookings();
    }
  }, [contact, isOpen]);

  // Fetch sessions (bookings with payments and emails)
  const fetchSessions = async (contactId: string) => {
    try {
      setLoadingSessions(true);

      // Fetch bookings and emails in parallel
      const [bookingsResponse, emailsResponse] = await Promise.all([
        fetch(`/api/scheduling/bookings?contact_id=${contactId}&limit=50`),
        fetch(`/api/crm/contacts/${contactId}/emails?limit=100`)
      ]);

      if (!bookingsResponse.ok) {
        return;
      }

      const bookingsData = await bookingsResponse.json();
      const emailsData = emailsResponse.ok ? await emailsResponse.json() : { emails: [] };

      // Create a map of emails by approximate booking time (within 5 minutes of booking creation)
      // Email subjects containing "confirmation" or service name are matched to bookings
      interface EmailRecord {
        id: string;
        subject: string;
        status: 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
        sent_at: string | null;
        opened_at: string | null;
        created_at: string;
      }
      const emails: EmailRecord[] = emailsData.emails || [];

      // Helper to find confirmation email for a booking
      const findConfirmationEmail = (bookingCreatedAt: string, serviceName?: string): EmailRecord | undefined => {
        const bookingTime = new Date(bookingCreatedAt).getTime();
        const fiveMinutes = 5 * 60 * 1000;

        return emails.find(email => {
          const emailTime = new Date(email.created_at).getTime();
          const isNearBookingTime = Math.abs(emailTime - bookingTime) < fiveMinutes;
          const isConfirmation = email.subject.toLowerCase().includes('confirm') ||
            email.subject.toLowerCase().includes('booking') ||
            email.subject.toLowerCase().includes('אישור') ||
            (serviceName && email.subject.toLowerCase().includes(serviceName.toLowerCase()));
          return isNearBookingTime && isConfirmation;
        });
      };

      if (bookingsData.success && bookingsData.bookings) {
        const sessionCards: SessionCardData[] = bookingsData.bookings.map((booking: SchedulingBooking) => {
          const bookingData: Appointment = {
            id: booking.id,
            service_id: booking.service_id,
            client_first_name: booking.client_first_name,
            client_last_name: booking.client_last_name,
            client_email: booking.client_email,
            client_phone: booking.client_phone,
            start_time: booking.start_time,
            end_time: booking.end_time,
            timezone: booking.timezone,
            status: booking.status,
            notes: booking.notes,
            intake_responses: booking.intake_responses,
            intake_completed_at: booking.intake_completed_at,
            created_at: booking.created_at,
            service: booking.service
          };

          // Map actual payment_status from booking to SessionPayment status
          const mapPaymentStatus = (dbStatus?: string): 'paid' | 'pending' | 'failed' | 'free' => {
            if (dbStatus === 'paid' || dbStatus === 'refunded') return 'paid';
            if (dbStatus === 'pending') return 'pending';
            return 'pending'; // default
          };

          // Check if this service is free (price 0 or null)
          const servicePrice = booking.service?.price ?? 0;
          const serviceCurrency = booking.service?.currency || 'USD';
          const isFreeService = servicePrice === 0;

          const paymentData: SessionPayment | null = isFreeService ? {
            amount: 0,
            currency: serviceCurrency,
            status: 'free' as const
          } : servicePrice > 0 ? {
            id: booking.payment_id || undefined,  // Payment ID for refunds
            amount: servicePrice,
            currency: serviceCurrency,
            status: mapPaymentStatus(booking.payment_status)
          } : null;

          // Find confirmation email for this booking
          const confirmationEmail = findConfirmationEmail(booking.created_at, booking.service?.service_name);

          return {
            booking: bookingData,
            payment: paymentData,
            journeySteps: buildJourneySteps(
              {
                booking: bookingData,
                payment: paymentData,
                confirmationEmail: confirmationEmail ? {
                  status: confirmationEmail.status,
                  sentAt: confirmationEmail.sent_at || confirmationEmail.created_at,
                  openedAt: confirmationEmail.opened_at || undefined,
                  subject: confirmationEmail.subject
                } : undefined
              },
              language
            )
          };
        });
        setSessions(sessionCards);

        // Extract intake responses for Files tab
        const intakes = sessionCards
          .filter(s => s.booking.intake_responses)
          .map(s => ({
            booking_id: s.booking.id,
            booking_date: s.booking.start_time,
            service_name: s.booking.service?.service_name || '',
            intake: s.booking.intake_responses as IntakeResponses
          }));
        setIntakeResponses(intakes);
      }
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const fetchActivities = async (contactId: string) => {
    try {
      setLoadingActivities(true);
      const response = await fetch(`/api/crm/activities?contact_id=${contactId}&limit=50`);
      const data = await response.json();

      if (data.success) {
        setActivities(data.activities || []);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoadingActivities(false);
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

  const fetchTasks = async (contactId: string) => {
    try {
      setLoadingTasks(true);
      const response = await fetch(`/api/crm/tasks?contact_id=${contactId}&include_completed=true&limit=20`);
      const data = await response.json();

      if (data.success) {
        setTasks(data.tasks || []);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchDocuments = async (contactId: string) => {
    try {
      setLoadingDocuments(true);
      const response = await fetch(`/api/crm/contacts/${contactId}/documents`);
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

  const fetchServices = async () => {
    try {
      const response = await fetch('/api/scheduling/services?activeOnly=true');
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
      if (data.success) {
        setAvailability(data.availability);
      }
    } catch (error) {
      console.error('Failed to fetch availability:', error);
    }
  };

  // Fetch all bookings (for availability slot filtering)
  const fetchAllBookings = async () => {
    try {
      // Get bookings for the next 30 days to filter available slots
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      const response = await fetch(
        `/api/scheduling/bookings?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}&limit=200`
      );
      const data = await response.json();
      if (data.success) {
        setAllBookings(data.bookings || []);
      }
    } catch (error) {
      console.error('Failed to fetch all bookings:', error);
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

  // Fetch intake templates for bookings that have intake responses
  useEffect(() => {
    const fetchTemplatesForIntakes = async () => {
      // Collect unique template IDs that we don't have yet
      const templateIdsToFetch = new Set<string>();
      for (const item of intakeResponses) {
        const templateId = item.intake.template_id;
        if (templateId && !intakeTemplates[templateId] && !item.template) {
          templateIdsToFetch.add(templateId);
        }
      }

      // Fetch missing templates
      for (const templateId of templateIdsToFetch) {
        await fetchIntakeTemplate(templateId);
      }
    };

    if (intakeResponses.length > 0) {
      fetchTemplatesForIntakes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakeResponses.length]); // Re-run when intakeResponses count changes

  // Update intake responses with templates when they become available
  useEffect(() => {
    if (Object.keys(intakeTemplates).length > 0 && intakeResponses.length > 0) {
      const needsUpdate = intakeResponses.some(ir =>
        ir.intake.template_id && !ir.template && intakeTemplates[ir.intake.template_id]
      );

      if (needsUpdate) {
        setIntakeResponses(prev => prev.map(ir => {
          const templateId = ir.intake.template_id;
          if (templateId && !ir.template && intakeTemplates[templateId]) {
            return { ...ir, template: intakeTemplates[templateId] };
          }
          return ir;
        }));
      }
    }
  }, [intakeTemplates, intakeResponses]);

  // Save contact changes
  const handleSave = async () => {
    setSaving(true);
    setErrorMessage('');

    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: formData.phone,
          stage: formData.stage,
          source: formData.source,
          tags: formData.tags,
          custom_fields: {
            ...formData.custom_fields,
            notes: formData.notes
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccessMessage(t('crm.drawer.saved') || 'Saved');
        setTimeout(() => setSuccessMessage(''), 2000);
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.save_error'));
      }
    } catch (error) {
      console.error('Failed to save contact:', error);
      setErrorMessage(t('crm.drawer.save_error'));
    } finally {
      setSaving(false);
    }
  };

  // Notes auto-save handler
  const handleNotesChange = useCallback(async (notes: string) => {
    setFormData(prev => ({ ...prev, notes }));

    // Auto-save notes
    try {
      await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom_fields: {
            ...formData.custom_fields,
            notes
          }
        })
      });
    } catch (error) {
      console.error('Failed to auto-save notes:', error);
    }
  }, [contact.id, formData.custom_fields]);

  // Task handlers
  const handleCreateTask = async (title: string, priority?: string, dueDate?: string) => {
    try {
      const response = await fetch('/api/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          title,
          priority: priority || 'medium',
          due_date: dueDate || undefined
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchTasks(contact.id);
      }
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleToggleTask = async (taskId: string, completed: boolean) => {
    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: completed ? 'completed' : 'pending' })
      });

      const data = await response.json();
      if (data.success) {
        fetchTasks(contact.id);
      }
    } catch (error) {
      console.error('Failed to toggle task:', error);
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

  // Activity handler
  const handleAddActivity = async (type: string, description: string) => {
    try {
      const response = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          activity_type: type,
          title: t(`crm.activity.type.${type}`),
          description
        })
      });

      const data = await response.json();
      if (data.success) {
        fetchActivities(contact.id);
      }
    } catch (error) {
      console.error('Failed to add activity:', error);
    }
  };

  // Session handlers
  const handleNewSession = () => {
    setEditingBooking(undefined);
    setShowBookingModal(true);
  };

  const handleEditSession = (bookingId: string) => {
    const session = sessions.find(s => s.booking.id === bookingId);
    if (session) {
      // Convert to SchedulingBooking format for modal (matching old drawer format)
      setEditingBooking({
        id: session.booking.id,
        user_id: '',
        service_id: session.booking.service_id,
        contact_id: contact.id,
        client_first_name: session.booking.client_first_name,
        client_last_name: session.booking.client_last_name || null,
        client_email: contact.email,
        client_phone: contact.phone || null,
        start_time: session.booking.start_time,
        end_time: session.booking.end_time,
        timezone: session.booking.timezone || 'UTC',
        status: session.booking.status,
        notes: session.booking.notes || null,
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
        intake_responses: session.booking.intake_responses || null,
        intake_completed_at: session.booking.intake_completed_at || null,
        created_at: '',
        updated_at: ''
      } as SchedulingBooking);
      setShowBookingModal(true);
    }
  };

  const handleBookingSaved = () => {
    setShowBookingModal(false);
    setEditingBooking(undefined);
    fetchSessions(contact.id);
    fetchActivities(contact.id);
    onContactUpdated();
  };

  // Delete contact
  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        onClose();
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.delete_error'));
      }
    } catch (error) {
      console.error('Failed to delete contact:', error);
      setErrorMessage(t('crm.drawer.delete_error'));
    }
  };

  // Deactivate contact
  const handleDeactivate = async () => {
    try {
      const response = await fetch(`/api/crm/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false })
      });

      const data = await response.json();
      if (data.success) {
        onClose();
        onContactUpdated();
      } else {
        setErrorMessage(data.error || t('crm.drawer.deactivate_error'));
      }
    } catch (error) {
      console.error('Failed to deactivate contact:', error);
      setErrorMessage(t('crm.drawer.deactivate_error'));
    }
  };

  // File upload handler
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
        setSuccessMessage(t('crm.drawer.upload_success') || 'Document uploaded successfully');
        setShowUploadModal(false);
        fetchDocuments(contact.id);
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setErrorMessage(data.error || t('crm.drawer.upload_error') || 'Failed to upload document');
      }
    } catch (error) {
      console.error('Failed to upload document:', error);
      setErrorMessage(t('crm.drawer.upload_error') || 'Failed to upload document');
    } finally {
      setUploadingDocument(false);
    }
  };

  // Get stage color
  const getStageColor = () => {
    const stage = stages.find(s => s.stage_key === formData.stage);
    return stage?.color || '#64748B';
  };

  // Get initials for avatar
  const getInitials = () => {
    const first = formData.first_name?.[0] || '';
    const last = formData.last_name?.[0] || '';
    return (first + last).toUpperCase() || '?';
  };

  // Count sessions for badge
  const upcomingSessions = sessions.filter(s =>
    s.booking.status === 'confirmed' && new Date(s.booking.start_time) > new Date()
  ).length;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side={isRTL ? 'left' : 'right'}
          className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col [&>button]:hidden"
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          {/* Header - matching old drawer design */}
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
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] truncate text-start">
                    {formData.first_name} {formData.last_name}
                  </SheetTitle>
                  <Badge
                    className="text-xs font-bold px-3 py-1 rounded-full text-white"
                    style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
                  >
                    {t(`crm.stage.${formData.stage}`) || formData.stage}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--v2-text-muted)] flex-wrap">
                  <span>
                    {t('crm.drawer.created_at')}: <bdi>{new Date(contact.created_at).toLocaleDateString(language)}</bdi>
                  </span>
                  <span>•</span>
                  <span>
                    {t('crm.drawer.updated_at')}: <bdi>{new Date(contact.updated_at).toLocaleDateString(language)}</bdi>
                  </span>
                  {sessions.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-[var(--v2-text-muted)]" />
                        <bdi>{sessions.length}</bdi> {t('crm.drawer.bookings')}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {/* Close button */}
              <button
                type="button"
                onClick={onClose}
                className="flex-shrink-0 p-2 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          {successMessage && (
            <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-green-500/20 border border-green-500/40 text-green-600 dark:text-green-400 text-sm font-medium rounded-lg">
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="flex-shrink-0 mx-6 mt-4 p-3 bg-red-500/20 border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium rounded-lg">
              {errorMessage}
            </div>
          )}

          {/* Tabs - 2 tabs: Customer and Activities */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'customer' | 'activities')} className="flex-1 flex flex-col overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
            <TabsList className="flex-shrink-0 w-full grid grid-cols-2 bg-[var(--v2-surface)] border-b border-[var(--v2-border)] rounded-none h-10">
              <TabsTrigger
                value="customer"
                className="!text-gray-400 data-[state=active]:!bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#8B5CF6] data-[state=active]:!text-[#8B5CF6] rounded-none text-sm"
              >
                <User className="h-4 w-4 me-1.5" />
                {t('crm.drawer.tab_customer') || 'Customer'}
              </TabsTrigger>
              <TabsTrigger
                value="activities"
                className="!text-gray-400 data-[state=active]:!bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-[#8B5CF6] data-[state=active]:!text-[#8B5CF6] rounded-none text-sm"
              >
                <MessageSquare className="h-4 w-4 me-1.5" />
                {t('crm.drawer.tab_activities') || 'Activities'}
              </TabsTrigger>
            </TabsList>

            {/* Customer Tab - Details, Bookings with flow, Tasks, Files */}
            <TabsContent value="customer" className="flex-1 overflow-y-auto mt-0 p-4 space-y-4">
              {/* Details Section - collapsed by default */}
              <ClientDetailsSection
                formData={formData}
                setFormData={setFormData}
                stages={stages}
                t={t}
                isRTL={isRTL}
                defaultOpen={false}
                isOpen={openSection === 'details'}
                onToggle={handleSectionToggle('details')}
              />

              {/* Bookings Section - Timeline flow with cards */}
              <BookingsTab
                sessions={sessions}
                t={t}
                isRTL={isRTL}
                language={language}
                onNewSession={handleNewSession}
                onEditSession={handleEditSession}
                onManagePayment={(session) => {
                  setSelectedBookingForPayment(session);
                  setShowPaymentModal(true);
                }}
                onIntakeSaved={() => {
                  fetchSessions(contact.id);
                  fetchActivities(contact.id);
                }}
                isLoading={loadingSessions}
                intakeTemplates={intakeTemplates}
                isOpen={openSection === 'bookings'}
                onToggle={handleSectionToggle('bookings')}
              />

              {/* Tasks Section */}
              <TasksSection
                tasks={tasks}
                t={t}
                isRTL={isRTL}
                onCreateTask={handleCreateTask}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
                isLoading={loadingTasks}
                isOpen={openSection === 'tasks'}
                onToggle={handleSectionToggle('tasks')}
              />

              {/* Website Form Submissions Section */}
              <FormSubmissionsSection
                contact={contact}
                activities={activities}
                t={t}
                isRTL={isRTL}
                language={language}
                isOpen={openSection === 'forms'}
                onToggle={handleSectionToggle('forms')}
              />

              {/* Files Section */}
              <FilesTab
                documents={documents}
                intakeResponses={intakeResponses}
                t={t}
                isRTL={isRTL}
                language={language}
                isLoading={loadingDocuments}
                onUploadDocument={() => setShowUploadModal(true)}
                onDownloadDocument={(docId) => {
                  const doc = documents.find(d => d.id === docId);
                  if (doc?.download_url) {
                    window.open(doc.download_url, '_blank');
                  }
                }}
                onDeleteDocument={async (docId) => {
                  try {
                    const response = await fetch(`/api/crm/contacts/${contact.id}/documents/${docId}`, {
                      method: 'DELETE'
                    });
                    const data = await response.json();
                    if (data.success) {
                      fetchDocuments(contact.id);
                    }
                  } catch (error) {
                    console.error('Failed to delete document:', error);
                  }
                }}
                isOpen={openSection === 'files'}
                onToggle={handleSectionToggle('files')}
              />
            </TabsContent>

            {/* Activities Tab - Notes & Activity Feed */}
            <TabsContent value="activities" className="flex-1 overflow-y-auto mt-0 p-4 space-y-4">
              {/* Notes Section */}
              <NotesSection
                notes={formData.notes}
                onNotesChange={handleNotesChange}
                t={t}
                isRTL={isRTL}
                defaultOpen={true}
              />

              {/* Activity Section */}
              <ActivitySection
                activities={activities}
                emails={emails}
                t={t}
                isRTL={isRTL}
                language={language}
                onAddActivity={handleAddActivity}
                isLoading={loadingActivities}
                isLoadingEmails={loadingEmails}
              />
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <div className="flex-shrink-0 border-t border-[var(--v2-border)] p-4 bg-[var(--v2-surface)]">
            <div className="flex items-center justify-between">
              {/* Destructive actions */}
              <div className="flex items-center gap-2">
                {!showDeleteConfirm && !showDeactivateConfirm && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeactivateConfirm(true)}
                      className="text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                    >
                      <UserX className="h-4 w-4 me-1" />
                      {t('crm.drawer.deactivate') || 'Deactivate'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4 me-1" />
                      {t('crm.drawer.delete') || 'Delete'}
                    </Button>
                  </>
                )}

                {showDeleteConfirm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-500">{t('crm.drawer.confirm_delete') || 'Delete this contact?'}</span>
                    <Button size="sm" variant="destructive" onClick={handleDelete}>
                      {t('crm.drawer.yes_delete') || 'Yes, delete'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                      {t('crm.drawer.cancel') || 'Cancel'}
                    </Button>
                  </div>
                )}

                {showDeactivateConfirm && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-amber-500">{t('crm.drawer.confirm_deactivate') || 'Deactivate this contact?'}</span>
                    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={handleDeactivate}>
                      {t('crm.drawer.yes_deactivate') || 'Yes, deactivate'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowDeactivateConfirm(false)}>
                      {t('crm.drawer.cancel') || 'Cancel'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Save button */}
              {!showDeleteConfirm && !showDeactivateConfirm && (
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
                >
                  {saving ? t('crm.drawer.saving') || 'Saving...' : t('crm.drawer.save') || 'Save Changes'}
                </Button>
              )}
            </div>
          </div>

          {/* Phone input styles for dark mode */}
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

      {/* Booking Modal */}
      <SchedulingBookingModal
        booking={editingBooking}
        services={services}
        isOpen={showBookingModal}
        onClose={() => {
          setShowBookingModal(false);
          setEditingBooking(undefined);
        }}
        onBookingUpdated={() => {
          fetchSessions(contact.id);
          fetchActivities(contact.id);
          fetchAllBookings(); // Refresh all bookings for availability
          setShowBookingModal(false);
          setEditingBooking(undefined);
          // Note: Don't call onContactUpdated() here - it closes the drawer
          // Booking updates are silently refreshed in the drawer without closing it
        }}
        availability={availability}
        prefilledContact={{
          id: contact.id,
          first_name: contact.first_name,
          last_name: contact.last_name,
          email: contact.email,
          phone: contact.phone
        }}
        existingBookings={allBookings}
      />

      {/* Document Upload Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleFileUpload}
        uploading={uploadingDocument}
        t={t}
      />

      {/* Payment Management Modal */}
      <PaymentManagementModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedBookingForPayment(null);
        }}
        booking={selectedBookingForPayment}
        contactName={`${contact.first_name} ${contact.last_name || ''}`.trim()}
        onPaymentUpdated={() => {
          fetchSessions(contact.id);
          fetchActivities(contact.id);
        }}
        onBookingDeleted={(bookingId) => {
          fetchSessions(contact.id);
          fetchActivities(contact.id);
          setShowPaymentModal(false);
          setSelectedBookingForPayment(null);
        }}
        t={t}
        isRTL={isRTL}
      />

    </>
  );
}
