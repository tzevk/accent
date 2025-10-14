'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function InteractiveDonut({
  data = [],
  innerRadius = 60,
  outerRadius = 85,
  colors = [],
  totalLabel = 'Total',
  showLegend = false,
  showTotalBelow = false,
}) {
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0);
  const palette = colors.length ? colors : ['#FBBF24', '#10B981', '#60A5FA', '#F87171', '#A78BFA'];
  const chartData = data.map((d, i) => ({ name: d.name || d.label || `Item ${i+1}`, value: Number(d.value) || 0, fill: d.color || palette[i % palette.length] }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Pie data={chartData} innerRadius={innerRadius} outerRadius={outerRadius} paddingAngle={2} dataKey="value" isAnimationActive>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip formatter={(value, name) => [value, name]} />
          {showLegend && <Legend verticalAlign="bottom" height={24} />}
        </PieChart>
      </ResponsiveContainer>
      {showTotalBelow && (
        <div className="text-center -mt-6">
          <span className="text-sm text-gray-600">{totalLabel}: </span>
          <span className="text-sm font-semibold text-[#64126D]">{total}</span>
        </div>
      )}
    </div>
  );
}
