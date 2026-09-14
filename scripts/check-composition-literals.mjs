/**
 * Fail loudly on a backtick inside a CSS template literal.
 *
 * Three separate times while building the composition layer a backtick in a
 * comment — quoting a filename or a class — closed the template string early.
 * The file then fails to compile, so the jest guard for this never runs: the
 * suite dies before the assertion does. This is a plain text check that can run
 * before anything else and says exactly which function is broken.
 */
import { readFileSync } from 'fs';

const FILE = 'components/public/compositions.ts';
const src = readFileSync(FILE, 'utf8');
const bad = [];

for (const m of src.matchAll(/function (\w+)\(s: string\): string \{\n {2}return `([\s\S]*?)\n {2}`;\n\}/g)) {
  if (m[2].includes('`')) bad.push(m[1]);
}

if (bad.length) {
  console.error(`${FILE}: stray backtick inside the CSS literal of: ${bad.join(', ')}`);
  console.error('A backtick there closes the template string and truncates the stylesheet.');
  process.exit(1);
}
console.log(`${FILE}: literals clean`);
