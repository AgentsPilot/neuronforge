// CRM Contact Drawer - Modular Components
// Main drawer and all section components

// Main component
export { CRMContactDrawerV2 } from './CRMContactDrawerV2';

// Section components
export { ClientDetailsSection } from './ClientDetailsSection';
export { NotesSection } from './NotesSection';
export { SessionsSection } from './SessionsSection';
export { TasksSection } from './TasksSection';
export { ActivitySection } from './ActivitySection';
export { FilesTab } from './FilesTab';

// Types
export type {
  ContactFormData,
  SectionProps,
  SessionCardData,
  SessionPayment,
  Appointment,
  ContactTask,
  ContactEmail,
  ContactDocument,
  IntakeResponses,
  IntakeTemplate,
  IntakeTemplateField,
  PaymentTransaction,
  CRMContact,
  CRMActivity,
  CRMPipelineStage
} from './types';
