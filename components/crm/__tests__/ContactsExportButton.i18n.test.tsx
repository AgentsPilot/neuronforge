/**
 * @jest-environment jsdom
 *
 * QA, LX-1: the Export button's count in every language, and on a phone.
 *
 * The render suite checks English; this renders he (RTL) and es through the
 * real dictionaries, and checks the accessible name carries the count even
 * though the visible text is hidden below `sm`.
 */

import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';

import { ContactsExportButton } from '@/components/crm/ContactsExportButton';
import { translations } from '@/lib/business-os/LanguageContext';

const tFor = (lang: 'en' | 'he' | 'es') => (key: string, vars?: Record<string, string | number>) => {
  let text = (translations[lang] as Record<string, string>)[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return text;
};

afterEach(cleanup);

describe.each(['en', 'he', 'es'] as const)('%s', lang => {
  const t = tFor(lang);
  const copy = translations[lang] as Record<string, string>;

  it('names the count in the accessible name, the visible text and the tooltip', () => {
    render(
      <div dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <ContactsExportButton count={47} onExport={() => undefined} t={t} />
      </div>
    );
    const expected = copy['crm.export.button_shown'].replace('{count}', '47');
    const button = screen.getByRole('button', { name: expected });

    expect(button).toHaveAttribute('aria-label', expected);
    expect(button).toHaveTextContent(expected);
    expect(button.getAttribute('title')).toContain('47');
    // No placeholder left unreplaced.
    expect(button.getAttribute('aria-label')).not.toMatch(/\{|\}/);
    expect(button.getAttribute('title')).not.toMatch(/\{|\}/);
  });

  it('is disabled at 0, with the plain label and tooltip (no "0 shown")', () => {
    render(<ContactsExportButton count={0} onExport={() => undefined} t={t} />);
    const button = screen.getByRole('button', { name: copy['crm.export.button'] });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', copy['crm.export.tooltip']);
  });

  it('the icon is hidden from assistive tech', () => {
    const { container } = render(<ContactsExportButton count={2} onExport={() => undefined} t={t} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
