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

/**
 * Defaults we have replaced, kept only so they are still RECOGNISED.
 *
 * `localizeStageLabel` decides whether a stored label is ours to retranslate by
 * matching it against the seeded wordings. The moment a default is reworded,
 * every account still holding the old string stops matching and its label is
 * treated as the owner's own — so a word we retired would live on forever in
 * exactly the accounts we changed it for. Listing the retired wording here
 * keeps the match working while the table above decides what is shown.
 */
const RETIRED_DEFAULTS: Record<string, string[]> = {
  lead: ['Lead', 'ליד', 'Prospecto'],
};

export const STAGE_TRANSLATIONS: Record<string, Partial<Record<StageLanguage, string>>> = {
  // Common stages
  inquiry: { en: 'Inquiry', he: 'פנייה', es: 'Consulta' },
  /*
   * "Lead" is the only word on this board that belongs to the CRM rather than
   * to the business. Every other stage names something the owner recognises —
   * a consultation, a proposal, an active client — but nobody running a studio
   * or a clinic describes a person who called them as a ליד.
   *
   * Phrased as what happened rather than as what the person now IS, which is
   * also what lets one wording serve every trade: a trainer, a dentist and a
   * photographer all have people who got in touch, and none of them needs a
   * different noun for it.
   */
  lead: { en: 'Got in touch', he: 'פנו אליך', es: 'Te contactaron' },
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
  language: StageLanguage,
  /**
   * The stage's TYPE, when the caller knows it.
   *
   * The last resort, and the only one that works for a stage this table has
   * never heard of. Onboarding writes a pipeline per business, so keys like
   * `family_enrolled` are invented per account and can never be listed here —
   * but their type is always one of four, and "Client" is a true and readable
   * name for a stage typed `client`, in any language.
   */
  stageType?: string | null
): string {
  const seeded = STAGE_TRANSLATIONS[stageKey];

  if (seeded) {
    // Retired wordings count as ours too — see RETIRED_DEFAULTS.
    const ourWordings = [...Object.values(seeded), ...(RETIRED_DEFAULTS[stageKey] ?? [])];
    const isUntouched = ourWordings.some(
      label => label.toLowerCase() === storedLabel.trim().toLowerCase()
    );
    if (isUntouched) return seeded[language] || storedLabel;
  }

  /*
   * The owner's own wording, unless it is in a script the reader cannot read.
   *
   * Keeping a custom label is deliberate: a tutor whose `family_enrolled` stage
   * reads "לקוח" means that word. But the same word in an English interface is
   * not a preserved intent, it is an untranslated string — the business owner
   * browsing in English sees Hebrew on their own board.
   *
   * So the label stands whenever its script matches the reader's, and falls
   * back to the stage's type name when it plainly does not.
   */
  if (stageType && !scriptMatchesLanguage(storedLabel, language)) {
    const typeName = STAGE_TYPE_NAMES[stageType];
    if (typeName) return typeName[language] || storedLabel;
  }

  return storedLabel;
}

/** The four types, named. Every pipeline is built from these, whatever it calls them. */
const STAGE_TYPE_NAMES: Record<string, Partial<Record<StageLanguage, string>>> = {
  // Same reasoning as the `lead` stage above: what happened, not what they are.
  lead: { en: 'Got in touch', he: 'פנו אליך', es: 'Te contactaron' },
  prospect: { en: 'Prospect', he: 'בתהליך', es: 'Posible cliente' },
  client: { en: 'Client', he: 'לקוח', es: 'Cliente' },
  past_client: { en: 'Past client', he: 'לקוח בעבר', es: 'Excliente' },
};

/**
 * Is this label written in a script the reader of `language` can read?
 *
 * Hebrew is the case that matters and the one that is decidable: its block is
 * distinct, so a Hebrew label in an English interface is detectable and an
 * English label in a Hebrew one equally so. English and Spanish share the Latin
 * alphabet and are deliberately NOT told apart — guessing between them from
 * characters alone would be wrong more often than it was right, and a Spanish
 * label in an English UI is at least readable.
 */
function scriptMatchesLanguage(label: string, language: StageLanguage): boolean {
  const hasHebrew = /[\u0590-\u05FF]/.test(label);
  return language === 'he' ? hasHebrew : !hasHebrew;
}
