import { useState, useEffect } from 'react';

export default function ManhoursCalculator({ value, onChange }) {
  // value expected as number (total manhours)
  const [hours, setHours] = useState(value || 0);
  const [days, setDays] = useState(0);
  const [resources, setResources] = useState(1);

  useEffect(() => {
    // compute days assuming 8 hours per day and distribute across resources
    const computedDays = resources > 0 ? (hours / (8 * resources)) : 0;
  setDays(Number(computedDays.toFixed(2)));
  if (typeof onChange === 'function') onChange(hours);
  }, [hours, resources, onChange]);

  return (
    <div className="bg-white p-3 rounded-md border border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-700">Total Manhours</label>
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full mt-1 px-2 py-1 border border-gray-300 rounded-md"
            min="0"
            step="0.5"
          />
        </div>
        <div>
          <label className="text-xs text-gray-700">Resources</label>
          <input
            type="number"
            value={resources}
            onChange={(e) => setResources(Math.max(1, Number(e.target.value)))}
            className="w-full mt-1 px-2 py-1 border border-gray-300 rounded-md"
            min="1"
            step="1"
          />
        </div>
      </div>

      <div className="mt-3 text-sm text-gray-700">
        <div>Estimated Days (8h/day): <strong>{days}</strong></div>
        <div className="text-xs text-gray-500">This is a simple estimate dividing total manhours by 8*resources.</div>
      </div>
    </div>
  );
}
