import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export default function PlanningTab({
  newPlanningActivity,
  updatePlanningActivityField,
  addPlanningActivity,
  planningActivities = [],
  removePlanningActivity,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">Project Planning</h2>
        <p className="text-xs text-gray-600 mt-1">
          Track activities, timelines, and deliverables
        </p>
      </div>
      <div className="px-6 py-5 space-y-6">
        {/* Activity Tracking Section */}
        <div>
          <h3 className="text-sm font-semibold text-black mb-4">
            Activity Tracking
          </h3>

          {/* Add New Activity Form */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Serial No.
                </label>
                <input
                  type="text"
                  value={newPlanningActivity.serialNumber}
                  onChange={(e) =>
                    updatePlanningActivityField('serialNumber', e.target.value)
                  }
                  placeholder="Auto"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Activity *
                </label>
                <input
                  type="text"
                  value={newPlanningActivity.activity}
                  onChange={(e) =>
                    updatePlanningActivityField('activity', e.target.value)
                  }
                  placeholder="Enter activity name..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Quantity
                </label>
                <input
                  type="text"
                  value={newPlanningActivity.quantity}
                  onChange={(e) =>
                    updatePlanningActivityField('quantity', e.target.value)
                  }
                  placeholder="e.g., 10 units"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={newPlanningActivity.startDate}
                  onChange={(e) =>
                    updatePlanningActivityField('startDate', e.target.value)
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={newPlanningActivity.endDate}
                  onChange={(e) =>
                    updatePlanningActivityField('endDate', e.target.value)
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Actual Completion
                </label>
                <input
                  type="date"
                  value={newPlanningActivity.actualCompletionDate}
                  onChange={(e) =>
                    updatePlanningActivityField(
                      'actualCompletionDate',
                      e.target.value
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Time Required
                </label>
                <input
                  type="text"
                  value={newPlanningActivity.timeRequired}
                  onChange={(e) =>
                    updatePlanningActivityField('timeRequired', e.target.value)
                  }
                  placeholder="e.g., 5 days"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Actual Time
                </label>
                <input
                  type="text"
                  value={newPlanningActivity.actualTimeRequired}
                  onChange={(e) =>
                    updatePlanningActivityField(
                      'actualTimeRequired',
                      e.target.value
                    )
                  }
                  placeholder="e.g., 6 days"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#7F2487]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={addPlanningActivity}
                className="px-4 py-2 bg-[#7F2487] text-white text-sm font-medium rounded-md hover:bg-[#6a1e73] transition-colors flex items-center gap-1"
              >
                <PlusIcon className="h-4 w-4" />
                Add Activity
              </button>
            </div>
          </div>

          {/* Activities List */}
          {planningActivities.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200 rounded-lg">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      S.No
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Activity
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Quantity
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Start Date
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      End Date
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Actual Completion
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Time Required
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Actual Time
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-gray-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {planningActivities.map((activity) => (
                    <tr
                      key={activity.id}
                      className="border-t border-gray-200 hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 text-gray-900">
                        {activity.serialNumber}
                      </td>
                      <td className="px-3 py-2 text-gray-900 font-medium">
                        {activity.activity}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.quantity || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.startDate || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.endDate || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.actualCompletionDate || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.timeRequired || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {activity.actualTimeRequired || '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removePlanningActivity(activity.id)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                          title="Remove activity"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
              No activities added yet. Use the form above to add planning
              activities.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
