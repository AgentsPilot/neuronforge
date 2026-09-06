import { V2ThemeProvider } from '@/lib/design-system-v2/theme-provider';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';

export default function OnboardingBuildLayout({
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
