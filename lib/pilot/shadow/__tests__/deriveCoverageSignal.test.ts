import {
  deriveCoverageSignal,
  assessColumnFillRates,
  looksLikeExecutedSend,
} from '../dataQuality';
import { computeVerdict, isWaveable } from '../CalibrationVerdict';

// ── The three-case triad (guards BOTH directions + false-green) ──────────────

describe('deriveCoverageSignal + verdict — Phase 1.6 coverage-floor two-way fix', () => {
  it('CASE 1 (Re-run #1, false-green guard): an all-blank delivered set STILL fails, never passed', () => {
    const stepOutputs = {
      expense_rows: Array.from({ length: 13 }, () => ({ amount: '', vendor: 'Unknown', date: '', source_email_from: '' })),
      send_report: { message_id: 'abc', sent_at: '2026-07-11T00:00:00Z' }, // send executed
    };
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 });
    expect(cov.deliveredAllBlank).toBe(true);
    expect(cov.exercisedRealPath).toBe(false);

    const verdict = computeVerdict({ issues: [], coverage: cov });
    expect(verdict.isPassing).toBe(false);
    expect(verdict.verdict).toBe('inconclusive');
  });

  it('CASE 2 (Re-run #2, too-strict fix): a populated report whose send returns only a scalar confirmation CAN pass', () => {
    const stepOutputs = {
      expense_rows: [
        { amount: 'ILS 99.90', vendor: 'Wolt', date: '2026-02-25', source_email_from: 'a@b.com' },
        { amount: 'USD 232.96', vendor: 'Expedia', date: '2026-03-01', source_email_from: 'c@d.com' },
      ],
      // scalar send confirmation — no counted item array (items_delivered stays 0).
      send_report: { message_id: '19f52a6c391f3aaa', sent_at: '2026-07-11T19:28:08Z', recipients: ['x@y.com'] },
    };
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 });
    expect(cov.exercisedRealPath).toBe(true);      // meaningful rows ⇒ exercised
    expect(cov.deliveredAllBlank).toBe(false);
    expect(cov.partialBlankColumns).toHaveLength(0);

    const verdict = computeVerdict({ issues: [], coverage: cov });
    expect(verdict.isPassing).toBe(true);
    expect(verdict.verdict).toBe('passed');
  });

  it('CASE 2b: a populated report with a SUPPRESSED send (no send output at all) still passes', () => {
    const stepOutputs = {
      expense_rows: [{ amount: '10', vendor: 'Acme', date: '2026-01-01' }],
    };
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 5, itemsDelivered: 0 });
    expect(cov.exercisedRealPath).toBe(true);
    const verdict = computeVerdict({ issues: [], coverage: cov });
    expect(verdict.verdict).toBe('passed');
  });

  it('CASE 3 (partial report, the current 0ee53785 state): real amount/vendor/date but blank source columns → needs_review, NOT passed, blank columns named', () => {
    const stepOutputs = {
      expense_rows: Array.from({ length: 13 }, (_, i) => ({
        amount: `ILS ${i}.00`,
        vendor: 'Wolt',
        date: '2026-02-25',
        source_email_subject: '',
        source_email_from: '',
        attachment_filename: '',
      })),
      send_report: { message_id: 'm1', sent_at: '2026-07-11T00:00:00Z' },
    };
    const cov = deriveCoverageSignal({ stepOutputs, itemsProcessed: 14, itemsDelivered: 0 });
    expect(cov.exercisedRealPath).toBe(true);       // not capped to inconclusive
    expect(cov.deliveredAllBlank).toBe(false);
    expect(cov.partialBlankColumns.sort()).toEqual(
      ['attachment_filename', 'source_email_from', 'source_email_subject'].sort()
    );

    // The partial-data issue is non-blocking + non-waveable ⇒ needs_review.
    const partialIssue = { type: 'partial_report_data', severity: 'medium', blocking: false };
    expect(isWaveable(partialIssue)).toBe(false);
    const verdict = computeVerdict({ issues: [partialIssue], coverage: cov });
    expect(verdict.isPassing).toBe(false);
    expect(verdict.verdict).toBe('needs_review');
  });
});

describe('deriveCoverageSignal — no inspectable collection (single-object notify)', () => {
  it('an executed terminal send with no array collection counts as exercised', () => {
    const cov = deriveCoverageSignal({
      stepOutputs: { notify: { message_id: 'x', sent_at: 't' } },
      itemsProcessed: 3,
      itemsDelivered: 0,
    });
    expect(cov.exercisedRealPath).toBe(true);
  });
  it('no collection and no executed send falls back to the row-count signal (processed>0, delivered=0 → not exercised)', () => {
    const cov = deriveCoverageSignal({ stepOutputs: { a: 'scalar' }, itemsProcessed: 3, itemsDelivered: 0 });
    expect(cov.exercisedRealPath).toBe(false);
  });
});

describe('assessColumnFillRates', () => {
  it('identifies columns blank in every row while others are populated (partiallyBlank)', () => {
    const rows = [
      { amount: '10', vendor: 'A', note: '' },
      { amount: '20', vendor: 'B', note: '' },
    ];
    const r = assessColumnFillRates(rows);
    expect(r.partiallyBlank).toBe(true);
    expect(r.allBlankColumns).toEqual(['note']);
    expect(r.columns.amount).toBe(1);
  });
  it('a fully-blank set is NOT partiallyBlank (that is the all-blank case)', () => {
    const rows = [{ a: '', b: '' }, { a: '', b: '' }];
    expect(assessColumnFillRates(rows).partiallyBlank).toBe(false);
  });
  it('a fully-populated set has no all-blank columns', () => {
    expect(assessColumnFillRates([{ a: '1', b: '2' }]).partiallyBlank).toBe(false);
    expect(assessColumnFillRates([{ a: '1', b: '2' }]).allBlankColumns).toHaveLength(0);
  });

  // QA-added (Phase 1.6): a column blank in SOME rows but present in others is a
  // partial fill (ratio between 0 and 1) — it must NOT be named as an all-blank
  // column, and must NOT by itself make the set partiallyBlank.
  it('QA: a column blank in some rows but populated in others is NOT flagged all-blank', () => {
    const rows = [
      { amount: '10', vendor: 'A', note: 'x' },
      { amount: '20', vendor: 'B', note: '' },  // note blank here only
    ];
    const r = assessColumnFillRates(rows);
    expect(r.allBlankColumns).toHaveLength(0);   // note has ratio 0.5, not 0
    expect(r.partiallyBlank).toBe(false);
    expect(r.columns.note).toBe(0.5);
  });
});

describe('looksLikeExecutedSend', () => {
  it('true for a send confirmation with message_id / sent_at', () => {
    expect(looksLikeExecutedSend({ message_id: 'x', sent_at: 't' })).toBe(true);
    expect(looksLikeExecutedSend({ recipients: ['a'] })).toBe(true);
  });
  it('false for an array, a scalar, or a plain data object', () => {
    expect(looksLikeExecutedSend([{ message_id: 'x' }])).toBe(false);
    expect(looksLikeExecutedSend('sent')).toBe(false);
    expect(looksLikeExecutedSend({ amount: '10', vendor: 'A' })).toBe(false);
  });

  // QA-added (Phase 1.6): a non-send step that returns a bare `id` (or other
  // non-confirmation identifiers) must NOT be mistaken for an executed send —
  // only the specific delivery-confirmation markers count.
  it('QA: does NOT false-positive on a non-send object carrying a bare id / status', () => {
    expect(looksLikeExecutedSend({ id: 'row-1', status: 'ok' })).toBe(false);
    expect(looksLikeExecutedSend({ id: 'x', name: 'y' })).toBe(false);
    expect(looksLikeExecutedSend({ document_id: 'd1' })).toBe(false);
  });
});
