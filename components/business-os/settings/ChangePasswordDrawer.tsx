'use client';

import React, { useState } from 'react';
import { signOutUser } from '@/lib/client/auth-actions';
import { marketingLoginUrl } from '@/lib/utils/marketingUrl';
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { changePassword } from '@/lib/client/change-password';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ChangePasswordDrawer' });

/**
 * Change password, in the settings drawer (settings drawer review S-2, C-7).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE TYPED PASSWORDS LIVE
 *
 * Only in `ChangePasswordForm`, which is a child of the sheet's content. Radix
 * unmounts that content when the drawer closes, so closing throws every typed
 * value away: passwords must not linger in memory or on screen after the owner
 * has walked away from the form. They used to be page state, and survived a
 * collapse of the row.
 *
 * `isChanging` alone sits up here, because the drawer has to know about it to
 * refuse to close (C-4). It is never true when the form unmounts: a busy drawer
 * cannot close.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS NEVER DONE
 *
 * No field value goes into a log call, an error message, the address or
 * storage. The change goes through `changePassword` (the API route checks the
 * current password and audits the attempt), never `supabase.auth.updateUser`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface ChangePasswordDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row that opened it; focus goes back there on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

export function ChangePasswordDrawer({ open, onOpenChange, returnFocusRef }: ChangePasswordDrawerProps) {
  const { t, isRTL } = useLanguage();
  const [isChanging, setIsChanging] = useState(false);

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.security.change_password')}
      isBusy={isChanging}
      isRTL={isRTL}
      closeLabel={t('common.close')}
      returnFocusRef={returnFocusRef}
      testId="settings-password-drawer"
    >
      <ChangePasswordForm isChanging={isChanging} onChangingChange={setIsChanging} />
    </SettingsDrawer>
  );
}

interface ChangePasswordFormProps {
  isChanging: boolean;
  onChangingChange: (changing: boolean) => void;
}

const EMPTY_FORM = { current: '', new: '', confirm: '' };

const INPUT_CLASS =
  'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]';

function ChangePasswordForm({ isChanging, onChangingChange }: ChangePasswordFormProps) {
  const { t } = useLanguage();
  const [passwordForm, setPasswordForm] = useState(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  // The drawer's own messages: the page banner sits behind the open drawer.
  const [errorMessage, setErrorMessage] = useState('');
  /*
   * Changed, and on the way out.
   *
   * It used to clear the three fields and show a green line above them, so the
   * drawer presented an empty form again — which reads as "nothing happened",
   * and invites a second attempt at something already done. A password change
   * is not an edit you repeat; it ENDS something. So the form is replaced by
   * what happens next rather than reset for another go.
   */
  const [done, setDone] = useState(false);

  // The page's handler, moved as is: same checks, same order, same route, same
  // words. What changed is only where the result is shown.
  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isChanging) return;

    setErrorMessage('');

    if (!passwordForm.current || !passwordForm.new) {
      setErrorMessage(t('settings.security.password_required'));
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      setErrorMessage(t('settings.security.password_mismatch'));
      return;
    }
    if (passwordForm.new.length < 8) {
      setErrorMessage(t('settings.security.password_short'));
      return;
    }

    try {
      onChangingChange(true);

      /*
       * Through the API, never `supabase.auth.updateUser` from here.
       * `updateUser` does not take the current password and does not check
       * one, so the field above was decoration: any characters in it changed
       * the password. The route verifies it and audits the attempt.
       */
      const result = await changePassword(passwordForm.current, passwordForm.new);

      if (!result.success) {
        // The server's message is already written for the person reading it,
        // and says something the generic key cannot: which credential was
        // wrong, or that this account has no password at all. The fields stay,
        // so a mistyped current password can be corrected in place.
        setErrorMessage(result.error ?? t('settings.security.password_error'));
        return;
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A NEW PASSWORD ENDS EVERY SESSION, INCLUDING THIS ONE.
       *
       * Supabase leaves existing sessions alive after `updateUser`, so before
       * this the old password's sessions kept working — on every device — and
       * the person who just changed theirs, possibly because it was exposed,
       * was told it was "updated" while the thing they were worried about
       * carried on. `scope: 'global'` is the point of the change, not a
       * courtesy.
       *
       * The fields are dropped from memory first: nothing below needs them,
       * and a sign-out can take a few seconds.
       * ───────────────────────────────────────────────────────────────────────
       */
      setPasswordForm(EMPTY_FORM);
      setShowPassword(false);
      setDone(true);

      await signOutUser({ scope: 'global', method: 'password-change' });
      window.location.href = marketingLoginUrl();
      return;
    } catch (error) {
      // `{ err }` only: never the form, never a field.
      logger.error({ err: error }, 'Failed to change the password');
      setErrorMessage(t('settings.security.password_error'));
    } finally {
      onChangingChange(false);
    }
  };

  /*
   * The form is GONE once the password has changed.
   *
   * Leaving it on screen — even cleared — says the job is still open. This
   * says what happened and what is about to happen, and the drawer closes
   * itself by navigating: there is nothing left to do here, and the session
   * that could do it is already being ended.
   */
  if (done) {
    return (
      <div
        role="status"
        className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-start gap-3"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            {t('settings.security.password_updated')}
          </p>
          <p className="text-sm text-green-700 dark:text-green-400 mt-1">
            {t('settings.security.password_signing_out')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handlePasswordChange} noValidate className="space-y-3">
      {errorMessage && (
        <div
          role="alert"
          className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
        </div>
      )}
      <input
        type={showPassword ? 'text' : 'password'}
        value={passwordForm.current}
        onChange={(e) => setPasswordForm((p) => ({ ...p, current: e.target.value }))}
        placeholder={t('settings.security.current_password')}
        aria-label={t('settings.security.current_password')}
        autoComplete="current-password"
        className={INPUT_CLASS}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />
      <input
        type={showPassword ? 'text' : 'password'}
        value={passwordForm.new}
        onChange={(e) => setPasswordForm((p) => ({ ...p, new: e.target.value }))}
        placeholder={t('settings.security.new_password')}
        aria-label={t('settings.security.new_password')}
        autoComplete="new-password"
        className={INPUT_CLASS}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />
      {/* Always masked, as before: it is the one you type blind to prove the other. */}
      <input
        type="password"
        value={passwordForm.confirm}
        onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
        placeholder={t('settings.security.confirm_password')}
        aria-label={t('settings.security.confirm_password')}
        autoComplete="new-password"
        className={INPUT_CLASS}
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowPassword((shown) => !shown)}
          className="text-xs text-[var(--v2-text-secondary)] flex items-center gap-1"
        >
          {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showPassword ? t('common.hide') : t('common.show')}
        </button>
        <button
          type="submit"
          disabled={isChanging}
          aria-busy={isChanging || undefined}
          className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          {isChanging ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span className="sr-only">{t('settings.security.update_password')}</span>
            </>
          ) : (
            t('settings.security.update_password')
          )}
        </button>
      </div>
    </form>
  );
}
