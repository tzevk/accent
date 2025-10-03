'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  PencilIcon,
  PlusIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { format, differenceInCalendarDays, parseISO } from 'date-fns';

const PROJECT_TABS = [
  { id: 'basic', label: 'Basic Info' },
  { id: 'scope', label: 'Scope of Work' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'activities', label: 'Activities' },
  { id: 'team', label: 'Team' }
];

const STATUS_OPTIONS = ['planning', 'in-progress', 'on-hold', 'completed', 'cancelled'];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DISCIPLINES = [
  'Process Engineering',
  'Civil / Structural',
  'Mechanical - Static',
  'Mechanical - Rotating',
  'Piping',
  'Firefighting',
  'HVAC',
  'Electrical',
  'Instrumentation',
  'Project Management'
];
const ACTIVITY_STATUS = ['Not Started', 'In Progress', 'Completed', 'On Hold'];
const BOOLEAN_OPTIONS = ['No', 'Yes'];

const defaultProjectForm = {
  sr_no: '',
  year: '',
  company_name: '',
  city: '',
  project_mode: '',
  project_no: '',
  start_date: '',
  end_date: '',
  project_description: '',
  completion_date: '',
  project_status: 'planning',
  execution_mode: '',
  outsourced_company: '',
  billing_status: '',
  remarks: '',
  accent_invoice_no: '',
  accent_invoice_date: '',
  accent_outsource_bill_no: '',
  accent_outsource_bill_date: '',
  scope_client_responsibilities: '',
  scope_change_log: '',
  scope_quality_notes: '',
  name: '',
  client_name: '',
  project_manager: '',
  type: '',
  progress: 0,
  assigned_to: ''
};

const buildActivityForm = (projectCode = '', projectName = '', start = '', end = '') => ({
  activityCode: '',
  projectReference: projectCode || projectName ? `${projectCode}${projectName ? ` — ${projectName}` : ''}` : '',
  discipline: '',
  activityName: '',
  description: '',
  startDate: start,
  endDate: end,
  duration: '',
  priority: 'Medium',
  dependencies: '',
  deliverables: '',
  assignedTo: '',
  department: '',
  reviewer: '',
  manhoursPlanned: '',
  manhoursConsumed: '',
  status: 'Not Started',
  completion: '',
  milestoneLinked: 'No',
  remarks: '',
  estimatedCost: '',
  actualCost: '',
  resourceRequirement: ''
});

const normaliseStatus = (value) => {
  if (!value) return 'planning';
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
};

export default function EditProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [projectMeta, setProjectMeta] = useState(null);

  const [activeTab, setActiveTab] = useState('basic');
  const [activityForm, setActivityForm] = useState(buildActivityForm());
  const [showActivityTips, setShowActivityTips] = useState(true);

  const setProjectField = (name, value) => {
    setProjectForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  useEffect(() => {
    if (!projectId) return;

    const loadProject = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}`);
        const result = await response.json();

        if (result.success && result.data) {
          const data = result.data;
          setProjectForm((prev) => ({
            ...prev,
            name: data.name || '',
            client_name: data.client_name || '',
            company_name: data.company_name || data.client_name || '',
            project_manager: data.project_manager || '',
            type: data.type || '',
            project_mode: data.type || '',
            project_no: data.project_id || '',
            start_date: data.start_date ? data.start_date.slice(0, 10) : '',
            end_date: data.end_date ? data.end_date.slice(0, 10) : '',
            project_description: data.description || '',
            completion_date: data.end_date ? data.end_date.slice(0, 10) : '',
            project_status: normaliseStatus(data.status),
            progress: data.progress ?? 0,
            assigned_to: data.assigned_to || '',
            billing_status: data.billing_status || '',
            remarks: data.notes || ''
          }));
          setProjectMeta({
            projectCode: data.project_id || `PRJ-${projectId}`,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
            startDate: data.start_date ? data.start_date.slice(0, 10) : '',
            endDate: data.end_date ? data.end_date.slice(0, 10) : ''
          });
          setActivityForm(
            buildActivityForm(
              data.project_id || `PRJ-${projectId}`,
              data.name || '',
              data.start_date ? data.start_date.slice(0, 10) : '',
              data.end_date ? data.end_date.slice(0, 10) : ''
            )
          );
        }
      } catch (error) {
        console.error('Failed to load project', error);
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (activityForm.startDate && activityForm.endDate) {
      try {
        const start = parseISO(activityForm.startDate);
        const end = parseISO(activityForm.endDate);
        const days = differenceInCalendarDays(end, start);
        if (!Number.isNaN(days) && days >= 0) {
          const newDuration = `${days + 1} day${days === 0 ? '' : 's'}`;
          if (newDuration !== activityForm.duration) {
            setActivityForm((prev) => ({
              ...prev,
              duration: newDuration
            }));
          }
        }
      } catch (err) {
        // ignore parse issues
      }
    }
  }, [activityForm.startDate, activityForm.endDate, activityForm.duration]);

  const handleProjectFieldChange = (event) => {
    const { name, value } = event.target;
    setProjectField(name, value);
  };

  const handleSaveProject = async (event) => {
    event.preventDefault();
    if (!projectId) return;

    setSaving(true);
    try {
      const payload = {
        name: projectForm.name,
        client_name: projectForm.client_name,
        project_manager: projectForm.project_manager,
        type: projectForm.type || projectForm.project_mode || null,
        start_date: projectForm.start_date || null,
        end_date: projectForm.end_date || null,
        status: projectForm.project_status,
        progress: Number(projectForm.progress) || 0,
        assigned_to: projectForm.assigned_to || null,
        description: projectForm.project_description || null,
        notes: projectForm.remarks || null,
        billing_status: projectForm.billing_status || null
      };

      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error('Failed to save project', error);
    } finally {
      setSaving(false);
    }
  };

  const handleActivityFieldChange = (field, value) => {
    setActivityForm((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleActivitySubmit = (event) => {
    event.preventDefault();
    // UI only – placeholder for future integration
  };

  const handleGoBack = () => {
    router.push('/projects?view=list');
  };

  const handleAddActivityRedirect = () => {
    router.push(`/projects/${projectId}/activities`);
  };

  const formattedMeta = useMemo(() => {
    if (!projectMeta) return null;
    return {
      code: projectMeta.projectCode,
      created: projectMeta.createdAt ? format(new Date(projectMeta.createdAt), 'dd MMM yyyy') : '—',
      updated: projectMeta.updatedAt ? format(new Date(projectMeta.updatedAt), 'dd MMM yyyy') : '—',
      startDate: projectMeta.startDate,
      endDate: projectMeta.endDate
    };
  }, [projectMeta]);

  const renderBasicInfoTab = () => (
    <div className="space-y-6">
      {formattedMeta && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-600 flex flex-wrap gap-4">
          <span>Project Code: <strong className="text-black">{formattedMeta.code}</strong></span>
          <span>Created: <strong className="text-black">{formattedMeta.created}</strong></span>
          <span>Last Updated: <strong className="text-black">{formattedMeta.updated}</strong></span>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <PencilIcon className="h-5 w-5 text-accent-primary" />
          <div>
            <h2 className="text-sm font-semibold text-black">Register Project Snapshot</h2>
            <p className="text-xs text-gray-500">Keep CRM data aligned with execution status and finance checkpoints.</p>
          </div>
        </div>
        <form onSubmit={handleSaveProject} className="px-5 py-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Sr. No.</label>
              <input
                type="text"
                name="sr_no"
                value={projectForm.sr_no}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Year</label>
              <input
                type="text"
                name="year"
                value={projectForm.year}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Company Name</label>
              <input
                type="text"
                name="company_name"
                value={projectForm.company_name}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">City</label>
              <input
                type="text"
                name="city"
                value={projectForm.city}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Mode</label>
              <input
                type="text"
                name="project_mode"
                value={projectForm.project_mode}
                onChange={handleProjectFieldChange}
                placeholder="EPC / Consultancy / Client Office"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project No.</label>
              <input
                type="text"
                name="project_no"
                value={projectForm.project_no}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Start Date</label>
              <input
                type="date"
                name="start_date"
                value={projectForm.start_date}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">End Date</label>
              <input
                type="date"
                name="end_date"
                value={projectForm.end_date}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-black mb-1">Project Description</label>
            <textarea
              name="project_description"
              value={projectForm.project_description}
              onChange={handleProjectFieldChange}
              rows={3}
              placeholder="Brief scope, deliverables, client expectations"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Date of Completion</label>
              <input
                type="date"
                name="completion_date"
                value={projectForm.completion_date}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Status</label>
              <select
                name="project_status"
                value={projectForm.project_status}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status.replace('-', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Inhouse / Outsource / Client's Office</label>
              <input
                type="text"
                name="execution_mode"
                value={projectForm.execution_mode}
                onChange={handleProjectFieldChange}
                placeholder="Inhouse / Outsource / Client"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Outsourced Company</label>
              <input
                type="text"
                name="outsourced_company"
                value={projectForm.outsourced_company}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Billing Status</label>
              <input
                type="text"
                name="billing_status"
                value={projectForm.billing_status}
                onChange={handleProjectFieldChange}
                placeholder="Pending / Raised / Paid"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Accent Invoice No</label>
              <input
                type="text"
                name="accent_invoice_no"
                value={projectForm.accent_invoice_no}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Accent Invoice Date</label>
              <input
                type="date"
                name="accent_invoice_date"
                value={projectForm.accent_invoice_date}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus-ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Accent - Outsource Bill No</label>
              <input
                type="text"
                name="accent_outsource_bill_no"
                value={projectForm.accent_outsource_bill_no}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Accent - Outsource Bill Date</label>
              <input
                type="date"
                name="accent_outsource_bill_date"
                value={projectForm.accent_outsource_bill_date}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Remarks</label>
              <input
                type="text"
                name="remarks"
                value={projectForm.remarks}
                onChange={handleProjectFieldChange}
                placeholder="Internal notes, escalations"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Name</label>
              <input
                type="text"
                name="name"
                value={projectForm.name}
                onChange={handleProjectFieldChange}
                required
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Client Name</label>
              <input
                type="text"
                name="client_name"
                value={projectForm.client_name}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Manager</label>
              <input
                type="text"
                name="project_manager"
                value={projectForm.project_manager}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Type</label>
              <input
                type="text"
                name="type"
                value={projectForm.type}
                onChange={handleProjectFieldChange}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Progress (%)</label>
              <input
                type="number"
                name="progress"
                value={projectForm.progress}
                onChange={handleProjectFieldChange}
                min="0"
                max="100"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Assigned To</label>
              <input
                type="text"
                name="assigned_to"
                value={projectForm.assigned_to}
                onChange={handleProjectFieldChange}
                placeholder="Internal owner or lead"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleGoBack}
              className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-60 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {saving ? 'Saving...' : 'Save Basic Info'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderActivityForm = () => (
    <form onSubmit={handleActivitySubmit} className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <PlusIcon className="h-5 w-5 text-accent-primary" />
          <div>
            <h2 className="text-sm font-semibold text-black">General Activity Information</h2>
            <p className="text-xs text-gray-500">Capture planning metadata for the activity lifecycle.</p>
          </div>
        </div>
        <div className="px-5 py-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Activity ID / Code</label>
              <input
                type="text"
                value={activityForm.activityCode}
                onChange={(event) => handleActivityFieldChange('activityCode', event.target.value)}
                placeholder="e.g., ACT-001"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Project Reference</label>
              <input
                type="text"
                value={activityForm.projectReference}
                onChange={(event) => handleActivityFieldChange('projectReference', event.target.value)}
                placeholder="Linked project reference"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Discipline / Category</label>
              <select
                value={activityForm.discipline}
                onChange={(event) => handleActivityFieldChange('discipline', event.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              >
                <option value="">Select discipline</option>
                {DISCIPLINES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Activity Name</label>
              <input
                type="text"
                value={activityForm.activityName}
                onChange={(event) => handleActivityFieldChange('activityName', event.target.value)}
                placeholder="e.g., Piping Isometric Design"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Description</label>
            <textarea
              value={activityForm.description}
              onChange={(event) => handleActivityFieldChange('description', event.target.value)}
              rows={3}
              placeholder="Briefly explain scope of the activity"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Start Date</label>
              <input
                type="date"
                value={activityForm.startDate}
                onChange={(event) => handleActivityFieldChange('startDate', event.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">End Date</label>
              <input
                type="date"
                value={activityForm.endDate}
                onChange={(event) => handleActivityFieldChange('endDate', event.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Duration</label>
              <input
                type="text"
                value={activityForm.duration}
                onChange={(event) => handleActivityFieldChange('duration', event.target.value)}
                placeholder="Auto-calculated or manual entry"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Priority / Criticality</label>
              <select
                value={activityForm.priority}
                onChange={(event) => handleActivityFieldChange('priority', event.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Dependencies</label>
              <input
                type="text"
                value={activityForm.dependencies}
                onChange={(event) => handleActivityFieldChange('dependencies', event.target.value)}
                placeholder="Link predecessor / successor activities"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Deliverables</label>
              <input
                type="text"
                value={activityForm.deliverables}
                onChange={(event) => handleActivityFieldChange('deliverables', event.target.value)}
                placeholder="Drawings, BOQs, reports"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-black">Assignment & Ownership</h2>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Assigned To (Employee)</label>
            <input
              type="text"
              value={activityForm.assignedTo}
              onChange={(event) => handleActivityFieldChange('assignedTo', event.target.value)}
              placeholder="Select from employee master"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Department</label>
            <input
              type="text"
              value={activityForm.department}
              onChange={(event) => handleActivityFieldChange('department', event.target.value)}
              placeholder="e.g., Mechanical"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Reviewer / Approver</label>
            <input
              type="text"
              value={activityForm.reviewer}
              onChange={(event) => handleActivityFieldChange('reviewer', event.target.value)}
              placeholder="QA/QC or Project Manager"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-black mb-1">Manhours Planned</label>
              <input
                type="number"
                value={activityForm.manhoursPlanned}
                onChange={(event) => handleActivityFieldChange('manhoursPlanned', event.target.value)}
                min="0"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black mb-1">Manhours Consumed</label>
              <input
                type="number"
                value={activityForm.manhoursConsumed}
                onChange={(event) => handleActivityFieldChange('manhoursConsumed', event.target.value)}
                min="0"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-black">Progress & Tracking</h2>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Status</label>
            <select
              value={activityForm.status}
              onChange={(event) => handleActivityFieldChange('status', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              {ACTIVITY_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">% Completion</label>
            <input
              type="number"
              value={activityForm.completion}
              onChange={(event) => handleActivityFieldChange('completion', event.target.value)}
              min="0"
              max="100"
              placeholder="0 - 100"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Milestone Linked</label>
            <select
              value={activityForm.milestoneLinked}
              onChange={(event) => handleActivityFieldChange('milestoneLinked', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            >
              {BOOLEAN_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Remarks / Notes</label>
            <textarea
              value={activityForm.remarks}
              onChange={(event) => handleActivityFieldChange('remarks', event.target.value)}
              rows={3}
              placeholder="Progress updates, blockers, clarifications"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-black">Cost & Resource Tracking</h2>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-black mb-1">Estimated Cost</label>
            <input
              type="number"
              value={activityForm.estimatedCost}
              onChange={(event) => handleActivityFieldChange('estimatedCost', event.target.value)}
              min="0"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Actual Cost</label>
            <input
              type="number"
              value={activityForm.actualCost}
              onChange={(event) => handleActivityFieldChange('actualCost', event.target.value)}
              min="0"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-black mb-1">Resource Requirement</label>
            <input
              type="text"
              value={activityForm.resourceRequirement}
              onChange={(event) => handleActivityFieldChange('resourceRequirement', event.target.value)}
              placeholder="Materials, equipment, tools"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() =>
            setActivityForm(
              buildActivityForm(
                formattedMeta?.code || `PRJ-${projectId}`,
                projectForm.name,
                projectForm.start_date,
                projectForm.end_date
              )
            )
          }
          className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white opacity-70 cursor-not-allowed"
        >
          Save Activity (Coming Soon)
        </button>
      </div>
    </form>
  );

const renderScopeTab = () => (
  <div className="space-y-6">
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-black">Scope Narrative</h2>
      <p className="text-xs text-gray-500 mb-4">Capture contractual deliverables, exclusions, and client expectations.</p>
      <textarea
        className="w-full min-h-[160px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        placeholder="e.g., EPC for 5 MTPA petrochemical unit including detailed design, procurement assistance, site supervision, and integrated commissioning."
        value={projectForm.project_description}
        onChange={(event) => setProjectField('project_description', event.target.value)}
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        {
          title: 'Engineering',
          summary: 'Drawings, calculations, and interdisciplinary reviews.'
        },
        {
          title: 'Procurement Support',
          summary: 'Vendor evaluation, technical clarifications, expediting.'
        },
        {
          title: 'Site / Commissioning',
          summary: 'Mobilisation, inspection, punch list closure, client handover.'
        }
      ].map((card) => (
        <div key={card.title} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm space-y-2">
          <h3 className="text-sm font-semibold text-black">{card.title}</h3>
          <p className="text-xs text-gray-500">{card.summary}</p>
          <button
            type="button"
            className="px-3 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
          >
            View Work Packages
          </button>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Deliverables</h3>
        <p className="text-xs text-gray-500">Use this space to list major outputs (drawings, BOQs, reports, site works). This will later sync with activity deliverables.</p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Exclusions / Constraints</h3>
        <p className="text-xs text-gray-500">Document assumptions, client-supplied items, or contract limitations to help downstream teams.</p>
      </div>
    </div>

    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-black">Discipline Deliverable Matrix</h3>
          <p className="text-xs text-gray-500">Track ownership and deadlines before activities are formalised.</p>
        </div>
        <button
          type="button"
          className="px-4 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
        >
          Add Deliverable
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Discipline</th>
              <th className="px-3 py-2 text-left">Deliverable</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Due</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              {
                discipline: 'Process',
                deliverable: 'P&ID master set',
                owner: 'Process Lead',
                due: projectForm.start_date || '—',
                status: 'Draft'
              },
              {
                discipline: 'Mechanical',
                deliverable: 'Equipment datasheets',
                owner: 'Mechanical Engineer',
                due: projectForm.end_date || '—',
                status: 'In Review'
              },
              {
                discipline: 'Piping',
                deliverable: 'Isometric issue for construction',
                owner: 'Piping Team',
                due: projectForm.completion_date || '—',
                status: 'Pending'
              }
            ].map((row) => (
              <tr key={row.deliverable} className="border-t border-gray-200">
                <td className="px-3 py-2 text-gray-600 font-medium">{row.discipline}</td>
                <td className="px-3 py-2 text-gray-600">{row.deliverable}</td>
                <td className="px-3 py-2 text-gray-600">{row.owner}</td>
                <td className="px-3 py-2 text-gray-600">{row.due}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-600">{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Client Responsibilities</h3>
          <span className="text-[11px] text-gray-500">RACI: Client = Accountable</span>
        </div>
        <textarea
          className="w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          placeholder="Site access, utilities, permits, data books..."
          value={projectForm.scope_client_responsibilities}
          onChange={(event) => setProjectField('scope_client_responsibilities', event.target.value)}
        />
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Change Requests / Variations</h3>
          <span className="text-[11px] text-gray-500">Log ref • status</span>
        </div>
        <textarea
          className="w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
          placeholder="CR-01: Additional pumps – pending approval"
          value={projectForm.scope_change_log}
          onChange={(event) => setProjectField('scope_change_log', event.target.value)}
        />
      </div>
    </div>

    <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
      <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Quality & Acceptance Notes</h3>
      <textarea
        className="w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
        placeholder="Document review cycle, acceptance criteria, punch list approach."
        value={projectForm.scope_quality_notes}
        onChange={(event) => setProjectField('scope_quality_notes', event.target.value)}
      />
    </div>
  </div>
);

  const renderScheduleTab = () => {
    const sprintColumns = [
      {
        id: 'backlog',
        title: 'Product Backlog',
        caption: 'Ideas & unprioritised work items',
        accent: 'bg-slate-100',
        items: []
      },
      {
        id: 'current',
        title: 'Sprint 01 • Current',
        caption: projectForm.end_date ? `Ends ${projectForm.end_date}` : 'No sprint scheduled',
        accent: 'bg-emerald-50',
        items: []
      },
      {
        id: 'next',
        title: 'Sprint 02 • Next',
        caption: 'Plan upcoming commitments',
        accent: 'bg-violet-50',
        items: []
      }
    ];

    const teamCapacity = [];

    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-black">Sprint Planning Board</h2>
              <p className="text-xs text-gray-500">Review backlog, commit to a sprint, and track cadence health.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="font-semibold text-black">Sprint Goal</p>
                <p className="text-gray-600">Deliver IFC drawing packages</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="font-semibold text-black">Velocity Target</p>
                <p className="text-gray-600">120 hrs</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="font-semibold text-black">Completion</p>
                <div className="mt-1 h-2 w-32 rounded-full bg-gray-200">
                  <div className="h-2 rounded-full bg-[#7F2487]" style={{ width: `${Math.min(projectForm.progress || 0, 100)}%` }}></div>
                </div>
              </div>
              <button
                type="button"
                className="px-4 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
              >
                Create Sprint
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="font-semibold text-black">Sprint Start</p>
              <p className="mt-1 text-gray-600">{projectForm.start_date || '—'}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="font-semibold text-black">Sprint End</p>
              <p className="mt-1 text-gray-600">{projectForm.end_date || '—'}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="font-semibold text-black">Next Planning</p>
              <p className="mt-1 text-gray-600">{projectForm.completion_date || '—'}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="font-semibold text-black">Risk Highlight</p>
              <p className="mt-1 text-red-500">Vendor drawings delayed 3 days</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sprintColumns.map((column) => (
            <div key={column.id} className={`border border-gray-200 rounded-lg p-4 space-y-3 ${column.accent}`}>
              <div>
                <h3 className="text-sm font-semibold text-black">{column.title}</h3>
                <p className="text-xs text-gray-500">{column.caption}</p>
              </div>
              <div className="space-y-2">
                {column.items.length === 0 ? (
                  <p className="text-xs text-gray-500 bg-white border border-dashed border-gray-200 rounded-md px-3 py-4 text-center">
                    No stories yet. Use “Add Story” to populate this column.
                  </p>
                ) : (
                  column.items.map((item) => (
                    <div
                      key={item.label}
                      className="bg-white border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-600 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span>{item.label}</span>
                        <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">{item.tag}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                className="w-full px-3 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
              >
                + Add Story
              </button>
            </div>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Team Capacity Overview</h3>
              <p className="text-xs text-gray-500">Compare planned vs. consumed hours to rebalance workload.</p>
            </div>
            <button
              type="button"
              className="px-4 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
            >
              Update Capacity
            </button>
          </div>
          {teamCapacity.length === 0 ? (
            <p className="text-xs text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">
              No capacity data captured. Click “Update Capacity” to log hours per discipline.
            </p>
          ) : (
            <div className="space-y-3">
              {teamCapacity.map((row) => (
                <div key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="font-semibold text-black">{row.label}</span>
                    <span>{row.actual} / {row.planned} hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-200">
                    <div
                      className="h-2 rounded-full bg-[#7F2487]"
                      style={{ width: `${Math.min(Math.round((row.actual / row.planned) * 100) || 0, 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Sprint Notes</h3>
          <p className="text-xs text-gray-500 mt-2">Log blockers, capacity changes, or learnings at the end of each sprint review.</p>
          <textarea
            className="mt-4 w-full min-h-[120px] px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
            placeholder="Highlight risks, scope changes, or stakeholder feedback from the sprint review."
            value={projectForm.remarks}
            onChange={(event) => setProjectField('remarks', event.target.value)}
          />
        </div>
      </div>
    );
  };

  const renderTeamTab = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-black">Project Team Directory</h2>
        <p className="text-xs text-gray-500 mb-4">Map internal leads, outsourced partners, and client stakeholders.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border border-gray-200 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Organisation</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 text-black font-medium">Project Manager</td>
                <td className="px-3 py-2 text-gray-600">{projectForm.project_manager || '—'}</td>
                <td className="px-3 py-2 text-gray-600">Accent</td>
                <td className="px-3 py-2 text-gray-600">—</td>
                <td className="px-3 py-2 text-gray-400">Assign upcoming tasks</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 text-black font-medium">Client Contact</td>
                <td className="px-3 py-2 text-gray-600">{projectForm.client_name || '—'}</td>
                <td className="px-3 py-2 text-gray-600">Client</td>
                <td className="px-3 py-2 text-gray-600">—</td>
                <td className="px-3 py-2 text-gray-400">Capture official approvals</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2 text-black font-medium">Outsource Partner</td>
                <td className="px-3 py-2 text-gray-600">{projectForm.outsourced_company || '—'}</td>
                <td className="px-3 py-2 text-gray-600">Partner</td>
                <td className="px-3 py-2 text-gray-600">—</td>
                <td className="px-3 py-2 text-gray-400">Track billing links</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-xs font-semibold text-black uppercase tracking-wide">Upcoming Actions</h3>
        <p className="text-xs text-gray-500 mt-2">Use the Activities tab to assign specific tasks; team view will reflect ownership once integrated.</p>
      </div>
    </div>
  );

  const renderActivitiesTab = () => (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-black">Discipline Overview</h2>
          <p className="text-xs text-gray-500">Track engineering and site activities across functional streams.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAddActivityRedirect}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs bg-accent-primary text-white rounded-md hover:bg-accent-primary/90 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Add Activity
          </button>
          <button
            type="button"
            onClick={() => setShowActivityTips((prev) => !prev)}
            className="text-xs text-gray-600 hover:text-black"
          >
            {showActivityTips ? 'Hide' : 'Show'} discipline map
          </button>
        </div>
      </div>

      {showActivityTips && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {DISCIPLINES.map((discipline) => (
            <div key={discipline} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircleIcon className="h-5 w-5 text-accent-primary" />
                <div>
                  <h3 className="text-sm font-semibold text-black">{discipline}</h3>
                  <p className="text-xs text-gray-500">Plan deliverables, owners, progress, and risk indicators.</p>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                <p>0 activities mapped • 0% completion</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3 text-xs text-yellow-800">
        <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
        <div>
          <p className="font-semibold">Activity workflow in preview</p>
          <p>Use the builder below to sketch the desired structure. Persistence and automation will be wired to the backend in the next iteration.</p>
        </div>
      </div>

      {renderActivityForm()}
    </div>
  );

  const renderCurrentTab = () => {
    switch (activeTab) {
      case 'basic':
        return renderBasicInfoTab();
      case 'scope':
        return renderScopeTab();
      case 'schedule':
        return renderScheduleTab();
      case 'activities':
        return renderActivitiesTab();
      case 'team':
        return renderTeamTab();
      default:
        return renderBasicInfoTab();
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          Loading project...
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="px-8 pt-22 pb-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={handleGoBack}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Projects
                </button>
                <h1 className="mt-3 text-xl font-bold text-black">{projectForm.name || 'Edit Project'}</h1>
                <p className="text-sm text-gray-600">Update delivery scope and drive discipline activities for this engagement.</p>
              </div>
              <div className="text-xs text-gray-500">
                <p>Project ID: <strong className="text-black">{formattedMeta?.code || `PRJ-${projectId}`}</strong></p>
                <p>Client: <strong className="text-black">{projectForm.client_name || '—'}</strong></p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg">
              <nav className="flex border-b border-gray-200 text-xs font-medium">
                {PROJECT_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-3 border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-accent-primary text-black'
                        : 'border-transparent text-gray-500 hover:text-black hover:border-gray-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <div className="p-6 space-y-6">
                {renderCurrentTab()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
