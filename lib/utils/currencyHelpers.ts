// lib/utils/currencyHelpers.ts
// Utility functions for currency formatting and display

import { ExchangeRate } from '@/lib/services/CurrencyService';

/**
 * Format amount in specified currency with proper symbol and decimal places
 *
 * @param amount The amount to format
 * @param currency Currency code (e.g., 'USD', 'EUR')
 * @param options Formatting options
 */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  options: {
    symbol?: string;
    decimalPlaces?: number;
    locale?: string;
    showCode?: boolean;
  } = {}
): string {
  const {
    symbol,
    decimalPlaces = 2,
    locale = 'en-US',
    showCode = false
  } = options;

  // Format the number with proper decimal places
  const formattedAmount = amount.toLocaleString(locale, {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces
  });

  // Build the formatted string
  if (symbol) {
    // Use provided symbol
    return `${symbol}${formattedAmount}${showCode ? ` ${currency}` : ''}`;
  } else {
    // Use native currency formatting
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces
    }).format(amount);
  }
}

/**
 * Format currency using exchange rate data
 */
export function formatCurrencyWithRate(
  amount: number,
  rate: ExchangeRate,
  options: {
    locale?: string;
    showCode?: boolean;
  } = {}
): string {
  return formatCurrency(amount, rate.currency_code, {
    symbol: rate.currency_symbol,
    decimalPlaces: rate.decimal_places,
    locale: options.locale,
    showCode: options.showCode
  });
}

/**
 * Get currency symbol by code
 */
export function getCurrencySymbol(currencyCode: string): string {
  const symbols: Record<string, string> = {
    // Major currencies
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CHF: 'CHF',
    // North America
    CAD: 'CA$',
    MXN: 'MX$',
    // Asia Pacific
    AUD: 'A$',
    NZD: 'NZ$',
    SGD: 'S$',
    HKD: 'HK$',
    CNY: '¥',
    KRW: '₩',
    INR: '₹',
    THB: '฿',
    MYR: 'RM',
    PHP: '₱',
    IDR: 'Rp',
    VND: '₫',
    // Europe
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    CZK: 'Kč',
    HUF: 'Ft',
    RON: 'lei',
    BGN: 'лв',
    HRK: 'kn',
    RUB: '₽',
    TRY: '₺',
    UAH: '₴',
    // Middle East & Africa
    ZAR: 'R',
    AED: 'د.إ',
    SAR: '﷼',
    ILS: '₪',
    EGP: 'E£',
    NGN: '₦',
    KES: 'KSh',
    // South America
    BRL: 'R$',
    ARS: '$',
    CLP: '$',
    COP: '$',
    PEN: 'S/'
  };

  return symbols[currencyCode] || currencyCode;
}

/**
 * Get decimal places for currency
 * Most currencies use 2, but some like JPY use 0
 */
export function getCurrencyDecimalPlaces(currencyCode: string): number {
  const zeroDecimalCurrencies = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'IDR', 'HUF'];
  return zeroDecimalCurrencies.includes(currencyCode) ? 0 : 2;
}

/**
 * Parse currency string to number
 * Removes symbols and formatting
 */
export function parseCurrencyString(currencyString: string): number {
  // Remove all non-numeric characters except decimal point and minus
  const cleaned = currencyString.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Format Pilot Credits amount
 */
export function formatPilotCredits(credits: number): string {
  return credits.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

/**
 * Calculate price display for different credit amounts
 */
export interface PriceBreakdown {
  credits: number;
  priceUsd: number;
  pricePerCredit: number;
  formattedPrice: string;
  formattedCredits: string;
}

export function calculatePriceBreakdown(
  credits: number,
  pricePerCredit: number,
  currency: string = 'USD',
  exchangeRate: number = 1.0
): PriceBreakdown {
  const priceUsd = credits * pricePerCredit;
  const priceInCurrency = priceUsd * exchangeRate;

  return {
    credits,
    priceUsd,
    pricePerCredit,
    formattedPrice: formatCurrency(priceInCurrency, currency),
    formattedCredits: formatPilotCredits(credits)
  };
}

/**
 * Validate currency code format
 */
export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

/**
 * Get localized currency name
 */
export function getCurrencyName(currencyCode: string, locale: string = 'en-US'): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'currency' });
    return displayNames.of(currencyCode) || currencyCode;
  } catch {
    // Fallback to code if not supported
    return currencyCode;
  }
}

/**
 * Format currency range (e.g., "$10 - $100")
 */
export function formatCurrencyRange(
  minAmount: number,
  maxAmount: number,
  currency: string = 'USD',
  options: {
    symbol?: string;
    decimalPlaces?: number;
  } = {}
): string {
  const formattedMin = formatCurrency(minAmount, currency, options);
  const formattedMax = formatCurrency(maxAmount, currency, options);
  return `${formattedMin} - ${formattedMax}`;
}

/**
 * Abbreviate large currency amounts (e.g., $1.5M, $250K)
 */
export function formatCurrencyAbbreviated(
  amount: number,
  currency: string = 'USD',
  options: {
    symbol?: string;
  } = {}
): string {
  const symbol = options.symbol || getCurrencySymbol(currency);

  if (amount >= 1_000_000_000) {
    return `${symbol}${(amount / 1_000_000_000).toFixed(1)}B`;
  } else if (amount >= 1_000_000) {
    return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
  } else if (amount >= 1_000) {
    return `${symbol}${(amount / 1_000).toFixed(1)}K`;
  } else {
    return formatCurrency(amount, currency, options);
  }
}

/**
 * Get suggested credit amounts for purchase
 */
export function getSuggestedCreditAmounts(): number[] {
  return [
    1_000,      // $0.48
    5_000,      // $2.40
    10_000,     // $4.80
    25_000,     // $12.00
    50_000,     // $24.00
    100_000,    // $48.00
    250_000,    // $120.00
    500_000,    // $240.00
    1_000_000   // $480.00
  ];
}

/**
 * Format exchange rate for display
 */
export function formatExchangeRate(
  rate: number,
  fromCurrency: string,
  toCurrency: string,
  decimalPlaces: number = 4
): string {
  const formattedRate = rate.toFixed(decimalPlaces);
  return `1 ${fromCurrency} = ${formattedRate} ${toCurrency}`;
}

/**
 * Calculate savings percentage for boost packs
 */
export function calculateSavings(
  regularPrice: number,
  discountedPrice: number
): {
  savingsAmount: number;
  savingsPercentage: number;
  formattedPercentage: string;
} {
  const savingsAmount = regularPrice - discountedPrice;
  const savingsPercentage = (savingsAmount / regularPrice) * 100;

  return {
    savingsAmount,
    savingsPercentage,
    formattedPercentage: `${Math.round(savingsPercentage)}%`
  };
}

/**
 * Format price comparison (old price crossed out, new price)
 */
export interface PriceComparison {
  originalPrice: string;
  discountedPrice: string;
  savingsText: string;
  savingsPercentage: string;
}

export function formatPriceComparison(
  originalPrice: number,
  discountedPrice: number,
  currency: string = 'USD'
): PriceComparison {
  const savings = calculateSavings(originalPrice, discountedPrice);

  return {
    originalPrice: formatCurrency(originalPrice, currency),
    discountedPrice: formatCurrency(discountedPrice, currency),
    savingsText: formatCurrency(savings.savingsAmount, currency),
    savingsPercentage: savings.formattedPercentage
  };
}

/**
 * Get popular currencies for quick selection
 */
export function getPopularCurrencies(): string[] {
  return ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'SGD'];
}

/**
 * Group currencies by region
 */
export interface CurrencyGroup {
  region: string;
  currencies: string[];
}

export function getCurrenciesByRegion(): CurrencyGroup[] {
  return [
    {
      region: 'North America',
      currencies: ['USD', 'CAD', 'MXN']
    },
    {
      region: 'Europe',
      currencies: ['EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'UAH']
    },
    {
      region: 'Asia Pacific',
      currencies: ['JPY', 'CNY', 'KRW', 'HKD', 'SGD', 'AUD', 'NZD', 'INR', 'THB', 'MYR', 'PHP', 'IDR', 'VND']
    },
    {
      region: 'Middle East & Africa',
      currencies: ['AED', 'SAR', 'ILS', 'EGP', 'ZAR', 'NGN', 'KES']
    },
    {
      region: 'South America',
      currencies: ['BRL', 'ARS', 'CLP', 'COP', 'PEN']
    }
  ];
}

/**
 * Convert credits to approximate LLM tokens
 */
export function creditsToTokens(credits: number, tokensPerCredit: number = 10): number {
  return credits * tokensPerCredit;
}

/**
 * Convert LLM tokens to credits
 */
export function tokensToCredits(tokens: number, tokensPerCredit: number = 10): number {
  return Math.ceil(tokens / tokensPerCredit);
}

/**
 * Format token count with proper abbreviation
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  } else {
    return `${tokens} tokens`;
  }
}
