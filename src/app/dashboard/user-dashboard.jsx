'use client';

import Navbar from '@/components/Navbar';
import TodoList from '@/components/TodoList';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { useSessionRBAC } from '@/utils/client-rbac';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { 
  ClockIcon, 
  ChartBarIcon, 
  CheckCircleIcon, 
  ExclamationCircleIcon 
} from '@heroicons/react/24/outline';

export default function UserDashboard() {
  const { user } = useSessionRBAC();
  const [activities, setActivities] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeLog] = useState({
    monthDay: 31,
    present: 26,
    absent: 4,
    weekOff: 6,
    late: 2,
    leave: 4,
    balLeave: 12
  });

  useEffect(() => {
    if (!user?.id) return;
    
    const loadData = async () => {
      try {
        // Load user activities
        const activitiesRes = await fetchJSON(`/api/users/${user.id}/activities`);
        if (activitiesRes.success) {
          const userActivities = activitiesRes.data || [];
          setActivities(userActivities);
          
          // Get current project from first activity
          if (userActivities.length > 0 && userActivities[0].project_id) {
            try {
              const projectRes = await fetchJSON(`/api/projects/${userActivities[0].project_id}`);
              if (projectRes.success) {
                setCurrentProject(projectRes.data);
              }
            } catch (err) {
              console.error('Failed to load project:', err);
            }
          }
        }

        // Generate manhours data based on activities
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonth = new Date().getMonth();
        const recentMonths = [];
        for (let i = 4; i >= 0; i--) {
          const monthIndex = (currentMonth - i + 12) % 12;
          recentMonths.push(months[monthIndex]);
        }

        const manhoursData = recentMonths.map(month => ({
          month,
          planned: Math.floor(Math.random() * 50) + 100,
          actual: Math.floor(Math.random() * 50) + 90
        }));

        setProjectData({
          manhours: manhoursData,
          status: [
            { name: 'On Track', value: 60, color: '#4ade80' },
            { name: 'Delayed', value: 20, color: '#fbbf24' },
            { name: 'Critical', value: 20, color: '#ef4444' }
          ]
        });

        setLoading(false);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [user?.id]);

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex flex-1 pt-16">
          <div className="todo-panel">
            <TodoList />
          </div>
          <div className="flex-1 flex items-center justify-center ml-72">
            <div className="text-gray-500">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  const totalHoursAllocated = activities.reduce((sum, act) => sum + (parseFloat(act.estimated_hours) || 0), 0);
  const totalHoursUsed = activities.reduce((sum, act) => sum + (parseFloat(act.actual_hours) || 0), 0);
  const totalHoursRemaining = totalHoursAllocated - totalHoursUsed;

  // Calculate stats like admin dashboard
  const completedActivities = activities.filter(a => a.status === 'Completed').length;
  const inProgressActivities = activities.filter(a => a.status === 'In Progress').length;
  const overdueActivities = activities.filter(a => a.due_date && new Date(a.due_date) < new Date() && a.status !== 'Completed').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="flex pt-16">
        {/* Todo List Panel - sticks to sidebar */}
        <div className="todo-panel">
          <TodoList />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 ml-72">
          <div className="px-4 sm:px-6 lg:px-8 py-8">
            {/* Welcome Section */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-900">Welcome back, {user?.full_name || 'User'}!</h1>
              <p className="text-gray-600 mt-1">Here&apos;s your activity dashboard</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Total Activities */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Activities</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{activities.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <ChartBarIcon className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          {/* In Progress */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">In Progress</p>
                <p className="text-3xl font-bold text-yellow-600 mt-2">{inProgressActivities}</p>
              </div>
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <ClockIcon className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>

          {/* Completed */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-3xl font-bold text-green-600 mt-2">{completedActivities}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircleIcon className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          {/* Overdue */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Overdue</p>
                <p className="text-3xl font-bold text-red-600 mt-2">{overdueActivities}</p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <ExclamationCircleIcon className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
              {/* Left Column - Charts and Time Log */}
              <div className="space-y-6">
            
                {/* Current Project Card */}
                {currentProject && (
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Project</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-600">Project Name</p>
                    <p className="text-base font-medium text-gray-900">{currentProject.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Project Code</p>
                    <p className="text-base font-medium text-gray-900">{currentProject.project_code || currentProject.project_id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <p className="text-base font-medium text-gray-900">{currentProject.status || 'Active'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Time Log Card */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Time Log</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">{timeLog.present}</p>
                  <p className="text-xs text-gray-600 mt-1">Present Days</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-600">{timeLog.monthDay}</p>
                  <p className="text-xs text-gray-600 mt-1">Month Days</p>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <p className="text-2xl font-bold text-red-600">{timeLog.absent}</p>
                  <p className="text-xs text-gray-600 mt-1">Absent</p>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <p className="text-2xl font-bold text-purple-600">{timeLog.weekOff}</p>
                  <p className="text-xs text-gray-600 mt-1">Week Off</p>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded-lg">
                  <p className="text-2xl font-bold text-yellow-600">{timeLog.late}</p>
                  <p className="text-xs text-gray-600 mt-1">Late</p>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <p className="text-2xl font-bold text-orange-600">{timeLog.leave}</p>
                  <p className="text-xs text-gray-600 mt-1">Leave Taken</p>
                </div>
                <div className="col-span-2 text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">{timeLog.balLeave}</p>
                  <p className="text-xs text-gray-600 mt-1">Balance Leave</p>
                </div>
              </div>
            </div>

            {/* Manhours Chart */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Planned vs Actual Manhours</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={projectData?.manhours || []}>
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="planned" fill="#fb923c" name="Planned" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="actual" fill="#60a5fa" name="Actual" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Project Status Chart */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Status Summary</h3>
              
              {/* Status Breakdown Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {(projectData?.status || []).map((status, idx) => (
                  <div key={idx} className="text-center p-2 rounded-lg border border-gray-200" style={{ backgroundColor: `${status.color}15` }}>
                    <p className="text-lg font-bold" style={{ color: status.color }}>{status.value}%</p>
                    <p className="text-xs text-gray-600 mt-0.5">{status.name}</p>
                  </div>
                ))}
              </div>

              {/* Enhanced Donut Chart */}
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={projectData?.status || []}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    dataKey="value"
                    paddingAngle={2}
                    label={({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
                      const RADIAN = Math.PI / 180;
                      const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                      const x = cx + radius * Math.cos(-midAngle * RADIAN);
                      const y = cy + radius * Math.sin(-midAngle * RADIAN);
                      return (
                        <text 
                          x={x} 
                          y={y} 
                          fill="white" 
                          textAnchor={x > cx ? 'start' : 'end'} 
                          dominantBaseline="central"
                          className="font-bold text-sm"
                        >
                          {`${value}%`}
                        </text>
                      );
                    }}
                  >
                    {(projectData?.status || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="white" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value) => `${value}%`}
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)', 
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      padding: '8px 12px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Summary Text */}
              <div className="mt-3 pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-600 text-center">
                  Overall project health and status distribution
                </p>
              </div>
            </div>
          </div>

          {/* Right Column - Activities Table (2 columns wide) */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">My Activities</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Activity</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Project</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Hours Allocated</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Hours Used</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Due Date</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Priority</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {activities.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center">
                            <ChartBarIcon className="w-12 h-12 text-gray-400 mb-2" />
                            <p>No activities assigned yet</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      activities.map((activity, index) => {
                        const isOverdue = activity.due_date && new Date(activity.due_date) < new Date() && activity.status !== 'Completed';
                        return (
                          <tr key={activity.id} className={isOverdue ? 'bg-red-50' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-4 py-3 text-sm text-gray-900">{activity.activity_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{activity.project_name || 'N/A'}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-center">{activity.estimated_hours || 0}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-center">{activity.actual_hours || 0}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-center">
                              {activity.due_date ? new Date(activity.due_date).toLocaleDateString('en-GB') : '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                activity.priority === 'URGENT' ? 'bg-red-100 text-red-800' :
                                activity.priority === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                                activity.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-green-100 text-green-800'
                              }`}>
                                {activity.priority || 'LOW'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                activity.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                activity.status === 'In Progress' ? 'bg-blue-100 text-blue-800' :
                                activity.status === 'On Hold' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {activity.status || 'Not Started'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {activities.length > 0 && (
                    <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                      <tr>
                        <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-900 text-right">Total Hours:</td>
                        <td className="px-4 py-3 text-sm font-bold text-gray-900 text-center">{totalHoursAllocated}</td>
                        <td className="px-4 py-3 text-sm font-bold text-gray-900 text-center">{totalHoursUsed}</td>
                        <td colSpan={3} className="px-4 py-3 text-sm text-gray-600 text-center">
                          Remaining: {totalHoursRemaining} hrs
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
