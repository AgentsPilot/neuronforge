'use client';

/**
 * "Send export to owner" (export redesign MX-5, workplan §4.8; SA-Q7, SA-Q10,
 * S-1; BQ-E8-2: no reason prompt; BQ-E8-3: support's sends only).
 *
 * Reads `GET /api/admin/users/<id>/export-sends` ONLY when it opens (never on
 * drawer open, workplan E-20), and sends `POST` with `{ modules }` and nothing
 * else: the owner comes from the path, the recipient is the owner's login
 * email on the server. No address is ever shown here.
 *
 * The server sends the module list with English names, so this file imports
 * nothing from lib/business-os (the screen's source guard). The server is the
 * authority for every rule (closed login, own account, limits); this dialog
 * only shows its answers.
 *
 * One press is one request: Send is disabled while a POST is in flight, and
 * the dialog cannot be closed until it answers (the CreditFormDialog rule).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { clientLogger } from '@/lib/logger/client';

import {
  ADMIN_DIALOG_CLASS,
  ADMIN_DIALOG_DESCRIPTION_CLASS,
  ADMIN_DIALOG_TITLE_CLASS,
} from '@/app/admin/components/layout/adminDialog';
import { DATA_EXPORT_COPY, dataExportLimitLine, type DataExportSendStatusWord } from '../dataExportCopy';

const logger = clientLogger.child({ module: 'AdminDataExportSendDialog' });

type SendState = 'self' | 'not_found' | 'closed' | 'no_login_email' | 'ready';

interface ModuleChoice {
  id: string;
  name: string;
}

interface SendLine {
  module: string;
  name: string;
  status: DataExportSendStatusWord;
}

interface SendRow {
  requestId: string;
  requestedAt: string;
  modules: SendLine[];
}

interface SendView {
  state: SendState;
  modules: ModuleChoice[];
  sends: SendRow[];
  nextSendAt: string | null;
}

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; view: SendView };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** Where focus goes on close; the box returns it to the opener. */
  onCloseAutoFocus?: (event: Event) => void;
}

const STATES: readonly SendState[] = ['self', 'not_found', 'closed', 'no_login_email', 'ready'];
const STATUS_WORDS = Object.keys(DATA_EXPORT_COPY.status) as DataExportSendStatusWord[];

// SA-Q7: the drawer has no timestamp formatter, so one inline format, zone labelled.
// Spelled out field by field: `dateStyle` / `timeStyle` cannot be combined with
// `timeZoneName` (the constructor throws a TypeError), so this is their
// medium-date, short-time equivalent with the zone added.
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});

function formatTime(iso: string | null): string | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? TIME_FORMAT.format(new Date(at)) : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

/** The GET answer, shape-checked; anything else is a failed read. */
function parseView(data: unknown): SendView | null {
  if (!isRecord(data) || !STATES.includes(data.state as SendState)) return null;
  if (!Array.isArray(data.modules) || !Array.isArray(data.sends)) return null;
  const modules = data.modules.filter((m): m is ModuleChoice => isRecord(m) && isString(m.id) && isString(m.name));
  const sends: SendRow[] = data.sends.filter(isRecord).map((row) => ({
    requestId: isString(row.requestId) ? row.requestId : '',
    requestedAt: isString(row.requestedAt) ? row.requestedAt : '',
    modules: (Array.isArray(row.modules) ? row.modules : [])
      .filter(isRecord)
      .filter((line) => {
        if (STATUS_WORDS.includes(line.status as DataExportSendStatusWord)) return true;
        // An unknown status word is not shown; say so rather than drop it silently (SA code review, optional).
        logger.warn({ requestId: isString(row.requestId) ? row.requestId : null, code: 'unknown_status' }, 'Admin export send history: a line with an unknown status was not shown');
        return false;
      })
      .map((line) => ({
        module: isString(line.module) ? line.module : '',
        name: isString(line.name) ? line.name : isString(line.module) ? line.module : '',
        status: line.status as DataExportSendStatusWord,
      })),
  }));
  return { state: data.state as SendState, modules, sends, nextSendAt: isString(data.nextSendAt) ? data.nextSendAt : null };
}

/** The line for a refused POST, from its fixed code. */
function refusalLine(code: string | null, retryAt: string | null): string {
  switch (code) {
    case 'account_closed':
      return DATA_EXPORT_COPY.closed;
    case 'export_no_login_email':
    case 'account_not_found':
      return DATA_EXPORT_COPY.noLoginEmail;
    case 'admin_self_send':
      return DATA_EXPORT_COPY.self;
    case 'export_in_progress':
      return DATA_EXPORT_COPY.inProgress;
    case 'export_daily_limit':
      return dataExportLimitLine(formatTime(retryAt));
    default:
      return DATA_EXPORT_COPY.sendFailed;
  }
}

export function DataExportSendDialog({ open, onOpenChange, accountId, onCloseAutoFocus }: Props) {
  const ids = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const inFlight = useRef(false);
  // A late answer for a closed dialog (or an older read) is dropped.
  const readSeq = useRef(0);

  const url = `/api/admin/users/${encodeURIComponent(accountId)}/export-sends`;

  const read = useCallback(async () => {
    const seq = ++readSeq.current;
    setLoad({ kind: 'loading' });
    try {
      const response = await fetch(url, { method: 'GET', cache: 'no-store' });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (seq !== readSeq.current) return;
      const view = response.ok && isRecord(parsed) && parsed.success === true ? parseView(parsed.data) : null;
      if (!view) {
        logger.warn({ status: response.status }, 'Admin export sends could not be read');
        setLoad({ kind: 'failed' });
        return;
      }
      setLoad({ kind: 'loaded', view });
    } catch (err) {
      if (seq !== readSeq.current) return;
      logger.warn({ err }, 'Admin export sends read threw');
      setLoad({ kind: 'failed' });
    }
  }, [url]);

  useEffect(() => {
    if (!open) {
      readSeq.current += 1;
      return;
    }
    setSelected(new Set());
    setNotice(null);
    void read();
  }, [open, read]);

  function handleOpenChange(next: boolean) {
    if (!next && inFlight.current) return;
    onOpenChange(next);
  }

  const view = load.kind === 'loaded' ? load.view : null;
  const isReady = view?.state === 'ready';
  const isLimited = view?.nextSendAt != null;
  const choices = view?.modules ?? [];
  const allSelected = choices.length > 0 && choices.every((m) => selected.has(m.id));
  const canSend = isReady && !isLimited && selected.size > 0 && !isBusy;

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function send() {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    setIsBusy(true);
    setNotice(null);
    // In the order the server listed them.
    const modules = choices.map((m) => m.id).filter((id) => selected.has(id));
    let ok = false;
    let code: string | null = null;
    let retryAt: string | null = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules }),
        cache: 'no-store',
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      const record = isRecord(parsed) ? parsed : null;
      ok = response.status === 201 && record?.success === true;
      code = record && isString(record.code) ? record.code : null;
      retryAt = record && isString(record.retryAt) ? record.retryAt : null;
      if (!ok) logger.warn({ status: response.status, code }, 'Admin export send refused');
    } catch (err) {
      logger.warn({ err }, 'Admin export send threw');
    }
    inFlight.current = false;
    setIsBusy(false);

    if (ok) {
      setSelected(new Set());
      setNotice({ tone: 'ok', text: DATA_EXPORT_COPY.sent });
      void read();
      return;
    }
    setNotice({ tone: 'error', text: refusalLine(code, retryAt) });
    // A refusal can change what the dialog may offer (limit, closed): read again.
    if (code !== null) void read();
  }

  const stateLine =
    view?.state === 'closed'
      ? DATA_EXPORT_COPY.closed
      : view?.state === 'self'
        ? DATA_EXPORT_COPY.self
        : view?.state === 'no_login_email' || view?.state === 'not_found'
          ? DATA_EXPORT_COPY.noLoginEmail
          : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="data-export-send-dialog" className={ADMIN_DIALOG_CLASS} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className={ADMIN_DIALOG_TITLE_CLASS}>{DATA_EXPORT_COPY.dialogTitle}</DialogTitle>
          <DialogDescription className={ADMIN_DIALOG_DESCRIPTION_CLASS}>{DATA_EXPORT_COPY.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {load.kind === 'loading' && (
            <p data-testid="data-export-send-loading" className="text-slate-400">
              {DATA_EXPORT_COPY.loading}
            </p>
          )}

          {load.kind === 'failed' && (
            <div data-testid="data-export-send-read-failed" role="alert" className="space-y-2">
              <p className="text-rose-300">{DATA_EXPORT_COPY.readFailed}</p>
              <Button type="button" variant="outline" size="sm" data-testid="data-export-send-retry" onClick={() => void read()}>
                {DATA_EXPORT_COPY.retry}
              </Button>
            </div>
          )}

          {notice && (
            <p
              data-testid={notice.tone === 'ok' ? 'data-export-send-done' : 'data-export-send-error'}
              role={notice.tone === 'ok' ? 'status' : 'alert'}
              className={notice.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'}
            >
              {notice.text}
            </p>
          )}

          {view && stateLine && (
            <p data-testid="data-export-send-state" className="text-slate-300">
              {stateLine}
            </p>
          )}

          {view && isReady && (
            <fieldset data-testid="data-export-send-picker" className="space-y-2">
              <legend className="text-slate-300">{DATA_EXPORT_COPY.pickerLegend}</legend>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${ids}-all`}
                  data-testid="data-export-send-select-all"
                  checked={allSelected}
                  disabled={isBusy}
                  onCheckedChange={(value) => setSelected(value === true ? new Set(choices.map((m) => m.id)) : new Set())}
                  className="!border-slate-500"
                />
                <Label htmlFor={`${ids}-all`} className="text-slate-300">
                  {DATA_EXPORT_COPY.selectAll}
                </Label>
              </div>
              {choices.map((module) => (
                <div key={module.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`${ids}-${module.id}`}
                    data-testid={`data-export-send-module-${module.id}`}
                    checked={selected.has(module.id)}
                    disabled={isBusy}
                    onCheckedChange={(value) => toggle(module.id, value === true)}
                    className="!border-slate-500"
                  />
                  <Label htmlFor={`${ids}-${module.id}`} className="text-slate-200">
                    {module.name}
                  </Label>
                </div>
              ))}
              {isLimited && (
                <p data-testid="data-export-send-limit" className="text-amber-200">
                  {dataExportLimitLine(formatTime(view.nextSendAt))}
                </p>
              )}
            </fieldset>
          )}

          {view && view.state !== 'self' && view.state !== 'closed' && view.state !== 'not_found' && (
            <section data-testid="data-export-send-history" className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{DATA_EXPORT_COPY.historyTitle}</h4>
              {view.sends.length === 0 ? (
                <p className="text-slate-400">{DATA_EXPORT_COPY.historyEmpty}</p>
              ) : (
                <ul className="space-y-1">
                  {view.sends.map((row) => (
                    <li key={row.requestId} data-testid="data-export-send-history-row" className="text-slate-300">
                      <span className="text-slate-400">{formatTime(row.requestedAt) ?? row.requestedAt}</span>
                      {': '}
                      {row.modules.map((line) => `${line.name} (${DATA_EXPORT_COPY.status[line.status]})`).join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" data-testid="data-export-send-close" disabled={isBusy} onClick={() => handleOpenChange(false)}>
              {DATA_EXPORT_COPY.close}
            </Button>
            {isReady && (
              <Button type="button" data-testid="data-export-send-submit" disabled={!canSend} onClick={() => void send()}>
                {isBusy ? DATA_EXPORT_COPY.sending : DATA_EXPORT_COPY.send}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
