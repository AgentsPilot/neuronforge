/**
 * ResponseRenderer
 *
 * Generates chat responses from templates - no LLM needed.
 * Supports both English and Hebrew.
 */

import { Capability, CapabilityParam, getCapability } from './CapabilityRegistry';
import type { ExecutionResult } from './CapabilityEngine';
import type { EntityChoice } from './EntityResolver';

// ============== TYPES ==============

export interface EntityCardAction {
  type: 'navigate' | 'edit' | 'call' | 'email' | 'complete' | 'cancel';
  label: string;
  labelHe?: string;
  destination?: string;
  params?: Record<string, string>;
}

export interface ChatAction {
  type: string;
  [key: string]: unknown;
}

export interface ChatResponse {
  message: string;
  messageHe?: string;
  actions: ChatAction[];
}

// ============== RENDERER CLASS ==============

export class ResponseRenderer {
  private isHebrew: boolean;

  constructor(language: 'he' | 'en' = 'en') {
    this.isHebrew = language === 'he';
  }

  /**
   * Set language for rendering
   */
  setLanguage(language: 'he' | 'en'): void {
    this.isHebrew = language === 'he';
  }

  /**
   * Get the localized message
   */
  getMessage(response: ChatResponse): string {
    return (this.isHebrew && response.messageHe) ? response.messageHe : response.message;
  }

  // ============== PARAMETER PROMPTS ==============

  /**
   * Ask user for a parameter value
   */
  askParameter(param: CapabilityParam): ChatResponse {
    const message = this.isHebrew && param.prompt_he
      ? param.prompt_he
      : param.prompt || `What is the ${param.name.replace(/_/g, ' ')}?`;

    const messageHe = param.prompt_he || `מה ה${param.name}?`;

    return {
      message,
      messageHe,
      actions: []
    };
  }

  /**
   * Ask user for a specific parameter with context
   */
  askParameterWithContext(
    param: CapabilityParam,
    capability: Capability,
    resolvedParams: Record<string, unknown>
  ): ChatResponse {
    // Build context-aware prompt
    let context = '';

    // Add entity context if available
    for (const [key, value] of Object.entries(resolvedParams)) {
      if (key.endsWith('_entity') && typeof value === 'object' && value !== null) {
        const entity = value as Record<string, unknown>;
        if (entity.first_name || entity.service_name || entity.title) {
          const name = entity.first_name || entity.service_name || entity.title;
          context = this.isHebrew ? `עבור ${name}: ` : `For ${name}: `;
          break;
        }
      }
    }

    const message = context + (this.isHebrew && param.prompt_he
      ? param.prompt_he
      : param.prompt || `What is the ${param.name.replace(/_/g, ' ')}?`);

    return {
      message,
      messageHe: context + (param.prompt_he || message),
      actions: []
    };
  }

  // ============== CHOICES ==============

  /**
   * Show entity choices for selection
   */
  showChoices(
    choices: EntityChoice[],
    prompt?: string,
    promptHe?: string
  ): ChatResponse {
    const defaultPrompt = 'Please select one:';
    const defaultPromptHe = 'בחר אחת מהאפשרויות:';

    return {
      message: prompt || defaultPrompt,
      messageHe: promptHe || defaultPromptHe,
      actions: [{
        type: 'present_choices',
        prompt: this.isHebrew ? (promptHe || defaultPromptHe) : (prompt || defaultPrompt),
        choices: choices.map((c, i) => ({
          id: c.id,
          label: `${i + 1}. ${c.label}`,
          sublabel: c.sublabel
        }))
      }]
    };
  }

  /**
   * Show entity choices for a specific entity type
   */
  showEntityChoices(
    entityType: string,
    choices: EntityChoice[]
  ): ChatResponse {
    const prompts: Record<string, { en: string; he: string }> = {
      contacts: { en: 'Which contact?', he: 'איזה איש קשר?' },
      tasks: { en: 'Which task?', he: 'איזו משימה?' },
      services: { en: 'Which service?', he: 'איזה שירות?' },
      bookings: { en: 'Which booking?', he: 'איזו פגישה?' },
      invoices: { en: 'Which invoice?', he: 'איזו חשבונית?' }
    };

    const entityPrompt = prompts[entityType] || { en: 'Which one?', he: 'איזה?' };

    return this.showChoices(choices, entityPrompt.en, entityPrompt.he);
  }

  // ============== CONFIRMATION ==============

  /**
   * Show confirmation dialog
   */
  showConfirmation(
    capability: Capability,
    params: Record<string, unknown>
  ): ChatResponse {
    const template = this.isHebrew && capability.confirmationTemplate_he
      ? capability.confirmationTemplate_he
      : capability.confirmationTemplate || `Confirm ${capability.action} ${capability.entity}?`;

    const message = this.interpolate(template, params);

    // Build action buttons
    const confirmLabel = this.isHebrew ? 'אישור' : 'Confirm';
    const cancelLabel = this.isHebrew ? 'ביטול' : 'Cancel';

    return {
      message,
      messageHe: capability.confirmationTemplate_he
        ? this.interpolate(capability.confirmationTemplate_he, params)
        : message,
      actions: [{
        type: 'confirmation',
        destructive: capability.destructive,
        confirmLabel,
        cancelLabel,
        capability: capability.id,
        preview: this.buildConfirmationPreview(capability, params)
      }]
    };
  }

  /**
   * Build confirmation preview details
   */
  private buildConfirmationPreview(
    capability: Capability,
    params: Record<string, unknown>
  ): Record<string, string> {
    const preview: Record<string, string> = {};

    for (const param of capability.params) {
      const value = params[param.name];
      const entityData = params[`${param.name}_entity`] as Record<string, unknown> | undefined;

      if (value !== undefined) {
        const label = this.isHebrew && param.description_he
          ? param.description_he
          : param.description;

        if (entityData) {
          // Use entity display name
          const displayName = entityData.first_name || entityData.service_name ||
                             entityData.title || entityData.invoice_number || value;
          preview[label] = String(displayName);
        } else if (param.type === 'date' && typeof value === 'string') {
          preview[label] = new Date(value).toLocaleDateString(this.isHebrew ? 'he-IL' : 'en-US');
        } else if (param.type === 'money' && typeof value === 'object') {
          const money = value as { amount: number; currency: string };
          preview[label] = `${money.currency === 'ILS' ? '₪' : money.currency}${money.amount}`;
        } else {
          preview[label] = String(value);
        }
      }
    }

    return preview;
  }

  // ============== SUCCESS / ERROR ==============

  /**
   * Show success response
   */
  showSuccess(result: ExecutionResult): ChatResponse {
    const message = result.message || (this.isHebrew ? 'בוצע בהצלחה!' : 'Done!');
    const messageHe = result.message_he || 'בוצע בהצלחה!';

    const actions: ChatAction[] = [];

    // Add success action with result data if available
    if (result.data) {
      actions.push({
        type: 'success',
        data: result.data
      });
    }

    return {
      message,
      messageHe,
      actions
    };
  }

  /**
   * Show error response
   */
  showError(error: string, errorHe?: string): ChatResponse {
    const prefix = this.isHebrew ? 'שגיאה: ' : 'Error: ';
    const prefixHe = 'שגיאה: ';

    return {
      message: prefix + error,
      messageHe: prefixHe + (errorHe || error),
      actions: [{
        type: 'error',
        error
      }]
    };
  }

  /**
   * Show cancelled response
   */
  showCancelled(): ChatResponse {
    return {
      message: 'Cancelled.',
      messageHe: 'בוטל.',
      actions: []
    };
  }

  // ============== ENTITY CARDS ==============

  /**
   * Show entity card
   */
  showEntityCard(
    entityType: string,
    entity: Record<string, unknown>,
    actions?: EntityCardAction[]
  ): ChatResponse {
    const defaultActions = this.getDefaultEntityActions(entityType, entity);

    return {
      message: '',
      actions: [{
        type: 'present_entity_card',
        entityType,
        entityId: entity.id,
        entity,
        actions: actions || defaultActions
      }]
    };
  }

  /**
   * Get default actions for entity type
   */
  private getDefaultEntityActions(
    entityType: string,
    entity: Record<string, unknown>
  ): EntityCardAction[] {
    const actions: EntityCardAction[] = [];

    switch (entityType) {
      case 'contacts':
        actions.push({
          type: 'navigate',
          label: 'Open in CRM',
          labelHe: 'פתח ב-CRM',
          destination: '/business-os/crm',
          params: { contact: entity.id as string }
        });
        if (entity.phone) {
          actions.push({
            type: 'call',
            label: `Call ${entity.phone}`,
            labelHe: `התקשר ${entity.phone}`
          });
        }
        if (entity.email) {
          actions.push({
            type: 'email',
            label: 'Email',
            labelHe: 'שלח אימייל'
          });
        }
        actions.push({
          type: 'edit',
          label: 'Edit',
          labelHe: 'ערוך'
        });
        break;

      case 'tasks':
        if (entity.status !== 'completed') {
          actions.push({
            type: 'complete',
            label: 'Mark Complete',
            labelHe: 'סמן כבוצע'
          });
        }
        actions.push({
          type: 'edit',
          label: 'Edit',
          labelHe: 'ערוך'
        });
        break;

      case 'services':
        actions.push({
          type: 'navigate',
          label: 'Open',
          labelHe: 'פתח',
          destination: '/business-os',
          params: { service: entity.id as string }
        });
        actions.push({
          type: 'edit',
          label: 'Edit',
          labelHe: 'ערוך'
        });
        break;

      case 'bookings':
        actions.push({
          type: 'navigate',
          label: 'View Details',
          labelHe: 'צפה בפרטים',
          destination: '/business-os',
          params: { booking: entity.id as string }
        });
        if (entity.status !== 'cancelled') {
          actions.push({
            type: 'cancel',
            label: 'Cancel',
            labelHe: 'בטל'
          });
        }
        break;

      case 'invoices':
        actions.push({
          type: 'navigate',
          label: 'Open in Reports',
          labelHe: 'פתח בדוחות',
          destination: '/business-os/reports',
          params: { tab: 'invoices', invoice: entity.id as string }
        });
        break;
    }

    return actions;
  }

  // ============== NOT FOUND ==============

  /**
   * Show "not found" response
   */
  showNotFound(entityType: string, searchTerm?: string): ChatResponse {
    const messages: Record<string, { en: string; he: string }> = {
      contacts: {
        en: searchTerm ? `No contacts found matching "${searchTerm}".` : 'Contact not found.',
        he: searchTerm ? `לא נמצאו אנשי קשר תואמים ל-"${searchTerm}".` : 'איש הקשר לא נמצא.'
      },
      tasks: {
        en: searchTerm ? `No tasks found matching "${searchTerm}".` : 'Task not found.',
        he: searchTerm ? `לא נמצאו משימות תואמות ל-"${searchTerm}".` : 'המשימה לא נמצאה.'
      },
      services: {
        en: searchTerm ? `No services found matching "${searchTerm}".` : 'Service not found.',
        he: searchTerm ? `לא נמצאו שירותים תואמים ל-"${searchTerm}".` : 'השירות לא נמצא.'
      },
      bookings: {
        en: searchTerm ? `No bookings found matching "${searchTerm}".` : 'Booking not found.',
        he: searchTerm ? `לא נמצאו פגישות תואמות ל-"${searchTerm}".` : 'הפגישה לא נמצאה.'
      },
      invoices: {
        en: searchTerm ? `No invoices found matching "${searchTerm}".` : 'Invoice not found.',
        he: searchTerm ? `לא נמצאו חשבוניות תואמות ל-"${searchTerm}".` : 'החשבונית לא נמצאה.'
      }
    };

    const msg = messages[entityType] || { en: 'Not found.', he: 'לא נמצא.' };

    return {
      message: msg.en,
      messageHe: msg.he,
      actions: []
    };
  }

  // ============== HELP ==============

  /**
   * Show help response
   */
  showHelp(): ChatResponse {
    const helpEn = `Here's what I can help you with:

**Contacts**
• Create, update, or delete contacts
• "Add contact John Smith"
• "Update email for Sarah"

**Tasks**
• Create tasks and mark them complete
• "Create task: Call client tomorrow"
• "Complete task"

**Scheduling**
• Book appointments and manage services
• "Schedule a meeting with David"
• "Reschedule tomorrow's booking"

**Invoices**
• Create and send invoices
• "Create invoice for $100"
• "Send invoice to John"

**Tips:**
• I understand both English and Hebrew
• You can use /task, /contact, /book as shortcuts`;

    const helpHe = `הנה מה שאני יכול לעזור:

**אנשי קשר**
• יצירה, עדכון ומחיקה של אנשי קשר
• "הוסף איש קשר דוד כהן"
• "עדכן אימייל של שרה"

**משימות**
• יצירת משימות וסימונן כהושלמו
• "צור משימה: להתקשר ללקוח מחר"
• "סיים משימה"

**תזמון**
• קביעת פגישות וניהול שירותים
• "קבע פגישה עם דוד"
• "הזז את הפגישה של מחר"

**חשבוניות**
• יצירה ושליחת חשבוניות
• "צור חשבונית על 100 שקל"
• "שלח חשבונית לדוד"

**טיפים:**
• אני מבין עברית ואנגלית
• אפשר להשתמש ב-/task, /contact, /book כקיצורים`;

    return {
      message: helpEn,
      messageHe: helpHe,
      actions: []
    };
  }

  // ============== UTILITIES ==============

  /**
   * Simple template interpolation
   */
  private interpolate(
    template: string,
    params: Record<string, unknown>
  ): string {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const parts = path.split('.');
      let value: unknown = params;

      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return match;
        }
      }

      // Format dates
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return new Date(value).toLocaleDateString(this.isHebrew ? 'he-IL' : 'en-US');
      }

      return String(value ?? match);
    });
  }
}
