import { localizeStageLabel, STAGE_TRANSLATIONS } from '../stageLabels';

describe('[smoke] localizeStageLabel', () => {
  it('translates a stage the user never renamed', () => {
    // Seeded in Hebrew at onboarding, read in English later.
    expect(localizeStageLabel('inquiry', 'פנייה', 'en')).toBe('Inquiry');
    expect(localizeStageLabel('inquiry', 'Inquiry', 'he')).toBe('פנייה');
    expect(localizeStageLabel('in_progress', 'בתהליך', 'es')).toBe('En Progreso');
  });

  it('leaves a label the user wrote themselves alone', () => {
    // A tutor whose family_enrolled stage reads "לקוח" means that word. The
    // seeded Hebrew for that key is "משפחה רשומה", so this is the user's own
    // wording and no language setting may overwrite it.
    expect(localizeStageLabel('family_enrolled', 'לקוח', 'en')).toBe('לקוח');
    expect(localizeStageLabel('family_enrolled', 'לקוח', 'es')).toBe('לקוח');
  });

  it('keeps stages it has never heard of', () => {
    expect(localizeStageLabel('bespoke_stage', 'Waiting on survey', 'he')).toBe('Waiting on survey');
  });

  it('ignores case and stray whitespace when deciding if a label is ours', () => {
    // Labels come back from the database as typed; a trailing space should not
    // make a seeded stage look renamed.
    expect(localizeStageLabel('completed', ' completed ', 'he')).toBe('הושלם');
    expect(localizeStageLabel('completed', 'COMPLETED', 'he')).toBe('הושלם');
  });

  it('falls back to the stored label when that language is missing', () => {
    // Not every entry has to carry all three; a gap must degrade to what is
    // stored rather than to undefined.
    const partial = 'inquiry';
    expect(STAGE_TRANSLATIONS[partial]).toBeDefined();
    expect(localizeStageLabel(partial, 'Inquiry', 'en')).toBe('Inquiry');
  });

  it('retranslates a default we have since reworded', () => {
    /*
     * Every account seeded before "Lead" became "Got in touch" still stores the
     * old string. Without the retired-defaults list those accounts would match
     * nothing seeded, be treated as having renamed the stage themselves, and go
     * on reading "ליד" — the exact word the change was made to remove, left in
     * place for precisely the users it was meant to reach.
     */
    expect(localizeStageLabel('lead', 'ליד', 'he')).toBe('פנו אליך');
    expect(localizeStageLabel('lead', 'Lead', 'en')).toBe('Got in touch');
    expect(localizeStageLabel('lead', 'Prospecto', 'he')).toBe('פנו אליך');
  });

  it('still respects a lead stage the user renamed themselves', () => {
    // The retired list must not become a licence to overwrite anything: only
    // the wordings we ourselves shipped are ours to replace.
    expect(localizeStageLabel('lead', 'מתעניינים', 'en')).toBe('מתעניינים');
  });

  it('is stable when applied twice', () => {
    // The translated output is itself a seeded label, so re-running must not
    // start treating it as a rename.
    const once = localizeStageLabel('inquiry', 'פנייה', 'en');
    expect(localizeStageLabel('inquiry', once, 'en')).toBe(once);
    expect(localizeStageLabel('inquiry', once, 'he')).toBe('פנייה');
  });
});
