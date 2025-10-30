# AIS System - Simple Guide (Plain English)

**What is AIS?** A system that figures out how complex your agent is and charges you accordingly.

---

## The Big Picture

Think of it like car insurance:
- **Simple agent** (basic chatbot) = 1.0x price multiplier (cheapest)
- **Medium agent** (with some workflows) = 1.5x price multiplier
- **Complex agent** (lots of plugins, workflows, tokens) = 2.0x price multiplier (most expensive)

The system gives your agent a **score from 0 to 10**:
- 0 = super simple
- 5 = average
- 10 = super complex

Then it uses this formula: **Price Multiplier = 1.0 + (Score / 10)**

---

## Three Simple Tables Explained

### Table 1: The "What's Normal?" Table (`ais_normalization_ranges`)

**What it does:** Tells the system what counts as "a lot" vs "a little"

**Example:**
```
Question: Is 5000 tokens "a lot"?
Answer: Depends on the range!

If range is 0 to 10,000:
  5000 tokens = 5 out of 10 (middle)

If range is 0 to 2,500:
  5000 tokens = 10 out of 10 (maximum!)
```

**Real examples from the table:**
| What We're Measuring | Min | Max | What This Means |
|---------------------|-----|-----|-----------------|
| Tokens per run | 0 | 8,234 | Using 8,234+ tokens = score of 10 |
| Workflow steps | 0 | 15 | Having 15+ steps = score of 10 |
| Plugins | 0 | 7 | Using 7+ plugins = score of 10 |

**Two modes:**
- **Best Practice** (mode 0): Set by experts ("industry standard")
- **Dynamic** (mode 1): Set by your actual data ("what users really do")

**Admin can change:** Click "Refresh" to update based on what agents actually do

---

### Table 2: The "What Matters More?" Table (`ais_scoring_weights`)

**What it does:** Decides which factors are most important

**Think of it like grading:**
```
Final Grade = (Homework × 20%) + (Midterm × 30%) + (Final Exam × 50%)

Same idea:
Agent Score = (Design × 30%) + (How It Runs × 70%)
```

**Example weights:**
```
When calculating "Token Complexity":
- Volume (how many total tokens) = 50% importance
- Peak usage (highest in one run) = 30% importance
- Efficiency (input/output ratio) = 20% importance

So if you want efficiency to matter MORE:
Change: Volume 50% → 30%
Change: Efficiency 20% → 40%
```

**All weights must add up to 100%** for each group

**Admin can change:** Update the database to change what's important

---

### Table 3: The "Business Rules" Table (`ais_system_config`)

**What it does:** Stores pricing and limits

**Examples:**
| Setting | Value | What It Means |
|---------|-------|---------------|
| Pilot credit cost | $0.00048 | 1 credit costs $0.00048 |
| Minimum subscription | $10.00 | You can't pay less than $10/month |
| Free tier credits | 1,000 | New users get 1,000 free credits |

**Admin can change:** Update prices without changing code!

---

## How Scoring Works (Step by Step)

### When You CREATE an Agent

```
1. You create an agent using AgentKit
   ↓
2. System looks at the DESIGN:
   - How many workflow steps?
   - How many plugins?
   - How complex is the input/output?
   - What type of trigger?
   ↓
3. System calculates "Creation Score" (0-10)
   Example: 6.5 out of 10
   ↓
4. System doesn't know how it will run yet, so uses default: 5.0
   ↓
5. Combined Score = (6.5 × 30%) + (5.0 × 70%) = 5.45
   ↓
6. Pricing Multiplier = 1.0 + (5.45 / 10) = 1.545x
```

**This happens automatically** when you create an agent.

---

### When You RUN an Agent

```
1. You run the agent
   ↓
2. System tracks EVERYTHING:
   - How many tokens used?
   - How long did it take?
   - Did it fail? Retry?
   - Which plugins were called?
   - How many iterations?
   ↓
3. System calculates "Execution Score" (0-10)
   Example: 5.08 out of 10
   ↓
4. System recalculates Combined Score:
   Combined = (6.5 × 30%) + (5.08 × 70%) = 5.506
   ↓
5. New Pricing Multiplier = 1.0 + (5.506 / 10) = 1.551x
```

**This happens automatically** every time you run an agent.

**Important:** The score updates gradually based on averages:
- First run might show 8.0
- After 10 runs, average might be 6.5
- After 100 runs, it stabilizes at 5.5

---

### When Admin REFRESHES Ranges (Manual)

```
1. Admin clicks "Refresh Normalization Ranges"
   ↓
2. System looks at ALL agents in production:
   - What's the highest token usage? → 9,876 tokens
   - What's the average? → 4,523 tokens
   - What's the most plugins used? → 12 plugins
   ↓
3. System updates the "what's normal?" table:
   Before: token_volume max = 8,234
   After:  token_volume max = 9,876
   ↓
4. Scores DON'T change immediately
   ↓
5. Next time each agent runs, it uses the NEW ranges
```

**Why not immediate?** To avoid suddenly changing everyone's prices at once!

---

## Real-World Examples

### Example 1: Simple Chatbot

**Design:**
- 3 workflow steps
- 1 plugin (OpenAI)
- Simple input (user message) and output (response)

**Creation Score:** 2.5 / 10 (very simple design)

**After 50 runs:**
- Average: 2,000 tokens per run
- Duration: 3 seconds
- No failures
- 1 plugin per run

**Execution Score:** 3.2 / 10 (simple execution)

**Combined Score:** (2.5 × 0.3) + (3.2 × 0.7) = **2.99 / 10**

**Price Multiplier:** 1.0 + (2.99 / 10) = **1.30x**

**Monthly Cost:** If base cost is $12, you pay $12 × 1.30 = **$15.60/month**

---

### Example 2: Complex Research Agent

**Design:**
- 25 workflow steps
- 8 plugins (web search, database, email, calendar, etc.)
- Complex input schema (15 fields)
- Complex output (structured report)
- Scheduled trigger

**Creation Score:** 8.2 / 10 (very complex design)

**After 50 runs:**
- Average: 15,000 tokens per run
- Duration: 45 seconds
- 5% failure rate (needs retries)
- Multiple loops and branches
- 6 plugins per run

**Execution Score:** 7.8 / 10 (complex execution)

**Combined Score:** (8.2 × 0.3) + (7.8 × 0.7) = **7.92 / 10**

**Price Multiplier:** 1.0 + (7.92 / 10) = **1.79x**

**Monthly Cost:** If base cost is $12, you pay $12 × 1.79 = **$21.48/month**

---

### Example 3: Agent Gets More Complex Over Time

**Month 1:**
- Agent starts simple
- Combined Score: 4.5 / 10
- Multiplier: 1.45x
- Cost: $17.40/month

**Month 2:**
- You add more plugins
- You create longer workflows
- Agent uses more tokens
- Combined Score: 6.2 / 10
- Multiplier: 1.62x
- Cost: $19.44/month

**The system notices and adjusts automatically!**

---

## What You Can Change (Admin)

### 1. Update "What's Normal?" Ranges

**How:** Click "Refresh Ranges" in admin panel

**Why:** Your agents are using way more tokens than expected

**Effect:** Future calculations use new, realistic ranges

**Example:**
```
Before refresh:
  "High token usage" = 8,000+ tokens
  Your agent uses 12,000 tokens = Score of 10 (maxed out)

After refresh:
  "High token usage" = 15,000+ tokens (based on reality)
  Your agent uses 12,000 tokens = Score of 8.0 (more fair)
```

---

### 2. Change "What Matters More?" Weights

**How:** Update database directly (no UI yet)

**Why:** You want to prioritize different factors

**Example:**
```sql
-- Make efficiency matter MORE than volume
UPDATE ais_scoring_weights
SET weight = 0.3 WHERE sub_component = 'volume';  -- Down from 0.5

UPDATE ais_scoring_weights
SET weight = 0.5 WHERE sub_component = 'efficiency';  -- Up from 0.2
```

**Effect:** Efficient agents get better scores, wasteful agents get worse scores

---

### 3. Change Pricing

**How:** Update database directly

**Why:** Business decision to change pricing

**Example:**
```sql
-- Increase pilot credit cost
UPDATE ais_system_config
SET config_value = 0.00050  -- Up from 0.00048
WHERE config_key = 'pilot_credit_cost_usd';
```

**Effect:** All new creations and subscriptions use new price immediately

---

## Common Questions

### Q: Why did my agent's score change?

**A:** Two reasons:

1. **You ran it more** - The system learned how it actually behaves
   - First run: Guess of 5.0
   - After 10 runs: More accurate average
   - After 100 runs: Very accurate

2. **Admin refreshed ranges** - The "what's normal?" table updated
   - Your agent didn't change
   - But what counts as "high" or "low" changed

---

### Q: Can I game the system to get a lower score?

**A:** Not really, because:

1. **Design matters** (30%) - Based on what you built
   - Fewer plugins = lower score
   - Simpler workflows = lower score
   - BUT: Your agent needs to work!

2. **Actual usage matters** (70%) - Based on what it does
   - Using fewer tokens = lower score
   - BUT: The agent needs to accomplish its task

The system measures real complexity, not arbitrary numbers.

---

### Q: What if I make my agent simpler?

**A:** The score will update automatically:

```
Before (complex agent):
  - 15 workflow steps
  - 8 plugins
  - Combined Score: 7.5
  - Multiplier: 1.75x

After simplification:
  - 8 workflow steps (you optimized!)
  - 4 plugins (you removed unnecessary ones)
  - Combined Score: 5.2
  - Multiplier: 1.52x

You save money!
```

---

### Q: Why do scores update slowly, not immediately?

**A:** **By design!** To prevent:

1. **Price shock** - Nobody wants their bill to suddenly jump
2. **Gaming** - Can't game a single run to manipulate score
3. **Stability** - Scores are averages over many runs

Instead:
- Scores update gradually
- Based on rolling averages
- Smooth transitions

---

### Q: What happens when admin refreshes ranges?

**A:**

**Immediately:**
- Database updated with new min/max values
- Snapshot saved in audit trail

**Gradually (over next few days):**
- Each agent runs and recalculates using new ranges
- Scores adjust naturally
- No sudden changes

**You can see what changed:**
- Go to `/admin/audit-trail`
- Look for "Normalization Refresh Completed"
- See before/after comparison

---

## The Three Things You Need to Know

### 1. **Automatic Tracking**
- System watches EVERYTHING your agent does
- Updates scores automatically
- You don't need to do anything

### 2. **Fair Pricing**
- Simple agents pay less (1.0x - 1.3x)
- Complex agents pay more (1.7x - 2.0x)
- Price matches actual complexity

### 3. **Fully Configurable**
- Admin can change ranges, weights, pricing
- No code deployment needed
- Changes in database take effect immediately

---

## Summary in One Sentence

**The AIS system automatically tracks how complex your agent is (based on design and actual usage) and adjusts your pricing multiplier from 1.0x to 2.0x, with all configuration stored in three database tables that admins can update without deploying code.**

---

**That's it!** The system is complex under the hood, but from your perspective:
- Create agent → Get creation score
- Run agent → Get execution score
- Pay based on combined score
- Admin can tune the system without coding

Simple! 🎯
