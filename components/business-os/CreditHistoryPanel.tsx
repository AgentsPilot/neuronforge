'use client';

/**
 * Credit history — every charged action of the card's own window, in a side
 * panel opened from the Credits card (credit deduction slice 7a, workplan
 * §4.9; decisions D-i to D-q; SA SQ-37, Q-1).
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────
 *   - the window: "This period · {from} – {to}", "Since your trial began", or
 *     "This month" (no plan row); its exact total at one decimal, and the
 *     "by you / automatic" split (D-n) — the card's own figures;
 *   - one line per action, newest first (D-l): when (the business's clock),
 *     area, label, "You" / "Automatic", "Didn't complete" when it failed, and
 *     its credits at one decimal, "less than 0.1" below (D-m);
 *   - the footnote "Each line is rounded; the total is exact." (SQ-8);
 *   - "Show more" for the next 50.
 * Over the allowance it shows the true total and nothing else: no "left", no
 * warning, no pause or upgrade wording (slices 8, 10).
 *
 * ── WHEN IT READS ────────────────────────────────────────────────────────────
 * When it opens, and on "Show more". Never on a timer and never on the card's
 * refresh signal: work that runs while it is open shows the next time it is
 * opened (KI-12's accepted lag).
 *
 * ── WHICH SIDE ───────────────────────────────────────────────────────────────
 * `side={isRTL ? 'left' : 'right'}` with `dir` on the content — the exact
 * expression of the product's three other drawers (SA Q-1), so every drawer
 * opens from the same place in every language.
 *
 * Labels arrive from the server in the three languages; the area code is
 * named from the dictionary. Nothing here imports server code.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { toDiaryCredits, toDiarySummary, type DiaryCreditFigure } from '@/lib/business-os/credits/creditDisplay';
import type {
  CreditHistoryLine,
  CreditHistoryPage,
  CreditHistorySummary,
} from '@/lib/business-os/credits/creditHistoryTypes';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CreditHistoryPanel' });

const HISTORY_URL = '/api/business-os/credits/history';

const INK = 'var(--v2-text-primary)';
const MUTED = 'var(--v2-text-secondary)';
const BORDER = 'var(--v2-border)';
const ALERT = '#F97316';

const KINDS = ['monthly', 'trial_total', 'calendar_month'];
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function isLine(value: unknown): value is CreditHistoryLine {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CreditHistoryLine>;
  const labelOk =
    v.label === null || (!!v.label && isString(v.label.en) && isString(v.label.he) && isString(v.label.es));
  return (
    isString(v.id) &&
    isString(v.at) &&
    (v.area === null || isString(v.area)) &&
    labelOk &&
    (v.who === null || v.who === 'you' || v.who === 'automatic') &&
    typeof v.didNotComplete === 'boolean' &&
    typeof v.isCorrection === 'boolean' &&
    isFiniteNumber(v.credits)
  );
}

function isSummary(value: unknown): value is CreditHistorySummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CreditHistorySummary>;
  return (
    !!v.period &&
    KINDS.includes(v.period.kind as string) &&
    isString(v.period.startsOn) &&
    (v.period.endsBefore === null || isString(v.period.endsBefore)) &&
    isFiniteNumber(v.used) &&
    isFiniteNumber(v.usedByOwner) &&
    isFiniteNumber(v.usedAutomatic)
  );
}

type Answer = { kind: 'restart' } | { kind: 'page'; page: CreditHistoryPage } | { kind: 'bad' };

/** The payload, checked before it is shown: a malformed answer is an error, never an empty history. */
function readAnswer(data: unknown, expectSummary: boolean): Answer {
  if (!data || typeof data !== 'object') return { kind: 'bad' };
  if ((data as { restart?: unknown }).restart === true) return { kind: 'restart' };
  const v = data as Partial<CreditHistoryPage>;
  if (!Array.isArray(v.lines) || !v.lines.every(isLine)) return { kind: 'bad' };
  if (!(v.nextCursor === null || isString(v.nextCursor))) return { kind: 'bad' };
  if (expectSummary && !isSummary(v.summary)) return { kind: 'bad' };
  return { kind: 'page', page: v as CreditHistoryPage };
}

export interface CreditHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreditHistoryPanel({ open, onOpenChange }: CreditHistoryPanelProps) {
  const { t, language, isRTL, timeZoneOptions } = useLanguage();

  const [summary, setSummary] = useState<CreditHistorySummary | null>(null);
  const [lines, setLines] = useState<CreditHistoryLine[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlightRef = useRef<AbortController | null>(null);

  /** One page: the first (no cursor) replaces everything; a later one appends. */
  const load = useCallback(async (cursor: string | null, restarts = 0): Promise<void> => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    if (cursor === null) {
      // QA-1: a fresh read never shows the previous opening's figures while
      // it runs — the panel says "Loading…" until page one arrives.
      setFailed(false);
      setSummary(null);
      setLines([]);
      setNextCursor(null);
    }

    const fail = (ctx: Record<string, unknown>, message: string) => {
      setFailed(true);
      setSummary(null);
      setLines([]);
      setNextCursor(null);
      logger.warn(ctx, message);
    };

    try {
      const url = cursor === null ? HISTORY_URL : `${HISTORY_URL}?cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (inFlightRef.current !== controller) return;
      const answer = response.ok && body?.success ? readAnswer(body.data, cursor === null) : ({ kind: 'bad' } as Answer);

      if (answer.kind === 'restart') {
        // The window changed under us (a new period, a new plan): start again
        // from page one — once. A second restart in a row is shown as an error,
        // never a loop.
        if (restarts > 0) {
          fail({}, 'Credit history restarted twice in a row');
          return;
        }
        inFlightRef.current = null;
        await load(null, restarts + 1);
        return;
      }
      if (answer.kind === 'bad') {
        fail({ status: response.status }, 'Credit history read failed');
        return;
      }
      const page = answer.page;
      if (cursor === null) {
        setSummary(page.summary ?? null);
        setLines(page.lines);
      } else {
        setLines((previous) => [...previous, ...page.lines]);
      }
      setNextCursor(page.nextCursor);
      setFailed(false);
    } catch (err) {
      if (inFlightRef.current !== controller) return;
      fail({ err }, 'Credit history read threw');
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Reads when it opens — each time — and never otherwise.
  useEffect(() => {
    if (!open) return;
    void load(null);
    return () => {
      const inFlight = inFlightRef.current;
      inFlightRef.current = null;
      inFlight?.abort();
    };
  }, [open, load]);

  const tenths = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  // QA-3: one minus sign for every negative figure — U+2212, never the
  // locale's hyphen-minus on some figures and "−" on others.
  const MINUS = '−';
  const credits = (f: DiaryCreditFigure): string => {
    if (f.kind === 'zero') return tenths.format(0);
    if (f.kind === 'tenths') return f.value < 0 ? `${MINUS}${tenths.format(-f.value)}` : tenths.format(f.value);
    return f.negative ? `${MINUS}${t('credits.history.less_than_tenth')}` : t('credits.history.less_than_tenth');
  };

  // The business's clock, the reader's language.
  const dayKey = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', timeZoneOptions({ year: 'numeric', month: '2-digit', day: '2-digit' })).format(date);
  /** SA CR7-4: the calendar day before a day key — never "now − 24 h", which slips on a daylight-saving day. */
  const previousDayKey = (key: string): string => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  };
  const dayMonth = (date: Date) => new Intl.DateTimeFormat(language, timeZoneOptions({ day: 'numeric', month: 'short' })).format(date);
  const clock = (date: Date) => new Intl.DateTimeFormat(language, timeZoneOptions({ hour: '2-digit', minute: '2-digit' })).format(date);

  const when = (iso: string): string => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const key = dayKey(at);
    const today = dayKey(new Date());
    if (key === today) return t('credits.history.today', { time: clock(at) });
    if (key === previousDayKey(today)) return t('credits.history.yesterday', { time: clock(at) });
    return `${dayMonth(at)} ${clock(at)}`;
  };

  const periodLine = (s: CreditHistorySummary): string => {
    if (s.period.kind === 'trial_total') return t('credits.history.period.trial');
    if (s.period.kind === 'calendar_month') return t('credits.history.period.month');
    const from = new Date(s.period.startsOn);
    if (s.period.endsBefore) {
      // The last day of the period: the instant before the next one starts.
      const to = new Date(new Date(s.period.endsBefore).getTime() - 1);
      return t('credits.history.period.this', { from: dayMonth(from), to: dayMonth(to) });
    }
    return t('credits.history.period.since', { from: dayMonth(from) });
  };

  const labelOf = (line: CreditHistoryLine): string => {
    const label = line.label ? line.label[language as 'en' | 'he' | 'es'] ?? line.label.en : t('credits.history.other');
    return line.isCorrection ? t('credits.history.correction', { label }) : label;
  };

  const areaOf = (line: CreditHistoryLine): string | null => {
    if (line.area === null) return null;
    const key = `credits.area.${line.area}`;
    const name = t(key);
    // An area the dictionary does not know is not shown as its raw code.
    return name === key ? null : name;
  };

  const shown = summary ? toDiarySummary(summary) : null;
  const isTrial = summary?.period.kind === 'trial_total';
  const isEmpty = !failed && summary !== null && lines.length === 0;
  const explain = summary && summary.period.kind !== 'calendar_month' && (isTrial || summary.period.endsBefore)
    ? t(isTrial ? 'usage.explain.trial' : 'usage.explain.monthly')
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isRTL ? 'left' : 'right'}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="credit-history-panel"
        data-side={isRTL ? 'left' : 'right'}
        aria-describedby={undefined}
        className="w-full sm:max-w-xl p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col"
      >
        <div style={{ padding: '24px 24px 16px', borderBottom: `1px solid ${BORDER}` }}>
          <SheetTitle className="text-lg font-semibold text-[var(--v2-text-primary)] text-start">
            {t('credits.history.title')}
          </SheetTitle>
          {summary && shown && (
            <div data-testid="credit-history-summary" style={{ marginTop: 6 }}>
              <p data-testid="credit-history-period" style={{ fontSize: 13, color: MUTED }}>
                {periodLine(summary)}
              </p>
              <p data-testid="credit-history-used" style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 6 }}>
                {/* CR7-7: exactly one credit reads in the singular. */}
                {t(shown.used.kind === 'tenths' && shown.used.value === 1 ? 'credits.history.used_one' : 'credits.history.used', {
                  n: credits(shown.used),
                })}
              </p>
              {shown.used.kind !== 'zero' && (
                <p data-testid="credit-history-split" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                  {t('credits.history.split', { owner: credits(shown.byOwner), automatic: credits(shown.automatic) })}
                </p>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 24px' }}>
          {failed && (
            <p data-testid="credit-history-error" style={{ fontSize: 13, color: ALERT, marginTop: 12 }}>
              {t('credits.history.error')}
            </p>
          )}

          {!failed && summary === null && loading && (
            <p data-testid="credit-history-loading" style={{ fontSize: 13, color: MUTED, marginTop: 12 }}>
              {t('credits.history.loading')}
            </p>
          )}

          {isEmpty && (
            <div data-testid="credit-history-empty" style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: INK }}>
                {t(isTrial ? 'credits.history.empty_trial' : 'credits.history.empty')}
              </p>
              {explain && <p style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>{explain}</p>}
            </div>
          )}

          {!failed && lines.length > 0 && (
            <>
              <ul data-testid="credit-history-lines" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {lines.map((line) => {
                  const area = areaOf(line);
                  return (
                    <li
                      key={line.id}
                      data-testid="credit-history-line"
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '10px 0',
                        borderBottom: `1px solid ${BORDER}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: INK }}>
                          {area && <span style={{ fontWeight: 600 }}>{area} · </span>}
                          <span>{labelOf(line)}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                          <span>{when(line.at)}</span>
                          {line.who && <span> · {t(line.who === 'you' ? 'credits.history.who.you' : 'credits.history.who.automatic')}</span>}
                          {line.didNotComplete && (
                            <span data-testid="credit-history-did-not-complete"> · {t('credits.history.did_not_complete')}</span>
                          )}
                        </div>
                      </div>
                      <span
                        data-testid="credit-history-credits"
                        style={{ fontSize: 13, color: INK, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
                      >
                        {credits(toDiaryCredits(line.credits))}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p data-testid="credit-history-footnote" style={{ fontSize: 11.5, color: MUTED, marginTop: 10 }}>
                {t('credits.history.footnote')}
              </p>
              {nextCursor && (
                <button
                  type="button"
                  data-testid="credit-history-more"
                  disabled={loading}
                  onClick={() => void load(nextCursor)}
                  style={{
                    marginTop: 12,
                    fontSize: 13,
                    color: 'var(--v2-primary)',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: loading ? 'default' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {t('credits.history.show_more')}
                </button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
