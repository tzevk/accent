const DOCUMENTATION_STATUS_OPTIONS = [
  "Not Started",
  "Drafted",
  "Reviewed",
  "Finalized",
];

export default function CloseoutTab({ form, handleChange }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">
          Project Closeout
        </h2>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Documentation Status
          </label>
          <select
            name="final_documentation_status"
            value={form.final_documentation_status}
            onChange={handleChange}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          >
            <option value="">Select Status</option>
            {DOCUMENTATION_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Actual Profit/Loss
          </label>
          <input
            type="number"
            name="actual_profit_loss"
            value={form.actual_profit_loss}
            onChange={handleChange}
            step="0.01"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Lessons Learned
          </label>
          <textarea
            name="lessons_learned"
            value={form.lessons_learned}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Client Feedback
          </label>
          <textarea
            name="client_feedback"
            value={form.client_feedback}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Additional Notes
          </label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
      </div>
    </section>
  );
}
