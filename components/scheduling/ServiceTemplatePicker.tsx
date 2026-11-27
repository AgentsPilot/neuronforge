'use client';

/**
 * "What are you selling?" — the screen in front of a new service's wizard.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two views in one panel: the cards, then one card opened up — what the client
 * goes through, what the business needs ready (live, already ticked where it
 * is done), and what will be filled in. "Start with this" hands the template
 * back to the services list, which applies it and opens the wizard unchanged.
 *
 * Nothing here decides a rule. The cards come from `templatesFor`, the
 * checklist from `serviceRequirements` run on the template's own answers, and
 * "done" from the list's `requirementMet` — the same three the publish step
 * reads, so this screen cannot promise what publishing would refuse.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module components/scheduling
 */

import { useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Layers,
  GraduationCap,
  FileText,
  MessageCircle,
  Check,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { gapFixAction } from '@/lib/business-os/journeyGapFix';
import type { WizardValues } from '@/lib/business-os/serviceWizard';
import {
  applyServiceTemplate,
  templateRequirements,
  templatesFor,
  type ServiceTemplateId,
} from '@/lib/business-os/serviceTemplates';
import type { ServiceRequirementId } from '@/lib/business-os/setup/serviceRequirements';

const ICON: Record<ServiceTemplateId, LucideIcon> = {
  appointment: CalendarDays,
  package: Layers,
  course: GraduationCap,
  quote: FileText,
  intro_call: MessageCircle,
};

export interface ServiceTemplatePickerProps {
  /** The new service's current answers, which a template is applied on top of. */
  baseValues: WizardValues;
  /** Working hours exist. `null` while unknown, which offers every card. */
  hasCalendar: boolean | null;
  /** The services list's own answer, shared with its publish step. */
  requirementMet: (id: ServiceRequirementId) => boolean;
  /** Opens the panel that clears a requirement, where this surface has one. */
  openRequirement?: (id: ServiceRequirementId) => void;
  onStart: (id: ServiceTemplateId) => void;
  /** Straight to the wizard with nothing pre-filled, exactly as before. */
  onSkip: () => void;
  /** Abandon the new service, as the wizard's own Cancel does. */
  onCancel: () => void;
}

export function ServiceTemplatePicker({
  baseValues,
  hasCalendar,
  requirementMet,
  openRequirement,
  onStart,
  onSkip,
  onCancel,
}: ServiceTemplatePickerProps) {
  const { t, isRTL } = useLanguage();
  const [chosen, setChosen] = useState<ServiceTemplateId | null>(null);

  const label = (key: string) => t(`config.services.templates.${key}`);
  const templates = templatesFor(hasCalendar);

  /* ── One card opened up ─────────────────────────────────────────────────── */
  if (chosen) {
    const Icon = ICON[chosen];
    /* The checklist for the service once priced — see `templateRequirements`. */
    const needs = templateRequirements(applyServiceTemplate(baseValues, chosen));

    return (
      <div className="flex flex-1 flex-col min-h-0" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 border-b border-[var(--v2-border)] px-4 py-3">
          <button
            type="button"
            onClick={() => setChosen(null)}
            aria-label={label('back')}
            className="flex h-9 w-9 items-center justify-center text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
          </button>
          <Icon className="h-4 w-4 text-[var(--v2-primary)]" />
          <h3 className="m-0 text-sm font-semibold text-[var(--v2-text-primary)]">
            {label(`${chosen}.label`)}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <section>
            <h4 className="m-0 mb-2 text-xs font-semibold text-[var(--v2-text-primary)]">
              {label('journey_title')}
            </h4>
            <ol className="m-0 list-none space-y-2 p-0">
              {[1, 2, 3].map(n => (
                <li key={n} className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: 'var(--v2-bg)', color: 'var(--v2-primary)', border: '1px solid var(--v2-border)' }}
                  >
                    {n}
                  </span>
                  <span className="text-[12.5px] leading-snug text-[var(--v2-text-secondary)]">
                    {label(`${chosen}.step${n}`)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h4 className="m-0 mb-2 text-xs font-semibold text-[var(--v2-text-primary)]">
              {label('needs_title')}
            </h4>
            {needs.length === 0 ? (
              <p className="m-0 text-[12.5px] text-[var(--v2-text-secondary)]">{label('needs_none')}</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {needs.map(id => {
                  const met = requirementMet(id);
                  const fix = gapFixAction(id === 'invoice' ? 'invoicing' : id === 'hours' ? 'hours' : 'processor');
                  const fixLabel = t(fix.key) === fix.key ? fix.fallback : t(fix.key);

                  return (
                    <li
                      key={id}
                      className="flex items-start gap-2.5 px-3 py-2.5"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        border: met ? '1px solid rgba(34, 197, 139, 0.35)' : '1px solid rgba(240, 163, 60, 0.45)',
                        background: met ? 'rgba(34, 197, 139, 0.08)' : 'rgba(240, 163, 60, 0.08)',
                      }}
                    >
                      {met
                        ? <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                        : <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />}
                      <div className="min-w-0 flex-1">
                        {/* The publish step's own wording for the same row. */}
                        <p className="m-0 text-[12.5px] font-medium text-[var(--v2-text-primary)]">
                          {t(`config.services.needs.${id}`)}
                        </p>
                        <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-[var(--v2-text-secondary)]">
                          {met ? t(`config.services.needs.${id}.done`) : t(`config.services.needs.${id}.why`)}
                        </p>
                      </div>
                      {!met && openRequirement && (
                        <button
                          type="button"
                          onClick={() => openRequirement(id)}
                          className="flex-shrink-0 px-2.5 py-1.5 text-[11.5px] font-semibold"
                          style={{ borderRadius: 'var(--v2-radius-button)', background: 'var(--v2-primary)', color: '#fff' }}
                        >
                          {fixLabel}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section
            className="px-3 py-2.5"
            style={{ borderRadius: 'var(--v2-radius-button)', background: 'var(--v2-bg)', border: '1px solid var(--v2-border)' }}
          >
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
              {label('prefill_title')}
            </p>
            <p className="m-0 mt-1 text-[12.5px] leading-snug text-[var(--v2-text-secondary)]">
              {label(`${chosen}.prefill`)}
            </p>
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--v2-border)] px-4 py-3">
          <button
            type="button"
            onClick={() => setChosen(null)}
            className="px-3 py-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
          >
            {label('back')}
          </button>
          <button
            type="button"
            onClick={() => onStart(chosen)}
            className="px-4 py-2 text-sm font-semibold ap-primary-lift"
            style={{ borderRadius: 'var(--v2-radius-button)', background: 'var(--v2-primary)', color: '#fff' }}
          >
            {label('start')}
          </button>
        </div>
      </div>
    );
  }

  /* ── The cards ──────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-1 flex-col min-h-0" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="border-b border-[var(--v2-border)] px-4 py-3">
        <h3 className="m-0 text-sm font-semibold text-[var(--v2-text-primary)]">{label('title')}</h3>
        <p className="m-0 mt-0.5 text-[12px] leading-snug text-[var(--v2-text-secondary)]">{label('intro')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {templates.map(template => {
            const Icon = ICON[template.id];
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => setChosen(template.id)}
                className="flex flex-col items-start gap-1.5 border border-[var(--v2-border)] bg-[var(--v2-bg)] p-3 text-start transition-colors hover:border-[var(--v2-primary)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Icon className="h-4 w-4 text-[var(--v2-primary)]" />
                <span className="text-[13.5px] font-semibold text-[var(--v2-text-primary)]">
                  {label(`${template.id}.label`)}
                </span>
                <span className="text-[12px] leading-snug text-[var(--v2-text-secondary)]">
                  {label(`${template.id}.desc`)}
                </span>
                <span className="text-[11.5px] text-[var(--v2-text-muted)]">{label(`${template.id}.eg`)}</span>
              </button>
            );
          })}
        </div>

        {/* Said, not silently dropped: an owner who wanted appointments must be
            able to tell what would make them appear. */}
        {hasCalendar === false && (
          <div
            className="mt-3 flex items-start gap-2.5 border border-[var(--v2-border)] px-3 py-2.5"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--v2-text-muted)]" />
            <p className="m-0 flex-1 text-[12px] leading-snug text-[var(--v2-text-secondary)]">
              {label('no_calendar')}
            </p>
            {openRequirement && (
              <button
                type="button"
                onClick={() => openRequirement('hours')}
                className="flex-shrink-0 text-[12px] font-semibold text-[var(--v2-primary)]"
              >
                {label('set_hours')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--v2-border)] px-4 py-3">
        <button
          type="button"
          onClick={onSkip}
          className="text-[12.5px] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
        >
          {label('skip')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
        >
          {t('common.cancel') || 'Cancel'}
        </button>
      </div>
    </div>
  );
}
