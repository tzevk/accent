import { XMarkIcon } from "@heroicons/react/24/outline";

export default function LessonsLearntTab({
  newLessonDescRef,
  newLesson,
  setNewLesson,
  addLessonRow,
  lessonsLearnt,
  updateLessonRow,
  removeLessonRow,
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
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <h2 className="text-sm font-bold text-gray-900">
            Lessons Learnt
          </h2>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          Capture learning from the project
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
                  What was new
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Difficulty Faced
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  What You Learned
                </th>
                <th className="text-left py-2 px-2 font-semibold text-gray-700">
                  Areas of Improvement
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
                    ref={newLessonDescRef}
                    type="text"
                    value={newLesson.what_was_new}
                    onChange={(e) =>
                      setNewLesson((prev) => ({
                        ...prev,
                        what_was_new: e.target.value,
                      }))
                    }
                    placeholder="What was new"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newLesson.difficulty_faced}
                    onChange={(e) =>
                      setNewLesson((prev) => ({
                        ...prev,
                        difficulty_faced: e.target.value,
                      }))
                    }
                    placeholder="Difficulty Faced"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newLesson.what_you_learn}
                    onChange={(e) =>
                      setNewLesson((prev) => ({
                        ...prev,
                        what_you_learn: e.target.value,
                      }))
                    }
                    placeholder="What You Learned"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newLesson.areas_of_improvement}
                    onChange={(e) =>
                      setNewLesson((prev) => ({
                        ...prev,
                        areas_of_improvement: e.target.value,
                      }))
                    }
                    placeholder="Areas of Improvement"
                    className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    type="text"
                    value={newLesson.remark}
                    onChange={(e) =>
                      setNewLesson((prev) => ({
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
                    onClick={addLessonRow}
                    disabled={
                      !(
                        newLesson.what_was_new &&
                        newLesson.what_was_new.trim()
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${newLesson.what_was_new && newLesson.what_was_new.trim() ? "bg-[#7F2487] text-white hover:bg-purple-700 shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                    title="Add lesson"
                  >
                    Add
                  </button>
                </td>
              </tr>
              {lessonsLearnt.map((l, index) => (
                <tr
                  key={l.id}
                  className="hover:bg-gray-50 transition-colors align-top"
                >
                  <td className="py-2 px-2 text-center">
                    {index + 1}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={l.what_was_new || ""}
                      onChange={(e) =>
                        updateLessonRow(
                          l.id,
                          "what_was_new",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={l.difficulty_faced || ""}
                      onChange={(e) =>
                        updateLessonRow(
                          l.id,
                          "difficulty_faced",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={l.what_you_learn || ""}
                      onChange={(e) =>
                        updateLessonRow(
                          l.id,
                          "what_you_learn",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={l.areas_of_improvement || ""}
                      onChange={(e) =>
                        updateLessonRow(
                          l.id,
                          "areas_of_improvement",
                          e.target.value,
                        )
                      }
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:ring-1 focus:ring-[#7F2487]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      value={l.remark || ""}
                      onChange={(e) =>
                        updateLessonRow(
                          l.id,
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
                      onClick={() => removeLessonRow(l.id)}
                      className="text-red-500 hover:text-red-700 p-1"
                      title="Remove lesson"
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
