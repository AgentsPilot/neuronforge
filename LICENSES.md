# Third-Party Licences

> **Last Updated**: 2026-09-13

## Overview

Design work incorporated into AgentPilot from third-party open-source projects, and the licence
notices that travel with it. This file is the whole of what those licences ask in return.

---

## Website archetypes

The four looks a business can choose for its website, landing pages and smart links are defined in
[archetypes.ts](/lib/website-builder/archetypes.ts) and seeded into `website_archetypes`. Each was
derived from an MIT-licensed template.

| Archetype | Source project | Licence |
|---|---|---|
| Stone | `m6v3l9/astro-theme-stone` | MIT |
| Bloom | `ttomczak3/Milky-Way` | MIT |
| Lumen | `Gothsec/dark-minimal` | MIT |
| Aster | `matt765/Tailcast` | MIT |

### What was taken

Design decisions, expressed as data: palette, type stack, type scale, corner radii, spacing
register, and the names of layout arrangements. An archetype is about thirty values in a JSON blob.

### What was not taken

No source code, no markup, no content, no assets, and no framework. Three of the four are Astro
projects whose components could not be dropped into a React block even if that were the intent; the
rendering is AgentPilot's own, in [components/website/blocks/](/components/website/blocks/).

### The obligation

MIT permits commercial use, modification and distribution, and asks one thing in return: that the
copyright notice and permission notice travel with the work. This file, together with the `source`
field carried on every archetype in both the code and the database row, is that notice.

```
MIT License

Copyright (c) the respective authors of the projects named above

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Adding an archetype

A new design is a row in `website_archetypes` — no deploy. If it is derived from a third-party
project, add it to the table above and set its `source` on the row. If the source is not
MIT-licensed or similarly permissive, check what the licence asks before the row goes in: some
require attribution on the rendered page rather than in a file like this one, which is a product
decision and not only a legal one.

---

## Fonts

Every typeface an archetype names is served by Google Fonts under the SIL Open Font License:
Inter, Montserrat, Josefin Sans, Assistant, Heebo, Rubik and Varela Round. The OFL permits
embedding and web serving without attribution in the product interface.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-13 | Created | MIT notices for the four website archetypes; OFL note for the typefaces |
