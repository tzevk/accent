'use client';

import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { fetchJSON } from '@/utils/http';
import {
  CalendarIcon,
  MapPinIcon,
  ClipboardDocumentCheckIcon,
  BuildingOffice2Icon,
  ClockIcon,
  UserIcon,
  TagIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

const INFO_PAIR = (label, value) => ({ label, value });

export default function ProjectViewPage() {
  const params = useParams();
  const id = params?.id;
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Invalid project id');
      return;
    }

    const loadProject = async () => {
      try {
        const result = await fetchJSON(`/api/projects/${id}`);
        if (result?.success) {
          setProject(result.data);
        } else {
          setError(result?.error || 'Failed to load project');
        }
      } catch (err) {
        console.error('Project view error', err);
        setError(err?.message || 'Unable to load project details');
      } finally {
        setLoading(false);
      }
    };

    loadProject();
  }, [id]);

  const basicInfo = useMemo(() => {
    if (!project) return [];
    return [
      INFO_PAIR('Project Code', project.project_id || `PRJ-${project.id}`),
      INFO_PAIR('Client', project.client_name || '—'),
      INFO_PAIR('Project Manager', project.project_manager || '—'),
      INFO_PAIR('Project Type', project.type || '—'),
      INFO_PAIR('Status', project.status || '—'),
      INFO_PAIR('Priority', project.priority || '—'),
      INFO_PAIR('Progress', `${project.progress || 0}%`),
      INFO_PAIR('Start Date', project.start_date || '—'),
      INFO_PAIR('End Date', project.end_date || '—'),
      INFO_PAIR('Target Date', project.target_date || '—'),
      INFO_PAIR('Assigned To', project.assigned_to || '—'),
      INFO_PAIR('Budget', project.budget ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(project.budget) : '—'),
      INFO_PAIR('Company ID', project.company_id || '—'),
      INFO_PAIR('Proposal ID', project.proposal_id || project.linked_proposal_id || '—')
    ];
  }, [project]);

  const scopeSummary = useMemo(() => {
    if (!project) return [];
    const notes = [];
    if (project.description) {
      notes.push({ title: 'Project Overview', content: project.description });
    }
    if (project.notes) {
      notes.push({ title: 'Internal Notes', content: project.notes });
    }
    return notes;
  }, [project]);

  const meetingDocuments = useMemo(() => {
    if (!project) return [];
    const docs = [];
    if (project.project_schedule) {
      docs.push({ title: 'Project Schedule', content: project.project_schedule });
    }
    if (project.input_document) {
      docs.push({ title: 'Input Documents', content: project.input_document });
    }
    if (project.list_of_deliverables) {
      docs.push({ title: 'List of Deliverables', content: project.list_of_deliverables });
    }
    if (project.kickoff_meeting) {
      docs.push({ title: 'Kickoff Meeting', content: project.kickoff_meeting });
    }
    if (project.in_house_meeting) {
      docs.push({ title: 'In House Meeting', content: project.in_house_meeting });
    }
    return docs;
  }, [project]);

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
          Loading project…
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="h-screen bg-gray-50 flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-500 space-y-3">
          <p>{error || 'Project not found'}</p>
          <Link href="/projects" className="px-4 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors">
            Back to Projects
          </Link>
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
            <header className="bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#7F2487]/10 text-[#7F2487] text-xs font-semibold uppercase tracking-wide">
                  <ClipboardDocumentCheckIcon className="h-4 w-4" />
                  Project Overview
                </span>
                <h1 className="text-2xl font-bold text-black">{project.name}</h1>
                <p className="text-sm text-gray-600 max-w-2xl">
                  {project.description || 'No summary provided. Use the edit view to enrich scope details.'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Link
                  href={`/projects/${project.id}/edit`}
                  className="px-4 py-2 rounded-md border border-[#7F2487] text-[#7F2487] hover:bg-[#7F2487]/10 transition-colors"
                >
                  Edit Project
                </Link>
                <Link
                  href="/masters/activities"
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
                >
                  Configure Activity Library
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </header>

            {/* Tabs */}
            <div className="bg-white border border-gray-200 rounded-lg px-6 py-3">
              <div role="tablist" aria-label="Project sections" className="flex space-x-2">
                {[
                  { id: 'general', label: 'General Info' },
                  { id: 'commercial', label: 'Commercial' },
                  { id: 'activities', label: 'Project Activities' },
                  { id: 'team', label: 'Project Team' },
                  { id: 'procurement', label: 'Procurement' },
                  { id: 'construction', label: 'Construction' },
                  { id: 'risk', label: 'Risk & Issues' },
                  { id: 'closeout', label: 'Closeout' }
                ].map((t) => (
                  <button
                    id={`tab-${t.id}`}
                    key={t.id}
                    role="tab"
                    aria-selected={activeTab === t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md focus:outline-none ${activeTab === t.id ? 'bg-[#7F2487]/10 text-[#7F2487]' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <section
              id="panel-general"
              role="tabpanel"
              aria-labelledby="tab-general"
              hidden={activeTab !== 'general'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">General Information</h2>
              </div>
              <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {basicInfo.map((item) => (
                  <div key={item.label} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
                    <p className="text-sm font-medium text-black mt-1">{item.value || '—'}</p>
                  </div>
                ))}
              </div>

              {/* Project Scope & Notes */}
              <div className="px-6 py-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-4">
                  <MapPinIcon className="h-5 w-5 text-[#7F2487]" />
                  <h3 className="text-sm font-semibold text-black">Project Scope & Notes</h3>
                </div>
                <div className="space-y-4">
                  {scopeSummary.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No scope notes captured yet. Use the edit view to document overview, client responsibilities, and change history.
                    </p>
                  ) : (
                    scopeSummary.map((note) => (
                      <div key={note.title} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                        <h4 className="text-xs font-semibold text-black uppercase tracking-wide">{note.title}</h4>
                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{note.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Meeting & Documents */}
              <div className="px-6 py-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-4">
                  <DocumentTextIcon className="h-5 w-5 text-[#7F2487]" />
                  <h3 className="text-sm font-semibold text-black">Documents & Meetings</h3>
                </div>
                <div className="space-y-4">
                  {meetingDocuments.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No meeting or document details captured yet. Use the edit view to add project schedule, input documents, deliverables, and meeting information.
                    </p>
                  ) : (
                    meetingDocuments.map((doc) => (
                      <div key={doc.title} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                        <h4 className="text-xs font-semibold text-black uppercase tracking-wide">{doc.title}</h4>
                        <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{doc.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            {/* Commercial Tab */}
            <section
              id="panel-commercial"
              role="tabpanel"
              aria-labelledby="tab-commercial"
              hidden={activeTab !== 'commercial'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <TagIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Commercial Information</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Commercial details will be displayed here. Use the edit view to add project value, payment terms, and financial information.
                </p>
              </div>
            </section>

            {/* Project Activities Tab */}
            <section
              id="panel-activities"
              role="tabpanel"
              aria-labelledby="tab-activities"
              hidden={activeTab !== 'activities'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <ClipboardDocumentCheckIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Project Activities</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Project activities and task details will be displayed here. Use the edit view to manage activities, disciplines, and assignments.
                </p>
              </div>
            </section>



            {/* Project Team Tab */}
            <section
              id="panel-team"
              role="tabpanel"
              aria-labelledby="tab-team"
              hidden={activeTab !== 'team'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <UserIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Project Team</h2>
              </div>
              <div className="px-6 py-5 space-y-3 text-sm text-gray-600">
                <p><span className="font-semibold text-black">Project Manager:</span> {project.project_manager || '—'}</p>
                <p><span className="font-semibold text-black">Primary Client:</span> {project.client_name || '—'}</p>
                <p><span className="font-semibold text-black">Assigned To:</span> {project.assigned_to || '—'}</p>
                <p className="text-xs text-gray-500 mt-4">
                  Team assignments and member details will be displayed here. Use the edit view to manage team members and their roles.
                </p>
              </div>
            </section>

            {/* Procurement Tab */}
            <section
              id="panel-procurement"
              role="tabpanel"
              aria-labelledby="tab-procurement"
              hidden={activeTab !== 'procurement'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Procurement & Material</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Procurement status, material delivery schedules, and vendor management information will be displayed here. Use the edit view to manage procurement details.
                </p>
              </div>
            </section>

            {/* Construction Tab */}
            <section
              id="panel-construction"
              role="tabpanel"
              aria-labelledby="tab-construction"
              hidden={activeTab !== 'construction'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Construction</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Site readiness, mobilization dates, and construction progress will be displayed here. Use the edit view to update construction information.
                </p>
              </div>
            </section>

            {/* Risk & Issues Tab */}
            <section
              id="panel-risk"
              role="tabpanel"
              aria-labelledby="tab-risk"
              hidden={activeTab !== 'risk'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Risk & Issues</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Major risks, mitigation plans, change orders, and disputes will be displayed here. Use the edit view to manage project risks and issues.
                </p>
              </div>
            </section>

            {/* Closeout Tab */}
            <section
              id="panel-closeout"
              role="tabpanel"
              aria-labelledby="tab-closeout"
              hidden={activeTab !== 'closeout'}
              className="bg-white border border-gray-200 rounded-lg shadow-sm"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <CheckCircleIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Project Closeout</h2>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm text-gray-500">
                  Final documentation status, lessons learned, client feedback, and profit/loss information will be displayed here. Use the edit view to manage closeout details.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
