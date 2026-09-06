'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';

// ===========================
// Types
// ===========================

export interface ReplayRow {
  b: string;        // Bold text (e.g., '8:40pm — two new enquiries answered')
  s: string;        // Subtext (e.g., 'Both offered your open Thursday slots')
}

export interface ReplayModal {
  h: string;        // Header (e.g., 'Last night')
  s: string;        // Subtitle (e.g., 'Six things happened...')
  rows: ReplayRow[];
}

interface FooterReplayProps {
  label: string;    // Button label (e.g., 'Watch last night')
  modal: ReplayModal;
}

// ===========================
// Component (matching mockup .lv-foot + modal)
// ===========================

export function FooterReplay({ label, modal }: FooterReplayProps) {
  const { isRTL, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);

  return (
    <>
      {/* Footer: .lv-foot */}
      <div
        className="lv-foot"
        style={{
          marginTop: '16px',
          textAlign: 'center',
        }}
      >
        {/* Replay button: .lv-replay */}
        <button
          className="lv-replay"
          onClick={openModal}
          style={{
            border: '1.5px solid #E7E9F1',
            background: '#FFFFFF',
            borderRadius: '13px',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '9px',
            boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
            transition: '0.15s',
            cursor: 'pointer',
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            color: '#131A2B',
            direction: isRTL ? 'rtl' : 'ltr',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#D7DBE7';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#E7E9F1';
          }}
        >
          {/* Play icon */}
          <svg
            viewBox="0 0 24 24"
            style={{
              width: '16px',
              height: '16px',
              stroke: '#F97316',
              fill: 'none',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }}
          >
            <path d="M6 4l14 8-14 8z" />
          </svg>
          {label}
        </button>
      </div>

      {/* Modal scrim: .scrim */}
      {isOpen && (
        <div
          className="scrim open"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(19,26,43,0.5)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 50,
          }}
        >
          {/* Modal box: .mbox */}
          <div
            className="mbox"
            role="dialog"
            aria-modal="true"
            style={{
              direction: isRTL ? 'rtl' : 'ltr',
              background: '#FFFFFF',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '460px',
              maxHeight: '86vh',
              overflow: 'auto',
              boxShadow: '0 18px 50px -20px rgba(16,22,42,0.28)',
              padding: '24px',
            }}
          >
            {/* Header: .mb-h */}
            <div
              className="mb-h"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: '19px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: '#131A2B',
              }}
            >
              {modal.h}
            </div>

            {/* Subtitle: .mb-s */}
            <div
              className="mb-s"
              style={{
                fontSize: '13.5px',
                color: '#697187',
                margin: '4px 0 18px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {modal.s}
            </div>

            {/* Rows: .mb-row */}
            {modal.rows.map((row, index) => (
              <div
                key={index}
                className="mb-row"
                style={{
                  display: 'flex',
                  gap: '11px',
                  alignItems: 'flex-start',
                  padding: '11px 0',
                  borderBottom: index < modal.rows.length - 1 ? '1px solid #E7E9F1' : 'none',
                }}
              >
                {/* Check icon: .mb-ic */}
                <span
                  className="mb-ic"
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '8px',
                    background: '#E6F8F0',
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    style={{
                      width: '12px',
                      height: '12px',
                      stroke: '#1B9A6C',
                      fill: 'none',
                      strokeWidth: 3,
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                    }}
                  >
                    <path d="M4 12l6 6L20 5" />
                  </svg>
                </span>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 600,
                      display: 'block',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                      color: '#131A2B',
                    }}
                  >
                    {row.b}
                  </b>
                  <small
                    style={{
                      fontSize: '12.5px',
                      color: '#697187',
                      fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                    }}
                  >
                    {row.s}
                  </small>
                </div>
              </div>
            ))}

            {/* Close button: .mb-close */}
            <button
              className="mb-close"
              onClick={closeModal}
              style={{
                width: '100%',
                marginTop: '18px',
                border: '1.5px solid #E7E9F1',
                background: '#fff',
                borderRadius: '12px',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                color: '#131A2B',
              }}
            >
              {t('insight.modal.close') || 'Close'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
