'use client';

import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import Link from 'next/link';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJSON } from '@/utils/http';
import ProjectMemberDetails from '@/components/projects/ProjectMemberDetails';
import useSWR from 'swr';
import { useSession } from '@/context/SessionContext';
import { add, sub, mul, toNumber } from '@/lib/money';
import {
	CalendarIcon,
	ClipboardDocumentCheckIcon,
	BuildingOffice2Icon,
	ClockIcon,
	UserIcon,
	TagIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	DocumentTextIcon,
	CheckCircleIcon,
	ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { PROJECT_TABS, TAB_ALIASES } from '@/lib/project-tabs';
import { sanitizeHtml } from '@/lib/sanitize';
import dynamic from 'next/dynamic';
const ProjectActivityTab = dynamic(
	() => import('@/components/ProjectActivityTab'),
	{
		ssr: false,
		loading: () => (
			<div className="p-8 text-center text-gray-500">Loading...</div>
		),
	}
);
const DocumentUpload = dynamic(() => import('@/components/DocumentUpload'), {
	ssr: false,
	loading: () => (
		<div className="p-8 text-center text-gray-500">Loading...</div>
	),
});

// Helper to safely render HTML content (same as in ScopeTab) — P0.1 sanitized
function HtmlContent({ html, className = '' }) {
	if (!html) return null;
	const hasHtmlTags = /<[^>]+>/.test(html);
	if (hasHtmlTags) {
		return (
			<div
				className={`text-sm text-gray-700 leading-relaxed rich-text-content ${className}`}
				dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
			/>
		);
	}
	return (
		<p
			className={`text-sm text-gray-700 whitespace-pre-wrap leading-relaxed ${className}`}
		>
			{html}
		</p>
	);
}

// Canonical tabs shared with edit page; employee workspace shows a filtered subset
const TAB_CONFIG = PROJECT_TABS;
const EMPLOYEE_TAB_IDS = [
	'scope',
	'project_schedule',
	'project_team',
	'documents_received',
	'documents_issued',
	'assumption',
	'discussion',
	'query_log',
	'lessons_learnt',
];
const EMPLOYEE_TAB_CONFIG = EMPLOYEE_TAB_IDS.map(
	(id) => PROJECT_TABS.find((t) => t.id === id) || { id, label: id }
);

function EmployeePanel({ id, title, subtitle, Icon, children }) {
	return (
		<section
			id={`panel-${id}`}
			role="tabpanel"
			aria-labelledby={`tab-${id}`}
			tabIndex={0}
			className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
				<div className="flex items-center gap-3">
					<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
						<Icon className="h-4 w-4 text-purple-600" aria-hidden="true" />
					</div>
					<div>
						<h2 className="text-base font-semibold tracking-tight text-gray-900">
							{title}
						</h2>
						{subtitle ? (
							<p className="text-xs text-gray-500">{subtitle}</p>
						) : null}
					</div>
				</div>
			</div>
			<div className="space-y-4 px-6 py-6">{children}</div>
		</section>
	);
}

function EmployeeEmpty({ children }) {
	return (
		<p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
			{children}
		</p>
	);
}

// Read-only "List of Deliverables" register — same 15 columns as the edit tab.
function DeliverablesRegisterTable({ rows }) {
	const cell = 'py-2 px-2 text-gray-900';
	const head = 'py-2 px-2 font-semibold text-gray-700';
	return (
		<div className="overflow-x-auto border border-gray-200 rounded-lg">
			<table className="w-full text-xs border-collapse">
				<thead className="bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
					<tr>
						<th className={`text-center ${head}`}>Sr No</th>
						<th className={`text-left ${head}`}>Document No</th>
						<th className={`text-left ${head}`}>Discipline</th>
						<th className={`text-left ${head}`}>Category</th>
						<th className={`text-left ${head}`}>Deliverable Name</th>
						<th className={`text-left ${head}`}>Description</th>
						<th className={`text-left ${head}`}>Revision</th>
						<th className={`text-left ${head}`}>Status</th>
						<th className={`text-left ${head}`}>Planned Date</th>
						<th className={`text-left ${head}`}>Actual Date</th>
						<th className={`text-left ${head}`}>Prepared By</th>
						<th className={`text-left ${head}`}>Checked By</th>
						<th className={`text-left ${head}`}>Approved By</th>
						<th className={`text-left ${head}`}>Client Approval</th>
						<th className={`text-left ${head}`}>Remarks</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((d, index) => (
						<tr
							key={d.id || index}
							className="hover:bg-gray-50 transition-colors align-top"
						>
							<td className={`text-center ${cell}`}>{index + 1}</td>
							<td className={`text-left ${cell}`}>
								{d.document_number || '—'}
							</td>
							<td className={`text-left ${cell}`}>{d.discipline || '—'}</td>
							<td className={`text-left ${cell}`}>{d.category || '—'}</td>
							<td className={`text-left ${cell}`}>{d.document_name || '—'}</td>
							<td className={`text-left ${cell}`}>{d.description || '—'}</td>
							<td className={`text-left ${cell}`}>
								{d.revision_number || '—'}
							</td>
							<td className={`text-left ${cell}`}>{d.status || '—'}</td>
							<td className={`text-left ${cell}`}>{d.planned_date || '—'}</td>
							<td className={`text-left ${cell}`}>{d.actual_date || '—'}</td>
							<td className={`text-left ${cell}`}>{d.prepared_by || '—'}</td>
							<td className={`text-left ${cell}`}>{d.checked_by || '—'}</td>
							<td className={`text-left ${cell}`}>{d.approved_by || '—'}</td>
							<td className={`text-left ${cell}`}>
								{d.client_approval || '—'}
							</td>
							<td className={`text-left ${cell}`}>{d.remarks || '—'}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function EmployeeScopePanel({ scope, additionalScope }) {
	return (
		<EmployeePanel
			id="scope"
			title="Scope"
			subtitle="Project scope and amendments"
			Icon={DocumentTextIcon}
		>
			{scope || additionalScope ? (
				<div className="space-y-4">
					{scope ? (
						<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
							<h3 className="mb-2 text-sm font-semibold text-gray-900">
								Original scope
							</h3>
							<HtmlContent html={scope} />
						</div>
					) : null}
					{additionalScope ? (
						<div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
							<h3 className="mb-2 text-sm font-semibold text-amber-800">
								Additional scope
							</h3>
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
								{additionalScope}
							</p>
						</div>
					) : null}
				</div>
			) : (
				<EmployeeEmpty>No scope recorded.</EmployeeEmpty>
			)}
		</EmployeePanel>
	);
}

function EmployeeListPanel({
	id,
	title,
	subtitle,
	Icon,
	items,
	emptyMessage,
	renderItem,
}) {
	return (
		<EmployeePanel id={id} title={title} subtitle={subtitle} Icon={Icon}>
			{items.length > 0 ? (
				<div className="space-y-3">
					{items.map((item, index) => (
						<article
							key={item?.id || `${id}-${index}`}
							className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
						>
							{renderItem(item, index)}
						</article>
					))}
				</div>
			) : (
				<EmployeeEmpty>{emptyMessage}</EmployeeEmpty>
			)}
		</EmployeePanel>
	);
}

function employeeItemLabel(item, fallback) {
	if (item && typeof item === 'object') {
		return (
			item.document_name ||
			item.name ||
			item.title ||
			item.description ||
			item.activity_description ||
			item.activity ||
			fallback
		);
	}
	return item || fallback;
}

function parseStoredList(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return value
			.split(/\s*,\s*|\r?\n/)
			.map((item) => item.trim())
			.filter(Boolean);
	}
}

export default function ProjectViewPage() {
	const params = useParams();
	const id = params?.id;
	const { user: sessionUser, can, RESOURCES, PERMISSIONS } = useSession();
	const [activeTab, setActiveTab] = useState('project_details');
	const tabRefs = useRef({});
	const {
		data: projectData,
		error: fetchError,
		isLoading: loading,
	} = useSWR(id ? `/api/projects/${id}` : null, fetchJSON);
	const project = projectData?.success ? projectData.data : null;
	const error =
		fetchError ||
		(projectData && !projectData.success
			? projectData.error || 'Failed to load project'
			: null);

	const isSuperAdmin =
		sessionUser?.is_super_admin === true ||
		sessionUser?.is_super_admin === 1 ||
		sessionUser?.is_super_admin === '1';
	const canEditProjectContent =
		isSuperAdmin || can(RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
	const isEmployeeWorkspace = !isSuperAdmin && !canEditProjectContent;

	const visibleTabs = useMemo(
		() =>
			isEmployeeWorkspace
				? EMPLOYEE_TAB_IDS.map((tabId) =>
						EMPLOYEE_TAB_CONFIG.find((tab) => tab.id === tabId)
					).filter(Boolean)
				: TAB_CONFIG.filter(
						(tab) => !tab.requiresUpdate || canEditProjectContent
					),
		[canEditProjectContent, isEmployeeWorkspace]
	);

	const focusTab = useCallback(
		(index) => {
			const tab = visibleTabs[index];
			if (!tab) return;
			setActiveTab(tab.id);
			const focus = () => tabRefs.current[tab.id]?.focus();
			if (typeof window !== 'undefined' && window.requestAnimationFrame) {
				window.requestAnimationFrame(focus);
			} else {
				setTimeout(focus, 0);
			}
		},
		[visibleTabs]
	);

	const handleTabKeyDown = useCallback(
		(event, index) => {
			let nextIndex = null;
			if (event.key === 'ArrowRight')
				nextIndex = (index + 1) % visibleTabs.length;
			if (event.key === 'ArrowLeft')
				nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
			if (event.key === 'Home') nextIndex = 0;
			if (event.key === 'End') nextIndex = visibleTabs.length - 1;
			if (nextIndex === null || visibleTabs.length === 0) return;
			event.preventDefault();
			focusTab(nextIndex);
		},
		[focusTab, visibleTabs]
	);

	const isEmployeeRef = useRef(isEmployeeWorkspace);
	useEffect(() => {
		const resolved = TAB_ALIASES[activeTab] || activeTab;
		if (resolved !== activeTab) {
			setActiveTab(resolved);
			return;
		}
		// When the workspace flips (session loads), reset to that mode's
		// default tab instead of keeping a leftover default.
		if (isEmployeeRef.current !== isEmployeeWorkspace) {
			isEmployeeRef.current = isEmployeeWorkspace;
			setActiveTab(isEmployeeWorkspace ? 'scope' : 'project_details');
			return;
		}
		if (!visibleTabs.some((tab) => tab.id === activeTab)) {
			setActiveTab(
				visibleTabs[0]?.id ||
					(isEmployeeWorkspace ? 'scope' : 'project_details')
			);
		}
	}, [activeTab, isEmployeeWorkspace, visibleTabs]);

	const meetingDocuments = useMemo(() => {
		if (!project) return [];
		const docs = [];
		if (project.project_schedule) {
			docs.push({
				title: 'Project Schedule',
				content: project.project_schedule,
				type: 'text',
			});
		}
		if (project.input_document) {
			// Try JSON array format first
			let type = 'text';
			let parsed = null;
			try {
				const str = String(project.input_document).trim();
				if (str.startsWith('[')) {
					const arr = JSON.parse(str);
					if (Array.isArray(arr)) {
						type = 'list';
						parsed = arr;
					}
				}
			} catch {}
			if (type === 'list') {
				docs.push({ title: 'Input Documents', content: parsed, type: 'list' });
			} else {
				docs.push({
					title: 'Input Documents',
					content: project.input_document,
					type: 'text',
				});
			}
		}
		if (project.list_of_deliverables) {
			docs.push({
				title: 'List of Deliverables',
				content: project.list_of_deliverables,
				type: 'text',
			});
		}
		if (project.kickoff_meeting) {
			docs.push({
				title: 'Kickoff Meeting',
				content: project.kickoff_meeting,
				type: 'text',
			});
		}
		if (project.in_house_meeting) {
			docs.push({
				title: 'In House Meeting',
				content: project.in_house_meeting,
				type: 'text',
			});
		}
		return docs;
	}, [project]);

	// helpers for collapsible Project Details
	const [openSections, setOpenSections] = useState({
		basic: true,
		scope: true,
		deliverables: true,
	});

	const toggleSection = (key) =>
		setOpenSections((s) => ({ ...s, [key]: !s[key] }));

	const pick = useCallback(
		(keys = []) => {
			if (!project) return null;
			for (const k of keys) {
				const v = project[k];
				if (v !== undefined && v !== null && String(v).trim() !== '') return v;
			}
			return null;
		},
		[project]
	);

	const basicDetailsList = useMemo(() => {
		if (!project) return [];
		return [
			{
				label: 'Company Name',
				value: pick(['company_name', 'client_name', 'company']),
			},
			{
				label: 'Project Number',
				value: pick(['project_number', 'project_code', 'project_id']),
			},
			{ label: 'Project Name', value: pick(['name', 'project_name']) },
			{
				label: 'Project Duration',
				value: pick(['duration', 'project_duration']),
			},
			{
				label: 'Project Start Date',
				value: pick(['start_date', 'project_start_date']),
			},
			{
				label: 'Project End Date',
				value: pick(['end_date', 'project_end_date', 'target_date']),
			},
			{
				label: 'Estimated Manhours',
				value: pick(['estimated_manhours', 'manhours', 'estimated_hours']),
			},
			{ label: 'Project Type', value: pick(['type', 'project_type']) },
		];
	}, [pick, project]);

	const scopeField = useMemo(() => {
		return (
			pick(['scope_of_work', 'proposal_scope', 'scope', 'description']) || null
		);
	}, [pick]);

	const deliverablesField = useMemo(() => {
		// try several common field names and also fall back to list_of_deliverables
		return (
			pick([
				'deliverables',
				'list_of_deliverables',
				'proposal_deliverables',
				'proposal_items',
			]) || null
		);
	}, [pick]);

	// Parse JSON fields safely for rendering
	const parsedTeamMembers = useMemo(() => {
		if (!project) return [];
		for (const value of [project.project_team, project.team_members]) {
			if (!value) continue;
			try {
				const parsed = typeof value === 'string' ? JSON.parse(value) : value;
				if (Array.isArray(parsed)) return parsed;
			} catch {
				// Try the legacy field when the canonical team list is malformed.
			}
		}
		return [];
	}, [project]);

	const parsedProjectActivitiesList = useMemo(() => {
		if (!project || !project.project_activities_list) return [];
		try {
			return typeof project.project_activities_list === 'string'
				? JSON.parse(project.project_activities_list)
				: project.project_activities_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedDocumentsReceived = useMemo(() => {
		if (!project || !project.documents_received_list) return [];
		try {
			return typeof project.documents_received_list === 'string'
				? JSON.parse(project.documents_received_list)
				: project.documents_received_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedInputDocuments = useMemo(() => {
		if (!project) return [];
		const canonical = parseStoredList(project.input_documents_list);
		return canonical.length > 0
			? canonical
			: parseStoredList(project.input_document);
	}, [project]);
	// Merged view for Input Documents — show either list so edit saves are visible
	const parsedDocumentsReceivedCombined = useMemo(() => {
		const a = parsedDocumentsReceived || [];
		const b = parsedInputDocuments || [];
		if (a.length > 0 && b.length > 0) {
			const seen = new Set(
				a.map((x) => `${x.description || x.document_name}-${x.id}`)
			);
			const extra = b.filter(
				(x) => !seen.has(`${x.description || x.document_name}-${x.id}`)
			);
			return [...a, ...extra];
		}
		return a.length > 0 ? a : b;
	}, [parsedDocumentsReceived, parsedInputDocuments]);
	const parsedEmployeeDeliverables = useMemo(() => {
		if (!project) return [];
		const canonical = parseStoredList(project.documents_issued_list);
		if (canonical.length > 0) return canonical;
		return parseStoredList(deliverablesField);
	}, [deliverablesField, project]);

	// Documents issued / deliverables register — normalized rows with
	// legacy-key fallbacks so pre-reframe data renders in the same columns.
	const parsedDeliverablesRegister = useMemo(() => {
		return parsedEmployeeDeliverables
			.filter((d) => d && typeof d === 'object')
			.map((d) => ({
				...d,
				document_name:
					d.document_name || d.name || d.title || d.description || '',
				document_number: d.document_number || d.number || '',
				discipline: d.discipline || '',
				category: d.category || '',
				description: d.description || '',
				revision_number: d.revision_number || d.revision || '',
				status: d.status || d.issued_for || '',
				planned_date: d.planned_date || '',
				actual_date: d.actual_date || d.issue_date || d.date || '',
				prepared_by: d.prepared_by || '',
				checked_by: d.checked_by || '',
				approved_by: d.approved_by || '',
				client_approval: d.client_approval || '',
				remarks: d.remarks || '',
			}));
	}, [parsedEmployeeDeliverables]);

	const parsedProjectHandover = useMemo(() => {
		if (!project || !project.project_handover_list) return [];
		try {
			return typeof project.project_handover_list === 'string'
				? JSON.parse(project.project_handover_list)
				: project.project_handover_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedProjectManhours = useMemo(() => {
		if (!project || !project.project_manhours_list) return [];
		try {
			return typeof project.project_manhours_list === 'string'
				? JSON.parse(project.project_manhours_list)
				: project.project_manhours_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedQueryLog = useMemo(() => {
		if (!project || !project.project_query_log_list) return [];
		try {
			return typeof project.project_query_log_list === 'string'
				? JSON.parse(project.project_query_log_list)
				: project.project_query_log_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedAssumptions = useMemo(() => {
		if (!project || !project.project_assumption_list) return [];
		try {
			return typeof project.project_assumption_list === 'string'
				? JSON.parse(project.project_assumption_list)
				: project.project_assumption_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedLessonsLearnt = useMemo(() => {
		if (!project || !project.project_lessons_learnt_list) return [];
		try {
			return typeof project.project_lessons_learnt_list === 'string'
				? JSON.parse(project.project_lessons_learnt_list)
				: project.project_lessons_learnt_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedProjectSchedule = useMemo(() => {
		if (!project) return [];
		let parsed = project.project_schedule_list;
		if (typeof parsed === 'string') {
			try {
				parsed = JSON.parse(parsed);
			} catch {
				parsed = [];
			}
		}
		if (Array.isArray(parsed) && parsed.length > 0) return parsed;
		if (parsed && typeof parsed === 'object' && Array.isArray(parsed.rows)) {
			return parsed.rows;
		}
		return project.project_schedule
			? [{ description: project.project_schedule }]
			: [];
	}, [project]);

	const parsedKickoffMeetings = useMemo(() => {
		if (!project || !project.kickoff_meetings_list) return [];
		try {
			return typeof project.kickoff_meetings_list === 'string'
				? JSON.parse(project.kickoff_meetings_list)
				: project.kickoff_meetings_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedInternalMeetings = useMemo(() => {
		if (!project || !project.internal_meetings_list) return [];
		try {
			return typeof project.internal_meetings_list === 'string'
				? JSON.parse(project.internal_meetings_list)
				: project.internal_meetings_list;
		} catch {
			return [];
		}
	}, [project]);

	const parsedSoftwareItems = useMemo(() => {
		if (!project || !project.software_items) return [];
		try {
			const v =
				typeof project.software_items === 'string'
					? JSON.parse(project.software_items)
					: project.software_items;
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	}, [project]);

	if (loading) {
		return (
			<div className="min-h-screen bg-gray-50 flex flex-col">
				<Navbar />
				<LoadingSpinner
					message="Loading Project"
					subMessage="Fetching project details..."
					fullScreen={false}
				/>
			</div>
		);
	}

	if (error || !project) {
		return (
			<div className="min-h-screen bg-gray-50 flex flex-col">
				<Navbar />
				<div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-500 space-y-3 pt-16">
					<p>{error?.message || error || 'Project not found'}</p>
					<Link
						href="/projects"
						className="px-4 py-2 text-xs rounded-md bg-[#7F2487] text-white hover:bg-[#6b1e72] transition-colors"
					>
						Back to Projects
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen overflow-x-hidden bg-gray-50 text-gray-900">
			<Navbar />
			<div className="relative z-10">
				<div className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur-md">
					<header className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 xl:px-10">
						<div className="flex min-w-0 items-start gap-3">
							<Link
								href={isEmployeeWorkspace ? '/user/dashboard' : '/projects'}
								aria-label={
									isEmployeeWorkspace ? 'Back to dashboard' : 'Back to projects'
								}
								title={
									isEmployeeWorkspace ? 'Back to Dashboard' : 'Back to Projects'
								}
								className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors transition-transform hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 active:scale-[0.96]"
							>
								<ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
							</Link>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<h1 className="text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">
										Project Overview
									</h1>
									{project.name && (
										<span
											className="max-w-[20rem] truncate rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700 ring-1 ring-inset ring-purple-100 sm:max-w-[28rem]"
											title={project.name}
										>
											{project.name}
										</span>
									)}
								</div>
								<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
									{pick(['project_code', 'project_number']) && (
										<span>
											Code{' '}
											<span className="font-medium text-gray-700">
												{pick(['project_code', 'project_number'])}
											</span>
										</span>
									)}
									{pick(['client_name', 'company_name', 'company']) && (
										<span className="inline-flex items-center gap-2">
											<span
												className="h-1 w-1 rounded-full bg-gray-300"
												aria-hidden="true"
											/>
											<span className="max-w-[16rem] truncate">
												{pick(['client_name', 'company_name', 'company'])}
											</span>
										</span>
									)}
									{!isEmployeeWorkspace && (
										<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
											<span
												className="h-1.5 w-1.5 rounded-full bg-blue-500"
												aria-hidden="true"
											/>
											{project.status || 'Active'}
										</span>
									)}
								</div>
								{!isEmployeeWorkspace && project.description && (
									<p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-600">
										{project.description}
									</p>
								)}
							</div>
						</div>

						<div className="flex w-full flex-wrap items-center gap-2 border-t border-gray-100 pt-3 lg:w-auto lg:justify-end lg:border-t-0 lg:pt-0">
							{!isEmployeeWorkspace && canEditProjectContent && (
								<Link
									href={`/projects/${project.id ?? project.project_id ?? project.project_code}/edit`}
									className="inline-flex min-h-10 items-center justify-center rounded-lg bg-purple-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors transition-shadow transition-transform hover:bg-purple-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 active:scale-[0.96]"
								>
									Edit Project
								</Link>
							)}
							{!isEmployeeWorkspace && (
								<Link
									href="/masters/activities"
									className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors transition-transform hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 active:scale-[0.96]"
								>
									Configure Activity Library
									<ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
								</Link>
							)}
						</div>
					</header>

					<nav
						aria-label="Project sections"
						className="mx-auto max-w-[1800px] px-4 pb-3 sm:px-6 lg:px-8 xl:px-10"
					>
						<div className="overflow-x-scroll rounded-xl border border-gray-200 bg-gray-50 p-1 shadow-sm">
							<div
								role="tablist"
								aria-label="Project sections"
								className="flex min-w-max items-center gap-1"
							>
								{visibleTabs.map((t, index) => (
									<button
										id={`tab-${t.id}`}
										key={t.id}
										ref={(element) => {
											tabRefs.current[t.id] = element;
										}}
										type="button"
										role="tab"
										tabIndex={activeTab === t.id ? 0 : -1}
										aria-selected={activeTab === t.id}
										aria-controls={`panel-${t.id}`}
										onClick={() => setActiveTab(t.id)}
										onKeyDown={(event) => handleTabKeyDown(event, index)}
										className={`min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors transition-shadow transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 active:scale-[0.96] ${
											activeTab === t.id
												? 'bg-white text-purple-700 shadow-sm ring-1 ring-gray-200'
												: 'text-gray-600 hover:bg-white/80 hover:text-gray-950'
										}`}
									>
										{t.label}
									</button>
								))}
							</div>
						</div>
					</nav>
				</div>

				<div className="mx-auto max-w-[1800px] space-y-6 px-4 pb-12 pt-6 sm:px-6 lg:px-8 xl:px-10">
					{isEmployeeWorkspace && (
						<>
							<ProjectMemberDetails
								projectId={
									project.id ?? project.project_id ?? project.project_code
								}
								activeSection={
									[
										'assumption',
										'discussion',
										'query_log',
										'lessons_learnt',
									].includes(activeTab)
										? activeTab
										: null
								}
								projectTeamMembers={parsedTeamMembers}
								currentUser={
									sessionUser
										? {
												id: sessionUser.id,
												full_name: sessionUser.full_name,
												username: sessionUser.username,
											}
										: null
								}
							/>
							{activeTab === 'scope' && (
								<EmployeeScopePanel
									scope={scopeField}
									additionalScope={project.additional_scope}
								/>
							)}
							{activeTab === 'project_schedule' && (
								<EmployeeListPanel
									id="project_schedule"
									title="Schedule"
									subtitle="Planned activities and milestone dates"
									Icon={CalendarIcon}
									items={parsedProjectSchedule}
									emptyMessage="No schedule items recorded."
									renderItem={(item, index) => (
										<>
											<h3 className="text-sm font-semibold text-gray-900">
												{employeeItemLabel(item, `Schedule ${index + 1}`)}
											</h3>
											<p className="mt-2 text-sm text-gray-600">
												{item?.start_date || item?.startDate || '—'} →{' '}
												{item?.end_date || item?.endDate || '—'}
											</p>
											{item?.remarks || item?.remark ? (
												<p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
													{item.remarks || item.remark}
												</p>
											) : null}
										</>
									)}
								/>
							)}
							{(activeTab === 'input_document' ||
								activeTab === 'documents_received') && (
								<EmployeeListPanel
									id="documents_received"
									title="Input Document"
									subtitle="Documents received from the client"
									Icon={DocumentTextIcon}
									items={parsedDocumentsReceivedCombined}
									emptyMessage="No input documents recorded."
									renderItem={(item, index) => (
										<p className="whitespace-pre-wrap text-sm text-gray-700">
											{employeeItemLabel(item, `Input document ${index + 1}`)}
										</p>
									)}
								/>
							)}
							{(activeTab === 'deliverables' ||
								activeTab === 'documents_issued') &&
								(parsedDeliverablesRegister.length > 0 ? (
									<EmployeePanel
										id="documents_issued"
										title="Deliverables"
										subtitle="Deliverables issued to the client"
										Icon={DocumentTextIcon}
									>
										<DeliverablesRegisterTable
											rows={parsedDeliverablesRegister}
										/>
									</EmployeePanel>
								) : (
									<EmployeeListPanel
										id="documents_issued"
										title="Deliverables"
										subtitle="Deliverables issued to the client"
										Icon={DocumentTextIcon}
										items={parsedEmployeeDeliverables}
										emptyMessage="No deliverables recorded."
										renderItem={(item, index) => (
											<p className="whitespace-pre-wrap text-sm text-gray-700">
												{employeeItemLabel(item, `Deliverable ${index + 1}`)}
											</p>
										)}
									/>
								))}
							{(activeTab === 'team' || activeTab === 'project_team') && (
								<EmployeePanel
									id="project_team"
									title="Project Team"
									subtitle="Members assigned to this project"
									Icon={UserIcon}
								>
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
										<p className="text-sm text-gray-700">
											<span className="font-semibold text-gray-900">
												Project manager:
											</span>{' '}
											{project.project_manager || '—'}
										</p>
										<p className="text-sm text-gray-700">
											<span className="font-semibold text-gray-900">
												Primary client:
											</span>{' '}
											{project.client_name || '—'}
										</p>
										<p className="text-sm text-gray-700">
											<span className="font-semibold text-gray-900">
												Assigned to:
											</span>{' '}
											{project.assigned_to || '—'}
										</p>
									</div>
									{parsedTeamMembers.length > 0 ? (
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											{parsedTeamMembers.map((member, index) => (
												<article
													key={member.id || member.user_id || index}
													className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
												>
													<h3 className="text-sm font-semibold text-gray-900">
														{employeeItemLabel(
															member,
															`Team member ${index + 1}`
														)}
													</h3>
													{member.role || member.designation ? (
														<p className="mt-1 text-xs text-gray-500">
															{member.role || member.designation}
														</p>
													) : null}
												</article>
											))}
										</div>
									) : (
										<EmployeeEmpty>
											No project team members recorded.
										</EmployeeEmpty>
									)}
								</EmployeePanel>
							)}
						</>
					)}
					{activeTab === 'project_details' && (
						<section
							id="panel-project_details"
							role="tabpanel"
							aria-labelledby="tab-project_details"
							className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
						>
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<BuildingOffice2Icon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											General Project Information
										</h2>
										<p className="text-xs text-gray-500">
											Core project details and metadata
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-4">
								{/* Basic Details (collapsible) */}
								<div className="border-t border-gray-200 pt-4">
									<button
										type="button"
										onClick={() => toggleSection('basic')}
										className="w-full flex items-center justify-between focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7F2487] rounded-lg py-1"
									>
										<div className="flex items-center gap-2">
											<BuildingOffice2Icon className="h-5 w-5 text-purple-600" />
											<h3 className="text-base font-bold text-gray-900">
												Basic Details
											</h3>
										</div>
										<div className="text-sm text-gray-500">
											{openSections.basic ? 'Hide' : 'Show'}
										</div>
									</button>
									{openSections.basic && (
										<div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
											{basicDetailsList.map((item) => (
												<div
													key={item.label}
													className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
												>
													<p className="text-xs text-gray-500 uppercase tracking-wide">
														{item.label}
													</p>
													<p className="text-sm font-medium text-gray-900 mt-1">
														{item.value ?? '—'}
													</p>
												</div>
											))}
										</div>
									)}
								</div>

								{/* Deliverables (collapsible) */}
								<div className="border-t border-gray-200 pt-4">
									<button
										type="button"
										onClick={() => toggleSection('deliverables')}
										className="w-full flex items-center justify-between focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7F2487] rounded-lg py-1"
									>
										<div className="flex items-center gap-2">
											<DocumentTextIcon className="h-5 w-5 text-purple-600" />
											<h3 className="text-base font-bold text-gray-900">
												Deliverables
											</h3>
										</div>
										<div className="text-sm text-gray-500">
											{openSections.deliverables ? 'Hide' : 'Show'}
										</div>
									</button>
									{openSections.deliverables && (
										<div className="mt-3 space-y-3">
											{deliverablesField ? (
												<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
													<p className="text-sm text-gray-600 whitespace-pre-line">
														{deliverablesField}
													</p>
												</div>
											) : meetingDocuments.length > 0 ? (
												meetingDocuments.map((doc) => (
													<div
														key={doc.title}
														className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
													>
														<h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
															{doc.title}
														</h4>
														{doc.type === 'list' ? (
															<div className="mt-2 space-y-2">
																{doc.content.map((d, idx) => (
																	<div
																		key={d.id || idx}
																		className="flex items-center gap-3"
																	>
																		<DocumentTextIcon className="h-4 w-4 text-purple-600" />
																		{d.fileUrl ? (
																			<a
																				href={d.fileUrl}
																				target="_blank"
																				rel="noopener noreferrer"
																				className="text-sm text-purple-700 hover:underline"
																			>
																				{d.name || d.text}
																			</a>
																		) : (
																			<span className="text-sm text-gray-700">
																				{d.name || d.text}
																			</span>
																		)}
																		{d.thumbUrl && (
																			<Image
																				src={d.thumbUrl}
																				alt={d.name || 'thumb'}
																				width={32}
																				height={32}
																				className="h-8 w-8 rounded object-cover border border-gray-200"
																			/>
																		)}
																	</div>
																))}
															</div>
														) : (
															<p className="text-sm text-gray-600 mt-2 whitespace-pre-line">
																{doc.content}
															</p>
														)}
													</div>
												))
											) : (
												<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
													No deliverables captured. Import deliverables from the
													linked proposal or add them in the edit view.
												</p>
											)}
										</div>
									)}
								</div>
							</div>
						</section>
					)}

					{/* Meeting Tab (read-only) — kickoff + internal meetings */}
					{!isEmployeeWorkspace && activeTab === 'minutes_internal_meet' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<ClipboardDocumentCheckIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Project Meetings
										</h2>
										<p className="text-xs text-gray-500">
											Kickoff meeting and internal project meetings
										</p>
									</div>
								</div>
							</div>
							<div className="space-y-6 px-6 py-5">
								<div>
									<h3 className="mb-3 text-sm font-semibold text-gray-900">
										Project Kickoff Meetings
									</h3>
									{parsedKickoffMeetings.length > 0 ? (
										<div className="space-y-3">
											{parsedKickoffMeetings.map((m, i) => (
												<div
													key={m.id || i}
													className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
												>
													<h4 className="text-sm font-semibold text-gray-900">
														{m.meeting_title || `Kickoff Meeting ${i + 1}`}
													</h4>
													<p className="mt-1 text-xs text-gray-500">
														{[m.meeting_no, m.meeting_date]
															.filter(Boolean)
															.join(' · ') || '—'}
													</p>
													<div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
														{m.organizer ? (
															<p>
																<span className="font-semibold text-gray-900">
																	Organizer:
																</span>{' '}
																{m.organizer}
															</p>
														) : null}
														{m.client_representative ? (
															<p>
																<span className="font-semibold text-gray-900">
																	Client Rep:
																</span>{' '}
																{m.client_representative}
															</p>
														) : null}
														{m.meeting_location ? (
															<p>
																<span className="font-semibold text-gray-900">
																	Location:
																</span>{' '}
																{m.meeting_location}
															</p>
														) : null}
													</div>
													{m.points_discussed ? (
														<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
															<span className="font-semibold text-gray-900">
																Points:
															</span>{' '}
															{m.points_discussed}
														</p>
													) : null}
													{m.persons_involved ? (
														<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
															<span className="font-semibold text-gray-900">
																Participants:
															</span>{' '}
															{m.persons_involved}
														</p>
													) : null}
													{m.mom_document?.file_url ? (
														<a
															href={m.mom_document.file_url}
															target="_blank"
															rel="noopener noreferrer"
															className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-purple-700 hover:underline"
														>
															{m.mom_document.original_name || 'MOM document'}
														</a>
													) : null}
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
											No kickoff meetings recorded.
										</p>
									)}
								</div>
								<div>
									<h3 className="mb-3 text-sm font-semibold text-gray-900">
										Internal Project Meetings
									</h3>
									{parsedInternalMeetings.length > 0 ? (
										<div className="space-y-3">
											{parsedInternalMeetings.map((m, i) => (
												<div
													key={m.id || i}
													className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
												>
													<h4 className="text-sm font-semibold text-gray-900">
														{m.meeting_title || `Internal Meeting ${i + 1}`}
													</h4>
													<p className="mt-1 text-xs text-gray-500">
														{[m.meeting_no, m.meeting_date]
															.filter(Boolean)
															.join(' · ') || '—'}
													</p>
													<div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
														{m.organizer ? (
															<p>
																<span className="font-semibold text-gray-900">
																	Organizer:
																</span>{' '}
																{m.organizer}
															</p>
														) : null}
														{m.meeting_location ? (
															<p>
																<span className="font-semibold text-gray-900">
																	Location:
																</span>{' '}
																{m.meeting_location}
															</p>
														) : null}
													</div>
													{m.points_discussed ? (
														<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
															<span className="font-semibold text-gray-900">
																Points:
															</span>{' '}
															{m.points_discussed}
														</p>
													) : null}
													{m.persons_involved ? (
														<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
															<span className="font-semibold text-gray-900">
																Participants:
															</span>{' '}
															{m.persons_involved}
														</p>
													) : null}
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
											No internal meetings recorded.
										</p>
									)}
								</div>
							</div>
						</section>
					)}

					{/* Scope Tab - Enhanced with Original + Additional Scope */}
					{!isEmployeeWorkspace && activeTab === 'scope' && (
						<section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
							{/* Header */}
							<div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-purple-100">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="p-2 bg-purple-100 rounded-lg">
											<DocumentTextIcon className="h-5 w-5 text-[#7F2487]" />
										</div>
										<div>
											<h2 className="text-lg font-bold text-gray-900">
												Scope of Work
											</h2>
											<p className="text-xs text-gray-500">
												Project scope details and amendments
											</p>
										</div>
									</div>
									{/* Scope Summary Badges */}
									<div className="flex items-center gap-2">
										<span
											className={`px-3 py-1 rounded-full text-xs font-medium ${scopeField ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
										>
											{scopeField
												? 'Original Scope Defined'
												: 'No Original Scope'}
										</span>
										{project.additional_scope && (
											<span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
												Additional Scope Added
											</span>
										)}
									</div>
								</div>
							</div>

							<div className="px-6 py-6 space-y-6">
								{/* Original Scope Section */}
								<div className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl p-5 border border-gray-200">
									<div className="flex items-center gap-2 mb-3">
										<span className="inline-flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
											1
										</span>
										<label className="text-sm font-bold text-gray-800">
											Original Project Scope
										</label>
										<span className="text-xs text-gray-400 ml-2">
											(from Proposal)
										</span>
									</div>
									<div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm min-h-[100px]">
										{scopeField ? (
											<HtmlContent html={scopeField} />
										) : (
											<div className="flex flex-col items-center justify-center py-6 text-gray-400">
												<DocumentTextIcon className="h-8 w-8 mb-2" />
												<p className="text-sm">No original scope defined yet</p>
												<p className="text-xs">
													Scope will be fetched from linked proposal
												</p>
											</div>
										)}
									</div>
								</div>

								{/* Additional Scope Section */}
								<div className="bg-gradient-to-br from-amber-50/50 to-orange-50/30 rounded-xl p-5 border border-amber-200">
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-2">
											<span className="inline-flex items-center justify-center w-6 h-6 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">
												2
											</span>
											<label className="text-sm font-bold text-gray-800">
												Additional Scope Items
											</label>
											<span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
												Change Orders / Variations
											</span>
										</div>
										{project.additional_scope &&
											(() => {
												const items = project.additional_scope
													.split('\n')
													.filter((item) => item.trim());
												return (
													items.length > 0 && (
														<span className="text-xs text-green-600 flex items-center gap-1">
															<CheckCircleIcon className="w-4 h-4" />
															{items.length} item{items.length > 1 ? 's' : ''}
														</span>
													)
												);
											})()}
									</div>
									<div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
										{project.additional_scope ? (
											(() => {
												const items = project.additional_scope
													.split('\n')
													.filter((item) => item.trim());
												if (items.length === 0) {
													return (
														<div className="p-6 text-center text-gray-400">
															<DocumentTextIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
															<p className="text-sm">
																No additional scope items added
															</p>
														</div>
													);
												}
												return (
													<ul className="divide-y divide-amber-100">
														{items.map((item, idx) => (
															<li
																key={idx}
																className="flex items-start gap-3 px-4 py-3"
															>
																<span className="flex-shrink-0 w-5 h-5 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
																	{idx + 1}
																</span>
																<span className="flex-1 text-sm text-gray-700">
																	{item.replace(/^[•\-\*]\s*/, '')}
																</span>
															</li>
														))}
													</ul>
												);
											})()
										) : (
											<div className="p-6 text-center text-gray-400">
												<DocumentTextIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
												<p className="text-sm">
													No additional scope items added
												</p>
												<p className="text-xs mt-1">
													Use the Edit view to add scope amendments
												</p>
											</div>
										)}
									</div>
								</div>

								{/* Combined Scope Preview */}
								{(scopeField || project.additional_scope) && (
									<div className="bg-gradient-to-br from-purple-50/50 to-blue-50/30 rounded-xl p-5 border border-purple-200">
										<div className="flex items-center gap-2 mb-3">
											<span className="inline-flex items-center justify-center w-6 h-6 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">
												📋
											</span>
											<label className="text-sm font-bold text-gray-800">
												Complete Scope Overview
											</label>
										</div>
										<div className="bg-white rounded-lg p-4 border border-purple-100 shadow-sm space-y-4">
											{scopeField && (
												<div>
													<p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">
														Original Scope
													</p>
													<HtmlContent html={scopeField} />
												</div>
											)}
											{project.additional_scope && (
												<div
													className={
														scopeField ? 'pt-3 border-t border-gray-200' : ''
													}
												>
													<p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2">
														Additional Scope Items
													</p>
													<ul className="space-y-1.5">
														{project.additional_scope
															.split('\n')
															.filter((item) => item.trim())
															.map((item, idx) => (
																<li
																	key={idx}
																	className="flex items-start gap-2 text-sm text-gray-700"
																>
																	<span className="text-amber-500 mt-0.5">
																		•
																	</span>
																	<span>{item.replace(/^[•\-\*]\s*/, '')}</span>
																</li>
															))}
													</ul>
												</div>
											)}
										</div>
									</div>
								)}
							</div>
						</section>
					)}

					{/* Commercial Tab */}
					<section
						id="panel-commercial"
						role="tabpanel"
						aria-labelledby="tab-commercial"
						hidden={activeTab !== 'commercial'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<TagIcon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Commercial Information
							</h2>
						</div>
						<div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Project Value
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.project_value
										? new Intl.NumberFormat('en-IN', {
												style: 'currency',
												currency: project.currency || 'INR',
											}).format(project.project_value)
										: '—'}
								</p>
							</div>
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Currency
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.currency || '—'}
								</p>
							</div>
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Payment Terms
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.payment_terms || '—'}
								</p>
							</div>
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Invoicing Status
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.invoicing_status || '—'}
								</p>
							</div>
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Cost to Company
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.cost_to_company
										? new Intl.NumberFormat('en-IN', {
												style: 'currency',
												currency: project.currency || 'INR',
											}).format(project.cost_to_company)
										: '—'}
								</p>
							</div>
							<div className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4">
								<p className="text-xs text-gray-500 uppercase tracking-wide">
									Profitability Estimate
								</p>
								<p className="text-sm font-medium text-gray-900 mt-1">
									{project.profitability_estimate
										? `${project.profitability_estimate}%`
										: '—'}
								</p>
							</div>
						</div>
					</section>

					{/* Project Activities Tab */}
					<section
						id="panel-activities"
						role="tabpanel"
						aria-labelledby="tab-activities"
						hidden={activeTab !== 'activities'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<ClipboardDocumentCheckIcon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Project Activities
							</h2>
						</div>
						<div className="px-6 py-5">
							{parsedProjectActivitiesList &&
							parsedProjectActivitiesList.length > 0 ? (
								<div className="space-y-3">
									{parsedProjectActivitiesList.map((act, idx) => (
										<div
											key={idx}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<h4 className="text-base font-bold text-gray-900">
												{act.activity || act.name || `Activity ${idx + 1}`}
											</h4>
											{act.description ? (
												<p className="text-sm text-gray-600 mt-2 whitespace-pre-line">
													{act.description}
												</p>
											) : null}
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
									No project activities captured. Use the edit view to add
									activities, disciplines and assignments.
								</p>
							)}
						</div>
					</section>

					{/* Documents Received Tab (read-only, same source as edit) - admin only, employee uses panel above */}
					{!isEmployeeWorkspace &&
						(activeTab === 'documents_received' ||
							activeTab === 'input_document' ||
							activeTab === 'input_documents') && (
							<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
								<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
									<div className="flex items-center gap-3">
										<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
											<DocumentTextIcon
												className="h-4 w-4 text-purple-600"
												aria-hidden="true"
											/>
										</div>
										<div>
											<h2 className="text-base font-semibold tracking-tight text-gray-900">
												List of Documents Received
											</h2>
											<p className="text-xs text-gray-500">
												Record documents received with details (same as edit)
											</p>
										</div>
									</div>
								</div>
								<div className="px-6 py-5 space-y-3">
									{parsedDocumentsReceivedCombined &&
									parsedDocumentsReceivedCombined.length > 0 ? (
										parsedDocumentsReceivedCombined.map((d, i) => (
											<div
												key={d.id || i}
												className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
											>
												<div className="flex items-start justify-between">
													<div>
														<h4 className="text-base font-bold text-gray-900">
															{d.description ||
																d.document_name ||
																`Document ${i + 1}`}
														</h4>
														<p className="text-xs text-gray-500 mt-1">
															Sr. No: {d.sr_no || d.id || i + 1}
														</p>
													</div>
													<div className="text-sm text-gray-600 text-right">
														<div>
															{d.date_received || d.received_date || '—'}
														</div>
														<div className="text-xs text-gray-500">
															{d.document_sent_by || ''}
														</div>
													</div>
												</div>
												{d.remarks ? (
													<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
														{d.remarks}
													</p>
												) : null}
											</div>
										))
									) : (
										<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
											No documents received recorded.
										</p>
									)}
								</div>
							</section>
						)}

					{/* Documents Issued Tab (read-only) — deliverables register, admin only */}
					{!isEmployeeWorkspace && activeTab === 'documents_issued' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											List of Deliverables
										</h2>
										<p className="text-xs text-gray-500">
											Track deliverables issued to client
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5">
								{parsedDeliverablesRegister.length > 0 ? (
									<DeliverablesRegisterTable
										rows={parsedDeliverablesRegister}
									/>
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No deliverables recorded.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Project Handover Tab (read-only) */}
					{activeTab === 'project_handover' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Project Handover
										</h2>
										<p className="text-xs text-gray-500">
											Outputs handed over to the client
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-3">
								{parsedProjectHandover && parsedProjectHandover.length > 0 ? (
									parsedProjectHandover.map((r, i) => (
										<div
											key={r.id || i}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<div className="flex items-start justify-between">
												<div>
													<h4 className="text-base font-bold text-gray-900">
														{r.output_by_accent ||
															r.item ||
															`Handover ${i + 1}`}
													</h4>
													<p className="text-xs text-gray-500 mt-1">
														Sr. No: {r.sr_no || i + 1}
													</p>
												</div>
												<div className="text-sm text-gray-600 text-right">
													Requirement done:{' '}
													{r.requirement_accomplished || r.done || '—'}
												</div>
											</div>
											{r.remark ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{r.remark}
												</p>
											) : null}
										</div>
									))
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No handover records added.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Project Manhours Tab (read-only) — same table as edit, no inputs */}
					{activeTab === 'project_manhours' &&
						(() => {
							const fyMonths = [
								'Apr',
								'May',
								'Jun',
								'Jul',
								'Aug',
								'Sep',
								'Oct',
								'Nov',
								'Dec',
								'Jan',
								'Feb',
								'Mar',
							];
							const fyMonthKeys = fyMonths.map((m) => m.toLowerCase());
							const rows = Array.isArray(parsedProjectManhours)
								? parsedProjectManhours
								: [];
							const totals = rows.reduce(
								(acc, emp) => {
									const hrs = add(...Object.values(emp.monthly_hours || {}));
									acc.hours = add(acc.hours, hrs);
									acc.company = add(acc.company, mul(emp.rate_company, hrs));
									acc.accent = add(acc.accent, mul(emp.rate_accent, hrs));
									return acc;
								},
								{ hours: add(), company: add(), accent: add() }
							);
							const totalPl = sub(totals.accent, totals.company);
							const inrFormat = (v) =>
								toNumber(v).toLocaleString('en-IN', {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								});
							if (rows.length === 0) {
								return (
									<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
										<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
													<CalendarIcon
														className="h-4 w-4 text-purple-600"
														aria-hidden="true"
													/>
												</div>
												<div>
													<h2 className="text-base font-semibold tracking-tight text-gray-900">
														Project Manhours
													</h2>
													<p className="text-xs text-gray-500">
														Monthly manhours by team member (same as edit)
													</p>
												</div>
											</div>
										</div>
										<div className="px-6 py-5">
											<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
												No manhours recorded.
											</p>
										</div>
									</section>
								);
							}
							return (
								<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
									<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
										<div className="flex items-center gap-3">
											<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
												<CalendarIcon
													className="h-4 w-4 text-purple-600"
													aria-hidden="true"
												/>
											</div>
											<div>
												<h2 className="text-base font-semibold tracking-tight text-gray-900">
													Project Manhours
												</h2>
												<p className="text-xs text-gray-500">
													Monthly manhours by team member — read-only (edit in
													Project → Edit → Manhours)
												</p>
											</div>
										</div>
									</div>
									<div className="px-4 py-4">
										<div className="overflow-x-auto border border-gray-200 rounded-lg">
											<table className="w-full text-xs border-collapse">
												<thead>
													<tr className="bg-gradient-to-r from-purple-50 to-gray-50">
														<th
															className="text-left py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 sticky left-0 bg-purple-50 z-10"
															style={{ minWidth: '140px' }}
														>
															Team Member
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-50"
															style={{ minWidth: '80px' }}
														>
															Salary Type
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50"
															style={{ minWidth: '90px' }}
														>
															RT/HR (Company)
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-50"
															style={{ minWidth: '90px' }}
														>
															RT/HR (Accent)
														</th>
														{fyMonths.map((m) => (
															<th
																key={m}
																className="text-center py-2 px-1 font-semibold text-gray-700 border-b border-gray-200 bg-amber-50/50"
																style={{ minWidth: '50px' }}
															>
																{m}
															</th>
														))}
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-purple-100"
															style={{ minWidth: '70px' }}
														>
															Total Hrs
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-green-100"
															style={{ minWidth: '100px' }}
														>
															Company Cost
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-blue-100"
															style={{ minWidth: '100px' }}
														>
															Accent Cost
														</th>
														<th
															className="text-center py-2 px-2 font-semibold text-gray-700 border-b border-gray-200 bg-gray-100"
															style={{ minWidth: '100px' }}
														>
															P&L
														</th>
													</tr>
												</thead>
												<tbody>
													{rows.map((empData, idx) => {
														const monthlyHours = empData.monthly_hours || {};
														const totalHrs = add(
															...Object.values(monthlyHours)
														);
														const companyCost = mul(
															empData.rate_company,
															totalHrs
														);
														const accentCost = mul(
															empData.rate_accent,
															totalHrs
														);
														const pl = sub(accentCost, companyCost);
														return (
															<tr
																key={empData.id || idx}
																className="border-b border-gray-100 hover:bg-gray-50/50"
															>
																<td className="py-2 px-2 font-medium text-gray-800 sticky left-0 bg-white z-10 border-r border-gray-100">
																	<span className="text-gray-400 text-[10px] mr-1">
																		{idx + 1}.
																	</span>
																	{empData.employee_name ||
																		empData.name_of_engineer_designer ||
																		empData.name ||
																		`Member ${idx + 1}`}
																</td>
																<td className="py-2 px-2 text-center bg-green-50/30">
																	<span
																		className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${empData.salary_type === 'hourly' ? 'bg-orange-100 text-orange-700' : empData.salary_type === 'daily' ? 'bg-green-100 text-green-700' : empData.salary_type === 'custom' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}
																	>
																		{empData.salary_type || 'monthly'}
																	</span>
																</td>
																<td className="py-2 px-2 text-center bg-blue-50/30 font-medium">
																	{empData.rate_company ?? '—'}
																</td>
																<td className="py-2 px-2 text-center bg-blue-50/30 font-medium">
																	{empData.rate_accent ?? '—'}
																</td>
																{fyMonthKeys.map((mk) => (
																	<td
																		key={mk}
																		className="py-2 px-1 text-center bg-amber-50/20"
																	>
																		{monthlyHours[mk] != null &&
																		String(monthlyHours[mk]).trim() !== ''
																			? Number(monthlyHours[mk]).toFixed(1)
																			: '—'}
																	</td>
																))}
																<td className="py-2 px-2 text-center font-semibold text-purple-700 bg-purple-50/50">
																	{totalHrs.toFixed(1)}
																</td>
																<td className="py-2 px-2 text-center font-semibold text-green-700 bg-green-50/50">
																	₹{inrFormat(companyCost)}
																</td>
																<td className="py-2 px-2 text-center font-semibold text-blue-700 bg-blue-50/50">
																	₹{inrFormat(accentCost)}
																</td>
																<td className="py-2 px-2 text-center bg-gray-50/50">
																	<span
																		className={`font-semibold ${pl.gt(0) ? 'text-green-700' : pl.lt(0) ? 'text-red-600' : 'text-gray-400'}`}
																	>
																		₹{inrFormat(pl)}
																	</span>
																</td>
															</tr>
														);
													})}
													<tr className="bg-gradient-to-r from-purple-100 to-gray-100 font-semibold">
														<td className="py-2 px-2 text-gray-800 sticky left-0 bg-purple-100 z-10 border-r border-gray-200">
															Grand Total
														</td>
														<td className="py-2 px-2 bg-green-100/50"></td>
														<td className="py-2 px-2 bg-blue-100/50"></td>
														<td className="py-2 px-2 bg-blue-100/50"></td>
														{fyMonthKeys.map((mk) => {
															const mt = add(
																...rows.map((e) => e.monthly_hours?.[mk])
															);
															return (
																<td
																	key={mk}
																	className="py-2 px-1 text-center text-gray-700 bg-amber-100/50"
																>
																	{mt.gt(0) ? mt.toFixed(1) : '—'}
																</td>
															);
														})}
														<td className="py-2 px-2 text-center text-purple-800 bg-purple-200/50">
															{totals.hours.toFixed(1)}
														</td>
														<td className="py-2 px-2 text-center text-green-800 bg-green-200/50">
															₹{inrFormat(totals.company)}
														</td>
														<td className="py-2 px-2 text-center text-blue-800 bg-blue-200/50">
															₹{inrFormat(totals.accent)}
														</td>
														<td className="py-2 px-2 text-center bg-gray-100/50">
															<span
																className={`font-semibold ${totalPl.gt(0) ? 'text-green-800' : totalPl.lt(0) ? 'text-red-700' : 'text-gray-500'}`}
															>
																₹{inrFormat(totalPl)}
															</span>
														</td>
													</tr>
												</tbody>
											</table>
										</div>
									</div>
								</section>
							);
						})()}

					{/* Query Log Tab (read-only) */}
					{!isEmployeeWorkspace && activeTab === 'query_log' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Query Log
										</h2>
										<p className="text-xs text-gray-500">
											Log project queries and responses
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-3">
								{parsedQueryLog && parsedQueryLog.length > 0 ? (
									parsedQueryLog.map((q, i) => (
										<div
											key={q.id || i}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<div className="flex items-start justify-between">
												<div>
													<h4 className="text-base font-bold text-gray-900">
														{q.query_description || `Query ${i + 1}`}
													</h4>
													<p className="text-xs text-gray-500 mt-1">
														Issued: {q.query_issued_date || '—'}
													</p>
												</div>
												<div className="text-sm text-gray-600 text-right">
													Resolved: {q.query_resolved || '—'}
												</div>
											</div>
											{q.remark ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{q.remark}
												</p>
											) : null}
											{q.reply_from_client ? (
												<p className="mt-2 text-sm text-gray-600">
													<strong>Reply:</strong> {q.reply_from_client}
												</p>
											) : null}
										</div>
									))
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No queries logged.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Assumption Tab (read-only) */}
					{!isEmployeeWorkspace && activeTab === 'assumption' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Assumptions
										</h2>
										<p className="text-xs text-gray-500">
											Record project assumptions and rationale
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-3">
								{parsedAssumptions && parsedAssumptions.length > 0 ? (
									parsedAssumptions.map((a, i) => (
										<div
											key={a.id || i}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<div className="flex items-start justify-between">
												<div>
													<h4 className="text-base font-bold text-gray-900">
														{a.assumption_description || `Assumption ${i + 1}`}
													</h4>
													<p className="text-xs text-gray-500 mt-1">
														Sr. No: {a.sr_no || i + 1}
													</p>
												</div>
												<div className="text-sm text-gray-600 text-right">
													Taken By: {a.assumption_taken_by || '—'}
												</div>
											</div>
											{a.reason ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{a.reason}
												</p>
											) : null}
											{a.remark ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{a.remark}
												</p>
											) : null}
										</div>
									))
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No assumptions recorded.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Lessons Learnt Tab (read-only) */}
					{!isEmployeeWorkspace && activeTab === 'lessons_learnt' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Lessons Learnt
										</h2>
										<p className="text-xs text-gray-500">
											Capture learning from the project
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-3">
								{parsedLessonsLearnt && parsedLessonsLearnt.length > 0 ? (
									parsedLessonsLearnt.map((l, i) => (
										<div
											key={l.id || i}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<div className="flex items-start justify-between">
												<div>
													<h4 className="text-base font-bold text-gray-900">
														{l.what_was_new || `Lesson ${i + 1}`}
													</h4>
													<p className="text-xs text-gray-500 mt-1">
														Sr. No: {l.sr_no || i + 1}
													</p>
												</div>
											</div>
											{l.difficulty_faced ? (
												<p className="mt-2 text-sm text-gray-600">
													<strong>Difficulty:</strong> {l.difficulty_faced}
												</p>
											) : null}
											{l.what_you_learn ? (
												<p className="mt-2 text-sm text-gray-600">
													<strong>Learned:</strong> {l.what_you_learn}
												</p>
											) : null}
											{l.areas_of_improvement ? (
												<p className="mt-2 text-sm text-gray-600">
													<strong>Improvements:</strong>{' '}
													{l.areas_of_improvement}
												</p>
											) : null}
											{l.remark ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{l.remark}
												</p>
											) : null}
										</div>
									))
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No lessons recorded.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Project Schedule (read-only) */}
					{!isEmployeeWorkspace && activeTab === 'project_schedule' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<CalendarIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Project Schedule
										</h2>
										<p className="text-xs text-gray-500">
											Planned activities and milestone dates
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5 space-y-3">
								{parsedProjectSchedule && parsedProjectSchedule.length > 0 ? (
									parsedProjectSchedule.map((s, i) => (
										<div
											key={s.id || i}
											className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
										>
											<div className="flex items-start justify-between">
												<div>
													<h4 className="text-base font-bold text-gray-900">
														{s.activity_description ||
															s.activity ||
															`Schedule ${i + 1}`}
													</h4>
													<p className="text-xs text-gray-500 mt-1">
														Sr. No: {s.sr_no || i + 1}
													</p>
												</div>
												<div className="text-sm text-gray-600 text-right">
													{s.start_date || '—'} → {s.end_date || '—'}
												</div>
											</div>
											{s.remarks ? (
												<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
													{s.remarks}
												</p>
											) : null}
										</div>
									))
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No schedule items captured.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Project Activity Tab — shows all team members' activity assignments */}
					{activeTab === 'project_activity' && (
						<ProjectActivityTab projectId={project.id ?? project.project_id} />
					)}

					{/* Upload Documents Tab */}
					{activeTab === 'upload_documents' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Upload Documents
										</h2>
										<p className="text-xs text-gray-500">
											Attach documents to this project
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5">
								<DocumentUpload
									entityType="project"
									entityId={project.id ?? project.project_id}
								/>
							</div>
						</section>
					)}

					{/* Software Tab (read-only, same data as edit's Software) */}
					{activeTab === 'software' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Software
										</h2>
										<p className="text-xs text-gray-500">
											Software used in this project (same as edit)
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5">
								{parsedSoftwareItems.length > 0 ? (
									<div className="space-y-3">
										{parsedSoftwareItems.map((s, i) => (
											<div
												key={s.id || i}
												className="bg-white border border-gray-200/60 shadow-sm rounded-xl px-5 py-4"
											>
												<h4 className="text-sm font-semibold text-gray-900">
													{s.software_name || s.name || `Software ${i + 1}`}
												</h4>
												<p className="text-xs text-gray-500 mt-1">
													{[s.category_name, s.version_name]
														.filter(Boolean)
														.join(' · ') ||
														s.provider ||
														'—'}
												</p>
												{s.notes ? (
													<p className="mt-2 text-sm text-gray-600 whitespace-pre-line">
														{s.notes}
													</p>
												) : null}
											</div>
										))}
									</div>
								) : (
									<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
										No software recorded. Edit this project to add software.
									</p>
								)}
							</div>
						</section>
					)}

					{/* Discussion Tab (read-only, same thread as edit) */}
					{activeTab === 'discussion' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<ChatBubbleLeftRightIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Discussion
										</h2>
										<p className="text-xs text-gray-500">
											Project discussion (same as edit)
										</p>
									</div>
								</div>
							</div>
							<div className="px-6 py-5">
								<ProjectMemberDetails
									projectId={
										project.id ?? project.project_id ?? project.project_code
									}
									activeSection="discussion"
									projectTeamMembers={parsedTeamMembers}
									currentUser={
										sessionUser
											? {
													id: sessionUser.id,
													full_name: sessionUser.full_name,
													username: sessionUser.username,
												}
											: null
									}
								/>
							</div>
						</section>
					)}

					{/* Quotation Tab (read-only) */}
					{activeTab === 'quotation' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Quotation
										</h2>
										<p className="text-xs text-gray-500">
											Quotation linked to this project (edit to manage)
										</p>
									</div>
									{canEditProjectContent && (
										<Link
											href={`/projects/${project.id ?? project.project_id}/edit`}
											className="ml-auto text-xs font-medium text-purple-600 hover:underline"
										>
											Edit →
										</Link>
									)}
								</div>
							</div>
							<div className="px-6 py-5">
								<p className="text-sm text-gray-500">
									Quotation details are managed in the edit view under the
									Quotation tab. Same project_quotation data is shown there for
									editing.
								</p>
							</div>
						</section>
					)}

					{/* Purchase Order Tab (read-only) */}
					{activeTab === 'purchase_order' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Purchase Order
										</h2>
										<p className="text-xs text-gray-500">
											Purchase orders for this project (edit to manage)
										</p>
									</div>
									{canEditProjectContent && (
										<Link
											href={`/projects/${project.id ?? project.project_id}/edit`}
											className="ml-auto text-xs font-medium text-purple-600 hover:underline"
										>
											Edit →
										</Link>
									)}
								</div>
							</div>
							<div className="px-6 py-5">
								<p className="text-sm text-gray-500">
									Purchase orders are managed in the edit view. Data is shared
									via the same project_purchase_orders table.
								</p>
							</div>
						</section>
					)}

					{/* Invoice Tab (read-only) */}
					{activeTab === 'invoice' && (
						<section className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
							<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4">
								<div className="flex items-center gap-3">
									<div className="rounded-xl bg-purple-50 p-2 ring-1 ring-inset ring-purple-100">
										<DocumentTextIcon
											className="h-4 w-4 text-purple-600"
											aria-hidden="true"
										/>
									</div>
									<div>
										<h2 className="text-base font-semibold tracking-tight text-gray-900">
											Invoice
										</h2>
										<p className="text-xs text-gray-500">
											Invoices for this project (edit to manage)
										</p>
									</div>
									{canEditProjectContent && (
										<Link
											href={`/projects/${project.id ?? project.project_id}/edit`}
											className="ml-auto text-xs font-medium text-purple-600 hover:underline"
										>
											Edit →
										</Link>
									)}
								</div>
							</div>
							<div className="px-6 py-5">
								<p className="text-sm text-gray-500">
									Invoices are managed in the edit view. Same project_invoices
									data.
								</p>
							</div>
						</section>
					)}

					{/* Project Team Tab (read-only, same data as edit's Project Team) */}
					{(activeTab === 'project_team' || activeTab === 'team') &&
						!isEmployeeWorkspace && (
							<section
								id="panel-project_team"
								role="tabpanel"
								aria-labelledby="tab-project_team"
								className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
							>
								<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
									<UserIcon className="h-5 w-5 text-[#7F2487]" />
									<h2 className="text-base font-bold text-gray-900">
										Project Team
									</h2>
								</div>
								<div className="px-6 py-5 space-y-3 text-sm text-gray-600">
									<p>
										<span className="font-semibold text-gray-900">
											Project Manager:
										</span>{' '}
										{project.project_manager || '—'}
									</p>
									<p>
										<span className="font-semibold text-gray-900">
											Primary Client:
										</span>{' '}
										{project.client_name || '—'}
									</p>
									<p>
										<span className="font-semibold text-gray-900">
											Assigned To:
										</span>{' '}
										{project.assigned_to || '—'}
									</p>
									<div className="mt-3">
										<h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
											Team Members
										</h4>
										{parsedTeamMembers && parsedTeamMembers.length > 0 ? (
											<>
												<div className="overflow-x-auto border border-gray-200 rounded-lg">
													<table className="w-full text-xs">
														<thead className="bg-gray-50 border-b border-gray-200">
															<tr>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	#
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Employee ID
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Name
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Email
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Department
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Position
																</th>
																<th className="px-3 py-2 text-left font-semibold text-gray-700">
																	Project Role
																</th>
															</tr>
														</thead>
														<tbody className="divide-y divide-gray-100">
															{parsedTeamMembers.map((member, index) => (
																<tr
																	key={member.id || member.user_id || index}
																	className="hover:bg-gray-50 transition-colors"
																>
																	<td className="px-3 py-2 text-gray-600">
																		{index + 1}
																	</td>
																	<td className="px-3 py-2 text-gray-900 font-mono text-xs">
																		{member.employee_id ||
																			member.employee_code ||
																			'—'}
																	</td>
																	<td className="px-3 py-2 text-gray-900 font-medium">
																		{member.name || member.employee_name || '—'}
																	</td>
																	<td className="px-3 py-2 text-gray-600 text-xs">
																		{member.email || '—'}
																	</td>
																	<td className="px-3 py-2 text-gray-600">
																		{member.department || '—'}
																	</td>
																	<td className="px-3 py-2 text-gray-600">
																		{member.position || '—'}
																	</td>
																	<td className="px-3 py-2 text-gray-600">
																		{member.role || member.designation || '—'}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
												<div className="mt-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-100">
													<div className="flex items-center justify-between">
														<div>
															<h4 className="text-sm font-semibold text-gray-700">
																Team Summary
															</h4>
															<p className="text-xs text-gray-600 mt-0.5">
																Total members assigned to this project
															</p>
														</div>
														<div className="text-right">
															<div className="text-2xl font-bold text-[#7F2487]">
																{parsedTeamMembers.length}
															</div>
															<div className="text-xs text-gray-600">
																Team Members
															</div>
														</div>
													</div>
												</div>
											</>
										) : (
											<p className="text-sm text-gray-400 bg-gray-50 rounded-lg p-6 text-center border border-dashed border-gray-200">
												No team members added. Use the edit view to assign team
												members.
											</p>
										)}
									</div>
								</div>
							</section>
						)}

					{/* Procurement Tab */}
					<section
						id="panel-procurement"
						role="tabpanel"
						aria-labelledby="tab-procurement"
						hidden={activeTab !== 'procurement'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<CalendarIcon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Procurement & Material
							</h2>
						</div>
						<div className="px-6 py-5">
							<div className="space-y-3 text-sm text-gray-600">
								<p>
									<span className="font-semibold text-gray-900">
										Procurement Status:
									</span>{' '}
									{project.procurement_status || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Material Delivery Schedule:
									</span>{' '}
									{project.material_delivery_schedule || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Vendor Management:
									</span>{' '}
									{project.vendor_management || '—'}
								</p>
							</div>
						</div>
					</section>

					{/* Construction Tab */}
					<section
						id="panel-construction"
						role="tabpanel"
						aria-labelledby="tab-construction"
						hidden={activeTab !== 'construction'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<BuildingOffice2Icon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Construction
							</h2>
						</div>
						<div className="px-6 py-5">
							<div className="space-y-3 text-sm text-gray-600">
								<p>
									<span className="font-semibold text-gray-900">
										Mobilization Date:
									</span>{' '}
									{project.mobilization_date || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Site Readiness:
									</span>{' '}
									{project.site_readiness || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Construction Progress:
									</span>{' '}
									{project.construction_progress || '—'}
								</p>
							</div>
						</div>
					</section>

					{/* Risk & Issues Tab */}
					<section
						id="panel-risk"
						role="tabpanel"
						aria-labelledby="tab-risk"
						hidden={activeTab !== 'risk'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<ClockIcon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Risk & Issues
							</h2>
						</div>
						<div className="px-6 py-5">
							<div className="space-y-3 text-sm text-gray-600">
								<p>
									<span className="font-semibold text-gray-900">
										Major Risks:
									</span>{' '}
									{project.major_risks || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Mitigation Plans:
									</span>{' '}
									{project.mitigation_plans || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Change Orders:
									</span>{' '}
									{project.change_orders || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Claims / Disputes:
									</span>{' '}
									{project.claims_disputes || '—'}
								</p>
							</div>
						</div>
					</section>

					{/* Closeout Tab */}
					<section
						id="panel-closeout"
						role="tabpanel"
						aria-labelledby="tab-closeout"
						hidden={activeTab !== 'closeout'}
						className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden"
					>
						<div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
							<CheckCircleIcon className="h-5 w-5 text-[#7F2487]" />
							<h2 className="text-base font-bold text-gray-900">
								Project Closeout
							</h2>
						</div>
						<div className="px-6 py-5">
							<div className="space-y-3 text-sm text-gray-600">
								<p>
									<span className="font-semibold text-gray-900">
										Final Documentation Status:
									</span>{' '}
									{project.final_documentation_status || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Lessons Learned:
									</span>{' '}
									{project.lessons_learned || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Client Feedback:
									</span>{' '}
									{project.client_feedback || '—'}
								</p>
								<p>
									<span className="font-semibold text-gray-900">
										Actual Profit / Loss:
									</span>{' '}
									{project.actual_profit_loss
										? new Intl.NumberFormat('en-IN', {
												style: 'currency',
												currency: project.currency || 'INR',
											}).format(project.actual_profit_loss)
										: '—'}
								</p>
							</div>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
