/**
 * The statement guard (data export DE-10b.2; requirement §3.2, §3.3, §10.1;
 * workplan §4.1). The statements, the normaliser and the matcher, and the
 * parity of the mirrored purge rule.
 */

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({ businessProfileRepository: {} }));

import fs from 'fs';
import path from 'path';
import {
  DELETION_STATEMENTS,
  MAX_STATEMENT_LENGTH,
  STATEMENT_LANGUAGES,
  isStatementLanguage,
  matchStatement,
  normaliseAcknowledgement,
} from '../acknowledgement';
import { normaliseConfirmation } from '@/lib/business-os/purge/confirmation';

const NIQQUD_HE = 'הוֹרַדְתִּי אֶת הַנְּתוּנִים שֶׁלִּי וַאֲנִי רוֹצֶה לִמְחוֹק אֶת הַחֶשְׁבּוֹן שֶׁלִּי לִצְמִיתוּת';

describe('the statements', () => {
  it.each(STATEMENT_LANGUAGES)('%s has a non-empty statement', (language) => {
    expect(DELETION_STATEMENTS[language].trim().length).toBeGreaterThan(20);
  });

  it.each(STATEMENT_LANGUAGES)('%s holds no punctuation, no geresh and no gershayim', (language) => {
    const statement = DELETION_STATEMENTS[language];
    expect(statement).not.toMatch(/\p{P}/u);
    expect(statement).not.toMatch(/[׳״'"`]/);
  });

  it.each(STATEMENT_LANGUAGES)('%s matches itself, and only its own language', (language) => {
    expect(matchStatement(DELETION_STATEMENTS[language])).toBe(language);
  });

  it('the three statements are different', () => {
    const normalised = STATEMENT_LANGUAGES.map((language) => normaliseAcknowledgement(DELETION_STATEMENTS[language]));
    expect(new Set(normalised).size).toBe(STATEMENT_LANGUAGES.length);
  });

  it('the Hebrew statement is the requirement text, verbatim', () => {
    const requirement = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'docs', 'requirements', 'BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md'),
      'utf-8'
    );
    for (const language of STATEMENT_LANGUAGES) expect(requirement).toContain(`\`${DELETION_STATEMENTS[language]}\``);
  });
});

describe('matchStatement tolerates what §3.3 allows', () => {
  const en = DELETION_STATEMENTS.en;
  const he = DELETION_STATEMENTS.he;

  it('a different case', () => {
    expect(matchStatement(en.toUpperCase())).toBe('en');
  });

  it('doubled, tab and outer spaces', () => {
    expect(matchStatement(`   ${en.replace(/ /g, '  ').replace('my data', 'my\tdata')}  `)).toBe('en');
  });

  it.each([
    ['U+200F', '‏'],
    ['U+202B', '‫'],
    ['U+200B', '​'],
    ['U+2067', '⁧'],
    ['U+FEFF', '﻿'],
  ])('an inserted %s', (_name, mark) => {
    expect(matchStatement(`${mark}${he.slice(0, 5)}${mark}${he.slice(5)}${mark}`)).toBe('he');
    expect(matchStatement(`${en.slice(0, 3)}${mark}${en.slice(3)}`)).toBe('en');
  });

  it('NFD input', () => {
    expect(matchStatement(he.normalize('NFD'))).toBe('he');
    expect(matchStatement(DELETION_STATEMENTS.es.normalize('NFD'))).toBe('es');
  });

  it('niqqud added to the Hebrew', () => {
    expect(matchStatement(NIQQUD_HE)).toBe('he');
    expect(matchStatement(NIQQUD_HE.normalize('NFD'))).toBe('he');
  });

  it('the English statement matches whatever the UI language is (the matcher takes no UI language)', () => {
    expect(matchStatement(en)).toBe('en');
    expect(matchStatement.length).toBe(1);
  });
});

describe('matchStatement refuses', () => {
  it('a near miss (one word dropped)', () => {
    expect(matchStatement(DELETION_STATEMENTS.en.replace(' forever', ''))).toBeNull();
    expect(matchStatement(DELETION_STATEMENTS.he.replace(' לצמיתות', ''))).toBeNull();
  });

  it('a statement with a word added', () => {
    expect(matchStatement(`${DELETION_STATEMENTS.en} please`)).toBeNull();
  });

  it.each([undefined, null, 42, '', '   '])('a non-statement %p', (value) => {
    expect(matchStatement(value)).toBeNull();
  });

  it('text longer than the receipt column, even when it normalises to a statement', () => {
    const padded = `${DELETION_STATEMENTS.en}${' '.repeat(MAX_STATEMENT_LENGTH)}`;
    expect(padded.length).toBeGreaterThan(MAX_STATEMENT_LENGTH);
    expect(matchStatement(padded)).toBeNull();
  });
});

describe('the mirrored purge rule', () => {
  it.each(['  Acme   TEST\tco ', 'Hello World', '\n a  B \n', 'ÉCOLE  été', 'שלום  עולם'])(
    'normaliseAcknowledgement equals normaliseConfirmation on mark-free text: %p',
    (input) => {
      expect(normaliseAcknowledgement(input.normalize('NFC'))).toBe(normaliseConfirmation(input.normalize('NFC')));
    }
  );

  it('normaliseConfirmation itself is unchanged', () => {
    expect(normaliseConfirmation('  Acme   TEST\tco ')).toBe('acme test co');
  });

  it('the module has no server import (it ships in the client bundle)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'acknowledgement.ts'), 'utf-8');
    expect(source).not.toMatch(/^import /m);
  });

  it('isStatementLanguage', () => {
    expect(isStatementLanguage('he')).toBe(true);
    expect(isStatementLanguage('fr')).toBe(false);
    expect(isStatementLanguage(undefined)).toBe(false);
  });
});
