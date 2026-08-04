'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Mail, User, Bot, Globe, Facebook, Search as SearchIcon, Users as UsersIcon, Phone as PhoneIcon, MessageCircle, Check, AlertCircle, Loader2 } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { SearchableCountrySelect } from './SearchableCountrySelect';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMContact } from '@/lib/repositories/CRMContactRepository';
import type { CRMActivity } from '@/lib/repositories/CRMActivityRepository';
import type { CRMPipelineStage } from '@/lib/repositories/CRMPipelineStagesRepository';
import type { Country } from 'react-phone-number-input';

interface CRMContactModalProps {
  contact?: CRMContact;
  stages: CRMPipelineStage[];
  isOpen: boolean;
  onClose: () => void;
  onContactUpdated: () => void;
  prefill?: Record<string, any>; // Pre-fill values for new contact (from chat)
}

const SOURCE_OPTIONS = [
  { value: 'google', labelKey: 'crm.source.google', icon: SearchIcon },
  { value: 'facebook', labelKey: 'crm.source.facebook', icon: Facebook },
  { value: 'instagram', labelKey: 'crm.source.instagram', icon: MessageCircle },
  { value: 'website', labelKey: 'crm.source.website', icon: Globe },
  { value: 'referral', labelKey: 'crm.source.referral', icon: UsersIcon },
  { value: 'phone_call', labelKey: 'crm.source.phone_call', icon: PhoneIcon },
  { value: 'in_person', labelKey: 'crm.source.in_person', icon: User }
];

export function CRMContactModal({ contact, stages, isOpen, onClose, onContactUpdated, prefill }: CRMContactModalProps) {
  const { t } = useLanguage();
  // Use first stage as default, or empty string if no stages
  const defaultStage = stages.length > 0 ? stages[0].stage_key : '';
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    stage: defaultStage,
    source: '',
    tags: [] as string[],
    custom_fields: {}
  });
  const [newTag, setNewTag] = useState('');
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<Country>('US');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [duplicateContact, setDuplicateContact] = useState<{ id: string; first_name?: string; last_name?: string; email: string } | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  useEffect(() => {
    if (contact) {
      setFormData({
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        email: contact.email || '',
        phone: contact.phone || '',
        stage: contact.stage,
        source: contact.source || '',
        tags: contact.tags || [],
        custom_fields: contact.custom_fields || {}
      });
      fetchActivities(contact.id);
    } else {
      // For new contacts, apply prefill values from chat if provided
      setFormData({
        first_name: prefill?.first_name || '',
        last_name: prefill?.last_name || '',
        email: prefill?.email || '',
        phone: prefill?.phone || '',
        stage: prefill?.stage || defaultStage,
        source: prefill?.source || '',
        tags: prefill?.tags || [],
        custom_fields: prefill?.custom_fields || {}
      });
    }
  }, [contact, prefill, defaultStage]);

  const fetchActivities = async (contactId: string) => {
    try {
      setLoadingActivities(true);
      const response = await fetch(`/api/crm/activities?contact_id=${contactId}&limit=10`);
      const data = await response.json();

      if (data.success) {
        setActivities(data.activities);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoadingActivities(false);
    }
  };

  // Debounced email duplicate check
  const checkEmailDuplicate = useCallback(async (email: string) => {
    // Don't check if editing existing contact with same email
    if (contact && contact.email === email) {
      setDuplicateContact(null);
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setDuplicateContact(null);
      return;
    }

    setCheckingEmail(true);
    try {
      const response = await fetch(`/api/crm/contacts/check-email?email=${encodeURIComponent(email)}`);
      const data = await response.json();

      if (data.success && data.exists) {
        setDuplicateContact(data.contact);
      } else {
        setDuplicateContact(null);
      }
    } catch (error) {
      console.error('Failed to check email:', error);
      setDuplicateContact(null);
    } finally {
      setCheckingEmail(false);
    }
  }, [contact]);

  // Debounce email check
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.email) {
        checkEmailDuplicate(formData.email);
      } else {
        setDuplicateContact(null);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [formData.email, checkEmailDuplicate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const url = contact ? `/api/crm/contacts/${contact.id}` : '/api/crm/contacts';
      const method = contact ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccessMessage(contact ? t('crm.modal.contact_updated') : t('crm.modal.contact_created'));
        onContactUpdated();
        setTimeout(() => {
          onClose();
        }, 1500);
      } else if (data.error === 'duplicate_email' && data.existingContact) {
        // Handle duplicate email error with existing contact info
        const existingName = [data.existingContact.first_name, data.existingContact.last_name]
          .filter(Boolean)
          .join(' ') || data.existingContact.email;
        setErrorMessage(
          t('crm.modal.duplicate_email_details').replace('{name}', existingName)
        );
      } else {
        setErrorMessage(data.error || t('crm.modal.save_error'));
      }
    } catch (error) {
      console.error('Failed to save contact:', error);
      setErrorMessage(t('crm.modal.save_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full sm:max-w-3xl h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col bg-[var(--v2-bg)] p-0 overflow-hidden">
        {/* Sticky Header */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 bg-[var(--v2-bg)]">
          <DialogHeader className="rtl:text-right">
            <DialogTitle className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
              {contact ? t('crm.modal.edit_contact') : t('crm.modal.new_contact')}
            </DialogTitle>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Success/Error Messages */}
          {successMessage && (
            <div className="p-4 bg-green-500/20 border border-green-500/40 text-green-600 dark:text-green-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="p-4 bg-red-500/20 border border-red-500/40 text-red-600 dark:text-red-400 text-sm font-medium" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              {errorMessage}
            </div>
          )}

          {/* Personal Information Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide">
              {t('crm.modal.personal_info')}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <Label htmlFor="first_name" className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mb-1.5 sm:mb-2 block">
                  {t('crm.modal.first_name')} <span className="text-red-500 dark:text-red-400">*</span>
                </Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                  placeholder={t('crm.modal.first_name_placeholder')}
                  required
                  className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                />
              </div>
              <div>
                <Label htmlFor="last_name" className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mb-1.5 sm:mb-2 block">
                  {t('crm.modal.last_name')} <span className="text-red-500 dark:text-red-400">*</span>
                </Label>
                <Input
                  id="last_name"
                  value={formData.last_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                  placeholder={t('crm.modal.last_name_placeholder')}
                  required
                  className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email" className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mb-1.5 sm:mb-2 block">
                {t('crm.modal.email')} <span className="text-red-500 dark:text-red-400">*</span>
              </Label>
              <div className="relative">
                <Mail className="absolute start-2.5 sm:start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-[var(--v2-text-muted)]" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder={t('crm.modal.email_placeholder')}
                  required
                  className={`ps-9 sm:ps-10 pe-9 sm:pe-10 text-sm bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6] ${
                    duplicateContact ? 'border-amber-500 focus:border-amber-500 focus:ring-amber-500' : ''
                  }`}
                />
                {checkingEmail && (
                  <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)] animate-spin" />
                )}
                {!checkingEmail && duplicateContact && (
                  <AlertCircle className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-500" />
                )}
              </div>
              {duplicateContact && (
                <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-600 dark:text-amber-400">
                        {t('crm.modal.email_exists_warning')}
                      </p>
                      <p className="text-[var(--v2-text-secondary)] mt-1">
                        {t('crm.modal.duplicate_email_details').replace(
                          '{name}',
                          [duplicateContact.first_name, duplicateContact.last_name].filter(Boolean).join(' ') || duplicateContact.email
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="phone" className="text-[var(--v2-text-secondary)] mb-2 block">
                {t('crm.modal.phone')} <span className="text-red-500 dark:text-red-400">*</span>
              </Label>
              <div className="flex gap-2" dir="ltr">
                <SearchableCountrySelect
                  value={phoneCountry}
                  onChange={setPhoneCountry}
                  labels={en}
                />
                <PhoneInput
                  international
                  countryCallingCodeEditable={false}
                  country={phoneCountry}
                  value={formData.phone}
                  onChange={(value) => setFormData(prev => ({ ...prev, phone: value || '' }))}
                  className="phone-input-crm flex-1"
                />
              </div>
            </div>
          </div>

          {/* Contact Details Section */}
          <div className="space-y-4 pt-4 border-t border-[var(--v2-border)]">
            <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide">
              {t('crm.modal.contact_details')}
            </h3>

            {/* Pipeline Stage - Clickable Items */}
            <div>
              <Label className="text-[var(--v2-text-secondary)] mb-2 block">
                {t('crm.modal.pipeline_stage')}
              </Label>
              <div className="flex flex-wrap gap-2">
                {stages.map(stage => (
                  <button
                    key={stage.stage_key}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, stage: stage.stage_key }))}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border transition-all ${
                      formData.stage === stage.stage_key
                        ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                        : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: stage.color || '#64748B' }}
                    />
                    {t(`crm.stage.${stage.stage_key}`) !== `crm.stage.${stage.stage_key}`
                      ? t(`crm.stage.${stage.stage_key}`)
                      : stage.stage_label}
                    {formData.stage === stage.stage_key && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Source - Clickable Items */}
            <div>
              <Label className="text-[var(--v2-text-secondary)] mb-2 block">
                {t('crm.modal.how_found')}
              </Label>
              <div className="flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map(source => {
                  const Icon = source.icon;
                  return (
                    <button
                      key={source.value}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, source: source.value }))}
                      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border transition-all ${
                        formData.source === source.value
                          ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                          : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <Icon className="h-4 w-4" />
                      {t(source.labelKey)}
                      {formData.source === source.value && <Check className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags */}
            <div>
              <Label className="text-[var(--v2-text-secondary)] mb-2 block">
                {t('crm.modal.tags')}
              </Label>
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 p-3 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                  {formData.tags.map(tag => (
                    <Badge key={tag} className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 gap-1 px-3 py-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:bg-[#8B5CF6]/30 rounded-full p-0.5 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                  placeholder={t('crm.modal.add_tag_placeholder')}
                  className="flex-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] focus:ring-[#8B5CF6]"
                />
                <Button
                  type="button"
                  onClick={handleAddTag}
                  className="px-4 text-[#8B5CF6] border border-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20"
                >
                  <Plus className="h-4 w-4 me-1" />
                  {t('crm.modal.add_tag')}
                </Button>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {contact && (
            <div className="pt-4 border-t border-[var(--v2-border)]">
              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)] uppercase tracking-wide mb-3">
                {t('crm.modal.recent_activity')}
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 rounded-lg">
                {loadingActivities ? (
                  <div className="text-sm text-[var(--v2-text-muted)] text-center py-8">
                    {t('crm.modal.loading_activities')}
                  </div>
                ) : activities.length > 0 ? (
                  activities.map(activity => (
                    <div key={activity.id} className="border-l-2 border-[#8B5CF6] pl-3 pb-3 last:pb-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-[var(--v2-text-primary)] text-sm">
                          {activity.title}
                        </span>
                        {activity.auto_logged && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <Bot className="h-3 w-3" />
                            {t('crm.activity.auto')}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[var(--v2-text-muted)] text-xs">
                        {formatDate(activity.activity_date)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[var(--v2-text-muted)] text-center py-8">
                    {t('crm.modal.no_activity')}
                  </div>
                )}
              </div>
            </div>
          )}
          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 flex justify-end gap-3 p-6 border-t border-[var(--v2-border)] bg-[var(--v2-bg)] [dir=rtl]:flex-row-reverse">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="px-6 border-[var(--v2-border)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]"
            >
              {t('button.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={loading || !formData.first_name || !formData.last_name || !formData.email || !formData.phone}
              className="px-6 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)'
              }}
            >
              {loading ? t('crm.modal.saving') : contact ? t('crm.modal.save_changes') : t('crm.modal.create_contact')}
            </Button>
          </div>
        </form>

        <style jsx global>{`
          /* react-phone-number-input custom styling for V2 design system */
          .phone-input-crm {
            display: flex;
          }

          .phone-input-crm .PhoneInputCountry {
            display: none;
          }

          .phone-input-crm .PhoneInputInput {
            flex: 1;
            background: var(--v2-surface);
            border: 1px solid var(--v2-border);
            border-radius: var(--v2-radius-button);
            padding: 0.5rem 0.75rem;
            color: var(--v2-text-primary);
            font-size: 0.875rem;
            outline: none;
            transition: all 0.2s ease;
          }

          .phone-input-crm .PhoneInputInput:focus {
            border-color: #8B5CF6;
            box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
          }

          .phone-input-crm .PhoneInputInput::placeholder {
            color: var(--v2-text-muted);
          }

          /* Dialog header RTL support */
          [dir="rtl"] .DialogHeader {
            flex-direction: row-reverse;
          }

          [dir="rtl"] .DialogTitle {
            order: 2;
          }

          [dir="rtl"] .DialogHeader button {
            order: 1;
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
