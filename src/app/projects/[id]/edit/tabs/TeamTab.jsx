import { DocumentIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export default function TeamTab({
  addActivityTeamMember,
  totalManhours = 0,
  totalCost = 0,
  teamMembers = [],
  updateActivityTeamMember,
  getProjectTeamForDropdown,
  functions = [],
  projectActivities = [],
  removeActivityTeamMember,
}) {
  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
        border: '1.5px solid rgba(139, 92, 246, 0.1)',
        boxShadow:
          '0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
      }}
    >
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{
          background:
            'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)',
          borderBottom: '1.5px solid rgba(139, 92, 246, 0.08)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-xl"
            style={{
              background:
                'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
            }}
          >
            <DocumentIcon className="h-4 w-4" style={{ color: '#8b5cf6' }} />
          </div>
          <div>
            <h2
              className="text-base font-bold"
              style={{
                color: '#0f172a',
                letterSpacing: '-0.01em',
              }}
            >
              Project Team
            </h2>
            <p className="text-xs font-medium" style={{ color: '#64748b' }}>
              Assign employees to activities with hours and costs
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={addActivityTeamMember}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition-all duration-300"
          style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            color: '#ffffff',
            boxShadow:
              '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow =
              '0 8px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow =
              '0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
          }}
        >
          <PlusIcon className="h-4 w-4" />
          Add Team Member
        </button>
      </div>
      <div className="px-6 py-6">
        {/* Enhanced Summary Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div
            className="p-4 rounded-xl"
            style={{
              background:
                'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%)',
              border: '1.5px solid rgba(59, 130, 246, 0.2)',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.08)',
            }}
          >
            <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>
              Total Manhours
            </p>
            <p className="text-xl font-bold" style={{ color: '#3b82f6' }}>
              {totalManhours.toFixed(2)}
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{
              background:
                'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(22, 163, 74, 0.05) 100%)',
              border: '1.5px solid rgba(34, 197, 94, 0.2)',
              boxShadow: '0 2px 8px rgba(34, 197, 94, 0.08)',
            }}
          >
            <p className="text-xs font-bold mb-1" style={{ color: '#64748b' }}>
              Total Cost
            </p>
            <p className="text-xl font-bold" style={{ color: '#22c55e' }}>
              {new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
              }).format(totalCost)}
            </p>
          </div>
        </div>

        {teamMembers.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background:
                  'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
                border: '2px solid rgba(139, 92, 246, 0.2)',
              }}
            >
              <DocumentIcon className="w-8 h-8" style={{ color: '#8b5cf6' }} />
            </div>
            <p
              className="text-sm font-semibold mb-2"
              style={{ color: '#0f172a' }}
            >
              No Team Members Yet
            </p>
            <p className="text-xs" style={{ color: '#64748b' }}>
              Click &quot;Add Team Member&quot; to start building your project
              team
            </p>
          </div>
        ) : (
          <div
            className="overflow-x-auto rounded-xl"
            style={{
              border: '1.5px solid rgba(139, 92, 246, 0.1)',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.02)',
            }}
          >
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(124, 58, 237, 0.03) 100%)',
                    borderBottom: '2px solid rgba(139, 92, 246, 0.15)',
                  }}
                >
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Name
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Discipline
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Activity
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Sub-Activity
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Required Hours
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Actual Hours
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Start Date
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    End Date
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Actual Date
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Manhours
                  </th>
                  <th
                    className="text-left py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Cost
                  </th>
                  <th
                    className="text-center py-3 px-4 font-bold"
                    style={{
                      color: '#0f172a',
                      letterSpacing: '0.01em',
                    }}
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="transition-all duration-200"
                    style={{
                      borderBottom: '1px solid rgba(139, 92, 246, 0.06)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        'linear-gradient(135deg, rgba(139, 92, 246, 0.03) 0%, rgba(124, 58, 237, 0.02) 100%)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td className="py-3 px-4">
                      <select
                        value={member.employee_id}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'employee_id',
                            e.target.value
                          )
                        }
                        className="w-full px-3 py-2 text-xs font-medium rounded-lg transition-all duration-300"
                        style={{
                          background: 'rgba(255, 255, 255, 0.95)',
                          border: '1.5px solid rgba(139, 92, 246, 0.15)',
                          color: '#0f172a',
                          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.02)',
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor = '#8b5cf6';
                          e.target.style.boxShadow =
                            '0 0 0 3px rgba(139, 92, 246, 0.1)';
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor =
                            'rgba(139, 92, 246, 0.15)';
                          e.target.style.boxShadow =
                            '0 1px 2px rgba(15, 23, 42, 0.02)';
                        }}
                      >
                        <option value="">Select Team Member</option>
                        {getProjectTeamForDropdown().map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}{' '}
                            {emp.project_role && `(${emp.project_role})`}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={member.discipline || ''}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'discipline',
                            e.target.value
                          )
                        }
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      >
                        <option value="">Select Discipline</option>
                        {functions.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.function_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={member.activity_id}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'activity_id',
                            e.target.value
                          )
                        }
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      >
                        <option value="">Select Activity</option>
                        {projectActivities
                          .filter(
                            (pa) =>
                              pa.type === 'activity' &&
                              (!member.discipline ||
                                String(pa.function_id) ===
                                  String(member.discipline))
                          )
                          .map((pa) => (
                            <option key={`${pa.id}-${pa.type}`} value={pa.id}>
                              {pa.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={member.sub_activity || ''}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'sub_activity',
                            e.target.value
                          )
                        }
                        className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      >
                        <option value="">Select Sub-Activity</option>
                        {projectActivities
                          .filter(
                            (pa) =>
                              pa.type === 'subactivity' &&
                              String(pa.activity_id) ===
                                String(member.activity_id)
                          )
                          .map((pa) => (
                            <option key={`${pa.id}-${pa.type}`} value={pa.id}>
                              {pa.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={member.required_hours}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'required_hours',
                            e.target.value
                          )
                        }
                        min="0"
                        step="0.1"
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={member.actual_hours}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'actual_hours',
                            e.target.value
                          )
                        }
                        min="0"
                        step="0.1"
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={member.planned_start_date || ''}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'planned_start_date',
                            e.target.value
                          )
                        }
                        className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={member.planned_end_date}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'planned_end_date',
                            e.target.value
                          )
                        }
                        className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={member.actual_completion_date}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'actual_completion_date',
                            e.target.value
                          )
                        }
                        className="w-32 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={member.manhours}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'manhours',
                            e.target.value
                          )
                        }
                        className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={member.cost}
                        onChange={(e) =>
                          updateActivityTeamMember(
                            member.id,
                            'cost',
                            e.target.value
                          )
                        }
                        min="0"
                        step="0.01"
                        className="w-24 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-[#7F2487]"
                      />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => removeActivityTeamMember(member.id)}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg transition-all duration-300"
                        style={{
                          background:
                            'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.08) 100%)',
                          color: '#ef4444',
                          border: '1.5px solid rgba(239, 68, 68, 0.2)',
                          boxShadow: '0 2px 4px rgba(239, 68, 68, 0.08)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'scale(1.05)';
                          e.currentTarget.style.background =
                            'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(220, 38, 38, 0.12) 100%)';
                          e.currentTarget.style.boxShadow =
                            '0 4px 8px rgba(239, 68, 68, 0.15)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'scale(1)';
                          e.currentTarget.style.background =
                            'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(220, 38, 38, 0.08) 100%)';
                          e.currentTarget.style.boxShadow =
                            '0 2px 4px rgba(239, 68, 68, 0.08)';
                        }}
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
