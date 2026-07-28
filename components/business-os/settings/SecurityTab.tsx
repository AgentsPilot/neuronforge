'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import {
  Download,
  Trash2,
  CheckCircle,
  AlertCircle,
  Lock,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

export function SecurityTab() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handlePasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setErrorMessage(t('settings.security.password_required'));
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setErrorMessage(t('settings.security.password_mismatch'));
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setErrorMessage(t('settings.security.password_short'));
      return;
    }

    try {
      setChangingPassword(true);
      setSuccessMessage('');
      setErrorMessage('');

      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setSuccessMessage(t('settings.security.password_updated'));
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error changing password:', error);
      setErrorMessage(t('settings.security.password_error'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleExportData = async () => {
    if (!user) return;

    try {
      setExporting(true);
      setSuccessMessage('');
      setErrorMessage('');

      const [profileRes, preferencesRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id),
      ]);

      const userData = {
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
        },
        profile: profileRes.data?.[0] || null,
        preferences: preferencesRes.data?.[0] || null,
        connections: connectionsRes.data || [],
      };

      const dataStr = JSON.stringify(userData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `user-data-${user.id}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSuccessMessage(t('settings.security.export_success'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Error exporting data:', error);
      setErrorMessage(t('settings.security.export_error'));
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    const firstConfirm = confirm(
      t('settings.security.delete_warning') +
        '\n\nAre you sure you want to proceed?'
    );

    if (firstConfirm) {
      const typedConfirmation = prompt('Type "DELETE_MY_ACCOUNT" to confirm:');

      if (typedConfirmation === 'DELETE_MY_ACCOUNT') {
        try {
          setErrorMessage('Processing account deletion...');

          const response = await fetch('/api/user/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmation: 'DELETE_MY_ACCOUNT' }),
          });

          const result = await response.json();

          if (response.ok && result.success) {
            setSuccessMessage('Account deleted successfully. You will be signed out shortly.');

            setTimeout(async () => {
              await supabase.auth.signOut();
              window.location.href = '/';
            }, 3000);
          } else {
            setErrorMessage(result.message || 'Failed to delete account. Please contact support.');
          }
        } catch (error) {
          console.error('Error deleting account:', error);
          setErrorMessage('Failed to delete account. Please try again or contact support.');
        }
      } else if (typedConfirmation !== null) {
        setErrorMessage('Incorrect confirmation. Account deletion cancelled.');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Password & Authentication */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
          {t('settings.security.title')}
        </h3>

        <div
          className="p-4 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <h4 className="font-semibold text-sm text-[var(--v2-text-primary)] mb-4">
            {t('settings.security.change_password')}
          </h4>

          <div className="space-y-3">
            {/* Current Password */}
            <div>
              <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                {t('settings.security.current_password')}
              </label>
              <div className="relative">
                <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                  }
                  className={`w-full ${isRTL ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                  placeholder={t('settings.security.current_password_placeholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.security.new_password')}
                </label>
                <div className="relative">
                  <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={passwordForm.newPassword}
                    onChange={(e) =>
                      setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                    }
                    className={`w-full ${isRTL ? 'pr-10 pl-10' : 'pl-10 pr-10'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder={t('settings.security.new_password_placeholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]`}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-primary)] mb-1">
                  {t('settings.security.confirm_password')}
                </label>
                <div className="relative">
                  <Lock className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) =>
                      setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                    }
                    className={`w-full ${isRTL ? 'pr-10 pl-3' : 'pl-10 pr-3'} py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                    placeholder={t('settings.security.confirm_password_placeholder')}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handlePasswordChange}
                disabled={changingPassword}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {changingPassword ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Lock className="w-4 h-4" />
                )}
                {t('settings.security.update_password')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
          {t('settings.security.account_title')}
        </h3>

        {/* Export Data */}
        <div
          className={`flex items-center justify-between p-4 bg-[var(--v2-bg)] border border-gray-200 dark:border-gray-700 ${isRTL ? 'flex-row-reverse' : ''}`}
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div>
            <h4 className="font-semibold text-sm text-[var(--v2-text-primary)]">
              {t('settings.security.export_data')}
            </h4>
            <p className="text-xs text-[var(--v2-text-secondary)]">
              {t('settings.security.export_data_desc')}
            </p>
          </div>
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-[var(--v2-shadow-button)] disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {t('settings.security.export_button')}
          </button>
        </div>

        {/* Danger Zone */}
        <div
          className="border-2 border-red-500/30 p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div className={`flex items-start justify-between gap-4 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm text-red-600 dark:text-red-400 mb-1">
                {t('settings.security.delete_account')}
              </h4>
              <p className="text-xs text-[var(--v2-text-secondary)] mb-2">
                {t('settings.security.delete_account_desc')}
              </p>
              <div
                className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {t('settings.security.delete_warning')}
                </p>
              </div>
            </div>
            <button
              onClick={handleDeleteAccount}
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-600 to-red-700 text-white hover:scale-105 transition-transform duration-200 text-sm font-semibold shadow-md"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Trash2 className="w-4 h-4" />
              {t('settings.security.delete_button')}
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <div
          className="p-3 border flex items-center gap-2"
          style={{
            backgroundColor: 'var(--v2-success-bg)',
            borderColor: 'var(--v2-success-border)',
            borderRadius: 'var(--v2-radius-card)',
          }}
        >
          <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-success-icon)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--v2-success-text)' }}>
            {successMessage}
          </p>
        </div>
      )}

      {errorMessage && (
        <div
          className="p-3 border flex items-center gap-2"
          style={{
            backgroundColor: 'var(--v2-error-bg)',
            borderColor: 'var(--v2-error-border)',
            borderRadius: 'var(--v2-radius-card)',
          }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-error-icon)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--v2-error-text)' }}>
            {errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}
