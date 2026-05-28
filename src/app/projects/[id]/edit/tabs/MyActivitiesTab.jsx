import { Fragment } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

export default function MyActivitiesTab({
  sessionUser,
  projectActivities,
  addDailyEntry,
  updateDailyEntry,
  updateUserManhours,
  removeDailyEntry,
}) {
  // Filter activities where current user is assigned
  const myActivities = projectActivities.filter((act) => {
    const assignedUsers = act.assigned_users || [];
    return assignedUsers.some((assignment) => {
      const odUserId =
        typeof assignment === 'object' ? assignment.user_id : assignment;
      return String(odUserId) === String(sessionUser?.id);
    });
  });

  const totalsHeader = myActivities.reduce(
    (acc, act) => {
      const assignedUsers = act.assigned_users || [];
      const myAssignment = assignedUsers.find((a) => {
        const odUserId = typeof a === 'object' ? a.user_id : a;
        return String(odUserId) === String(sessionUser?.id);
      });
      if (myAssignment && typeof myAssignment === 'object') {
        acc.plannedHours += parseFloat(myAssignment.planned_hours) || 0;
        const dailyEntries = myAssignment.daily_entries || [];
        acc.actualHours += dailyEntries.reduce(
          (sum, e) => sum + (parseFloat(e.hours) || 0),
          0
        );
      }
      return acc;
    },
    { plannedHours: 0, actualHours: 0 }
  );

  const remaining = totalsHeader.plannedHours - totalsHeader.actualHours;

  // Group by discipline
  const groupedByDiscipline = myActivities.reduce((acc, act) => {
    const discipline = act.discipline || act.function_name || 'Manual';
    if (!acc[discipline]) acc[discipline] = [];
    acc[discipline].push(act);
    return acc;
  }, {});

  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header with Totals */}
      <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <ClockIcon className="h-5 w-5 text-[#7F2487]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">My Activities</h2>
              <p className="text-xs text-gray-500">
                Your assigned activities and manhours tracking
              </p>
            </div>
          </div>
          {/* Total Hours Summary */}
          <div className="flex items-center gap-4 bg-white/80 rounded-lg px-4 py-2 border border-purple-100">
            <div className="text-center border-r border-gray-200 pr-4">
              <span className="text-[10px] text-gray-500 uppercase block">
                Planned
              </span>
              <strong className="text-blue-600 text-lg">
                {totalsHeader.plannedHours.toFixed(1)}h
              </strong>
            </div>
            <div className="text-center border-r border-gray-200 pr-4">
              <span className="text-[10px] text-gray-500 uppercase block">
                Actual
              </span>
              <strong className="text-green-600 text-lg">
                {totalsHeader.actualHours.toFixed(1)}h
              </strong>
            </div>
            <div className="text-center">
              <span className="text-[10px] text-gray-500 uppercase block">
                Remaining
              </span>
              <strong
                className={`text-lg ${remaining > 0 ? 'text-orange-600' : 'text-green-600'}`}
              >
                {remaining.toFixed(1)}h
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {myActivities.length === 0 ? (
          <div className="text-center py-12">
            <ClockIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">
              No activities assigned to you in this project
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Discipline Groups */}
            {Object.entries(groupedByDiscipline).map(([discipline, acts]) => {
              // Calculate discipline totals for current user from daily entries
              const disciplineTotals = acts.reduce(
                (acc, act) => {
                  const assignedUsers = act.assigned_users || [];
                  const myAssignment = assignedUsers.find((a) => {
                    const odUserId = typeof a === 'object' ? a.user_id : a;
                    return String(odUserId) === String(sessionUser?.id);
                  });
                  if (myAssignment && typeof myAssignment === 'object') {
                    acc.planned += parseFloat(myAssignment.planned_hours) || 0;
                    const dailyEntries = myAssignment.daily_entries || [];
                    acc.actual += dailyEntries.reduce(
                      (sum, e) => sum + (parseFloat(e.hours) || 0),
                      0
                    );
                  }
                  return acc;
                },
                { planned: 0, actual: 0 }
              );

              return (
                <div
                  key={discipline}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  {/* Discipline Header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="font-semibold text-gray-800 text-sm">
                      {discipline}{' '}
                      <span className="font-normal text-gray-400 text-xs">
                        ({acts.length})
                      </span>
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-blue-600 font-medium">
                        {disciplineTotals.planned.toFixed(1)}h plan
                      </span>
                      <span className="text-green-600 font-medium">
                        {disciplineTotals.actual.toFixed(1)}h actual
                      </span>
                    </div>
                  </div>

                  {/* Activities Table */}
                  <div style={{ overflow: 'visible' }}>
                    <table
                      className="w-full text-xs"
                      style={{ overflow: 'visible' }}
                    >
                      <thead>
                        <tr className="bg-gradient-to-r from-slate-50 to-slate-100">
                          <th
                            className="py-2.5 px-3"
                            style={{ width: '3%' }}
                          ></th>
                          <th
                            className="py-2.5 px-3"
                            style={{ width: '18%' }}
                          ></th>
                          <th className="py-2.5 px-3" style={{ width: '20%' }}>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-700 uppercase tracking-wider">
                              Description
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-2 text-center"
                            style={{ width: '8%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">
                              Date
                            </span>
                          </th>
                          <th
                            colSpan={2}
                            className="py-2.5 px-2 text-center"
                            style={{ width: '12%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 uppercase tracking-wider">
                              Hours
                            </span>
                          </th>
                          <th
                            colSpan={3}
                            className="py-2.5 px-2 text-center"
                            style={{ width: '18%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-purple-700 uppercase tracking-wider">
                              Quantity
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-2 text-center"
                            style={{ width: '8%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-700 uppercase tracking-wider">
                              Due
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-2 text-center"
                            style={{ width: '8%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                              Status
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-3 text-center"
                            style={{ width: '12%' }}
                          >
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                              Notes
                            </span>
                          </th>
                          <th
                            className="py-2.5 px-1"
                            style={{ width: '3%' }}
                          ></th>
                        </tr>
                        <tr className="border-b-2 border-slate-200 bg-white">
                          <th className="text-left py-2 px-3 font-semibold text-slate-500 text-[10px] uppercase tracking-wide">
                            #
                          </th>
                          <th className="text-left py-2 px-3 font-semibold text-slate-500 text-[10px] uppercase tracking-wide">
                            Activity
                          </th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600 text-[10px] uppercase bg-gray-50/50"></th>
                          <th className="text-center py-2 px-2 font-medium text-emerald-600 text-[10px] uppercase bg-emerald-50/50 rounded-t"></th>
                          <th className="text-center py-2 px-2 font-medium text-blue-600 text-[10px] uppercase bg-blue-50/50">
                            Plan
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-blue-600 text-[10px] uppercase bg-blue-50/50">
                            Actual
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-50/50">
                            Asgn
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-50/50">
                            Done
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-purple-600 text-[10px] uppercase bg-purple-100/50">
                            Bal
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-orange-600 text-[10px] uppercase bg-orange-50/50"></th>
                          <th className="text-center py-2 px-2 font-medium text-slate-500 text-[10px] uppercase bg-slate-50/50"></th>
                          <th className="text-left py-2 px-3 font-medium text-amber-600 text-[10px] uppercase bg-amber-50/50"></th>
                          <th className="py-2 px-1"></th>
                        </tr>
                      </thead>
                      <tbody style={{ overflow: 'visible' }}>
                        {acts.map((act, idx) => {
                          const assignedUsers = act.assigned_users || [];
                          const myAssignment = assignedUsers.find((a) => {
                            const odUserId =
                              typeof a === 'object' ? a.user_id : a;
                            return String(odUserId) === String(sessionUser?.id);
                          });

                          const qtyAssigned =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.qty_assigned || ''
                              : '';
                          const dailyEntries =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.daily_entries || []
                              : [];
                          const totalQtyDone = dailyEntries.reduce(
                            (sum, e) => sum + (parseFloat(e.qty_done) || 0),
                            0
                          );
                          const totalActualHrs = dailyEntries.reduce(
                            (sum, e) => sum + (parseFloat(e.hours) || 0),
                            0
                          );
                          const plannedHrs =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.planned_hours || ''
                              : '';
                          const myDescription =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.description || ''
                              : '';
                          const dueDate =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.due_date || ''
                              : '';
                          const status =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.status || 'Not Started'
                              : 'Not Started';
                          const remarks =
                            myAssignment && typeof myAssignment === 'object'
                              ? myAssignment.remarks || ''
                              : '';
                          const balancedQty =
                            (parseFloat(qtyAssigned) || 0) - totalQtyDone;

                          return (
                            <Fragment key={act.id}>
                              {/* Activity Row with Totals */}
                              <tr className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 hover:from-slate-100 hover:to-slate-100 transition-colors">
                                <td className="py-3 px-3">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-slate-600 font-semibold text-[10px]">
                                    {idx + 1}
                                  </span>
                                </td>
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-3">
                                    <span className="text-slate-800 font-semibold text-sm">
                                      {act.activity_name || act.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        addDailyEntry(act.id, sessionUser?.id)
                                      }
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors"
                                    >
                                      <span>+</span> Add Day
                                    </button>
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  <input
                                    type="text"
                                    value={myDescription}
                                    onChange={(e) =>
                                      updateUserManhours(
                                        act.id,
                                        sessionUser?.id,
                                        'description',
                                        e.target.value
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-gray-200 focus:border-gray-300 focus:outline-none transition-shadow"
                                    placeholder="Enter your description..."
                                  />
                                </td>
                                <td className="py-3 px-2 text-center">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    Total
                                  </span>
                                </td>
                                {/* Hours - Plan (Read-only) */}
                                <td className="py-3 px-2 text-center bg-blue-50/60">
                                  <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-blue-700 bg-blue-100 rounded-md">
                                    {plannedHrs || '–'}
                                  </span>
                                </td>
                                {/* Hours - Actual */}
                                <td className="py-3 px-2 text-center bg-blue-50/60">
                                  <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-md">
                                    {totalActualHrs.toFixed(1)}
                                  </span>
                                </td>
                                {/* Qty - Assigned (Read-only) */}
                                <td className="py-3 px-2 text-center bg-purple-50/60">
                                  <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-purple-700 bg-purple-100 rounded-md">
                                    {qtyAssigned || '–'}
                                  </span>
                                </td>
                                {/* Qty - Done */}
                                <td className="py-3 px-2 text-center bg-purple-50/60">
                                  <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold text-emerald-700 bg-emerald-100 rounded-md">
                                    {totalQtyDone || '0'}
                                  </span>
                                </td>
                                {/* Qty - Balance */}
                                <td className="py-3 px-2 text-center bg-purple-100/60">
                                  <span
                                    className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 text-xs font-bold rounded-md ${balancedQty > 0 ? 'text-orange-700 bg-orange-100' : 'text-emerald-700 bg-emerald-100'}`}
                                  >
                                    {qtyAssigned ? balancedQty : '–'}
                                  </span>
                                </td>
                                <td className="py-3 px-2">
                                  <input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) =>
                                      updateUserManhours(
                                        act.id,
                                        sessionUser?.id,
                                        'due_date',
                                        e.target.value
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-orange-200 focus:border-orange-300 focus:outline-none transition-shadow"
                                  />
                                </td>
                                <td className="py-3 px-2">
                                  <select
                                    value={status}
                                    onChange={(e) =>
                                      updateUserManhours(
                                        act.id,
                                        sessionUser?.id,
                                        'status',
                                        e.target.value
                                      )
                                    }
                                    className={`w-full px-2 py-1 text-xs font-medium rounded-md border focus:ring-2 focus:outline-none transition-shadow ${
                                      status === 'Completed'
                                        ? 'text-emerald-700 bg-emerald-50 border-emerald-200 focus:ring-emerald-200'
                                        : status === 'In Progress'
                                          ? 'text-blue-700 bg-blue-50 border-blue-200 focus:ring-blue-200'
                                          : status === 'On Hold'
                                            ? 'text-amber-700 bg-amber-50 border-amber-200 focus:ring-amber-200'
                                            : 'text-slate-600 bg-slate-50 border-slate-200 focus:ring-slate-200'
                                    }`}
                                  >
                                    <option value="Not Started">
                                      Not Started
                                    </option>
                                    <option value="In Progress">
                                      In Progress
                                    </option>
                                    <option value="Completed">Completed</option>
                                    <option value="On Hold">On Hold</option>
                                  </select>
                                </td>
                                <td className="py-3 px-3">
                                  <input
                                    type="text"
                                    value={remarks}
                                    onChange={(e) =>
                                      updateUserManhours(
                                        act.id,
                                        sessionUser?.id,
                                        'remarks',
                                        e.target.value
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded-md focus:ring-2 focus:ring-amber-200 focus:border-amber-300 focus:outline-none transition-shadow"
                                    placeholder="Add note..."
                                  />
                                </td>
                                <td className="py-3 px-1"></td>
                              </tr>

                              {/* Daily Entry Rows */}
                              {dailyEntries.map((entry, eIdx) => {
                                // Entry is locked if explicitly marked or from a previous day
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const entryDate = entry.date
                                  ? new Date(entry.date)
                                  : null;
                                if (entryDate) entryDate.setHours(0, 0, 0, 0);
                                const isLocked =
                                  entry.isLocked === true ||
                                  (entryDate && entryDate < today);

                                // Calculate remaining qty balance up to this entry
                                const doneUpToThisEntry = dailyEntries
                                  .slice(0, eIdx + 1)
                                  .reduce(
                                    (sum, e) =>
                                      sum + (parseFloat(e.qty_done) || 0),
                                    0
                                  );
                                const remainingQtyAfterThisEntry =
                                  (parseFloat(qtyAssigned) || 0) -
                                  doneUpToThisEntry;

                                // Calculate remaining hours balance up to this entry
                                const hoursUpToThisEntry = dailyEntries
                                  .slice(0, eIdx + 1)
                                  .reduce(
                                    (sum, e) =>
                                      sum + (parseFloat(e.hours) || 0),
                                    0
                                  );
                                const remainingHoursAfterThisEntry =
                                  (parseFloat(plannedHrs) || 0) -
                                  hoursUpToThisEntry;

                                return (
                                  <tr
                                    key={`${act.id}-day-${eIdx}`}
                                    className={`border-b border-slate-100 transition-colors ${isLocked ? 'bg-slate-50/50' : 'hover:bg-slate-50/80'}`}
                                  >
                                    <td className="py-2.5 px-3"></td>
                                    <td className="py-2.5 px-3">
                                      <div className="flex items-center gap-2 pl-4">
                                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                          Day {eIdx + 1}
                                        </span>
                                        {isLocked && (
                                          <span
                                            className="text-amber-500 text-[10px]"
                                            title="Entry locked"
                                          >
                                            🔒
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-2 text-center">
                                      <span className="inline-flex items-center px-2 py-0.5 text-[11px] text-slate-600 bg-emerald-50 rounded font-medium">
                                        {entry.date
                                          ? new Date(
                                              entry.date + 'T00:00:00'
                                            ).toLocaleDateString('en-GB', {
                                              day: '2-digit',
                                              month: 'short',
                                            })
                                          : '–'}
                                      </span>
                                    </td>
                                    {/* Hours - Plan (empty for daily rows) */}
                                    <td className="py-2.5 px-2 text-center bg-blue-50/20">
                                      <span className="text-slate-300">·</span>
                                    </td>
                                    {/* Hours - Actual */}
                                    <td className="py-2.5 px-2 text-center bg-blue-50/20">
                                      {isLocked ? (
                                        <span className="inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 rounded">
                                          {entry.hours || '–'}
                                        </span>
                                      ) : (
                                        <input
                                          type="number"
                                          value={entry.hours || ''}
                                          onChange={(e) =>
                                            updateDailyEntry(
                                              act.id,
                                              sessionUser?.id,
                                              eIdx,
                                              'hours',
                                              e.target.value
                                            )
                                          }
                                          className="w-12 px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-blue-300 focus:border-blue-300 focus:outline-none"
                                          placeholder="0"
                                          min="0"
                                          step="0.5"
                                        />
                                      )}
                                    </td>
                                    {/* Qty - Assigned (empty for daily rows) */}
                                    <td className="py-2.5 px-2 text-center bg-purple-50/20">
                                      <span className="text-slate-300">·</span>
                                    </td>
                                    {/* Qty - Done */}
                                    <td className="py-2.5 px-2 text-center bg-purple-50/20">
                                      {isLocked ? (
                                        <span className="inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 rounded">
                                          {entry.qty_done || '–'}
                                        </span>
                                      ) : (
                                        <input
                                          type="number"
                                          value={entry.qty_done || ''}
                                          onChange={(e) =>
                                            updateDailyEntry(
                                              act.id,
                                              sessionUser?.id,
                                              eIdx,
                                              'qty_done',
                                              e.target.value
                                            )
                                          }
                                          className="w-12 px-2 py-0.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-purple-300 focus:border-purple-300 focus:outline-none"
                                          placeholder="0"
                                          min="0"
                                        />
                                      )}
                                    </td>
                                    {/* Qty - Balance */}
                                    <td className="py-2.5 px-2 text-center bg-purple-100/20">
                                      <span
                                        className={`inline-flex items-center justify-center w-12 px-2 py-0.5 text-[11px] font-semibold rounded ${
                                          remainingQtyAfterThisEntry > 0
                                            ? 'text-orange-600 bg-orange-50'
                                            : remainingQtyAfterThisEntry === 0
                                              ? 'text-emerald-600 bg-emerald-50'
                                              : 'text-red-600 bg-red-50'
                                        }`}
                                      >
                                        {qtyAssigned
                                          ? remainingQtyAfterThisEntry
                                          : '–'}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-2"></td>
                                    <td className="py-2.5 px-2"></td>
                                    <td className="py-2.5 px-3">
                                      {isLocked ? (
                                        <span className="text-[11px] text-slate-500">
                                          {entry.remarks || '–'}
                                        </span>
                                      ) : (
                                        <input
                                          type="text"
                                          value={entry.remarks || ''}
                                          onChange={(e) =>
                                            updateDailyEntry(
                                              act.id,
                                              sessionUser?.id,
                                              eIdx,
                                              'remarks',
                                              e.target.value
                                            )
                                          }
                                          className="w-full px-2 py-0.5 text-[11px] text-slate-600 bg-white border border-slate-200 rounded focus:ring-1 focus:ring-amber-200 focus:border-amber-300 focus:outline-none"
                                          placeholder="Add note..."
                                        />
                                      )}
                                    </td>
                                    <td className="py-2.5 px-1 text-center">
                                      {!isLocked && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeDailyEntry(
                                              act.id,
                                              sessionUser?.id,
                                              eIdx
                                            )
                                          }
                                          className="w-5 h-5 inline-flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                          title="Remove"
                                        >
                                          <svg
                                            className="w-3.5 h-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M6 18L18 6M6 6l12 12"
                                            />
                                          </svg>
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}

                              {/* No entries message */}
                              {dailyEntries.length === 0 && (
                                <tr>
                                  <td className="py-4 px-3"></td>
                                  <td colSpan={10} className="py-4 px-3">
                                    <div className="flex items-center justify-center gap-2 text-slate-400">
                                      <svg
                                        className="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth={1.5}
                                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                                        />
                                      </svg>
                                      <span className="text-xs">
                                        No daily entries yet. Click &quot;+ Add
                                        Day&quot; to log your work.
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-1"></td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
