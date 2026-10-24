/**
 * "Your account has been deleted" (data export DE-10b.2, workplan §2.6; SA
 * workplan review O2-6).
 *
 * Where a customer lands after deleting their own account. Public: it reads
 * no session and no data (the account no longer exists, and the browser has
 * just been signed out), so it is also on the middleware's skip list and the
 * platform chrome's public list (both are needed, see `PlatformChrome.tsx`).
 *
 * The language comes from `?lang=`, validated against en / he / es (default
 * en) and never echoed raw.
 *
 * @module app/account-deleted
 */

import type { Metadata } from 'next';
import { ACCOUNT_DELETED_COPY, accountDeletedLanguage } from '@/app/account-deleted/accountDeletedCopy';
import { marketingUrl } from '@/lib/utils/origins';

export const metadata: Metadata = {
  title: 'Account deleted',
  robots: { index: false, follow: false },
};

export default function AccountDeletedPage({ searchParams }: { searchParams?: { lang?: string | string[] } }) {
  const language = accountDeletedLanguage(searchParams?.lang);
  const copy = ACCOUNT_DELETED_COPY[language];
  const dir = language === 'he' ? 'rtl' : 'ltr';

  return (
    <main dir={dir} lang={language} className="min-h-screen flex items-center justify-center p-6 bg-[var(--v2-bg)]">
      <div
        className="max-w-md w-full p-6 border border-[var(--v2-border)] bg-[var(--v2-surface)] space-y-4 text-start"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <h1 className="text-xl font-semibold text-[var(--v2-text-primary)]">{copy.title}</h1>
        <p className="text-sm text-[var(--v2-text-secondary)]">{copy.body}</p>
        <a
          href={marketingUrl('/')}
          className="inline-flex items-center px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {copy.home}
        </a>
      </div>
    </main>
  );
}
