'use client';

/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import { memo, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function InteractiveDonutBase({
  data = [],
  innerRadius = 60,
  outerRadius = 85,
  colors = [],
  totalLabel = 'Total',
  showLegend = false,
  showTotalBelow = false,
  animationBegin = 0,
  animationDuration = 450,
  animationEasing = 'ease-out',
  valueFormatter,
}) {
  const palette = useMemo(() => colors.length ? colors : ['#FBBF24', '#10B981', '#60A5FA', '#F87171', '#A78BFA'], [colors]);

  const chartData = useMemo(() => (
    (data || []).map((d, i) => ({
      name: d.name || d.label || `Item ${i + 1}`,
      value: Number(d.value) || 0,
      fill: d.color || palette[i % palette.length],
    }))
  ), [data, palette]);

  const total = useMemo(() => chartData.reduce((a, d) => a + (Number(d.value) || 0), 0), [chartData]);

  const fmt = typeof valueFormatter === 'function' ? valueFormatter : (v) => v;

  return (
  <div className="relative w-full h-64 will-change-transform" style={{ transform: 'translateZ(0)' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie
            data={chartData}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            cornerRadius={8}
            dataKey="value"
            isAnimationActive
            animationBegin={animationBegin}
            animationDuration={animationDuration}
            animationEasing={animationEasing}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name) => [fmt(value), name]} contentStyle={{ borderRadius: 12, borderColor: '#E5E7EB', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }} />
          {showLegend && <Legend verticalAlign="bottom" height={24} />}
        </PieChart>
      </ResponsiveContainer>
      {/* Premium center label */}
      {!showTotalBelow && (
        <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{fmt(total)}</div>
            <div className="text-xs text-gray-500 -mt-0.5">{totalLabel}</div>
          </div>
        </div>
      )}
      {showTotalBelow && (
        <div className="text-center -mt-6">
          <span className="text-sm text-gray-600">{totalLabel}: </span>
          <span className="text-sm font-semibold text-[#64126D]">{fmt(total)}</span>
        </div>
      )}
    </div>
  );
}

function areEqual(prev, next) {
  if (prev.innerRadius !== next.innerRadius || prev.outerRadius !== next.outerRadius) return false;
  if (prev.showLegend !== next.showLegend || prev.showTotalBelow !== next.showTotalBelow) return false;
  const a = prev.data || [];
  const b = next.data || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].value !== b[i].value || a[i].name !== b[i].name || a[i].label !== b[i].label || a[i].color !== b[i].color) return false;
  }
  return true;
}

export default memo(InteractiveDonutBase, areEqual);
