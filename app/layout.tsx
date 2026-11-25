// app/layout.tsx

import './globals.css'
import localFont from 'next/font/local'
import { PlatformChrome } from '@/components/PlatformChrome'

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FONT IS ON DISK, BECAUSE A BUILD MUST NOT DEPEND ON GOOGLE BEING UP.
 *
 * `next/font/google` downloads the face while compiling. On 2026-11-06 that
 * download failed on Vercel and took the whole deployment with it:
 *
 *     app/business-os/layout.tsx
 *     An error occurred in `next/font`.
 *     TypeError: Cannot read properties of null (reading '1')
 *         at .../@next/font/dist/google/loader.js:112:78
 *
 * That message names no cause because there is none to name: the loader
 * fetches the stylesheet, regexes it, and reads `[1]` off a match that is null
 * when the fetch did not return a stylesheet. Any blip — a rate limit, a 503,
 * an egress hiccup — presents as a type error inside Next.
 *
 * It is not a failure worth inheriting. The same commit built clean locally and
 * in CI; only the builder that happened to be refused by Google went red, so
 * the breakage lands on whichever commit is unlucky rather than on whoever
 * broke something. Reading the file from the repository removes the third-party
 * network call from the critical path of every deploy, and the request from the
 * critical path of every page load for our users as well.
 *
 * ONE FILE, SHARED WITH THE PDF RENDERER. This is the official variable
 * release, Latin and Hebrew in the one face, and it was already vendored for
 * the invoice PDFs. Pointing at it rather than copying it keeps a single source
 * of truth — and a path that stops resolving fails the BUILD, loudly, so a
 * future tidy-up of `lib/pdf/fonts` cannot silently change what the site looks
 * like. The weight range is the axis the file actually carries.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const heebo = localFont({
  src: '../lib/pdf/fonts/Heebo-VariableFont_wght.ttf',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
})

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
