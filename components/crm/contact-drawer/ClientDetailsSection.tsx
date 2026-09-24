'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Mail, User, Globe, Facebook, Search as SearchIcon,
  Users as UsersIcon, Phone as PhoneIcon, MessageCircle,
  Plus, X, Check
} from 'lucide-react';
import PhoneInput, { getCountryCallingCode } from 'react-phone-number-input';
import type { Country } from 'react-phone-number-input';
import { SearchableCountrySelect } from '../SearchableCountrySelect';
import en from 'react-phone-number-input/locale/en';
import 'react-phone-number-input/style.css';
import { CollapsibleSection } from '../CollapsibleSection';

// Format phone number to E.164 if it's missing the + prefix
function formatToE164(phone: string | undefined, country: Country): string | undefined {
  if (!phone) return undefined;
  // Already in E.164 format
  if (phone.startsWith('+')) return phone;
  // Add country calling code
  try {
    const callingCode = getCountryCallingCode(country);
    return `+${callingCode}${phone.replace(/\D/g, '')}`;
  } catch {
    // If country code lookup fails, just prepend +
    return `+${phone.replace(/\D/g, '')}`;
  }
}
import type { ContactFormData, CRMPipelineStage } from './types';

// One list for every surface that shows a contact's source — see
// components/crm/contactSources.ts. Written out here and in CRMContactModal
// before, and neither copy knew about the values capture writes.
import {
  CONTACT_ORIGINS,
  contactOrigin,
  originOption,
  type ContactSourceMetadata,
} from '@/components/crm/contactSources';

interface ClientDetailsSectionProps {
  formData: ContactFormData;
  /**
   * How this contact was captured — which smart link, which page, a booking or
   * a form. Read-only: it is what the chip is DERIVED from and what the
   * breakdown line under it says, never something the drawer writes.
   */
  sourceMetadata?: ContactSourceMetadata | null;
  setFormData: React.Dispatch<React.SetStateAction<ContactFormData>>;
  stages: CRMPipelineStage[];
  t: (key: string) => string;
  isRTL: boolean;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

export function ClientDetailsSection({
  formData,
  sourceMetadata,
  setFormData,
  stages,
  t,
  isRTL,
  defaultOpen = false,
  isOpen,
  onToggle
}: ClientDetailsSectionProps) {
  const [phoneCountry, setPhoneCountry] = useState<Country>('US');
  const [newTag, setNewTag] = useState('');

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_details') || 'Details'}
      icon={<User className="h-4 w-4" />}
      defaultOpen={defaultOpen}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
    >
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Name fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="first_name" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
              {t('crm.modal.first_name')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="first_name"
              value={formData.first_name}
              onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
              placeholder={t('crm.modal.first_name_placeholder')}
              required
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
          </div>
          <div>
            <Label htmlFor="last_name" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
              {t('crm.modal.last_name')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="last_name"
              value={formData.last_name}
              onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
              placeholder={t('crm.modal.last_name_placeholder')}
              required
              className="bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <Label htmlFor="email" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.email')} <span className="text-red-500">*</span>
          </Label>
          <div className="relative">
            <Mail className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder={t('crm.modal.email_placeholder')}
              required
              className="ps-10 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
          </div>
        </div>

        {/* Phone */}
        <div>
          <Label htmlFor="phone" className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.phone')} <span className="text-red-500">*</span>
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
              value={formatToE164(formData.phone, phoneCountry)}
              onChange={(value) => setFormData(prev => ({ ...prev, phone: value || '' }))}
              className="phone-input-crm flex-1"
            />
          </div>
        </div>

        {/* Pipeline Stage */}
        <div>
          <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.pipeline_stage')}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {stages.map(stage => (
              <button
                key={stage.stage_key}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, stage: stage.stage_key }))}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[12.5px] font-medium border transition-all rounded-full ${
                  formData.stage === stage.stage_key
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                    : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                }`}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: stage.color || '#64748B' }}
                />
                {t(`crm.stage.${stage.stage_key}`) !== `crm.stage.${stage.stage_key}`
                  ? t(`crm.stage.${stage.stage_key}`)
                  : stage.stage_label}
                {formData.stage === stage.stage_key && <Check className="h-2.5 w-2.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Source */}
        <div>
          <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.how_found')}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {/*
              The chip is the GROUP — Website, not "Website Booking". Which page
              or which smart link is the line underneath, because with several
              landing pages the group alone is not an answer.

              Derived rather than compared to `formData.source` directly: a
              contact captured as `website_booking` has to light the Website
              chip, and before this nothing matched it and every chip sat dark.
            */}
            {CONTACT_ORIGINS.map(origin => {
              const Icon = origin.icon;
              const selected = contactOrigin(formData.source, sourceMetadata)?.group === origin.value;
              return (
                <button
                  key={origin.value}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, source: origin.value }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[12.5px] font-medium border transition-all rounded-full ${
                    selected
                      ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                  }`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  {t(origin.labelKey)}
                </button>
              );
            })}
          </div>
          {/*
            The line underneath: which property captured them, and — when a UTM
            tag is what decided the chip — that tag verbatim.

            The tag is the owner's receipt. They shared a link with UTM on it,
            and this is that link coming back with a client attached; without it
            there is no way to tell a tagged share that worked from one that was
            never clicked.
          */}
          {(() => {
            const origin = contactOrigin(formData.source, sourceMetadata);
            if (!origin) return null;

            const parts: string[] = [];

            // The surface, but only when it is not already the chip — otherwise
            // the line just repeats the word above it.
            if (origin.surface && origin.surface !== origin.group) {
              const option = originOption(origin.surface);
              if (option) parts.push(t(option.labelKey));
            }
            const detail = origin.detailText ?? (origin.detailKey ? t(origin.detailKey) : null);
            if (detail) parts.push(detail);
            if (origin.utm) parts.push(origin.utm);

            if (parts.length === 0) return null;
            return (
              <p className="mt-2 text-xs text-[var(--v2-text-muted)] text-start">
                {parts.join(' · ')}
              </p>
            );
          })()}
        </div>

        {/* Tags */}
        <div>
          <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.tags')}
          </Label>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {formData.tags.map(tag => (
                <Badge key={tag} className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 gap-1 px-2 py-0 text-[11.5px] leading-[1.7]">
                  {tag}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:bg-[#8B5CF6]/30 rounded-full p-px transition-colors shrink-0"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
              placeholder={t('crm.modal.add_tag_placeholder')}
              className="flex-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            />
            <Button
              type="button"
              onClick={handleAddTag}
              size="sm"
              className="px-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
}
