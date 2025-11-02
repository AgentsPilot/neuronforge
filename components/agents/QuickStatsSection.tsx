// components/agents/QuickStatsSection.tsx
'use client';

import React from 'react';
import StatCard from './StatCard';
import { Activity, CheckCircle2, Clock, DollarSign } from 'lucide-react';

interface QuickStatsSectionProps {
  timesUsed: number;
  successRate: number;
  avgSpeed: string;
  costToday: string;
}

export default function QuickStatsSection({
  timesUsed,
  successRate,
  avgSpeed,
  costToday
}: QuickStatsSectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">At a Glance</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="Times Used"
          value={timesUsed}
          subtitle="Total runs"
          iconColor="text-blue-600"
          iconBgColor="bg-blue-50"
        />

        <StatCard
          icon={CheckCircle2}
          label="Success Score"
          value={`${successRate}%`}
          subtitle="Completion rate"
          iconColor="text-green-600"
          iconBgColor="bg-green-50"
        />

        <StatCard
          icon={Clock}
          label="Avg Speed"
          value={avgSpeed}
          subtitle="Per run"
          iconColor="text-purple-600"
          iconBgColor="bg-purple-50"
        />

        <StatCard
          icon={DollarSign}
          label="Cost Today"
          value={costToday}
          subtitle="AI usage"
          iconColor="text-amber-600"
          iconBgColor="bg-amber-50"
        />
      </div>
    </div>
  );
}
