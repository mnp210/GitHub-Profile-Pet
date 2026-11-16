import React from 'react';
import { StatCard } from './StatCard';
import { DEMO_ACTIVITY_METRICS } from '@/constants/petData';

export const ActivitySummary: React.FC = () => {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
        <span>GitHub Activity Summary</span>
        <span className="text-[11px] text-slate-500 font-mono">Demo Simulated</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {DEMO_ACTIVITY_METRICS.map((metric) => (
          <StatCard
            key={metric.id}
            id={metric.id}
            label={metric.label}
            value={metric.value}
            unit={metric.unit}
            changeDescription={metric.changeDescription}
            isPositive={metric.isPositive}
            icon={metric.icon}
          />
        ))}
      </div>
    </div>
  );
};
