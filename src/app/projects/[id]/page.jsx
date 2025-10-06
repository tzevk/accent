'use client';

import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarIcon,
  MapPinIcon,
  ClipboardDocumentCheckIcon,
  BuildingOffice2Icon,
  ClockIcon,
  UserIcon,
  TagIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

const INFO_PAIR = (label, value) => ({ label, value });

export default function ProjectViewPage() {
  const params = useParams();
  const id = params?.id;
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Invalid project id');
      return;
    }

    const loadProject = async () => {
      try {
        const response = await fetch(`/api/projects/${id}`);
        const json = await response.json();
        if (json.success) {
          setProject(json.data);
        } else {
          setError(json.error || 'Failed to load project');
        }
      } catch (err) {
        console.error('Project view error', err);
        setError('Unable to load project details');
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

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Basic Information</h2>
              </div>
              <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {basicInfo.map((item) => (
                  <div key={item.label} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
                    <p className="text-sm font-medium text-black mt-1">{item.value || '—'}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <MapPinIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Scope & Notes</h2>
              </div>
              <div className="px-6 py-5 space-y-4">
                {scopeSummary.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No scope notes captured yet. Use the edit view to document overview, client responsibilities, and change history.
                  </p>
                ) : (
                  scopeSummary.map((note) => (
                    <div key={note.title} className="border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                      <h3 className="text-xs font-semibold text-black uppercase tracking-wide">{note.title}</h3>
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{note.content}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <ClockIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Sprint Planning Snapshot</h2>
              </div>
              <div className="px-6 py-5 grid grid-cols-1 lg:grid-cols-4 gap-4 text-xs">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="font-semibold text-black">Sprint Start</p>
                  <p className="mt-1 text-gray-600">{project.start_date || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="font-semibold text-black">Sprint End</p>
                  <p className="mt-1 text-gray-600">{project.end_date || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="font-semibold text-black">Next Planning</p>
                  <p className="mt-1 text-gray-600">{project.target_date || '—'}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="font-semibold text-black">Progress</p>
                  <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
                    <div className="h-2 rounded-full bg-[#7F2487]" style={{ width: `${Math.min(project.progress || 0, 100)}%` }}></div>
                  </div>
                  <p className="mt-1 text-gray-600">{project.progress || 0}% complete</p>
                </div>
              </div>
              <div className="px-6 pb-6 text-xs text-gray-500">
                Detailed sprint planning lives in the edit view. Use the activity catalogue to seed user stories.
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <TagIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Activities by Discipline</h2>
              </div>
              <div className="px-6 py-5 space-y-4 text-sm text-gray-600">
                <p>
                  Activities for this project are sourced from the Activity Master catalogue. Use the edit screen to assign sub-activities to employees, start/end dates, and manhours. Once assignments are made, they will appear here grouped by discipline for quick review.
                </p>
                <div className="border border-dashed border-gray-200 rounded-lg px-4 py-8 text-center text-gray-500">
                  No activities assigned yet. Navigate to the edit view to configure sprint stories using the master catalogue.
                </div>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
                <UserIcon className="h-5 w-5 text-[#7F2487]" />
                <h2 className="text-sm font-semibold text-black">Team & Ownership</h2>
              </div>
              <div className="px-6 py-5 space-y-3 text-sm text-gray-600">
                <p><span className="font-semibold text-black">Project Manager:</span> {project.project_manager || '—'}</p>
                <p><span className="font-semibold text-black">Primary Client:</span> {project.client_name || '—'}</p>
                <p><span className="font-semibold text-black">Assigned To:</span> {project.assigned_to || '—'}</p>
                <p className="text-xs text-gray-500 mt-4">
                  Team details are sourced from project fields only. For richer responsibility mapping use the Activity Master to assign work packages.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
