'use client';

import React, { useState, useMemo } from 'react';
import { CalendarCell, generateContributionGrid } from '@/lib/github/calendarUtils';

interface ActivityCalendarProps {
  referenceDate?: Date;
  weeksCount?: number;
}

const DEFAULT_ANCHOR_DATE = new Date('2026-11-15T00:00:00Z');

export const ActivityCalendar: React.FC<ActivityCalendarProps> = ({
  referenceDate = DEFAULT_ANCHOR_DATE,
  weeksCount = 26,
}) => {
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<CalendarCell | null>(null);

  // Generate calendar relative to referenceDate
  const calendar = useMemo(() => {
    return generateContributionGrid({
      referenceDate,
      weeksCount,
      simulated: true,
    });
  }, [referenceDate, weeksCount]);

  const getCellColor = (day: CalendarCell) => {
    if (day.isFuture) {
      return 'bg-[#181c24] border-transparent opacity-20 cursor-not-allowed';
    }

    switch (day.level) {
      case 1:
        return 'bg-[#0e4429] border-[#006d32]/40 hover:bg-[#15633b]';
      case 2:
        return 'bg-[#006d32] border-[#26a641]/40 hover:bg-[#0e8a44]';
      case 3:
        return 'bg-[#26a641] border-[#39d353]/40 hover:bg-[#2ebc4f]';
      case 4:
        return 'bg-[#39d353] border-emerald-400 hover:bg-[#56df6f]';
      default:
        return 'bg-[#181c24] border-transparent hover:border-slate-600';
    }
  };

  const activeDayDisplay = selectedDay || (hoveredDay ? { date: hoveredDay.date, count: hoveredDay.count, isToday: false } : null);

  const getWeekdayName = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  };

  return (
    <div className="w-full max-w-full min-w-0">
      {/* Header and Illustrative Disclaimer */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">
            Contribution History
          </span>
          <span className="px-1.5 py-0.2 bg-[#181c24] text-slate-400 border border-[#2d3342] text-[10px] rounded">
            Simulated
          </span>
        </div>
        <div className="text-xs text-slate-400">
          <span className="text-slate-100 font-semibold">{calendar.totalContributions}</span> contributions in last 6 months
        </div>
      </div>

      {/* Heatmap Grid Wrapper */}
      <div className="relative w-full max-w-full min-w-0 overflow-x-auto p-3.5 bg-[#0c0e12] border border-[#222733] rounded-lg">
        {/* Floating Tooltip for mouse hover */}
        {hoveredDay && (
          <div
            style={{ left: hoveredDay.x, top: hoveredDay.y - 36 }}
            className="absolute z-30 pointer-events-none -translate-x-1/2 px-2.5 py-1 bg-[#181c24] border border-[#2d3342] rounded text-xs text-slate-100 shadow-lg whitespace-nowrap hidden sm:block"
          >
            <span className="text-emerald-400 font-semibold">{hoveredDay.count} contributions</span> on {hoveredDay.date}
          </div>
        )}

        {/* Month labels bar */}
        <div className="flex gap-[3px] mb-2 pl-7 min-w-max">
          {calendar.weeks.map((_, colIdx) => {
            const labelEntry = calendar.monthLabels.find((m) => m.colIndex === colIdx);
            return (
              <div key={colIdx} className="w-[12px] h-3 text-[10px] text-slate-500 font-mono">
                {labelEntry ? labelEntry.label : ''}
              </div>
            );
          })}
        </div>

        {/* Grid: 7 rows (Sun to Sat) × N columns (weeks) */}
        <div className="flex gap-2 min-w-max">
          {/* Weekday indicator labels */}
          <div className="flex flex-col gap-[3px] text-[9px] text-slate-500 font-mono pt-[1px] select-none pr-1">
            <span className="h-[12px] leading-[12px]">Sun</span>
            <span className="h-[12px] leading-[12px] opacity-0">Mon</span>
            <span className="h-[12px] leading-[12px]">Tue</span>
            <span className="h-[12px] leading-[12px] opacity-0">Wed</span>
            <span className="h-[12px] leading-[12px]">Thu</span>
            <span className="h-[12px] leading-[12px] opacity-0">Fri</span>
            <span className="h-[12px] leading-[12px]">Sat</span>
          </div>

          {/* 7-row columns */}
          <div className="flex gap-[3px]">
            {calendar.weeks.map((week, weekIdx) => (
              <div key={weekIdx} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    aria-label={`${day.count} contributions on ${day.date}${day.isToday ? ' (Today)' : ''}`}
                    onClick={() => setSelectedDay(day)}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                      const cellRect = e.currentTarget.getBoundingClientRect();
                      if (rect) {
                        setHoveredDay({
                          date: day.date,
                          count: day.count,
                          x: cellRect.left - rect.left + 6,
                          y: cellRect.top - rect.top,
                        });
                      }
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
                    onFocus={() => setSelectedDay(day)}
                    className={`w-[12px] h-[12px] rounded-xs border transition-all cursor-pointer ${getCellColor(day)} ${
                      day.isToday ? 'ring-1 ring-slate-100' : ''
                    }`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-3 pt-2.5 border-t border-[#222733] min-w-max">
          <span>Less</span>
          <div className="flex items-center gap-1 mx-2">
            <span className="w-2.5 h-2.5 bg-[#181c24] rounded-xs border border-transparent" />
            <span className="w-2.5 h-2.5 bg-[#0e4429] rounded-xs" />
            <span className="w-2.5 h-2.5 bg-[#006d32] rounded-xs" />
            <span className="w-2.5 h-2.5 bg-[#26a641] rounded-xs" />
            <span className="w-2.5 h-2.5 bg-[#39d353] rounded-xs" />
          </div>
          <span>More</span>
        </div>
      </div>

      {/* Accessible Day Inspector */}
      {activeDayDisplay && (
        <div className="mt-2.5 p-2.5 bg-[#12151b] border border-[#222733] rounded-lg flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">{getWeekdayName(activeDayDisplay.date)},</span>
            <span className="font-semibold text-slate-100 font-mono">{activeDayDisplay.date}</span>
            {activeDayDisplay.isToday && (
              <span className="px-1.5 py-0.2 bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 text-[10px] rounded">Today</span>
            )}
          </div>
          <div className="font-semibold text-emerald-400 font-mono">
            {activeDayDisplay.count} {activeDayDisplay.count === 1 ? 'commit' : 'commits'}
          </div>
        </div>
      )}
    </div>
  );
};
