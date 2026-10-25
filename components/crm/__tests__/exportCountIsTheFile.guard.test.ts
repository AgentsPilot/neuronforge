/**
 * QA, LX-1: the count on the Export button is the number of rows in the file,
 * in both the list and the board view.
 *
 * Source-level, like `exportMatchesTheScreen.guard`: the handler ends in a Blob
 * and `<a download>` that jsdom does not perform. Pins that the button's count,
 * the file's rows and the rows each exportable view renders are one array.
 */

import fs from 'fs';
import path from 'path';

const page = fs
  .readFileSync(path.join(process.cwd(), 'app/business-os/crm/page.tsx'), 'utf8')
  .replace(/\r\n/g, '\n');

const handler = page.slice(page.indexOf('const handleExportCSV = () =>'), page.indexOf('buildContactsCsvFile(headers, rows'));

describe('the Export count is the file', () => {
  it('the handler refuses an empty export and builds one row per contact in `contacts`', () => {
    expect(handler).toMatch(/if \(contacts\.length === 0\) return;/);
    expect(handler).toMatch(/const rows = contacts\.map\(contact => \[/);
    // No filter/slice between the array and the file.
    expect(handler).not.toMatch(/contacts\.(filter|slice)\(/);
  });

  it('the button counts the same array', () => {
    expect(page).toMatch(/<ContactsExportButton count=\{contacts\.length\} onExport=\{handleExportCSV\}/);
  });

  it('the board renders `contacts` and the list renders the same array', () => {
    expect(page).toMatch(/<CRMPipelineView\s+contacts=\{contacts\}/);
    expect(page).toMatch(/const paginatedContacts = contacts;/);
    expect(page).toMatch(/contacts=\{paginatedContacts\}/);
  });

});
