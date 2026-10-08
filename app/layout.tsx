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
 * The viewport, stated rather than defaulted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `interactiveWidget: 'resizes-content'` is the half that matters.
 *
 * By default, an on-screen keyboard overlays the page: the visual viewport
 * shrinks, the LAYOUT viewport does not, and `100dvh` keeps reporting the full
 * screen. Every settings dialog is `position: fixed` at `100dvh`, so when an
 * owner taps a field the dialog stays full height BEHIND the keyboard, the
 * field they tapped can sit under it, and the panel's own scroll container has
 * no idea anything moved — it is already scrolled to its end.
 *
 * `resizes-content` makes the keyboard resize the viewport instead of covering
 * it, so `100dvh` becomes the space actually visible and the dialog's scroll
 * area can reach every field. Honoured by Chrome and Android browsers; iOS
 * Safari ignores it today, which is why the 16px rule in `globals.css` matters
 * independently — that one is what stops iOS zooming on focus in the first
 * place.
 *
 * No `maximumScale` and no `userScalable: false`: refusing a reader the ability
 * to zoom is an accessibility failure, and it is also the wrong fix for the
 * zoom-on-focus problem, which is caused by the font size and is fixed there.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content' as const,
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
