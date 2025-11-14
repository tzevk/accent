import { useState, useEffect, useRef } from 'react';

export default function PriceBreakupEditor({ value, onChange }) {
  // value expected as array of { label, quantity, unitPrice }
  // Ensure each row has a stable id
  const nextId = useRef(Date.now());
  const normalize = (arr) => (arr || []).map((r) => ({ ...r, id: r.id ?? ++nextId.current }));
  const [rows, setRows] = useState(value && Array.isArray(value) ? normalize(value) : [{ id: ++nextId.current, label: 'Item 1', quantity: 1, unitPrice: 0 }]);

  useEffect(() => {
    if (onChange) onChange(rows);
  }, [rows, onChange]);

  const updateRow = (idx, field, val) => {
    const next = rows.map((r, i) => i === idx ? { ...r, [field]: field === 'label' ? val : Number(val || 0) } : r);
    setRows(next);
  };

  const addRow = () => setRows(prev => [...prev, { id: ++nextId.current, label: `Item ${prev.length + 1}`, quantity: 1, unitPrice: 0 }]);
  const removeRow = (idx) => setRows(prev => prev.filter((r, i) => i !== idx));

  const total = rows.reduce((s, r) => s + (r.quantity || 0) * (r.unitPrice || 0), 0);

  return (
    <div className="bg-white p-3 rounded-md border border-gray-200">
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
            <input className="col-span-5 px-2 py-1 border border-gray-300 rounded-md" value={r.label} onChange={(e) => updateRow(idx, 'label', e.target.value)} />
            <input className="col-span-2 px-2 py-1 border border-gray-300 rounded-md" type="number" min="0" value={r.quantity} onChange={(e) => updateRow(idx, 'quantity', e.target.value)} />
            <input className="col-span-3 px-2 py-1 border border-gray-300 rounded-md" type="number" min="0" step="0.01" value={r.unitPrice} onChange={(e) => updateRow(idx, 'unitPrice', e.target.value)} />
            <div className="col-span-1 text-sm">{(r.quantity * r.unitPrice).toFixed(2)}</div>
            <button type="button" onClick={() => removeRow(idx)} className="col-span-1 text-red-600">Remove</button>
          </div>
        ))}

        <div className="flex justify-between items-center">
          <button type="button" onClick={addRow} className="text-sm text-indigo-600">+ Add Row</button>
          <div className="text-sm font-medium">Total: <span className="ml-2">{total.toFixed(2)}</span></div>
        </div>
      </div>
    </div>
  );
}
