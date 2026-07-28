'use client';

import { V2ThemeProvider } from '@/lib/design-system-v2';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import '../v2/globals-v2.css';

export default function OnboardingV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <V2ThemeProvider>
      <LanguageProvider>
        {children}
      </LanguageProvider>
    </V2ThemeProvider>
  );
}
