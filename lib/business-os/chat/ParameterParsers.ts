/**
 * ParameterParsers
 *
 * Deterministic parsers for converting natural language values
 * into structured data types. Supports English and Hebrew.
 */

// ============== TYPES ==============

export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'duration'
  | 'money'
  | 'email'
  | 'phone'
  | 'entity_ref';

export interface ParseResult<T> {
  success: boolean;
  value?: T;
  error?: string;
  confidence?: number; // 0-1, how confident we are in the parse
}

// ============== DATE PARSER ==============

interface DatePattern {
  pattern: RegExp;
  resolver: (match: RegExpMatchArray, now: Date) => Date;
}

const DATE_PATTERNS: DatePattern[] = [
  // ========== RELATIVE DATES (English) ==========
  { pattern: /^today$/i, resolver: (_, now) => now },
  { pattern: /^tomorrow$/i, resolver: (_, now) => addDays(now, 1) },
  { pattern: /^yesterday$/i, resolver: (_, now) => addDays(now, -1) },
  { pattern: /^day after tomorrow$/i, resolver: (_, now) => addDays(now, 2) },
  { pattern: /^next week$/i, resolver: (_, now) => addDays(now, 7) },
  { pattern: /^next month$/i, resolver: (_, now) => addMonths(now, 1) },
  { pattern: /^next year$/i, resolver: (_, now) => addYears(now, 1) },
  { pattern: /^in (\d+) days?$/i, resolver: (m, now) => addDays(now, parseInt(m[1])) },
  { pattern: /^in (\d+) weeks?$/i, resolver: (m, now) => addDays(now, parseInt(m[1]) * 7) },
  { pattern: /^in (\d+) months?$/i, resolver: (m, now) => addMonths(now, parseInt(m[1])) },
  { pattern: /^(\d+) days? from now$/i, resolver: (m, now) => addDays(now, parseInt(m[1])) },
  { pattern: /^(\d+) weeks? from now$/i, resolver: (m, now) => addDays(now, parseInt(m[1]) * 7) },

  // ========== RELATIVE DATES (Hebrew) ==========
  { pattern: /^היום$/i, resolver: (_, now) => now },
  { pattern: /^מחר$/i, resolver: (_, now) => addDays(now, 1) },
  { pattern: /^מחרתיים$/i, resolver: (_, now) => addDays(now, 2) },
  { pattern: /^אתמול$/i, resolver: (_, now) => addDays(now, -1) },
  { pattern: /^בעוד שבוע$/i, resolver: (_, now) => addDays(now, 7) },
  { pattern: /^בעוד חודש$/i, resolver: (_, now) => addMonths(now, 1) },
  { pattern: /^בעוד שנה$/i, resolver: (_, now) => addYears(now, 1) },
  { pattern: /^בעוד (\d+) ימים$/i, resolver: (m, now) => addDays(now, parseInt(m[1])) },
  { pattern: /^בעוד (\d+) שבועות$/i, resolver: (m, now) => addDays(now, parseInt(m[1]) * 7) },
  { pattern: /^בעוד (\d+) חודשים$/i, resolver: (m, now) => addMonths(now, parseInt(m[1])) },
  { pattern: /^עוד (\d+) ימים$/i, resolver: (m, now) => addDays(now, parseInt(m[1])) },

  // ========== DAY OF WEEK (English) ==========
  { pattern: /^(this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i,
    resolver: (m, now) => getNextDayOfWeek(m[2], now, false) },
  { pattern: /^next (sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i,
    resolver: (m, now) => getNextDayOfWeek(m[1], now, true) },

  // ========== DAY OF WEEK (Hebrew) ==========
  { pattern: /^(ביום |יום )?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/i,
    resolver: (m, now) => getNextDayOfWeekHebrew(m[2], now, false) },
  { pattern: /^(ב)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת) הבא$/i,
    resolver: (m, now) => getNextDayOfWeekHebrew(m[2], now, true) },

  // ========== END OF PERIOD ==========
  { pattern: /^end of (this )?week$/i, resolver: (_, now) => getEndOfWeek(now) },
  { pattern: /^end of (this )?month$/i, resolver: (_, now) => getEndOfMonth(now) },
  { pattern: /^סוף השבוע$/i, resolver: (_, now) => getEndOfWeek(now) },
  { pattern: /^סוף החודש$/i, resolver: (_, now) => getEndOfMonth(now) },

  // ========== ABSOLUTE DATES ==========
  // ISO format: 2026-07-31
  { pattern: /^(\d{4})-(\d{2})-(\d{2})$/, resolver: (m) => new Date(m[0]) },
  // US format: 07/31/2026 or 7/31/2026
  { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, resolver: (m) =>
    new Date(parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2])) },
  // European format: 31.07.2026 or 31/07/2026
  { pattern: /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/, resolver: (m) =>
    new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) },
  // Short format: 31/7 or 31.7 (assumes current year)
  { pattern: /^(\d{1,2})[./](\d{1,2})$/, resolver: (m, now) =>
    new Date(now.getFullYear(), parseInt(m[2]) - 1, parseInt(m[1])) },
];

export function parseDate(input: string, referenceDate?: Date): ParseResult<string> {
  const trimmed = input.trim();
  const now = referenceDate || new Date();

  for (const { pattern, resolver } of DATE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      try {
        const date = resolver(match, now);
        if (!isNaN(date.getTime())) {
          return {
            success: true,
            value: date.toISOString().split('T')[0],
            confidence: 0.95
          };
        }
      } catch {
        continue;
      }
    }
  }

  // Try native Date parsing as fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return {
      success: true,
      value: parsed.toISOString().split('T')[0],
      confidence: 0.7
    };
  }

  return { success: false, error: `Could not parse date: "${input}"` };
}

// ============== TIME PARSER ==============

interface TimePattern {
  pattern: RegExp;
  resolver: (match: RegExpMatchArray) => { hours: number; minutes: number };
}

const TIME_PATTERNS: TimePattern[] = [
  // 24-hour format: 14:30, 9:00
  { pattern: /^(\d{1,2}):(\d{2})$/,
    resolver: (m) => ({ hours: parseInt(m[1]), minutes: parseInt(m[2]) }) },

  // 12-hour format: 2pm, 2:30pm, 2:30 pm
  { pattern: /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i,
    resolver: (m) => {
      let hours = parseInt(m[1]);
      const minutes = m[2] ? parseInt(m[2]) : 0;
      const isPM = m[3].toLowerCase() === 'pm';
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
      return { hours, minutes };
    }
  },

  // Natural language (English)
  { pattern: /^(early )?morning$/i, resolver: () => ({ hours: 8, minutes: 0 }) },
  { pattern: /^mid-?morning$/i, resolver: () => ({ hours: 10, minutes: 0 }) },
  { pattern: /^noon$/i, resolver: () => ({ hours: 12, minutes: 0 }) },
  { pattern: /^(early )?afternoon$/i, resolver: () => ({ hours: 14, minutes: 0 }) },
  { pattern: /^(late )?afternoon$/i, resolver: () => ({ hours: 16, minutes: 0 }) },
  { pattern: /^(early )?evening$/i, resolver: () => ({ hours: 18, minutes: 0 }) },
  { pattern: /^(late )?evening$/i, resolver: () => ({ hours: 20, minutes: 0 }) },
  { pattern: /^night$/i, resolver: () => ({ hours: 21, minutes: 0 }) },

  // Natural language (Hebrew)
  { pattern: /^(ב)?בוקר$/i, resolver: () => ({ hours: 9, minutes: 0 }) },
  { pattern: /^(ב)?בוקר מוקדם$/i, resolver: () => ({ hours: 7, minutes: 0 }) },
  { pattern: /^(ב)?צהריים$/i, resolver: () => ({ hours: 12, minutes: 0 }) },
  { pattern: /^(ב)?אחה"?צ$/i, resolver: () => ({ hours: 14, minutes: 0 }) },
  { pattern: /^(אחרי ה|ב)?צהריים$/i, resolver: () => ({ hours: 14, minutes: 0 }) },
  { pattern: /^(ב)?ערב$/i, resolver: () => ({ hours: 18, minutes: 0 }) },
  { pattern: /^(ב)?לילה$/i, resolver: () => ({ hours: 21, minutes: 0 }) },
];

export function parseTime(input: string): ParseResult<string> {
  const trimmed = input.trim();

  for (const { pattern, resolver } of TIME_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const { hours, minutes } = resolver(match);
      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        return {
          success: true,
          value: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
          confidence: 0.9
        };
      }
    }
  }

  return { success: false, error: `Could not parse time: "${input}"` };
}

// ============== DATETIME PARSER ==============

export function parseDateTime(input: string, referenceDate?: Date): ParseResult<string> {
  const trimmed = input.trim();

  // Try to find both date and time components
  // Pattern: "tomorrow at 3pm", "Monday 14:00", "2026-07-31 09:00"

  // Check for "at" or "ב" separator
  const atMatch = trimmed.match(/^(.+?)\s+(?:at|@|ב-?)\s*(.+)$/i);
  if (atMatch) {
    const dateResult = parseDate(atMatch[1], referenceDate);
    const timeResult = parseTime(atMatch[2]);

    if (dateResult.success && timeResult.success) {
      return {
        success: true,
        value: `${dateResult.value}T${timeResult.value}:00`,
        confidence: Math.min(dateResult.confidence || 1, timeResult.confidence || 1)
      };
    }
  }

  // Try space separator: "tomorrow 3pm"
  const spaceMatch = trimmed.match(/^(.+?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})$/i);
  if (spaceMatch) {
    const dateResult = parseDate(spaceMatch[1], referenceDate);
    const timeResult = parseTime(spaceMatch[2]);

    if (dateResult.success && timeResult.success) {
      return {
        success: true,
        value: `${dateResult.value}T${timeResult.value}:00`,
        confidence: Math.min(dateResult.confidence || 1, timeResult.confidence || 1)
      };
    }
  }

  // Just a date - default to 9:00 AM
  const dateOnly = parseDate(trimmed, referenceDate);
  if (dateOnly.success) {
    return {
      success: true,
      value: `${dateOnly.value}T09:00:00`,
      confidence: (dateOnly.confidence || 1) * 0.8 // Lower confidence because time is assumed
    };
  }

  // Just a time - default to today
  const timeOnly = parseTime(trimmed);
  if (timeOnly.success) {
    const today = (referenceDate || new Date()).toISOString().split('T')[0];
    return {
      success: true,
      value: `${today}T${timeOnly.value}:00`,
      confidence: (timeOnly.confidence || 1) * 0.8
    };
  }

  return { success: false, error: `Could not parse datetime: "${input}"` };
}

// ============== DURATION PARSER ==============

export function parseDuration(input: string): ParseResult<number> {
  const trimmed = input.trim().toLowerCase();

  // Minutes: "30 min", "30 minutes", "30 דקות"
  const minMatch = trimmed.match(/^(\d+)\s*(min|mins|minutes?|דקות?|דק)$/i);
  if (minMatch) {
    return { success: true, value: parseInt(minMatch[1]), confidence: 0.95 };
  }

  // Hours: "1 hour", "2 hours", "1.5 hours", "שעה", "שעתיים", "2 שעות"
  const hourMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|שעות?|שעה)$/i);
  if (hourMatch) {
    return { success: true, value: Math.round(parseFloat(hourMatch[1]) * 60), confidence: 0.95 };
  }

  // Hebrew special: שעתיים = 2 hours
  if (/^שעתיים$/.test(trimmed)) {
    return { success: true, value: 120, confidence: 0.95 };
  }

  // Combined: "1 hour 30 minutes", "1h 30m", "שעה וחצי"
  const combinedMatch = trimmed.match(
    /^(\d+)\s*(?:h|hr|hours?|שעות?|שעה)\s+(\d+)\s*(?:min|mins|minutes?|דקות?|דק)$/i
  );
  if (combinedMatch) {
    return {
      success: true,
      value: parseInt(combinedMatch[1]) * 60 + parseInt(combinedMatch[2]),
      confidence: 0.95
    };
  }

  // Hebrew: שעה וחצי = 1.5 hours
  if (/^שעה וחצי$/.test(trimmed)) {
    return { success: true, value: 90, confidence: 0.95 };
  }

  // Hebrew: חצי שעה = 30 minutes
  if (/^חצי שעה$/.test(trimmed)) {
    return { success: true, value: 30, confidence: 0.95 };
  }

  // Just a number - assume minutes
  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) {
    return { success: true, value: parseInt(numMatch[1]), confidence: 0.7 };
  }

  return { success: false, error: `Could not parse duration: "${input}"` };
}

// ============== MONEY PARSER ==============

export interface MoneyValue {
  amount: number;
  currency: string;
}

export function parseMoney(input: string, defaultCurrency = 'ILS'): ParseResult<MoneyValue> {
  const trimmed = input.trim();

  // Currency symbol map
  const symbolToCurrency: Record<string, string> = {
    '₪': 'ILS',
    '$': 'USD',
    '€': 'EUR',
    '£': 'GBP'
  };

  // Currency name map
  const nameToCurrency: Record<string, string> = {
    'שקל': 'ILS', 'שקלים': 'ILS', 'ש"ח': 'ILS', 'שח': 'ILS',
    'דולר': 'USD', 'דולרים': 'USD',
    'אירו': 'EUR', 'יורו': 'EUR',
    'ils': 'ILS', 'usd': 'USD', 'eur': 'EUR', 'gbp': 'GBP'
  };

  // With symbol prefix: ₪100, $50.99
  const prefixMatch = trimmed.match(/^([₪$€£])\s*(\d+(?:[.,]\d{1,2})?)$/);
  if (prefixMatch) {
    const amount = parseFloat(prefixMatch[2].replace(',', '.'));
    const currency = symbolToCurrency[prefixMatch[1]] || defaultCurrency;
    return { success: true, value: { amount, currency }, confidence: 0.95 };
  }

  // With symbol suffix: 100₪, 50.99$
  const suffixMatch = trimmed.match(/^(\d+(?:[.,]\d{1,2})?)\s*([₪$€£])$/);
  if (suffixMatch) {
    const amount = parseFloat(suffixMatch[1].replace(',', '.'));
    const currency = symbolToCurrency[suffixMatch[2]] || defaultCurrency;
    return { success: true, value: { amount, currency }, confidence: 0.95 };
  }

  // With currency name: 100 שקל, 50 dollars
  const nameMatch = trimmed.match(/^(\d+(?:[.,]\d{1,2})?)\s*(.+)$/);
  if (nameMatch) {
    const amount = parseFloat(nameMatch[1].replace(',', '.'));
    const currencyName = nameMatch[2].toLowerCase().trim();
    const currency = nameToCurrency[currencyName];
    if (currency) {
      return { success: true, value: { amount, currency }, confidence: 0.9 };
    }
  }

  // Just a number - use default currency
  const numMatch = trimmed.match(/^(\d+(?:[.,]\d{1,2})?)$/);
  if (numMatch) {
    const amount = parseFloat(numMatch[1].replace(',', '.'));
    return { success: true, value: { amount, currency: defaultCurrency }, confidence: 0.8 };
  }

  return { success: false, error: `Could not parse amount: "${input}"` };
}

// ============== EMAIL PARSER ==============

export function parseEmail(input: string): ParseResult<string> {
  const trimmed = input.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emailPattern.test(trimmed)) {
    return { success: true, value: trimmed, confidence: 0.99 };
  }

  return { success: false, error: `Invalid email format: "${input}"` };
}

// ============== PHONE PARSER ==============

export function parsePhone(input: string): ParseResult<string> {
  // Remove all non-digit characters except +
  const cleaned = input.replace(/[^\d+]/g, '');

  // Israeli phone patterns
  const israeliMobile = /^(?:\+972|972|0)?5\d{8}$/;
  const israeliLandline = /^(?:\+972|972|0)?[2-9]\d{7,8}$/;

  // International pattern (at least 9 digits)
  const international = /^\+?\d{9,15}$/;

  if (israeliMobile.test(cleaned) || israeliLandline.test(cleaned) || international.test(cleaned)) {
    // Normalize to include country code for Israeli numbers
    let normalized = cleaned;
    if (/^0[5-9]/.test(cleaned)) {
      normalized = '+972' + cleaned.slice(1);
    } else if (/^5\d{8}$/.test(cleaned)) {
      normalized = '+972' + cleaned;
    }

    return { success: true, value: normalized, confidence: 0.95 };
  }

  return { success: false, error: `Invalid phone number: "${input}"` };
}

// ============== BOOLEAN PARSER ==============

export function parseBoolean(input: string): ParseResult<boolean> {
  const trimmed = input.trim().toLowerCase();

  const truePatterns = ['true', 'yes', 'y', '1', 'on', 'כן', 'נכון', 'אמת', 'כ'];
  const falsePatterns = ['false', 'no', 'n', '0', 'off', 'לא', 'שקר', 'לא נכון'];

  if (truePatterns.includes(trimmed)) {
    return { success: true, value: true, confidence: 0.95 };
  }
  if (falsePatterns.includes(trimmed)) {
    return { success: true, value: false, confidence: 0.95 };
  }

  return { success: false, error: `Could not parse boolean: "${input}"` };
}

// ============== NUMBER PARSER ==============

export function parseNumber(input: string): ParseResult<number> {
  const trimmed = input.trim();

  // Handle Hebrew number words
  const hebrewNumbers: Record<string, number> = {
    'אפס': 0, 'אחת': 1, 'אחד': 1, 'שתיים': 2, 'שניים': 2,
    'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4,
    'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6,
    'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9,
    'עשר': 10, 'עשרה': 10
  };

  if (hebrewNumbers[trimmed.toLowerCase()] !== undefined) {
    return { success: true, value: hebrewNumbers[trimmed.toLowerCase()], confidence: 0.95 };
  }

  // Standard number parsing
  const num = parseFloat(trimmed.replace(',', '.'));
  if (!isNaN(num)) {
    return { success: true, value: num, confidence: 0.95 };
  }

  return { success: false, error: `Invalid number: "${input}"` };
}

// ============== UNIFIED PARSER ==============

export function parseParameter(
  input: string,
  type: ParamType,
  options?: {
    defaultCurrency?: string;
    referenceDate?: Date;
  }
): ParseResult<unknown> {
  switch (type) {
    case 'date':
      return parseDate(input, options?.referenceDate);
    case 'time':
      return parseTime(input);
    case 'datetime':
      return parseDateTime(input, options?.referenceDate);
    case 'duration':
      return parseDuration(input);
    case 'money':
      return parseMoney(input, options?.defaultCurrency);
    case 'email':
      return parseEmail(input);
    case 'phone':
      return parsePhone(input);
    case 'boolean':
      return parseBoolean(input);
    case 'number':
      return parseNumber(input);
    case 'entity_ref':
      // Entity refs are handled by EntityResolver, not parsed here
      return { success: true, value: input.trim(), confidence: 0.5 };
    case 'string':
    default:
      return { success: true, value: input.trim(), confidence: 1.0 };
  }
}

// ============== HELPER FUNCTIONS ==============

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

function getNextDayOfWeek(dayName: string, now: Date, forceNextWeek: boolean): Date {
  const days: Record<string, number> = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6
  };

  const targetDay = days[dayName.toLowerCase()];
  if (targetDay === undefined) return now;

  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;

  if (daysUntil <= 0 || forceNextWeek) {
    daysUntil += 7;
  }

  return addDays(now, daysUntil);
}

function getNextDayOfWeekHebrew(dayName: string, now: Date, forceNextWeek: boolean): Date {
  const hebrewDays: Record<string, number> = {
    'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
    'חמישי': 4, 'שישי': 5, 'שבת': 6
  };

  const targetDay = hebrewDays[dayName];
  if (targetDay === undefined) return now;

  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;

  if (daysUntil <= 0 || forceNextWeek) {
    daysUntil += 7;
  }

  return addDays(now, daysUntil);
}

function getEndOfWeek(date: Date): Date {
  const result = new Date(date);
  const daysUntilSaturday = 6 - result.getDay();
  result.setDate(result.getDate() + daysUntilSaturday);
  return result;
}

function getEndOfMonth(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return result;
}
