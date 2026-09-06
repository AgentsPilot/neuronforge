// app/layout.tsx

import './globals.css'
import { Heebo } from 'next/font/google'
import { PlatformChrome } from '@/components/PlatformChrome'

const heebo = Heebo({ subsets: ['latin', 'hebrew'] })

export const metadata = {
  title: 'NeuronForge',
  description: 'Build your own AI workflows and agents',
}

/**
 * `lang`/`dir` are the platform's defaults, not the final word. Public pages
 * are rendered in the language of the *business*, not of the platform, and
 * their segment layouts rewrite both attributes here before first paint (see
 * `components/public/PublicDirScript`). `suppressHydrationWarning` is what
 * makes that legal — without it React flags the mutated attributes as a
 * hydration mismatch on every public page load.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body className={heebo.className}>
        <PlatformChrome>{children}</PlatformChrome>
      </body>
    </html>
  )
}
