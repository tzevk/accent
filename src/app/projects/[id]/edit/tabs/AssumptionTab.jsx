import { XMarkIcon } from "@heroicons/react/24/outline";

export default function AssumptionTab({
  newAssumptionDescRef,
  newAssumption,
  setNewAssumption,
  addAssumptionRow,
  assumptions,
  updateAssumptionRow,
  removeAssumptionRow,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-3 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-[#7F2487]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-sm font-bold text-gray-900">
            Assumptions
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Record project assumptions and rationale
        </p>
      </div>

      <div className="px-6 py-5">
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
              <tr>
                <th className="text-center py-2 px-2 font-semibold text-gray-700">
                  Sr No
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Assumption Description
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Reason
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Assumption Taken By
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Remark
                </th>
                <th className="text-center py-2 px-2 font-semibold text-gray-700">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="bg-purple-25/30">
                <td className="py-2 px-2 text-center text-gray-400">
                  +
                </td>
                <td className="py-2 px-2">
                  <input
                    ref={newAssumptionDescRef}
                    type="text"
                    value={newAssumption.assumption_description}
                    onChange={(e) =>
                      setNewAssumption((prev) => ({
                        ...prev,
                        assumption_description: e.target.value,
                      }))
                    }
                    placeholder="Assumption Description"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newAssumption.reason}
                    onChange={(e) =>
                      setNewAssumption((prev) => ({
                        ...prev,
                        reason: e.target.value,
                      }))
                    }
                    placeholder="Reason"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newAssumption.assumption_taken_by}
                    onChange={(e) =>
                      setNewAssumption((prev) => ({
                        ...prev,
                        assumption_taken_by: e.target.value,
                      }))
                    }
                    placeholder="Taken By"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newAssumption.remark}
                    onChange={(e) =>
                      setNewAssumption((prev) => ({
                        ...prev,
                        remark: e.target.value,
                      }))
                    }
                    placeholder="Remark"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    type="button"
                    onClick={addAssumptionRow}
                    disabled={
                      !(
                        newAssumption.assumption_description &&
                        newAssumption.assumption_description.trim()
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newAssumption.assumption_description && newAssumption.assumption_description.trim() ? "bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                    title="Add assumption"
                  >
                    Add
                  </button>
                </td>
              </tr>
              {assumptions.map((a, index) => (
                <tr
                  key={a.id}
                  className="hover:bg-gray-50 transition-colors align-top"
                >
                  <td className="py-2 px-2 text-center">
                    {index + 1}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={a.assumption_description || ""}
                      onChange={(e) =>
                        updateAssumptionRow(
                          a.id,
                          "assumption_description",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={a.reason || ""}
                      onChange={(e) =>
                        updateAssumptionRow(
                          a.id,
                          "reason",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={a.assumption_taken_by || ""}
                      onChange={(e) =>
                        updateAssumptionRow(
                          a.id,
                          "assumption_taken_by",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={a.remark || ""}
                      onChange={(e) =>
                        updateAssumptionRow(
                          a.id,
                          "remark",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeAssumptionRow(a.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Remove assumption"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
