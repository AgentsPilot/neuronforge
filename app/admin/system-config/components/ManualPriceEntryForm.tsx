'use client';

/**
 * Record a provider price by hand (AI model price review slice 4; MP-FR-12
 * fallback, SA RR-1). Posts ONE line to the existing manual-entry route. The
 * price is stored as PENDING only: nothing here changes a charge.
 *
 *  - Prices are typed per 1M tokens (or per image) and sent as the typed
 *    decimal STRINGS, never through a number (R-1).
 *  - The line passes the same `PendingLineSchema` the server uses before it is
 *    sent (SA O-6, RC-1: the first client-side zod, approved narrowly for this
 *    admin form). The server stays the authority: its 400 and 422 messages are
 *    shown as it wrote them, each with its field name.
 *  - The source URL is never fetched; the allowed hosts are listed under it.
 */

import { useId, useState, type FormEvent } from 'react';

import { BLOCKING_FLAGS, FLAG_LABELS, type PendingLineFlag } from '@/lib/ai/pricing-research/lineFlags';
import { OFFICIAL_PRICE_HOSTS, PRICE_PROVIDERS, isPriceProvider } from '@/lib/ai/pricing-research/officialSources';
import { PendingLineSchema } from '@/lib/ai/pricing-research/pendingLineSchema';
import { clientLogger } from '@/lib/logger/client';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { FIELD_WORDS, FORM_WORDS, NEEDS_A_REASON } from '@/app/admin/system-config/priceReviewCopy';

const logger = clientLogger.child({ module: 'AdminPriceManualEntry' });

export const MANUAL_ENTRY_URL = '/api/admin/model-pricing/manual-entries';

export interface ManualEntryPrefill {
  kind: 'token' | 'image';
  provider: string | null;
  modelName: string;
}

interface Props {
  prefill: ManualEntryPrefill | null;
  onSaved: () => void;
  onClose: () => void;
}

type Field =
  | 'provider'
  | 'model_name'
  | 'input_per_1m'
  | 'output_per_1m'
  | 'cached_input_per_1m'
  | 'image_size'
  | 'image_quality'
  | 'price_per_image'
  | 'source_url'
  | 'checked_on';

/** The fields held as typed text (Provider has its own state). */
type TextField = Exclude<Field, 'provider'>;

/** Today as the admin's own calendar date (not the UTC date of `toISOString`). */
function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const INPUT =
  'w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 aria-[invalid=true]:border-red-500';

/** "lines.0.source_url" → "Official source URL"; "lines.0" → "This price". */
function fieldOfPath(path: string): { field: string | null; words: string } {
  const last = path.split('.').pop() ?? '';
  if (FIELD_WORDS[last]) return { field: last, words: FIELD_WORDS[last] };
  return { field: null, words: FORM_WORDS.refusedLine };
}

function flagWords(flags: readonly string[]): string[] {
  return flags.map((flag) => {
    const label = (FLAG_LABELS as Record<string, string>)[flag] ?? flag;
    return (BLOCKING_FLAGS as readonly string[]).includes(flag as PendingLineFlag) ? `${label} (${NEEDS_A_REASON})` : label;
  });
}

export function ManualPriceEntryForm({ prefill, onSaved, onClose }: Props) {
  const id = useId();
  const [kind, setKind] = useState<'token' | 'image'>(prefill?.kind ?? 'token');
  const [provider, setProvider] = useState<string>(prefill?.provider && isPriceProvider(prefill.provider) ? prefill.provider : '');
  const [values, setValues] = useState<Record<TextField, string>>({
    model_name: prefill?.modelName ?? '',
    input_per_1m: '',
    output_per_1m: '',
    cached_input_per_1m: '',
    image_size: '',
    image_quality: '',
    price_per_image: '',
    source_url: '',
    checked_on: localToday(),
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [refusal, setRefusal] = useState<{ message: string; problems: string[] } | null>(null);
  const [saved, setSaved] = useState<{ flags: string[]; replaced: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: TextField) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const buildLine = (): Record<string, string> => {
    const text = (field: TextField) => values[field].trim();
    const common = { provider, model_name: text('model_name'), source_url: text('source_url'), checked_on: text('checked_on') };
    if (kind === 'image') {
      return {
        kind,
        ...common,
        image_size: text('image_size'),
        image_quality: text('image_quality'),
        price_per_image: text('price_per_image'),
      };
    }
    const line: Record<string, string> = {
      kind,
      ...common,
      input_per_1m: text('input_per_1m'),
      output_per_1m: text('output_per_1m'),
    };
    if (text('cached_input_per_1m') !== '') line.cached_input_per_1m = text('cached_input_per_1m');
    return line;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setRefusal(null);
    setSaved(null);

    const line = buildLine();
    const errors: Partial<Record<Field, string>> = {};
    // SA F-2: every browser refusal is also listed in the role="alert" box,
    // so it is announced, and one on a field the form does not show is seen.
    const problems: string[] = [];
    if (provider === '') {
      errors.provider = FORM_WORDS.providerRequired;
      problems.push(`${FIELD_WORDS.provider}: ${FORM_WORDS.providerRequired}`);
    }
    const parsed = PendingLineSchema.safeParse(line);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field === 'provider' && errors.provider) continue;
        problems.push(`${FIELD_WORDS[field] ?? FORM_WORDS.refusedLine}: ${issue.message}`);
        if (field && !errors[field as Field]) errors[field as Field] = issue.message;
      }
    }
    if (problems.length > 0) {
      setFieldErrors(errors);
      setRefusal({ message: FORM_WORDS.checkFields, problems });
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const response = await fetch(MANUAL_ENTRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: [line] }),
      });
      const body = await readJsonBody(response);

      if (response.ok && body?.success === true) {
        const data = body.data as { lines?: Array<{ flags?: string[]; supersededLineId?: string | null }> } | undefined;
        const first = data?.lines?.[0];
        setSaved({ flags: flagWords(first?.flags ?? []), replaced: Boolean(first?.supersededLineId) });
        setValues((current) => ({
          ...current,
          input_per_1m: '',
          output_per_1m: '',
          cached_input_per_1m: '',
          price_per_image: '',
          source_url: '',
        }));
        onSaved();
        return;
      }

      const rawProblems = (body as Record<string, unknown> | null)?.problems;
      const problems: string[] = [];
      const serverErrors: Partial<Record<Field, string>> = {};
      if (Array.isArray(rawProblems)) {
        for (const problem of rawProblems) {
          const path = typeof problem?.path === 'string' ? problem.path : '';
          const message = typeof problem?.message === 'string' ? problem.message : '';
          if (!message) continue;
          const { field, words } = fieldOfPath(path);
          problems.push(`${words}: ${message}`);
          if (field && !serverErrors[field as Field]) serverErrors[field as Field] = message;
        }
      }
      const message = typeof body?.error === 'string' && body.error.trim() !== '' ? body.error : FORM_WORDS.fallbackError;
      logger.warn({ status: response.status, problems: problems.length }, 'Manual price entry refused');
      setFieldErrors(serverErrors);
      setRefusal({ message, problems });
    } catch (err) {
      logger.error({ err }, 'Manual price entry threw');
      setRefusal({ message: ADMIN_NETWORK_ERROR, problems: [] });
    } finally {
      setSaving(false);
    }
  };

  const fieldId = (field: Field) => `${id}-${field}`;
  const errorId = (field: Field) => `${id}-${field}-error`;
  const fieldProps = (field: TextField) => ({
    id: fieldId(field),
    value: values[field],
    onChange: set(field),
    className: INPUT,
    'aria-invalid': fieldErrors[field] ? true : undefined,
    'aria-describedby': fieldErrors[field] ? errorId(field) : undefined,
  });
  const errorLine = (field: Field) =>
    fieldErrors[field] ? (
      <span id={errorId(field)} className="mt-0.5 block text-xs text-red-300">
        {fieldErrors[field]}
      </span>
    ) : null;
  const textField = (field: TextField, label: string, hint?: string) => (
    <div>
      <label htmlFor={fieldId(field)} className="mb-1 block text-xs text-slate-300">
        {label}
      </label>
      <input type="text" {...fieldProps(field)} />
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
      {errorLine(field)}
    </div>
  );
  const hosts = provider && isPriceProvider(provider) ? OFFICIAL_PRICE_HOSTS[provider].join(', ') : PRICE_PROVIDERS.join(', ');

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={FORM_WORDS.title}
      className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-white">{FORM_WORDS.title}</h3>
          <p className="text-xs text-slate-400">{FORM_WORDS.intro}</p>
        </div>
        <button type="button" onClick={onClose} className={ADMIN_BUTTON}>
          {FORM_WORDS.close}
        </button>
      </div>

      <fieldset className="flex gap-4 text-sm text-slate-300">
        <legend className="mb-1 text-xs text-slate-300">{FORM_WORDS.kindLegend}</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name={`${id}-kind`} checked={kind === 'token'} onChange={() => setKind('token')} />
          {FORM_WORDS.kindToken}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={`${id}-kind`} checked={kind === 'image'} onChange={() => setKind('image')} />
          {FORM_WORDS.kindImage}
        </label>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={fieldId('provider')} className="mb-1 block text-xs text-slate-300">
            {FORM_WORDS.provider}
          </label>
          <select
            id={fieldId('provider')}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className={INPUT}
            aria-invalid={fieldErrors.provider ? true : undefined}
            aria-describedby={fieldErrors.provider ? errorId('provider') : undefined}
          >
            <option value="">{FORM_WORDS.providerPlaceholder}</option>
            {PRICE_PROVIDERS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {errorLine('provider')}
        </div>
        {textField('model_name', FORM_WORDS.model)}
        {kind === 'token' ? (
          <>
            {textField('input_per_1m', FORM_WORDS.input, 'USD per 1M tokens, for example 0.15')}
            {textField('output_per_1m', FORM_WORDS.output, 'USD per 1M tokens, for example 0.6')}
            {textField('cached_input_per_1m', FORM_WORDS.cached)}
          </>
        ) : (
          <>
            {textField('image_size', FORM_WORDS.size, 'WIDTHxHEIGHT, for example 1024x1024')}
            {textField('image_quality', FORM_WORDS.quality, 'for example low, medium or high')}
            {textField('price_per_image', FORM_WORDS.price, 'USD per image')}
          </>
        )}
        {textField('source_url', FORM_WORDS.source, `${FORM_WORDS.sourceHint} ${hosts}`)}
        <div>
          <label htmlFor={fieldId('checked_on')} className="mb-1 block text-xs text-slate-300">
            {FORM_WORDS.checkedOn}
          </label>
          <input type="date" {...fieldProps('checked_on')} />
          {errorLine('checked_on')}
        </div>
      </div>

      {refusal && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{refusal.message}</p>
          {refusal.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {refusal.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Always mounted, empty when idle, so a screen reader announces new text (QA edge case 2). */}
      <div
        role="status"
        className={saved ? 'rounded-lg border border-slate-600 bg-slate-800 p-3 text-sm text-slate-200' : undefined}
      >
        {saved && (
          <>
            <p>{FORM_WORDS.saved}</p>
            {saved.replaced && <p className="text-xs text-slate-400">{FORM_WORDS.replaced}</p>}
            {saved.flags.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-200" aria-label="Flags">
                {saved.flags.map((words) => (
                  <li key={words}>{words}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <button type="submit" disabled={saving} className={ADMIN_BUTTON}>
        {saving ? FORM_WORDS.saving : FORM_WORDS.save}
      </button>
    </form>
  );
}
