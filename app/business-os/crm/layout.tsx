'use client';

import { V2ThemeProvider } from '@/lib/design-system-v2';
import '../../v2/globals-v2.css';

/*
 * No LanguageProvider here (performance business round BR-1a, SA C-1).
 *
 * This layout used to mount a SECOND one inside the Business OS layout's. Being
 * a client layout it could not receive the server-read language, so every CRM
 * page kept the English first frame; it also held its own state, so a switch
 * from the header did not reach CRM content, and it repeated the preferences
 * request (and, with nothing saved, the backfill). CRM pages use the Business
 * OS layout's provider now.
 */

export default function CRMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <V2ThemeProvider>
      {children}
    </V2ThemeProvider>
  );
}
