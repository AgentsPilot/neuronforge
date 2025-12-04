# HelpBot FAQ Coverage Analysis
## Complete List of All Quick Questions Across All Pages

This document catalogs ALL quick questions defined in both:
1. **Database** - `helpbot_page_contexts` table (from migration 20250129)
2. **Code** - Hardcoded fallbacks in `components/v2/HelpBot.tsx`

---

## Pages and Their Questions

### 1. Dashboard (`/v2/dashboard`)

**Database Questions:**
- "How do I create a new agent?"
- "What are Pilot Credits?"
- "How do I check my credit balance?"

**Hardcoded Fallback Questions:**
- "How do I view my agent performance?"
- "What do Pilot Credits mean?"
- "How do I create a new agent?"

**Unique Questions to Answer (6 total):**
1. How do I create a new agent? ✅ HAS FAQ ("Create agent")
2. What are Pilot Credits? ✅ HAS FAQ ("Pilot Credits")
3. How do I check my credit balance? ❌ MISSING FAQ
4. How do I view my agent performance? ❌ MISSING FAQ
5. What do Pilot Credits mean? ✅ HAS FAQ ("Pilot Credits")

---

### 2. Agent List (`/v2/agent-list`)

**Database Questions:**
- "How do I filter agents?"
- "What does the AIS score mean?"
- "How do I delete an agent?"

**Hardcoded Fallback Questions:**
- "How do I filter agents by status?"
- "What do agent statuses mean?"
- "What is the AIS score?"

**Unique Questions to Answer (6 total):**
1. How do I filter agents? ✅ HAS FAQ ("Filter agents")
2. What does the AIS score mean? ❌ MISSING FAQ
3. How do I delete an agent? ✅ HAS FAQ ("Delete agent")
4. How do I filter agents by status? ✅ COVERED by "Filter agents"
5. What do agent statuses mean? ✅ HAS FAQ ("Agent statuses")
6. What is the AIS score? ❌ MISSING FAQ (same as #2)

---

### 3. Agent Details (`/v2/agents/[id]`)

**Database Questions:**
- "How do I edit this agent?"
- "How do I view execution history?"
- "How do I pause/activate this agent?"

**Hardcoded Fallback Questions:**
- "How do I edit this agent?"
- "How do I run this agent?"
- "What is the AIS score?"
- "How do I view execution history?"
- "How do I delete this agent?"
- "What are connected plugins?"

**Unique Questions to Answer (7 total):**
1. How do I edit this agent? ❌ MISSING FAQ (exists for /v2/agent-list but not this page)
2. How do I view execution history? ❌ MISSING FAQ
3. How do I pause/activate this agent? ❌ MISSING FAQ
4. How do I run this agent? ❌ MISSING FAQ
5. What is the AIS score? ❌ MISSING FAQ
6. How do I delete this agent? ✅ HAS FAQ but wrong page context
7. What are connected plugins? ❌ MISSING FAQ

---

### 4. Run Agent (`/v2/agents/[id]/run`)

**Database Questions:**
- "How do I provide input data?"
- "Can I schedule this to run automatically?"
- "How do I view execution logs?"

**Hardcoded Fallback Questions:**
- "How do I provide input to my agent?"
- "What happens when I run an agent?"
- "How do I view execution results?"
- "What are execution logs?"
- "How much does it cost to run an agent?"

**Unique Questions to Answer (8 total):**
1. How do I provide input data? ✅ HAS FAQ ("Provide agent input")
2. Can I schedule this to run automatically? ❌ MISSING FAQ
3. How do I view execution logs? ❌ MISSING FAQ
4. How do I provide input to my agent? ✅ COVERED by "Provide agent input"
5. What happens when I run an agent? ❌ MISSING FAQ
6. How do I view execution results? ✅ HAS FAQ ("View execution results")
7. What are execution logs? ❌ MISSING FAQ
8. How much does it cost to run an agent? ❌ MISSING FAQ

---

### 5. Create Agent (`/v2/agents/new`)

**Database Questions:**
- "What makes a good agent prompt?"
- "How do I connect plugins?"
- "What triggers can I use?"

**Unique Questions to Answer (3 total):**
1. What makes a good agent prompt? ❌ MISSING FAQ
2. How do I connect plugins? ❌ MISSING FAQ
3. What triggers can I use? ❌ MISSING FAQ

---

### 6. Templates (`/v2/templates`)

**Database Questions:**
- "How do I use a template?"
- "Can I customize templates?"
- "What templates are available?"

**Unique Questions to Answer (3 total):**
1. How do I use a template? ❌ MISSING FAQ
2. Can I customize templates? ❌ MISSING FAQ
3. What templates are available? ❌ MISSING FAQ

---

### 7. Analytics (`/v2/analytics`)

**Database Questions:**
- "How do I export analytics data?"
- "What metrics are tracked?"
- "How is cost calculated?"

**Unique Questions to Answer (3 total):**
1. How do I export analytics data? ✅ HAS FAQ ("Export analytics")
2. What metrics are tracked? ✅ HAS FAQ ("Metrics tracked")
3. How is cost calculated? ❌ MISSING FAQ

---

### 8. Billing (`/v2/billing`)

**Database Questions:**
- "How do I buy more credits?"
- "What payment methods are accepted?"
- "Can I get a refund?"

**Unique Questions to Answer (3 total):**
1. How do I buy more credits? ✅ HAS FAQ ("Add credits")
2. What payment methods are accepted? ❌ MISSING FAQ
3. Can I get a refund? ❌ MISSING FAQ

---

### 9. Monitoring (`/v2/monitoring`)

**Database Questions:**
- "How do I filter logs?"
- "What do the different status codes mean?"
- "Can I export logs?"

**Unique Questions to Answer (3 total):**
1. How do I filter logs? ❌ MISSING FAQ
2. What do the different status codes mean? ❌ MISSING FAQ
3. Can I export logs? ❌ MISSING FAQ

---

### 10. Notifications (`/v2/notifications`)

**Database Questions:**
- "How do I enable Slack notifications?"
- "What events trigger alerts?"
- "How do I mute notifications?"

**Unique Questions to Answer (3 total):**
1. How do I enable Slack notifications? ❌ MISSING FAQ
2. What events trigger alerts? ❌ MISSING FAQ
3. How do I mute notifications? ❌ MISSING FAQ

---

### 11. Settings (`/v2/settings`)

**Database Questions:**
- "How do I add an API key?"
- "How do I connect a plugin?"
- "How do I change my password?"

**Unique Questions to Answer (3 total):**
1. How do I add an API key? ✅ HAS FAQ ("API keys")
2. How do I connect a plugin? ✅ HAS FAQ ("Connect integrations")
3. How do I change my password? ❌ MISSING FAQ

---

### 12. Sandbox/Debugger (`/v2/sandbox/[agentId]`)

**Database Questions:**
- (Not in 20250129 migration, but should be added)

**Hardcoded Fallback Questions:**
- "How do I use the debugger?"
- "What do the debug controls do?"
- "How do I step through execution?"
- "How do I inspect step data?"
- "What are Pilot Credits?"
- "How do I pause and resume execution?"

**Unique Questions to Answer (6 total):**
1. How do I use the debugger? ✅ HAS FAQ ("Use debugger")
2. What do the debug controls do? ✅ HAS FAQ ("Debug controls")
3. How do I step through execution? ✅ HAS FAQ ("Step through execution")
4. How do I inspect step data? ✅ HAS FAQ ("Inspect step data")
5. What are Pilot Credits? ✅ HAS FAQ ("Pilot credits debugger")
6. How do I pause and resume execution? ✅ HAS FAQ ("Pause and resume")

---

### 13. Default/Fallback (any unmatched route)

**Hardcoded Fallback Questions:**
- "How do I get started?"
- "What can I do here?"
- "How do I create my first agent?"

**Unique Questions to Answer (3 total):**
1. How do I get started? ❌ MISSING FAQ
2. What can I do here? ❌ MISSING FAQ (general platform overview)
3. How do I create my first agent? ✅ COVERED by "Create agent"

---

## Summary Statistics

**Total Unique Questions:** 54
**Questions with FAQs:** 23 (43%)
**Missing FAQs:** 31 (57%)

### Missing FAQs by Page:
- Dashboard: 2 missing
- Agent List: 1 missing
- Agent Details: 7 missing
- Run Agent: 5 missing
- Create Agent: 3 missing
- Templates: 3 missing
- Analytics: 1 missing
- Billing: 2 missing
- Monitoring: 3 missing
- Notifications: 3 missing
- Settings: 1 missing
- Default/Fallback: 2 missing

**Critical Issue:** 57% of quick questions lack FAQs, forcing expensive AI (Groq) fallback calls.

**Estimated Impact:**
- If 100 helpbot queries/day
- 57 queries fall back to Groq at ~$0.001 per query
- **Cost: ~$1.71/month in unnecessary AI calls**
- **Response time: 1-3 seconds (Groq) vs <100ms (FAQ lookup)**
- **Cache pollution: Questions get cached only after first expensive lookup**

**Recommendation:** Create FAQs for all 31 missing questions in next migration.
