'use client';

/**
 * The description a service is missing, asked for where it is needed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A generated page is written FROM the service description. `serviceDescription`
 * goes straight into the generation prompt, and the hero, the benefits, the
 * questions and the pricing copy are all drawn out of it — with nothing there
 * the generator is sent "No description provided" and the model writes a page
 * about a name. The business then sees a site that reads like it is about no
 * one, with nothing on screen explaining why.
 *
 * So both wizards stop and ask, rather than generating something and leaving
 * the business to work out what went wrong. It is one field, and it is the one
 * that decides everything downstream.
 *
 * It saves onto the SERVICE, not the page. The description belongs to the
 * service — the booking widget, the smart link, the pricing card and every
 * future page read the same field — so typing it here fixes it everywhere
 * rather than once.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ServiceDescriptionField' });

type Language = 'en' | 'es' | 'he';

const LABELS: Record<Language, {
  label: string;
  hint: string;
  placeholder: string;
  save: string;
  failed: string;
}> = {
  en: {
    label: 'Service description',
    hint: 'The page is written from this — the headline, the benefits, the questions and the pricing copy. A few sentences on what it is and who it is for.',
    placeholder: 'Describe what this service is, who it is for, and what someone gets from it…',
    save: 'Save',
    failed: 'We could not save the description. Nothing was changed — try again.',
  },
  es: {
    label: 'Descripción del servicio',
    hint: 'La página se escribe a partir de esto: el titular, los beneficios, las preguntas y el texto de precios. Unas frases sobre qué es y para quién.',
    placeholder: 'Describe qué es este servicio, para quién es y qué obtiene la persona…',
    save: 'Guardar',
    failed: 'No pudimos guardar la descripción. No se cambió nada — inténtalo de nuevo.',
  },
  he: {
    label: 'תיאור השירות',
    hint: 'הדף נכתב מזה — הכותרת, היתרונות, השאלות ותוכן המחירים. כמה משפטים על מה זה ולמי זה מיועד.',
    placeholder: 'תארו מה השירות הזה, למי הוא מיועד ומה מקבלים ממנו…',
    save: 'שמירה',
    failed: 'לא הצלחנו לשמור את התיאור. שום דבר לא שונה — נסו שוב.',
  },
};

export interface ServiceDescriptionFieldProps {
  service: { id: string; name: string };
  language?: Language;
  /** Called with the saved text so the wizard can update its own copy of the service. */
  onSaved: (serviceId: string, description: string) => void;
  autoFocus?: boolean;
}

export function ServiceDescriptionField({
  service,
  language = 'en',
  onSaved,
  autoFocus,
}: ServiceDescriptionFieldProps) {
  const labels = LABELS[language] || LABELS.en;
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const description = draft.trim();
    if (!description) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/scheduling/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!response.ok) {
        setError(labels.failed);
        return;
      }

      onSaved(service.id, description);
    } catch (err) {
      logger.error({ err, serviceId: service.id }, 'Failed to save service description');
      setError(labels.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3">
      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-1">
        {labels.label}
      </label>
      <p className="text-xs text-[var(--v2-text-secondary)] mb-2">{labels.hint}</p>
      <textarea
        rows={4}
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={labels.placeholder}
        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !draft.trim()}
        className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#4F6EF7] hover:bg-[#3D5BD9] disabled:opacity-50 transition-all"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {labels.save}
      </button>
    </div>
  );
}
