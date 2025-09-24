'use client';

import Navbar from '@/components/Navbar';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  PlusIcon, 
  FolderIcon,
  EyeIcon,
  PencilIcon,
  TrashIcon,
  CalendarIcon,
  UserGroupIcon,
  CurrencyDollarIcon,
  ChartBarIcon
} from '@heroicons/react/24/outline';
import ManhoursCalculator from '@/components/ManhoursCalculator';
import PriceBreakupEditor from '@/components/PriceBreakupEditor';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('list');
  const [companies, setCompanies] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    company_id: '',
    client_name: '',
    project_manager: '',
    start_date: '',
    end_date: '',
    budget: '',
    manhours: 0,
    cost_breakup: [],
    status: 'planning',
    priority: 'medium',
    progress: 0,
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchProjects();
    fetchCompanies();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const result = await response.json();
      
      if (result.success) {
        setProjects(result.data);
      } else {
        console.error('Error fetching projects:', result.error);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const response = await fetch('/api/companies');
      const result = await response.json();
      
      if (result.success) {
        setCompanies(result.data);
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        setFormData({
          name: '',
          description: '',
          company_id: '',
          client_name: '',
          project_manager: '',
          start_date: '',
          end_date: '',
          budget: '',
          manhours: 0,
          cost_breakup: [],
          status: 'planning',
          priority: 'medium',
          progress: 0,
          notes: ''
        });
        setActiveTab('list');
        fetchProjects();
      } else {
        alert('Error creating project: ' + result.error);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('Error creating project');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this project?')) {
      try {
        const response = await fetch(`/api/projects?id=${id}`, {
          method: 'DELETE',
        });

        const result = await response.json();

        if (result.success) {
          fetchProjects();
        } else {
          alert('Error deleting project: ' + result.error);
        }
      } catch (error) {
        console.error('Error deleting project:', error);
        alert('Error deleting project');
      }
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning':
        return 'bg-yellow-100 text-yellow-800';
      case 'in-progress':
        return 'bg-blue-100 text-blue-800';
      case 'on-hold':
        return 'bg-orange-100 text-orange-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'text-red-600';
      case 'medium':
        return 'text-yellow-600';
      case 'low':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(amount);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-xl font-bold text-black">Projects</h1>
              <p className="text-sm text-black">Manage and track your client projects</p>
            </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('list')}
                className={`py-2 px-1 border-b-2 font-medium text-xs ${
                  activeTab === 'list'
                    ? 'border-accent-primary text-black'
                    : 'border-transparent text-black hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Projects List ({projects.length})
              </button>
              <button
                onClick={() => setActiveTab('create')}
                className={`py-2 px-1 border-b-2 font-medium text-xs ${
                  activeTab === 'create'
                    ? 'border-accent-primary text-black'
                    : 'border-transparent text-black hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Create Project
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="space-y-6">
            {activeTab === 'list' ? (
              <div className="space-y-6">
                {/* Action Bar */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => setActiveTab('create')}
                      className="bg-accent-primary hover:bg-accent-primary/90 text-white px-4 py-2 rounded-md inline-flex items-center space-x-2 transition-colors text-sm"
                    >
                      <PlusIcon className="h-4 w-4" />
                      <span>New Project</span>
                    </button>
                  </div>
                </div>

                {/* Projects Table */}
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  {loading ? (
                    <div className="p-6 text-center">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-accent-primary"></div>
                      <p className="mt-2 text-sm text-black">Loading projects...</p>
                    </div>
                  ) : projects.length === 0 ? (
                    <div className="p-6 text-center">
                      <FolderIcon className="mx-auto h-10 w-10 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-black">No projects found</h3>
                      <p className="mt-1 text-xs text-black">
                        Get started by creating a new project.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Project
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Client
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Timeline
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Estimated Cost
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Budget
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-black uppercase tracking-wider">
                              Progress
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-black uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {projects.map((project) => (
                            <tr key={project.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div>
                                  <div className="text-sm font-medium text-black">
                                    {project.name}
                                  </div>
                                  <div className="text-xs text-black max-w-xs truncate">
                                    {project.description}
                                  </div>
                                  <div className={`text-xs font-medium mt-1 ${getPriorityColor(project.priority)}`}>
                                    {project.priority.charAt(0).toUpperCase() + project.priority.slice(1)} Priority
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-black">
                                  {project.client_name}
                                </div>
                                <div className="text-xs text-black">
                                  PM: {project.project_manager || 'Not assigned'}
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="text-sm text-black">
                                  <div className="flex items-center">
                                    <CalendarIcon className="h-3 w-3 mr-1 text-gray-400" />
                                    {formatDate(project.start_date)}
                                  </div>
                                  {project.end_date && (
                                    <div className="text-xs text-black mt-1">
                                      to {formatDate(project.end_date)}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className={`px-2 py-1 inline-flex text-xs leading-4 font-semibold rounded-full ${getStatusColor(project.status)}`}>
                                  {project.status.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-black">
                                {(() => {
                                  try {
                                    if (project.cost_breakup) {
                                      const cb = typeof project.cost_breakup === 'string' ? JSON.parse(project.cost_breakup) : project.cost_breakup;
                                      const tot = cb.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
                                      return tot > 0 ? formatCurrency(tot) : '-';
                                    }
                                  } catch (e) {
                                    // ignore parse errors
                                  }
                                  return '-';
                                })()}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-sm text-black">
                                {formatCurrency(project.budget)}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="w-12 bg-gray-200 rounded-full h-1.5 mr-2">
                                    <div 
                                      className="bg-accent-primary h-1.5 rounded-full" 
                                      style={{width: `${project.progress || 0}%`}}
                                    ></div>
                                  </div>
                                  <span className="text-xs text-black">{project.progress || 0}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                                <div className="flex items-center justify-end space-x-1">
                                  <button 
                                    onClick={() => router.push(`/projects/${project.id}`)}
                                    className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                                    title="View Details"
                                  >
                                    <EyeIcon className="h-3 w-3" />
                                  </button>
                                  <button 
                                    onClick={() => router.push(`/projects/${project.id}/edit`)}
                                    className="p-1.5 text-gray-600 hover:text-gray-800 hover:bg-gray-50 rounded-full transition-colors"
                                    title="Edit Project"
                                  >
                                    <PencilIcon className="h-3 w-3" />
                                  </button>
                                  <button 
                                    onClick={() => handleDelete(project.id)}
                                    className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-full transition-colors"
                                    title="Delete Project"
                                  >
                                    <TrashIcon className="h-3 w-3" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Create Project Form */
              <div className="space-y-6">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Project Name */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Project Name *
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={formData.name}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          required
                        />
                      </div>

                      {/* Company */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Company
                        </label>
                        <select
                          name="company_id"
                          value={formData.company_id}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        >
                          <option value="">Select a company</option>
                          {companies.map((company) => (
                            <option key={company.id} value={company.id}>
                              {company.company_name || company.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Client Name */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Client Name *
                        </label>
                        <input
                          type="text"
                          name="client_name"
                          value={formData.client_name}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          required
                        />
                      </div>

                      {/* Project Manager */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Project Manager
                        </label>
                        <input
                          type="text"
                          name="project_manager"
                          value={formData.project_manager}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>

                      {/* Start Date */}
                      <div>
                        <label className="block text-sm font-medium text-black mb-2">
                          Start Date
                        </label>
                        <input
                          type="date"
                          name="start_date"
                          value={formData.start_date}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>

                      {/* End Date */}
                      <div>
                        <label className="block text-sm font-medium text-black mb-2">
                          End Date
                        </label>
                        <input
                          type="date"
                          name="end_date"
                          value={formData.end_date}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        />
                      </div>

                      {/* Budget */}
                      <div>
                        <label className="block text-sm font-medium text-black mb-2">
                          Budget (INR)
                        </label>
                        <input
                          type="number"
                          name="budget"
                          value={formData.budget}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          min="0"
                          step="0.01"
                        />
                      </div>

                      {/* Manhours */}
                      <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-black mb-2">Manhours</label>
                        <ManhoursCalculator value={formData.manhours} onChange={(val) => setFormData(prev => ({ ...prev, manhours: val }))} />
                      </div>

                      {/* Price Breakup */}
                      <div className="col-span-1 md:col-span-2">
                        <label className="block text-sm font-medium text-black mb-2">Price Breakup</label>
                        <PriceBreakupEditor value={formData.cost_breakup} onChange={(rows) => setFormData(prev => ({ ...prev, cost_breakup: rows }))} />
                      </div>

                      {/* Status */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Status
                        </label>
                        <select
                          name="status"
                          value={formData.status}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        >
                          <option value="active">Active</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="on_hold">On Hold</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      {/* Priority */}
                      <div>
                        <label className="block text-xs font-medium text-black mb-1">
                          Priority
                        </label>
                        <select
                          name="priority"
                          value={formData.priority}
                          onChange={handleInputChange}
                          className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>

                      {/* Progress */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Progress (%)
                        </label>
                        <input
                          type="number"
                          name="progress"
                          value={formData.progress}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                          min="0"
                          max="100"
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Description
                      </label>
                      <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleInputChange}
                        rows={3}
                        className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        placeholder="Describe the project details, objectives, and requirements..."
                      />
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="block text-xs font-medium text-black mb-1">
                        Notes
                      </label>
                      <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleInputChange}
                        rows={2}
                        className="w-full px-2 py-1.5 text-sm text-black border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                        placeholder="Any additional notes or comments..."
                      />
                    </div>

                    {/* Form Actions */}
                    <div className="sticky bottom-0 bg-white border-t border-gray-200 pt-4 mt-6 -mx-4 px-4">
                      <div className="flex justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => setActiveTab('list')}
                          className="px-6 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-6 py-2 text-sm bg-accent-primary text-white rounded-md hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-sm"
                        >
                          {submitting ? 'Creating...' : 'Create Project'}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
