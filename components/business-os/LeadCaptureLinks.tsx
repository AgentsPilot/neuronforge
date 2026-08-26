'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Copy, Check, QrCode, Link2, Calendar, FileText, CreditCard, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface LeadCaptureLink {
  type: 'booking' | 'contact' | 'payment';
  url: string;
  label: string;
  description: string;
  icon: typeof Calendar;
}

interface LeadCaptureLinksProps {
  userCode: string | null;
  hasScheduling: boolean;
  hasPaidServices: boolean;
  onCreateSmartLink?: () => void;
}

export function LeadCaptureLinks({
  userCode,
  hasScheduling,
  hasPaidServices,
  onCreateSmartLink
}: LeadCaptureLinksProps) {
  const { t, isRTL } = useLanguage();
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(!userCode);

  // Get the base URL for links
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || 'https://app.agentspilot.com';

  // Build the available links based on capabilities
  const links: LeadCaptureLink[] = [];

  if (userCode) {
    if (hasScheduling) {
      links.push({
        type: 'booking',
        url: `${baseUrl}/c/${userCode}/book`,
        label: t('lead_capture.booking_link') || 'Booking Link',
        description: t('lead_capture.booking_desc') || 'Share this link for clients to book appointments',
        icon: Calendar
      });
    }

    links.push({
      type: 'contact',
      url: `${baseUrl}/c/${userCode}/contact`,
      label: t('lead_capture.contact_link') || 'Contact Form',
      description: t('lead_capture.contact_desc') || 'Share this link to capture leads',
      icon: FileText
    });

    if (hasPaidServices) {
      links.push({
        type: 'payment',
        url: `${baseUrl}/c/${userCode}/pay`,
        label: t('lead_capture.payment_link') || 'Payment Link',
        description: t('lead_capture.payment_desc') || 'Share this link for clients to pay',
        icon: CreditCard
      });
    }
  }

  const handleCopy = async (url: string, type: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(type);
      setTimeout(() => setCopiedLink(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleQR = (type: string) => {
    setShowQR(showQR === type ? null : type);
  };

  // Don't render if no userCode and not loading
  if (!userCode && !isLoading) {
    return null;
  }

  // Don't render if no links available (no scheduling capability)
  if (links.length === 0 && !isLoading) {
    return null;
  }

  return (
    <div
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)]"
      style={{
        borderRadius: '20px',
        boxShadow: '0 16px 44px -34px rgba(20, 26, 43, 0.4)',
        overflow: 'hidden'
      }}
    >
      {/* Header - Collapsible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between hover:bg-[var(--v2-bg)] transition-colors"
        style={{ padding: '16px 20px' }}
      >
        <div className="flex items-center" style={{ gap: '12px' }}>
          <div
            className="flex items-center justify-center flex-none"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(79, 110, 247, 0.12)'
            }}
          >
            <Link2 style={{ width: '18px', height: '18px', color: '#4F6EF7' }} strokeWidth={2} />
          </div>
          <div className={`text-${isRTL ? 'right' : 'left'}`}>
            <b
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '15px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--v2-text-primary)',
                display: 'block'
              }}
            >
              {t('lead_capture.title') || 'Your Lead Capture Links'}
            </b>
            <small style={{ fontSize: '11.5px', color: 'var(--v2-text-muted)' }}>
              {t('lead_capture.subtitle') || 'Share these links to capture leads from anywhere'}
            </small>
          </div>
        </div>
        <div className="flex items-center" style={{ gap: '8px' }}>
          <span
            className="font-bold"
            style={{
              fontSize: '10px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '3px 8px',
              borderRadius: '6px',
              color: '#128a5e',
              background: 'rgba(34, 197, 139, 0.13)'
            }}
          >
            {links.length} {t('lead_capture.links_ready') || 'links ready'}
          </span>
          {isExpanded ? (
            <ChevronUp style={{ width: '18px', height: '18px', color: 'var(--v2-text-muted)' }} />
          ) : (
            <ChevronDown style={{ width: '18px', height: '18px', color: 'var(--v2-text-muted)' }} />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div style={{ padding: '0 20px 20px 20px' }}>
          {/* Links List */}
          <div className="flex flex-col" style={{ gap: '12px' }}>
            {links.map((link) => {
              const Icon = link.icon;
              const isCopied = copiedLink === link.type;
              const isQROpen = showQR === link.type;

              return (
                <div
                  key={link.type}
                  className="bg-[var(--v2-bg)] border border-[var(--v2-border)]"
                  style={{
                    borderRadius: '12px',
                    padding: '14px 16px',
                    transition: 'all 0.2s'
                  }}
                >
                  <div className="flex items-start justify-between" style={{ gap: '12px' }}>
                    <div className="flex items-start" style={{ gap: '12px', flex: 1, minWidth: 0 }}>
                      <div
                        className="flex items-center justify-center flex-none"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: link.type === 'booking'
                            ? 'rgba(139, 92, 246, 0.12)'
                            : link.type === 'payment'
                            ? 'rgba(34, 197, 139, 0.12)'
                            : 'rgba(79, 110, 247, 0.12)'
                        }}
                      >
                        <Icon
                          style={{
                            width: '16px',
                            height: '16px',
                            color: link.type === 'booking'
                              ? '#8B5CF6'
                              : link.type === 'payment'
                              ? '#22C58B'
                              : '#4F6EF7'
                          }}
                          strokeWidth={2}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <b
                          style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--v2-text-primary)',
                            display: 'block',
                            marginBottom: '2px'
                          }}
                        >
                          {link.label}
                        </b>
                        <span
                          className="block truncate"
                          style={{
                            fontSize: '12px',
                            color: 'var(--v2-text-muted)',
                            fontFamily: 'monospace'
                          }}
                        >
                          {link.url.replace('https://', '').replace('http://', '')}
                        </span>
                        <small
                          style={{
                            fontSize: '11px',
                            color: 'var(--v2-text-muted)',
                            display: 'block',
                            marginTop: '4px'
                          }}
                        >
                          {link.description}
                        </small>
                      </div>
                    </div>
                    <div className="flex items-center flex-none" style={{ gap: '6px' }}>
                      {/* Copy Button */}
                      <button
                        onClick={() => handleCopy(link.url, link.type)}
                        className="flex items-center justify-center hover:bg-[var(--v2-surface)] transition-colors"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid var(--v2-border)'
                        }}
                        title={t('lead_capture.copy') || 'Copy link'}
                      >
                        {isCopied ? (
                          <Check style={{ width: '14px', height: '14px', color: '#22C58B' }} strokeWidth={2.5} />
                        ) : (
                          <Copy style={{ width: '14px', height: '14px', color: 'var(--v2-text-muted)' }} strokeWidth={2} />
                        )}
                      </button>
                      {/* QR Button */}
                      <button
                        onClick={() => toggleQR(link.type)}
                        className={`flex items-center justify-center transition-colors ${isQROpen ? 'bg-[var(--v2-primary)]' : 'hover:bg-[var(--v2-surface)]'}`}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid var(--v2-border)'
                        }}
                        title={t('lead_capture.qr') || 'Show QR code'}
                      >
                        <QrCode
                          style={{
                            width: '14px',
                            height: '14px',
                            color: isQROpen ? 'white' : 'var(--v2-text-muted)'
                          }}
                          strokeWidth={2}
                        />
                      </button>
                      {/* Open Link */}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center hover:bg-[var(--v2-surface)] transition-colors"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid var(--v2-border)'
                        }}
                        title={t('lead_capture.open') || 'Open link'}
                      >
                        <ExternalLink style={{ width: '14px', height: '14px', color: 'var(--v2-text-muted)' }} strokeWidth={2} />
                      </a>
                    </div>
                  </div>

                  {/* QR Code (Expandable) */}
                  {isQROpen && (
                    <div
                      className="flex justify-center bg-white"
                      style={{
                        marginTop: '12px',
                        padding: '16px',
                        borderRadius: '8px'
                      }}
                    >
                      <QRCodeSVG
                        value={link.url}
                        size={140}
                        level="M"
                        includeMargin={false}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer: Create Custom Link */}
          {onCreateSmartLink && (
            <button
              onClick={onCreateSmartLink}
              className="w-full flex items-center justify-center hover:bg-[var(--v2-bg)] transition-colors"
              style={{
                marginTop: '12px',
                padding: '10px',
                borderRadius: '8px',
                border: '1px dashed var(--v2-border)',
                fontSize: '13px',
                fontWeight: 500,
                color: '#4F6EF7',
                gap: '6px'
              }}
            >
              <Link2 style={{ width: '14px', height: '14px' }} strokeWidth={2} />
              {t('lead_capture.create_custom') || '+ Create custom link for campaigns'}
            </button>
          )}

          {/* Help Text */}
          <p
            style={{
              marginTop: '12px',
              fontSize: '11.5px',
              color: 'var(--v2-text-muted)',
              lineHeight: 1.5,
              textAlign: 'center'
            }}
          >
            {t('lead_capture.help_text') || 'Share these links on your website, social media, or email signature. Leads are automatically added to your CRM.'}
          </p>
        </div>
      )}
    </div>
  );
}
