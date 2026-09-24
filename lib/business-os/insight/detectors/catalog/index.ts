/**
 * Detector catalog.
 *
 * Every detector registered in `DetectorEngine`, and only those. The barrel had
 * drifted to 7 of 28 — exporting a third of the catalogue while reading as the
 * whole of it, which is why counting detectors from here gives the wrong answer.
 * `DetectorEngine` remains the registration point; this is the import surface.
 */

export { BaseDetector } from './BaseDetector';

export { CashArOverdueDetector } from './CashArOverdueDetector';
export { PaymentIssuesDetector } from './PaymentIssuesDetector';
export { RetNoShowSpikeDetector } from './RetNoShowSpikeDetector';
export { SalesStalledDetector } from './SalesStalledDetector';
export { SalesReplySlowDetector } from './SalesReplySlowDetector';
export { OpsUtilizationLowDetector } from './OpsUtilizationLowDetector';
export { CrmColdLeadsDetector } from './CrmColdLeadsDetector';
export { AcqTrafficDropDetector } from './AcqTrafficDropDetector';
export { AcqLowConversionDetector } from './AcqLowConversionDetector';
export { RetCancellationSpikeDetector } from './RetCancellationSpikeDetector';
export { ConvPipelineStuckDetector } from './ConvPipelineStuckDetector';
export { ConvFollowupOverdueDetector } from './ConvFollowupOverdueDetector';
export { ConvSourceUnderperformDetector } from './ConvSourceUnderperformDetector';
export { CrmEngagementDecayDetector } from './CrmEngagementDecayDetector';
export { RetRepeatBookingLowDetector } from './RetRepeatBookingLowDetector';
export { OpsLastMinuteCancelsDetector } from './OpsLastMinuteCancelsDetector';
export { OpsServicePerformanceDetector } from './OpsServicePerformanceDetector';
export { OpsPeakUnutilizedDetector } from './OpsPeakUnutilizedDetector';
export { WebMissingCtaDetector } from './WebMissingCtaDetector';
export { WebIncompleteContentDetector } from './WebIncompleteContentDetector';
export { CashArAgingDetector } from './CashArAgingDetector';
export { CashRefundPatternDetector } from './CashRefundPatternDetector';
export { CashPayoutBlockedDetector } from './CashPayoutBlockedDetector';
export { PricingIntroOfferStuckDetector } from './PricingIntroOfferStuckDetector';
export { CashBookingUnpaidDetector } from './CashBookingUnpaidDetector';
export { CashWorkUnbilledDetector } from './CashWorkUnbilledDetector';
export { CashIncomeDropDetector } from './CashIncomeDropDetector';
export { CashClientConcentrationDetector } from './CashClientConcentrationDetector';
export { ConvQuoteAcceptanceDropDetector } from './ConvQuoteAcceptanceDropDetector';
export { WebMobileConversionGapDetector } from './WebMobileConversionGapDetector';
export { WebPageNoConversionsDetector } from './WebPageNoConversionsDetector';
export { RetPackageEndingDetector } from './RetPackageEndingDetector';
export { RetRescheduleChurnDetector } from './RetRescheduleChurnDetector';
export { CashCardsExpiringDetector } from './CashCardsExpiringDetector';
export { PricingDiscountAbuseDetector } from './PricingDiscountAbuseDetector';
export { WebLinkNotConvertingDetector } from './WebLinkNotConvertingDetector';
export { WebLinkDeadDestinationDetector } from './WebLinkDeadDestinationDetector';
export { ConvNoNextStepDetector } from './ConvNoNextStepDetector';
export { CashRevenueAtRiskDetector } from './CashRevenueAtRiskDetector';
export { ConvStageDropoffDetector } from './ConvStageDropoffDetector';
export { ConvServiceRateDropDetector } from './ConvServiceRateDropDetector';
