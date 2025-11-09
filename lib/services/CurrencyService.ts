// lib/services/CurrencyService.ts
// Service for managing exchange rates and currency conversions

import { SupabaseClient } from '@supabase/supabase-js';
import { SystemConfigService } from './SystemConfigService';

export interface ExchangeRate {
  id: string;
  currency_code: string;
  currency_name: string;
  currency_symbol: string;
  rate_to_usd: number;
  is_enabled: boolean;
  decimal_places: number;
  last_updated_at: string;
  created_at: string;
}

export interface CurrencyConversion {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  convertedAmount: number;
  rate: number;
  timestamp: string;
}

/**
 * CurrencyService
 *
 * Handles currency conversions and exchange rate management:
 * - Fetch exchange rates from database or external API
 * - Convert amounts between currencies
 * - Update exchange rates (manual or automated)
 * - Cache rates for performance
 */
export class CurrencyService {
  private supabase: SupabaseClient;
  private ratesCache: Map<string, ExchangeRate> = new Map();
  private cacheExpiry: Date | null = null;
  private readonly CACHE_DURATION_MS = 1000 * 60 * 60; // 1 hour

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Get all enabled exchange rates
   */
  async getEnabledRates(): Promise<ExchangeRate[]> {
    // Check cache first
    if (this.isCacheValid()) {
      return Array.from(this.ratesCache.values()).filter(r => r.is_enabled);
    }

    // Fetch from database
    const { data, error } = await this.supabase
      .from('exchange_rates')
      .select('*')
      .eq('is_enabled', true)
      .order('currency_code');

    if (error) {
      console.error('Error fetching exchange rates:', error);
      throw new Error('Failed to fetch exchange rates');
    }

    // Update cache
    this.updateCache(data || []);

    return data || [];
  }

  /**
   * Get all exchange rates (regardless of enabled status)
   * Used for currency selector since we fetch live rates
   */
  async getAllRates(): Promise<ExchangeRate[]> {
    // Check cache first
    if (this.isCacheValid()) {
      return Array.from(this.ratesCache.values());
    }

    // Fetch from database
    const { data, error } = await this.supabase
      .from('exchange_rates')
      .select('*')
      .order('currency_code');

    if (error) {
      console.error('Error fetching all exchange rates:', error);
      throw new Error('Failed to fetch exchange rates');
    }

    // Update cache
    this.updateCache(data || []);

    return data || [];
  }

  /**
   * Get specific exchange rate by currency code
   */
  async getRate(currencyCode: string): Promise<ExchangeRate | null> {
    // Check cache first
    if (this.isCacheValid() && this.ratesCache.has(currencyCode)) {
      return this.ratesCache.get(currencyCode)!;
    }

    // Fetch from database
    const { data, error } = await this.supabase
      .from('exchange_rates')
      .select('*')
      .eq('currency_code', currencyCode)
      .single();

    if (error) {
      console.error(`Error fetching rate for ${currencyCode}:`, error);
      return null;
    }

    // Update cache for this rate
    if (data) {
      this.ratesCache.set(currencyCode, data);
    }

    return data;
  }

  /**
   * Convert amount from one currency to another
   *
   * @param amount Amount in fromCurrency
   * @param fromCurrency Source currency code (e.g., 'USD')
   * @param toCurrency Target currency code (e.g., 'EUR')
   */
  async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string
  ): Promise<CurrencyConversion> {
    // If same currency, no conversion needed
    if (fromCurrency === toCurrency) {
      return {
        fromCurrency,
        toCurrency,
        amount,
        convertedAmount: amount,
        rate: 1.0,
        timestamp: new Date().toISOString()
      };
    }

    // Get exchange rates
    const fromRate = await this.getRate(fromCurrency);
    const toRate = await this.getRate(toCurrency);

    if (!fromRate || !toRate) {
      throw new Error(`Exchange rate not found for ${!fromRate ? fromCurrency : toCurrency}`);
    }

    // Convert: amount in fromCurrency → USD → toCurrency
    // Example: 100 EUR → USD → GBP
    // Step 1: EUR to USD = 100 / 0.92 = 108.70 USD
    // Step 2: USD to GBP = 108.70 * 0.79 = 85.87 GBP
    const amountInUsd = amount / fromRate.rate_to_usd;
    const convertedAmount = amountInUsd * toRate.rate_to_usd;
    const directRate = toRate.rate_to_usd / fromRate.rate_to_usd;

    return {
      fromCurrency,
      toCurrency,
      amount,
      convertedAmount,
      rate: directRate,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Convert from USD to target currency
   */
  async convertFromUsd(amountUsd: number, toCurrency: string): Promise<number> {
    if (toCurrency === 'USD') {
      return amountUsd;
    }

    const rate = await this.getRate(toCurrency);
    if (!rate) {
      throw new Error(`Exchange rate not found for ${toCurrency}`);
    }

    return amountUsd * rate.rate_to_usd;
  }

  /**
   * Convert to USD from source currency
   */
  async convertToUsd(amount: number, fromCurrency: string): Promise<number> {
    if (fromCurrency === 'USD') {
      return amount;
    }

    const rate = await this.getRate(fromCurrency);
    if (!rate) {
      throw new Error(`Exchange rate not found for ${fromCurrency}`);
    }

    return amount / rate.rate_to_usd;
  }

  /**
   * Update exchange rate for a currency (admin only)
   */
  async updateRate(
    currencyCode: string,
    newRate: number,
    updatedBy: string,
    reason?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('exchange_rates')
      .update({
        rate_to_usd: newRate,
        last_updated_at: new Date().toISOString(),
        updated_by: updatedBy
      })
      .eq('currency_code', currencyCode);

    if (error) {
      console.error(`Error updating rate for ${currencyCode}:`, error);
      throw new Error('Failed to update exchange rate');
    }

    // Invalidate cache
    this.invalidateCache();

    // Log to history (trigger will handle this automatically)
    console.log(`📊 Exchange rate updated: ${currencyCode} → ${newRate} USD by ${updatedBy}${reason ? ` (${reason})` : ''}`);
  }

  /**
   * Bulk update exchange rates from external API
   */
  async updateRatesFromApi(updatedBy: string): Promise<void> {
    const provider = await SystemConfigService.get<string>(
      this.supabase,
      'currency_api_provider',
      'manual'
    );

    if (provider === 'manual') {
      throw new Error('Automatic rate updates not enabled. Provider set to "manual".');
    }

    // Fetch rates from API based on provider
    let rates: Record<string, number>;

    switch (provider) {
      case 'exchangerate-api':
        rates = await this.fetchFromExchangeRateApi();
        break;
      case 'fixer.io':
        rates = await this.fetchFromFixerIo();
        break;
      default:
        throw new Error(`Unknown API provider: ${provider}`);
    }

    // Update all rates in database
    const enabledRates = await this.getEnabledRates();

    for (const rate of enabledRates) {
      if (rates[rate.currency_code] && rate.currency_code !== 'USD') {
        await this.updateRate(
          rate.currency_code,
          rates[rate.currency_code],
          updatedBy,
          `Auto-update from ${provider}`
        );
      }
    }

    // Update last API update timestamp
    await SystemConfigService.set(
      this.supabase,
      'currency_last_api_update',
      new Date().toISOString()
    );

    console.log(`✅ Exchange rates updated from ${provider} API`);
  }

  /**
   * Fetch rates from exchangerate-api.com (free tier available)
   */
  private async fetchFromExchangeRateApi(): Promise<Record<string, number>> {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    if (!apiKey) {
      throw new Error('EXCHANGE_RATE_API_KEY environment variable not set');
    }

    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`
    );

    if (!response.ok) {
      throw new Error(`Exchange rate API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.result !== 'success') {
      throw new Error(`Exchange rate API error: ${data['error-type']}`);
    }

    // API returns rates as "1 USD = X [currency]"
    // We need to invert to get "rate_to_usd" format
    const rates: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(data.conversion_rates)) {
      rates[currency] = 1 / (rate as number);
    }

    return rates;
  }

  /**
   * Fetch rates from fixer.io (paid service)
   */
  private async fetchFromFixerIo(): Promise<Record<string, number>> {
    const apiKey = process.env.FIXER_API_KEY;
    if (!apiKey) {
      throw new Error('FIXER_API_KEY environment variable not set');
    }

    const response = await fetch(
      `http://data.fixer.io/api/latest?access_key=${apiKey}&base=USD`
    );

    if (!response.ok) {
      throw new Error(`Fixer.io API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Fixer.io API error: ${data.error?.info || 'Unknown error'}`);
    }

    return data.rates;
  }

  /**
   * Get user's preferred currency from preferences
   */
  async getUserCurrency(userId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from('user_preferences')
      .select('preferred_currency')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      // Return default currency from config
      return await SystemConfigService.get<string>(
        this.supabase,
        'currency_default',
        'USD'
      );
    }

    return data.preferred_currency || 'USD';
  }

  /**
   * Update user's preferred currency
   */
  async setUserCurrency(userId: string, currencyCode: string): Promise<void> {
    // Verify currency exists in database
    const rate = await this.getRate(currencyCode);
    if (!rate) {
      throw new Error(`Currency ${currencyCode} is not available`);
    }

    // Get old currency for audit trail
    const oldCurrency = await this.getUserCurrency(userId);

    const { error } = await this.supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        preferred_currency: currencyCode,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      console.error('Error updating user currency preference:', error);
      throw new Error('Failed to update currency preference');
    }

    // Log to audit trail (only on server-side)
    if (typeof window === 'undefined') {
      try {
        // Lazy import to avoid loading AuditTrailService on client-side
        const { AuditTrailService } = await import('./AuditTrailService');
        const { AUDIT_EVENTS } = await import('../audit/events');

        const auditService = AuditTrailService.getInstance();
        await auditService.log({
          userId,
          action: AUDIT_EVENTS.SETTINGS_CURRENCY_CHANGED,
          resourceType: 'user_preference',
          resourceId: userId,
          changes: {
            before: { preferred_currency: oldCurrency },
            after: { preferred_currency: currencyCode }
          },
          metadata: {
            currency_symbol: rate.currency_symbol,
            currency_name: rate.currency_name
          }
        });
      } catch (auditError) {
        console.error('Failed to log to audit trail:', auditError);
        // Don't fail the currency update if audit logging fails
      }
    }

    console.log(`✅ User ${userId} currency updated to ${currencyCode}`);
  }

  /**
   * Cache management
   */
  private isCacheValid(): boolean {
    return (
      this.cacheExpiry !== null &&
      this.cacheExpiry > new Date() &&
      this.ratesCache.size > 0
    );
  }

  private updateCache(rates: ExchangeRate[]): void {
    this.ratesCache.clear();
    rates.forEach(rate => {
      this.ratesCache.set(rate.currency_code, rate);
    });
    this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);
  }

  private invalidateCache(): void {
    this.ratesCache.clear();
    this.cacheExpiry = null;
  }

  /**
   * Clear cache manually
   */
  clearCache(): void {
    this.invalidateCache();
  }
}

/**
 * Helper function to create CurrencyService instance
 */
export function createCurrencyService(supabase: SupabaseClient): CurrencyService {
  return new CurrencyService(supabase);
}
