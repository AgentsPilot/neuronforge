/**
 * Writes a static page per template, using the REAL emitted stylesheet.
 *
 * Not a test of behaviour — a way to look at the thing. Everything about this
 * work has been verified by transcription audits and typechecks, and none of it
 * by eye, which is how a stylesheet can be complete and the page still wrong.
 *
 * Run: npx jest scripts/__preview__   →  /tmp/apc-preview/<template>.html
 */

import { writeFileSync, mkdirSync } from 'fs';
import { templateCss, compositionFor } from '@/components/public/compositions';
import { ARCHETYPES } from '@/lib/website-builder/archetypes';
import { hoverShade, isDarkColor, mix, onColor, withAlpha } from '@/lib/branding/color';

const OUT = '/tmp/apc-preview';
const SPACING: Record<string, number> = { compact: 0.85, normal: 1, spacious: 1.25 };

/** The same variables `PublicThemeStyle` emits, for a standalone page. */
function vars(theme: (typeof ARCHETYPES)[number]): string {
  const c = theme.colors;
  const r = parseFloat(theme.borderRadius) || 8;
  const step = 4 * (SPACING[theme.spacing] ?? 1);
  const s = theme.scale!;
  return `
    --ap-brand:${c.primary}; --ap-brand-hover:${hoverShade(c.primary)};
    --ap-brand-tint:${withAlpha(c.primary, 0.12)}; --ap-brand-ring:${withAlpha(c.primary, 0.35)};
    --ap-on-brand:${onColor(c.primary)}; --ap-accent:${c.accent};
    --ap-bg:${c.background}; --ap-surface:${c.surface};
    --ap-surface-2:${mix(c.surface, c.background, 50)};
    --ap-border:${mix(c.text, c.background, 14)};
    --ap-text:${c.text}; --ap-text-muted:${c.textSecondary};
    --ap-radius-sm:${r / 2}px; --ap-radius-md:${r}px; --ap-radius-lg:${r * 2}px;
    --ap-space-1:${step}px; --ap-space-2:${step * 2}px; --ap-space-3:${step * 3}px;
    --ap-space-4:${step * 4}px; --ap-space-6:${step * 6}px; --ap-space-8:${step * 8}px;
    --ap-font-heading:"${theme.fonts.heading}",system-ui,sans-serif;
    --ap-font-body:"${theme.fonts.body}",system-ui,sans-serif;
    --ap-scale-h1:${s.h1}; --ap-scale-h2:${s.h2}; --ap-scale-h3:${s.h3};
    --ap-scale-body:${s.body}; --ap-scale-small:${s.small};
    color-scheme:${isDarkColor(c.background) ? 'dark' : 'light'};
  `;
}

/** The same markup the shapes render, with the catalogue's own content. */
const SECTIONS = `
<header class="apc-bar"><div class="apc-nav">
  <a class="apc-wm">בית הספר הבינלאומי להורות</a>
  <nav class="apc-menu">
    ${['אודות', 'התוכניות', 'ההתמחות', 'יצירת קשר']
      .map((l, i) => `<a class="apc-menu-item"><i class="apc-menu-idx">0${i + 1}</i><span>${l}</span></a>`)
      .join('')}
  </nav>
  <a class="apc-btn apc-btn--solid">פגישת היכרות</a>
</div></header>

<section class="apc-sec apc-hero">
  <h1 data-apc="headline">הורות מאוזנת מתחילה בהבנה של הילד שלכם.</h1>
  <p class="apc-lede">בית ספר אונליין להורות, המלווה משפחות ישראליות בכל העולם — כלים מעשיים, תהליך מובנה ופידבק שוטף, עד לתוצאות.</p>
  <div class="apc-cta-row">
    <a class="apc-btn apc-btn--solid">קביעת פגישת היכרות</a>
    <a class="apc-btn">לצפייה בתוכניות</a>
  </div>
  <div class="apc-hero-card">
    <div class="apc-shot apc-hero-shot" style="background-image:linear-gradient(135deg,#c9c4bd,#8d8781)"></div>
    <div class="apc-chip apc-chip--one"><span class="apc-chip-k"><i class="apc-chip-dot"></i>משפחות</span><span class="apc-chip-v">1,200+</span></div>
    <div class="apc-chip apc-chip--two"><span class="apc-chip-k"><i class="apc-chip-dot"></i>שביעות רצון</span><span class="apc-chip-v">97%</span></div>
  </div>
</section>

<section class="apc-sec">
  <div class="apc-sec-head"><span class="apc-eyebrow">התוכניות</span><h2>ארבע דרכים להתחיל.</h2></div>
  <div class="apc-rows">
    ${[
      ['פגישת היכרות', 'פגישה על מנת להכיר את הילד, להבין את האתגר ולבנות יחד את הצעד הראשון.', 'ללא עלות', true],
      ['ייעוץ אישי', 'ייעוץ למתבגרים עם קשב וריכוז, בהתאמה אישית לקצב ולצרכים של המשפחה.', '₪300', false],
      ['התמחות בקשב וריכוז', 'קורס מקיף למדריכי הורים ואנשי טיפול — ידע מעמיק וכלים פרקטיים.', '₪1,000', false],
      ['הצעת מחיר מותאמת', 'ליווי ארוך טווח או תוכנית לארגון — נרכיב הצעה שמתאימה בדיוק לכם.', 'לפי בקשה', true],
    ]
      .map(
        ([name, desc, price, open], i) => `
      <div class="apc-row-item">
        <span class="apc-idx">0${i + 1}</span>
        <h3>${name}</h3>
        <p>${desc}</p>
        <div class="apc-row-end">
          <span class="apc-price${open ? ' apc-price--open' : ''}">${price}</span>
          <a class="apc-btn">קביעת פגישה</a>
        </div>
      </div>`
      )
      .join('')}
  </div>
</section>

<section class="apc-sec">
  <div class="apc-sec-head"><span class="apc-eyebrow">איך זה עובד</span><h2>לא עוד עצות. תהליך.</h2></div>
  <ol class="apc-steps">
    ${['מתחילים בפגישת היכרות, ללא עלות', 'מקבלים כלים פרקטיים ליום־יום', 'ממשיכים עם מעקב ופידבק שוטף']
      .map(
        (t, i) => `<li class="apc-step${i === 0 ? ' apc-step--lead' : ''}">
      <span class="apc-idx">0${i + 1}</span><div><h3>${t}</h3><p><b class="apc-tick"></b>ליווי צמוד לאורך כל הדרך.</p></div></li>`
      )
      .join('')}
  </ol>
</section>

<section class="apc-sec">
  <div class="apc-facts">
    ${[['1,200+', 'משפחות'], ['97%', 'שביעות רצון'], ['12', 'שנות ניסיון'], ['4', 'תוכניות']]
      .map(([n, l]) => `<div class="apc-stat"><span class="apc-stat-n">${n}</span><span class="apc-stat-l">${l}</span></div>`)
      .join('')}
  </div>
</section>

<section class="apc-sec apc-quote-band">
  <figure class="apc-quote">
    <blockquote>“לראשונה הרגשנו שיש לנו שפה משותפת עם הילד שלנו”</blockquote>
    <cite>מ׳ · אמא לשניים</cite>
  </figure>
</section>

<section class="apc-sec">
  <div class="apc-sec-head"><span class="apc-eyebrow">שאלות</span><h2>מה שכולם שואלים.</h2></div>
  <div class="apc-qa-list">
    ${['מהו פורמט הקורס?', 'האם יש דרישות קדם?', 'האם הקורס כולל הסמכה?']
      .map(
        (q, i) => `<div class="apc-qa"><button class="apc-qa-q"><span>${q}</span><i class="apc-qa-mark">${i === 0 ? '−' : '+'}</i></button>${
          i === 0 ? '<p class="apc-qa-a">הקורס מועבר בצורה מעשית ומקיפה, כולל הרצאות וסדנאות.</p>' : ''
        }</div>`
      )
      .join('')}
  </div>
</section>

<section class="apc-sec">
  <div class="apc-close">
    <h2>נתחיל בשיחה אחת.</h2>
    <p>פגישת היכרות ללא עלות, כדי להבין מה המשפחה שלכם צריכה.</p>
    <div class="apc-cta-row apc-cta-row--centred"><a class="apc-btn">קביעת פגישת היכרות</a></div>
  </div>
</section>

<footer class="apc-footer"><div class="apc-footer-row">
  <div class="apc-footer-who"><span class="apc-wm">בית הספר הבינלאומי להורות</span><span class="apc-footer-tag">הורות מאוזנת</span></div>
  <div class="apc-footer-contact"><a>hello@example.com</a><a>+972 50 000 0000</a></div>
  <span class="apc-footer-year">© 2026</span>
</div></footer>
`;

it('writes one page per template', () => {
  mkdirSync(OUT, { recursive: true });
  const written: string[] = [];

  ARCHETYPES.forEach(theme => {
    const composition = compositionFor(theme)!;
    const css = templateCss(theme.id, composition, 'body');
    const families = [...new Set([theme.fonts.heading, theme.fonts.body, 'IBM Plex Mono', 'Assistant', 'Heebo'])]
      .map(f => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;900`)
      .join('&');

    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${theme.id}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">
<style>
*,*::before,*::after{box-sizing:border-box}
body{margin:0;${vars(theme)}background:var(--ap-bg);color:var(--ap-text);
 font-family:var(--ap-font-body);font-size:var(--ap-scale-body);line-height:1.55;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:var(--ap-font-heading)}
a{text-decoration:none;color:inherit;cursor:pointer}
button{font-size:inherit}
${css}
</style></head><body>
<div style="position:sticky;top:0;z-index:9;background:var(--ap-surface);border-block-end:1px solid var(--ap-border);
 padding:8px 40px;font:600 12px/1.4 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--ap-text-muted)">
 ${theme.id} · ${composition} bones</div>
${SECTIONS}
</body></html>`;

    const file = `${OUT}/${theme.id}.html`;
    writeFileSync(file, html);
    written.push(file);
  });

  expect(written).toHaveLength(ARCHETYPES.length);
  // eslint-disable-next-line no-console
  console.log('\nOpen these:\n' + written.map(f => '  ' + f).join('\n'));
});
