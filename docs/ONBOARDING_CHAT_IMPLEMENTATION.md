# Onboarding Chat Implementation Guide

> **Last Updated**: 2026-08-11
> **Status**: Implementation in progress

## Overview

This document provides a complete implementation guide for the enhanced conversational onboarding chat system that configures Business OS infrastructure through natural language interaction.

---

## Goals

1. **Conversational Setup**: Guide non-technical users through Business OS configuration via chat
2. **Essential Capabilities**: Configure business profile, CRM pipeline, and services
3. **AI-Powered Website**: Automatically generate complete website based on collected data
4. **Multi-Language & RTL**: Full support for English, Hebrew, and Spanish with proper RTL styling
5. **LLM for Understanding**: Use AI to parse intent and extract entities, but use structured data for configuration
6. **Multi-Session Support**: Allow users to exit and resume onboarding later

---

## Capabilities Configured During Onboarding

### Required Configuration (During Chat)

1. **Business Profile Core**
   - Company name
   - Vertical (therapist, coach, consultant, etc.)
   - Language (en, he, es)
   - Business description (for AI website generation)

2. **CRM Pipeline Stages**
   - Preset-based on vertical selection
   - Therapist: Inquiry → Intake → Active Client → Completed → Inactive
   - Coach: Lead → Discovery Call → Proposal → Active Client → Completed
   - Consultant: Lead → Qualified → Proposal → Negotiation → Active Project → Completed

3. **Services**
   - Service name (required)
   - Duration in minutes (required)
   - Price (optional - can be free)
   - Currency (inferred from language)
   - Minimum: 1 service required

### Post-Onboarding Configuration

- **Availability**: Configured via visual time-picker in dashboard
- **Payments**: Stripe Connect setup via setup checklist
- **Calendar**: Google Calendar/Outlook plugin connection
- **Website**: AI auto-generates after chat completes

---

## Conversation Flow

```
Welcome & Language Selection
    ↓
Business Basics (name, vertical)
    ↓
CRM Pipeline (preset confirmation)
    ↓
Services (name, duration, price)
    ↓
Business Description (for AI website)
    ↓
Preview & Confirmation
    ↓
Build Infrastructure
    ↓
AI Website Generation (async)
    ↓
Complete → Redirect to Dashboard
```

---

## Technical Architecture

### State Machine

```typescript
type OnboardingStep =
  | 'welcome'
  | 'language_selection'
  | 'business_basics'
  | 'crm_pipeline'
  | 'services'
  | 'business_description'
  | 'preview'
  | 'building'
  | 'website_generation'
  | 'complete';

interface OnboardingState {
  currentStep: OnboardingStep;
  collectedData: {
    businessProfile?: {
      company_name: string;
      vertical: string;
      language: Language;
    };
    pipelineStages?: PipelineStage[];
    services?: Service[];
    businessDescription?: string;
  };
  language: Language;
  conversationHistory: Message[];
}
```

### Components

1. **OnboardingConversationManager** (`/lib/services/OnboardingConversationManager.ts`)
   - State machine logic
   - Entity extraction
   - Question generation
   - Validation

2. **Onboarding Chat API** (`/app/api/onboarding/chat/route.ts`)
   - Process user messages
   - Update state
   - Persist conversation

3. **Build API** (`/app/api/onboarding/build/route.ts`)
   - Create business profile
   - Seed CRM pipeline
   - Create services
   - Trigger website generation

4. **Website Generation Service** (`/lib/services/WebsiteGenerationService.ts`)
   - LLM-powered content generation
   - Create homepage with blocks
   - Vertical-specific theming

5. **Onboarding UI** (`/app/onboarding-chat/page.tsx`)
   - Chat interface
   - RTL support
   - Preview screen
   - Progress indicators

---

## RTL Implementation

### Chat Message Styling

```tsx
// User messages (right-aligned for LTR, left-aligned for RTL)
<div className={cn(
  "flex items-end gap-2",
  isRTL ? "flex-row-reverse" : "flex-row"
)}>
  <div className={cn(
    "rounded-lg px-3 py-2 max-w-[75%]",
    isRTL ? "bg-blue-500 text-white rounded-bl-none" : "bg-blue-500 text-white rounded-br-none"
  )}>
    {message.text}
  </div>
</div>

// AI messages (left-aligned for LTR, right-aligned for RTL)
<div className={cn(
  "flex items-start gap-2",
  isRTL ? "flex-row-reverse" : "flex-row"
)}>
  <Avatar />
  <div className={cn(
    "rounded-lg px-3 py-2 bg-muted",
    isRTL ? "rounded-br-none text-right" : "rounded-bl-none text-left"
  )}>
    {message.text}
  </div>
</div>
```

---

## Translation Keys Required

### English (`en.json`)
```json
{
  "onboarding": {
    "welcome": {
      "title": "Welcome to Business OS",
      "languagePrompt": "What language would you like to use?"
    },
    "businessBasics": {
      "companyNamePrompt": "What's your business name?",
      "verticalPrompt": "What type of business are you?",
      "verticals": {
        "therapist": "Therapist",
        "coach": "Coach",
        "consultant": "Consultant"
      }
    },
    "services": {
      "prompt": "What services do you offer?",
      "durationPrompt": "How long is the session?",
      "pricePrompt": "What's the price?"
    },
    "preview": {
      "title": "Review Your Setup",
      "confirm": "Looks good, let's start!"
    }
  }
}
```

### Hebrew (`he.json`)
```json
{
  "onboarding": {
    "welcome": {
      "title": "ברוכים הבאים ל-Business OS",
      "languagePrompt": "באיזו שפה תרצו להשתמש?"
    },
    "businessBasics": {
      "companyNamePrompt": "מה שם העסק שלך?",
      "verticalPrompt": "איזה סוג עסק?",
      "verticals": {
        "therapist": "מטפל/ת",
        "coach": "מאמן/ת",
        "consultant": "יועץ/ת"
      }
    }
  }
}
```

---

## AI Website Generation

### Input to AI
- Company name
- Vertical
- Language
- Business description
- Services (name, duration, price)

### Generated Content
1. Hero headline and subheadline
2. About section (2-3 paragraphs)
3. Service descriptions
4. Process flow steps (3-5 steps)
5. SEO metadata
6. Theme colors and fonts

### Vertical-Specific Themes
- **Therapist**: Calming blues/greens, serif fonts
- **Coach**: Energetic oranges/blues, modern sans-serif
- **Consultant**: Professional navy/gray, clean sans-serif
- **Lawyer**: Authoritative dark blue/gold, traditional serif

---

## Database Schema

### Tables Used

**onboarding_conversations**
- `id` (UUID)
- `user_id` (UUID)
- `message_sequence` (INT)
- `role` (TEXT) - 'system', 'user', 'assistant'
- `content` (TEXT)
- `metadata` (JSONB) - Contains state_snapshot
- `created_at` (TIMESTAMPTZ)

**business_profiles**
- `company_name` (TEXT)
- `vertical` (TEXT)
- `language` (TEXT)
- `description` (TEXT) - For website generation
- `onboarding_completed` (BOOLEAN)
- `profile_completeness` (INT)

**crm_pipeline_stages**
- `user_id` (UUID)
- `vertical` (TEXT)
- `stage_key` (TEXT)
- `stage_label` (TEXT)
- `position` (INT)
- `color` (TEXT)

**scheduling_services**
- `service_name` (TEXT)
- `duration_minutes` (INT)
- `price` (NUMERIC)
- `currency` (TEXT)
- `is_active` (BOOLEAN)

**website_pages** & **website_blocks**
- AI-generated homepage and content blocks

---

## Implementation Phases

### Phase 1: Core State Machine ✅ TODO
- [ ] Create `OnboardingConversationManager.ts`
- [ ] Implement state machine logic
- [ ] Add entity extraction with LLM
- [ ] Create `/api/onboarding/chat` endpoint
- [ ] Test conversation flow in English

### Phase 2: UI Enhancements ⬜ TODO
- [x] Built `/app/onboarding-chat/page.tsx` (the `/onboarding-v2` route was deleted 2026-08-31)
- [ ] Add RTL styling to chat messages
- [ ] Create preview screen component
- [ ] Implement progress indicator

### Phase 3: Translation & RTL ⬜ TODO
- [ ] Add translation keys (en, he, es)
- [ ] Fix RTL in ChatCommandPanel
- [ ] Test full flow in Hebrew
- [ ] Test full flow in Spanish

### Phase 4: Build Integration ⬜ TODO
- [ ] Enhance `/api/onboarding/build`
- [ ] Implement AI website generation
- [ ] Test end-to-end flow
- [ ] Add error recovery

---

## Files to Create

| File | Purpose |
|------|---------|
| `/lib/services/OnboardingConversationManager.ts` | State machine for onboarding flow |
| `/app/api/onboarding/chat/route.ts` | Chat endpoint for onboarding |
| `/app/api/website/generate-from-profile/route.ts` | AI website generation endpoint |
| `/lib/services/WebsiteGenerationService.ts` | LLM-powered website generator |
| `/components/onboarding/OnboardingPreview.tsx` | Preview screen component |
| `/components/onboarding/PipelineVisualization.tsx` | Pipeline stages visual |
| `/components/onboarding/ServiceCard.tsx` | Service preview card |

## Files to Modify

| File | Changes |
|------|---------|
| `/app/onboarding-chat/page.tsx` | State machine, RTL, live setup panel, plan cards |
| `/app/api/onboarding/build/route.ts` | Create services, trigger website generation |
| `/components/business-os/ChatCommandPanel.tsx` | RTL-aware message styling |
| `/messages/en.json`, `/messages/he.json`, `/messages/es.json` | Add onboarding keys |

---

## Success Criteria

- [ ] User can complete onboarding entirely in Hebrew with proper RTL
- [ ] Minimum configuration: company name, vertical, 1 service
- [ ] CRM pipeline stages created based on vertical preset
- [ ] Preview screen shows all configurations before build
- [ ] Build endpoint creates all infrastructure
- [ ] AI website generation completes successfully
- [ ] Multi-session support with state persistence
- [ ] Error handling for LLM failures

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-11 | Initial creation | Implementation guide created based on comprehensive planning |
