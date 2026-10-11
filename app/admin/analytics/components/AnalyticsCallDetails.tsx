'use client';

/**
 * AI cost & usage: one call's details, the body of the page's `AdminDrawer`
 * (Admin Layout Standard L-2b, workplan §3.4; §5.8 D-5).
 *
 * Rendered from the row already loaded: opening it sends no request (R-6). The
 * same fields as the old modal, in named sections; a section with nothing to
 * show is not rendered. Times are UTC (F-50), and nothing is coloured except
 * the status chip (F-51, A-7): the most expensive call says so in words.
 */

import { DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';

import { callStatus, formatLatency, readMeta } from '../analyticsCall';
import { formatCost, formatNumber, type DrillDownItem } from '../analyticsTypes';

const CODE = 'font-mono text-xs break-all';

export function AnalyticsCallDetails({ call }: { call: DrillDownItem }) {
  const meta = readMeta(call);
  const status = callStatus(meta.success);
  const hasClassification = Boolean(meta.requestType || meta.dbCategory || meta.category);
  // Today's condition, kept: a call with only a workflow step shows no Activity
  // section (F-100, recorded, not changed in a layout slice).
  const hasActivity = Boolean(meta.activityType || meta.activityName || meta.activityStep);
  const hasSystem = Boolean(meta.feature || meta.component || meta.endpoint);
  // 0 hides the field, as the old truthiness check did (SA S-3).
  const hasLatency = meta.latencyMs !== null && meta.latencyMs !== 0;

  return (
    <>
      <DrawerSection title="Call" testId="call-section-call">
        <DrawerFields>
          <DrawerField label="Call">{call.label}</DrawerField>
          <DrawerField label="Status" testId="call-detail-status">
            <StatusChip tone={status.tone}>{status.word}</StatusChip>
          </DrawerField>
          <DrawerField label="Time" testId="call-detail-time">
            {formatUtc(meta.timestamp)}
          </DrawerField>
          {hasLatency && <DrawerField label="Latency">{formatLatency(meta.latencyMs, 'detail')}</DrawerField>}
          {meta.callId && (
            <DrawerField label="Call ID">
              <span className={CODE}>{meta.callId}</span>
            </DrawerField>
          )}
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title="Model" testId="call-section-model">
        <DrawerFields>
          <DrawerField label="Model">{meta.model ?? 'Unknown'}</DrawerField>
          <DrawerField label="Provider">{meta.provider ?? 'Unknown'}</DrawerField>
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title="Cost and tokens" testId="call-section-cost">
        <DrawerFields>
          <DrawerField label="Cost (USD)" testId="call-detail-cost">
            <span className="text-slate-200">{formatCost(call.cost)}</span>
            {call.isHighCost && <span className="ml-2 text-slate-400">most expensive call in this run</span>}
          </DrawerField>
          <DrawerField label="Input tokens">{formatNumber(call.inputTokens)}</DrawerField>
          <DrawerField label="Output tokens">{formatNumber(call.outputTokens)}</DrawerField>
          <DrawerField label="Total tokens">{formatNumber(call.tokens)}</DrawerField>
        </DrawerFields>
      </DrawerSection>

      {hasClassification && (
        <DrawerSection title="Classification" testId="call-section-classification">
          <DrawerFields>
            {meta.requestType && <DrawerField label="Request type">{meta.requestType}</DrawerField>}
            {meta.dbCategory && <DrawerField label="Category">{meta.dbCategory}</DrawerField>}
            {meta.category && <DrawerField label="BI category">{meta.category}</DrawerField>}
          </DrawerFields>
        </DrawerSection>
      )}

      {hasActivity && (
        <DrawerSection title="Activity" testId="call-section-activity">
          <DrawerFields>
            {meta.activityType && <DrawerField label="Activity type">{meta.activityType}</DrawerField>}
            {meta.activityName && <DrawerField label="Activity name">{meta.activityName}</DrawerField>}
            {meta.activityStep && <DrawerField label="Activity step">{meta.activityStep}</DrawerField>}
            {meta.workflowStep && <DrawerField label="Workflow step">{meta.workflowStep}</DrawerField>}
          </DrawerFields>
        </DrawerSection>
      )}

      {hasSystem && (
        <DrawerSection title="System context" testId="call-section-system">
          <DrawerFields>
            {meta.feature && <DrawerField label="Feature">{meta.feature}</DrawerField>}
            {meta.component && <DrawerField label="Component">{meta.component}</DrawerField>}
            {meta.endpoint && (
              <DrawerField label="Endpoint">
                <span className={CODE}>{meta.endpoint}</span>
              </DrawerField>
            )}
          </DrawerFields>
        </DrawerSection>
      )}
    </>
  );
}
