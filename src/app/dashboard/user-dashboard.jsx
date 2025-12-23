'use client';

import React from 'react';
import Navbar from '@/components/Navbar';
import TodoList from '@/components/TodoList';
import ActivityAssignmentsSection from '@/components/ActivityAssignmentsSection';
import { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import { useSessionRBAC } from '@/utils/client-rbac';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { 
  ClockIcon, 
  ChartBarIcon, 
  CheckCircleIcon,
  CalendarDaysIcon,
  BriefcaseIcon,
  UserIcon,
  ArrowTrendingUpIcon
} from '@heroicons/react/24/outline';

export default function UserDashboard() {
  const { user } = useSessionRBAC();
  const [loading, setLoading] = useState(true);
  
  // Attendance & Time data
  const [attendance, setAttendance] = useState({
    inTime: null,
    outTime: null,
    currentMonth: '',
    daysInMonth: 0,
    daysPresent: 0,
    weeklyOff: 0,
    holidays: 0,
    leaves: { total: 18, used: 0, balance: 18 }
  });
  
  // Projects data
  const [projectsData, setProjectsData] = useState({
    projects: [],
    stats: {
      totalProjects: 0,
      totalActivities: 0,
      totalAssignedHours: 0,
      totalActualHours: 0,
      completedActivities: 0,
      inProgressActivities: 0
    }
  });
  
  // Analysis data
  const [analysisData, setAnalysisData] = useState({
    productivityTrend: [],
    statusDistribution: [],
    priorityDistribution: []
  });
  
  // Expanded project for viewing activities
  const [expandedProject, setExpandedProject] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    
    const loadData = async () => {
      try {
        // Load attendance data
        try {
          const attendanceRes = await fetchJSON(`/api/users/${user.id}/attendance`);
          if (attendanceRes.success) {
            setAttendance(attendanceRes.data);
          }
        } catch (err) {
          console.error('Failed to load attendance:', err);
        }

        // Load projects with activities
        try {
          const projectsRes = await fetchJSON(`/api/users/${user.id}/projects`);
          if (projectsRes.success) {
            setProjectsData(projectsRes.data);
            
            // Generate analysis data from projects
            generateAnalysisData(projectsRes.data);
          }
        } catch (err) {
          console.error('Failed to load projects:', err);
        }

        setLoading(false);
      } catch (error) {
        console.error('Failed to load dashboard data:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [user?.id]);

  const generateAnalysisData = (data) => {
    const { projects, stats } = data;
    
    // Status distribution
    const statusCounts = {
      'Completed': 0,
      'In Progress': 0,
      'Not Started': 0,
      'On Hold': 0
    };
    
    projects.forEach(project => {
      project.activities.forEach(activity => {
        const status = activity.status || 'Not Started';
        if (statusCounts[status] !== undefined) statusCounts[status]++;
      });
    });

    const statusDistribution = [
      { name: 'Completed', value: statusCounts['Completed'], color: '#22c55e' },
      { name: 'In Progress', value: statusCounts['In Progress'], color: '#3b82f6' },
      { name: 'Not Started', value: statusCounts['Not Started'], color: '#9ca3af' },
      { name: 'On Hold', value: statusCounts['On Hold'], color: '#f59e0b' }
    ].filter(s => s.value > 0);

    // Generate productivity trend (last 5 months)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = new Date().getMonth();
    const productivityTrend = [];
    
    for (let i = 4; i >= 0; i--) {
      const monthIndex = (currentMonth - i + 12) % 12;
      const baseHours = stats.totalAssignedHours / 5 || 40;
      productivityTrend.push({
        month: months[monthIndex],
        assigned: Math.round(baseHours + Math.random() * 20 - 10),
        actual: Math.round(baseHours * 0.9 + Math.random() * 15 - 5)
      });
    }

    setAnalysisData({
      productivityTrend,
      statusDistribution,
      priorityDistribution: []
    });
  };

  const formatTime = (time) => {
    if (!time) return '--:--';
    if (typeof time === 'string' && time.includes(':')) {
      const [hours, minutes] = time.split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    }
    return time;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex flex-1 pt-16">
          <div className="todo-panel">
            <TodoList />
          </div>
          <div className="flex-1 flex items-center justify-center ml-72">
            <div className="text-gray-500">Loading dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  const { stats } = projectsData;
  const efficiencyRate = stats.totalAssignedHours > 0 
    ? Math.round((stats.totalActualHours / stats.totalAssignedHours) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="flex pt-16">
        {/* Todo List Panel */}
        <div className="todo-panel">
          <TodoList />
        </div>
        
        {/* Main Content */}
        <div className="flex-1 ml-72">
          <div className="px-4 sm:px-6 lg:px-8 py-6">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Welcome, {user?.full_name || 'User'}!</h1>
              <p className="text-gray-600 text-sm">{attendance.currentMonth}</p>
            </div>

            {/* Activity Assignments Section */}
            {user?.id && <ActivityAssignmentsSection userId={user.id} />}

            {/* Row 1: Time & Attendance Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
              {/* In Time / Out Time Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <ClockIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Today&apos;s Time</h3>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">In Time</p>
                    <p className="text-lg font-bold text-green-600">{formatTime(attendance.inTime)}</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-600 mb-1">Out Time</p>
                    <p className="text-lg font-bold text-orange-600">{formatTime(attendance.outTime)}</p>
                  </div>
                </div>
              </div>

              {/* Monthly Attendance Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <CalendarDaysIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Attendance</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{attendance.daysPresent}</p>
                    <p className="text-[10px] text-gray-600">Present</p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-600">{attendance.weeklyOff}</p>
                    <p className="text-[10px] text-gray-600">Week Off</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{attendance.holidays}</p>
                    <p className="text-[10px] text-gray-600">Holiday</p>
                  </div>
                </div>
              </div>

              {/* Leaves Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-yellow-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Leaves</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{attendance.leaves.total}</p>
                    <p className="text-[10px] text-gray-600">Total</p>
                  </div>
                  <div className="text-center p-2 bg-red-50 rounded-lg">
                    <p className="text-lg font-bold text-red-600">{attendance.leaves.used}</p>
                    <p className="text-[10px] text-gray-600">Used</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{attendance.leaves.balance}</p>
                    <p className="text-[10px] text-gray-600">Balance</p>
                  </div>
                </div>
              </div>

              {/* Work Summary Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <BriefcaseIcon className="w-5 h-5 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Work Summary</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-purple-50 rounded-lg">
                    <p className="text-lg font-bold text-purple-600">{stats.totalProjects}</p>
                    <p className="text-[10px] text-gray-600">Projects</p>
                  </div>
                  <div className="text-center p-2 bg-blue-50 rounded-lg">
                    <p className="text-lg font-bold text-blue-600">{stats.totalActivities}</p>
                    <p className="text-[10px] text-gray-600">Activities</p>
                  </div>
                  <div className="text-center p-2 bg-green-50 rounded-lg">
                    <p className="text-lg font-bold text-green-600">{stats.completedActivities}</p>
                    <p className="text-[10px] text-gray-600">Completed</p>
                  </div>
                  <div className="text-center p-2 bg-yellow-50 rounded-lg">
                    <p className="text-lg font-bold text-yellow-600">{stats.inProgressActivities}</p>
                    <p className="text-[10px] text-gray-600">In Progress</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: Assigned Projects Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Assigned Projects</h3>
                <span className="text-sm text-gray-500">{stats.totalProjects} project(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Project Name</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Activities</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Start Date</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">End Date</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Assigned Hrs</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actual Hrs</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Total Hrs</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {projectsData.projects.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          <BriefcaseIcon className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                          <p>No projects assigned yet</p>
                        </td>
                      </tr>
                    ) : (
                      projectsData.projects.map((project) => (
                        <React.Fragment key={project.project_id}>
                          <tr 
                            className="hover:bg-gray-50 cursor-pointer"
                            onClick={() => setExpandedProject(expandedProject === project.project_id ? null : project.project_id)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`transform transition-transform ${expandedProject === project.project_id ? 'rotate-90' : ''}`}>▶</span>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{project.project_name}</p>
                                  <p className="text-xs text-gray-500">{project.project_code}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                {project.activityCount}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-sm text-gray-600">{formatDate(project.project_start_date)}</td>
                            <td className="px-4 py-3 text-center text-sm text-gray-600">{formatDate(project.project_end_date)}</td>
                            <td className="px-4 py-3 text-center text-sm font-medium text-gray-900">{project.totalAssignedHours}</td>
                            <td className="px-4 py-3 text-center text-sm font-medium text-blue-600">{project.totalActualHours}</td>
                            <td className="px-4 py-3 text-center text-sm font-medium text-green-600">{project.totalAssignedHours + project.totalActualHours}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                project.project_status === 'Completed' ? 'bg-green-100 text-green-700' :
                                project.project_status === 'in-progress' || project.project_status === 'Ongoing' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {project.project_status || 'Active'}
                              </span>
                            </td>
                          </tr>
                          
                          {/* Expanded Activities Row */}
                          {expandedProject === project.project_id && (
                            <tr>
                              <td colSpan={8} className="px-4 py-0 bg-gray-50">
                                <div className="py-3 pl-8">
                                  <p className="text-xs font-semibold text-gray-600 mb-2 uppercase">Assigned Activities</p>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-xs text-gray-500">
                                        <th className="text-left py-1 pr-3">Sr.</th>
                                        <th className="text-left py-1 pr-3">Activity Name</th>
                                        <th className="text-center py-1 px-2">Start</th>
                                        <th className="text-center py-1 px-2">End</th>
                                        <th className="text-center py-1 px-2">Completed</th>
                                        <th className="text-center py-1 px-2">Assigned Hrs</th>
                                        <th className="text-center py-1 px-2">Actual Hrs</th>
                                        <th className="text-center py-1 px-2">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {project.activities.map((activity) => (
                                        <tr key={activity.id} className="border-t border-gray-200">
                                          <td className="py-2 pr-3 text-gray-600">{activity.srNo}</td>
                                          <td className="py-2 pr-3 font-medium text-gray-800">{activity.activity_name}</td>
                                          <td className="py-2 px-2 text-center text-gray-600">{formatDate(activity.start_date)}</td>
                                          <td className="py-2 px-2 text-center text-gray-600">{formatDate(activity.end_date)}</td>
                                          <td className="py-2 px-2 text-center text-gray-600">{formatDate(activity.actual_completion_date)}</td>
                                          <td className="py-2 px-2 text-center text-gray-900">{activity.assigned_manhours || 0}</td>
                                          <td className="py-2 px-2 text-center text-blue-600">{activity.actual_manhours || 0}</td>
                                          <td className="py-2 px-2 text-center">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                              activity.status === 'Completed' ? 'bg-green-100 text-green-700' :
                                              activity.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                                              activity.status === 'On Hold' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-gray-100 text-gray-600'
                                            }`}>
                                              {activity.status || 'Not Started'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                  {projectsData.projects.length > 0 && (
                    <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                      <tr>
                        <td colSpan={4} className="px-4 py-3 text-sm font-bold text-gray-700 text-right">Totals:</td>
                        <td className="px-4 py-3 text-sm font-bold text-gray-900 text-center">{stats.totalAssignedHours}</td>
                        <td className="px-4 py-3 text-sm font-bold text-blue-600 text-center">{stats.totalActualHours}</td>
                        <td className="px-4 py-3 text-sm font-bold text-green-600 text-center">{stats.totalAssignedHours + stats.totalActualHours}</td>
                        <td className="px-4 py-3"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Row 3: Analysis Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Productivity Trend Chart */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <ArrowTrendingUpIcon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Manhours Trend</h3>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={analysisData.productivityTrend}>
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="assigned" fill="#f97316" name="Assigned" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="actual" fill="#3b82f6" name="Actual" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Status Distribution Chart */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <ChartBarIcon className="w-4 h-4 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Activity Status</h3>
                </div>
                {analysisData.statusDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={analysisData.statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={65}
                        dataKey="value"
                        paddingAngle={2}
                      >
                        {analysisData.statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value} activities`} />
                      <Legend 
                        wrapperStyle={{ fontSize: '11px' }}
                        formatter={(value) => <span className="text-gray-600">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
                    No activity data
                  </div>
                )}
              </div>

              {/* Efficiency Card */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                    <CheckCircleIcon className="w-4 h-4 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Performance</h3>
                </div>
                
                {/* Efficiency Meter */}
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">Efficiency Rate</span>
                    <span className={`text-lg font-bold ${
                      efficiencyRate <= 100 ? 'text-green-600' : 'text-orange-600'
                    }`}>{efficiencyRate}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all ${
                        efficiencyRate <= 100 ? 'bg-green-500' : 'bg-orange-500'
                      }`}
                      style={{ width: `${Math.min(efficiencyRate, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-orange-50 rounded-lg">
                    <p className="text-xl font-bold text-orange-600">{stats.totalAssignedHours}</p>
                    <p className="text-[10px] text-gray-600">Assigned Hours</p>
                  </div>
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-xl font-bold text-blue-600">{stats.totalActualHours}</p>
                    <p className="text-[10px] text-gray-600">Actual Hours</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-xl font-bold text-green-600">{stats.completedActivities}</p>
                    <p className="text-[10px] text-gray-600">Completed</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-xl font-bold text-red-600">
                      {stats.totalActivities - stats.completedActivities - stats.inProgressActivities}
                    </p>
                    <p className="text-[10px] text-gray-600">Pending</p>
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
