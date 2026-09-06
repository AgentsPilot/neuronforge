import { selectTemplateForBusiness, candidatePoolFor } from '../selectTemplate';
import { WEBSITE_TEMPLATES, getTemplatesByVertical } from '../templates';

describe('candidatePoolFor', () => {
  it('lets the sub-vertical move the search to another vertical', () => {
    // The case this exists for. A parenting school is extracted as `teacher`,
    // normalised to `tutor`, and the tutor vertical is three flavours of
    // academic tutoring — none of them a parenting school. Re-ranking within it
    // can only produce a different wrong answer.
    const { poolVertical } = candidatePoolFor('tutor', 'parenting_coach');
    expect(poolVertical).toBe('coach');
  });

  it('uses the business vertical when the sub-vertical names no other', () => {
    expect(candidatePoolFor('therapist', 'psychologist').poolVertical).toBe('therapist');
    expect(candidatePoolFor('beauty', null).poolVertical).toBe('beauty');
  });

  it('falls back to every template rather than none', () => {
    // `doctor`, `dentist`, `other` and anything the model invents have no
    // templates. A bad pool beats an empty one.
    const { pool, poolVertical } = candidatePoolFor('dentist', null);
    expect(poolVertical).toBeNull();
    expect(pool).toHaveLength(WEBSITE_TEMPLATES.length);
  });

  it('falls back when nothing is known at all', () => {
    expect(candidatePoolFor(null, null).pool).toHaveLength(WEBSITE_TEMPLATES.length);
  });
});

describe('selectTemplateForBusiness', () => {
  it('gives a parenting school a coaching template, not academic tutoring', () => {
    // The reported bug, verbatim from the account it was found on.
    const { template, reason } = selectTemplateForBusiness({
      vertical: 'tutor',
      sub_vertical: 'parenting_coach',
      description: 'בית הספר הבינלאומי להורות — הדרכת הורים',
    });
    expect(template.id).not.toBe('tutor_academic');
    expect(template.vertical).toBe('coach');
    expect(reason).toBe('sub_vertical_keywords');
  });

  it('keeps a real academic tutor on a tutor template', () => {
    // The override must not drag every teaching business out of its vertical.
    const { template } = selectTemplateForBusiness({
      vertical: 'tutor',
      sub_vertical: 'tutor',
      description: 'Maths and physics tuition for high-school students',
    });
    expect(template.vertical).toBe('tutor');
  });

  it('weighs the sub-vertical above prose', () => {
    // A description mentioning "career" must not pull an executive coach away
    // from the executive templates.
    const { template } = selectTemplateForBusiness({
      vertical: 'coach',
      sub_vertical: 'executive_coach',
      description: 'I help people through career change',
    });
    expect(template.id).toContain('executive');
  });

  it('uses the description when there is no sub-vertical', () => {
    const { template, reason } = selectTemplateForBusiness({
      vertical: 'therapist',
      sub_vertical: null,
      description: 'Trauma and PTSD recovery, EMDR certified',
    });
    expect(reason).toBe('description_keywords');
    expect(template.id).toContain('trauma');
  });

  it('breaks a tie on brand voice', () => {
    const { template, reason } = selectTemplateForBusiness({
      vertical: 'photographer',
      sub_vertical: null,
      description: null,
      brand_voice: 'bold',
    });
    expect(reason).toBe('brand_voice');
    expect(template.theme.brand_voice).toBe('bold');
  });

  it('reports honestly when it matched nothing', () => {
    const { reason, template } = selectTemplateForBusiness({
      vertical: 'therapist',
      sub_vertical: null,
      description: null,
    });
    // Still returns something usable — it just does not pretend it was a match.
    expect(reason).toBe('vertical_default');
    expect(getTemplatesByVertical('therapist')).toContainEqual(template);
  });

  it('returns the pool ordered best-first, so a chooser can show runners-up', () => {
    const { template, candidates } = selectTemplateForBusiness({
      vertical: 'tutor',
      sub_vertical: 'parenting_coach',
    });
    expect(candidates[0]).toBe(template);
    expect(candidates).toHaveLength(getTemplatesByVertical('coach').length);
  });

  it('is repeatable — the same business always gets the same template', () => {
    const input = { vertical: 'trainer', sub_vertical: 'health_coach', description: 'fitness' };
    const first = selectTemplateForBusiness(input).template.id;
    for (let i = 0; i < 5; i++) {
      expect(selectTemplateForBusiness(input).template.id).toBe(first);
    }
  });

  it('never returns undefined for any vertical the roster declares', () => {
    for (const vertical of new Set(WEBSITE_TEMPLATES.map(t => t.vertical))) {
      expect(selectTemplateForBusiness({ vertical }).template).toBeDefined();
    }
  });
});
