# app/fonts

> **Last Updated**: 2026-11-06

## Overview

Web font files, vendored. They are read off disk at build time by
`next/font/local` in the two layouts that use them, so compiling the app makes
no request to Google and loading a page makes none either.

They were downloaded once, by hand, and committed. Nothing in the build or the
test suite fetches them.

---

## Why they are here and not fetched

`next/font/google` downloads a face while compiling. On **2026-11-06** that
download was refused mid-build on Vercel and took the whole deployment with it:

```
app/business-os/layout.tsx
An error occurred in `next/font`.
TypeError: Cannot read properties of null (reading '1')
    at .../@next/font/dist/google/loader.js:112:78
```

The message names no cause because there is none to name. The loader fetches the
stylesheet, regexes it, and reads `[1]` off a match that is `null` whenever the
fetch did not return a stylesheet — so a rate limit, a 503 or an egress hiccup
all present as a `TypeError` inside Next.

The same commit built clean locally and in CI. Only the builder that Google
happened to refuse went red, which means the failure lands on whichever commit
is unlucky rather than on whoever changed something. That is not a dependency
worth keeping in the critical path of every deploy.

---

## What is here

| File | Family | Axis | Source |
|---|---|---|---|
| `Inter-Variable-latin.woff2` | Inter | `wght` 100-900 | `fonts.gstatic.com/s/inter/v20/…` (latin subset, variable) |
| `SpaceGrotesk-Variable-latin.woff2` | Space Grotesk | `wght` 300-700 | `fonts.gstatic.com/s/spacegrotesk/v22/…` (latin subset, variable) |

Both are the **variable** releases: one file per family covering the whole
weight axis, rather than one file per weight. That is why the layouts declare a
range (`weight: '100 900'`) instead of a list.

**Heebo is deliberately not here.** The site's root layout uses
`lib/pdf/fonts/Heebo-VariableFont_wght.ttf`, the official variable release
carrying both Latin and Hebrew, which was already vendored for the invoice PDFs.
One copy, one source of truth. A path that stops resolving fails the build
loudly, so a tidy-up of that directory cannot quietly change what the site looks
like.

---

## Licensing

Both families are under the SIL Open Font License 1.1, and the licence travels
with the files: `Inter-OFL.txt` and `SpaceGrotesk-OFL.txt`. Redistribution is
permitted, including embedded in a product, provided the licence is included —
which is what those two files are for. Do not delete them.

---

## Where they are used

| Layout | Faces | CSS variables |
|---|---|---|
| [app/layout.tsx](/app/layout.tsx) | Heebo (from `lib/pdf/fonts`) | applied via `className` |
| [app/business-os/layout.tsx](/app/business-os/layout.tsx) | Inter, Space Grotesk | `--font-body`, `--font-display` |

---

## Adding or replacing a face

1. Download the file by hand and commit it here, with its OFL text.
2. Load it with `next/font/local`, never `next/font/google`.
3. For a variable font, declare the weight **range the file carries**, not the
   weights the design currently uses — otherwise a later heading asking for an
   undeclared weight gets a browser-synthesised one.

`lib/pilot/__tests__` has no say here, but
`app/__tests__/theBuildNeverDownloadsAFont.guard.test.ts` does: it fails if any
`next/font/google` import comes back.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-06 | Created | Vendored Inter and Space Grotesk after `next/font/google` failed a Vercel deploy mid-build |
