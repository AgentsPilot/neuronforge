/**
 * What businesses of a given kind normally need to know after someone books.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTERNAL. This is never shown to a business owner.
 *
 * The thing it replaces was a template LIBRARY — eleven rows the owner picked
 * from — and the whole point of replacing it is that choosing a template is
 * configuration work handed to someone who did not ask for it. This knowledge
 * feeds the generator instead. The owner sees the questions, never the source.
 *
 * It is also deliberately not one entry per vertical. There are twenty-eight
 * verticals and no realistic prospect of writing twenty-eight careful entries
 * that stay true; the previous attempt covered six and let the other twenty-two
 * fall through to four generic shapes. So: a small number of entries where the
 * vertical genuinely changes what should be asked, `DEFAULT_KNOWLEDGE` for the
 * rest, and the business's own description doing the personalisation. Two
 * photographers shooting weddings and corporate headshots get different forms
 * because their descriptions and services differ, not because the table has a
 * row for each.
 *
 * WHAT `neverAsk` IS FOR
 *
 * Some verticals are regulated, and the platform running a booking is not the
 * system of record for anyone's clinical or legal file. A therapist's intake
 * here is administrative — has the paperwork been done, how do we reach you —
 * and their specialised system keeps the rest. Asking a client about their
 * symptoms through a booking tool creates a record in the wrong place, under
 * the wrong protections, with the wrong retention.
 *
 * `neverAsk` goes into the prompt AND is enforced afterwards by
 * `stripForbiddenQuestions`. A prompt instruction is guidance; a filter is a
 * guarantee, and only one of those is worth relying on for this.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/intake/verticalKnowledge
 */

import type { IntakeQuestion } from './types';

export interface VerticalIntakeKnowledge {
  /** What this kind of business tends to need before delivering. */
  concepts: string[];
  /** Concrete question ideas, as guidance rather than as a script. */
  typicalQuestions: string[];
  /** Practicalities — access, location, materials, who is attending. */
  operationalNeeds: string[];
  /**
   * Subjects that must never appear, whatever the description suggests.
   *
   * Plain words rather than a regex vocabulary: these are matched against the
   * generated labels case-insensitively, and they read as a policy a person can
   * check, which matters more here than matching precision.
   */
  neverAsk: string[];
  /**
   * A sentence the model may use instead of the forbidden subject — pointing
   * at the business's own system rather than collecting it here.
   */
  deferTo?: string;
}

const DEFAULT_KNOWLEDGE: VerticalIntakeKnowledge = {
  concepts: [
    'what the client wants out of this',
    'anything the business must prepare or bring',
    'practical arrangements — where, who, how long',
  ],
  typicalQuestions: [
    'What would you like to get out of this?',
    'Is there anything we should know before we start?',
  ],
  operationalNeeds: ['location or access', 'who else will be involved'],
  neverAsk: [],
};

/**
 * Only the verticals where the answer genuinely differs, or where the law does.
 *
 * Adding a row is worth it when a generic form would be actively wrong for that
 * trade. It is not worth it to be thorough — an entry nobody maintains is worse
 * than the default, because it looks authoritative.
 */
const KNOWLEDGE: Record<string, VerticalIntakeKnowledge> = {
  therapist: {
    concepts: [
      'administrative readiness for the first session',
      'how to reach the client and who may be contacted',
      'whether required paperwork has been completed elsewhere',
    ],
    typicalQuestions: [
      'Have you completed the intake paperwork we sent separately?',
      'Is there anything practical we should know before your first session?',
      'How would you prefer we contact you about appointments?',
    ],
    operationalNeeds: ['session format — in person or online', 'preferred contact method'],
    /*
     * The clinical record belongs in the practitioner's own system, under its
     * own protections. This is a booking tool; a symptom collected here is a
     * health record created by accident.
     */
    neverAsk: [
      'diagnosis',
      'symptom',
      'symptoms',
      'medication',
      'medications',
      'medical history',
      'mental health history',
      'psychiatric',
      'suicid',
      'self-harm',
      'self harm',
      'trauma',
      'abuse',
      'therapy history',
      'treatment plan',
      'clinical',
      'אבחנה',
      'תסמינים',
      'תרופות',
      'היסטוריה רפואית',
      'טראומה',
      'אובדנ',
    ],
    deferTo:
      'Ask only whether the required paperwork has been completed, and provide a link to the practice’s own system. Never collect clinical detail here.',
  },

  doctor: {
    concepts: ['administrative readiness', 'reaching the patient', 'referral and paperwork status'],
    typicalQuestions: [
      'Do you have a referral for this appointment?',
      'Have you completed the forms we sent you?',
    ],
    operationalNeeds: ['appointment format', 'preferred contact method'],
    neverAsk: [
      'diagnosis',
      'symptom',
      'symptoms',
      'medication',
      'medications',
      'medical history',
      'condition',
      'allergy',
      'allergies',
      'test result',
      'אבחנה',
      'תסמינים',
      'תרופות',
      'היסטוריה רפואית',
    ],
    deferTo:
      'Clinical detail belongs in the practice’s medical system. Ask only about paperwork, referrals and logistics.',
  },

  dentist: {
    concepts: ['administrative readiness', 'insurance and paperwork', 'reaching the patient'],
    typicalQuestions: ['Have you completed the forms we sent you?', 'Is this a first visit with us?'],
    operationalNeeds: ['appointment format', 'preferred contact method'],
    neverAsk: [
      'diagnosis',
      'symptom',
      'symptoms',
      'medication',
      'medications',
      'medical history',
      'dental history',
      'allergy',
      'allergies',
      'אבחנה',
      'תסמינים',
      'תרופות',
    ],
    deferTo: 'Clinical detail belongs in the practice’s own system.',
  },

  lawyer: {
    concepts: [
      'the nature of the matter, in the client’s own words',
      'deadlines and urgency',
      'documents the client already holds',
      'who else is involved, for conflict checking',
    ],
    typicalQuestions: [
      'Briefly, what is the matter about?',
      'Is there a deadline or court date we should know about?',
      'Which other parties are involved?',
      'Do you have documents relating to this? You can upload them here.',
    ],
    operationalNeeds: ['documents', 'deadlines', 'other parties involved'],
    /*
     * A booking tool is not privileged. Enough to prepare and to check for
     * conflicts; the case file itself is built in the practice's own system.
     */
    neverAsk: ['confession', 'admission of guilt', 'privileged'],
    deferTo: 'Collect enough to prepare and to run a conflict check, not the case file itself.',
  },

  photographer: {
    concepts: [
      'where and when the shoot happens',
      'who and how many people are in it',
      'the look the client is after',
      'shots that must not be missed',
    ],
    typicalQuestions: [
      'Where will the session take place?',
      'How many people will be photographed?',
      'What style are you looking for?',
      'Are there particular shots or groups that matter most to you?',
      'Upload any inspiration images.',
    ],
    operationalNeeds: ['location and access', 'headcount', 'schedule on the day', 'parking'],
    neverAsk: [],
  },

  trainer: {
    concepts: ['what the client wants to achieve', 'experience level', 'practical constraints'],
    typicalQuestions: [
      'What are you hoping to achieve?',
      'How much experience do you have with this?',
      'Is there anything that limits what you can do?',
    ],
    operationalNeeds: ['equipment access', 'preferred times'],
    /*
     * "Anything that limits what you can do" is a practical question a trainer
     * needs. A list of injuries and medications is a health record.
     */
    neverAsk: ['diagnosis', 'medication', 'medications', 'medical history', 'תרופות', 'אבחנה'],
  },

  consultant: {
    concepts: [
      'the company and what it does',
      'the problem being solved',
      'what success looks like',
      'material to read beforehand',
    ],
    typicalQuestions: [
      'What does your company do?',
      'What are you hoping to solve?',
      'What would a good outcome look like?',
      'Is there anything we should read before we meet?',
    ],
    operationalNeeds: ['company size', 'decision makers attending', 'preparation materials'],
    neverAsk: [],
  },

  tutor: {
    concepts: [
      'who the learner is',
      'where they are now and where they want to be',
      'what has been tried already',
      'materials the tutor should have',
    ],
    typicalQuestions: [
      'Who is the session for?',
      'What would you like to work on?',
      'What has been tried so far?',
      'Are there materials we should look at?',
    ],
    operationalNeeds: ['session format', 'materials', 'who attends'],
    neverAsk: ['diagnosis', 'medication', 'אבחנה', 'תרופות'],
  },

  realtor: {
    concepts: ['the property', 'the client’s timeline', 'budget and financing readiness'],
    typicalQuestions: [
      'Which property is this about?',
      'What is your timeline?',
      'Upload any documents relating to the property.',
    ],
    operationalNeeds: ['property address', 'access arrangements', 'timeline'],
    neverAsk: ['credit score', 'bank balance', 'social security'],
  },
};

/**
 * Aliases onto the entries above.
 *
 * The vertical list has twenty-eight names and several are the same trade under
 * different words. Mapping them is cheaper and more honest than writing near
 * duplicate entries that will drift apart the first time one is edited.
 */
const ALIASES: Record<string, string> = {
  psychologist: 'therapist',
  psychotherapist: 'therapist',
  counselor: 'therapist',
  counsellor: 'therapist',
  teacher: 'tutor',
  educator: 'tutor',
  instructor: 'trainer',
  fitness: 'trainer',
  coach: 'consultant',
  accountant: 'consultant',
  designer: 'consultant',
  photography: 'photographer',
  makeup: 'beauty',
  makeup_artist: 'beauty',
  esthetician: 'beauty',
  nail_tech: 'beauty',
  hairdresser: 'beauty',
  hairstylist: 'beauty',
  barber: 'beauty',
  spa: 'wellness',
};

export function intakeKnowledgeFor(
  vertical: string | null | undefined
): VerticalIntakeKnowledge {
  if (!vertical) return DEFAULT_KNOWLEDGE;

  const key = vertical.toLowerCase().trim();
  return KNOWLEDGE[key] ?? KNOWLEDGE[ALIASES[key] ?? ''] ?? DEFAULT_KNOWLEDGE;
}

/** Is this a trade where the platform must hold back? Drives the safety notice. */
export function isRestrictedVertical(vertical: string | null | undefined): boolean {
  return intakeKnowledgeFor(vertical).neverAsk.length > 0;
}

/**
 * Remove anything the vertical forbids, whatever the model was told.
 *
 * The prompt already says not to ask these. This runs anyway, because the
 * difference between "we asked it not to" and "it cannot" is the difference
 * between a policy and a guarantee — and the cost of being wrong is a health
 * record collected by a booking tool.
 *
 * Matches the label and the help text, case-insensitively, in any language the
 * knowledge lists terms for. Blunt on purpose: a false positive costs one
 * question the owner can add back in their own words, and a false negative
 * costs a client answering something nobody should have asked.
 */
export function stripForbiddenQuestions(
  questions: IntakeQuestion[],
  vertical: string | null | undefined
): { kept: IntakeQuestion[]; removed: IntakeQuestion[] } {
  const forbidden = intakeKnowledgeFor(vertical).neverAsk;
  if (forbidden.length === 0) return { kept: questions, removed: [] };

  const kept: IntakeQuestion[] = [];
  const removed: IntakeQuestion[] = [];

  for (const question of questions) {
    const haystack = `${question.label} ${question.help ?? ''} ${(question.options ?? [])
      .map(option => option.label)
      .join(' ')}`.toLowerCase();

    if (forbidden.some(term => haystack.includes(term.toLowerCase()))) {
      removed.push(question);
    } else {
      kept.push(question);
    }
  }

  /*
   * A question conditional on one that was just removed can never be shown, and
   * leaving it would put an unreachable question in front of the owner to
   * wonder about. Its parent's answer no longer exists.
   */
  const keptIds = new Set(kept.map(question => question.id));
  const reachable = kept.filter(question => !question.showIf || keptIds.has(question.showIf.questionId));
  const orphaned = kept.filter(question => question.showIf && !keptIds.has(question.showIf.questionId));

  return { kept: reachable, removed: [...removed, ...orphaned] };
}
