/**
 * Default pipeline stage labels, per language.
 *
 * Stage labels live in `crm_pipeline_stages.stage_label` as a single string,
 * written in whatever language the user was using at onboarding. Switching the
 * interface language afterwards can't retranslate them — a Hebrew account's
 * pipeline stayed Hebrew in the English and Spanish UI.
 *
 * This table is the same one onboarding seeds from, moved here so the interface
 * can also read it. It is imported by a client component, so it must stay free
 * of server-only imports.
 */

export type StageLanguage = 'en' | 'es' | 'he';

export const STAGE_TRANSLATIONS: Record<string, Partial<Record<StageLanguage, string>>> = {
  // Common stages
  inquiry: { en: 'Inquiry', he: 'פנייה', es: 'Consulta' },
  lead: { en: 'Lead', he: 'ליד', es: 'Prospecto' },
  qualified: { en: 'Qualified', he: 'מתאים', es: 'Calificado' },
  intake: { en: 'Intake', he: 'קליטה', es: 'Admisión' },
  consultation: { en: 'Consultation', he: 'ייעוץ', es: 'Consulta' },
  discovery_call: { en: 'Discovery Call', he: 'שיחת היכרות', es: 'Llamada de Descubrimiento' },
  proposal: { en: 'Proposal', he: 'הצעה', es: 'Propuesta' },
  negotiation: { en: 'Negotiation', he: 'משא ומתן', es: 'Negociación' },
  active_client: { en: 'Active Client', he: 'לקוח פעיל', es: 'Cliente Activo' },
  active_project: { en: 'Active Project', he: 'פרויקט פעיל', es: 'Proyecto Activo' },
  active_case: { en: 'Active Case', he: 'תיק פעיל', es: 'Caso Activo' },
  active_student: { en: 'Active Student', he: 'תלמיד פעיל', es: 'Estudiante Activo' },
  enrolled: { en: 'Enrolled', he: 'רשום', es: 'Inscrito' },
  retained: { en: 'Retained', he: 'משתמר', es: 'Retenido' },
  completed: { en: 'Completed', he: 'הושלם', es: 'Completado' },
  closed: { en: 'Closed', he: 'סגור', es: 'Cerrado' },
  inactive: { en: 'Inactive', he: 'לא פעיל', es: 'Inactivo' },
  churned: { en: 'Churned', he: 'עזב', es: 'Cancelado' },
  first_session: { en: 'First Session', he: 'פגישה ראשונה', es: 'Primera Sesión' },
  regular_client: { en: 'Regular Client', he: 'לקוח קבוע', es: 'Cliente Regular' },
  new_client: { en: 'New Client', he: 'לקוח חדש', es: 'Cliente Nuevo' },
  regular: { en: 'Regular', he: 'קבוע', es: 'Regular' },
  vip: { en: 'VIP', he: 'VIP', es: 'VIP' },
  trial: { en: 'Trial', he: 'ניסיון', es: 'Prueba' },
  member: { en: 'Member', he: 'חבר', es: 'Miembro' },
  premium: { en: 'Premium', he: 'פרימיום', es: 'Premium' },
  customer: { en: 'Customer', he: 'לקוח', es: 'Cliente' },
  // Sub-vertical specific stages
  initial_consultation: { en: 'Initial Consultation', he: 'ייעוץ ראשוני', es: 'Consulta Inicial' },
  family_enrolled: { en: 'Family Enrolled', he: 'משפחה רשומה', es: 'Familia Inscrita' },
  in_progress: { en: 'In Progress', he: 'בתהליך', es: 'En Progreso' },
  active_engagement: { en: 'Active Engagement', he: 'התקשרות פעילה', es: 'Compromiso Activo' },
  assessment: { en: 'Assessment', he: 'הערכה', es: 'Evaluación' },
  interested: { en: 'Interested', he: 'מעוניין', es: 'Interesado' },
  registered: { en: 'Registered', he: 'רשום', es: 'Registrado' },
  attended: { en: 'Attended', he: 'השתתף', es: 'Asistió' },
  follow_up: { en: 'Follow Up', he: 'מעקב', es: 'Seguimiento' },
};

/**
 * The label to show for a stage in the current language.
 *
 * Only translates labels the user has not touched: if the stored label still
 * matches one of the seeded translations for that key, it came from us and can
 * be replaced. Anything else is the user's own wording — a tutor whose
 * `family_enrolled` stage reads "לקוח" means that word, and no language setting
 * should overwrite it.
 */
export function localizeStageLabel(
  stageKey: string,
  storedLabel: string,
  language: StageLanguage
): string {
  const seeded = STAGE_TRANSLATIONS[stageKey];
  if (!seeded) return storedLabel;

  const isUntouched = Object.values(seeded).some(
    label => label.toLowerCase() === storedLabel.trim().toLowerCase()
  );
  if (!isUntouched) return storedLabel;

  return seeded[language] || storedLabel;
}
