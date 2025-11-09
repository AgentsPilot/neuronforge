# Multi-Currency System Documentation

## Overview
NeuronForge supports **47 international currencies** with a currency calculator feature, allowing users worldwide to see USD prices converted to their local currency for reference.

**Important:** All charges are processed in USD. The multi-currency system is for display and reference only.

## Features

### 1. **Live Exchange Rate Calculator** 🟡 CALCULATOR
When users visit the billing page:
- System automatically fetches current exchange rates from [exchangerate-api.com](https://api.exchangerate-api.com)
- No API key required (free tier)
- Falls back to database rates if API is unavailable
- Users see an amber indicator showing "Currency Calculator"
- Exchange rate is displayed (e.g., "1 USD = 0.9200 EUR")
- **All actual charges are in USD**

### 2. **User Currency Preferences**
- Users can select their preferred currency in Settings > Profile
- Currency preference is used for the **calculator only**
- Currency selector shows:
  - Popular currencies at the top (USD, EUR, GBP, JPY, CHF, CAD, AUD, CNY, INR, SGD)
  - Currencies grouped by region
  - Search functionality
  - Currency symbols and full names
- Footer explains: "All charges are in USD. This preference shows you the equivalent amount in your local currency using live exchange rates."

### 3. **Price Display with Calculator**
- Primary prices displayed in USD (e.g., **$48.00 USD**)
- Converted amount shown below as reference (e.g., *≈ €44.16 EUR* in smaller, gray text)
- All prices calculated from USD base
- Converted to user's currency in real-time for reference only
- Displayed with proper currency symbols
- Correct decimal places (e.g., JPY has 0 decimals, most others have 2)

### 4. **Stripe Integration**
- Checkout sessions created in **USD only**
- All charges processed in USD
- Stripe handles the USD payment

### 5. **Admin Management**
- Exchange rates viewable at `/admin/exchange-rates`
- Manual rate editing capability
- Rate history tracking
- Enable/disable currencies
- Audit trail for all changes

## Supported Currencies (47)

### Major Currencies (5)
- USD - US Dollar ($)
- EUR - Euro (€)
- GBP - British Pound (£)
- JPY - Japanese Yen (¥) *0 decimals*
- CHF - Swiss Franc (CHF)

### North America (2)
- CAD - Canadian Dollar (CA$)
- MXN - Mexican Peso (MX$)

### Asia Pacific (13)
- AUD - Australian Dollar (A$)
- NZD - New Zealand Dollar (NZ$)
- SGD - Singapore Dollar (S$)
- HKD - Hong Kong Dollar (HK$)
- CNY - Chinese Yuan (¥)
- KRW - South Korean Won (₩) *0 decimals*
- INR - Indian Rupee (₹)
- THB - Thai Baht (฿)
- MYR - Malaysian Ringgit (RM)
- PHP - Philippine Peso (₱)
- IDR - Indonesian Rupiah (Rp) *0 decimals*
- VND - Vietnamese Dong (₫) *0 decimals*

### Europe (15)
- SEK - Swedish Krona (kr)
- NOK - Norwegian Krone (kr)
- DKK - Danish Krone (kr)
- PLN - Polish Zloty (zł)
- CZK - Czech Koruna (Kč)
- HUF - Hungarian Forint (Ft) *0 decimals*
- RON - Romanian Leu (lei)
- BGN - Bulgarian Lev (лв)
- HRK - Croatian Kuna (kn)
- RUB - Russian Ruble (₽)
- TRY - Turkish Lira (₺)
- UAH - Ukrainian Hryvnia (₴)

### Middle East & Africa (7)
- AED - UAE Dirham (د.إ)
- SAR - Saudi Riyal (﷼)
- ILS - Israeli New Shekel (₪)
- EGP - Egyptian Pound (E£)
- ZAR - South African Rand (R)
- NGN - Nigerian Naira (₦)
- KES - Kenyan Shilling (KSh)

### South America (5)
- BRL - Brazilian Real (R$)
- ARS - Argentine Peso ($)
- CLP - Chilean Peso ($) *0 decimals*
- COP - Colombian Peso ($)
- PEN - Peruvian Sol (S/)

## Technical Architecture

### Database Schema

#### `exchange_rates` table
```sql
- id (UUID, PK)
- currency_code (VARCHAR(3), UNIQUE)
- currency_name (VARCHAR(100))
- currency_symbol (VARCHAR(10))
- rate_to_usd (DECIMAL(12,6))  -- e.g., 0.920000 for EUR
- is_enabled (BOOLEAN)
- decimal_places (SMALLINT)     -- 0 for JPY/KRW, 2 for most
- last_updated_at (TIMESTAMPTZ)
- updated_by (UUID)
- created_at (TIMESTAMPTZ)
```

#### `exchange_rate_history` table
```sql
- id (UUID, PK)
- currency_code (VARCHAR(3))
- old_rate (DECIMAL(12,6))
- new_rate (DECIMAL(12,6))
- changed_by (UUID)
- changed_at (TIMESTAMPTZ)
- change_reason (TEXT)
```

#### `user_preferences` table (additions)
```sql
- preferred_currency (VARCHAR(3), DEFAULT 'USD')
- preferred_language (VARCHAR(10), DEFAULT 'en')
- timezone (VARCHAR(50), DEFAULT 'UTC')
```

### Services

#### `CurrencyService` (`lib/services/CurrencyService.ts`)
- `getEnabledRates()` - Fetch all enabled currencies (with 1-hour cache)
- `getRate(currencyCode)` - Get specific exchange rate
- `convert(amount, fromCurrency, toCurrency)` - Convert between currencies
- `convertFromUsd(amountUsd, toCurrency)` - Convert from USD to target
- `convertToUsd(amount, fromCurrency)` - Convert to USD
- `updateRate(currencyCode, newRate, updatedBy, reason?)` - Admin update
- `getUserCurrency(userId)` - Get user's preferred currency
- `setUserCurrency(userId, currencyCode)` - Update user's preference

#### Currency Helpers (`lib/utils/currencyHelpers.ts`)
- `formatCurrency()` - Format with proper symbol and decimals
- `formatCurrencyWithRate()` - Format using ExchangeRate object
- `getCurrencySymbol()` - Get symbol by code
- `getCurrencyDecimalPlaces()` - Get decimal places (0 or 2)
- `getPopularCurrencies()` - List of popular currencies
- `getCurrenciesByRegion()` - Currencies grouped by region
- `calculatePriceBreakdown()` - Price calculations with conversions

### Components

#### `CurrencySelector` (`components/settings/CurrencySelector.tsx`)
- Dropdown with search
- Grouped by region
- Popular currencies section
- Live save to database
- Visual currency symbols

#### `BillingSettings` (updated)
- Fetches live exchange rates on load
- Shows amber "Currency Calculator" indicator
- Displays USD prices prominently
- Shows converted amounts as reference below USD prices
- All charges processed in USD only

### API Routes

#### `/api/stripe/create-checkout`
- Creates checkout session in **USD only**
- No currency parameter passed to Stripe
- All payments processed in USD

### Exchange Rate API

**Provider:** [exchangerate-api.com](https://api.exchangerate-api.com)
- **Endpoint:** `https://api.exchangerate-api.com/v4/latest/USD`
- **Free Tier:** Yes, no API key required
- **Updates:** Daily
- **Coverage:** 160+ currencies

**Response Format:**
```json
{
  "base": "USD",
  "date": "2025-01-15",
  "rates": {
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 150.0,
    ...
  }
}
```

## User Flow

### First-Time Setup
1. User signs up (defaults to USD)
2. User goes to Settings > Profile
3. Selects preferred currency from dropdown
4. Currency saved to `user_preferences.preferred_currency`

### Viewing Billing Page
1. User visits `/settings?tab=billing`
2. System fetches user's preferred currency (for calculator only)
3. **Live exchange rate fetched from API**
4. If API fails, database rate used as fallback
5. All prices displayed prominently in **USD**
6. If user has non-USD preference, converted amount shown below as reference
7. Amber "Currency Calculator" indicator shown

### Purchasing Credits
1. User selects credit amount
2. Price calculated and displayed in USD
3. If user has currency preference, equivalent shown as reference (e.g., "≈ €44.16 EUR")
4. Stripe checkout session created in **USD only**
5. User pays in USD

### Admin Management
1. Admin visits `/admin/exchange-rates`
2. Views all 47 currencies with current rates
3. Can manually edit rates
4. Can enable/disable currencies
5. Can view change history
6. Each change logged to audit trail

## Configuration

### System Settings (`system_settings_config`)
```json
{
  "currency_api_provider": "exchangerate-api",
  "currency_auto_update": false,
  "currency_update_frequency_hours": 24,
  "currency_default": "USD",
  "currency_supported_list": ["USD", "EUR", "GBP", ...]
}
```

### Environment Variables
None required! The free tier of exchangerate-api.com works without authentication.

For paid tier (more frequent updates):
```env
EXCHANGE_RATE_API_KEY=your_api_key_here  # Optional
FIXER_API_KEY=your_fixer_key_here        # Alternative provider
```

## Testing

### Test User Currency Selection
1. Go to Settings > Profile
2. Select a currency (e.g., EUR)
3. Go to Settings > Billing
4. Verify prices shown in EUR
5. Verify live rate indicator appears

### Test Live Rate Fetching
1. Open browser console
2. Go to Settings > Billing
3. Look for logs:
   - `💱 Fetching live exchange rate for EUR`
   - `✅ Using live exchange rate: EUR = 0.9200`

### Test Stripe Checkout
1. Select currency in profile
2. Go to billing
3. Click "Start Subscription"
4. Verify Stripe shows prices in selected currency

### Test Admin Panel
1. Login as admin
2. Go to `/admin/exchange-rates`
3. Edit a rate
4. View history

## Why We Keep the Database Table

**Question:** Since we fetch live rates automatically, why do we need the `exchange_rates` table?

**Answer:** The database table is essential for multiple reasons:

### 1. **Currency Metadata Storage**
The database stores critical metadata that the API doesn't provide:
- `currency_symbol` - Display symbols like $, €, £, ¥
- `currency_name` - Full names (US Dollar, Euro, British Pound)
- `decimal_places` - Special handling for zero-decimal currencies (JPY, KRW, etc.)

### 2. **Fallback When API Unavailable**
- If exchangerate-api.com is down, we fall back to database rates
- Ensures uninterrupted service even during API outages
- Provides graceful degradation

### 3. **Admin Override Capability**
- Admins can manually set custom rates if needed
- Useful for special pricing or regional adjustments
- Can override live rates in specific circumstances

### 4. **Audit Trail and History**
- `exchange_rate_history` table tracks all rate changes
- Critical for financial compliance (SOC2, GDPR)
- Provides transparency for rate fluctuations

### 5. **Offline Development**
- Developers can work without internet connection
- Seeded rates allow testing in local environments
- No API key management needed for development

### 6. **Currency List Management**
- Defines which currencies are available in the system
- All 47 currencies stored with metadata
- Easy to add/remove currencies without code changes

**In Summary:** The database provides the foundation (metadata, fallback, history), while the live API provides current rates. Both are needed for a robust multi-currency system.

## Fallback Behavior

### API Unavailable
- Falls back to database exchange rates
- Warning logged to console
- User experience uninterrupted
- Indicator still shows (but uses cached rate)

### Currency Not Found
- Falls back to USD
- Error logged
- User notified to update preferences

### Invalid Currency Selection
- Validation prevents invalid codes
- CHECK constraint on database
- TypeScript types enforce valid codes

## Performance

### Caching Strategy
- **CurrencyService cache:** 1 hour in-memory
- **API rate limiting:** Free tier allows reasonable usage
- **Database queries:** Minimal (only for user preference)
- **Live rate fetch:** Once per billing page visit

### Optimization Tips
1. Live rates only fetched for non-USD currencies
2. Cache used when available
3. Parallel API calls avoided
4. Graceful degradation on API failure

## Future Enhancements

### Potential Improvements
1. **Scheduled Rate Updates:** Cron job to update database rates daily
2. **Rate History Charts:** Visual graphs in admin panel
3. **Multi-Currency Invoices:** Show both USD and user currency
4. **Exchange Rate Alerts:** Notify admins of large fluctuations
5. **Currency Auto-Detection:** Based on IP geolocation
6. **More API Providers:** Redundancy with multiple sources

## Troubleshooting

### Prices Not Converting
- Check user's `preferred_currency` in database
- Verify `exchange_rates` table has the currency enabled
- Check browser console for errors
- Verify API is responding

### Wrong Exchange Rate
- Check `last_updated_at` in `exchange_rates` table
- Verify live API fetch is working (console logs)
- Manually update rate in admin panel if needed

### Currency Not Appearing
- Verify `is_enabled = true` in `exchange_rates` table
- Check it's in the supported list
- Verify it's added to `getCurrenciesByRegion()`

## Security Considerations

1. **Rate Manipulation:** Only admins can update rates
2. **Audit Trail:** All changes logged with user ID and timestamp
3. **RLS Policies:** Database-level security
4. **API Abuse:** Free tier has rate limits (handled gracefully)
5. **Validation:** Currency codes validated before use

## Compliance

- **GDPR:** User preferences stored securely
- **SOC2:** Audit trail for all financial changes
- **PCI:** Stripe handles actual currency conversion
- **Financial Accuracy:** Live rates ensure fair pricing

---

**Documentation Version:** 1.0
**Last Updated:** January 2025
**Status:** ✅ Production Ready
