/**
 * Reading hand-pasted SQL files in Jest (AI model price review slice 5, SA
 * SC-4: "a small shared helper module over copy-pasting `statementsOf` and
 * `bodyOf`").
 *
 * The slice 3 migration test keeps its own copies on purpose: it must stay
 * byte-for-byte unedited (SC-4). New SQL-text tests import from here.
 *
 * Lives outside `__tests__` so Jest does not collect it as a suite.
 */

import { readFileSync } from 'fs';

/** A file's text with Windows line endings normalised, so a Windows checkout reads like CI. */
export function readSql(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** Whitespace collapsed to single spaces and trimmed. */
export function flatOf(sql: string): string {
  return sql.replace(/[ \t\n\r]+/g, ' ').trim();
}

/** Statements of a file, split on semicolons outside dollar-quoted bodies, each flattened. */
export function statementsOf(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const tag = /^[$][a-z_]*[$]/.exec(sql.slice(index));
    if (tag) {
      if (dollarTag === null) dollarTag = tag[0];
      else if (dollarTag === tag[0]) dollarTag = null;
      current += tag[0];
      index += tag[0].length - 1;
      continue;
    }
    const character = sql[index];
    if (character === ';' && dollarTag === null) {
      statements.push(flatOf(current));
      current = '';
    } else {
      current += character;
    }
  }
  if (flatOf(current)) statements.push(flatOf(current));
  return statements.filter(Boolean);
}

/** The text between the two `$tag$` markers, the opening marker included. */
export function bodyOf(sql: string, tag: string): string {
  const start = sql.indexOf(`$${tag}$`);
  const end = sql.indexOf(`$${tag}$`, start + 1);
  if (start < 0 || end < 0) throw new Error(`no body ${tag}`);
  return sql.slice(start, end);
}

/** Every single-quoted literal's content. */
export function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}
