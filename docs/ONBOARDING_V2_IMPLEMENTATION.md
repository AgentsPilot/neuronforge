# Onboarding V2 Implementation

> **Created:** 2026-07-21
> **Status:** Phase 1 Complete ✅

## Overview

Implementation of the new AI Business OS onboarding flow that auto-builds complete business infrastructure from a user's bio.

---

## Implementation Summary

### What We Built

**Phase 1: Foundation + Website Builder Core** ✅

1. **Database Schema** (4 migrations)
   - `business_profiles` - Comprehensive user profile with vertical, services, tools
   - `onboarding_conversations` - Chat history for LLM context
   - `website_pages` - User websites with templates
   - `website_blocks` - Block-based content storage
   - `website_templates` - Pre-built vertical templates
   - `crm_contacts` - Contact database
   - `crm_activities` - Activity tracking
   - `crm_pipeline_stages` - Vertical-specific pipelines

2. **i18n Infrastructure**
   - Multi-language support (EN/ES/HE with RTL)
   - Translation files for all onboarding flows
   - i18n configuration with direction detection

3. **Repository Layer**
   - `BusinessProfileRepository` - Profile CRUD + completeness calculation
   - `OnboardingConversationRepository` - Chat history management

4. **Services Layer**
   - `OnboardingChatService` - LLM-powered bio extraction
   - `WebsiteAnalyzer` - Website scraping + analysis
   - `WebsiteAutoBuildService` ⭐ - **KEY INNOVATION**: Auto-generates personalized website content for all blocks

5. **Building Blocks System**
   - 18 reusable components (Hero, Services, CTA, Testimonials, etc.)
   - Multiple variants per block type
   - Capability integration (booking_widget → Scheduling, payment_button → Payments)

6. **Templates System**
   - 12 pre-built templates (4 per vertical: therapist, coach, consultant)
   - Each template combines blocks with theme and brand voice
   - Template selection heuristics (sub_vertical keywords, brand_voice matching)

7. **API Routes**
   - `POST /api/onboarding/process-bio` - Extract profile from bio
   - `POST /api/onboarding/analyze-website` - Analyze existing website
   - `POST /api/onboarding/complete` - Finalize onboarding
   - `POST /api/onboarding/build-capabilities` - Auto-build website + CRM

8. **Onboarding UI**
   - NEW `/onboarding-v2` route (preserves existing `/onboarding` for rollback)
   - V2 design system with CSS variables
   - Dark mode support
   - Mobile-responsive
   - Framer Motion animations
   - 5-step flow: Welcome → Processing → Preview → Building → Success

9. **Routing & Authentication**
   - Updated middleware to redirect new users to `/onboarding-v2`
   - Onboarding check utility (`checkOnboardingStatus()`)
   - Backward compatibility with legacy `user_metadata.onboarding_completed`

10. **Test Suite**
    - `scripts/test-llm-generation.ts` - Comprehensive testing script
    - Tests bio processing, website auto-build, content quality, multi-language

---

## Key Technical Decisions

### AI vs Deterministic Balance

| System | AI-Powered | Deterministic |
|--------|------------|---------------|
| **Bio Extraction** | ✅ LLM (temp 0.1) | Template validation |
| **Website Content Generation** | ✅ LLM (temp 0.7) | Block structure |
| **Template Selection** | ❌ | ✅ Heuristics |
| **CRM Pipeline Stages** | ❌ | ✅ Vertical-specific defaults |

### Resource Efficiency

1. **Low Temperature for Extraction** (0.1)
   - Consistent JSON output
   - Fewer tokens used
   - High reliability

2. **Single LLM Call for All Blocks** (vs per-block)
   - Context efficiency
   - Consistent voice across all blocks
   - Cost reduction

3. **HTML Cleaning Before Website Analysis**
   - Remove scripts, styles, keep only content
   - Truncate to ~3000 chars
   - Reduce context window usage

### Design Patterns

- **Repository Pattern** - All DB access through repositories
- **Singleton Services** - `websiteAutoBuildService` exported as singleton
- **RLS (Row-Level Security)** - All tables enforce `user_id` filtering
- **Non-blocking Audit** - All audit logs with `.catch()` for non-blocking
- **Correlation IDs** - Request tracing across services

---

## File Structure

```
neuronforge/
├── supabase/migrations/
│   ├── 20260721_create_business_profiles.sql
│   ├── 20260721_create_onboarding_conversations.sql
│   ├── 20260721_create_website_tables.sql
│   └── 20260721_create_crm_tables.sql
├── messages/
│   ├── en.json
│   ├── es.json
│   └── he.json
├── lib/
│   ├── i18n/
│   │   ├── config.ts
│   │   └── i18n.ts
│   ├── repositories/
│   │   ├── BusinessProfileRepository.ts
│   │   └── OnboardingConversationRepository.ts
│   ├── services/
│   │   ├── OnboardingChatService.ts
│   │   ├── WebsiteAnalyzer.ts
│   │   └── WebsiteAutoBuildService.ts ⭐
│   ├── website-builder/
│   │   ├── building-blocks.ts
│   │   └── templates.ts
│   └── utils/
│       └── onboarding-check.ts
├── app/
│   ├── (protected)/
│   │   ├── layout.tsx (updated)
│   │   └── onboarding-v2/
│   │       └── page.tsx ⭐
│   └── api/onboarding/
│       ├── process-bio/route.ts
│       ├── analyze-website/route.ts
│       ├── complete/route.ts
│       └── build-capabilities/route.ts
├── scripts/
│   └── test-llm-generation.ts
├── middleware.ts (updated)
└── docs/
    └── ONBOARDING_V2_IMPLEMENTATION.md (this file)
```

---

## User Journey

```
STEP 1: User creates account
  ↓
STEP 2: Redirect to /onboarding-v2 (middleware check)
  ↓
STEP 3: Welcome screen - 3 upload options
  - Type bio in chat
  - Upload file (PDF, DOCX, TXT)
  - Answer guided questions
  ↓
STEP 4: Processing (LLM extracts profile)
  - Vertical detection
  - Services extraction
  - Tools identification
  - Website analysis (if URL provided)
  - Completeness calculation
  ↓
STEP 5: Preview extracted profile
  - Business details
  - Capabilities that will be built:
    ✓ Professional website (template preview)
    ✓ Client management (CRM)
    ✓ Booking system
    ✓ Payment processing
    ✓ Email automation
  - [Edit Profile] or [Build Everything]
  ↓
STEP 6: Building (progress animation)
  - Creating website... ✓
  - Setting up CRM... ✓
  - Connecting calendar... ✓
  - Activating AI Employees... ✓
  ↓
STEP 7: Success + Redirect to /v2/dashboard
  - "Your practice is LIVE! 🎉"
  - All capabilities activated
  - Can customize/adjust anything
```

---

## LLM-Powered Content Generation

**The key innovation** in `WebsiteAutoBuildService`:

### How It Works

1. **Select Template**
   - Match by sub_vertical keywords (e.g., "trauma" → Specialized Trauma template)
   - Match by brand_voice from website analysis
   - Default to most versatile template

2. **Generate All Block Content in Single LLM Call**
   ```typescript
   const userPrompt = `Generate personalized website content for this business:

   ${profileContext}

   Template: ${template.name} (${template.theme.brand_voice} voice)

   Generate content for the following blocks. Return ONLY a JSON object with keys "block_0", "block_1", etc.

   block_0 (Hero):
   - headline: Compelling headline (max 60 chars)
   - subheadline: Supporting text (max 100 chars)
   - cta_text: Call-to-action button text

   block_1 (Services):
   - title: Section title
   - services: Array of { name, description } for: ${profile.services.join(', ')}

   ...

   Requirements:
   - Use business name "${profile.company_name}" naturally
   - Reference services: ${profile.services.join(', ')}
   - Write in ${locale}
   - Match the ${template.theme.brand_voice} brand voice
   `;

   const response = await provider.complete({
     messages: [
       { role: 'system', content: systemPrompt[locale] },
       { role: 'user', content: userPrompt }
     ],
     temperature: 0.7, // Balance creativity + consistency
     max_tokens: 3000
   });
   ```

3. **Map LLM Output to Blocks**
   ```typescript
   const generatedContent = JSON.parse(response);
   return template.blocks.map((block, idx) => ({
     ...block,
     content: { ...block.content, ...generatedContent[`block_${idx}`] }
   }));
   ```

### Example Output

For a therapist with bio "I'm Dr. Sarah Johnson, PTSD specialist":

**Generated Hero Block:**
```json
{
  "block_type": "hero",
  "content": {
    "headline": "Healing from Trauma Together",
    "subheadline": "Specialized PTSD therapy with Dr. Sarah Johnson",
    "cta_text": "Schedule a Consultation",
    "cta_link": "#contact"
  }
}
```

**Generated Services Block:**
```json
{
  "block_type": "services",
  "content": {
    "title": "Specialized Therapy Services",
    "services": [
      {
        "name": "Individual PTSD Therapy",
        "description": "Evidence-based trauma therapy using EMDR and CBT techniques tailored to your unique healing journey."
      },
      {
        "name": "Trauma Recovery Sessions",
        "description": "Compassionate, personalized sessions focused on processing traumatic experiences in a safe, supportive environment."
      }
    ]
  }
}
```

---

## Testing

### Running Tests

```bash
# Run test suite
npx tsx scripts/test-llm-generation.ts
```

### Test Coverage

1. **Bio Processing**
   - Therapist, Coach, Consultant, Course Creator bios
   - Vertical detection accuracy
   - Service extraction
   - Tool identification
   - Profile completeness calculation

2. **Website Auto-Build**
   - Template selection logic
   - Block content generation
   - Page metadata (title, description)
   - Theme application

3. **Content Quality**
   - Company name mentioned in key blocks
   - Services referenced correctly
   - Realistic testimonials
   - Capability integration (booking/payment blocks)

4. **Multi-Language**
   - Spanish (ES) content generation
   - Hebrew (HE) content generation + RTL support
   - Translation accuracy

---

## Next Steps (Phase 2-3)

### Phase 2: CRM + Scheduling Capabilities
- Contact management UI
- Pipeline Kanban board
- Activity auto-logging
- Booking system
- Calendar integration
- Email reminders

### Phase 3: Payments + Sales Automation
- Stripe Connect integration
- Invoice generation
- Email sequence builder
- Pre-built sequences per vertical
- Broadcast emails

### Phase 4: AI Employees + Campaigns + Custom Automations
- AI Employee system
- Campaign builder (Google/Meta Ads)
- Custom automation via V6 kernel
- Expansion flow (conversational + deterministic questionnaire)

### Phase 5: Insight Agent + Polish
- Business health monitoring
- Performance analytics
- Issue detection + auto-fix
- Conversational insights
- Dashboard redesign

---

## Backward Compatibility

- **Legacy onboarding flow** (`/onboarding`) preserved
- **user_metadata.onboarding_completed** still checked for backward compatibility
- **New users** automatically redirected to `/onboarding-v2`
- **Existing users** with completed onboarding skip onboarding-v2

---

## Configuration

### Environment Variables

```bash
# Required for onboarding-v2
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=... # For LLM-powered content generation

# Optional
NEXT_PUBLIC_DEFAULT_LOCALE=en # or es, he
```

### Feature Flags

None currently - onboarding-v2 is enabled by default for new users.

To disable and use legacy onboarding:
1. Remove middleware onboarding check
2. Revert protected layout redirect from `/onboarding-v2` to `/onboarding`

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-21 | Initial implementation | Phase 1 complete: Database, i18n, services, API routes, UI, testing |

