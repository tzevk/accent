'use client';

import Navbar from '@/components/Navbar';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

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
  proposal_id: '',
};

export default function EditProjectPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [companies, setCompanies] = useState([]);

  // activities
  const [activities, setActivities] = useState([]); // catalogue
  const [selectedActivities, setSelectedActivities] = useState([]); // project-level
  const [selectedDisciplines, setSelectedDisciplines] = useState([]); // project-level disciplines

  // Fetch project + companies
  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [projectRes, companyRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch('/api/companies'),
        ]);
        const projectJson = await projectRes.json();
        const companyJson = await companyRes.json();

        if (companyJson.success) setCompanies(companyJson.data || []);
        if (projectJson.success && projectJson.data) {
          const project = projectJson.data;
          setForm({
            ...INITIAL_FORM,
            ...project,
            start_date: project.start_date?.slice(0, 10) || '',
            end_date: project.end_date?.slice(0, 10) || '',
            target_date: project.target_date?.slice(0, 10) || '',
            disciplineDescriptions: project.discipline_descriptions || {},
          });
          if (project.activities) {
            setSelectedActivities(project.activities.map((a) => String(a.id)));
          }
          if (project.disciplines) {
            setSelectedDisciplines(project.disciplines.map((d) => String(d.id || d)));
          }
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  // Fetch activities catalogue
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch('/api/activities');
        const json = await res.json();
        if (json.success) setActivities(json.data);
      } catch (err) {
        console.error('Failed to fetch activities', err);
      }
    };
    fetchActivities();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProgressChange = (e) => {
    setForm((prev) => ({ ...prev, progress: Number(e.target.value) }));
  };

  const toggleActivity = (id) => {
    const sid = String(id);
    setSelectedActivities((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };

  const toggleDiscipline = (id) => {
    const sid = String(id);
    setSelectedDisciplines((prev) => {
      const next = prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid];
      if (!next.includes(sid)) {
        const actIdsToRemove = (activities.find((d) => String(d.id) === sid)?.activities || []).map((a) => String(a.id));
        setSelectedActivities((prevActs) => prevActs.filter((a) => !actIdsToRemove.includes(a)));
      }
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          activities: selectedActivities.map((v) =>
            Number.isFinite(Number(v)) ? Number(v) : v
          ),
          disciplines: (selectedDisciplines || []).map((v) =>
            Number.isFinite(Number(v)) ? Number(v) : v
          ),
          discipline_descriptions: form.disciplineDescriptions || {},
        }),
      });
      if (res.ok) router.push('/projects?view=list');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="p-6">Loading...</p>;

  const tabs = [
    { key: 'basic', label: 'Basic Info' },
    { key: 'dates', label: 'Dates & Budget' },
    { key: 'assign', label: 'Assignments' },
    { key: 'notes', label: 'Description & Notes' },
    { key: 'meta', label: 'Activities' },
  ];

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
                  onClick={() => router.push('/projects?view=list')}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-black transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-1" />
                  Back to Projects
                </button>
                <h1 className="mt-3 text-2xl font-bold text-black">Edit Project</h1>
                <p className="text-sm text-gray-600">
                  Update the project details stored in the CRM database.
                </p>
              </div>
            </header>

            {/* Tabs */}
            <div className="flex gap-6 border-b border-gray-200">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`pb-3 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'border-b-2 border-[#7F2487] text-[#7F2487]'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="space-y-8 leading-relaxed">
              <div className="max-w-8xl mx-auto">

                {/* BASIC INFO */}
                {activeTab === 'basic' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Basic Info</h2>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Project Name</label>
                        <input
                          type="text"
                          name="name"
                          value={form.name || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Client Name</label>
                        <input
                          type="text"
                          name="client_name"
                          value={form.client_name || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
                        <select
                          name="company_id"
                          value={form.company_id || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          <option value="">Select Company</option>
                          {(companies || []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.company_name || c.name || c.companyName || 'Unnamed Company'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </section>
                )}

                {/* DATES & BUDGET */}
                {activeTab === 'dates' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Dates & Budget</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                        <input
                          type="date"
                          name="start_date"
                          value={form.start_date || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                        <input
                          type="date"
                          name="end_date"
                          value={form.end_date || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Target Date</label>
                        <input
                          type="date"
                          name="target_date"
                          value={form.target_date || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Budget (INR)</label>
                        <input
                          type="number"
                          name="budget"
                          value={form.budget || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        />
                      </div>
                    </div>
                  </section>
                )}

                {/* ASSIGNMENTS */}
                {activeTab === 'assign' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Assignments</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                        <select
                          name="status"
                          value={form.status || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                        <select
                          name="priority"
                          value={form.priority || ''}
                          onChange={handleChange}
                          className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                        >
                          {PRIORITY_OPTIONS.map((p) => (
                            <option key={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Progress (%)</label>
                      <input
                        type="range"
                        name="progress"
                        value={form.progress || 0}
                        min="0"
                        max="100"
                        onChange={handleProgressChange}
                        className="w-full accent-[#7F2487]"
                      />
                      <p className="text-sm text-gray-600 mt-2">{form.progress}% complete</p>
                    </div>
                  </section>
                )}

                {/* NOTES */}
                {activeTab === 'notes' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black">Description & Notes</h2>
                    <div className="space-y-6">
                      <textarea
                        name="description"
                        value={form.description || ''}
                        onChange={handleChange}
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                      />
                      <textarea
                        name="notes"
                        value={form.notes || ''}
                        onChange={handleChange}
                        rows={3}
                        className="w-full px-4 py-3 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                  </section>
                )}

                {/* META / ACTIVITIES */}
                {activeTab === 'meta' && (
                  <section className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 space-y-6">
                    <h2 className="text-base font-semibold text-black flex items-center gap-2">
                      <ChartBarIcon className="h-5 w-5 text-[#7F2487]" /> Project Activities
                    </h2>

                    <p className="text-xs text-gray-500">
                      Select disciplines and their activities for this project. Disciplines and activities are managed in the Activity Master.
                    </p>

                    {(activities || []).map((discipline) => (
                      <div key={discipline.id} className="mb-6">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedDisciplines.includes(String(discipline.id))}
                            onChange={() => toggleDiscipline(discipline.id)}
                            className="h-4 w-4 text-[#7F2487] border-gray-300 rounded"
                          />
                          <h3 className="font-semibold text-gray-800">{discipline.name}</h3>
                        </div>

                        {selectedDisciplines.includes(String(discipline.id)) && (
                          <>
                            <textarea
                              placeholder="Add a short description for this discipline in this project (optional)"
                              value={(form.discipline_descriptions || {})[discipline.id] || ''}
                              onChange={(e) =>
                                setForm((p) => ({
                                  ...p,
                                  discipline_descriptions: {
                                    ...(p.discipline_descriptions || {}),
                                    [discipline.id]: e.target.value,
                                  },
                                }))
                              }
                              rows={2}
                              className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-md"
                            />

                            <div className="ml-6 grid md:grid-cols-2 gap-2 mt-3">
                              {(discipline.activities || []).map((act) => (
                                <label key={act.id} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    value={String(act.id)}
                                    checked={selectedActivities.includes(String(act.id))}
                                    onChange={() => toggleActivity(act.id)}
                                    className="h-4 w-4 text-[#7F2487] border-gray-300 rounded"
                                  />
                                  {act.name}
                                </label>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </section>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-4 pt-6">
                  <button
                    type="button"
                    onClick={() => router.push('/projects?view=list')}
                    className="px-6 py-2 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 text-sm rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>

              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}