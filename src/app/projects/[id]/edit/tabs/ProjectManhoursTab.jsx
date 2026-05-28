import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';

export default function ProjectManhoursTab({
  projectManhours,
  setProjectManhours,
  employeesLoading,
  employeesWithRates,
  fetchAttendanceHours,
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-4 py-4 bg-gradient-to-r from-purple-25 to-white border-b border-purple-100">
        <div className="flex items-center justify-between flex-wrap gap-3">
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
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-sm font-bold text-gray-900">
              Project Manhours
            </h2>
            <span className="text-[10px] text-gray-400 ml-2">
              • Track employee hours by month
            </span>
          </div>
          {/* Add Employee & Month Range */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setProjectManhours((prev) => [
                  ...prev,
                  {
                    id: Date.now(),
                    employee_id: '',
                    employee_name: '',
                    salary_type: '',
                    rate_company: '',
                    rate_accent: '',
                    monthly_hours: {},
                  },
                ]);
              }}
              className="text-xs px-3 py-1.5 bg-[#7F2487] text-white rounded hover:bg-purple-700 font-medium flex items-center gap-1"
            >
              <PlusIcon className="h-3 w-3" />
              Add Row
            </button>
          </div>
        </div>
        <div className="mt-2 text-[10px] text-gray-400">
          {employeesLoading
            ? 'Loading employees...'
            : `${employeesWithRates.length} employees available • ${projectManhours.length} added`}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-purple-50 to-gray-50">
                <th
                  className="text-left py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 sticky left-0 bg-purple-50 z-10"
                  style={{ minWidth: '140px' }}
                >
                  Employee
                </th>
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-50"
                  style={{ minWidth: '80px' }}
                >
                  Salary Type
                </th>
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50"
                  style={{ minWidth: '90px' }}
                >
                  RT/HR (Company)
                </th>
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50"
                  style={{ minWidth: '90px' }}
                >
                  RT/HR (Accent)
                </th>
                {[
                  'Jan',
                  'Feb',
                  'Mar',
                  'Apr',
                  'May',
                  'Jun',
                  'Jul',
                  'Aug',
                  'Sep',
                  'Oct',
                  'Nov',
                  'Dec',
                ].map((month) => (
                  <th
                    key={month}
                    className="text-center py-2 px-1 font-semibold text-gray-700 border-b border-gray-200 bg-amber-50/50"
                    style={{ minWidth: '50px' }}
                  >
                    {month}
                  </th>
                ))}
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-purple-100"
                  style={{ minWidth: '70px' }}
                >
                  Total Hrs
                </th>
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-100"
                  style={{ minWidth: '100px' }}
                >
                  Company Cost
                </th>
                <th
                  className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-100"
                  style={{ minWidth: '100px' }}
                >
                  Accent Cost
                </th>
                <th
                  className="text-center py-2 px-2 border-b border-gray-200"
                  style={{ width: '40px' }}
                ></th>
              </tr>
            </thead>
            <tbody>
              {projectManhours.map((empData, idx) => {
                const monthlyHours = empData.monthly_hours || {};
                const totalHrs = Object.values(monthlyHours).reduce(
                  (sum, h) => sum + (parseFloat(h) || 0),
                  0
                );
                const companyCost =
                  totalHrs * (parseFloat(empData.rate_company) || 0);
                const accentCost =
                  totalHrs * (parseFloat(empData.rate_accent) || 0);

                return (
                  <tr
                    key={empData.id}
                    className="border-b border-gray-100 hover:bg-gray-50/50"
                  >
                    <td className="py-2 px-2 font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-[10px]">
                          {idx + 1}.
                        </span>
                        <select
                          value={empData.employee_id || ''}
                          onChange={async (e) => {
                            const selectedEmp = employeesWithRates.find(
                              (emp) => emp.id === parseInt(e.target.value)
                            );
                            if (selectedEmp) {
                              const salaryType =
                                selectedEmp.salary_type || 'monthly';
                              let monthlyHoursData =
                                empData.monthly_hours || {};

                              // If monthly salary type, fetch attendance hours
                              if (salaryType === 'monthly') {
                                const attendanceHours =
                                  await fetchAttendanceHours(selectedEmp.id);
                                if (attendanceHours) {
                                  monthlyHoursData = attendanceHours;
                                }
                              }

                              setProjectManhours((prev) =>
                                prev.map((m) =>
                                  m.id === empData.id
                                    ? {
                                        ...m,
                                        employee_id: selectedEmp.id,
                                        employee_name: selectedEmp.name,
                                        salary_type: salaryType,
                                        rate_company: selectedEmp.rate || 0,
                                        rate_accent: m.rate_accent || '',
                                        monthly_hours: monthlyHoursData,
                                      }
                                    : m
                                )
                              );
                            }
                          }}
                          className="text-xs px-1 py-0.5 border border-gray-200 rounded focus:ring-1 focus:ring-purple-400 bg-transparent max-w-[120px] truncate"
                        >
                          <option value="">Select Employee</option>
                          {employeesWithRates.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center bg-green-50/30">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                          empData.salary_type === 'hourly'
                            ? 'bg-orange-100 text-orange-700'
                            : empData.salary_type === 'daily'
                              ? 'bg-green-100 text-green-700'
                              : empData.salary_type === 'custom'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {empData.salary_type || 'monthly'}
                      </span>
                    </td>
                    <td className="py-2 px-1 text-center bg-blue-50/30">
                      <input
                        type="number"
                        value={empData.rate_company || ''}
                        onChange={(e) =>
                          setProjectManhours((prev) =>
                            prev.map((m) =>
                              m.id === empData.id
                                ? {
                                    ...m,
                                    rate_company: e.target.value,
                                  }
                                : m
                            )
                          )
                        }
                        className="w-full text-[10px] px-1 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-blue-400"
                        placeholder="0"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="py-2 px-1 text-center bg-blue-50/30">
                      <input
                        type="number"
                        value={empData.rate_accent || ''}
                        onChange={(e) =>
                          setProjectManhours((prev) =>
                            prev.map((m) =>
                              m.id === empData.id
                                ? {
                                    ...m,
                                    rate_accent: e.target.value,
                                  }
                                : m
                            )
                          )
                        }
                        className="w-full text-[10px] px-1 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-blue-400"
                        placeholder="0"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    {[
                      'jan',
                      'feb',
                      'mar',
                      'apr',
                      'may',
                      'jun',
                      'jul',
                      'aug',
                      'sep',
                      'oct',
                      'nov',
                      'dec',
                    ].map((month) => (
                      <td
                        key={month}
                        className="py-2 px-0.5 text-center bg-amber-50/20"
                      >
                        <input
                          type="number"
                          value={monthlyHours[month] || ''}
                          onChange={(e) =>
                            setProjectManhours((prev) =>
                              prev.map((m) => {
                                if (m.id === empData.id) {
                                  return {
                                    ...m,
                                    monthly_hours: {
                                      ...m.monthly_hours,
                                      [month]: e.target.value,
                                    },
                                  };
                                }
                                return m;
                              })
                            )
                          }
                          className={`w-full text-[10px] px-0.5 py-0.5 border border-gray-200 rounded text-center focus:ring-1 focus:ring-amber-400 ${empData.salary_type === 'monthly' ? 'bg-blue-50/50' : ''}`}
                          placeholder="–"
                          min="0"
                          step="0.5"
                          title={
                            empData.salary_type === 'monthly'
                              ? 'Auto-fetched from Attendance (editable)'
                              : ''
                          }
                        />
                      </td>
                    ))}
                    <td className="py-2 px-2 text-center font-semibold text-purple-700 bg-purple-50/50">
                      {totalHrs.toFixed(1)}
                    </td>
                    <td className="py-2 px-2 text-center font-semibold text-green-700 bg-green-50/50">
                      ₹
                      {companyCost.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 px-2 text-center font-semibold text-blue-700 bg-blue-50/50">
                      ₹
                      {accentCost.toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 px-1 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setProjectManhours((prev) =>
                            prev.filter((m) => m.id !== empData.id)
                          )
                        }
                        className="text-red-400 hover:text-red-600"
                        title="Remove employee"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* Totals Row */}
              <tr className="bg-gradient-to-r from-purple-100 to-gray-100 font-semibold">
                <td className="py-2 px-2 text-gray-800 sticky left-0 bg-purple-100 z-10 border-r border-gray-200">
                  Grand Total
                </td>
                <td className="py-2 px-2 bg-green-100/50"></td>
                <td className="py-2 px-2 bg-blue-100/50"></td>
                <td className="py-2 px-2 bg-blue-100/50"></td>
                {[
                  'jan',
                  'feb',
                  'mar',
                  'apr',
                  'may',
                  'jun',
                  'jul',
                  'aug',
                  'sep',
                  'oct',
                  'nov',
                  'dec',
                ].map((month) => {
                  const monthTotal = projectManhours.reduce(
                    (sum, emp) =>
                      sum + (parseFloat(emp.monthly_hours?.[month]) || 0),
                    0
                  );
                  return (
                    <td
                      key={month}
                      className="py-2 px-1 text-center text-gray-700 bg-amber-100/50"
                    >
                      {monthTotal > 0 ? monthTotal.toFixed(1) : '–'}
                    </td>
                  );
                })}
                <td className="py-2 px-2 text-center text-purple-800 bg-purple-200/50">
                  {projectManhours
                    .reduce(
                      (sum, emp) =>
                        sum +
                        Object.values(emp.monthly_hours || {}).reduce(
                          (s, h) => s + (parseFloat(h) || 0),
                          0
                        ),
                      0
                    )
                    .toFixed(1)}
                </td>
                <td className="py-2 px-2 text-center text-green-800 bg-green-200/50">
                  ₹
                  {projectManhours
                    .reduce((sum, emp) => {
                      const hrs = Object.values(emp.monthly_hours || {}).reduce(
                        (s, h) => s + (parseFloat(h) || 0),
                        0
                      );
                      return sum + hrs * (parseFloat(emp.rate_company) || 0);
                    }, 0)
                    .toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                </td>
                <td className="py-2 px-2 text-center text-blue-800 bg-blue-200/50">
                  ₹
                  {projectManhours
                    .reduce((sum, emp) => {
                      const hrs = Object.values(emp.monthly_hours || {}).reduce(
                        (s, h) => s + (parseFloat(h) || 0),
                        0
                      );
                      return sum + hrs * (parseFloat(emp.rate_accent) || 0);
                    }, 0)
                    .toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                </td>
                <td className="py-2 px-1"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
