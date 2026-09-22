'use client';

/**
 * One answer, in the client's hands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every type the generator can produce has a case here, and that completeness
 * is the point: a missing one would render nothing where a client expects an
 * input, on a page the business cannot see. The `default` is a text box rather
 * than an empty space for the same reason — an unrecognised type should still
 * let someone answer.
 *
 * The old renderer covered four types because the shared catalogue only ever
 * produced four. A form written for one business can ask for a date, a count,
 * a yes or a photograph, and those are the questions most worth asking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import type { IntakeQuestion } from '@/lib/business-os/intake/types';
import { INTAKE_UPLOAD_ACCEPT } from '@/lib/business-os/intake/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'IntakeAnswerField' });

/** Shared by every control, in the business's colours. */
const fieldStyle: React.CSSProperties = {
  background: 'var(--ap-bg)',
  border: '1px solid var(--ap-border)',
  borderRadius: 'var(--ap-radius-md)',
  color: 'var(--ap-text)',
};

interface UploadedFile {
  documentId: string;
  name: string;
}

interface Props {
  question: IntakeQuestion;
  value: unknown;
  invalid: boolean;
  /** The booking token — the client's only credential. */
  token: string;
  onChange: (value: unknown) => void;
  t: (key: string) => string;
}

/**
 * The "Other" answer, when the business has offered one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * No list an owner writes fits every client. A fitness level of Beginner /
 * Intermediate / Advanced has no row for "returning after an injury", and
 * without somewhere to say so that client picks a box that misdescribes them —
 * the business then prepares from an answer nobody meant. A wrong answer is
 * worse than a missing one, because nothing about it looks wrong later.
 *
 * WHAT IT STORES IS THE TYPED TEXT, exactly as a chosen option stores its
 * label. Nothing downstream needs to know this control exists: the submission
 * reads the same either way, and `IntakeSubmission` already snapshots the
 * questions, so a later reader can still see what was on offer.
 *
 * Which is also how "is Other selected?" is answered, with no extra state: a
 * value that is set but matches no option IS the other answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function OtherAnswer({
  selected,
  text,
  onSelect,
  onText,
  style,
  base,
  t,
}: {
  selected: boolean;
  text: string;
  onSelect: () => void;
  onText: (value: string) => void;
  style: React.CSSProperties;
  base: string;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm transition-colors"
        style={{ ...style, borderColor: selected ? 'var(--ap-brand)' : style.borderColor }}
      >
        <span
          className="h-3.5 w-3.5 flex-shrink-0 rounded-full"
          style={{
            border: `2px solid ${selected ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
            background: selected
              ? 'radial-gradient(circle, var(--ap-brand) 0 40%, transparent 45%)'
              : 'transparent',
          }}
        />
        {t('intake.other')}
      </button>

      {/* Revealed by choosing it, so the form does not show an empty box under
          every choice question whether or not anyone needs it. */}
      {selected && (
        <input
          type="text"
          value={text}
          onChange={e => onText(e.target.value)}
          autoFocus
          placeholder={t('intake.other_placeholder')}
          className={base}
          style={style}
        />
      )}
    </div>
  );
}

/**
 * Pick one, with an optional "Other".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A component rather than a branch inside the switch, because "is Other
 * chosen?" needs STATE and a switch case cannot hold a hook.
 *
 * Inferring it from the value alone does not work, and the failure is instant:
 * choosing Other has to clear whatever was picked before — one answer to a
 * pick-one question — and the moment the value is empty, "not one of the listed
 * options" stops being true. The box opens and closes in the same click.
 *
 * So the choice is remembered, and the value stays the plain text the client
 * typed. Seeded from the value on mount so a part-filled form reopens showing
 * what they wrote.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function SingleChoiceAnswer({
  question,
  value,
  onChange,
  style,
  base,
  t,
}: {
  question: IntakeQuestion;
  value: string;
  onChange: (value: unknown) => void;
  style: React.CSSProperties;
  base: string;
  t: (key: string) => string;
}) {
  const labels = new Set((question.options ?? []).map(option => option.label));
  const [otherChosen, setOtherChosen] = useState(value !== '' && !labels.has(value));

  return (
    <div className="space-y-1.5">
      {(question.options ?? []).map(option => {
        const on = !otherChosen && value === option.label;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setOtherChosen(false);
              onChange(option.label);
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm transition-colors"
            style={{ ...style, borderColor: on ? 'var(--ap-brand)' : style.borderColor }}
          >
            <span
              className="h-3.5 w-3.5 flex-shrink-0 rounded-full"
              style={{
                border: `2px solid ${on ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                background: on
                  ? 'radial-gradient(circle, var(--ap-brand) 0 40%, transparent 45%)'
                  : 'transparent',
              }}
            />
            {option.label}
          </button>
        );
      })}

      {question.allowOther && (
        <OtherAnswer
          selected={otherChosen}
          text={otherChosen ? value : ''}
          onSelect={() => {
            setOtherChosen(true);
            // Clears the previous pick: one answer to a pick-one question.
            onChange('');
          }}
          onText={onChange}
          style={style}
          base={base}
          t={t}
        />
      )}
    </div>
  );
}

/**
 * Pick several, with an optional "Other".
 *
 * The same reasoning as above, with one extra wrinkle: the free-text entry
 * lives in the same array as the chosen options, so it is identified as the one
 * entry matching no option. An empty Other is held in state rather than as a
 * blank string in the array — a `''` sitting in the answers would satisfy a
 * required question while saying nothing.
 */
function MultiChoiceAnswer({
  question,
  value,
  onChange,
  style,
  base,
  t,
}: {
  question: IntakeQuestion;
  value: string[];
  onChange: (value: unknown) => void;
  style: React.CSSProperties;
  base: string;
  t: (key: string) => string;
}) {
  const labels = new Set((question.options ?? []).map(option => option.label));
  const existingOther = value.find(entry => !labels.has(entry));
  const [otherChosen, setOtherChosen] = useState(existingOther !== undefined);

  const chosenOptions = value.filter(entry => labels.has(entry));

  return (
    <div className="space-y-1.5">
      {(question.options ?? []).map(option => {
        const on = value.includes(option.label);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() =>
              onChange(
                on ? value.filter(item => item !== option.label) : [...value, option.label]
              )
            }
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm transition-colors"
            style={{ ...style, borderColor: on ? 'var(--ap-brand)' : style.borderColor }}
          >
            <span
              className="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
              style={{
                border: `2px solid ${on ? 'var(--ap-brand)' : 'var(--ap-border)'}`,
                background: on ? 'var(--ap-brand)' : 'transparent',
              }}
            />
            {option.label}
          </button>
        );
      })}

      {question.allowOther && (
        <OtherAnswer
          selected={otherChosen}
          text={existingOther ?? ''}
          onSelect={() => {
            if (otherChosen) {
              setOtherChosen(false);
              // Drop the typed entry with the tick, not just the box.
              onChange(chosenOptions);
            } else {
              setOtherChosen(true);
            }
          }}
          onText={next =>
            onChange(next.trim() ? [...chosenOptions, next] : chosenOptions)
          }
          style={style}
          base={base}
          t={t}
        />
      )}
    </div>
  );
}

export function IntakeAnswerField({ question, value, invalid, token, onChange, t }: Props) {
  const base = 'w-full px-3 py-2.5 text-sm outline-none transition-colors';
  const style = { ...fieldStyle, borderColor: invalid ? '#DC2626' : 'var(--ap-border)' };

  switch (question.type) {
    case 'long_text':
      return (
        <textarea
          id={question.id}
          rows={4}
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          className={`${base} resize-none`}
          style={style}
        />
      );

    case 'yes_no':
      return (
        <div className="flex gap-2">
          {[true, false].map(option => (
            <button
              key={String(option)}
              type="button"
              onClick={() => onChange(option)}
              className="flex-1 px-3 py-2.5 text-sm transition-colors"
              style={{
                ...style,
                borderColor: value === option ? 'var(--ap-brand)' : style.borderColor,
                color: value === option ? 'var(--ap-brand)' : 'var(--ap-text)',
                fontWeight: value === option ? 600 : 400,
              }}
            >
              {option ? t('yes') : t('no')}
            </button>
          ))}
        </div>
      );

    case 'single_choice':
      return (
        <SingleChoiceAnswer
          question={question}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          style={style}
          base={base}
          t={t}
        />
      );

    case 'multi_choice':
      return (
        <MultiChoiceAnswer
          question={question}
          // Always an array, even for one answer. A value that is sometimes a
          // string and sometimes a list is the shape that breaks whoever reads
          // the submission later.
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          style={style}
          base={base}
          t={t}
        />
      );

    case 'date':
      return (
        <input
          id={question.id}
          type="date"
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          className={base}
          style={style}
          // Dates are read left to right in every locale this serves.
          dir="ltr"
        />
      );

    case 'number':
      return (
        <input
          id={question.id}
          type="number"
          inputMode="numeric"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={base}
          style={style}
          dir="ltr"
        />
      );

    case 'file':
      return <FileAnswer question={question} value={value} token={token} onChange={onChange} t={t} />;

    case 'short_text':
    default:
      return (
        <input
          id={question.id}
          type="text"
          value={(value as string) || ''}
          onChange={e => onChange(e.target.value)}
          className={base}
          style={style}
        />
      );
  }
}

/**
 * Photographs and documents from someone who is not signed in.
 *
 * The upload goes through a route that checks the same booking token this page
 * was opened with — never a public signed URL, which would be a write anyone
 * could make. What comes back is a document id, and the answer stores that
 * rather than a URL: the file lives in the client's Files tab from the moment
 * it lands, and one id is the whole link between the two.
 */
function FileAnswer({
  question,
  value,
  token,
  onChange,
  t,
}: {
  question: IntakeQuestion;
  value: unknown;
  token: string;
  onChange: (value: unknown) => void;
  t: (key: string) => string;
}) {
  const files: UploadedFile[] = Array.isArray(value) ? (value as UploadedFile[]) : [];
  const max = question.maxFiles ?? 1;

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (list: FileList) => {
    setUploading(true);
    setUploadError(null);

    try {
      const room = max - files.length;
      const added: UploadedFile[] = [];

      // One at a time, and stopping at the limit rather than uploading files
      // that would then be refused — a client watching a spinner for a photo
      // that is discarded has been lied to.
      for (const file of Array.from(list).slice(0, room)) {
        const body = new FormData();
        body.append('file', file);
        body.append('questionId', question.id);

        const response = await fetch(`/api/book/manage/${token}/intake/upload`, {
          method: 'POST',
          body,
        });
        const result = await response.json();

        if (!result.success) {
          /*
           * The page owns the wording, the API owns the reason.
           *
           * `result.error` is an English sentence written for a log. Showing it
           * put "That file type is not accepted" in front of a client reading a
           * Hebrew form. The code is what crosses the wire; the translation
           * lives here, with every other word this page says.
           */
          const CODES: Record<string, string> = {
            file_too_large: 'fileTooLarge',
            file_type: 'fileTypeNotAccepted',
            no_file: 'uploadFailed',
            unknown_question: 'uploadFailed',
            cancelled: 'uploadNotCollecting',
            already_submitted: 'uploadNotCollecting',
            not_collecting: 'uploadNotCollecting',
          };
          setUploadError(t(CODES[result.code as string] || 'uploadFailed'));
          break;
        }
        added.push({ documentId: result.data.documentId, name: file.name });
      }

      if (added.length) onChange([...files, ...added]);
    } catch (err) {
      logger.error({ err }, 'Intake file upload failed');
      setUploadError(t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {files.map(file => (
        <div
          key={file.documentId}
          className="flex items-center gap-2 px-3 py-2 text-sm"
          style={fieldStyle}
        >
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onChange(files.filter(item => item.documentId !== file.documentId))}
            style={{ color: 'var(--ap-text-muted)' }}
            aria-label={t('remove')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {files.length < max && (
        <label
          className="flex cursor-pointer items-center justify-center gap-2 border-dashed px-3 py-4 text-sm"
          style={{ ...fieldStyle, borderStyle: 'dashed', color: 'var(--ap-text-muted)' }}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? t('uploading') : t('chooseFile')}
          <input
            type="file"
            className="hidden"
            // The same list the route enforces, so the picker does not offer a
            // file that is about to be refused.
            accept={INTAKE_UPLOAD_ACCEPT}
            multiple={max > 1}
            disabled={uploading}
            onChange={e => {
              if (e.target.files?.length) void upload(e.target.files);
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = '';
            }}
          />
        </label>
      )}

      {uploadError && (
        <p className="text-xs" style={{ color: '#DC2626' }}>
          {uploadError}
        </p>
      )}
    </div>
  );
}
