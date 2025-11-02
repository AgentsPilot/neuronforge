// components/agents/StatCard.tsx
'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  iconColor?: string;
  iconBgColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export default function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  iconColor = 'text-blue-600',
  iconBgColor = 'bg-blue-50',
  trend
}: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className={`p-2 rounded-lg ${iconBgColor}`}>
              <Icon className={`w-4 h-4 ${iconColor}`} />
            </div>
            <span className="text-xs font-medium text-gray-600">{label}</span>
          </div>

          <div className="mt-2">
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            {subtitle && (
              <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>
            )}
          </div>

          {trend && (
            <div className="mt-2 flex items-center gap-1">
              <span className={`text-xs font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
              <span className="text-xs text-gray-500">vs last week</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
