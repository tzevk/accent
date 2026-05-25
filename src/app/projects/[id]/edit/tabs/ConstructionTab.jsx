const SITE_READINESS_OPTIONS = ["Ready", "Not Ready", "In Progress", "Delayed"];

export default function ConstructionTab({ form, handleChange }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">
          Construction / Site
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Mobilization Date
          </label>
          <input
            type="date"
            name="mobilization_date"
            value={form.mobilization_date}
            onChange={handleChange}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Site Readiness
          </label>
          <select
            name="site_readiness"
            value={form.site_readiness}
            onChange={handleChange}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          >
            <option value="">Select Status</option>
            {SITE_READINESS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Construction Progress
          </label>
          <textarea
            name="construction_progress"
            value={form.construction_progress}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
      </div>
    </section>
  );
}
