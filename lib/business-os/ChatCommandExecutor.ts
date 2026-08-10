/**
 * ChatCommandExecutor - Deterministic action executor for chat commands
 * Executes actions directly via repositories (server-side only)
 */

import {
  ParsedIntent,
  CommandResult,
  PreviewContext,
  PendingContext,
} from './DraftManagerTypes';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { schedulingServiceRepository, schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import type { CRMTaskListOptions } from '@/lib/repositories/CRMTaskRepository';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';

const logger = createLogger({ module: 'ChatCommandExecutor' });

// R8: single plugin-name literal for the internal CRM plugin path. Centralized so future
// callers don't scatter the string; replace with the capability resolver when CRM goes
// platform-wide. TODO(R7): route via capability resolver instead of a hardcoded key.
const CRM_PLUGIN_KEY = 'crm';
// R8/P4: internal Scheduling plugin key. TODO(R7): route via capability resolver.
const SCHEDULING_PLUGIN_KEY = 'scheduling';
// Payments P4: internal Payments plugin key. TODO(R7): route via capability resolver.
const PAYMENTS_PLUGIN_KEY = 'payments';

// Multilingual response templates
const RESPONSES: Record<string, Record<string, string>> = {
  // Service create
  'service.create.response': {
    en: `Let's add <b>{name}</b>{details}. Opening the form...`,
    he: `בואו נוסיף <b>{name}</b>{details}. פותח את הטופס...`,
  },
  'service.create.details': {
    en: ` ({duration} min · {price})`,
    he: ` ({duration} דק׳ · {price})`,
  },
  // Service update
  'service.update.response': {
    en: `Opening <b>{name}</b> for editing...`,
    he: `פותח את <b>{name}</b> לעריכה...`,
  },
  'service.update.direct': {
    en: `Updated <b>{name}</b>: {changes}`,
    he: `עודכן <b>{name}</b>: {changes}`,
  },
  'service.update.price': {
    en: `price → {price}`,
    he: `מחיר → {price}`,
  },
  'service.update.duration': {
    en: `duration → {duration} min`,
    he: `משך → {duration} דק׳`,
  },
  'service.update.selectService': {
    en: `Which service would you like to edit? Tap one below:`,
    he: `איזה שירות תרצה לערוך? לחץ על אחד למטה:`,
  },
  'service.update.noServices': {
    en: `You don't have any services yet. Would you like to add one?`,
    he: `אין לך שירותים עדיין. תרצה להוסיף?`,
  },
  'service.update.notFound': {
    en: `I couldn't find a service matching "{name}". Try being more specific or check your services list.`,
    he: `לא מצאתי שירות בשם "{name}". נסה להיות יותר ספציפי או בדוק את רשימת השירותים.`,
  },
  'service.update.askPrice': {
    en: `What should be the new price for <b>{name}</b>?`,
    he: `מה יהיה המחיר החדש עבור <b>{name}</b>?`,
  },
  'service.update.askDuration': {
    en: `What should be the new duration for <b>{name}</b>? (in minutes)`,
    he: `מה יהיה משך הזמן החדש עבור <b>{name}</b>? (בדקות)`,
  },
  // Service delete
  'service.delete.response': {
    en: `Opening <b>{name}</b>. You can delete it from the service form.`,
    he: `פותח את <b>{name}</b>. תוכל למחוק אותו מטופס השירות.`,
  },
  'service.delete.notFound': {
    en: `I couldn't find a service matching "{name}".`,
    he: `לא מצאתי שירות בשם "{name}".`,
  },
  // Availability
  'availability.response': {
    en: `Let's update your availability for <b>{days}</b>. Opening settings...`,
    he: `בואו נעדכן את הזמינות שלך ל<b>{days}</b>. פותח הגדרות...`,
    es: `Vamos a actualizar tu disponibilidad para <b>{days}</b>. Abriendo configuración...`,
  },
  'availability.updated': {
    en: `Done! <b>{days}</b> is now set to <b>{time}</b>.`,
    he: `בוצע! <b>{days}</b> מוגדר עכשיו ל-<b>{time}</b>.`,
    es: `¡Listo! <b>{days}</b> ahora está configurado para <b>{time}</b>.`,
  },
  'availability.days.default': {
    en: 'your schedule',
    he: 'לוח הזמנים שלך',
    es: 'tu horario',
  },
  'availability.askTime': {
    en: `What hours would you like to be available on <b>{days}</b>?`,
    he: `באילו שעות תרצה להיות זמין ב<b>{days}</b>?`,
    es: `¿A qué horas te gustaría estar disponible el <b>{days}</b>?`,
  },
  'availability.query.result': {
    en: `Here's your current availability:`,
    he: `הנה הזמינות הנוכחית שלך:`,
  },
  'availability.query.noData': {
    en: `You haven't set up your availability yet. Would you like to configure it?`,
    he: `עדיין לא הגדרת את הזמינות שלך. רוצה להגדיר?`,
  },
  'availability.query.dayOpen': {
    en: '{day}: {start} - {end}',
    he: '{day}: {start} - {end}',
  },
  'availability.query.dayClosed': {
    en: '{day}: Closed',
    he: '{day}: סגור',
  },
  // Contact add
  'contact.add.response': {
    en: `Let's add <b>{name}</b>. Opening the form...`,
    he: `בואו נוסיף את <b>{name}</b>. פותח את הטופס...`,
  },
  'contact.add.default': {
    en: 'new contact',
    he: 'איש קשר חדש',
  },
  // Contact update
  'contact.update.response': {
    en: `Opening <b>{name}</b> for editing...`,
    he: `פותח את <b>{name}</b> לעריכה...`,
  },
  'contact.update.notFound': {
    en: `I couldn't find a contact matching "{name}".`,
    he: `לא מצאתי איש קשר בשם "{name}".`,
  },
  // Contact query
  'contact.query.response': {
    en: 'Opening your contacts...',
    he: 'פותח את אנשי הקשר שלך...',
  },
  'contact.query.found': {
    en: 'Found <b>{count}</b> {label}:',
    he: 'נמצאו <b>{count}</b> {label}:',
  },
  'contact.query.none': {
    en: 'No contacts found matching your criteria.',
    he: 'לא נמצאו אנשי קשר התואמים את החיפוש.',
  },
  'contact.query.noneWithName': {
    en: 'No contact found with the name "{name}".',
    he: 'לא נמצא איש קשר בשם "{name}".',
  },
  'contact.query.contacts': {
    en: 'contacts',
    he: 'אנשי קשר',
  },
  'contact.query.withOverdueTasks': {
    en: 'contacts with overdue tasks',
    he: 'אנשי קשר עם משימות באיחור',
  },
  // Contact view (open specific contact page)
  'contact.view.opening': {
    en: `Opening <b>{name}</b>'s profile...`,
    he: `פותח את הפרופיל של <b>{name}</b>...`,
  },
  'contact.view.notFound': {
    en: `I couldn't find a contact named "{name}".`,
    he: `לא מצאתי איש קשר בשם "{name}".`,
  },
  'contact.view.which': {
    en: 'Which contact would you like to view?',
    he: 'את מי להציג?',
  },
  'contact.view.needsName': {
    en: 'Which contact would you like to open?',
    he: 'את מי לפתוח?',
  },
  // Task query
  'task.query.found': {
    en: 'Found <b>{count}</b> tasks:',
    he: 'נמצאו <b>{count}</b> משימות:',
  },
  'task.query.overdue': {
    en: 'You have <b>{count}</b> overdue tasks:',
    he: 'יש לך <b>{count}</b> משימות באיחור:',
  },
  'task.query.upcoming': {
    en: 'You have <b>{count}</b> tasks coming up:',
    he: 'יש לך <b>{count}</b> משימות קרובות:',
  },
  'task.query.none': {
    en: 'No tasks found.',
    he: 'לא נמצאו משימות.',
  },
  'task.query.noOverdue': {
    en: 'Great! You have no overdue tasks.',
    he: 'מצוין! אין לך משימות באיחור.',
  },
  // Invoice create
  'invoice.created': {
    en: 'Created draft invoice for <b>{amount}</b> to <b>{contact}</b>. Ready to send when you are.',
    he: 'נוצרה טיוטת חשבונית על <b>{amount}</b> עבור <b>{contact}</b>. מוכנה לשליחה.',
  },
  'invoice.contactNotFound': {
    en: `I couldn't find a contact named "{name}". Would you like to add them first?`,
    he: `לא מצאתי איש קשר בשם "{name}". רוצה להוסיף אותו קודם?`,
  },
  // Invoice query
  'invoice.query.found': {
    en: 'Found <b>{count}</b> invoices:',
    he: 'נמצאו <b>{count}</b> חשבוניות:',
  },
  'invoice.query.overdue': {
    en: '<b>{count}</b> clients owe you money:',
    he: '<b>{count}</b> לקוחות חייבים לך כסף:',
  },
  'invoice.query.none': {
    en: 'No invoices found matching your criteria.',
    he: 'לא נמצאו חשבוניות התואמות את החיפוש.',
  },
  'invoice.query.noOverdue': {
    en: 'Great! No one owes you money right now.',
    he: 'מצוין! אף אחד לא חייב לך כסף כרגע.',
  },
  // Payment record
  'payment.recorded': {
    en: 'Recorded <b>{amount}</b> payment from <b>{contact}</b>.',
    he: 'נרשם תשלום של <b>{amount}</b> מאת <b>{contact}</b>.',
  },
  // Booking
  'booking.create.response': {
    en: `Let's schedule a meeting. Opening the calendar...`,
    he: `בואו נקבע פגישה. פותח את היומן...`,
  },
  'booking.create.direct': {
    en: `Booking created for <b>{client}</b> on <b>{date}</b> at <b>{time}</b>.`,
    he: `נקבעה פגישה עם <b>{client}</b> בתאריך <b>{date}</b> בשעה <b>{time}</b>.`,
  },
  'booking.create.conflict': {
    en: `That time slot is already booked. Please choose another time.`,
    he: `השעה הזו כבר תפוסה. אנא בחר שעה אחרת.`,
  },
  'booking.create.contactNotFound': {
    en: `I couldn't find a contact named "{name}". Would you like to add them first?`,
    he: `לא מצאתי איש קשר בשם "{name}". רוצה להוסיף אותו קודם?`,
  },
  'booking.query.response': {
    en: `Here's your schedule:`,
    he: `הנה לוח הזמנים שלך:`,
  },
  'booking.query.today': {
    en: `You have <b>{count}</b> bookings today:`,
    he: `יש לך <b>{count}</b> פגישות היום:`,
  },
  'booking.query.upcoming': {
    en: `You have <b>{count}</b> upcoming bookings:`,
    he: `יש לך <b>{count}</b> פגישות קרובות:`,
  },
  'booking.query.none': {
    en: `No bookings found.`,
    he: `לא נמצאו פגישות.`,
  },
  'booking.query.noneToday': {
    en: `You have no bookings today.`,
    he: `אין לך פגישות היום.`,
  },
  'booking.query.openingCalendar': {
    en: `Opening your calendar...`,
    he: `פותח את היומן...`,
  },
  'booking.cancel.response': {
    en: 'To cancel a booking, please go to the calendar and select the specific appointment.',
    he: 'כדי לבטל הזמנה, עבור ליומן ובחר את התור הספציפי.',
  },
  'booking.cancel.confirm': {
    en: `Cancel the booking with <b>{client}</b> on <b>{date}</b>?`,
    he: `לבטל את הפגישה עם <b>{client}</b> בתאריך <b>{date}</b>?`,
  },
  'booking.cancelled': {
    en: `Booking with <b>{client}</b> has been cancelled.`,
    he: `הפגישה עם <b>{client}</b> בוטלה.`,
  },
  // Task
  'task.create.response': {
    en: `I'll remind you to {description}. Opening tasks...`,
    he: `אזכיר לך {description}. פותח משימות...`,
  },
  'task.create.default': {
    en: 'follow up',
    he: 'לעקוב',
  },
  // Invoice
  'invoice.create.response': {
    en: `To create an invoice for <b>{contact}</b> ({amount}), please use the payments page. <a href="/business-os/payments" style="color: #F97316; text-decoration: underline;">Open payments →</a>`,
    he: `כדי ליצור חשבונית עבור <b>{contact}</b> ({amount}), השתמש בדף התשלומים. <a href="/business-os/payments" style="color: #F97316; text-decoration: underline;">פתח תשלומים ←</a>`,
  },
  'invoice.create.contact.default': {
    en: 'client',
    he: 'לקוח',
  },
  // Reports
  'report.query.response': {
    en: `Here's your {metric} for {period}...`,
    he: `הנה ה{metric} שלך ל{period}...`,
  },
  'report.compare.response': {
    en: 'Opening comparison view...',
    he: 'פותח תצוגת השוואה...',
  },
  // Navigation
  'navigate.response': {
    en: `Opening {destination}...`,
    he: `פותח {destination}...`,
  },
  'navigate.default': {
    en: 'dashboard',
    he: 'לוח בקרה',
  },
  // Preview
  'preview.response': {
    en: `Showing {context} preview...`,
    he: `מציג תצוגה מקדימה של {context}...`,
  },
  // Errors
  'error.lowConfidence': {
    en: `I'm not sure what you mean. Try something like "add a service" or "set my hours".`,
    he: `לא בטוח שהבנתי. נסה משהו כמו "הוסף שירות" או "קבע שעות".`,
  },
  'error.unknown': {
    en: `I couldn't understand that command. Try something like "add a service for $100" or "show my contacts".`,
    he: `לא הצלחתי להבין את הפקודה. נסה משהו כמו "הוסף שירות ב100 שקל" או "הצג אנשי קשר".`,
  },
  'error.general': {
    en: 'Something went wrong while processing your request. Please try again.',
    he: 'משהו השתבש בעיבוד הבקשה. אנא נסה שוב.',
  },
  // Confirmation
  'confirm.service.delete': {
    en: `Are you sure you want to remove <b>{name}</b>? This action will take effect when you publish.`,
    he: `האם אתה בטוח שברצונך להסיר את <b>{name}</b>? פעולה זו תיכנס לתוקף כשתפרסם.`,
  },
  'confirm.booking.cancel': {
    en: `Cancel the booking with <b>{name}</b>?`,
    he: `לבטל את ההזמנה עם <b>{name}</b>?`,
  },
  'confirm.default': {
    en: 'Are you sure you want to proceed with this action?',
    he: 'האם אתה בטוח שברצונך להמשיך בפעולה זו?',
  },
  // Suggestions
  'suggestion.addService': {
    en: 'Add another service',
    he: 'הוסף שירות נוסף',
  },
  'suggestion.setHours': {
    en: 'Set my hours',
    he: 'קבע שעות',
  },
  'suggestion.viewServices': {
    en: 'View services',
    he: 'הצג שירותים',
  },
  'suggestion.showServices': {
    en: 'Show my services',
    he: 'הצג שירותים שלי',
  },
  'suggestion.addContact': {
    en: 'Add another contact',
    he: 'הוסף איש קשר נוסף',
  },
  'suggestion.viewContacts': {
    en: 'View contacts',
    he: 'הצג אנשי קשר',
  },
  'suggestion.showContacts': {
    en: 'Show my contacts',
    he: 'הצג אנשי קשר שלי',
  },
  'suggestion.changeService': {
    en: 'Change another service',
    he: 'שנה שירות אחר',
  },
  'suggestion.updateContact': {
    en: 'Update another contact',
    he: 'עדכן איש קשר אחר',
  },
  'suggestion.addNewContact': {
    en: 'Add a contact',
    he: 'הוסף איש קשר',
  },
  'suggestion.viewPipeline': {
    en: 'View pipeline',
    he: 'הצג פייפליין',
  },
  'suggestion.openCalendar': {
    en: 'Open calendar',
    he: 'פתח יומן',
  },
  'suggestion.viewBookings': {
    en: 'View bookings',
    he: 'הצג הזמנות',
  },
  'suggestion.scheduleToday': {
    en: 'Schedule for today',
    he: 'קבע להיום',
  },
  'suggestion.scheduleTomorrow': {
    en: 'Schedule for tomorrow',
    he: 'קבע למחר',
  },
  'suggestion.whatsToday': {
    en: "What's on my schedule today?",
    he: 'מה יש לי היום?',
  },
  'suggestion.nextWeek': {
    en: 'Show next week',
    he: 'הצג שבוע הבא',
  },
  'suggestion.viewTasks': {
    en: 'View all tasks',
    he: 'הצג כל המשימות',
  },
  'suggestion.addReminder': {
    en: 'Add another reminder',
    he: 'הוסף תזכורת נוספת',
  },
  'suggestion.openPayments': {
    en: 'Open payments',
    he: 'פתח תשלומים',
  },
  'suggestion.viewInvoices': {
    en: 'View invoices',
    he: 'הצג חשבוניות',
  },
  'suggestion.sendInvoice': {
    en: 'Send invoice',
    he: 'שלח חשבונית',
  },
  'suggestion.viewOverdue': {
    en: 'View overdue',
    he: 'הצג באיחור',
  },
  'suggestion.showAllTasks': {
    en: 'Show all tasks',
    he: 'הצג כל המשימות',
  },
  'suggestion.markComplete': {
    en: 'Mark complete',
    he: 'סמן כבוצע',
  },
  'suggestion.createInvoice': {
    en: 'Create invoice',
    he: 'צור חשבונית',
  },
  'suggestion.recordPayment': {
    en: 'Record payment',
    he: 'רשום תשלום',
  },
  'suggestion.addTask': {
    en: 'Add task',
    he: 'הוסף משימה',
  },
  'suggestion.addActivity': {
    en: 'Add note',
    he: 'הוסף הערה',
  },
  'suggestion.scheduleBooking': {
    en: 'Schedule booking',
    he: 'קבע פגישה',
  },
  'suggestion.yesDoIt': {
    en: 'Yes, do it',
    he: 'כן, בצע',
  },
  'suggestion.noCancel': {
    en: 'No, cancel',
    he: 'לא, בטל',
  },
  // Time suggestions for availability
  'suggestion.time.9to5': {
    en: '9am to 5pm',
    he: '9 בבוקר עד 5 אחה״צ',
  },
  'suggestion.time.9to6': {
    en: '9am to 6pm',
    he: '9 בבוקר עד 6 בערב',
  },
  'suggestion.time.10to7': {
    en: '10am to 7pm',
    he: '10 בבוקר עד 7 בערב',
  },
  'suggestion.time.custom': {
    en: 'Other hours',
    he: 'שעות אחרות',
  },
  // Report suggestions
  'suggestion.compareWeek': {
    en: 'Compare to last week',
    he: 'השווה לשבוע שעבר',
  },
  'suggestion.showRevenue': {
    en: 'Show revenue',
    he: 'הצג הכנסות',
  },
  'suggestion.showBookings': {
    en: 'Show bookings',
    he: 'הצג הזמנות',
  },
  'suggestion.monthVsLast': {
    en: 'This month vs last',
    he: 'החודש מול הקודם',
  },
  'suggestion.yearOverYear': {
    en: 'Year over year',
    he: 'שנה מול שנה',
  },
  // Free
  'free': {
    en: 'Free',
    he: 'חינם',
  },
  // Conversational flow - missing fields
  'service.create.needsInfo': {
    en: `I need a few more details:\n{missing}`,
    he: `צריך עוד כמה פרטים:\n{missing}`,
  },
  'service.create.needsName': {
    en: '• What should we call this service?',
    he: '• איך לקרוא לשירות?',
  },
  'service.create.needsPrice': {
    en: "• What's the price? (or say 'free')",
    he: "• מה המחיר? (או תגיד 'חינם')",
  },
  // Conversational flow - confirmation
  'service.create.confirm': {
    en: `Create this service?\n\n{preview}\n\nReply <b>yes</b> to create or <b>no</b> to cancel.`,
    he: `ליצור את השירות?\n\n{preview}\n\nענה <b>כן</b> ליצירה או <b>לא</b> לביטול.`,
  },
  'service.created.success': {
    en: `Created <b>{name}</b>! ({duration} min · {price})`,
    he: `נוצר <b>{name}</b>! ({duration} דק׳ · {price})`,
  },
  // Contact add - conversational flow
  'contact.add.needsInfo': {
    en: `I need a few more details:\n{missing}`,
    he: `צריך עוד כמה פרטים:\n{missing}`,
  },
  'contact.add.needsName': {
    en: "• What's their name?",
    he: '• מה השם?',
  },
  'contact.add.needsEmail': {
    en: "• What's their email?",
    he: '• מה האימייל?',
  },
  'contact.add.confirm': {
    en: `Add this contact?\n\n{preview}\n\nReply <b>yes</b> to add or <b>no</b> to cancel.`,
    he: `להוסיף את איש הקשר?\n\n{preview}\n\nענה <b>כן</b> להוספה או <b>לא</b> לביטול.`,
  },
  'contact.added.success': {
    en: `Added <b>{name}</b> to your contacts!`,
    he: `<b>{name}</b> נוסף לאנשי הקשר שלך!`,
  },
  // Booking - conversational flow
  'booking.create.needsInfo': {
    en: `I need a few more details:\n{missing}`,
    he: `צריך עוד כמה פרטים:\n{missing}`,
  },
  'booking.create.needsContact': {
    en: "• Who's the client?",
    he: '• מי הלקוח?',
  },
  'booking.create.needsService': {
    en: "• Which service?",
    he: '• איזה שירות?',
  },
  'booking.create.needsDate': {
    en: "• What date?",
    he: '• באיזה תאריך?',
  },
  'booking.create.needsTime': {
    en: "• What time?",
    he: '• באיזו שעה?',
  },
  'booking.create.availableSlots': {
    en: 'Here are the available times for <b>{date}</b>:',
    he: 'הנה השעות הפנויות ל<b>{date}</b>:',
  },
  'booking.create.noAvailableSlots': {
    en: 'No available times found for <b>{date}</b>. Try another day.',
    he: 'לא נמצאו שעות פנויות ל<b>{date}</b>. נסה יום אחר.',
  },
  'booking.create.confirm': {
    en: `Book this appointment?\n\n{preview}\n\nReply <b>yes</b> to book or <b>no</b> to cancel.`,
    he: `לקבוע את הפגישה?\n\n{preview}\n\nענה <b>כן</b> לאישור או <b>לא</b> לביטול.`,
  },
  'booking.created.success': {
    en: `Booked! <b>{client}</b> - <b>{service}</b> on {date} at {time}.`,
    he: `נקבע! <b>{client}</b> - <b>{service}</b> ב{date} בשעה {time}.`,
  },
  // Generic
  'confirm.yes': {
    en: 'Yes',
    he: 'כן',
  },
  'confirm.no': {
    en: 'No',
    he: 'לא',
  },
  // Task - conversational flow
  'task.create.needsInfo': {
    en: `I need a few more details:\n{missing}`,
    he: `צריך עוד כמה פרטים:\n{missing}`,
  },
  'task.create.needsDescription': {
    en: "• What's the task?",
    he: '• מה המשימה?',
  },
  'task.create.needsContact': {
    en: "• For which contact? (optional)",
    he: '• עבור איזה לקוח? (אופציונלי)',
  },
  'task.create.confirm': {
    en: `Create this task?\n\n{preview}\n\nReply <b>yes</b> to create or <b>no</b> to cancel.`,
    he: `ליצור את המשימה?\n\n{preview}\n\nענה <b>כן</b> ליצירה או <b>לא</b> לביטול.`,
  },
  'task.created.success': {
    en: `Task created! <b>{description}</b>{contact}{due}`,
    he: `המשימה נוצרה! <b>{description}</b>{contact}{due}`,
  },
  // Invoice - conversational flow
  'invoice.create.needsInfo': {
    en: `I need a few more details:\n{missing}`,
    he: `צריך עוד כמה פרטים:\n{missing}`,
  },
  'invoice.create.needsContact': {
    en: "• Which client?",
    he: '• איזה לקוח?',
  },
  'invoice.create.needsAmount': {
    en: "• How much?",
    he: '• כמה?',
  },
  'invoice.create.confirm': {
    en: `Create this invoice?\n\n{preview}\n\nReply <b>yes</b> to create or <b>no</b> to cancel.`,
    he: `ליצור את החשבונית?\n\n{preview}\n\nענה <b>כן</b> ליצירה או <b>לא</b> לביטול.`,
  },
  'invoice.created.success': {
    en: `Invoice created! <b>{amount}</b> to <b>{contact}</b>.`,
    he: `החשבונית נוצרה! <b>{amount}</b> ל<b>{contact}</b>.`,
  },
  // Delete confirmations
  'service.delete.confirm': {
    en: 'Are you sure you want to delete <b>{name}</b>? This cannot be undone.',
    he: 'האם אתה בטוח שברצונך למחוק את <b>{name}</b>? לא ניתן לשחזר.',
  },
  'service.deleted.success': {
    en: '<b>{name}</b> has been deleted.',
    he: '<b>{name}</b> נמחק.',
  },
  'booking.cancel.confirmChat': {
    en: 'Cancel the booking with <b>{client}</b> on <b>{date}</b> at <b>{time}</b>?',
    he: 'לבטל את הפגישה עם <b>{client}</b> ב{date} בשעה {time}?',
  },
  'booking.cancelled.success': {
    en: 'Booking with <b>{client}</b> has been cancelled.',
    he: 'הפגישה עם <b>{client}</b> בוטלה.',
  },
  // Service update - conversational flow
  'service.update.confirm': {
    en: `Update this service?\n\n{preview}\n\nReply <b>yes</b> to update or <b>no</b> to cancel.`,
    he: `לעדכן את השירות?\n\n{preview}\n\nענה <b>כן</b> לעדכון או <b>לא</b> לביטול.`,
  },
  'service.updated.success': {
    en: '<b>{name}</b> has been updated!',
    he: '<b>{name}</b> עודכן!',
  },
  // Contact update - conversational flow
  'contact.update.confirm': {
    en: `Update this contact?\n\n{preview}\n\nReply <b>yes</b> to update or <b>no</b> to cancel.`,
    he: `לעדכן את איש הקשר?\n\n{preview}\n\nענה <b>כן</b> לעדכון או <b>לא</b> לביטול.`,
  },
  'contact.updated.success': {
    en: '<b>{name}</b> has been updated!',
    he: '<b>{name}</b> עודכן!',
  },
  'contact.update.selectContact': {
    en: 'Which contact would you like to update?',
    he: 'את מי לעדכן?',
  },
  // Preview labels
  'label.service': { en: 'Service', he: 'שירות' },
  'label.price': { en: 'Price', he: 'מחיר' },
  'label.newPrice': { en: 'New price', he: 'מחיר חדש' },
  'label.duration': { en: 'Duration', he: 'משך' },
  'label.newDuration': { en: 'New duration', he: 'משך חדש' },
  'label.name': { en: 'Name', he: 'שם' },
  'label.newName': { en: 'New name', he: 'שם חדש' },
  'label.email': { en: 'Email', he: 'אימייל' },
  'label.newEmail': { en: 'New email', he: 'אימייל חדש' },
  'label.phone': { en: 'Phone', he: 'טלפון' },
  'label.newPhone': { en: 'New phone', he: 'טלפון חדש' },
  'label.contact': { en: 'Contact', he: 'איש קשר' },
  'label.client': { en: 'Client', he: 'לקוח' },
  'label.date': { en: 'Date', he: 'תאריך' },
  'label.time': { en: 'Time', he: 'שעה' },
  'label.amount': { en: 'Amount', he: 'סכום' },
  'label.description': { en: 'Description', he: 'תיאור' },
  'label.task': { en: 'Task', he: 'משימה' },
  'label.relatedTo': { en: 'Related to', he: 'קשור ל' },
  'label.due': { en: 'Due', he: 'עד' },
  'label.stage': { en: 'Stage', he: 'שלב' },
  'label.newStage': { en: 'New stage', he: 'שלב חדש' },
  'label.minutes': { en: 'min', he: 'דק׳' },
  'label.for': { en: 'for', he: 'עבור' },
  // Dynamic suggestions (with placeholders)
  'suggestion.followUpWith': { en: 'Follow up with {name}', he: 'תזכיר ל{name}' },
  'suggestion.invoiceFor': { en: 'Invoice {name}', he: 'צור חשבונית ל{name}' },
  'suggestion.showOverdueTasks': { en: 'Show overdue tasks', he: 'הצג משימות באיחור' },
  'suggestion.addTaskFor': { en: 'Add task for {name}', he: 'הוסף משימה ל{name}' },
  'suggestion.createInvoiceFor': { en: 'Create invoice for {name}', he: 'צור חשבונית ל{name}' },
  'suggestion.addAContact': { en: 'Add a contact', he: 'הוסף איש קשר' },
  'suggestion.addATask': { en: 'Add a task', he: 'הוסף משימה' },
  'suggestion.complete': { en: 'Complete: {title}', he: 'סיים: {title}' },
  'suggestion.remind': { en: 'Remind {name}', he: 'שלח תזכורת ל{name}' },
  'suggestion.recordPaymentFrom': { en: 'Record payment from {name}', he: 'רשום תשלום מ{name}' },
  'suggestion.viewAllInvoices': { en: 'View all invoices', he: 'הצג כל החשבוניות' },
  'suggestion.whoOwesMe': { en: 'Who owes me?', he: 'מי חייב לי?' },
  'suggestion.cancelBookingWith': { en: "Cancel {name}'s booking", he: 'בטל פגישה עם {name}' },
  'suggestion.scheduleNew': { en: 'Schedule new booking', he: 'קבע פגישה חדשה' },
  'suggestion.callClient': { en: 'Call client', he: 'התקשר ללקוח' },
  'suggestion.sendQuote': { en: 'Send quote', he: 'שלח הצעת מחיר' },
  'suggestion.reminderTomorrow': { en: 'Reminder for tomorrow', he: 'תזכורת למחר' },
  // Error messages
  'error.serviceCreate': { en: 'Something went wrong creating the service. Please try again.', he: 'משהו השתבש ביצירת השירות. נסה שוב.' },
  'error.contactAdd': { en: 'Something went wrong adding the contact. Please try again.', he: 'משהו השתבש בהוספת איש הקשר. נסה שוב.' },
  'error.tryAgain': { en: 'Something went wrong. Please try again.', he: 'משהו השתבש. נסה שוב.' },
  // Service update
  'service.update.whichService': { en: 'Which service?', he: 'איזה שירות?' },
  // Contact query
  'contact.query.noContacts': { en: "You don't have any contacts yet.", he: 'אין לך אנשי קשר עדיין.' },
  'contact.update.which': { en: 'Which one?', he: 'מי?' },
  // Booking
  'booking.cancel.which': { en: 'Which booking would you like to cancel?', he: 'איזו פגישה לבטל?' },
  'booking.client.default': { en: 'Client', he: 'לקוח' },
  // Disambiguation
  'booking.create.multipleContacts': { en: "I found multiple contacts matching '{name}'. Which one?", he: "מצאתי מספר אנשי קשר בשם '{name}'. למי תרצה לקבוע?" },
  'booking.create.multipleServices': { en: "I found multiple matching services. Which one?", he: "מצאתי מספר שירותים תואמים. איזה שירות?" },
  // Fallback text
  'fallback.thisService': { en: 'this service', he: 'שירות זה' },
  'fallback.thisClient': { en: 'this client', he: 'לקוח זה' },
  // Context-based suggestions (for error fallback based on preview context)
  'context.services.addService': { en: 'Add a service', he: 'הוסף שירות' },
  'context.services.changePrice': { en: 'Change a price', he: 'שנה מחיר' },
  'context.services.setHours': { en: 'Set my hours', he: 'קבע שעות' },
  'context.crm.addContact': { en: 'Add a contact', he: 'הוסף איש קשר' },
  'context.crm.viewPipeline': { en: 'View pipeline', he: 'הצג פייפליין' },
  'context.crm.followUp': { en: 'Follow up', he: 'מעקב' },
  'context.payments.sendInvoice': { en: 'Send invoice', he: 'שלח חשבונית' },
  'context.payments.checkPending': { en: 'Check pending', he: 'בדוק ממתינים' },
  'context.reports.thisWeekRevenue': { en: 'This week revenue', he: 'הכנסות השבוע' },
  'context.reports.compareMonths': { en: 'Compare months', he: 'השווה חודשים' },
  'context.drafts.reviewChanges': { en: 'Review changes', he: 'סקור שינויים' },
  'context.drafts.discardAll': { en: 'Discard all', he: 'בטל הכל' },
};

/**
 * Required fields for conversational flow per intent
 * Only these fields must be collected before confirmation
 */
const REQUIRED_FIELDS: Record<string, string[]> = {
  'service.create': ['service_name', 'price'],
  'contact.add': ['first_name', 'email'],
  'booking.create': ['contact_name', 'service_name', 'date', 'time'],
  'invoice.create': ['contact_name', 'amount'],
  'task.create': ['description'],
};

/**
 * Get a translated string with variable interpolation
 */
function t(key: string, lang: string, vars?: Record<string, string>): string {
  const template = RESPONSES[key]?.[lang] || RESPONSES[key]?.['en'] || key;
  if (!vars) return template;

  return Object.entries(vars).reduce(
    (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, 'g'), v),
    template
  );
}

/**
 * Get translated suggestions
 */
function getSuggestionsLocalized(keys: string[], lang: string): string[] {
  return keys.map(key => t(key, lang));
}

/**
 * Get localized suggestions based on preview context
 * Replaces the hardcoded getSuggestions from IntentParser
 */
function getSuggestionsByContext(previewContext: string, hasDrafts: boolean, lang: string): string[] {
  const baseSuggestions = hasDrafts
    ? [t('context.drafts.reviewChanges', lang), t('context.drafts.discardAll', lang)]
    : [];

  switch (previewContext) {
    case 'services':
      return [
        ...baseSuggestions,
        t('context.services.addService', lang),
        t('context.services.changePrice', lang),
        t('context.services.setHours', lang),
      ];
    case 'crm':
      return [
        ...baseSuggestions,
        t('context.crm.addContact', lang),
        t('context.crm.viewPipeline', lang),
        t('context.crm.followUp', lang),
      ];
    case 'payments':
      return [
        ...baseSuggestions,
        t('context.payments.sendInvoice', lang),
        t('context.payments.checkPending', lang),
      ];
    case 'reports':
      return [
        ...baseSuggestions,
        t('context.reports.thisWeekRevenue', lang),
        t('context.reports.compareMonths', lang),
      ];
    default:
      return baseSuggestions;
  }
}

/**
 * Generate contextual suggestions based on query results
 * These are dynamic suggestions that reference actual entity names
 */
function getContextualSuggestions(
  context: 'contact_query' | 'contact_query_overdue' | 'task_query' | 'task_query_overdue' | 'invoice_query' | 'invoice_query_overdue',
  entities: Array<{ first_name?: string; last_name?: string; name?: string; title?: string; amount?: number; currency?: string }>,
  lang: string
): string[] {
  const suggestions: string[] = [];

  // Get first entity name for personalized suggestions
  const firstName = entities[0]?.first_name || entities[0]?.name?.split(' ')[0];

  switch (context) {
    case 'contact_query_overdue':
      // Contacts with overdue tasks - suggest follow-up actions
      if (firstName) {
        suggestions.push(t('suggestion.followUpWith', lang, { name: firstName }));
        suggestions.push(t('suggestion.invoiceFor', lang, { name: firstName }));
      }
      suggestions.push(t('suggestion.showOverdueTasks', lang));
      break;

    case 'contact_query':
      // General contact query - suggest common CRM actions
      if (firstName) {
        suggestions.push(t('suggestion.addTaskFor', lang, { name: firstName }));
        suggestions.push(t('suggestion.createInvoiceFor', lang, { name: firstName }));
      }
      suggestions.push(t('suggestion.addAContact', lang));
      break;

    case 'task_query_overdue':
      // Overdue tasks - suggest completion or follow-up
      if (entities[0]?.title) {
        const shortTitle = entities[0].title.substring(0, 20);
        suggestions.push(t('suggestion.complete', lang, { title: shortTitle }));
      }
      suggestions.push(t('suggestion.showAllTasks', lang));
      suggestions.push(t('suggestion.addATask', lang));
      break;

    case 'task_query':
      // General tasks - suggest task management
      suggestions.push(t('suggestion.addATask', lang));
      suggestions.push(t('suggestion.showOverdueTasks', lang));
      break;

    case 'invoice_query_overdue':
      // Overdue invoices - suggest payment collection
      if (firstName) {
        suggestions.push(t('suggestion.remind', lang, { name: firstName }));
        suggestions.push(t('suggestion.recordPaymentFrom', lang, { name: firstName }));
      }
      suggestions.push(t('suggestion.viewAllInvoices', lang));
      break;

    case 'invoice_query':
      // General invoice query
      suggestions.push(t('suggestion.createInvoice', lang));
      suggestions.push(t('suggestion.whoOwesMe', lang));
      break;
  }

  return suggestions.slice(0, 4); // Max 4 suggestions
}

export interface ServiceInfo {
  id: string;
  name: string;
  price?: number;
  currency?: string;
  duration?: number;
}

export interface ExecutorContext {
  userId: string;
  existingServices?: ServiceInfo[];
  existingContacts?: { id: string; name: string; first_name?: string; last_name?: string; email?: string }[];
  currentPreviewContext?: PreviewContext;
  language?: string; // User's language from intent parsing
  pendingContext?: PendingContext; // Pending context for multi-turn conversations
}

/**
 * Execute a parsed intent and return the result
 */
export async function executeIntent(
  intent: ParsedIntent,
  context: ExecutorContext
): Promise<CommandResult> {
  const { intent: intentType, entities, confidence, confirmRequired, language, rawText } = intent;
  // Detect Hebrew from raw text as fallback if language not explicitly set
  const hasHebrew = rawText ? /[\u0590-\u05FF]/.test(rawText) : false;
  const lang = language || context.language || (hasHebrew ? 'he' : 'en');

  logger.info({ intentType, confidence, entities, language: lang }, 'Executing intent');

  // Handle low confidence - be more lenient
  if (confidence < 0.3) {
    return {
      success: false,
      response: t('error.lowConfidence', lang),
      suggestions: getSuggestionsByContext(context.currentPreviewContext || 'services', false, lang),
    };
  }

  // Handle confirmation required
  if (confirmRequired && !entities._confirmed) {
    return {
      success: true,
      response: generateConfirmationPrompt(intentType, entities, lang),
      suggestions: getSuggestionsLocalized(['suggestion.yesDoIt', 'suggestion.noCancel'], lang),
    };
  }

  try {
    switch (intentType) {
      // Service operations
      case 'service.create':
        return await executeServiceCreate(entities, context, lang);
      case 'service.update':
        return await executeServiceUpdate(entities, context, lang);
      case 'service.delete':
        return await executeServiceDelete(entities, context, lang);

      // Availability
      case 'availability.update':
        return await executeAvailabilityUpdate(entities, context, lang);
      case 'availability.query':
        return await executeAvailabilityQuery(context, lang);

      // Calendar
      case 'calendar.open':
        return {
          success: true,
          response: t('booking.query.openingCalendar', lang),
          suggestions: getSuggestionsLocalized(['suggestion.scheduleToday', 'suggestion.scheduleTomorrow'], lang),
          action: {
            type: 'open_booking_calendar',
          },
        };

      // Booking operations
      case 'booking.create':
        return await executeBookingCreate(entities, context, lang);
      case 'booking.query':
        return await executeBookingQuery(entities, context, lang);
      case 'booking.cancel':
        return await executeBookingCancel(entities, context, lang);

      // Contact/CRM operations
      case 'contact.add':
        return await executeContactAdd(entities, context, lang);
      case 'contact.update':
        return await executeContactUpdate(entities, context, lang);
      case 'contact.query':
        return await executeContactQuery(entities, context, lang);
      case 'contact.view':
        return await executeContactView(entities, context, lang);

      // Task operations
      case 'task.create':
        return await executeTaskCreate(entities, context, lang);
      case 'task.query':
        return await executeTaskQuery(entities, context, lang);

      // Invoice/Payment operations
      case 'invoice.create':
        return await executeInvoiceCreate(entities, context, lang);
      case 'invoice.query':
        return await executeInvoiceQuery(entities, context, lang);
      case 'payment.record':
        return await executePaymentRecord(entities, context, lang);

      // Report queries
      case 'report.query':
        return await executeReportQuery(entities, context, lang);
      case 'report.compare':
        return await executeReportCompare(entities, context, lang);

      // Navigation
      case 'navigate':
        return executeNavigate(entities, lang);
      case 'preview.switch':
        return executePreviewSwitch(entities, lang);

      // Unknown
      case 'unknown':
      default:
        return {
          success: false,
          response: t('error.unknown', lang),
          suggestions: getSuggestionsByContext(context.currentPreviewContext || 'services', false, lang),
        };
    }
  } catch (error) {
    logger.error({ err: error, intentType }, 'Failed to execute intent');
    return {
      success: false,
      response: t('error.general', lang),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Service Operations
// ============================================================================

async function executeServiceCreate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Currency symbol map
  const currencySymbols: Record<string, string> = {
    USD: '$',
    ILS: '₪',
    EUR: '€',
    GBP: '£',
  };

  // Step 1: Check if user confirmed and we have all data → CREATE the service
  if (entities._confirmed) {
    const serviceName = entities.service_name;
    const durationMinutes = entities.duration_minutes || 60;
    const price = entities.price || 0;
    const isFree = entities.is_free ?? (price === 0);
    const currency = entities.currency || 'USD';

    try {
      const { data: service, error } = await schedulingServiceRepository.create({
        user_id: context.userId,
        service_name: serviceName,
        description: entities.description || '',
        duration_minutes: durationMinutes,
        price: isFree ? 0 : price,
        currency: currency,
        status: 'active',
        buffer_minutes: entities.buffer_minutes || 15,
        source: 'ai_generated',
      });

      if (error) {
        logger.error({ err: error }, 'Failed to create service via chat');
        return {
          success: false,
          response: t('error.serviceCreate', lang),
          suggestions: getSuggestionsLocalized(['suggestion.addService'], lang),
        };
      }

      const currencySymbol = currencySymbols[currency] || currency;
      const priceDisplay = isFree ? t('free', lang) : `${currencySymbol}${price}`;

      return {
        success: true,
        response: t('service.created.success', lang, {
          name: serviceName,
          duration: String(durationMinutes),
          price: priceDisplay,
        }),
        suggestions: getSuggestionsLocalized(['suggestion.addService', 'suggestion.setHours', 'suggestion.viewServices'], lang),
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create service via chat');
      return {
        success: false,
        response: t('error.tryAgain', lang),
        suggestions: getSuggestionsLocalized(['suggestion.addService'], lang),
      };
    }
  }

  // Step 2: Check for missing required fields
  const missingFields = getMissingFields('service.create', entities, REQUIRED_FIELDS);

  // Handle "free" service - if is_free is true, price is not required
  const effectiveMissing = entities.is_free
    ? missingFields.filter(f => f !== 'price')
    : missingFields;

  if (effectiveMissing.length > 0) {
    // Build missing fields message
    const missingMessages: string[] = [];
    if (effectiveMissing.includes('service_name')) {
      missingMessages.push(t('service.create.needsName', lang));
    }
    if (effectiveMissing.includes('price')) {
      missingMessages.push(t('service.create.needsPrice', lang));
    }

    // Store context for multi-turn conversation
    const pendingContext: PendingContext = {
      intent: 'service.create',
      entities: { ...entities, _language: lang },
      missingFields: effectiveMissing,
    };

    return {
      success: true,
      response: t('service.create.needsInfo', lang, { missing: missingMessages.join('\n') }),
      suggestions: [],
      action: {
        type: 'store_pending_context',
        context: pendingContext,
      },
    };
  }

  // Step 3: All fields collected → Show confirmation
  const preview = formatFullPreview('service.create', entities, lang);

  const pendingContext: PendingContext = {
    intent: 'service.create',
    entities: { ...entities, _language: lang },
    missingFields: [],
    awaitingConfirmation: true,
  };

  return {
    success: true,
    response: t('service.create.confirm', lang, { preview }),
    suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
    action: {
      type: 'await_confirmation',
      context: pendingContext,
    },
  };
}

async function executeServiceUpdate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const services = context.existingServices || [];

  // Currency symbol map
  const currencySymbols: Record<string, string> = {
    USD: '$',
    ILS: '₪',
    EUR: '€',
    GBP: '£',
  };

  // Step 1: If confirmed, apply the update
  if (entities._confirmed && entities._serviceId) {
    try {
      const updates: Record<string, any> = {};
      if (entities.price !== undefined) updates.price = entities.price;
      if (entities.currency) updates.currency = entities.currency;
      if (entities.duration_minutes !== undefined) updates.duration_minutes = entities.duration_minutes;
      if (entities.new_name) updates.service_name = entities.new_name;

      const { error } = await schedulingServiceRepository.update(
        entities._serviceId,
        context.userId,
        updates
      );

      if (error) throw error;

      const serviceName = entities._serviceName || entities.service_name;
      return {
        success: true,
        response: t('service.updated.success', lang, { name: serviceName }),
        suggestions: getSuggestionsLocalized(['suggestion.viewServices', 'suggestion.addService'], lang),
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to update service');
      return {
        success: false,
        response: t('error.general', lang),
        suggestions: [],
      };
    }
  }

  // Step 2: No service name specified → Ask which service or show list
  const serviceName = entities.service_name?.toLowerCase();
  if (!serviceName || serviceName === 'service' || serviceName === 'שירות') {
    if (services.length === 0) {
      return {
        success: false,
        response: t('service.update.noServices', lang),
        suggestions: getSuggestionsLocalized(['suggestion.addService'], lang),
      };
    }

    // Suggest existing services
    const serviceSuggestions = services.slice(0, 3).map(s => s.name);
    return {
      success: true,
      response: t('service.update.selectService', lang),
      suggestions: serviceSuggestions,
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'service.update',
          entities: { ...entities },
          missingFields: ['service_name'],
        },
      },
    };
  }

  // Step 3: Find the service using multilingual matching
  let matchedService: { id: string; name: string; price?: number; currency?: string; duration?: number } | null = null;
  if (services.length > 0) {
    const match = findServiceByName(entities.service_name, services);
    if (match && !Array.isArray(match)) {
      matchedService = match;
    } else if (Array.isArray(match) && match.length > 0) {
      // Multiple matches - ask user to specify
      return {
        success: true,
        response: t('service.update.whichService', lang),
        suggestions: match.slice(0, 4).map(s => s.name),
        action: {
          type: 'store_pending_context',
          context: {
            intent: 'service.update',
            entities: { ...entities, candidates: match },
            missingFields: ['service_name'],
          },
        },
      };
    }
  }

  if (!matchedService && !entities.service_id) {
    return {
      success: false,
      response: t('service.update.notFound', lang, { name: entities.service_name || '' }),
      suggestions: getSuggestionsLocalized(['suggestion.showServices', 'suggestion.addService'], lang),
    };
  }

  const serviceId = matchedService?.id || entities.service_id;
  const serviceDisplayName = matchedService?.name || entities.service_name;

  // Step 4: Check what user wants to update and if they provided actual values
  // Price is valid only if it's a positive number
  const hasValidPrice = typeof entities.price === 'number' && entities.price > 0;
  // Duration is valid only if it's a positive number
  const hasValidDuration = typeof entities.duration_minutes === 'number' && entities.duration_minutes > 0;
  // Name is valid if non-empty string
  const hasValidName = typeof entities.new_name === 'string' && entities.new_name.trim().length > 0;

  // Check if user wants to update something but hasn't provided the value
  const wantsToUpdatePrice = entities.update_price === true || entities.wants_price_change === true;
  const wantsToUpdateDuration = entities.update_duration === true || entities.wants_duration_change === true;

  // If user wants to update price but hasn't provided value, ask for it
  if (wantsToUpdatePrice && !hasValidPrice) {
    return {
      success: true,
      response: t('service.update.askPrice', lang, { name: serviceDisplayName }),
      suggestions: [],
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'service.update',
          entities: { ...entities, _serviceId: serviceId, _serviceName: serviceDisplayName, _language: lang },
          missingFields: ['price'],
        },
      },
    };
  }

  // If user wants to update duration but hasn't provided value, ask for it
  if (wantsToUpdateDuration && !hasValidDuration) {
    return {
      success: true,
      response: t('service.update.askDuration', lang, { name: serviceDisplayName }),
      suggestions: [],
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'service.update',
          entities: { ...entities, _serviceId: serviceId, _serviceName: serviceDisplayName, _language: lang },
          missingFields: ['duration_minutes'],
        },
      },
    };
  }

  // Step 5: Service found + valid specific changes → Show confirmation
  const hasSpecificChanges = hasValidPrice || hasValidDuration || hasValidName;

  if (hasSpecificChanges) {
    const previewLines: string[] = [];
    previewLines.push(`${t('label.service', lang)}: <b>${serviceDisplayName}</b>`);

    if (hasValidPrice) {
      const currency = entities.currency || matchedService?.currency || 'USD';
      const symbol = currencySymbols[currency] || currency;
      previewLines.push(`${t('label.newPrice', lang)}: <b>${symbol}${entities.price}</b>`);
    }

    if (hasValidDuration) {
      previewLines.push(`${t('label.newDuration', lang)}: <b>${entities.duration_minutes} ${t('label.minutes', lang)}</b>`);
    }

    if (hasValidName) {
      previewLines.push(`${t('label.newName', lang)}: <b>${entities.new_name}</b>`);
    }

    return {
      success: true,
      response: t('service.update.confirm', lang, { preview: previewLines.join('\n') }),
      suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
      action: {
        type: 'await_confirmation',
        context: {
          intent: 'service.update',
          entities: { ...entities, _serviceId: serviceId, _serviceName: serviceDisplayName, _language: lang },
          missingFields: [],
          awaitingConfirmation: true,
        },
      },
    };
  }

  // Step 5: Service name but no specific changes → Open dialog for full edit
  const prefill: Record<string, any> = {};
  if (entities.new_name) prefill.service_name = entities.new_name;
  if (entities.description !== undefined) prefill.description = entities.description;

  return {
    success: true,
    response: t('service.update.response', lang, { name: serviceDisplayName }),
    suggestions: getSuggestionsLocalized(['suggestion.changeService', 'suggestion.viewServices'], lang),
    action: {
      type: 'open_service_modal',
      mode: 'edit',
      serviceId: serviceId,
      prefill,
    },
  };
}

async function executeServiceDelete(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Use multilingual service matching
  let matchedService: { id: string; name: string } | null = null;

  if (entities.service_name && context.existingServices?.length) {
    const match = findServiceByName(entities.service_name, context.existingServices);
    if (match && !Array.isArray(match)) {
      matchedService = match;
    } else if (Array.isArray(match) && match.length > 0) {
      // Multiple matches - use first one for now (could add disambiguation)
      matchedService = match[0];
    }
  }

  if (!matchedService && !entities.service_id) {
    return {
      success: false,
      response: t('service.delete.notFound', lang, { name: entities.service_name || '' }),
      suggestions: getSuggestionsLocalized(['suggestion.showServices'], lang),
    };
  }

  const serviceId = matchedService?.id || entities.service_id;
  const serviceName = matchedService?.name || entities.service_name;

  // Trigger delete confirmation dialog
  return {
    success: true,
    response: t('service.delete.confirm', lang, { name: serviceName }),
    suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
    action: {
      type: 'show_delete_confirmation',
      entityType: 'service',
      entityId: serviceId,
      entityName: serviceName,
    },
  };
}

// ============================================================================
// Availability Operations
// ============================================================================

async function executeAvailabilityUpdate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const days = entities.days || [];
  const startTime = entities.start_time;
  const endTime = entities.end_time;

  // If user selected "Other hours" / "שעות אחרות" - open the dialog with days pre-selected
  if (entities.open_dialog) {
    // Format day names for display
    const dayNames: Record<string, Record<string, string>> = {
      sunday: { en: 'Sunday', he: 'יום ראשון', es: 'Domingo' },
      monday: { en: 'Monday', he: 'יום שני', es: 'Lunes' },
      tuesday: { en: 'Tuesday', he: 'יום שלישי', es: 'Martes' },
      wednesday: { en: 'Wednesday', he: 'יום רביעי', es: 'Miércoles' },
      thursday: { en: 'Thursday', he: 'יום חמישי', es: 'Jueves' },
      friday: { en: 'Friday', he: 'יום שישי', es: 'Viernes' },
      saturday: { en: 'Saturday', he: 'שבת', es: 'Sábado' },
    };

    const normalizedDays = days.map((d: string) => d.toLowerCase());
    const localizedDays = normalizedDays.length > 0
      ? normalizedDays.map((d: string) => dayNames[d]?.[lang] || dayNames[d]?.en || d).join(', ')
      : t('availability.days.default', lang);

    return {
      success: true,
      response: t('availability.response', lang, { days: localizedDays }),
      suggestions: getSuggestionsLocalized(['suggestion.setHours', 'suggestion.viewServices'], lang),
      action: {
        type: 'open_availability_dialog',
        days: normalizedDays, // Pass days to pre-select in the dialog
      },
    };
  }

  // If we have specific day(s) and time(s), apply the change directly
  if (days.length > 0 && startTime && endTime) {
    try {
      // 1. Fetch current availability from business_profiles
      const { data: profileData } = await supabaseServer
        .from('business_profiles')
        .select('id, scheduling_availability')
        .eq('user_id', context.userId)
        .single();

      let currentAvailability: Record<string, { start: string; end: string }[]> = {
        sunday: [],
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: []
      };

      if (profileData?.scheduling_availability) {
        currentAvailability = profileData.scheduling_availability;
      }

      // 2. Update the specified days with new time slots
      const normalizedDays = days.map((d: string) => d.toLowerCase());
      for (const day of normalizedDays) {
        if (day in currentAvailability) {
          // Replace the day's slots with the new time range
          currentAvailability[day] = [{ start: startTime, end: endTime }];
        }
      }

      // 3. Save the updated availability
      let saveError;
      if (profileData) {
        // Update existing profile
        const { error } = await supabaseServer
          .from('business_profiles')
          .update({
            scheduling_availability: currentAvailability,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', context.userId);
        saveError = error;
      } else {
        // Insert new profile
        const { error } = await supabaseServer
          .from('business_profiles')
          .insert({
            user_id: context.userId,
            vertical: 'other',
            scheduling_availability: currentAvailability
          });
        saveError = error;
      }

      if (!saveError) {
        // Format day names for display
        const dayNames: Record<string, Record<string, string>> = {
          sunday: { en: 'Sunday', he: 'יום ראשון', es: 'Domingo' },
          monday: { en: 'Monday', he: 'יום שני', es: 'Lunes' },
          tuesday: { en: 'Tuesday', he: 'יום שלישי', es: 'Martes' },
          wednesday: { en: 'Wednesday', he: 'יום רביעי', es: 'Miércoles' },
          thursday: { en: 'Thursday', he: 'יום חמישי', es: 'Jueves' },
          friday: { en: 'Friday', he: 'יום שישי', es: 'Viernes' },
          saturday: { en: 'Saturday', he: 'שבת', es: 'Sábado' },
        };

        const localizedDays = normalizedDays
          .map((d: string) => dayNames[d]?.[lang] || dayNames[d]?.en || d)
          .join(', ');

        // Format time for display
        const formatTime = (time: string) => {
          const [hours, minutes] = time.split(':');
          const h = parseInt(hours);
          if (lang === 'en') {
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${minutes} ${period}`;
          }
          return time;
        };

        const timeDisplay = `${formatTime(startTime)} - ${formatTime(endTime)}`;

        return {
          success: true,
          response: t('availability.updated', lang, { days: localizedDays, time: timeDisplay }),
          suggestions: getSuggestionsLocalized(['suggestion.setHours', 'suggestion.viewServices'], lang),
        };
      } else {
        throw saveError;
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to update availability');
      // Fall back to opening dialog
      const daysList = days.join(', ');
      return {
        success: true,
        response: t('availability.response', lang, { days: daysList }),
        suggestions: getSuggestionsLocalized(['suggestion.setHours', 'suggestion.viewServices'], lang),
        action: {
          type: 'open_availability_dialog',
        },
      };
    }
  }

  // Days specified but no times - ask for clarification (like service creation asks for details)
  if (days.length > 0 && (entities.needs_time_clarification || (!startTime && !endTime))) {
    // Format day names for display
    const dayNames: Record<string, Record<string, string>> = {
      sunday: { en: 'Sunday', he: 'יום ראשון', es: 'Domingo' },
      monday: { en: 'Monday', he: 'יום שני', es: 'Lunes' },
      tuesday: { en: 'Tuesday', he: 'יום שלישי', es: 'Martes' },
      wednesday: { en: 'Wednesday', he: 'יום רביעי', es: 'Miércoles' },
      thursday: { en: 'Thursday', he: 'יום חמישי', es: 'Jueves' },
      friday: { en: 'Friday', he: 'יום שישי', es: 'Viernes' },
      saturday: { en: 'Saturday', he: 'שבת', es: 'Sábado' },
    };

    const normalizedDays = days.map((d: string) => d.toLowerCase());
    const localizedDays = normalizedDays
      .map((d: string) => dayNames[d]?.[lang] || dayNames[d]?.en || d)
      .join(', ');

    return {
      success: true,
      response: t('availability.askTime', lang, { days: localizedDays }),
      suggestions: getSuggestionsLocalized([
        'suggestion.time.9to5',
        'suggestion.time.9to6',
        'suggestion.time.10to7',
        'suggestion.time.custom',
      ], lang),
      // Store pending days in action so we can use them when user responds with time
      action: {
        type: 'store_pending_availability',
        days: normalizedDays,
      },
    };
  }

  // No days specified at all - open dialog for manual editing
  const daysList = t('availability.days.default', lang);
  return {
    success: true,
    response: t('availability.response', lang, { days: daysList }),
    suggestions: getSuggestionsLocalized(['suggestion.setHours', 'suggestion.viewServices'], lang),
    action: {
      type: 'open_availability_dialog',
    },
  };
}

async function executeAvailabilityQuery(
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  try {
    // Fetch availability from business_profiles
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability')
      .eq('user_id', context.userId)
      .single();

    const availability = profile?.scheduling_availability;

    if (!availability || Object.keys(availability).length === 0) {
      return {
        success: true,
        response: t('availability.query.noData', lang),
        suggestions: getSuggestionsLocalized(['suggestion.setHours'], lang),
        action: {
          type: 'open_availability_dialog',
        },
      };
    }

    // Day names for display
    const dayNames: Record<string, Record<string, string>> = {
      sunday: { en: 'Sunday', he: 'יום ראשון' },
      monday: { en: 'Monday', he: 'יום שני' },
      tuesday: { en: 'Tuesday', he: 'יום שלישי' },
      wednesday: { en: 'Wednesday', he: 'יום רביעי' },
      thursday: { en: 'Thursday', he: 'יום חמישי' },
      friday: { en: 'Friday', he: 'יום שישי' },
      saturday: { en: 'Saturday', he: 'שבת' },
    };

    const dayOrder = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const lines: string[] = [];
    let openDays = 0;

    for (const day of dayOrder) {
      const dayData = availability[day];
      const dayName = dayNames[day]?.[lang] || dayNames[day]?.en || day;

      // Handle array format: [{ start: "09:00", end: "17:00" }]
      if (Array.isArray(dayData) && dayData.length > 0) {
        const slot = dayData[0]; // Use first time slot
        if (slot?.start && slot?.end) {
          lines.push(`<b>${dayName}</b>: ${slot.start} - ${slot.end}`);
          openDays++;
        }
      }
      // Handle object format: { enabled: true, start: "09:00", end: "17:00" }
      else if (dayData && typeof dayData === 'object' && !Array.isArray(dayData)) {
        if (dayData.enabled !== false && dayData.start && dayData.end) {
          lines.push(`<b>${dayName}</b>: ${dayData.start} - ${dayData.end}`);
          openDays++;
        } else if (dayData.enabled === false) {
          lines.push(`<b>${dayName}</b>: ${lang === 'he' ? 'סגור' : 'Closed'}`);
        }
      }
    }

    const summary = lang === 'he'
      ? `יש לך <b>${openDays}</b> ימים פתוחים השבוע:`
      : `You have <b>${openDays}</b> open days this week:`;

    return {
      success: true,
      response: `${summary}<br><br>${lines.join('<br>')}`,
      suggestions: getSuggestionsLocalized(['suggestion.setHours', 'suggestion.openCalendar'], lang),
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to query availability');
    return {
      success: true,
      response: t('availability.query.noData', lang),
      suggestions: getSuggestionsLocalized(['suggestion.setHours'], lang),
      action: {
        type: 'open_availability_dialog',
      },
    };
  }
}

// ============================================================================
// Booking Operations
// ============================================================================

async function executeBookingCreate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const contactName = entities.contact_name;
  const serviceName = entities.service_name;
  const date = entities.date;
  const time = entities.time;
  const services = context.existingServices || [];

  try {
    // Check if user wants to see available slots - determined by LLM via show_available entity
    const wantsAvailableSlots = entities.show_available === true;

    // Step 1: Check for missing required fields
    const missingFields: string[] = [];
    if (!contactName) missingFields.push('contact_name');
    if (!serviceName && services.length > 1) missingFields.push('service_name');
    if (!date) missingFields.push('date');
    // Only require time if user didn't ask for available slots
    if (!time && !wantsAvailableSlots) missingFields.push('time');

    if (missingFields.length > 0 && !entities._confirmed) {
      // Build missing fields message
      const missingMessages: string[] = [];
      if (missingFields.includes('contact_name')) {
        missingMessages.push(t('booking.create.needsContact', lang));
      }
      if (missingFields.includes('service_name')) {
        missingMessages.push(t('booking.create.needsService', lang));
      }
      if (missingFields.includes('date')) {
        missingMessages.push(t('booking.create.needsDate', lang));
      }
      if (missingFields.includes('time')) {
        missingMessages.push(t('booking.create.needsTime', lang));
      }

      // Store context for multi-turn conversation
      // Preserve show_available flag so we remember user wants to see available slots
      const pendingContext: PendingContext = {
        intent: 'booking.create',
        entities: { ...entities, _language: lang, show_available: wantsAvailableSlots || undefined },
        missingFields,
      };

      // Generate service suggestions if needed
      const suggestions = missingFields.includes('service_name')
        ? services.slice(0, 4).map(s => s.name)
        : [];

      return {
        success: true,
        response: t('booking.create.needsInfo', lang, { missing: missingMessages.join('\n') }),
        suggestions,
        action: {
          type: 'store_pending_context',
          context: pendingContext,
        },
      };
    }

    // Step 2: Find contact by name using multilingual matching
    // Fetch contacts from DB if not in context
    let contactsForMatching: Array<{
      id: string;
      name: string;
      first_name?: string;
      last_name?: string;
      email?: string;
    }> = (context.existingContacts || []).map(c => ({
      id: c.id,
      name: c.name,
      first_name: c.name.split(' ')[0],
      last_name: c.name.split(' ').slice(1).join(' '),
      email: undefined as string | undefined,
    }));

    if (contactsForMatching.length === 0 && contactName) {
      const { data: dbContacts } = await crmContactRepository.listBasic(context.userId);

      if (dbContacts) {
        contactsForMatching = dbContacts.map(c => ({
          id: c.id,
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          first_name: c.first_name || undefined,
          last_name: c.last_name || undefined,
          email: c.email || undefined,
        }));
      }
    }

    const contactMatch = contactName ? findContactByName(contactName, contactsForMatching) : null;

    // Handle disambiguation if multiple matches
    if (Array.isArray(contactMatch)) {
      const pendingContext: PendingContext = {
        intent: 'booking.create',
        entities: { ...entities, _language: lang },
        missingFields: [],
        entityType: 'contact',
        candidates: contactMatch.map(c => ({
          id: c.id,
          name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          detail: c.email,
        })),
      };

      return {
        success: true,
        response: t('booking.create.multipleContacts', lang, { name: contactName }),
        suggestions: contactMatch.map(c => c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim()),
        action: {
          type: 'show_disambiguation',
          entityType: 'contact',
          candidates: pendingContext.candidates!,
          context: pendingContext,
        },
      };
    }

    if (!contactMatch && contactName) {
      return {
        success: false,
        response: t('booking.create.contactNotFound', lang, { name: contactName }),
        suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewContacts'], lang),
      };
    }

    const contact = contactMatch as typeof contactsForMatching[0] | null;

    // Find service using multilingual matching
    let selectedService: ServiceInfo | undefined;
    if (serviceName) {
      const serviceMatch = findServiceByName(serviceName, services);
      if (Array.isArray(serviceMatch)) {
        // Multiple service matches - ask for clarification
        return {
          success: true,
          response: t('booking.create.multipleServices', lang),
          suggestions: serviceMatch.map(s => s.name),
          action: {
            type: 'store_pending_context',
            context: {
              intent: 'booking.create',
              entities: { ...entities, _language: lang },
              missingFields: ['service_name'],
            },
          },
        };
      }
      selectedService = serviceMatch || undefined;
    }

    // Use first service if only one exists
    if (!selectedService && services.length === 1) {
      selectedService = services[0];
    }

    // Step 3: If user wants available slots (has date but no time), show them
    if (contact && selectedService && date && !time && (wantsAvailableSlots || !entities._confirmed)) {
      const parsedDate = parseRelativeDate(date);
      const durationMinutes = selectedService.duration || 60;

      // Get available slots for this date
      const availableSlots = await getAvailableTimeSlots(
        context.userId,
        parsedDate,
        durationMinutes,
        lang
      );

      if (availableSlots.length > 0) {
        // Store pending context with contact and service already resolved
        const pendingContext: PendingContext = {
          intent: 'booking.create',
          entities: {
            ...entities,
            contact_id: contact.id,
            contact_name: contact.name,
            service_id: selectedService.id,
            service_name: selectedService.name,
            _language: lang,
          },
          missingFields: ['time'],
        };

        const dateDisplay = formatDateForDisplay(parsedDate, lang);
        return {
          success: true,
          response: t('booking.create.availableSlots', lang, { date: dateDisplay }),
          suggestions: availableSlots.slice(0, 4), // Show up to 4 time slots
          action: {
            type: 'store_pending_context',
            context: pendingContext,
          },
        };
      } else {
        const dateDisplay = formatDateForDisplay(parsedDate, lang);
        return {
          success: true,
          response: t('booking.create.noAvailableSlots', lang, { date: dateDisplay }),
          suggestions: getSuggestionsLocalized(['suggestion.scheduleTomorrow', 'suggestion.openCalendar'], lang),
        };
      }
    }

    // Step 4: All fields collected - show confirmation or create if already confirmed
    if (contact && selectedService && date && time) {
      // Parse the date and time
      const parsedDate = parseRelativeDate(date);
      const startDateTime = combineDateAndTime(parsedDate, time);
      const durationMinutes = selectedService.duration || 60;
      const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

      // Check for time slot conflicts
      const { data: overlappingBookings } = await schedulingBookingRepository.checkOverlap(
        context.userId,
        startDateTime.toISOString(),
        endDateTime.toISOString()
      );

      if (overlappingBookings && overlappingBookings.length > 0) {
        return {
          success: false,
          response: t('booking.create.conflict', lang),
          suggestions: getSuggestionsLocalized(['suggestion.openCalendar', 'suggestion.scheduleTomorrow'], lang),
          action: {
            type: 'open_booking_calendar',
            date: parsedDate.toISOString().split('T')[0],
          },
        };
      }

      // If confirmed, create the booking
      if (entities._confirmed) {
        // Get full contact details from DB (user-scoped via the repository)
        const { data: fullContact } = await crmContactRepository.findById(contact.id, context.userId);

        const contactData = fullContact || contact;

        // P4: route the booking create through the internal Scheduling plugin — proves the
        // plugin path end-to-end (db_active → SchedulingPluginExecutor → repo) and the T1/T2
        // trigger guardrail. user_id is derived server-side from the resolved connection.
        const pluginExecuter = await PluginExecuterV2.getInstance();
        const bookingResult = await pluginExecuter.execute(context.userId, SCHEDULING_PLUGIN_KEY, 'create_booking', {
          service_id: selectedService.id,
          contact_id: contact.id,
          client_first_name: contactData.first_name || contactName?.split(' ')[0] || '',
          client_last_name: contactData.last_name || contactName?.split(' ').slice(1).join(' ') || null,
          client_email: contactData.email || '',
          client_phone: ('phone' in contactData ? contactData.phone : null) || null,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
          timezone: 'UTC',
          status: 'confirmed',
          booking_source: 'chat',
        });

        if (!bookingResult.success) {
          throw new Error(bookingResult.message || bookingResult.error || 'Failed to create booking');
        }

        const dateDisplay = formatDateForDisplay(parsedDate, lang);
        const timeDisplay = formatTimeForDisplay(time, lang);
        const clientDisplay = contactData.first_name || contactName;

        return {
          success: true,
          response: t('booking.created.success', lang, {
            client: clientDisplay || '',
            service: selectedService.name,
            date: dateDisplay,
            time: timeDisplay,
          }),
          suggestions: getSuggestionsLocalized(['suggestion.viewBookings', 'suggestion.openCalendar'], lang),
          action: { type: 'clear_pending_context' },
        };
      }

      // Show confirmation preview
      const dateDisplay = formatDateForDisplay(parsedDate, lang);
      const timeDisplay = formatTimeForDisplay(time, lang);
      const preview = formatFullPreview('booking.create', {
        contact_name: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
        service_name: selectedService.name,
        date: dateDisplay,
        time: timeDisplay,
      }, lang);

      const pendingContext: PendingContext = {
        intent: 'booking.create',
        entities: {
          ...entities,
          contact_id: contact.id,
          service_id: selectedService.id,
          _language: lang,
        },
        missingFields: [],
        awaitingConfirmation: true,
      };

      return {
        success: true,
        response: t('booking.create.confirm', lang, { preview }),
        suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
        action: {
          type: 'await_confirmation',
          context: pendingContext,
        },
      };
    }

    // Default: open booking calendar
    return {
      success: true,
      response: t('booking.create.response', lang),
      suggestions: getSuggestionsLocalized(['suggestion.openCalendar', 'suggestion.viewBookings'], lang),
      action: {
        type: 'open_booking_calendar',
      },
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to create booking');
    return {
      success: false,
      response: t('error.general', lang),
      suggestions: getSuggestionsLocalized(['suggestion.openCalendar'], lang),
      action: {
        type: 'open_booking_calendar',
      },
    };
  }
}

async function executeBookingQuery(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  try {
    const period = entities.period?.toLowerCase() || 'today';
    const contactName = entities.contact_name;
    const status = entities.status?.toLowerCase();

    // Compute the date window for the requested period, then list via the repository.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    let startDate: string | undefined;
    let endDate: string | undefined;
    if (period === 'today') {
      startDate = startOfToday.toISOString();
      endDate = endOfToday.toISOString();
    } else if (period === 'tomorrow') {
      const startOfTomorrow = endOfToday;
      startDate = startOfTomorrow.toISOString();
      endDate = new Date(startOfTomorrow.getTime() + 24 * 60 * 60 * 1000).toISOString();
    } else if (period === 'this_week') {
      startDate = startOfToday.toISOString();
      endDate = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (period === 'next_week') {
      const startOfNextWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
      startDate = startOfNextWeek.toISOString();
      endDate = new Date(startOfNextWeek.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      // Default: upcoming bookings from now (no end bound)
      startDate = now.toISOString();
    }

    const { data: bookings } = await schedulingBookingRepository.list(context.userId, {
      status: status || ['confirmed', 'completed'],
      startDate,
      endDate,
      search: contactName,
      limit: 10,
    });

    if (!bookings || bookings.length === 0) {
      const responseKey = period === 'today' ? 'booking.query.noneToday' : 'booking.query.none';
      return {
        success: true,
        response: t(responseKey, lang),
        suggestions: getSuggestionsLocalized(['suggestion.scheduleToday', 'suggestion.openCalendar', 'suggestion.viewBookings'], lang),
      };
    }

    // Format bookings for response. (The repository aliases the service join as `service`.)
    const formattedBookings = bookings.map(b => {
      const serviceData = (b as { service?: unknown }).service;
      const service = Array.isArray(serviceData) ? serviceData[0] : serviceData;
      return {
        id: b.id,
        client_name: `${b.client_first_name || ''} ${b.client_last_name || ''}`.trim(),
        service_name: (service as { service_name?: string } | null)?.service_name || 'Meeting',
        start_time: b.start_time,
        end_time: b.end_time,
        status: b.status,
      };
    });

    const responseKey = period === 'today' ? 'booking.query.today' : 'booking.query.upcoming';

    // Format the bookings list for display - grouped by date with better structure
    const bookingsByDate: Record<string, typeof formattedBookings> = {};
    formattedBookings.forEach(b => {
      const startDate = new Date(b.start_time);
      const dateKey = startDate.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
      if (!bookingsByDate[dateKey]) bookingsByDate[dateKey] = [];
      bookingsByDate[dateKey].push(b);
    });

    // Build clean text list without emojis
    const bookingsList = Object.entries(bookingsByDate).map(([date, dateBookings]) => {
      const items = dateBookings.map(b => {
        const startDate = new Date(b.start_time);
        const timeStr = startDate.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: lang !== 'he',
        });
        return `${timeStr} - ${b.client_name} (${b.service_name})`;
      }).join('<br>');
      return `<b>${date}</b><br>${items}`;
    }).join('<br><br>');

    // Generate contextual suggestions based on first booking
    const firstBooking = formattedBookings[0];
    const suggestions: string[] = [];
    if (firstBooking) {
      const firstName = firstBooking.client_name.split(' ')[0];
      if (firstName) {
        suggestions.push(t('suggestion.cancelBookingWith', lang, { name: firstName }));
      }
    }
    suggestions.push(t('suggestion.scheduleNew', lang));
    suggestions.push(t('suggestion.openCalendar', lang));

    return {
      success: true,
      response: t(responseKey, lang, { count: String(bookings.length) }) + '\n\n' + bookingsList,
      data: { type: 'booking_list', bookings: formattedBookings },
      suggestions: suggestions.slice(0, 4),
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to query bookings');
    return {
      success: true,
      response: t('booking.query.none', lang),
      suggestions: getSuggestionsLocalized(['suggestion.openCalendar', 'suggestion.scheduleToday'], lang),
      action: {
        type: 'open_booking_calendar',
      },
    };
  }
}

async function executeBookingCancel(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const contactName = entities.contact_name;
  const bookingId = entities.booking_id;
  const date = entities.date;

  try {
    // If we have a specific booking ID, cancel it directly
    if (bookingId) {
      const { data: booking, error } = await schedulingBookingRepository.cancel(bookingId, context.userId);

      if (error) throw error;

      const clientName = `${booking?.client_first_name || ''} ${booking?.client_last_name || ''}`.trim();
      return {
        success: true,
        response: t('booking.cancelled', lang, { client: clientName }),
        suggestions: getSuggestionsLocalized(['suggestion.viewBookings', 'suggestion.scheduleToday'], lang),
      };
    }

    // Try to find bookings matching the criteria (via the repository)
    const parsedCancelDate = date ? parseRelativeDate(date) : null;
    const cancelDayStart = parsedCancelDate
      ? new Date(parsedCancelDate.getFullYear(), parsedCancelDate.getMonth(), parsedCancelDate.getDate())
      : null;
    const { data: bookings } = await schedulingBookingRepository.list(context.userId, {
      status: 'confirmed',
      search: contactName,
      startDate: cancelDayStart ? cancelDayStart.toISOString() : undefined,
      endDate: cancelDayStart ? new Date(cancelDayStart.getTime() + 24 * 60 * 60 * 1000).toISOString() : undefined,
      limit: 5,
    });

    if (!bookings || bookings.length === 0) {
      return {
        success: false,
        response: t('booking.query.none', lang),
        suggestions: getSuggestionsLocalized(['suggestion.viewBookings', 'suggestion.openCalendar'], lang),
      };
    }

    // If multiple bookings match, show a list
    if (bookings.length > 1) {
      const formattedBookings = bookings.map(b => ({
        id: b.id,
        client_name: `${b.client_first_name || ''} ${b.client_last_name || ''}`.trim(),
        service_name: 'Meeting',
        start_time: b.start_time,
        end_time: b.end_time,
        status: 'confirmed',
      }));

      return {
        success: true,
        response: t('booking.cancel.which', lang),
        action: {
          type: 'show_booking_list',
          bookings: formattedBookings,
        },
      };
    }

    // Single booking - show confirmation via delete dialog
    const booking = bookings[0];
    const clientName = `${booking.client_first_name || ''} ${booking.client_last_name || ''}`.trim() || t('booking.client.default', lang);
    const dateDisplay = formatDateForDisplay(new Date(booking.start_time), lang);
    const locale = lang === 'he' ? 'he-IL' : lang === 'es' ? 'es-ES' : 'en-US';
    const timeDisplay = new Date(booking.start_time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    return {
      success: true,
      response: t('booking.cancel.confirmChat', lang, { client: clientName, date: dateDisplay, time: timeDisplay }),
      suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
      action: {
        type: 'show_delete_confirmation',
        entityType: 'booking',
        entityId: booking.id,
        entityName: `${clientName} - ${dateDisplay} ${timeDisplay}`,
      },
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to cancel booking');
    return {
      success: false,
      response: t('booking.cancel.response', lang),
      route: '/business-os',
      suggestions: getSuggestionsLocalized(['suggestion.openCalendar'], lang),
    };
  }
}

// Helper: Get available time slots for a given date
async function getAvailableTimeSlots(
  userId: string,
  date: Date,
  durationMinutes: number,
  lang: string
): Promise<string[]> {
  try {
    // Get business availability from profile
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('scheduling_availability')
      .eq('user_id', userId)
      .single();

    // Default business hours if no availability set
    const dayOfWeek = date.getDay();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[dayOfWeek];

    let startHour = 9;
    let endHour = 17;

    if (profile?.scheduling_availability?.[dayName]) {
      const dayAvailability = profile.scheduling_availability[dayName];
      if (dayAvailability.enabled === false) {
        return []; // Day is not available
      }
      if (dayAvailability.start) {
        const [h] = dayAvailability.start.split(':').map(Number);
        startHour = h;
      }
      if (dayAvailability.end) {
        const [h] = dayAvailability.end.split(':').map(Number);
        endHour = h;
      }
    }

    // Get existing bookings for this date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: existingBookings } = await schedulingBookingRepository.list(userId, {
      status: ['confirmed', 'completed'],
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString(),
      limit: 500, // a single day won't exceed this; preserves the original no-limit read
    });

    // Generate time slots (every 30 minutes)
    const slots: string[] = [];
    const slotInterval = 30; // minutes

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += slotInterval) {
        const slotStart = new Date(date);
        slotStart.setHours(hour, minute, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

        // Check if slot end is within business hours
        if (slotEnd.getHours() > endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) {
          continue;
        }

        // Check for conflicts with existing bookings
        const hasConflict = existingBookings?.some(booking => {
          const bookingStart = new Date(booking.start_time);
          const bookingEnd = new Date(booking.end_time);
          return slotStart < bookingEnd && slotEnd > bookingStart;
        });

        if (!hasConflict) {
          // Format time for display
          const timeStr = slotStart.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: lang !== 'he',
          });
          slots.push(timeStr);
        }
      }
    }

    return slots;
  } catch (error) {
    logger.error({ err: error }, 'Failed to get available time slots');
    return [];
  }
}

// Helper: Parse relative dates like "tomorrow", "next Monday"
function parseRelativeDate(dateStr: string): Date {
  const lower = dateStr.toLowerCase().trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Hebrew day names mapping
  const hebrewDays: Record<string, number> = {
    'יום ראשון': 0, 'ראשון': 0,
    'יום שני': 1, 'שני': 1,
    'יום שלישי': 2, 'שלישי': 2,
    'יום רביעי': 3, 'רביעי': 3,
    'יום חמישי': 4, 'חמישי': 4,
    'יום שישי': 5, 'שישי': 5,
    'שבת': 6,
  };

  // English day names
  const englishDays: Record<string, number> = {
    'sunday': 0, 'sun': 0,
    'monday': 1, 'mon': 1,
    'tuesday': 2, 'tue': 2,
    'wednesday': 3, 'wed': 3,
    'thursday': 4, 'thu': 4,
    'friday': 5, 'fri': 5,
    'saturday': 6, 'sat': 6,
  };

  // Today/Tomorrow
  if (lower === 'today' || lower === 'היום') {
    return today;
  }
  if (lower === 'tomorrow' || lower === 'מחר') {
    return new Date(today.getTime() + 24 * 60 * 60 * 1000);
  }

  // Check for day names
  for (const [dayName, dayNum] of Object.entries({ ...hebrewDays, ...englishDays })) {
    if (lower.includes(dayName)) {
      const currentDay = today.getDay();
      let daysToAdd = dayNum - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next occurrence
      return new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    }
  }

  // Try to parse as date string
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return today;
}

// Helper: Combine date and time into a single Date object
function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const combined = new Date(date);
  combined.setHours(hours || 9, minutes || 0, 0, 0);
  return combined;
}

// Helper: Format date for display
function formatDateForDisplay(date: Date, lang: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  };
  const locale = lang === 'he' ? 'he-IL' : lang === 'es' ? 'es-ES' : 'en-US';
  return date.toLocaleDateString(locale, options);
}

// Helper: Format time for display
function formatTimeForDisplay(timeStr: string, lang: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const h = hours || 0;
  const m = minutes || 0;

  if (lang === 'he') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ============================================================================
// Contact/CRM Operations
// ============================================================================

async function executeContactAdd(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Parse name from various sources
  const firstName = entities.first_name || entities.name?.split(' ')[0] || '';
  const lastName = entities.last_name || entities.name?.split(' ').slice(1).join(' ') || '';

  // Normalize entities
  const normalizedEntities = {
    ...entities,
    first_name: firstName,
    last_name: lastName,
  };

  // Step 1: Check if user confirmed and we have all data → CREATE the contact
  if (entities._confirmed) {
    try {
      const { data: contact, error } = await crmContactRepository.create({
        user_id: context.userId,
        first_name: firstName,
        last_name: lastName || undefined,
        email: entities.email,
        phone: entities.phone || undefined,
        stage: entities.stage || 'lead',
        notes: entities.notes || undefined,
        // `company` is not a first-class crm_contacts column — store it in the JSONB custom_fields bag.
        custom_fields: entities.company ? { company: entities.company } : undefined,
      });

      if (error) {
        logger.error({ err: error }, 'Failed to create contact via chat');
        return {
          success: false,
          response: t('error.contactAdd', lang),
          suggestions: getSuggestionsLocalized(['suggestion.addContact'], lang),
        };
      }

      const fullName = `${firstName} ${lastName}`.trim();

      return {
        success: true,
        response: t('contact.added.success', lang, { name: fullName }),
        suggestions: getSuggestionsLocalized(['suggestion.addContact', 'suggestion.viewContacts'], lang),
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create contact via chat');
      return {
        success: false,
        response: t('error.tryAgain', lang),
        suggestions: getSuggestionsLocalized(['suggestion.addContact'], lang),
      };
    }
  }

  // Step 2: Check for missing required fields
  const missingFields = getMissingFields('contact.add', normalizedEntities, REQUIRED_FIELDS);

  if (missingFields.length > 0) {
    // Build missing fields message
    const missingMessages: string[] = [];
    if (missingFields.includes('first_name')) {
      missingMessages.push(t('contact.add.needsName', lang));
    }
    if (missingFields.includes('email')) {
      missingMessages.push(t('contact.add.needsEmail', lang));
    }

    // Store context for multi-turn conversation
    const pendingContext: PendingContext = {
      intent: 'contact.add',
      entities: { ...normalizedEntities, _language: lang },
      missingFields,
    };

    return {
      success: true,
      response: t('contact.add.needsInfo', lang, { missing: missingMessages.join('\n') }),
      suggestions: [],
      action: {
        type: 'store_pending_context',
        context: pendingContext,
      },
    };
  }

  // Step 3: All fields collected → Show confirmation
  const preview = formatFullPreview('contact.add', normalizedEntities, lang);

  const pendingContext: PendingContext = {
    intent: 'contact.add',
    entities: { ...normalizedEntities, _language: lang },
    missingFields: [],
    awaitingConfirmation: true,
  };

  return {
    success: true,
    response: t('contact.add.confirm', lang, { preview }),
    suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
    action: {
      type: 'await_confirmation',
      context: pendingContext,
    },
  };
}

async function executeContactUpdate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const contacts = context.existingContacts || [];

  // Step 1: If confirmed, apply the update
  if (entities._confirmed && entities._contactId) {
    try {
      const updates: Record<string, any> = {};
      if (entities.stage !== undefined) updates.stage = entities.stage;
      if (entities.email !== undefined) updates.email = entities.email;
      if (entities.phone !== undefined) updates.phone = entities.phone;
      if (entities.notes !== undefined) updates.notes = entities.notes;

      const { error } = await crmContactRepository.update(
        entities._contactId,
        context.userId,
        updates
      );

      if (error) throw error;

      return {
        success: true,
        response: t('contact.updated.success', lang, { name: entities._contactName }),
        suggestions: getSuggestionsLocalized(['suggestion.viewContacts', 'suggestion.addContact'], lang),
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to update contact');
      return {
        success: false,
        response: t('error.general', lang),
        suggestions: [],
      };
    }
  }

  // Step 2: No contact name specified → Ask which contact
  const contactName = entities.contact_name?.toLowerCase();
  if (!contactName || contactName === 'contact' || contactName === 'לקוח' || contactName === 'איש קשר') {
    if (contacts.length === 0) {
      return {
        success: false,
        response: t('contact.query.noContacts', lang),
        suggestions: getSuggestionsLocalized(['suggestion.addContact'], lang),
      };
    }

    // Suggest existing contacts
    const contactSuggestions = contacts.slice(0, 3).map(c => c.name);
    return {
      success: true,
      response: t('contact.update.selectContact', lang),
      suggestions: contactSuggestions,
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'contact.update',
          entities: { ...entities },
          missingFields: ['contact_name'],
        },
      },
    };
  }

  // Step 3: Find the contact using multilingual matching
  let matchedContact: { id: string; name: string } | null = null;
  if (contacts.length > 0) {
    const match = findContactByName(entities.contact_name, contacts);
    if (match && !Array.isArray(match)) {
      matchedContact = match;
    } else if (Array.isArray(match) && match.length > 0) {
      // Multiple matches - ask user to specify
      return {
        success: true,
        response: t('contact.update.which', lang),
        suggestions: match.slice(0, 4).map(c => c.name),
        action: {
          type: 'store_pending_context',
          context: {
            intent: 'contact.update',
            entities: { ...entities, candidates: match },
            missingFields: ['contact_name'],
          },
        },
      };
    }
  }

  if (!matchedContact && !entities.contact_id) {
    return {
      success: false,
      response: t('contact.update.notFound', lang, { name: entities.contact_name || '' }),
      suggestions: getSuggestionsLocalized(['suggestion.showContacts', 'suggestion.addNewContact'], lang),
    };
  }

  const contactId = matchedContact?.id || entities.contact_id;
  const contactDisplayName = matchedContact?.name || entities.contact_name;

  // Step 4: Contact found + specific changes → Show confirmation
  const hasSpecificChanges = entities.stage !== undefined || entities.email !== undefined || entities.phone !== undefined || entities.notes !== undefined;

  if (hasSpecificChanges) {
    const previewLines: string[] = [];
    previewLines.push(`${t('label.contact', lang)}: <b>${contactDisplayName}</b>`);

    if (entities.stage !== undefined) {
      previewLines.push(`${t('label.newStage', lang)}: <b>${entities.stage}</b>`);
    }
    if (entities.email !== undefined) {
      previewLines.push(`${t('label.newEmail', lang)}: <b>${entities.email}</b>`);
    }
    if (entities.phone !== undefined) {
      previewLines.push(`${t('label.newPhone', lang)}: <b>${entities.phone}</b>`);
    }

    return {
      success: true,
      response: t('contact.update.confirm', lang, { preview: previewLines.join('\n') }),
      suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
      action: {
        type: 'await_confirmation',
        context: {
          intent: 'contact.update',
          entities: { ...entities, _contactId: contactId, _contactName: contactDisplayName, _language: lang },
          missingFields: [],
          awaitingConfirmation: true,
        },
      },
    };
  }

  // Step 5: Contact found but no specific changes → Open dialog for full edit
  const prefill: Record<string, any> = {};
  if (entities.stage !== undefined) prefill.stage = entities.stage;
  if (entities.email !== undefined) prefill.email = entities.email;
  if (entities.phone !== undefined) prefill.phone = entities.phone;
  if (entities.notes !== undefined) prefill.notes = entities.notes;

  return {
    success: true,
    response: t('contact.update.response', lang, { name: contactDisplayName }),
    suggestions: getSuggestionsLocalized(['suggestion.updateContact', 'suggestion.viewContacts'], lang),
    action: {
      type: 'open_contact_dialog',
      mode: 'edit',
      contactId: contactId,
      prefill,
    },
  };
}

async function executeContactQuery(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  try {
    // Build filters from entities
    const filters: Record<string, any> = {};
    if (entities.stage) filters.stage = entities.stage;
    // Accept 'search', 'contact_name', or 'name' as search terms
    const searchTerm = entities.search || entities.contact_name || entities.name;
    if (searchTerm) filters.search = searchTerm;

    // Query for contacts with overdue tasks
    if (entities.has_overdue_tasks || entities.has_due_tasks) {
      // Fetch contact ids with overdue, still-open tasks (deduped by the repository)
      const { data: overdueContactIds } = await crmTaskRepository.getOverdueContactIds(context.userId);
      const contactIds = overdueContactIds || [];

      if (contactIds.length === 0) {
        return {
          success: true,
          response: t('contact.query.none', lang),
          suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewPipeline'], lang),
        };
      }

      // Fetch contacts with overdue tasks
      const { data: contactsBasic } = await crmContactRepository.listBasic(context.userId, {
        ids: contactIds,
        limit: 10,
      });
      const contacts = (contactsBasic || []).map((c) => ({
        id: c.id,
        first_name: c.first_name ?? undefined,
        last_name: c.last_name ?? undefined,
        email: c.email ?? undefined,
        stage: c.stage,
      }));

      if (!contacts || contacts.length === 0) {
        return {
          success: true,
          response: t('contact.query.none', lang),
          suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewPipeline'], lang),
        };
      }

      return {
        success: true,
        response: t('contact.query.found', lang, {
          count: String(contacts.length),
          label: t('contact.query.withOverdueTasks', lang),
        }),
        data: { type: 'contact_list', contacts },
        suggestions: getContextualSuggestions('contact_query_overdue', contacts, lang),
        previewContext: 'crm',
      };
    }

    // Regular contact query
    const { data: contactsBasic } = await crmContactRepository.listBasic(context.userId, {
      stage: filters.stage,
      search: filters.search,
      limit: entities.limit || 10,
    });
    const contacts = (contactsBasic || []).map((c) => ({
      id: c.id,
      first_name: c.first_name ?? undefined,
      last_name: c.last_name ?? undefined,
      email: c.email ?? undefined,
      stage: c.stage,
    }));

    if (!contacts || contacts.length === 0) {
      const responseMsg = filters.search
        ? t('contact.query.noneWithName', lang, { name: filters.search })
        : t('contact.query.none', lang);
      return {
        success: true,
        response: responseMsg,
        suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewPipeline'], lang),
      };
    }

    return {
      success: true,
      response: t('contact.query.found', lang, {
        count: String(contacts.length),
        label: t('contact.query.contacts', lang),
      }),
      data: { type: 'contact_list', contacts },
      suggestions: getContextualSuggestions('contact_query', contacts, lang),
      previewContext: 'crm',
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to query contacts');
    // Fallback to navigation
    return {
      success: true,
      response: t('contact.query.response', lang),
      route: '/business-os/crm',
      previewContext: 'crm',
      suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewPipeline'], lang),
    };
  }
}

/**
 * Open a specific contact's page/profile
 */
async function executeContactView(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const contactName = entities.contact_name;

  // If no contact name provided, ask for it
  if (!contactName) {
    // If we have contacts, suggest some
    if (context.existingContacts?.length) {
      const suggestions = context.existingContacts.slice(0, 4).map(c => c.name);
      return {
        success: true,
        response: t('contact.view.needsName', lang),
        suggestions,
        action: {
          type: 'store_pending_context',
          context: {
            intent: 'contact.view',
            entities: { _language: lang },
            missingFields: ['contact_name'],
          },
        },
      };
    }
    return {
      success: true,
      response: t('contact.view.needsName', lang),
      suggestions: getSuggestionsLocalized(['suggestion.viewContacts', 'suggestion.addContact'], lang),
    };
  }

  // Try to find the contact
  if (!context.existingContacts?.length) {
    return {
      success: true,
      response: t('contact.view.notFound', lang, { name: contactName }),
      suggestions: getSuggestionsLocalized(['suggestion.viewContacts', 'suggestion.addContact'], lang),
    };
  }

  const match = findContactByName(contactName, context.existingContacts);

  if (!match) {
    return {
      success: true,
      response: t('contact.view.notFound', lang, { name: contactName }),
      suggestions: getSuggestionsLocalized(['suggestion.viewContacts', 'suggestion.addContact'], lang),
    };
  }

  // Multiple matches - ask user to choose
  if (Array.isArray(match)) {
    return {
      success: true,
      response: t('contact.view.which', lang),
      suggestions: match.slice(0, 4).map(c => c.name),
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'contact.view',
          entities: { _language: lang },
          missingFields: ['contact_name'],
        },
      },
    };
  }

  // Single match - navigate to the CRM page with contact filter
  const displayName = match.name;
  return {
    success: true,
    response: t('contact.view.opening', lang, { name: displayName }),
    route: `/business-os/crm?contact=${match.id}`,
    previewContext: 'crm',
    suggestions: getSuggestionsLocalized(['suggestion.addActivity', 'suggestion.scheduleBooking', 'suggestion.viewContacts'], lang),
  };
}

// ============================================================================
// Task Operations
// ============================================================================

async function executeTaskCreate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Step 1: If confirmed, create the task
  if (entities._confirmed) {
    try {
      // Find contact if provided
      let contactId: string | null = null;
      let contactName: string | null = null;
      if (entities.contact_name && context.existingContacts?.length) {
        const contactMatch = findContactByName(entities.contact_name, context.existingContacts);
        if (contactMatch && !Array.isArray(contactMatch)) {
          contactId = contactMatch.id;
          contactName = contactMatch.name;
        }
      }

      // Parse due date if provided
      let dueDate: string | null = null;
      if (entities.due_date) {
        const parsed = parseRelativeDate(entities.due_date);
        if (parsed) {
          dueDate = parsed.toISOString();
        }
      }

      // Create the task via the internal CRM plugin (R8: proves the internal plugin path
      // end-to-end from a live caller — db_active access check → CRMPluginExecutor →
      // crmTaskRepository. user_id is derived server-side from the resolved connection, so it
      // is NOT passed here). Other CRM sites in this file still call repositories directly;
      // migration is additive/gradual.
      const pluginExecuter = await PluginExecuterV2.getInstance();
      const taskResult = await pluginExecuter.execute(context.userId, CRM_PLUGIN_KEY, 'add_task', {
        title: entities.description,
        contact_id: contactId,
        due_date: dueDate,
        status: 'pending',
        priority: entities.priority || 'medium',
      });

      if (!taskResult.success) {
        throw new Error(taskResult.message || taskResult.error || 'Failed to create task');
      }

      // Build success message parts
      const locale = lang === 'he' ? 'he-IL' : lang === 'es' ? 'es-ES' : 'en-US';
      const contactPart = contactName ? ` - ${t('label.for', lang)} <b>${contactName}</b>` : '';
      const duePart = dueDate ? ` - ${t('label.due', lang)} ${new Date(dueDate).toLocaleDateString(locale)}` : '';

      return {
        success: true,
        response: t('task.created.success', lang, {
          description: entities.description,
          contact: contactPart,
          due: duePart,
        }),
        suggestions: getSuggestionsLocalized(['suggestion.viewTasks', 'suggestion.addReminder'], lang),
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create task');
      return {
        success: false,
        response: t('error.general', lang),
        suggestions: [],
      };
    }
  }

  // Step 2: Check for missing required fields
  const missingFields = getMissingFields('task.create', entities, REQUIRED_FIELDS);
  if (missingFields.length > 0) {
    const missingMessages: string[] = [];
    for (const field of missingFields) {
      if (field === 'description') missingMessages.push(t('task.create.needsDescription', lang));
    }

    return {
      success: true,
      response: t('task.create.needsInfo', lang, { missing: missingMessages.join('\n') }),
      suggestions: [
        t('suggestion.callClient', lang),
        t('suggestion.sendQuote', lang),
        t('suggestion.reminderTomorrow', lang),
      ],
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'task.create',
          entities,
          missingFields,
        },
      },
    };
  }

  // Step 3: All required fields present - show confirmation
  const previewLines: string[] = [];
  previewLines.push(`${t('label.task', lang)}: <b>${entities.description}</b>`);
  if (entities.contact_name) {
    previewLines.push(`${t('label.contact', lang)}: ${entities.contact_name}`);
  }
  if (entities.due_date) {
    previewLines.push(`${t('label.due', lang)}: ${entities.due_date}`);
  }

  return {
    success: true,
    response: t('task.create.confirm', lang, { preview: previewLines.join('\n') }),
    suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
    action: {
      type: 'await_confirmation',
      context: {
        intent: 'task.create',
        entities: { ...entities, _language: lang },
        missingFields: [],
        awaitingConfirmation: true,
      },
    },
  };
}

async function executeTaskQuery(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  try {
    const status = entities.status?.toLowerCase();
    const duePeriod = entities.due_period?.toLowerCase();

    // Build repository list options, preserving the original per-status/date filter shape.
    const listOptions: CRMTaskListOptions = {
      orderBy: 'due_date',
      orderDirection: 'asc',
      limit: entities.limit || 10,
    };

    // Handle different query types
    if (status === 'overdue') {
      listOptions.status = ['pending', 'in_progress'];
      listOptions.due_before = new Date().toISOString();
    } else if (status === 'completed') {
      listOptions.status = 'completed';
    } else if (status === 'pending' || status === 'upcoming') {
      listOptions.status = ['pending', 'in_progress'];

      // Add date filter for upcoming
      if (duePeriod === 'today') {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        listOptions.due_before = tomorrow.toISOString();
      } else if (duePeriod === 'this_week') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        listOptions.due_before = nextWeek.toISOString();
      }
    } else {
      // No status specified → original query applied no status filter (all statuses).
      // include_completed:true lifts the repository's default pending/in_progress restriction.
      listOptions.include_completed = true;
    }

    // Filter by contact name if provided
    if (entities.contact_name) {
      // Would need to join and filter by contact name
      // For now, skip this filter (unchanged from prior behavior)
    }

    const { data: tasks } = await crmTaskRepository.list(context.userId, listOptions);

    if (!tasks || tasks.length === 0) {
      if (status === 'overdue') {
        return {
          success: true,
          response: t('task.query.noOverdue', lang),
          suggestions: getSuggestionsLocalized(['suggestion.addTask', 'suggestion.viewContacts'], lang),
        };
      }
      return {
        success: true,
        response: t('task.query.none', lang),
        suggestions: getSuggestionsLocalized(['suggestion.addTask', 'suggestion.viewContacts'], lang),
      };
    }

    // Format tasks for response
    const formattedTasks = (tasks || []).map(task => ({
      id: task.id,
      title: task.title,
      due_date: task.due_date ?? undefined,
      status: task.status,
      contact_id: task.contact_id ?? undefined,
    }));

    const responseKey = status === 'overdue'
      ? 'task.query.overdue'
      : (status === 'upcoming' || duePeriod)
        ? 'task.query.upcoming'
        : 'task.query.found';

    // Use contextual suggestions based on whether these are overdue tasks
    const suggestionContext = status === 'overdue' ? 'task_query_overdue' : 'task_query';

    return {
      success: true,
      response: t(responseKey, lang, { count: String(tasks.length) }),
      data: { type: 'task_list', tasks: formattedTasks },
      suggestions: getContextualSuggestions(suggestionContext, formattedTasks, lang),
      previewContext: 'crm',
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to query tasks');
    return {
      success: true,
      response: t('task.query.none', lang),
      route: '/business-os/crm?tab=tasks',
      suggestions: getSuggestionsLocalized(['suggestion.viewTasks', 'suggestion.addReminder'], lang),
    };
  }
}

// ============================================================================
// Invoice/Payment Operations
// ============================================================================

async function executeInvoiceCreate(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Currency symbol map
  const currencySymbols: Record<string, string> = {
    USD: '$',
    ILS: '₪',
    EUR: '€',
    GBP: '£',
  };

  // Step 1: If confirmed, create the invoice
  if (entities._confirmed) {
    try {
      // Find contact by name using multilingual matching
      let contact: { id: string; name: string; email?: string } | null = null;
      if (context.existingContacts?.length) {
        const match = findContactByName(entities.contact_name, context.existingContacts);
        if (match && !Array.isArray(match)) {
          contact = match;
        }
      }

      // If not found in cache, try direct DB lookup
      if (!contact) {
        const { data: contacts } = await crmContactRepository.listBasic(context.userId, {
          search: entities.contact_name,
          limit: 1,
        });

        if (contacts && contacts.length > 0) {
          contact = {
            id: contacts[0].id,
            name: `${contacts[0].first_name || ''} ${contacts[0].last_name || ''}`.trim() || contacts[0].email || '',
            email: contacts[0].email ?? undefined,
          };
        }
      }

      if (!contact) {
        return {
          success: false,
          response: t('invoice.contactNotFound', lang, { name: entities.contact_name }),
          suggestions: getSuggestionsLocalized(['suggestion.addNewContact', 'suggestion.viewContacts'], lang),
          action: { type: 'clear_pending_context' },
        };
      }

      const currency = entities.currency || 'USD';

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30); // 30 days from now

      // P4: route invoice creation through the internal Payments plugin (db_active →
      // PaymentsPluginExecutor → repo). The plugin generates the invoice_number internally
      // (getNextInvoiceNumber) and builds the single line item from amount + description.
      const pluginExecuter = await PluginExecuterV2.getInstance();
      const invoiceResult = await pluginExecuter.execute(context.userId, PAYMENTS_PLUGIN_KEY, 'create_invoice', {
        contact_id: contact.id,
        amount: entities.amount,
        currency,
        description: entities.description || 'Services',
        due_date: dueDate.toISOString(),
      });

      if (!invoiceResult.success) {
        throw new Error(invoiceResult.message || invoiceResult.error || 'Failed to create invoice');
      }

      const invoice = invoiceResult.data as { id: string; invoice_number: string };
      const invoiceNumber = invoice.invoice_number;

      const symbol = currencySymbols[currency] || currency;

      return {
        success: true,
        response: t('invoice.created.success', lang, {
          amount: `${symbol}${entities.amount}`,
          contact: contact.name,
        }),
        data: {
          type: 'invoice_list',
          invoices: [{
            id: invoice.id,
            invoice_number: invoiceNumber,
            amount: entities.amount,
            currency: currency,
            status: 'draft',
            contact_id: contact.id,
          }],
        },
        suggestions: getSuggestionsLocalized(['suggestion.sendInvoice', 'suggestion.viewInvoices'], lang),
        previewContext: 'payments',
        action: { type: 'clear_pending_context' },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create invoice');
      return {
        success: false,
        response: t('error.general', lang),
        suggestions: [],
      };
    }
  }

  // Step 2: Check for missing required fields
  const missingFields = getMissingFields('invoice.create', entities, REQUIRED_FIELDS);
  if (missingFields.length > 0) {
    const missingMessages: string[] = [];
    for (const field of missingFields) {
      if (field === 'contact_name') missingMessages.push(t('invoice.create.needsContact', lang));
      if (field === 'amount') missingMessages.push(t('invoice.create.needsAmount', lang));
    }

    // Build suggestions from existing contacts
    const contactSuggestions = (context.existingContacts || [])
      .slice(0, 3)
      .map(c => c.name);

    return {
      success: true,
      response: t('invoice.create.needsInfo', lang, { missing: missingMessages.join('\n') }),
      suggestions: contactSuggestions.length > 0 ? contactSuggestions : getSuggestionsLocalized(['suggestion.addContact'], lang),
      action: {
        type: 'store_pending_context',
        context: {
          intent: 'invoice.create',
          entities,
          missingFields,
        },
      },
    };
  }

  // Step 3: All required fields present - show confirmation
  const currency = entities.currency || 'USD';
  const symbol = currencySymbols[currency] || currency;

  const previewLines: string[] = [];
  previewLines.push(`${t('label.client', lang)}: <b>${entities.contact_name}</b>`);
  previewLines.push(`${t('label.amount', lang)}: <b>${symbol}${entities.amount}</b>`);
  if (entities.description) {
    previewLines.push(`${t('label.description', lang)}: ${entities.description}`);
  }

  return {
    success: true,
    response: t('invoice.create.confirm', lang, { preview: previewLines.join('\n') }),
    suggestions: [t('confirm.yes', lang), t('confirm.no', lang)],
    action: {
      type: 'await_confirmation',
      context: {
        intent: 'invoice.create',
        entities: { ...entities, _language: lang },
        missingFields: [],
        awaitingConfirmation: true,
      },
    },
  };
}

async function executeInvoiceQuery(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  try {
    const status = entities.status?.toLowerCase();

    let query = supabaseServer
      .from('payment_invoices')
      .select(`
        id, invoice_number, amount, currency, status, due_date, contact_id,
        crm_contacts(first_name, last_name, email)
      `)
      .eq('user_id', context.userId);

    // Handle different query types
    if (status === 'overdue') {
      query = query
        .lt('due_date', new Date().toISOString())
        .in('status', ['sent', 'overdue']);
    } else if (status) {
      query = query.eq('status', status);
    }

    // Filter by contact name if provided
    if (entities.contact_name) {
      // Would need a join - skip for now
    }

    const { data: invoices } = await query
      .order('due_date', { ascending: true })
      .limit(10);

    if (!invoices || invoices.length === 0) {
      if (status === 'overdue') {
        return {
          success: true,
          response: t('invoice.query.noOverdue', lang),
          suggestions: getSuggestionsLocalized(['suggestion.createInvoice', 'suggestion.viewInvoices'], lang),
        };
      }
      return {
        success: true,
        response: t('invoice.query.none', lang),
        suggestions: getSuggestionsLocalized(['suggestion.createInvoice', 'suggestion.viewInvoices'], lang),
      };
    }

    // Format invoices
    const formattedInvoices = invoices.map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      contact_id: inv.contact_id,
    }));

    const responseKey = status === 'overdue' ? 'invoice.query.overdue' : 'invoice.query.found';

    // Build contextual suggestions with contact names from the joined data
    const suggestionContext = status === 'overdue' ? 'invoice_query_overdue' : 'invoice_query';
    const contactsForSuggestions = invoices.map(inv => {
      const contact = inv.crm_contacts as { first_name?: string; last_name?: string; email?: string } | null;
      return {
        first_name: contact?.first_name,
        last_name: contact?.last_name,
        amount: inv.amount,
        currency: inv.currency,
      };
    });

    return {
      success: true,
      response: t(responseKey, lang, { count: String(invoices.length) }),
      data: { type: 'invoice_list', invoices: formattedInvoices },
      suggestions: getContextualSuggestions(suggestionContext, contactsForSuggestions, lang),
      previewContext: 'payments',
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to query invoices');
    return {
      success: true,
      response: t('invoice.query.none', lang),
      route: '/business-os/payments',
      suggestions: getSuggestionsLocalized(['suggestion.openPayments'], lang),
    };
  }
}

async function executePaymentRecord(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  const amount = entities.amount;
  const contactName = entities.contact_name;

  if (!amount || !contactName) {
    return {
      success: false,
      response: t('error.general', lang),
      route: '/business-os/payments',
      suggestions: getSuggestionsLocalized(['suggestion.openPayments'], lang),
    };
  }

  try {
    // Find contact by name
    const { data: contacts } = await crmContactRepository.listBasic(context.userId, {
      search: contactName,
      limit: 1,
    });

    if (!contacts || contacts.length === 0) {
      return {
        success: false,
        response: t('invoice.contactNotFound', lang, { name: contactName }),
        suggestions: getSuggestionsLocalized(['suggestion.addNewContact'], lang),
      };
    }

    const contact = contacts[0];
    const currency = entities.currency || 'USD';
    const method = entities.method || 'other';

    // P4: route payment recording through the internal Payments plugin (db_active →
    // PaymentsPluginExecutor → repo). record_manual_payment is the canonical revenue-bearing
    // path: it sets paid_at (the old rogue insert omitted it) and the T3/T4 triggers own the
    // CRM activity + invoice→paid side-effects.
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const paymentResult = await pluginExecuter.execute(context.userId, PAYMENTS_PLUGIN_KEY, 'record_manual_payment', {
      amount,
      currency,
      payment_method: method,
      contact_id: contact.id,
      invoice_id: entities.invoice_id || undefined,
    });

    if (!paymentResult.success) {
      throw new Error(paymentResult.message || paymentResult.error || 'Failed to record payment');
    }

    // Currency symbol map
    const currencySymbols: Record<string, string> = {
      USD: '$',
      ILS: '₪',
      EUR: '€',
      GBP: '£',
    };
    const symbol = currencySymbols[currency] || currency;

    return {
      success: true,
      response: t('payment.recorded', lang, {
        amount: `${symbol}${amount}`,
        contact: contact.first_name || contact.email || contactName,
      }),
      suggestions: getSuggestionsLocalized(['suggestion.viewInvoices', 'suggestion.createInvoice'], lang),
      previewContext: 'payments',
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to record payment');
    return {
      success: false,
      response: t('error.general', lang),
      route: '/business-os/payments',
      suggestions: getSuggestionsLocalized(['suggestion.openPayments'], lang),
    };
  }
}

// ============================================================================
// Report Operations
// ============================================================================

async function executeReportQuery(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  // Reports are read-only - navigate to reports page
  const metric = entities.metric || 'overview';
  const period = entities.period || 'this_week';

  return {
    success: true,
    response: t('report.query.response', lang, { metric, period: period.replace('_', ' ') }),
    route: `/business-os/reports?metric=${metric}&period=${period}`,
    previewContext: 'reports',
    suggestions: getSuggestionsLocalized(['suggestion.compareWeek', 'suggestion.showRevenue', 'suggestion.showBookings'], lang),
  };
}

async function executeReportCompare(
  entities: Record<string, any>,
  context: ExecutorContext,
  lang: string
): Promise<CommandResult> {
  return {
    success: true,
    response: t('report.compare.response', lang),
    route: '/business-os/reports?view=compare',
    previewContext: 'reports',
    suggestions: getSuggestionsLocalized(['suggestion.monthVsLast', 'suggestion.yearOverYear'], lang),
  };
}

// ============================================================================
// Navigation Operations
// ============================================================================

function executeNavigate(entities: Record<string, any>, lang: string): CommandResult {
  const destination = entities.destination?.toLowerCase();

  const routes: Record<string, string> = {
    people: '/business-os/crm',
    contacts: '/business-os/crm',
    crm: '/business-os/crm',
    pipeline: '/business-os/crm?view=pipeline',
    reports: '/business-os/reports',
    analytics: '/business-os/reports',
    services: '/business-os',
    scheduling: '/business-os',
    calendar: '/business-os',
    payments: '/business-os/payments',
    invoices: '/business-os/payments',
    settings: '/business-os/settings',
    config: '/business-os/settings',
    home: '/business-os',
    dashboard: '/business-os',
  };

  const route = routes[destination] || '/business-os';
  const displayDestination = destination || t('navigate.default', lang);

  return {
    success: true,
    response: t('navigate.response', lang, { destination: displayDestination }),
    route,
  };
}

function executePreviewSwitch(entities: Record<string, any>, lang: string): CommandResult {
  const contextMap: Record<string, PreviewContext> = {
    services: 'services',
    booking: 'services',
    crm: 'crm',
    contacts: 'crm',
    people: 'crm',
    payments: 'payments',
    invoices: 'payments',
    reports: 'reports',
  };

  const context = entities.context?.toLowerCase();
  const previewContext = contextMap[context] || 'services';

  return {
    success: true,
    response: t('preview.response', lang, { context: previewContext }),
    previewContext,
    suggestions: getSuggestionsByContext(previewContext, false, lang),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateConfirmationPrompt(
  intentType: string,
  entities: Record<string, any>,
  lang: string
): string {
  switch (intentType) {
    case 'service.delete':
      return t('confirm.service.delete', lang, { name: entities.service_name || t('fallback.thisService', lang) });
    case 'booking.cancel':
      return t('confirm.booking.cancel', lang, { name: entities.client_name || t('fallback.thisClient', lang) });
    default:
      return t('confirm.default', lang);
  }
}

// ============================================================================
// Multilingual Entity Matching Helpers
// ============================================================================

/**
 * Common Hebrew→English name transliterations
 * Covers ~90% of common Hebrew names
 */
const HEBREW_NAME_TRANSLITERATIONS: Record<string, string[]> = {
  'שרה': ['sara', 'sarah'],
  'דוד': ['david', 'dov'],
  'יוסי': ['yossi', 'yosi', 'joseph'],
  'משה': ['moshe', 'moses'],
  'אברהם': ['avraham', 'abraham', 'avi'],
  'יעקב': ['yaakov', 'jacob', 'yaki'],
  'רחל': ['rachel', 'racheli'],
  'לאה': ['leah', 'lea'],
  'מרים': ['miriam', 'miri'],
  'חנה': ['chana', 'hannah', 'hana'],
  'יצחק': ['yitzhak', 'isaac', 'itzik'],
  'שמעון': ['shimon', 'simon'],
  'דניאל': ['daniel', 'dani'],
  'מיכאל': ['michael', 'mike', 'miki'],
  'יונתן': ['yonatan', 'jonathan', 'yoni'],
  'נועה': ['noa', 'noah'],
  'תמר': ['tamar'],
  'אורי': ['ori', 'uri'],
  'גיל': ['gil'],
  'עומר': ['omer', 'omar'],
  'יואב': ['yoav'],
  'עידן': ['idan'],
  'רון': ['ron'],
  'גל': ['gal'],
  'ליאור': ['lior'],
  'אייל': ['eyal'],
  'נדב': ['nadav'],
  'עמית': ['amit'],
  'שי': ['shai', 'shay'],
  'טל': ['tal'],
  'מאיה': ['maya', 'maia'],
  'ליאת': ['liat'],
  'שירה': ['shira'],
  'הילה': ['hila'],
  'עדי': ['adi'],
  'דנה': ['dana'],
  'מיכל': ['michal'],
  'יעל': ['yael'],
  'אלון': ['alon'],
  'רועי': ['roi', 'roy'],
};

/**
 * Common Hebrew→English service name translations
 */
const SERVICE_TRANSLATIONS: Record<string, string[]> = {
  'תספורת': ['haircut', 'cut'],
  'עיסוי': ['massage'],
  'מניקור': ['manicure'],
  'פדיקור': ['pedicure'],
  'צביעה': ['coloring', 'color', 'dye'],
  'פגישה': ['meeting', 'consultation'],
  'ייעוץ': ['consultation', 'consulting'],
  'טיפול': ['treatment', 'session'],
  'שיעור': ['lesson', 'class'],
  'אימון': ['training', 'workout', 'coaching'],
};

/**
 * Levenshtein distance for fuzzy matching
 * Returns the minimum number of edits needed to transform a into b
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Transliterate a Hebrew name to English
 */
function transliterateName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const matches = HEBREW_NAME_TRANSLITERATIONS[normalized];
  return matches ? matches[0] : name;
}

/**
 * Check if a name is in Hebrew script
 */
function isHebrewText(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text);
}

interface ContactMatch {
  id: string;
  name: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * Find a contact by name with multilingual support
 * Handles: Hebrew→English transliteration, fuzzy matching, partial names
 * Returns: single match, array of candidates for disambiguation, or null
 */
export function findContactByName(
  searchName: string,
  contacts: Array<{ id: string; name: string; first_name?: string; last_name?: string; email?: string }>
): ContactMatch | ContactMatch[] | null {
  if (!searchName || contacts.length === 0) return null;

  const normalizedSearch = searchName.trim().toLowerCase();

  // 1. Exact match (case-insensitive)
  const exactMatch = contacts.find(c => {
    const firstName = (c.first_name || '').toLowerCase();
    const fullName = c.name.toLowerCase();
    return firstName === normalizedSearch || fullName === normalizedSearch;
  });
  if (exactMatch) return exactMatch;

  // 2. If search is Hebrew, try transliteration
  if (isHebrewText(searchName)) {
    const transliterations = HEBREW_NAME_TRANSLITERATIONS[normalizedSearch] || [transliterateName(normalizedSearch)];

    for (const transliterated of transliterations) {
      const translitMatch = contacts.find(c => {
        const firstName = (c.first_name || '').toLowerCase();
        return firstName === transliterated.toLowerCase();
      });
      if (translitMatch) return translitMatch;
    }
  }

  // 3. Fuzzy match (Levenshtein distance ≤ 2)
  const fuzzyMatches = contacts.filter(c => {
    const firstName = (c.first_name || '').toLowerCase();
    const distance = levenshtein(firstName, normalizedSearch);
    return distance <= 2 && distance < firstName.length; // Don't match if too different
  });
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1 && fuzzyMatches.length <= 5) {
    return fuzzyMatches; // Return array for disambiguation
  }

  // 4. Partial match (starts with or contains)
  const partialMatches = contacts.filter(c => {
    const firstName = (c.first_name || '').toLowerCase();
    const fullName = c.name.toLowerCase();
    return firstName.startsWith(normalizedSearch) ||
           normalizedSearch.startsWith(firstName) ||
           fullName.includes(normalizedSearch);
  });
  if (partialMatches.length === 1) return partialMatches[0];
  if (partialMatches.length > 1 && partialMatches.length <= 5) {
    return partialMatches; // Return array for disambiguation
  }

  return null;
}

/**
 * Find a service by name with multilingual support
 * Handles: Hebrew→English translations, fuzzy matching, partial names
 */
export function findServiceByName(
  searchName: string,
  services: ServiceInfo[]
): ServiceInfo | ServiceInfo[] | null {
  if (!searchName || services.length === 0) return null;

  const normalizedSearch = searchName.trim().toLowerCase();

  // 1. Exact match
  const exactMatch = services.find(s =>
    s.name.toLowerCase() === normalizedSearch
  );
  if (exactMatch) return exactMatch;

  // 2. If search is Hebrew, try translation
  if (isHebrewText(searchName)) {
    const translations = SERVICE_TRANSLATIONS[normalizedSearch];
    if (translations) {
      for (const translated of translations) {
        const translatedMatch = services.find(s =>
          s.name.toLowerCase().includes(translated.toLowerCase())
        );
        if (translatedMatch) return translatedMatch;
      }
    }
  }

  // 3. Partial match (service name contains search or vice versa)
  const partialMatches = services.filter(s =>
    s.name.toLowerCase().includes(normalizedSearch) ||
    normalizedSearch.includes(s.name.toLowerCase())
  );
  if (partialMatches.length === 1) return partialMatches[0];
  if (partialMatches.length > 1 && partialMatches.length <= 5) {
    return partialMatches; // Return array for disambiguation
  }

  // 4. Fuzzy match for short service names
  if (normalizedSearch.length >= 3) {
    const fuzzyMatches = services.filter(s => {
      const serviceName = s.name.toLowerCase();
      const distance = levenshtein(serviceName, normalizedSearch);
      return distance <= 2;
    });
    if (fuzzyMatches.length === 1) return fuzzyMatches[0];
    if (fuzzyMatches.length > 1 && fuzzyMatches.length <= 5) {
      return fuzzyMatches;
    }
  }

  return null;
}

/**
 * Get missing required fields for an intent
 */
export function getMissingFields(
  intent: string,
  entities: Record<string, any>,
  requiredFields: Record<string, string[]>
): string[] {
  const required = requiredFields[intent] || [];
  return required.filter(field => {
    const value = entities[field];
    return value === undefined || value === null || value === '';
  });
}

/**
 * Format a full preview of an entity for confirmation
 */
export function formatFullPreview(
  intent: string,
  entities: Record<string, any>,
  lang: string
): string {
  const lines: string[] = [];

  switch (intent) {
    case 'service.create':
      if (entities.service_name) lines.push(`<b>${t('label.name', lang)}:</b> ${entities.service_name}`);
      if (entities.duration_minutes) lines.push(`<b>${t('label.duration', lang)}:</b> ${entities.duration_minutes} ${t('label.minutes', lang)}`);
      if (entities.price !== undefined) {
        const currency = entities.currency || 'USD';
        const symbols: Record<string, string> = { USD: '$', ILS: '₪', EUR: '€', GBP: '£' };
        const symbol = symbols[currency] || currency;
        lines.push(`<b>${t('label.price', lang)}:</b> ${entities.is_free ? t('free', lang) : `${symbol}${entities.price}`}`);
      }
      break;

    case 'contact.add':
      if (entities.first_name) lines.push(`<b>${t('label.name', lang)}:</b> ${entities.first_name}${entities.last_name ? ' ' + entities.last_name : ''}`);
      if (entities.email) lines.push(`<b>${t('label.email', lang)}:</b> ${entities.email}`);
      if (entities.phone) lines.push(`<b>${t('label.phone', lang)}:</b> ${entities.phone}`);
      break;

    case 'booking.create':
      if (entities.contact_name) lines.push(`<b>${t('label.client', lang)}:</b> ${entities.contact_name}`);
      if (entities.service_name) lines.push(`<b>${t('label.service', lang)}:</b> ${entities.service_name}`);
      if (entities.date) lines.push(`<b>${t('label.date', lang)}:</b> ${entities.date}`);
      if (entities.time) lines.push(`<b>${t('label.time', lang)}:</b> ${entities.time}`);
      break;

    case 'invoice.create':
      if (entities.contact_name) lines.push(`<b>${t('label.client', lang)}:</b> ${entities.contact_name}`);
      if (entities.amount !== undefined) {
        const currency = entities.currency || 'USD';
        const symbols: Record<string, string> = { USD: '$', ILS: '₪', EUR: '€', GBP: '£' };
        const symbol = symbols[currency] || currency;
        lines.push(`<b>${t('label.amount', lang)}:</b> ${symbol}${entities.amount}`);
      }
      if (entities.description) lines.push(`<b>${t('label.description', lang)}:</b> ${entities.description}`);
      break;

    case 'task.create':
      if (entities.description) lines.push(`<b>${t('label.task', lang)}:</b> ${entities.description}`);
      if (entities.contact_name) lines.push(`<b>${t('label.relatedTo', lang)}:</b> ${entities.contact_name}`);
      if (entities.due_date) lines.push(`<b>${t('label.due', lang)}:</b> ${entities.due_date}`);
      break;
  }

  return lines.join('<br>');
}
