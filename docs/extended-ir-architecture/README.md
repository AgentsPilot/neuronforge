# Extended IR Architecture Documentation

**Version:** 1.0
**Status:** Architecture Design
**Created:** December 2024

## Overview

The Extended Logical IR (Intermediate Representation) Architecture is a redesigned agent generation system that separates **intent** from **execution**, providing:

- **2.4x higher trust score** (55/60 vs 23/50)
- **165x lower execution cost** (example: $0.015 vs $2.50)
- **10x+ faster execution** (28 seconds vs 5 minutes)
- **92% workflow coverage** (vs V4's 86%)
- **Natural language UX** for non-technical users

## Core Principle

```
LLM generates INTENT (what to do)
   ↓
Compiler generates EXECUTION (how to do it)
   ↓
No LLM guessing during compilation
```

## Documentation Structure

### 1. [Executive Summary](./01-executive-summary.md)
High-level overview of the architecture, benefits, and business impact.

### 2. [Architecture Overview](./02-architecture-overview.md)
System design, flow diagrams, and component relationships.

### 3. [Trust Analysis](./03-trust-analysis.md)
Detailed comparison of V4 vs Extended IR on trust factors, with scoring methodology.

### 4. [Logical IR Schema](./04-logical-ir-schema.md)
Complete IR schema specification with examples and validation rules.

### 5. [Compiler Design](./05-compiler-design.md)
Compiler architecture, rule system, and deterministic compilation process.

### 6. [Natural Language UX](./06-natural-language-ux.md)
User-facing components, plain English translation, and correction handling.

### 7. [UI Integration](./07-ui-integration.md)
How Extended IR integrates with existing agent creation UI/UX.

### 8. [API Specifications](./08-api-specifications.md)
All new API endpoints, request/response formats, and integration points.

### 9. [Implementation Plan](./09-implementation-plan.md)
Week-by-week roadmap with deliverables, milestones, and dependencies.

### 10. [Code Examples](./10-code-examples.md)
Real implementation examples for all key components.

### 11. [Testing Strategy](./11-testing-strategy.md)
Test plans, success metrics, and validation procedures.

### 12. [Rollout Strategy](./12-rollout-strategy.md)
Feature flags, gradual rollout, A/B testing, and migration plan.

## Quick Start

**For Architects:**
- Read [Executive Summary](./01-executive-summary.md)
- Review [Architecture Overview](./02-architecture-overview.md)
- Check [Trust Analysis](./03-trust-analysis.md)

**For Developers:**
- Review [Compiler Design](./05-compiler-design.md)
- Study [Code Examples](./10-code-examples.md)
- Follow [Implementation Plan](./09-implementation-plan.md)

**For Product/UX:**
- Read [Natural Language UX](./06-natural-language-ux.md)
- Review [UI Integration](./07-ui-integration.md)

**For QA/Testing:**
- Check [Testing Strategy](./11-testing-strategy.md)
- Review [Rollout Strategy](./12-rollout-strategy.md)

## Key Files Reference

### Backend
- `/lib/agentkit/v6/` - New V6 architecture implementation
- `/lib/agentkit/v6/logical-ir/schemas/` - IR schema definitions
- `/lib/agentkit/v6/compiler/` - Compiler and rules
- `/lib/agentkit/v6/translation/` - Natural language translation

### Frontend
- `/components/agent-creation/WorkflowPlanPreview.tsx` - New preview component
- `/components/agent-creation/AgentBuilderParent.tsx` - Modified orchestrator

### API
- `/app/api/generate-workflow-plan/` - IR generation endpoint
- `/app/api/compile-workflow/` - Compilation endpoint
- `/app/api/update-workflow-plan/` - Correction handling endpoint

## Timeline

**Phase 1:** Core IR System (Weeks 1-3)
**Phase 2:** Natural Language UX (Weeks 4-5)
**Phase 3:** Execution Observability (Week 6)
**Phase 4:** Extended Compiler Rules (Week 7)
**Phase 5:** Testing & Refinement (Week 8)

**Total:** 8 weeks to production-ready

## Success Metrics

- **Correctness:** 90%+ workflows execute as intended
- **Efficiency:** 20-30% AI steps (vs 60% in V4)
- **User Comprehension:** 95%+ understand plan preview
- **Trust:** 80%+ approve plan without edits
- **Cost:** 10-50x reduction in execution cost

## Related Documents

- [V4 Architecture](../V4_INTENT_BASED_ARCHITECTURE_PLAN.md) - Current system
- [Shadow Critic Implementation](../shadow-critic-implementation-plan.md) - Quality validation
- [Agent Creation Flow](../AGENT_CREATION_AND_EXECUTION_FLOW.md) - Current UI flow

## Questions or Feedback

Contact the architecture team or open an issue in the repository.
