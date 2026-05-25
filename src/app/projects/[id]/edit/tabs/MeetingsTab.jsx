export default function MeetingsTab({ form, handleChange }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">
          Meetings & Communications
        </h2>
        <p className="text-xs text-gray-600 mt-1">
          Kickoff meetings, internal discussions, and follow-ups
        </p>
      </div>
      <div className="px-6 py-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            Kickoff Meeting
          </label>
          <textarea
            name="kickoff_meeting"
            value={form.kickoff_meeting}
            onChange={handleChange}
            rows={4}
            placeholder="Document kickoff meeting details, attendees, and key decisions..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black mb-1">
            In-House Meetings
          </label>
          <textarea
            name="in_house_meeting"
            value={form.in_house_meeting}
            onChange={handleChange}
            rows={4}
            placeholder="Track internal team meetings, discussions, and action items..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">
              Kickoff Meeting Date
            </label>
            <input
              type="date"
              name="kickoff_meeting_date"
              value={form.kickoff_meeting_date}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">
              Follow-up Meeting Date
            </label>
            <input
              type="date"
              name="followup_meeting_date"
              value={form.followup_meeting_date}
              onChange={handleChange}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
