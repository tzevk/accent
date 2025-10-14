'use client';

export default function DonutChart({
  size = 180,
  thickness = 18,
  data = [], // [{ value: number, color: string, label?: string }]
  totalLabel = 'Total',
  showTotal = true,
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(0, data.reduce((a, d) => a + (Number(d.value) || 0), 0));
  let offset = 0;

  return (
    <div className="flex items-center justify-center animate-fade-in">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transition-transform duration-200 hover:scale-[1.01]">
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          {/* Track */}
          <circle
            r={radius}
            cx={0}
            cy={0}
            fill="transparent"
            stroke="#F3E8FF"
            strokeWidth={thickness}
          />
          {total > 0 && data.map((d, i) => {
            const val = Math.max(0, Number(d.value) || 0);
            const len = (val / total) * circumference;
            const dashArray = `${len} ${circumference - len}`;
            const el = (
              <circle
                key={i}
                r={radius}
                cx={0}
                cy={0}
                fill="transparent"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={dashArray}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {/* Center label */}
        {showTotal && (
          <g transform={`translate(${size / 2}, ${size / 2})`}>
            <text textAnchor="middle" dominantBaseline="central">
              <tspan x="0" y="-6" className="fill-[#64126D] font-semibold" style={{ fontSize: 18 }}>
                {total}
              </tspan>
              <tspan x="0" y="14" className="fill-gray-500" style={{ fontSize: 11 }}>
                {totalLabel}
              </tspan>
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
