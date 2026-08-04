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

const SOURCE_OPTIONS = [
  { value: 'google', labelKey: 'crm.source.google', icon: SearchIcon },
  { value: 'facebook', labelKey: 'crm.source.facebook', icon: Facebook },
  { value: 'instagram', labelKey: 'crm.source.instagram', icon: MessageCircle },
  { value: 'website', labelKey: 'crm.source.website', icon: Globe },
  { value: 'referral', labelKey: 'crm.source.referral', icon: UsersIcon },
  { value: 'phone_call', labelKey: 'crm.source.phone_call', icon: PhoneIcon },
  { value: 'in_person', labelKey: 'crm.source.in_person', icon: User }
];

interface ClientDetailsSectionProps {
  formData: ContactFormData;
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
          <div className="flex flex-wrap gap-2">
            {stages.map(stage => (
              <button
                key={stage.stage_key}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, stage: stage.stage_key }))}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border transition-all rounded-full ${
                  formData.stage === stage.stage_key
                    ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                    : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: stage.color || '#64748B' }}
                />
                {t(`crm.stage.${stage.stage_key}`) !== `crm.stage.${stage.stage_key}`
                  ? t(`crm.stage.${stage.stage_key}`)
                  : stage.stage_label}
                {formData.stage === stage.stage_key && <Check className="h-3 w-3" />}
              </button>
            ))}
          </div>
        </div>

        {/* Source */}
        <div>
          <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border transition-all rounded-full ${
                    formData.source === source.value
                      ? 'border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:border-[#8B5CF6]/50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(source.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tags */}
        <div>
          <Label className="text-[var(--v2-text-secondary)] mb-2 block text-start">
            {t('crm.modal.tags')}
          </Label>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {formData.tags.map(tag => (
                <Badge key={tag} className="bg-[#8B5CF6]/20 text-[#8B5CF6] border-[#8B5CF6]/30 gap-1 px-2 py-0.5">
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
