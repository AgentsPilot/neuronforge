/**
 * @jest-environment jsdom
 *
 * A money list or export that hit a read cap says so (LX-1). It never cuts
 * silently: a short money report that looks complete is a wrong one.
 *
 * The notice and the cut test are rendered / called for real. The WIRING in
 * MoneyList and the CRM page is checked at source level, because both handlers
 * end in a Blob + `<a download>` that jsdom does not perform (the same reason
 * `exportMatchesTheScreen.guard` is a source guard).
 */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import { cleanup, render, screen } from '@testing-library/react';

import { MoneyCapNotice, exportWasCut } from '@/components/payments/MoneyCapNotice';
import { translations } from '@/lib/business-os/LanguageContext';

afterEach(cleanup);

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

describe('MoneyCapNotice', () => {
  it('renders the truncated message as a status line', () => {
    render(<MoneyCapNotice testId="money-truncated" text={translations.en['payments.truncated']} />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-testid', 'money-truncated');
    expect(notice).toHaveTextContent('totals are partial');
  });

  it('renders the export-cut message with its count', () => {
    const text = translations.en['payments.export.cut'].replace('{count}', '2000');
    render(<MoneyCapNotice testId="money-export-cut" text={text} />);
    expect(screen.getByTestId('money-export-cut')).toHaveTextContent('This file holds only 2000 records');
  });

  it.each(['en', 'he', 'es'] as const)('%s export-cut copy does not claim the rows are the most recent', lang => {
    /* A cut at EXPORT_CAP keeps the route's sort, which is not necessarily
       newest-first — so the copy must not borrow `payments.truncated`'s claim. */
    const copy = translations[lang] as Record<string, string>;
    expect(copy['payments.export.cut']).not.toMatch(/most recent|recientes|האחרונות/i);
    expect(copy['payments.export.cut']).not.toBe(copy['payments.truncated']);
  });
});

describe('exportWasCut', () => {
  it('is cut when a source read hit its cap', () => {
    expect(exportWasCut({ truncated: true, total: 5 }, 5)).toBe(true);
  });

  it('is cut when the filter matched more than came back', () => {
    expect(exportWasCut({ truncated: false, total: 2400 }, 2000)).toBe(true);
  });

  it('is whole when everything matched came back', () => {
    expect(exportWasCut({ truncated: false, total: 73 }, 73)).toBe(false);
    expect(exportWasCut({}, 10)).toBe(false);
  });
});

describe('MoneyList wires both notices', () => {
  const list = read('components/payments/MoneyList.tsx');
  const handler = list.slice(
    list.indexOf('const exportCsv = async ()'),
    list.indexOf('exportRef.current = exportCsv')
  );

  it("shows the route's truncated flag on the list", () => {
    expect(list).toMatch(/\{truncated && \(\s*<MoneyCapNotice/);
  });

  it('the export reads truncated/total from its own response and says when it is short', () => {
    expect(handler).toMatch(/isCut = exportWasCut\(result\.data, chosen\.length\)/);
    expect(handler).toMatch(/setExportCutAt\(isCut \? chosen\.length : null\)/);
    expect(list).toMatch(/exportCutAt !== null && \(\s*<MoneyCapNotice/);
  });

  it.each(['en', 'he', 'es'] as const)('%s has the export-cut copy with the count', lang => {
    expect((translations[lang] as Record<string, string>)['payments.export.cut']).toContain('{count}');
  });
});

describe('the CRM page exports through the safe builder', () => {
  const page = read('app/business-os/crm/page.tsx');

  it('uses buildContactsCsvFile and the counting button', () => {
    expect(page).toMatch(/buildContactsCsvFile\(headers, rows, PHONE_COLUMN\)/);
    expect(page).toMatch(/<ContactsExportButton count=\{contacts\.length\}/);
  });

  it('shows Export only on the views whose rows are `contacts`', () => {
    // Subscribers / Tasks would otherwise show "Export 20 shown" for rows not on screen.
    expect(page).toMatch(/const EXPORTABLE_VIEWS: readonly ViewMode\[\] = \['pipeline', 'contacts'\];/);
    expect(page).toMatch(/\{EXPORTABLE_VIEWS\.includes\(viewMode\) && \(\s*<ContactsExportButton/);
  });

  it('derives the phone column from the column list, not a literal index', () => {
    expect(page).toMatch(/const PHONE_COLUMN = EXPORT_COLUMNS\.indexOf\('phone'\);/);
    expect(page).toMatch(/EXPORT_COLUMNS\.map\(key => t\(`crm\.export\.\$\{key\}`\)\)/);
  });

  it('no longer hand-quotes cells', () => {
    expect(page).not.toMatch(/replace\(\/"\/g, '""'\)/);
  });
});
