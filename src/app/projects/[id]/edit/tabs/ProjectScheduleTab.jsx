import {
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { formatWeekHeaderDate } from '@/utils/date';

export default function ProjectScheduleTab({
  scheduleWeeks,
  form,
  SCHEDULE_LEGENDS,
  selectedScheduleLegend,
  setSelectedScheduleLegend,
  canEditSchedule,
  canEditProjectContent,
  scheduleLocked,
  setScheduleLocked,
  scheduleEffectivelyLocked,
  addSchedule,
  projectSchedule,
  computeScheduleWeeksFromDates,
  updateSchedule,
  removeSchedule,
  toggleScheduleWeek,
  getScheduleLegend,
  projectActivityScheduleGroups,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-black">Project Schedule</h2>
        <p className="text-xs text-gray-600 mt-1">
          Add activities/tasks, durations and status
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        {scheduleWeeks.length > 0 ? (
          <div className="text-xs text-gray-500">
            Timeline:{' '}
            <span className="font-medium text-gray-700">{form.start_date}</span>{' '}
            to{' '}
            <span className="font-medium text-gray-700">{form.end_date}</span> (
            {scheduleWeeks.length} weeks)
          </div>
        ) : (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            Set{' '}
            <span className="font-medium text-gray-700">
              Project Start Date
            </span>{' '}
            and{' '}
            <span className="font-medium text-gray-700">Project End Date</span>{' '}
            in Project Details to see the week-wise schedule grid.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">Legend:</span>
            {SCHEDULE_LEGENDS.map((l) => {
              const active = selectedScheduleLegend === l.key;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setSelectedScheduleLegend(l.key)}
                  disabled={!canEditSchedule}
                  className={`inline-flex items-center gap-2 px-2 py-1 rounded border text-xs transition-colors ${
                    active
                      ? 'border-[#7F2487] bg-purple-25'
                      : 'border-gray-200 bg-white'
                  } ${canEditSchedule ? 'hover:bg-gray-50' : 'opacity-60 cursor-not-allowed'}`}
                  title={l.label}
                >
                  <span className={`h-3 w-6 rounded ${l.cellClass}`} />
                  <span className="text-gray-700">{l.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setScheduleLocked((prev) => !prev)}
            disabled={!canEditProjectContent}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors border ${
              canEditProjectContent
                ? scheduleEffectivelyLocked
                  ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
            }`}
            title={
              canEditProjectContent
                ? scheduleLocked
                  ? 'Unlock schedule editing'
                  : 'Lock schedule editing'
                : 'You have view-only access'
            }
          >
            {scheduleEffectivelyLocked ? (
              <LockClosedIcon className="h-4 w-4" />
            ) : (
              <LockOpenIcon className="h-4 w-4" />
            )}
            {canEditProjectContent
              ? scheduleLocked
                ? 'Unlock Schedule'
                : 'Lock Schedule'
              : 'Schedule Locked'}
          </button>

          <button
            type="button"
            onClick={() => addSchedule()}
            disabled={!canEditSchedule}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
              canEditSchedule
                ? 'bg-[#7F2487] text-white hover:bg-[#6a1e73]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
            title={
              canEditSchedule
                ? 'Add a new schedule row'
                : !canEditProjectContent
                  ? 'You have view-only access'
                  : 'Schedule is locked'
            }
          >
            <PlusIcon className="h-4 w-4" />
            Add Row
          </button>
        </div>

        {projectSchedule.length > 0 && scheduleWeeks.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-x-auto">
            <div className="min-w-max">
              {/* Header */}
              <div className="flex border-b border-gray-200 bg-gray-50">
                <div className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200">
                  <div className="grid grid-cols-[320px_180px] h-[48px] items-center px-2 text-[11px] font-semibold text-gray-700">
                    <div>Activity</div>
                    <div>Discipline</div>
                  </div>
                </div>
                <div className="flex-1">
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${scheduleWeeks.length}, 56px)`,
                    }}
                  >
                    {scheduleWeeks.map((w) => (
                      <div
                        key={`date-${w.index}`}
                        className="border-r border-gray-200 h-6 flex items-center justify-center text-[10px] font-semibold text-gray-700"
                      >
                        {formatWeekHeaderDate(w.start)}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${scheduleWeeks.length}, 56px)`,
                    }}
                  >
                    {scheduleWeeks.map((w) => (
                      <div
                        key={`week-${w.index}`}
                        className="border-r border-gray-200 h-6 flex items-center justify-center text-[10px] font-semibold text-gray-700"
                      >
                        {w.label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Rows */}
              {projectSchedule.map((s, idx) => {
                const srValue = s.sr_no ?? String(idx + 1);
                const markedWeeks = new Set(
                  (Array.isArray(s.weeks) && s.weeks.length > 0
                    ? s.weeks
                    : computeScheduleWeeksFromDates(s.start_date, s.end_date)
                  )
                    .map((n) => Number(n))
                    .filter((n) => Number.isFinite(n))
                );

                return (
                  <div
                    key={s.id}
                    className="flex border-b border-gray-100 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="sticky left-0 z-20 bg-white border-r border-gray-200">
                      <div className="grid grid-cols-[320px_180px] gap-2 items-center px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 w-8 text-center flex-shrink-0">
                            {srValue}
                          </span>
                          <input
                            type="text"
                            value={s.activity_description || ''}
                            onChange={(e) =>
                              updateSchedule(
                                s.id,
                                'activity_description',
                                e.target.value
                              )
                            }
                            className="w-full text-[11px] px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                            placeholder="Activity"
                            list="project-schedule-activity-options"
                            disabled={!canEditSchedule}
                          />
                          <button
                            type="button"
                            onClick={() => removeSchedule(s.id)}
                            className={`p-1 flex-shrink-0 ${canEditSchedule ? 'text-red-500 hover:text-red-700' : 'text-gray-300 cursor-not-allowed'}`}
                            title="Remove row"
                            disabled={!canEditSchedule}
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={
                              s.discipline ||
                              getScheduleLegend(s.legend)?.label ||
                              ''
                            }
                            onChange={(e) =>
                              updateSchedule(s.id, 'discipline', e.target.value)
                            }
                            className="w-full text-[11px] px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                            placeholder="Discipline"
                            list="project-schedule-discipline-options"
                            disabled={!canEditSchedule}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex-1">
                      <div
                        className="grid items-center relative"
                        style={{
                          gridTemplateColumns: `repeat(${scheduleWeeks.length}, 56px)`,
                        }}
                      >
                        {scheduleWeeks.map((w) => {
                          const isMarked = markedWeeks.has(w.index);
                          const legend = getScheduleLegend(s.legend);
                          const cellStyle =
                            isMarked && !legend && s.color
                              ? { backgroundColor: s.color }
                              : undefined;
                          return (
                            <button
                              key={w.index}
                              type="button"
                              onClick={() => toggleScheduleWeek(s.id, w.index)}
                              disabled={!canEditSchedule}
                              style={cellStyle}
                              className={`h-10 border-r border-gray-100 text-[12px] font-semibold flex items-center justify-center select-none ${
                                isMarked
                                  ? legend
                                    ? `${legend.cellClass} ${legend.textClass}`
                                    : s.color
                                      ? 'text-gray-900'
                                      : 'bg-gray-200 text-gray-800'
                                  : 'bg-white text-gray-500'
                              } ${canEditSchedule ? 'hover:bg-gray-100' : 'cursor-default'}`}
                              title={w.rangeLabel}
                            >
                              {isMarked ? 'x' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {projectSchedule.length > 0 && scheduleWeeks.length === 0 && (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Activity / Task Description
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Unit/Qty
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Start Date
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Completion Date
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Time/Hours
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Status
                  </th>
                  <th className="text-left py-2 px-3 font-semibold text-gray-700">
                    Remarks
                  </th>
                  <th className="text-center py-2 px-3 font-semibold text-gray-700">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projectSchedule.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={s.activity_description || ''}
                        onChange={(e) =>
                          updateSchedule(
                            s.id,
                            'activity_description',
                            e.target.value
                          )
                        }
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                        placeholder="Activity / task"
                        list="project-schedule-activity-options"
                        disabled={!canEditSchedule}
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={s.unit_qty || ''}
                        onChange={(e) =>
                          updateSchedule(s.id, 'unit_qty', e.target.value)
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={s.start_date || ''}
                        onChange={(e) =>
                          updateSchedule(s.id, 'start_date', e.target.value)
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={s.end_date || ''}
                        onChange={(e) =>
                          updateSchedule(s.id, 'end_date', e.target.value)
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={s.time_required || ''}
                        onChange={(e) =>
                          updateSchedule(s.id, 'time_required', e.target.value)
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={s.status_completed || ''}
                        onChange={(e) =>
                          updateSchedule(
                            s.id,
                            'status_completed',
                            e.target.value
                          )
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      >
                        <option value="">Select</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Ongoing">Ongoing</option>
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={s.remarks || ''}
                        onChange={(e) =>
                          updateSchedule(s.id, 'remarks', e.target.value)
                        }
                        disabled={!canEditSchedule}
                        className="w-full text-sm px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487] focus:border-transparent"
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeSchedule(s.id)}
                        className={`p-1 ${canEditSchedule ? 'text-red-500 hover:text-red-700' : 'text-gray-300 cursor-not-allowed'}`}
                        title="Remove item"
                        disabled={!canEditSchedule}
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {projectSchedule.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
            No schedule items yet. Click{' '}
            <span className="font-medium">Add Row</span> to start planning the
            Gantt chart.
          </div>
        )}

        {/* Suggestions for the Activity/Task field */}
        <datalist id="project-schedule-activity-options">
          {projectActivityScheduleGroups.flatMap((g) =>
            g.options.map((opt) => (
              <option key={`${g.discipline}__${opt}`} value={opt} />
            ))
          )}
        </datalist>

        {/* Discipline suggestions */}
        <datalist id="project-schedule-discipline-options">
          {projectActivityScheduleGroups.map((g) => (
            <option key={g.discipline} value={g.discipline} />
          ))}
        </datalist>
      </div>
    </section>
  );
}
