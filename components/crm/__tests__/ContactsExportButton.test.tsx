/**
 * @jest-environment jsdom
 *
 * The Contacts Export button says how many rows it exports (LX-1). It exports
 * only the contacts loaded on screen, so a bare "Export" let an owner believe
 * they had the whole CRM.
 */

import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ContactsExportButton } from '@/components/crm/ContactsExportButton';
import { translations } from '@/lib/business-os/LanguageContext';

/** The real English dictionary with the same `{var}` substitution `t()` does. */
const t = (key: string, vars?: Record<string, string | number>) => {
  let text = (translations.en as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
};

afterEach(cleanup);

describe('ContactsExportButton', () => {
  it('names the count it will export', () => {
    render(<ContactsExportButton count={20} onExport={() => undefined} t={t} />);
    const button = screen.getByRole('button', { name: 'Export 20 shown' });
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Export 20 shown');
    expect(button).toHaveAttribute('title', expect.stringContaining('20 contacts shown on screen'));
  });

  it('is disabled with the plain label when nothing is on screen', () => {
    render(<ContactsExportButton count={0} onExport={() => undefined} t={t} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('runs the export on click', () => {
    const onExport = jest.fn();
    render(<ContactsExportButton count={3} onExport={onExport} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export 3 shown' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it.each(['he', 'es'] as const)('%s carries the count placeholder', lang => {
    const copy = translations[lang] as Record<string, string>;
    expect(copy['crm.export.button_shown']).toContain('{count}');
    expect(copy['crm.export.tooltip_shown']).toContain('{count}');
  });
});
