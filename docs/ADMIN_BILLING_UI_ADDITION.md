# Admin UI: Add Billing Configuration Section

## Summary

Add a "Billing Configuration" card to `/app/admin/system-config/page.tsx` to allow admins to configure the payment grace period.

---

## Step 1: Add State Variables

Add these lines after line 70 (after `advancedExpanded` state):

```typescript
const [billingExpanded, setBillingExpanded] = useState(false);

// Billing configuration state
const [billingConfig, setBillingConfig] = useState({
  paymentGracePeriodDays: 3
});
```

---

## Step 2: Fetch Billing Config

Add to the `fetchSystemSettings` function (around line 200-300 where other configs are fetched):

```typescript
// Fetch billing configuration
const { data: billingData } = await supabase
  .from('system_settings_config')
  .select('key, value')
  .eq('key', 'payment_grace_period_days')
  .maybeSingle();

if (billingData) {
  setBillingConfig({
    paymentGracePeriodDays: parseInt(billingData.value as string) || 3
  });
}
```

---

## Step 3: Add Save Function

Add this function near the other save functions (around line 400-500):

```typescript
const saveBillingConfig = async () => {
  try {
    setSaving(true);
    setError(null);
    setSuccess(null);

    // Update payment grace period
    const { error: updateError } = await supabase
      .from('system_settings_config')
      .upsert({
        key: 'payment_grace_period_days',
        value: billingConfig.paymentGracePeriodDays.toString(),
        category: 'billing',
        description: 'Number of days to wait before pausing agents after a failed payment'
      }, {
        onConflict: 'key'
      });

    if (updateError) throw updateError;

    setSuccess('Billing configuration saved successfully');
    setTimeout(() => setSuccess(null), 3000);
  } catch (err: any) {
    console.error('Error saving billing config:', err);
    setError(err.message || 'Failed to save billing configuration');
  } finally {
    setSaving(false);
  }
};
```

---

## Step 4: Add UI Section

Add this section **before the closing `</div>`** of the main container (around line 2700-2750). Place it after the "Pilot Workflow Orchestrator" section:

```tsx
{/* BILLING CONFIGURATION SECTION */}
<div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
  <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-b border-white/10 p-6">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            Billing Configuration
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Configure payment and subscription billing settings
          </p>
        </div>
      </div>
      <button
        onClick={() => setBillingExpanded(!billingExpanded)}
        className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
      >
        {billingExpanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
    </div>
  </div>

  {billingExpanded && (
    <div className="p-6 space-y-6">
      {/* Info Box */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-green-400 font-medium text-sm">About Billing Configuration</p>
            <p className="text-slate-300 text-sm leading-relaxed">
              These settings control how failed payments are handled in Stripe subscriptions.
              <strong className="text-white"> Grace period</strong> determines how long to wait before pausing agents after a payment failure.
              Individual users can have custom grace periods set in their subscription settings.
            </p>
          </div>
        </div>
      </div>

      {/* Payment Grace Period */}
      <div className="space-y-4">
        <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
          <Clock className="w-4 h-4 text-green-400" />
          Failed Payment Handling
        </h3>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">
            Payment Grace Period (Days)
          </label>
          <input
            type="number"
            value={billingConfig.paymentGracePeriodDays}
            onChange={(e) => setBillingConfig({
              ...billingConfig,
              paymentGracePeriodDays: parseInt(e.target.value) || 3
            })}
            min="0"
            max="30"
            step="1"
            className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-green-500"
          />
          <p className="text-xs text-slate-500">
            Number of days to wait before pausing agents after a failed payment.
            Default: 3 days. Stripe will automatically retry failed payments during this period.
            Set to 0 to pause immediately after failure.
          </p>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={saveBillingConfig}
          disabled={saving}
          className="px-6 py-2 bg-green-500 hover:bg-green-600 disabled:bg-slate-600 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          {saving ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Billing Config
            </>
          )}
        </button>
      </div>
    </div>
  )}
</div>
```

---

## Step 5: Add Import (if needed)

If `Clock` and `DollarSign` icons are not already imported, add them to the imports at the top:

```typescript
import {
  Settings, Save, RefreshCw, AlertCircle, CheckCircle,
  DollarSign, Zap, Sliders, Database, Edit, X, Check,
  Download, ChevronUp, ChevronDown, Brain, Clock  // Add Clock here
} from 'lucide-react';
```

---

## Result

Admins will see a new "Billing Configuration" card that allows them to:
- ✅ View current payment grace period setting
- ✅ Change grace period (0-30 days)
- ✅ Save changes to database
- ✅ Affects all new payment failures system-wide

---

## Testing

1. Go to `/admin/system-config`
2. Scroll to "Billing Configuration" section
3. Expand it
4. Change "Payment Grace Period" from 3 to 5 days
5. Click "Save Billing Config"
6. Verify in database:
   ```sql
   SELECT * FROM system_settings_config WHERE key = 'payment_grace_period_days';
   -- Should show value = '5'
   ```

---

**File to modify**: `/app/admin/system-config/page.tsx`
**Lines to add**: ~4 state variables, ~15 lines fetch code, ~30 lines save function, ~80 lines UI

**Total additions**: ~130 lines of code

This provides a clean, consistent interface matching the existing admin UI style.
