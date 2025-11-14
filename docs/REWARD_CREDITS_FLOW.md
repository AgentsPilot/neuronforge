# Reward Credits Flow

## How Rewards Are Saved

### 1. RewardService.awardReward() Flow

When a reward is awarded via `lib/credits/rewardService.ts`:

1. **Check Eligibility** - Validates user can receive the reward
2. **Get Reward Config** - Fetches reward details from `reward_config` table
3. **Update Balance** - Updates `user_subscriptions` table:
   ```typescript
   {
     balance: currentBalance + rewardAmount,
     total_earned: currentTotalEarned + rewardAmount
   }
   ```

4. **Create Transaction** - Inserts into `credit_transactions` table:
   ```typescript
   {
     user_id: userId,
     credits_delta: rewardAmount,
     transaction_type: 'credit',        // Note: uses 'credit', not 'reward'
     activity_type: 'reward_credit',    // This identifies it as a reward
     reward_config_id: rewardConfig.id,
     description: 'Reward Name',
     balance_before: oldBalance,
     balance_after: newBalance,
     metadata: { reward_key, related_entity_id, etc }
   }
   ```

5. **Track User Reward** - Updates `user_rewards` table for redemption tracking

### 2. Database Schema

**credit_transactions table:**
- `transaction_type`: 'credit' | 'allocation' | 'charge' (constraint doesn't support 'reward')
- `activity_type`: 'reward_credit' identifies reward transactions
- `reward_config_id`: Links to reward_config table

**Key Fields:**
- `credits_delta`: Amount of credits (positive for rewards)
- `balance_before`: Balance before the reward
- `balance_after`: Balance after the reward
- `metadata`: Additional reward context

### 3. Fetching Reward Credits in UI

In `components/settings/BillingSettings.tsx`:

```typescript
// Fetch by activity_type, not transaction_type
const { data: rewardTransactions } = await supabase
  .from('credit_transactions')
  .select('credits_delta')
  .eq('user_id', user.id)
  .eq('activity_type', 'reward_credit');

const totalRewardCredits = rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;
```

### 4. Display in UI

**Available Credits Card:**
- Shows total balance (includes all credit sources)
- Subtitle shows: "Incl. {amount} rewards" if rewards exist
- Otherwise shows: "Monthly + Boost + Rewards"

### 5. Example Reward Transaction

```json
{
  "id": "85b96383-966b-4ed7-af92-2a8607813aaa",
  "user_id": "08456106-aa50-4810-b12c-7ca84102da31",
  "credits_delta": 500,
  "transaction_type": "credit",
  "activity_type": "reward_credit",
  "description": "Share Your Agent",
  "reward_config_id": "b166dc36-b731-48d4-8bf1-db9a55528eee",
  "balance_before": 0,
  "balance_after": 500,
  "metadata": {
    "reward_key": "agent_sharing",
    "related_entity_id": "f9bd640d-a637-49a4-b5f4-6a35fc733b0f",
    "related_entity_type": "agent"
  }
}
```

## Important Notes

1. **Transaction Type**: Always use `'credit'` for transaction_type, not `'reward'` (DB constraint limitation)
2. **Identification**: Use `activity_type='reward_credit'` to identify reward transactions
3. **Balance Inclusion**: Reward credits are immediately added to the user's total balance
4. **Query Pattern**: Always filter by `activity_type='reward_credit'` when fetching rewards
