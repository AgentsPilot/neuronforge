/**
 * Business OS Layout - No sidebar, full-width design
 * Matches the onboarding-v2 style with V2 theme
 */
import { UserProvider } from '@/components/UserProvider';
import { V2ThemeProvider } from '@/lib/design-system-v2';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';

export default function BusinessOSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserProvider>
      <V2ThemeProvider>
        <LanguageProvider>
          <div className="w-full h-full">
            {children}
          </div>
        </LanguageProvider>
      </V2ThemeProvider>
    </UserProvider>
  );
}
