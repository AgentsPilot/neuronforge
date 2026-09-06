import { mergeCentralContent } from '../mergeCentralContent';

describe('mergeCentralContent', () => {
  it('keeps the block content when nothing has been authored', () => {
    const block = { title: 'צור קשר עם בית הספר הבינלאומי להורות', subtitle: 'נשמח לשמוע ממך' };
    expect(mergeCentralContent(block, null, 'contact')).toEqual(block);
    expect(mergeCentralContent(block, {}, 'contact')).toEqual(block);
  });

  it('lets authored copy win over the block', () => {
    // The whole point of the store: a template swap must not wipe what somebody
    // typed, so a real authored value outranks whatever the block carries.
    const merged = mergeCentralContent(
      { title: 'Generated title' },
      { title: 'The title I actually wrote' },
      'contact'
    );
    expect(merged.title).toBe('The title I actually wrote');
  });

  describe('what must never win', () => {
    it('an unauthored section, now stored as {}', () => {
      // The regression this guards. `website_content` columns used to default to
      // English placeholders, the row was created by a mere page view, and those
      // placeholders then beat generated Hebrew copy on sight.
      const block = { title: 'שאלות נפוצות' };
      expect(mergeCentralContent(block, {}, 'faq').title).toBe('שאלות נפוצות');
    });

    it('empty strings, empty arrays, null and undefined', () => {
      const block = { title: 'שירותים', items: [{ name: 'בדיקה' }] };
      const merged = mergeCentralContent(
        block,
        { title: '', items: [], subtitle: null, layout: undefined },
        'services'
      );
      expect(merged.title).toBe('שירותים');
      expect(merged.items).toEqual([{ name: 'בדיקה' }]);
    });

    it('an empty nested object', () => {
      const block = { cta: { text: 'הזמינו עכשיו' } };
      expect(mergeCentralContent(block, { cta: {} }, 'cta').cta).toEqual({ text: 'הזמינו עכשיו' });
    });
  });

  it('renames about_text to content, the one place the two shapes disagree', () => {
    const merged = mergeCentralContent(
      { content: 'placeholder', title: 'About' },
      { about_text: 'בית הספר הבינלאומי להורות הוא בית ספר אונליין', title: 'אודות' },
      'about'
    );
    expect(merged.content).toBe('בית הספר הבינלאומי להורות הוא בית ספר אונליין');
    expect(merged.about_text).toBeUndefined();
    expect(merged.title).toBe('אודות');
  });

  it('only renames it for the about section', () => {
    const merged = mergeCentralContent({}, { about_text: 'x' }, 'hero');
    expect(merged.about_text).toBe('x');
    expect(merged.content).toBeUndefined();
  });

  it('merges per field, not per section', () => {
    // A business that wrote a headline and nothing else keeps the generated
    // subheadline rather than losing it to a blank.
    const merged = mergeCentralContent(
      { headline: 'generated headline', subheadline: 'generated subheadline' },
      { headline: 'my headline', subheadline: '' },
      'hero'
    );
    expect(merged).toEqual({ headline: 'my headline', subheadline: 'generated subheadline' });
  });

  it('does not mutate either input', () => {
    const block = { title: 'a' };
    const central = { title: 'b' };
    mergeCentralContent(block, central, 'faq');
    expect(block).toEqual({ title: 'a' });
    expect(central).toEqual({ title: 'b' });
  });

  it('survives a missing block content', () => {
    expect(mergeCentralContent(null, { title: 'x' }, 'faq')).toEqual({ title: 'x' });
    expect(mergeCentralContent(undefined, undefined, 'faq')).toEqual({});
  });
});
