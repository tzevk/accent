const PROCUREMENT_STATUS_OPTIONS = [
  'Not Started',
  'In Progress',
  'Completed',
  'On Hold',
];

export default function ProcurementTab({ form, handleChange }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">
          Procurement & Material
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Procurement Status
          </label>
          <select
            name="procurement_status"
            value={form.procurement_status}
            onChange={handleChange}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          >
            <option value="">Select Status</option>
            {PROCUREMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Material Delivery Schedule
          </label>
          <textarea
            name="material_delivery_schedule"
            value={form.material_delivery_schedule}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Vendor Management
          </label>
          <textarea
            name="vendor_management"
            value={form.vendor_management}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
      </div>
    </section>
  );
}
