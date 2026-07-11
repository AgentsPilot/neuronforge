import {
  assessItemsDataQuality,
  isMeaningfulItem,
  isMeaningfulValue,
} from '../dataQuality';

describe('isMeaningfulValue', () => {
  it('treats empty/whitespace/fallback strings as NOT meaningful', () => {
    expect(isMeaningfulValue('')).toBe(false);
    expect(isMeaningfulValue('   ')).toBe(false);
    expect(isMeaningfulValue('Unknown')).toBe(false);
    expect(isMeaningfulValue('N/A')).toBe(false);
    expect(isMeaningfulValue('__EXTRACTION_FAILED__')).toBe(false);
  });
  it('treats real strings/numbers/booleans as meaningful', () => {
    expect(isMeaningfulValue('Acme Corp')).toBe(true);
    expect(isMeaningfulValue(42)).toBe(true);
    expect(isMeaningfulValue(false)).toBe(true);
  });
  it('ignores NaN', () => {
    expect(isMeaningfulValue(NaN)).toBe(false);
  });
});

describe('isMeaningfulItem', () => {
  it('an all-blank row is not meaningful', () => {
    expect(isMeaningfulItem({ amount: '', vendor: 'Unknown', date: null })).toBe(false);
  });
  it('a row with any real field is meaningful', () => {
    expect(isMeaningfulItem({ amount: '', vendor: 'Acme', date: null })).toBe(true);
  });
  it('ignores meta (_prefixed) keys when judging meaning', () => {
    expect(isMeaningfulItem({ _parentData: { from: 'x@y.com' }, amount: '' })).toBe(false);
  });
});

describe('assessItemsDataQuality', () => {
  it('flags a 13-row all-blank report as allBlank (the RCA re-run case)', () => {
    const rows = Array.from({ length: 13 }, () => ({ amount: '', vendor: 'Unknown', date: '', from: '', subject: '' }));
    const q = assessItemsDataQuality(rows);
    expect(q.assessed).toBe(true);
    expect(q.itemCount).toBe(13);
    expect(q.meaningfulItemCount).toBe(0);
    expect(q.allBlank).toBe(true);
  });
  it('does not flag a populated report', () => {
    const rows = [{ amount: '42.00', vendor: 'Acme', date: '2026-03-01' }, { amount: '', vendor: 'Unknown' }];
    const q = assessItemsDataQuality(rows);
    expect(q.allBlank).toBe(false);
    expect(q.meaningfulItemCount).toBe(1);
  });
  it('unwraps { items: [...] } / { rows: [...] } shapes', () => {
    expect(assessItemsDataQuality({ rows: [{ v: 'x' }] }).meaningfulItemCount).toBe(1);
  });
  it('returns un-assessed (not allBlank) for non-array / empty input', () => {
    expect(assessItemsDataQuality(null).assessed).toBe(false);
    expect(assessItemsDataQuality([]).assessed).toBe(false);
    expect(assessItemsDataQuality('a string').assessed).toBe(false);
    // Critically: an un-inspectable input must NOT be reported as allBlank.
    expect(assessItemsDataQuality(null).allBlank).toBe(false);
  });
});
