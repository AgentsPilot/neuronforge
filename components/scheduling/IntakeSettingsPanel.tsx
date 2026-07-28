'use client';

import { useState, useEffect } from 'react';
import { ClipboardList, Check, Loader2, Eye, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'IntakeSettingsPanel' });

// Configuration theme color: Pink (#D14E97)
const CONFIG_COLOR = '#D14E97';

interface IntakeField {
  key: string;
  type: string;
  label_en: string;
  label_es: string;
  label_he: string;
  required: boolean;
  options?: Array<{
    value: string;
    label_en: string;
    label_es: string;
    label_he: string;
  }>;
  placeholder_en?: string;
  placeholder_es?: string;
  placeholder_he?: string;
}

interface IntakeTemplate {
  id: string;
  template_key: string;
  vertical: string;
  name_en: string;
  name_es: string;
  name_he: string;
  description_en: string | null;
  description_es: string | null;
  description_he: string | null;
  fields: IntakeField[];
  is_default: boolean;
  display_order: number;
}

interface IntakeSettings {
  is_enabled: boolean;
  template_id: string | null;
  template: IntakeTemplate | null;
  collect_during_booking: boolean;
  send_after_booking: boolean;
}

interface IntakeSettingsPanelProps {
  onSaved?: () => void;
}

export function IntakeSettingsPanel({ onSaved }: IntakeSettingsPanelProps) {
  const { t, language, isRTL } = useLanguage();

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [templates, setTemplates] = useState<IntakeTemplate[]>([]);
  const [settings, setSettings] = useState<IntakeSettings>({
    is_enabled: false,
    template_id: null,
    template: null,
    collect_during_booking: true,
    send_after_booking: false
  });
  const [previewTemplate, setPreviewTemplate] = useState<IntakeTemplate | null>(null);

  // Fetch data on mount
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch templates and settings in parallel
      const [templatesRes, settingsRes] = await Promise.all([
        fetch('/api/intake/templates'),
        fetch('/api/intake/settings')
      ]);

      const templatesData = await templatesRes.json();
      const settingsData = await settingsRes.json();

      if (templatesData.success) {
        setTemplates(templatesData.templates || []);
      }

      if (settingsData.success && settingsData.settings) {
        setSettings(settingsData.settings);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch intake data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaved(false);

      const response = await fetch('/api/intake/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: settings.template_id,
          is_enabled: settings.is_enabled,
          collect_during_booking: settings.collect_during_booking,
          send_after_booking: settings.send_after_booking
        })
      });

      const data = await response.json();

      if (data.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        onSaved?.();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save intake settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId) || null;
    setSettings(prev => ({
      ...prev,
      template_id: templateId,
      template
    }));
  };

  const handleToggleEnabled = () => {
    setSettings(prev => ({
      ...prev,
      is_enabled: !prev.is_enabled
    }));
  };

  const getLocalizedText = (obj: { en?: string; es?: string; he?: string } | null, prefix: string = '') => {
    if (!obj) return '';
    const key = `${prefix}${language}` as keyof typeof obj;
    return obj[key] || obj.en || '';
  };

  const getTemplateName = (template: IntakeTemplate) => {
    switch (language) {
      case 'es': return template.name_es;
      case 'he': return template.name_he;
      default: return template.name_en;
    }
  };

  const getTemplateDescription = (template: IntakeTemplate) => {
    switch (language) {
      case 'es': return template.description_es;
      case 'he': return template.description_he;
      default: return template.description_en;
    }
  };

  const getFieldLabel = (field: IntakeField) => {
    switch (language) {
      case 'es': return field.label_es;
      case 'he': return field.label_he;
      default: return field.label_en;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center space-y-4">
          <Loader2
            className="w-10 h-10 animate-spin mx-auto"
            style={{ color: CONFIG_COLOR }}
          />
          <p className="text-[var(--v2-text-muted)]">{t('common.loading') || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Enable Toggle */}
      <div
        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-5"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${CONFIG_COLOR}20` }}
            >
              <ClipboardList className="w-5 h-5" style={{ color: CONFIG_COLOR }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                {t('config.intake.title') || 'Intake Forms'}
              </h3>
              <p className="text-sm text-[var(--v2-text-muted)] mt-0.5">
                {t('config.intake.subtitle') || 'Collect information from clients before their appointment'}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleEnabled}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              settings.is_enabled ? '' : 'bg-[var(--v2-border)]'
            }`}
            style={{ backgroundColor: settings.is_enabled ? CONFIG_COLOR : undefined }}
          >
            <div
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                settings.is_enabled ? (isRTL ? 'left-1' : 'right-1') : (isRTL ? 'right-1' : 'left-1')
              }`}
            />
          </button>
        </div>
      </div>

      {/* Template Selection */}
      {settings.is_enabled && (
        <>
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {t('config.intake.select_template') || 'Select a template for your business type'}
            </h4>

            {templates.length === 0 ? (
              <div
                className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6 text-center"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <p className="text-sm text-[var(--v2-text-muted)]">
                  {t('config.intake.no_templates') || 'No templates available for your business type'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => {
                  const isSelected = settings.template_id === template.id;
                  const name = getTemplateName(template);
                  const description = getTemplateDescription(template);

                  return (
                    <div
                      key={template.id}
                      className={`bg-[var(--v2-bg)] border p-4 cursor-pointer transition-all hover:border-[#D14E97]/50 ${
                        isSelected ? 'border-[#D14E97]' : 'border-[var(--v2-border)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-card)' }}
                      onClick={() => handleTemplateSelect(template.id)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Radio button */}
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isSelected ? 'border-[#D14E97]' : 'border-[var(--v2-border)]'
                          }`}
                        >
                          {isSelected && (
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: CONFIG_COLOR }}
                            />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h5 className="text-sm font-medium text-[var(--v2-text-primary)]">
                              {name}
                            </h5>
                            {template.is_default && (
                              <span
                                className="text-xs px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: `${CONFIG_COLOR}20`, color: CONFIG_COLOR }}
                              >
                                {t('config.intake.default') || 'Default'}
                              </span>
                            )}
                          </div>
                          {description && (
                            <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                              {description}
                            </p>
                          )}
                          <p className="text-xs text-[var(--v2-text-muted)] mt-2">
                            {template.fields.length} {t('config.intake.fields') || 'fields'}
                          </p>
                        </div>

                        {/* Preview button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewTemplate(template);
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-all"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {t('config.intake.preview') || 'Preview'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Collection Options */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-[var(--v2-text-secondary)]">
              {t('config.intake.when_collect') || 'When to collect'}
            </h4>

            <div
              className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-4 space-y-4"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              {/* During booking */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.collect_during_booking}
                  onChange={() => setSettings(prev => ({ ...prev, collect_during_booking: !prev.collect_during_booking }))}
                  className="w-4 h-4 mt-0.5 rounded border-[var(--v2-border)] accent-[#D14E97]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {t('config.intake.during_booking') || 'During booking (before confirmation)'}
                  </p>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                    {t('config.intake.during_booking_desc') || 'Clients fill out the form as part of the booking process'}
                  </p>
                </div>
              </label>

              {/* After booking */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.send_after_booking}
                  onChange={() => setSettings(prev => ({ ...prev, send_after_booking: !prev.send_after_booking }))}
                  className="w-4 h-4 mt-0.5 rounded border-[var(--v2-border)] accent-[#D14E97]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {t('config.intake.after_booking') || 'Send link after booking (via email)'}
                  </p>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                    {t('config.intake.after_booking_desc') || 'Send an email with a link to the intake form after booking confirmation'}
                  </p>
                </div>
              </label>
            </div>
          </div>
        </>
      )}

      {/* Save Button */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--v2-border)]">
        {saved && (
          <span className="text-sm font-medium flex items-center gap-1.5" style={{ color: CONFIG_COLOR }}>
            <Check className="h-4 w-4" />
            {t('config.intake.saved') || 'Saved'}
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium border transition-all disabled:opacity-50"
          style={{
            borderRadius: 'var(--v2-radius-button)',
            color: CONFIG_COLOR,
            borderColor: CONFIG_COLOR,
            backgroundColor: `${CONFIG_COLOR}10`
          }}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.saving') || 'Saving...'}
            </>
          ) : (
            t('config.intake.save') || 'Save Settings'
          )}
        </button>
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => setPreviewTemplate(null)}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
              onClick={(e) => e.stopPropagation()}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {getTemplateName(previewTemplate)}
                </h3>
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all rounded-lg"
                >
                  ×
                </button>
              </div>

              <div className="space-y-4">
                {previewTemplate.fields.map((field, index) => (
                  <div key={field.key} className="space-y-1.5">
                    <label className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {getFieldLabel(field)}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>

                    {field.type === 'text' && (
                      <input
                        type="text"
                        disabled
                        className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-muted)]"
                        placeholder={field[`placeholder_${language}` as keyof IntakeField] as string || ''}
                      />
                    )}

                    {field.type === 'textarea' && (
                      <textarea
                        disabled
                        rows={3}
                        className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-muted)] resize-none"
                        placeholder={field[`placeholder_${language}` as keyof IntakeField] as string || ''}
                      />
                    )}

                    {field.type === 'select' && field.options && (
                      <select
                        disabled
                        className="w-full px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-muted)]"
                      >
                        <option value="">{t('common.select') || 'Select...'}</option>
                        {field.options.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt[`label_${language}` as keyof typeof opt] || opt.label_en}
                          </option>
                        ))}
                      </select>
                    )}

                    {field.type === 'radio' && field.options && (
                      <div className="space-y-2">
                        {field.options.map(opt => (
                          <label key={opt.value} className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                            <input type="radio" disabled className="accent-[#D14E97]" />
                            {opt[`label_${language}` as keyof typeof opt] || opt.label_en}
                          </label>
                        ))}
                      </div>
                    )}

                    {field.type === 'checkbox' && (
                      <label className="flex items-center gap-2 text-sm text-[var(--v2-text-secondary)]">
                        <input type="checkbox" disabled className="accent-[#D14E97]" />
                        {getFieldLabel(field)}
                      </label>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="px-4 py-2 text-sm font-medium text-white transition-all"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    backgroundColor: CONFIG_COLOR
                  }}
                >
                  {t('common.close') || 'Close'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
