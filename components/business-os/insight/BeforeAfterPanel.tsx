'use client';

import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

interface BeforeAfterPanelProps {
  expanded: boolean;
  doNothingPoints: string[];
  handlePoints: string[];
}

// ===========================
// Component
// ===========================

export function BeforeAfterPanel({
  expanded,
  doNothingPoints,
  handlePoints,
}: BeforeAfterPanelProps) {
  const { t, isRTL } = useLanguage();

  if (!expanded) return null;

  return (
    <div
      className="mx-5 mb-4 grid grid-cols-2 gap-4 p-4 rounded-xl"
      style={{
        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(34, 197, 94, 0.04) 100%)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        direction: isRTL ? 'rtl' : 'ltr',
      }}
    >
      {/* Do Nothing Column */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: '#EF4444' }}
          />
          <span className="text-sm font-semibold text-gray-700">
            {t('myday.insight.do_nothing')}
          </span>
        </div>
        <ul className="space-y-2">
          {doNothingPoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-red-400 mt-0.5">•</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Let Me Handle It Column */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: '#22C55E' }}
          />
          <span className="text-sm font-semibold text-gray-700">
            {t('myday.insight.let_me_handle')}
          </span>
        </div>
        <ul className="space-y-2">
          {handlePoints.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="text-green-500 mt-0.5">•</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
