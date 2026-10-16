'use client';

import React, { useCallback, useState } from 'react';

import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { MarketingConsentPanel } from '@/components/business-os/settings/MarketingConsentPanel';
import type { MarketingDrawerReads } from '@/components/business-os/settings/marketingDrawerReads';
import { useLanguage } from '@/lib/business-os/LanguageContext';

/**
 * Marketing permission, in the settings drawer (settings drawer review S-3, C-5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE DRAFT LIVES
 *
 * In `MarketingConsentPanel`, a child of the sheet's content. Radix unmounts
 * that content when the drawer closes, so closing throws the draft away and
 * reopening loads the stored settings again. That is why closing a dirty
 * drawer asks first ("Discard your changes?"): the row used to collapse and
 * drop the edits without a word (F-3).
 *
 * Only `isDirty` and `isSaving` sit up here, because the drawer needs them to
 * ask before closing (C-5) and to refuse to close mid-save (C-4). Both are
 * reset on every close that gets through, so a reopened drawer does not start
 * "dirty" from the draft that was just discarded, before the new panel has
 * reported in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface MarketingConsentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row that opened it; focus goes back there on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Reads the page started early (C-5), handed to the panel, which takes them
   * once when it mounts. Optional: without it the panel reads on open.
   */
  takePrefetched?: () => MarketingDrawerReads | null;
}

export function MarketingConsentDrawer({
  open,
  onOpenChange,
  returnFocusRef,
  takePrefetched,
}: MarketingConsentDrawerProps) {
  const { t, isRTL } = useLanguage();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Reached only once the drawer's guard has let the close through.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setIsDirty(false);
        setIsSaving(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={handleOpenChange}
      title={t('consent.title')}
      isBusy={isSaving}
      isDirty={isDirty}
      discardCopy={{
        title: t('settings.drawer.discard_title'),
        description: t('settings.drawer.discard_desc'),
        keep: t('settings.drawer.keep_editing'),
        discard: t('settings.drawer.discard'),
      }}
      isRTL={isRTL}
      closeLabel={t('common.close')}
      returnFocusRef={returnFocusRef}
      testId="settings-consent-drawer"
    >
      <MarketingConsentPanel
        onDirtyChange={setIsDirty}
        onBusyChange={setIsSaving}
        takePrefetched={takePrefetched}
      />
    </SettingsDrawer>
  );
}
