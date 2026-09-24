/**
 * Which client components reach server-only code?
 *
 * `lib/supabaseServer` builds a service-role client from
 * `SUPABASE_SERVICE_ROLE_KEY`, which is deliberately NOT exposed to the browser.
 * If a `'use client'` module imports it — at any depth, as a VALUE rather than a
 * type — webpack bundles it anyway and the page dies on hydration with
 * "supabaseKey is required".
 *
 * Walks every `'use client'` file's import graph and reports the first path that
 * reaches a server-only module.
 *
 *   node scripts/find-server-code-in-client.mjs
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SERVER_ONLY = ['lib/supabaseServer', 'lib/supabaseServerAuth'];

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') return [];
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
});

const files = ['app', 'components', 'lib'].flatMap(d => walk(path.join(ROOT, d)));
const rel = f => path.relative(ROOT, f);

const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** Value imports only — `import type` is erased and cannot reach the bundle. */
function valueImports(src) {
  const out = [];
  const re = /import\s+(?!type\s)([\s\S]*?)\s*from\s*['"](@\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    // `import { type X }` alone is still erased; keep it simple and skip those.
    if (/^\{\s*(type\s[^,}]+,?\s*)+\}$/.test(m[1].trim())) continue;
    out.push(m[2]);
  }
  return out;
}

const resolve = spec => {
  const base = path.join(ROOT, spec.replace(/^@\//, ''));
  for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
};

const isServerOnly = spec => SERVER_ONLY.some(s => spec.replace(/^@\//, '').startsWith(s));

const findings = [];

for (const file of files) {
  const src = read(file);
  if (!/^['"]use client['"]/m.test(src.slice(0, 400))) continue;

  const seen = new Set();
  const queue = [[file, [rel(file)]]];

  while (queue.length) {
    const [current, trail] = queue.shift();
    if (seen.has(current) || trail.length > 6) continue;
    seen.add(current);

    for (const spec of valueImports(read(current))) {
      if (isServerOnly(spec)) {
        findings.push([...trail, spec].join('\n     → '));
        queue.length = 0;
        break;
      }
      const next = resolve(spec);
      if (next && !seen.has(next)) queue.push([next, [...trail, rel(next)]]);
    }
  }
}

if (!findings.length) {
  console.log('No client component reaches server-only code.');
} else {
  console.log(`${findings.length} client entry point(s) reach server-only code:\n`);
  for (const f of findings) console.log('  ' + f + '\n');
}
