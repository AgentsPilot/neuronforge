/**
 * Choosing a website template for a business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING CHOSE ONE. The wizard pre-selected `templates[0]` — whichever
 * template happened to be first in the array for the business's vertical — and
 * that was the choice, because a pre-selection nobody changes IS the decision.
 *
 * Two real matchers already existed and neither was reachable:
 * `WebsiteAutoBuildService.selectTemplate` (imported only by a test script) and
 * `findTemplateByKeywords` (never called at all).
 *
 * THE PART BOTH OF THEM GOT WRONG: they searched only within
 * `getTemplatesByVertical(vertical)`. That cannot work, because the vertical is
 * a coarse label assigned by an LLM and then flattened again by
 * VERTICAL_NORMALIZATION. A parenting school is extracted as `teacher`,
 * normalised to `tutor`, and the `tutor` vertical holds exactly
 * `tutor_academic` / `tutor_test_prep` / `tutor_language` — three flavours of
 * academic tutoring, none of which is a parenting school. Re-ranking those
 * three differently produces another wrong answer.
 *
 * The sub-vertical is the more specific and more reliable signal, and it is
 * already stored (`business_profiles.sub_vertical`, e.g. `parenting_coach`). So
 * it is allowed to move the search to a different vertical entirely before any
 * scoring happens.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  WEBSITE_TEMPLATES,
  getTemplatesByVertical,
  type WebsiteTemplate,
} from '@/lib/website-builder/templates';

/**
 * Sub-verticals whose templates live under a different vertical.
 *
 * Keys are the values the onboarding prompt can actually emit — see the
 * `sub_vertical` list in `OnboardingConversationManager`'s business-story
 * prompt. Only entries that genuinely cross a boundary belong here; a
 * sub-vertical already served by its own vertical needs no line.
 */
const SUB_VERTICAL_VERTICAL: Record<string, string> = {
  // Coaching, however the business was first labelled. A parenting school is
  // extracted as `teacher` and normalised to `tutor`, which has no template for
  // it — this is the case that exposed the bug.
  parenting_coach: 'coach',
  life_coach: 'coach',
  business_coach: 'coach',
  career_coach: 'coach',
  executive_coach: 'coach',
  workshop_leader: 'coach',
  course_creator: 'coach',
  // A health coach is closer to a trainer's templates than a tutor's.
  health_coach: 'trainer',
  // Therapy sub-types stay with therapist; named so the map reads as the whole
  // answer rather than a list of exceptions somebody has to guess at.
  psychologist: 'therapist',
  counselor: 'therapist',
  family_therapist: 'therapist',
  couples_therapist: 'therapist',
  child_therapist: 'therapist',
};

export interface TemplateSelectionInput {
  vertical?: string | null;
  sub_vertical?: string | null;
  /** The business's own words. Scored against template keywords. */
  description?: string | null;
  /** Preferred tone, where one is known. Used only to break a tie. */
  brand_voice?: WebsiteTemplate['theme']['brand_voice'] | null;
}

export interface TemplateSelection {
  template: WebsiteTemplate;
  /** The pool the choice was made from, best first. */
  candidates: WebsiteTemplate[];
  /** Why this one. Logged, so a bad match can be explained rather than guessed at. */
  reason:
    | 'sub_vertical_keywords'
    | 'description_keywords'
    | 'brand_voice'
    | 'vertical_default'
    | 'no_match';
}

/** Words worth scoring on: lowercase, de-punctuated, short ones dropped. */
function tokenize(...parts: (string | null | undefined)[]): string[] {
  return parts
    .filter((p): p is string => Boolean(p))
    .flatMap(p => p.toLowerCase().split(/[^\p{L}\p{N}]+/u))
    .filter(word => word.length > 2);
}

function scoreAgainstKeywords(template: WebsiteTemplate, words: string[]): number {
  const keywords = (template.keywords || []).map(k => k.toLowerCase());
  if (keywords.length === 0 || words.length === 0) return 0;
  return words.filter(word => keywords.some(k => k.includes(word) || word.includes(k))).length;
}

/**
 * The candidate pool: the sub-vertical's vertical if it names one, else the
 * business's own. Falls back to every template rather than none.
 */
export function candidatePoolFor(
  vertical?: string | null,
  subVertical?: string | null
): { pool: WebsiteTemplate[]; poolVertical: string | null } {
  const override = subVertical ? SUB_VERTICAL_VERTICAL[subVertical.toLowerCase()] : undefined;
  const target = override ?? (vertical || undefined);

  if (target) {
    const scoped = getTemplatesByVertical(target);
    if (scoped.length > 0) return { pool: scoped, poolVertical: target };
  }

  // No vertical, or one with no templates — `doctor`, `dentist`, `other`, or
  // anything the model invented. Everything is a worse pool than a matched one,
  // but it is a far better pool than nothing.
  return { pool: WEBSITE_TEMPLATES, poolVertical: null };
}

/**
 * The best template for this business, and the pool ordered best-first so a
 * chooser can show the recommendation alongside its runners-up.
 */
export function selectTemplateForBusiness(input: TemplateSelectionInput): TemplateSelection {
  const { pool } = candidatePoolFor(input.vertical, input.sub_vertical);

  const subVerticalWords = tokenize(input.sub_vertical);
  const descriptionWords = tokenize(input.description);

  const scored = pool.map(template => {
    // The sub-vertical is the sharper signal, so it is weighted above prose the
    // business happened to write.
    const subScore = scoreAgainstKeywords(template, subVerticalWords) * 3;
    const descScore = scoreAgainstKeywords(template, descriptionWords);
    const voiceScore =
      input.brand_voice && template.theme.brand_voice === input.brand_voice ? 1 : 0;
    return { template, subScore, descScore, voiceScore, total: subScore + descScore + voiceScore };
  });

  // Stable: equal scores keep the declared order, so the choice is repeatable.
  const ordered = [...scored].sort((a, b) => b.total - a.total);
  const best = ordered[0];
  const candidates = ordered.map(entry => entry.template);

  if (!best || best.total === 0) {
    return {
      template: pool[0],
      candidates,
      reason: pool.length === WEBSITE_TEMPLATES.length ? 'no_match' : 'vertical_default',
    };
  }

  const reason: TemplateSelection['reason'] =
    best.subScore > 0 ? 'sub_vertical_keywords'
      : best.descScore > 0 ? 'description_keywords'
        : 'brand_voice';

  return { template: best.template, candidates, reason };
}
