/**
 * next-intl configuration
 * Configure next-intl for multi-language support
 */

import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales, type Locale } from './lib/i18n/config';

export default getRequestConfig(async ({ locale }) => {
  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  return {
    messages: (await import(`./messages/${locale}.json`)).default
  };
});
