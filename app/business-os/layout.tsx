/**
 * Business OS Layout - No sidebar, full-width design
 * Matches the onboarding-v2 style with V2 theme
 */
import { UserProvider } from '@/components/UserProvider';
import { V2ThemeProvider } from '@/lib/design-system-v2';
import { LanguageProvider } from '@/lib/business-os/LanguageContext';
import { Space_Grotesk, Inter } from 'next/font/google';

// Load Space Grotesk for display text (headlines)
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// Load Inter for body text
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

export default function BusinessOSLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <UserProvider>
      <V2ThemeProvider>
        <LanguageProvider>
          <div className={`w-full h-full ${spaceGrotesk.variable} ${inter.variable}`}>
            {children}
          </div>
        </LanguageProvider>
      </V2ThemeProvider>
    </UserProvider>
  );
}
