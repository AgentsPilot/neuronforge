/**
 * @jest-environment jsdom
 *
 * QA P-7a.3 (SA focus 1, PF-14 / C-10): the self-delete `plan_running`
 * blocker in en / he / es points at Settings → Plan, carries no support
 * mailto of its own, and Hebrew reads right to left. A `contact_support`
 * blocker beside it still carries the mailto, so the address is not lost.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/lib/client/auth-actions', () => ({ signOutUser: jest.fn() }));
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

import { DeleteAccountDrawer, type CopyFn } from '../DeleteAccountDrawer';
import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';
import type { EnabledDeletionCheck } from '@/hooks/useAccountDeletionCheck';

const DICTS = { en, he, es } as unknown as Record<'en' | 'he' | 'es', Record<string, string>>;
const copy =
  (d: Record<string, string>): CopyFn =>
  (key, vars) => {
    let text = d[key] ?? key;
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split(`{${name}}`).join(String(value));
    return text;
  };

const CHECK: EnabledDeletionCheck = {
  enabled: true,
  available: true,
  blockers: [{ code: 'plan_running' }],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
};

describe.each(['en', 'he', 'es'] as const)('%s', (lang) => {
  it('plan_running: the dictionary line, no mailto, direction follows the language', () => {
    render(<DeleteAccountDrawer check={CHECK} tr={copy(DICTS[lang])} language={lang} isRTL={lang === 'he'} navigate={jest.fn()} />);
    const list = screen.getByTestId('delete-account-blockers');
    expect(list).toHaveTextContent(DICTS[lang]['settings.account_delete.blocker.plan_running']);
    expect(list.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(list.textContent).not.toMatch(/\{support\}|settings\.account_delete/);
    expect(screen.getByTestId('delete-account-drawer')).toHaveAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    // No statement box and no delete button while blocked.
    expect(screen.queryByRole('button', { name: DICTS[lang]['settings.account_delete.delete_button'] })).toBeNull();
  });

  it('beside contact_support: only that line carries the mailto', () => {
    render(
      <DeleteAccountDrawer
        check={{ ...CHECK, blockers: [{ code: 'plan_running' }, { code: 'contact_support' }] }}
        tr={copy(DICTS[lang])}
        language={lang}
        isRTL={lang === 'he'}
        navigate={jest.fn()}
      />
    );
    expect(screen.getByTestId('delete-account-blockers').querySelectorAll('a[href^="mailto:"]')).toHaveLength(1);
  });
});
