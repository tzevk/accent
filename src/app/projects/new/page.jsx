'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

const STATUS_OPTIONS = ['NEW', 'planning', 'in-progress', 'on-hold', 'completed', 'cancelled'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH'];
const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];

const INITIAL_FORM = {
  name: '',
  client_name: '',
  company_id: '',
  project_manager: '',
  start_date: '',
  end_date: '',
  target_date: '',
  budget: '',
  status: 'NEW',
  priority: 'MEDIUM',
  progress: 0,
  assigned_to: '',
  type: 'ONGOING',
  description: '',
  notes: '',
  proposal_id: ''
};

function LoadingFallback() {
  return (
    <div className="p-8 text-sm text-gray-500">Loading…</div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <NewProjectForm />
    </Suspense>
  );
}

function NewProjectForm() {
  const searchParams = useSearchParams();
  const presetDate = searchParams.get('date');
  const normalizedDate = useMemo(() => {
    if (!presetDate) return '';
    const parsed = new Date(presetDate);
    if (Number.isNaN(parsed.getTime())) return '';
    return format(parsed, 'yyyy-MM-dd');
  }, [presetDate]);

  const router = useRouter();
  const [companies, setCompanies] = useState([]);
  const [form, setForm] = useState(() => ({ ...INITIAL_FORM, start_date: normalizedDate, end_date: normalizedDate }));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const response = await fetch('/api/companies');
        const json = await response.json();
        if (json.success) setCompanies(json.data);
      } catch (error) {
        console.error('Failed to fetch companies', error);
      }
    };
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (normalizedDate) {
      setForm((prev) => ({
        ...prev,
        start_date: prev.start_date || normalizedDate,
        end_date: prev.end_date || normalizedDate
      }));
    }
  }, [normalizedDate]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleProgressChange = (event) => {
    const value = Number(event.target.value);
    setForm((prev) => ({ ...prev, progress: Number.isNaN(value) ? 0 : value }));
  };

  const handleCancel = () => {
    router.push('/projects?view=list');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      alert('Project name is required');
      return;
    }
    if (!form.client_name.trim()) {
      alert('Client name is required');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || '',
        company_id: form.company_id || null,
        client_name: form.client_name,
        project_manager: form.project_manager || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        target_date: form.target_date || null,
        budget: form.budget ? Number(form.budget) : null,
        assigned_to: form.assigned_to || null,
        status: form.status || 'NEW',
        type: form.type || 'ONGOING',
        priority: form.priority || 'MEDIUM',
        progress: Number(form.progress) || 0,
        proposal_id: form.proposal_id || null,
        notes: form.notes || null
      };

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (result.success) {
        router.push('/projects?view=list');
      } else {
        alert(result.error || 'Failed to create project');
      }
    } catch (error) {
      console.error('Project create error', error);
      alert('Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <form onSubmit={handleSubmit} className="px-8 pt-22 pb-8 space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Projects
                </button>
                <h1 className="mt-3 text-2xl font-bold text-black">Create Project</h1>
                <p className="text-sm text-gray-600">
                  Fill in the core project fields as defined in the CRM database.
                </p>
              </div>
            </header>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-black">Basic Details</h2>
                <p className="text-xs text-gray-500">Project identity, client alignment, and ownership.</p>
              </div>
              <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Project Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Client Name *</label>
                  <input
                    type="text"
                    name="client_name"
                    value={form.client_name}
                    onChange={handleChange}
                    required
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Linked Company</label>
                  <select
                    name="company_id"
                    value={form.company_id}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  >
                    <option value="">No company linked</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name || company.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Project Manager</label>
                  <input
                    type="text"
                    name="project_manager"
                    value={form.project_manager}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Status</label>
                  <select
                    name="status"
                    value={form.status}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Priority</label>
                  <select
                    name="priority"
                    value={form.priority}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  >
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Project Type</label>
                  <select
                    name="type"
                    value={form.type}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  >
                    {TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Assigned To</label>
                  <input
                    type="text"
                    name="assigned_to"
                    value={form.assigned_to}
                    onChange={handleChange}
                    placeholder="Internal owner or lead"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-black">Schedule & Budget</h2>
                <p className="text-xs text-gray-500">Dates and high-level financials.</p>
              </div>
              <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Start Date</label>
                  <input
                    type="date"
                    name="start_date"
                    value={form.start_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">End Date</label>
                  <input
                    type="date"
                    name="end_date"
                    value={form.end_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Target Date</label>
                  <input
                    type="date"
                    name="target_date"
                    value={form.target_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Budget (INR)</label>
                  <input
                    type="number"
                    name="budget"
                    value={form.budget}
                    onChange={handleChange}
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-black mb-1">Progress (%)</label>
                  <input
                    type="range"
                    name="progress"
                    value={form.progress}
                    min="0"
                    max="100"
                    onChange={handleProgressChange}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">{form.progress}% complete</p>
                </div>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-black">Descriptions & Notes</h2>
                <p className="text-xs text-gray-500">Store high-level description and internal notes (saved to the database).</p>
              </div>
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Project Description</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Summary that will be visible in the project view."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-black mb-1">Internal Notes</label>
                  <textarea
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Additional notes stored against the project record."
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-60 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {submitting ? 'Saving…' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
