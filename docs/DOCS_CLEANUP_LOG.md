# Documentation Cleanup Log

**Purpose**: Track all actions taken to organize and clean up the `docs/` folder.

---

## Cleanup Session: January 17, 2026

### Actions Taken

#### 1. Created `docs/archive/` folder
- Purpose: Store outdated, historical, and superseded documentation
- Keeps main docs folder focused on current/relevant content

#### 2. Archived 22 files

| File | Reason |
|------|--------|
| CONVERSATIONAL_UI_V2_IMPLEMENTATION_PLAN.md | Implementation complete |
| ACTION_STEP_OUTPUT_STRUCTURE_FIX.md | Bug fix - historical |
| AGENT_GENERATION_COMPREHENSIVE_FIX_PLAN.md | Bug fix - historical |
| AI_PROCESSING_OUTPUT_FIX.md | Bug fix - historical |
| ANALYTICS_TRACKING_FIX.md | Bug fix - historical |
| AUTO_FIX_AI_PROCESSING_REFS.md | Bug fix - historical |
| CRITICAL_GAPS_FIXED.md | Bug fix - historical |
| CURRENCY_SELECTOR_FIX.md | Bug fix - historical |
| DUPLICATE_EXECUTION_FIX.md | Bug fix - historical |
| EMBEDDED_CHECKOUT_WEBHOOK_FIX.md | Bug fix - historical |
| FILTER_FIELD_SYNTAX_FIX.md | Bug fix - historical |
| GAP_FIXES_COMPLETE.md | Bug fix - historical |
| OUTPUT_SCHEMA_FIX_COMPLETE.md | Bug fix - historical |
| OUTPUT_SCHEMA_FIX_PLAN.md | Bug fix - historical |
| PILOT_CREDITS_MULTIPLIER_FIX.md | Bug fix - historical |
| PILOT_INTEGRATION_FIXES.md | Bug fix - historical |
| PRODUCTION_FIXES_SUMMARY.md | Bug fix - historical |
| SCHEMA_ALIGNMENT_FIXES.md | Bug fix - historical |
| SUBSCRIPTION_SYNC_FIX.md | Bug fix - historical |
| V3_UNIVERSAL_FIX_COMPLETE.md | Superseded by V6 |
| V4_WORKFLOW_EXECUTION_FIXES.md | Bug fix - historical |
| WORKFLOW_GENERATION_FIX_SUMMARY.md | Bug fix - historical |

---

## Pending Cleanup Items

| # | Status | Document | Recommendation |
|---|--------|----------|----------------|
| 1 | 🔴 Obsolete | STRIPE_SETUP_GUIDE.md | Archive - Stripe removed |
| 2 | 🔴 Obsolete | STRIPE_REMOVAL_SUMMARY.md | Archive - historical |
| 3 | 🔴 Obsolete | V4_COMPLETE_IMPLEMENTATION_SUMMARY.md | Archive - superseded by V5/V6 |
| 4 | 🔴 Obsolete | extended-ir-architecture/ (48 files) | Archive entire folder - superseded by V6 |
| 5 | 🟡 Historical | PHASE_1 through PHASE_5 completion docs | Consider archiving |
| 6 | 🟠 Review | CONVERSATIONAL_UI_MOCKUP.md | Verify if matches current UI |
| 7 | 🟠 Review | V4_OPENAI_3STAGE_ARCHITECTURE.md | V5 references this - may keep |

---

## Current Documentation Structure

### Active/Current Docs
- `docs/v6/` - V6 semantic pipeline (latest)
- `docs/ais/` - Agent Intensity System
- `docs/admin/` - Admin documentation
- `docs/plugins/` - Plugin documentation
- V2_*.md - Current V2 UI documentation
- V5_GENERATOR_ARCHITECTURE.md - Current generator

### Archived Docs
- `docs/archive/` - Historical fixes and completed implementations

### Folders to Review
- `docs/extended-ir-architecture/` - 48 files, superseded by V6

---

## Guidelines for Future Cleanup

### Archive if:
- Bug fix documentation (one-time fixes)
- Completed implementation plans
- Superseded architecture docs (V1-V4)
- Migration summaries (after migration complete)

### Keep if:
- Current architecture docs (V5, V6)
- Active feature documentation
- System design docs still in use
- API references

---

*Last updated: January 17, 2026*
