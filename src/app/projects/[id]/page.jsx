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
  const [activeTab, setActiveTab] = useState('project_details');

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

  // helpers for collapsible Project Details
  const [openSections, setOpenSections] = useState({
    basic: true,
    scope: true,
    unitQty: false,
    deliverables: true
  });

  const toggleSection = (key) => setOpenSections(s => ({ ...s, [key]: !s[key] }));

  const pick = (keys = []) => {
    if (!project) return null;
    for (const k of keys) {
      const v = project[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  };

  const basicDetailsList = useMemo(() => {
    if (!project) return [];
    return [
      { label: 'Company Name', value: pick(['company_name', 'client_name', 'company']) },
      { label: 'Project Number', value: pick(['project_number', 'project_code', 'project_id']) },
      { label: 'Project Name', value: pick(['name', 'project_name']) },
      { label: 'Project Duration', value: pick(['duration', 'project_duration']) },
      { label: 'Project Start Date', value: pick(['start_date', 'project_start_date']) },
      { label: 'Project End Date', value: pick(['end_date', 'project_end_date', 'target_date']) },
      { label: 'Estimated Manhours', value: pick(['estimated_manhours', 'manhours', 'estimated_hours']) },
      { label: 'Project Type', value: pick(['type', 'project_type']) }
    ];
  }, [project]);

  const scopeField = useMemo(() => {
    return (
      pick(['scope_of_work', 'proposal_scope', 'scope', 'description']) || null
    );
  }, [project]);

  const unitQtyField = useMemo(() => {
    return pick(['unit_qty', 'unit', 'quantity', 'units', 'unit_quantity']) || null;
  }, [project]);

  const deliverablesField = useMemo(() => {
    // try several common field names and also fall back to list_of_deliverables
    return pick(['deliverables', 'list_of_deliverables', 'proposal_deliverables', 'proposal_items']) || null;
  }, [project]);

  // Parse JSON fields safely for rendering
  const parsedTeamMembers = useMemo(() => {
    if (!project || !project.team_members) return [];
    try {
      return typeof project.team_members === 'string' ? JSON.parse(project.team_members) : project.team_members;
    } catch (err) {
      return [];
    }
  }, [project]);

  const parsedProjectActivitiesList = useMemo(() => {
    if (!project || !project.project_activities_list) return [];
    try {
      return typeof project.project_activities_list === 'string' ? JSON.parse(project.project_activities_list) : project.project_activities_list;
    } catch (err) {
      return [];
    }
  }, [project]);

  const parsedPlanningActivities = useMemo(() => {
    if (!project || !project.planning_activities_list) return [];
    try {
      return typeof project.planning_activities_list === 'string' ? JSON.parse(project.planning_activities_list) : project.planning_activities_list;
    } catch (err) {
      return [];
    }
  }, [project]);

  const parsedDocumentsList = useMemo(() => {
    if (!project || !project.documents_list) return [];
    try {
      return typeof project.documents_list === 'string' ? JSON.parse(project.documents_list) : project.documents_list;
    } catch (err) {
      return [];
    }
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
                  href={`/projects/${project.id ?? project.project_id ?? project.project_code}/edit`}
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
            <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-2">
                {[
                  { id: 'project_details', label: 'Project Details' },
                  { id: 'scope', label: 'Scope' },
                  { id: 'minutes_kom_client', label: 'Minutes - KOM with Client' },
                  { id: 'minutes_internal_meet', label: 'Minutes of the Internal Meet' },
                  { id: 'documents_received', label: 'List of Documents Received' },
                  { id: 'project_schedule', label: 'Project Schedule' },
                  { id: 'project_activity', label: 'Project Activity' },
                  { id: 'documents_issued', label: 'Documents Issued' },
                  { id: 'project_handover', label: 'Project Handover' },
                  { id: 'project_manhours', label: 'Project Manhours' },
                  { id: 'query_log', label: 'Query Log' },
                  { id: 'assumption', label: 'Assumption' },
                  { id: 'lessons_learnt', label: 'Lessons Learnt' }
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

            {activeTab === 'project_details' && (
              <section
                id="panel-project_details"
                role="tabpanel"
                aria-labelledby="tab-project_details"
                className="bg-white border border-gray-200 rounded-lg shadow-sm"
              >
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">General Information</h2>
              </div>
              <div className="px-6 py-5 space-y-4">
                {/* Basic Details (collapsible) */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => toggleSection('basic')}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
                      <h3 className="text-sm font-semibold text-black">Basic Details</h3>
                    </div>
                    <div className="text-sm text-gray-500">{openSections.basic ? 'Hide' : 'Show'}</div>
                  </button>
                  {openSections.basic && (
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {basicDetailsList.map((item) => (
                        <div key={item.label} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                          <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
                          <p className="text-sm font-medium text-black mt-1">{item.value ?? '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scope (collapsible) */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => toggleSection('scope')}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="h-5 w-5 text-[#7F2487]" />
                      <h3 className="text-sm font-semibold text-black">Scope</h3>
                    </div>
                    <div className="text-sm text-gray-500">{openSections.scope ? 'Hide' : 'Show'}</div>
                  </button>
                  {openSections.scope && (
                    <div className="mt-3 space-y-3">
                      {scopeField ? (
                        <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                          <p className="text-sm text-gray-600 whitespace-pre-line">{scopeField}</p>
                        </div>
                      ) : scopeSummary.length > 0 ? (
                        scopeSummary.map((note) => (
                          <div key={note.title} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                            <h4 className="text-xs font-semibold text-black uppercase tracking-wide">{note.title}</h4>
                            <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{note.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">No scope captured. Use the edit view to import scope from the linked proposal or add custom scope.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Unit / Qty (collapsible) */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => toggleSection('unitQty')}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardDocumentCheckIcon className="h-5 w-5 text-[#7F2487]" />
                      <h3 className="text-sm font-semibold text-black">Unit / Qty</h3>
                    </div>
                    <div className="text-sm text-gray-500">{openSections.unitQty ? 'Hide' : 'Show'}</div>
                  </button>
                  {openSections.unitQty && (
                    <div className="mt-3">
                      {unitQtyField ? (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                          <p className="text-sm text-gray-600">{unitQtyField}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No unit/quantity data captured. Add unit/qty in the edit view or import from proposal.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Deliverables (collapsible) */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={() => toggleSection('deliverables')}
                    className="w-full flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <DocumentTextIcon className="h-5 w-5 text-[#7F2487]" />
                      <h3 className="text-sm font-semibold text-black">Deliverables</h3>
                    </div>
                    <div className="text-sm text-gray-500">{openSections.deliverables ? 'Hide' : 'Show'}</div>
                  </button>
                  {openSections.deliverables && (
                    <div className="mt-3 space-y-3">
                      {deliverablesField ? (
                        <div className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                          <p className="text-sm text-gray-600 whitespace-pre-line">{deliverablesField}</p>
                        </div>
                      ) : meetingDocuments.length > 0 ? (
                        meetingDocuments.map((doc) => (
                          <div key={doc.title} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                            <h4 className="text-xs font-semibold text-black uppercase tracking-wide">{doc.title}</h4>
                            <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{doc.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">No deliverables captured. Import deliverables from the linked proposal or add them in the edit view.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              </section>
            )}

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
              <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Project Value</p>
                  <p className="text-sm font-medium text-black mt-1">{project.project_value ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: project.currency || 'INR' }).format(project.project_value) : '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Currency</p>
                  <p className="text-sm font-medium text-black mt-1">{project.currency || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Payment Terms</p>
                  <p className="text-sm font-medium text-black mt-1">{project.payment_terms || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Invoicing Status</p>
                  <p className="text-sm font-medium text-black mt-1">{project.invoicing_status || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Cost to Company</p>
                  <p className="text-sm font-medium text-black mt-1">{project.cost_to_company ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: project.currency || 'INR' }).format(project.cost_to_company) : '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Profitability Estimate</p>
                  <p className="text-sm font-medium text-black mt-1">{project.profitability_estimate ? `${project.profitability_estimate}%` : '—'}</p>
                </div>
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
                {parsedProjectActivitiesList && parsedProjectActivitiesList.length > 0 ? (
                  <div className="space-y-3">
                    {parsedProjectActivitiesList.map((act, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                        <h4 className="text-sm font-semibold text-black">{act.activity || act.name || `Activity ${idx+1}`}</h4>
                        {act.description ? <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{act.description}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No project activities captured. Use the edit view to add activities, disciplines and assignments.</p>
                )}
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
                <div className="mt-3">
                  <h4 className="text-xs font-semibold text-black uppercase tracking-wide">Team Members</h4>
                  {parsedTeamMembers && parsedTeamMembers.length > 0 ? (
                    parsedTeamMembers.map((m, i) => (
                      <div key={i} className="text-sm text-gray-600">{m.name || m.employee_name || m}</div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">No team members added. Use the edit view to assign team members.</p>
                  )}
                </div>
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
                <div className="space-y-3 text-sm text-gray-600">
                  <p><span className="font-semibold text-black">Procurement Status:</span> {project.procurement_status || '—'}</p>
                  <p><span className="font-semibold text-black">Material Delivery Schedule:</span> {project.material_delivery_schedule || '—'}</p>
                  <p><span className="font-semibold text-black">Vendor Management:</span> {project.vendor_management || '—'}</p>
                </div>
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
                <div className="space-y-3 text-sm text-gray-600">
                  <p><span className="font-semibold text-black">Mobilization Date:</span> {project.mobilization_date || '—'}</p>
                  <p><span className="font-semibold text-black">Site Readiness:</span> {project.site_readiness || '—'}</p>
                  <p><span className="font-semibold text-black">Construction Progress:</span> {project.construction_progress || '—'}</p>
                </div>
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
                <div className="space-y-3 text-sm text-gray-600">
                  <p><span className="font-semibold text-black">Major Risks:</span> {project.major_risks || '—'}</p>
                  <p><span className="font-semibold text-black">Mitigation Plans:</span> {project.mitigation_plans || '—'}</p>
                  <p><span className="font-semibold text-black">Change Orders:</span> {project.change_orders || '—'}</p>
                  <p><span className="font-semibold text-black">Claims / Disputes:</span> {project.claims_disputes || '—'}</p>
                </div>
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
                <div className="space-y-3 text-sm text-gray-600">
                  <p><span className="font-semibold text-black">Final Documentation Status:</span> {project.final_documentation_status || '—'}</p>
                  <p><span className="font-semibold text-black">Lessons Learned:</span> {project.lessons_learned || '—'}</p>
                  <p><span className="font-semibold text-black">Client Feedback:</span> {project.client_feedback || '—'}</p>
                  <p><span className="font-semibold text-black">Actual Profit / Loss:</span> {project.actual_profit_loss ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: project.currency || 'INR' }).format(project.actual_profit_loss) : '—'}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
