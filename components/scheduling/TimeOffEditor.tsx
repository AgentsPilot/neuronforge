'use client';

/**
 * Days the business is closed, or open for less than usual.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN COMPONENT
 *
 * `AvailabilityEditor` is a controlled component over one JSON column: it takes
 * `availability` and `onChange` and fetches nothing. Time off is rows in its own
 * table with their own create and delete, so folding it in would make the weekly
 * editor stateful and give two unrelated things one save button.
 *
 * WHAT IT FIXES
 *
 * `scheduling_availability_exceptions` has been in the schema since July with
 * full RLS, and until now nothing read it and nothing wrote it — so a business
 * closed for a holiday went on publishing bookable slots for it, and the owner's
 * only defence was to notice and cancel. The reading side went in first
 * (`windowsForDate`, used by the public page, smart links and the chat); this is
 * what puts rows there to read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import { CalendarOff, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

const CONFIG_COLOR = '#D14E97';

interface TimeOffRow {
  id: string;
  exception_type: 'unavailable' | 'custom_hours';
  start_date: string;
  end_date: string;
  custom_hours: { start: string; end: string } | null;
  reason: string | null;
}

/** Today, as a date key — the earliest a day off can usefully start. */
function todayKey(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function TimeOffEditor() {
  const { t, language } = useLanguage();

  const [rows, setRows] = useState<TimeOffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [closedAllDay, setClosedAllDay] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduling/time-off');
      const body = await response.json();
      if (body?.success) setRows(body.data ?? []);
    } catch {
      // Left as it was. A list that failed to load is not worth an error
      // message of its own — the add form below still works.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/scheduling/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_type: closedAllDay ? 'unavailable' : 'custom_hours',
          start_date: from,
          end_date: to,
          custom_hours: closedAllDay ? null : { start, end },
          reason: reason.trim() || null,
        }),
      });

      const body = await response.json();
      if (!body?.success) {
        /*
         * The two rules worth naming are both about a relationship between
         * fields — the range running backwards, and short hours ending before
         * they start — so the server's own refusal is shown rather than a
         * generic failure.
         */
        setError(
          body?.details?.[0]?.message || body?.error || t('scheduling.timeoff.failed')
        );
        return;
      }

      setRows(prev => [...prev, body.data]);
      setAdding(false);
      setReason('');
    } catch {
      setError(t('scheduling.timeoff.failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    // Optimistic: the row is gone from the list the moment it is pressed, and
    // put back if the request refuses. A day the owner has decided to work is
    // not worth a spinner.
    const previous = rows;
    setRows(prev => prev.filter(row => row.id !== id));

    try {
      const response = await fetch(`/api/scheduling/time-off/${id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!body?.success) setRows(previous);
    } catch {
      setRows(previous);
    }
  };

  /** "6–14 Oct", or one date where the range is a single day. */
  const rangeLabel = (row: TimeOffRow) => {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    const first = new Date(`${row.start_date}T12:00:00Z`).toLocaleDateString(language, {
      ...opts,
      timeZone: 'UTC',
    });
    if (row.end_date === row.start_date) return first;
    const last = new Date(`${row.end_date}T12:00:00Z`).toLocaleDateString(language, {
      ...opts,
      timeZone: 'UTC',
    });
    return `${first} – ${last}`;
  };

  const field =
    'px-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:border-transparent';
  const fieldStyle = { borderRadius: 'var(--v2-radius-button)', ['--tw-ring-color' as string]: CONFIG_COLOR };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarOff className="h-4 w-4 text-[var(--v2-text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('scheduling.timeoff.title')}
        </h3>
      </div>
      <p className="text-[12px] text-[var(--v2-text-muted)] max-w-[62ch] leading-relaxed">
        {t('scheduling.timeoff.hint')}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[var(--v2-text-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('scheduling.timeoff.loading')}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.length === 0 && !adding && (
            <p className="text-[12px] text-[var(--v2-text-muted)]">
              {t('scheduling.timeoff.empty')}
            </p>
          )}

          {rows.map(row => (
            <div
              key={row.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <span className="text-[13px] font-medium text-[var(--v2-text-primary)] tabular-nums">
                {rangeLabel(row)}
              </span>
              <span className="text-[12px] text-[var(--v2-text-secondary)]">
                {row.exception_type === 'unavailable'
                  ? t('scheduling.timeoff.closed_all_day')
                  : `${row.custom_hours?.start ?? ''}–${row.custom_hours?.end ?? ''}`}
              </span>
              {row.reason && (
                <span className="text-[12px] text-[var(--v2-text-muted)] truncate">· {row.reason}</span>
              )}
              <button
                type="button"
                onClick={() => remove(row.id)}
                aria-label={t('scheduling.timeoff.remove')}
                className="ms-auto p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {adding ? (
            <div
              className="p-3 space-y-3 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-[var(--v2-text-secondary)]">
                    {t('scheduling.timeoff.from')}
                  </span>
                  <input
                    type="date"
                    value={from}
                    onChange={e => {
                      setFrom(e.target.value);
                      // One day is the common case, so the end follows the start
                      // until the owner moves it themselves.
                      if (e.target.value > to) setTo(e.target.value);
                    }}
                    className={`${field} w-[150px]`}
                    style={fieldStyle}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-[var(--v2-text-secondary)]">
                    {t('scheduling.timeoff.to')}
                  </span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={e => setTo(e.target.value)}
                    className={`${field} w-[150px]`}
                    style={fieldStyle}
                  />
                </label>

                <div
                  role="group"
                  className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-surface)]"
                  style={{ borderRadius: '999px' }}
                >
                  {([true, false] as const).map(allDay => (
                    <button
                      key={String(allDay)}
                      type="button"
                      onClick={() => setClosedAllDay(allDay)}
                      aria-pressed={closedAllDay === allDay}
                      className={`px-3.5 py-1.5 text-[12.5px] transition-colors ${
                        closedAllDay === allDay
                          ? 'bg-[var(--v2-bg)] text-[var(--v2-text-primary)] font-medium shadow-sm'
                          : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
                      }`}
                      style={{ borderRadius: '999px' }}
                    >
                      {allDay
                        ? t('scheduling.timeoff.closed_all_day')
                        : t('scheduling.timeoff.short_day')}
                    </button>
                  ))}
                </div>

                {!closedAllDay && (
                  <div className="flex items-end gap-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-[var(--v2-text-secondary)]">
                        {t('scheduling.timeoff.open_from')}
                      </span>
                      <input
                        type="time"
                        value={start}
                        onChange={e => setStart(e.target.value)}
                        className={`${field} w-[110px]`}
                        style={fieldStyle}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] text-[var(--v2-text-secondary)]">
                        {t('scheduling.timeoff.open_until')}
                      </span>
                      <input
                        type="time"
                        value={end}
                        onChange={e => setEnd(e.target.value)}
                        className={`${field} w-[110px]`}
                        style={fieldStyle}
                      />
                    </label>
                  </div>
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] text-[var(--v2-text-secondary)]">
                  {t('scheduling.timeoff.reason')}
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={t('scheduling.timeoff.reason_placeholder')}
                  maxLength={200}
                  className={`${field} w-full max-w-[380px]`}
                  style={fieldStyle}
                />
              </label>

              {/* What a short day actually does, said before it is saved: it
                  REPLACES that date's hours rather than narrowing them, which is
                  also how it can open a day that is normally closed. */}
              {!closedAllDay && (
                <p className="text-[11.5px] leading-snug text-[var(--v2-text-muted)] max-w-[52ch]">
                  {t('scheduling.timeoff.short_day_note')}
                </p>
              )}

              {error && (
                <p className="flex items-center gap-1.5 text-[12px] text-red-600 dark:text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {error}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={add}
                  disabled={saving}
                  className="px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: CONFIG_COLOR, borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? t('scheduling.timeoff.saving') : t('scheduling.timeoff.save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setError(null);
                  }}
                  className="px-4 py-2 text-[13px] font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] transition-colors"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('scheduling.timeoff.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-3 py-2 text-[13px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('scheduling.timeoff.add')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
