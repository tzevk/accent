'use client';

// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */

import {
	useEffect,
	useMemo,
	useState,
	Fragment,
	useRef,
	useCallback,
} from 'react';
import { useRouter, useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import {
	ArrowLeftIcon,
	PlusIcon,
	TrashIcon,
	CheckCircleIcon,
	ChevronDownIcon,
	DocumentIcon,
	XMarkIcon,
	UserIcon,
	ClockIcon,
	ChatBubbleLeftRightIcon,
	CheckIcon,
	PhoneIcon,
	EnvelopeIcon,
	CalendarIcon,
	ClipboardDocumentListIcon,
	MagnifyingGlassIcon,
	DocumentTextIcon,
	ArrowTopRightOnSquareIcon,
	PencilIcon,
	ArrowUpTrayIcon,
	PaperClipIcon,
	LockClosedIcon,
	LockOpenIcon,
} from '@heroicons/react/24/outline';
import { fetchJSON } from '@/utils/http';
import { useSession } from '@/context/SessionContext';
import Image from 'next/image';
import { normalizeDate, formatWeekHeaderDate } from '@/utils/date';
import {
	buildProjectWeeks,
	getWeekSpanForProjectRange,
} from '@/utils/project-weeks';
import LoadingFallback from '@/components/LoadingFallback';
import { getExportSheetPayloads } from './excel/export/buildPayloads';
import {
	exportProjectWorkbook,
	exportSingleSheetWorkbook,
} from './excel/export/exportWorkbook';
import { importProjectWorkbook } from './excel/import/importWorkbook';

// Tab Components
import ProjectDetailsTab from './tabs/ProjectDetailsTab';
import ScopeTab from './tabs/ScopeTab';
import ProjectActivityTab from './tabs/ProjectActivityTab';
import ProjectScheduleTab from './tabs/ProjectScheduleTab';
import ProjectTeamTab from './tabs/ProjectTeamTab';
import ProjectHandoverTab from './tabs/ProjectHandoverTab';
import InputDocumentsTab from './tabs/InputDocumentsTab';
import DocumentsIssuedTab from './tabs/DocumentsIssuedTab';
import MeetingTab from './tabs/MeetingTab';
import ProjectManhoursTab from './tabs/ProjectManhoursTab';
import SoftwareTab from './tabs/SoftwareTab';
import MyActivitiesTab from './tabs/MyActivitiesTab';
import QueryLogTab from './tabs/QueryLogTab';
import AssumptionTab from './tabs/AssumptionTab';
import LessonsLearntTab from './tabs/LessonsLearntTab';
import DiscussionTab from './tabs/DiscussionTab';
import QuotationTab from './tabs/QuotationTab';
import PurchaseOrderTab from './tabs/PurchaseOrderTab';
import InvoiceTab from './tabs/InvoiceTab';
import CommercialTab from './tabs/CommercialTab';
import ActivitiesTab from './tabs/ActivitiesTab';
import TeamTab from './tabs/TeamTab';
import ProcurementTab from './tabs/ProcurementTab';
import ConstructionTab from './tabs/ConstructionTab';
import RiskTab from './tabs/RiskTab';
import CloseoutTab from './tabs/CloseoutTab';
import PlanningTab from './tabs/PlanningTab';
import DocumentationTab from './tabs/DocumentationTab';
import MeetingsTab from './tabs/MeetingsTab';
import DocumentsReceivedTab from './tabs/DocumentsReceivedTab';

const INITIAL_FORM = {
	// Scope & Annexure fields
	scope_of_work: '',
	additional_scope: '',
	input_documents: '',
	deliverables: '',
	software_included: '',
	duration: '',
	mode_of_delivery: '',
	revision: '',
	site_visit: '',
	quotation_validity: '',
	exclusion: '',
	billing_and_payment_terms: '',
	other_terms_and_conditions: '',

	// General project fields (add more as needed)
	client_name: '',
	budget: '',
	procurement_status: '',
	material_delivery_schedule: '',
	vendor_management: '',
	mobilization_date: '',
	site_readiness: '',
	construction_progress: '',
	major_risks: '',
	mitigation_plans: '',
	change_orders: '',
	claims_disputes: '',
	final_documentation_status: '',
	lessons_learned: '',
	client_feedback: '',
	actual_profit_loss: '',
	project_schedule: '',
	input_document: '',
	list_of_deliverables: '',
	kickoff_meeting: '',
	in_house_meeting: '',
	project_start_milestone: '',
	project_review_milestone: '',
	project_end_milestone: '',
	kickoff_meeting_date: '',
	kickoff_followup_date: '',
	internal_meeting_date: '',
	next_internal_meeting: '',
	// additional fields surfaced in Project Details
	estimated_manhours: '',
	unit_qty: '',
	project_team: '',
	// Minutes - Internal Meeting fields
	internal_meeting_no: '',
	internal_meeting_client_name: '',
	internal_meeting_date: '',
	internal_meeting_organizer: '',
	internal_minutes_drafted: '',
	internal_meeting_location: '',
	internal_client_representative: '',
	internal_meeting_title: '',
	internal_points_discussed: '',
	internal_persons_involved: '',
	// Kickoff meeting detailed fields
	kickoff_meeting_no: '',
	kickoff_client_name: '',
	kickoff_meeting_organizer: '',
	kickoff_minutes_drafted: '',
	kickoff_meeting_location: '',
	kickoff_client_representative: '',
	kickoff_meeting_title: '',
	kickoff_points_discussed: '',
	kickoff_persons_involved: '',
};

// UI constants used by the edit form (kept local to avoid cross-file imports)
const TABS = [
	{
		id: 'project_details',
		label: 'Project Details',
		projectSectionKey: 'project_details',
	},
	{
		id: 'scope',
		label: 'Scope',
		requiresUpdate: true,
		projectSectionKey: 'scope',
	},
	{
		id: 'project_activity',
		label: 'Project Activity',
		adminOrActivities: true,
		requiresUpdate: true,
		projectSectionKey: 'project_activity',
	},
	{
		id: 'project_schedule',
		label: 'Schedule',
		requiresUpdate: true,
		projectSectionKey: 'project_schedule',
	},
	{
		id: 'project_team_tab',
		label: 'Project Team',
		requiresUpdate: true,
		projectSectionKey: 'project_details',
	},
	{
		id: 'project_handover',
		label: 'Progress Measurement',
		requiresUpdate: true,
		projectSectionKey: 'project_handover',
	},
	{
		id: 'input_documents',
		label: 'Input Document',
		requiresUpdate: true,
		projectSectionKey: 'documents_received',
	},
	{
		id: 'documents_issued',
		label: 'Deliverables',
		requiresUpdate: true,
		projectSectionKey: 'documents_issued',
	},
	{
		id: 'minutes_internal_meet',
		label: 'Meeting',
		requiresUpdate: true,
		projectSectionKey: 'minutes_internal_meet',
	},
	{
		id: 'project_manhours',
		label: 'Project Manhours',
		requiresUpdate: true,
		projectSectionKey: 'project_manhours',
	},
	{ id: 'software', label: 'Software', requiresUpdate: true },
	{ id: 'my_activities', label: 'My Activities', userOnly: true },
	{
		id: 'query_log',
		label: 'Query Log',
		requiresUpdate: true,
		projectSectionKey: 'query_log',
	},
	{
		id: 'assumption',
		label: 'Assumption',
		requiresUpdate: true,
		projectSectionKey: 'assumption',
	},
	{
		id: 'lessons_learnt',
		label: 'Lessons Learnt',
		requiresUpdate: true,
		projectSectionKey: 'lessons_learnt',
	},
	{
		id: 'discussion',
		label: 'Discussion',
		requiresUpdate: true,
		projectSectionKey: 'minutes_internal_meet',
	},
	{
		id: 'quotation',
		label: 'Quotation',
		requiresPermission: 'quotations',
		requiresUpdate: true,
	},
	{
		id: 'purchase_order',
		label: 'Purchase Order',
		requiresPermission: 'purchase_orders',
		requiresUpdate: true,
	},
	{
		id: 'invoice',
		label: 'Invoice',
		requiresPermission: 'invoices',
		requiresUpdate: true,
	},
];

const TYPE_OPTIONS = ['ONGOING', 'CONSULTANCY', 'EPC', 'PMC'];
const CURRENCY_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];
const PAYMENT_TERMS_OPTIONS = ['Net 30', 'Net 45', 'Net 60', 'Advance'];
const INVOICING_STATUS_OPTIONS = [
	'Uninvoiced',
	'Partially Invoiced',
	'Invoiced',
	'Paid',
];
const PROCUREMENT_STATUS_OPTIONS = [
	'Not Started',
	'In Progress',
	'Completed',
	'On Hold',
];
const DOCUMENTATION_STATUS_OPTIONS = [
	'Not Started',
	'Drafted',
	'Reviewed',
	'Finalized',
];

export default function EditProjectForm() {
	const router = useRouter();
	const params = useParams();
	const id = params?.id;
	const {
		user: sessionUser,
		can,
		RESOURCES,
		PERMISSIONS,
		refreshSession,
	} = useSession();

	useEffect(() => {
		// Ensure latest permissions are used for tab visibility after permission updates.
		refreshSession?.();
	}, [refreshSession]);

	const isAdminUser = useMemo(() => {
		const hierarchy = Number(
			sessionUser?.role?.hierarchy ??
				sessionUser?.role_hierarchy ??
				sessionUser?.role_info?.hierarchy
		);
		return (
			!!sessionUser?.is_super_admin ||
			(!Number.isNaN(hierarchy) && hierarchy <= 2)
		);
	}, [sessionUser]);

	// Check if super admin (override all permissions)
	const isSuperAdmin =
		sessionUser?.is_super_admin === true || sessionUser?.is_super_admin === 1;

	// Permission checks for financial documents (super admin has all permissions)
	const canViewQuotations =
		isSuperAdmin ||
		can(RESOURCES.QUOTATIONS, PERMISSIONS.READ) ||
		can(RESOURCES.QUOTATIONS, PERMISSIONS.UPDATE);
	const canEditQuotations =
		isSuperAdmin || can(RESOURCES.QUOTATIONS, PERMISSIONS.UPDATE);
	const canViewPurchaseOrders =
		isSuperAdmin ||
		can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.READ) ||
		can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.UPDATE);
	const canEditPurchaseOrders =
		isSuperAdmin || can(RESOURCES.PURCHASE_ORDERS, PERMISSIONS.UPDATE);
	const canViewInvoices =
		isSuperAdmin ||
		can(RESOURCES.INVOICES, PERMISSIONS.READ) ||
		can(RESOURCES.INVOICES, PERMISSIONS.UPDATE);
	const canEditInvoices =
		isSuperAdmin || can(RESOURCES.INVOICES, PERMISSIONS.UPDATE);
	const canViewProjectContent =
		isSuperAdmin ||
		can(RESOURCES.PROJECTS, PERMISSIONS.READ) ||
		can(RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
	const canEditProjectContent =
		isSuperAdmin || can(RESOURCES.PROJECTS, PERMISSIONS.UPDATE);
	const canReadUsers = isSuperAdmin || can(RESOURCES.USERS, PERMISSIONS.READ);

	const [activeTab, setActiveTab] = useState('project_details');
	const [functions, setFunctions] = useState([]); // Top-level disciplines/functions
	const [activities, setActivities] = useState([]); // Standalone activities list
	const [subActivities, setSubActivities] = useState([]); // Standalone subactivities list
	const [form, setForm] = useState(INITIAL_FORM);
	const [projectActivities, setProjectActivities] = useState([]);
	const [newScopeActivityName, setNewScopeActivityName] = useState('');
	const [teamMembers, setTeamMembers] = useState([]);

	// Kickoff meetings stored as an array
	const [kickoffMeetings, setKickoffMeetings] = useState([]);
	const [newKickoffMeetingTitle, setNewKickoffMeetingTitle] = useState('');

	// Internal meetings stored as an array (each meeting has same fields as kickoff)
	const [internalMeetings, setInternalMeetings] = useState([]);
	const [newInternalMeetingTitle, setNewInternalMeetingTitle] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [exportingExcel, setExportingExcel] = useState(false);
	const [importingExcel, setImportingExcel] = useState(false);
	const [selectedExportSheet, setSelectedExportSheet] =
		useState('input_documents');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	// Sub-Activity dropdown UI state (per-activity)
	const [openSubActivityDropdowns, setOpenSubActivityDropdowns] = useState({});
	const [subActivitySearch, setSubActivitySearch] = useState({});

	// Multi-select activity checkbox state
	const [showActivitySelector, setShowActivitySelector] = useState(false);
	const [selectedActivitiesForAdd, setSelectedActivitiesForAdd] = useState({});
	const [activitySelectorSearch, setActivitySelectorSearch] = useState('');

	// Track which activity is in edit mode
	const [editingActivityId, setEditingActivityId] = useState(null);

	// Multi-select user assignment state (for assigning multiple users to one activity)
	const [openUserSelectorForActivity, setOpenUserSelectorForActivity] =
		useState(null);
	const userSelectorRef = useRef(null);
	const excelImportInputRef = useRef(null);

	// Close user selector dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event) => {
			if (openUserSelectorForActivity !== null) {
				// Check if click is outside the dropdown
				const dropdowns = document.querySelectorAll(
					'[data-user-selector-dropdown]'
				);
				let clickedInside = false;
				dropdowns.forEach((dropdown) => {
					if (dropdown.contains(event.target)) {
						clickedInside = true;
					}
				});
				if (!clickedInside) {
					setOpenUserSelectorForActivity(null);
				}
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [openUserSelectorForActivity]);

	// Collapsible sections for General / Project Details (Basic, Scope, Unit/Qty, Deliverables)
	const [openSections, setOpenSections] = useState({
		basic: true,
		scope: true,
		deliverables: true,
		teamMemberAdd: true,
		currentTeam: true,
	});

	const toggleSection = (key) =>
		setOpenSections((s) => ({ ...s, [key]: !s[key] }));

	// Input document list management with categories and full document details
	const [inputDocumentsList, setInputDocumentsList] = useState([]);
	const [newInputDocument, setNewInputDocument] = useState({
		sr_no: '',
		date_received: '',
		description: '',
		drawing_number: '',
		sheet_number: '',
		revision_number: '',
		unit_qty: '',
		document_sent_by: '',
		remarks: '',
		category: 'lot',
		lotNumber: '',
		subLot: '',
	});
	const [docMaster, setDocMaster] = useState([]);

	// Project Team Management
	const [projectTeamMembers, setProjectTeamMembers] = useState([]);
	const [allUsers, setAllUsers] = useState([]);
	const [usersLoading, setUsersLoading] = useState(true);
	const [teamMemberSearch, setTeamMemberSearch] = useState('');

	// Software Management
	const [softwareItems, setSoftwareItems] = useState([]);
	const [softwareCategories, setSoftwareCategories] = useState([]);
	const [selectedSoftwareCategory, setSelectedSoftwareCategory] = useState('');
	const [selectedSoftware, setSelectedSoftware] = useState('');
	const [selectedSoftwareVersion, setSelectedSoftwareVersion] = useState('');

	// User Master (for Assigned To dropdowns)
	const [userMaster, setUserMaster] = useState([]);

	// Documentation tab - detailed document management
	const [documentsList, setDocumentsList] = useState([]);

	// Documents Received - structured table rows
	const [documentsReceived, setDocumentsReceived] = useState([]);
	const [newReceivedDoc, setNewReceivedDoc] = useState({
		date_received: '',
		description: '',
		drawing_number: '',
		revision_number: '',
		unit_qty: '',
		document_sent_by: '',
		remarks: '',
	});
	const newReceivedDescRef = useRef(null);

	// Documents Issued - structured table rows (Document Issued to Client)
	const [documentsIssued, setDocumentsIssued] = useState([]);
	const [newIssuedDoc, setNewIssuedDoc] = useState({
		document_name: '',
		issued_for: '',
		document_number: '',
		revision_number: '',
		issue_date: '',
		remarks: '',
	});
	const newIssuedDescRef = useRef(null);

	// Project Handover - structured rows (handover checklist)
	const [projectHandover, setProjectHandover] = useState([]);
	const [newHandoverRow, setNewHandoverRow] = useState({
		output_by_accent: '',
		requirement_accomplished: '',
		remark: '',
		hand_over: '',
	});
	const newHandoverDescRef = useRef(null);

	// Project Schedule - structured rows
	const [projectSchedule, setProjectSchedule] = useState([]);
	const scheduleAutofilledRef = useRef(false);
	const [scheduleLocked, setScheduleLocked] = useState(false);

	const SCHEDULE_LEGENDS = useMemo(
		() => [
			{
				key: 'accent_activities',
				label: 'Accent Activities',
				cellClass: 'bg-gray-200',
				textClass: 'text-gray-900',
			},
			{
				key: 'piping_modelling',
				label: 'Piping/Modelling',
				cellClass: 'bg-purple-200',
				textClass: 'text-gray-900',
			},
			{
				key: 'civil_structural',
				label: 'Civil/Structural',
				cellClass: 'bg-amber-200',
				textClass: 'text-gray-900',
			},
			{
				key: 'electrical',
				label: 'Electrical',
				cellClass: 'bg-indigo-200',
				textClass: 'text-gray-900',
			},
			{
				key: 'instrumentation',
				label: 'Instrumentation',
				cellClass: 'bg-slate-200',
				textClass: 'text-gray-900',
			},
			{
				key: 'swpl_controlled',
				label: 'SWPL Controlled',
				cellClass: 'bg-green-700',
				textClass: 'text-white',
			},
			{
				key: 'milestone',
				label: 'Milestone',
				cellClass: 'bg-emerald-200',
				textClass: 'text-gray-900',
			},
		],
		[]
	);

	const generateScheduleRowId = useCallback(() => {
		try {
			if (
				typeof crypto !== 'undefined' &&
				typeof crypto.randomUUID === 'function'
			) {
				return crypto.randomUUID();
			}
		} catch {
			// ignore
		}
		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}, []);

	const normalizeScheduleRows = useCallback(
		(rows) => {
			const seen = new Set();
			return (Array.isArray(rows) ? rows : []).map((row) => {
				const base = row && typeof row === 'object' ? row : {};
				let id = base.id;
				if (id === null || id === undefined || id === '') id = null;
				const idStr = id === null ? '' : String(id);
				const safeId =
					!idStr || seen.has(idStr) ? generateScheduleRowId() : idStr;
				seen.add(safeId);

				const legend = base.legend || base.schedule_legend || '';
				const weeks = Array.isArray(base.weeks)
					? base.weeks.map((n) => Number(n)).filter((n) => Number.isFinite(n))
					: base.weeks;

				return {
					...base,
					id: safeId,
					legend,
					weeks,
				};
			});
		},
		[generateScheduleRowId]
	);

	const canEditSchedule = canEditProjectContent && !scheduleLocked;
	const scheduleEffectivelyLocked = scheduleLocked || !canEditProjectContent;

	const [selectedScheduleLegend, setSelectedScheduleLegend] =
		useState('accent_activities');

	const getScheduleLegend = useCallback(
		(key) => {
			const k = String(key || '').trim();
			return SCHEDULE_LEGENDS.find((l) => l.key === k) || null;
		},
		[SCHEDULE_LEGENDS]
	);

	const scheduleWeeks = useMemo(
		() => buildProjectWeeks(form.start_date, form.end_date),
		[form.start_date, form.end_date]
	);

	const projectActivityScheduleGroups = useMemo(() => {
		const byDiscipline = new Map();

		(projectActivities || []).forEach((pa) => {
			const type = String(pa?.type || '').toLowerCase();
			if (type !== 'activity' && type !== 'subactivity') return;

			const disciplineName =
				pa?.discipline ||
				pa?.function_name ||
				(pa?.function_id
					? (functions || []).find(
							(f) => String(f.id) === String(pa.function_id)
						)?.function_name
					: null) ||
				'Other';

			const parentName = pa?.activity_name || pa?.activity || '';
			const childName =
				pa?.name || pa?.sub_activity_name || pa?.sub_activity || '';
			const label =
				type === 'subactivity'
					? parentName && childName
						? `${parentName} - ${childName}`
						: childName || parentName
					: parentName || pa?.name || '';

			if (!label) return;

			if (!byDiscipline.has(disciplineName))
				byDiscipline.set(disciplineName, new Set());
			byDiscipline.get(disciplineName).add(label);
		});

		return Array.from(byDiscipline.entries())
			.map(([discipline, optionSet]) => ({
				discipline,
				options: Array.from(optionSet.values()).sort((a, b) =>
					a.localeCompare(b)
				),
			}))
			.sort((a, b) => a.discipline.localeCompare(b.discipline));
	}, [projectActivities, functions]);

	const projectActivityDocumentNameOptions = useMemo(() => {
		const unique = new Set();
		(projectActivityScheduleGroups || []).forEach((g) => {
			(g.options || []).forEach((opt) => {
				if (opt) unique.add(opt);
			});
		});
		return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
	}, [projectActivityScheduleGroups]);

	useEffect(() => {
		if (scheduleAutofilledRef.current) return;
		if (projectSchedule.length > 0) {
			scheduleAutofilledRef.current = true;
			return;
		}
		if (!projectActivities || projectActivities.length === 0) return;

		const normalizeDateOnly = (value) => {
			if (!value) return '';
			const d = new Date(value);
			if (Number.isNaN(d.getTime())) return '';
			return d.toISOString().slice(0, 10);
		};

		const parseDateMs = (value) => {
			if (!value) return null;
			const d = new Date(value);
			if (Number.isNaN(d.getTime())) return null;
			return d.getTime();
		};

		const derived = (projectActivities || [])
			.filter((pa) =>
				['activity', 'subactivity'].includes(
					String(pa?.type || '').toLowerCase()
				)
			)
			.map((pa, idx) => {
				const type = String(pa?.type || '').toLowerCase();
				const disciplineName =
					pa?.discipline ||
					pa?.function_name ||
					pa?.function ||
					pa?.department ||
					'Manual / Other';
				const parentName = pa?.activity_name || pa?.activity || '';
				const childName =
					pa?.name || pa?.sub_activity_name || pa?.sub_activity || '';
				const activityLabel =
					type === 'subactivity'
						? parentName && childName
							? `${parentName} - ${childName}`
							: childName || parentName
						: parentName || pa?.name || '';

				const assignments = Array.isArray(pa?.assigned_users)
					? pa.assigned_users
					: [];
				const startCandidates = assignments
					.map((a) => a?.start_date)
					.map(parseDateMs)
					.filter((v) => typeof v === 'number');
				const endCandidates = assignments
					.map((a) => a?.due_date || a?.end_date)
					.map(parseDateMs)
					.filter((v) => typeof v === 'number');

				const minStart = startCandidates.length
					? new Date(Math.min(...startCandidates)).toISOString().slice(0, 10)
					: '';
				const maxEnd = endCandidates.length
					? new Date(Math.max(...endCandidates)).toISOString().slice(0, 10)
					: '';

				const qtyTotal = assignments.reduce(
					(sum, a) => sum + (parseFloat(a?.qty_assigned) || 0),
					0
				);
				const statusValues = assignments
					.map((a) => String(a?.status || '').toLowerCase())
					.filter(Boolean);
				const allDone =
					statusValues.length > 0 &&
					statusValues.every((s) =>
						['done', 'completed', 'complete', 'yes'].includes(s)
					);
				const anyAssigned = assignments.length > 0;

				return {
					id: generateScheduleRowId(),
					sr_no: String(idx + 1),
					activity_description: activityLabel,
					discipline: disciplineName,
					legend: 'accent_activities',
					color: '',
					unit_qty: qtyTotal > 0 ? String(qtyTotal) : '',
					start_date: normalizeDateOnly(minStart) || '',
					end_date: normalizeDateOnly(maxEnd) || '',
					time_required: '',
					status_completed: allDone ? 'Yes' : anyAssigned ? 'Ongoing' : '',
					remarks: '',
				};
			})
			.filter((row) => !!row.activity_description);

		if (derived.length > 0) {
			setProjectSchedule(normalizeScheduleRows(derived));
			scheduleAutofilledRef.current = true;
		}
	}, [
		projectActivities,
		projectSchedule.length,
		generateScheduleRowId,
		normalizeScheduleRows,
	]);

	// Project Manhours - structured by month with employee entries
	const [projectManhours, setProjectManhours] = useState([
		{
			id: Date.now(),
			employee_id: '',
			employee_name: '',
			salary_type: '',
			rate_company: '',
			rate_accent: '',
			monthly_hours: {},
		},
	]);
	// State for adding new months - multiple selection
	const [selectedMonths, setSelectedMonths] = useState([]);
	const [monthRangeStart, setMonthRangeStart] = useState('');
	const [monthRangeEnd, setMonthRangeEnd] = useState('');
	// State for employees with salary profiles (for rate lookup)
	const [employeesWithRates, setEmployeesWithRates] = useState([]);
	const [employeesLoading, setEmployeesLoading] = useState(false);
	// Cache for attendance hours to avoid re-fetching
	const [attendanceHoursCache, setAttendanceHoursCache] = useState({});
	// New entry form for adding employee hours within a month
	const [newManhourEntry, setNewManhourEntry] = useState({
		employee_id: '',
		employee_name: '',
		rate: '',
		salary_type: '',
		hours: '',
	});
	const newManhourNameRef = useRef(null);

	// Query Log - structured rows
	const [queryLog, setQueryLog] = useState([]);
	const [newQuery, setNewQuery] = useState({
		query_description: '',
		query_issued_date: '',
		reply_from_client: '',
		reply_received_date: '',
		query_updated_by: '',
		query_resolved: '',
		remark: '',
	});
	const newQueryDescRef = useRef(null);

	// Assumptions - structured rows
	const [assumptions, setAssumptions] = useState([]);
	const [newAssumption, setNewAssumption] = useState({
		assumption_description: '',
		reason: '',
		assumption_taken_by: '',
		remark: '',
	});
	const newAssumptionDescRef = useRef(null);

	// Lessons Learnt - structured rows
	const [lessonsLearnt, setLessonsLearnt] = useState([]);
	const [newLesson, setNewLesson] = useState({
		what_was_new: '',
		difficulty_faced: '',
		what_you_learn: '',
		areas_of_improvement: '',
		remark: '',
	});
	const newLessonDescRef = useRef(null);

	// Project Planning tab - activity tracking
	const [planningActivities, setPlanningActivities] = useState([]);
	const [newPlanningActivity, setNewPlanningActivity] = useState({
		serialNumber: '',
		activity: '',
		quantity: '',
		startDate: '',
		endDate: '',
		actualCompletionDate: '',
		timeRequired: '',
		actualTimeRequired: '',
	});

	// Quotation tab state
	const [quotationData, setQuotationData] = useState({
		quotation_number: '',
		quotation_date: '',
		client_name: '',
		enquiry_number: '',
		enquiry_quantity: '',
		scope_of_work: '',
		gross_amount: '',
		gst_percentage: 18,
		gst_amount: '',
		net_amount: '',
	});
	const [quotationSaving, setQuotationSaving] = useState(false);

	// Purchase Order tab state
	const [purchaseOrderData, setPurchaseOrderData] = useState({
		po_number: '',
		po_date: '',
		client_name: '',
		vendor_name: '',
		vendor_id: '',
		delivery_date: '',
		scope_of_work: '',
		gross_amount: '',
		gst_percentage: 18,
		gst_amount: '',
		net_amount: '',
		payment_terms: '',
		remarks: '',
	});
	const [incomingPOs, setIncomingPOs] = useState([]);
	const [incomingPOData, setIncomingPOData] = useState({
		company_name: '',
		city: '',
		po_number: '',
		po_date: '',
		po_amount: '',
		project_number: '',
		expenses_head: '',
		remarks: '',
	});
	const [purchaseOrderSaving, setPurchaseOrderSaving] = useState(false);

	// Vendors state for PO dropdown
	const [vendors, setVendors] = useState([]);
	const [selectedVendor, setSelectedVendor] = useState(null);
	const [loadingVendors, setLoadingVendors] = useState(false);

	// Account Heads state for expense head dropdown
	const [accountHeads, setAccountHeads] = useState([]);
	const [loadingAccountHeads, setLoadingAccountHeads] = useState(false);

	// Invoice tab state
	const [invoiceData, setInvoiceData] = useState({
		invoice_number: '',
		invoice_date: '',
		company_name: '',
		city: '',
		invoice_amount: '',
		purchase_description: '',
		project_number: '',
		expenses_head: '',
		payment: '',
		payment_overdue_days: '',
		remarks: '',
	});
	const [invoices, setInvoices] = useState([]);
	const [invoiceSaving, setInvoiceSaving] = useState(false);
	const [nextInvoiceNumber, setNextInvoiceNumber] = useState('');
	const [editingInvoiceId, setEditingInvoiceId] = useState(null);

	// Fetch all required reference/master data + project data in parallel (single DB connection for ref data)
	useEffect(() => {
		const fetchAllInitData = async () => {
			try {
				setLoadingVendors(true);
				setUsersLoading(true);
				const initData = await fetchJSON(`/api/projects/${id}/init-data`);
				if (initData.success && initData.data) {
					const d = initData.data;
					// Note: companies data is no longer needed - company name is fetched from project details
					setVendors(d.vendors || []);
					setFunctions(d.functions || []);
					setActivities(d.activities || []);
					setSubActivities(d.subActivities || []);
					setUserMaster(d.users || []);
					setAllUsers(d.users || []);
					setSoftwareCategories(d.softwareCategories || []);
					setDocMaster(d.docMaster || []);

					// If users were not returned by init-data, fetch them separately
					if ((!d.users || d.users.length === 0) && canReadUsers) {
						console.warn(
							'[init-data] No users returned, fetching from /api/users'
						);
						try {
							const usersRes = await fetchJSON('/api/users?limit=500');
							if (usersRes.success && usersRes.data) {
								setUserMaster(usersRes.data);
								setAllUsers(usersRes.data);
							}
						} catch (ue) {
							console.error('Fallback users fetch failed:', ue);
						}
					} else if (!d.users || d.users.length === 0) {
						console.warn(
							'[init-data] Users not returned and users:read not granted; skipping /api/users fallback'
						);
					}
				} else {
					// init-data failed, fetch users separately
					if (canReadUsers) {
						console.warn('[init-data] Failed, fetching users separately');
						try {
							const usersRes = await fetchJSON('/api/users?limit=500');
							if (usersRes.success && usersRes.data) {
								setUserMaster(usersRes.data);
								setAllUsers(usersRes.data);
							}
						} catch (ue) {
							console.error('Fallback users fetch failed:', ue);
						}
					} else {
						console.warn(
							'[init-data] Failed and users:read not granted; skipping /api/users fallback'
						);
					}
				}
			} catch (error) {
				console.warn(
					'Failed to fetch init data, falling back to individual calls',
					error
				);
				// Fetch users as fallback
				if (canReadUsers) {
					try {
						const usersRes = await fetchJSON('/api/users?limit=500');
						if (usersRes.success && usersRes.data) {
							setUserMaster(usersRes.data);
							setAllUsers(usersRes.data);
						}
					} catch (ue) {
						console.error('Fallback users fetch failed:', ue);
					}
				} else {
					console.warn('[init-data] Fallback blocked: users:read not granted');
				}
			} finally {
				setLoadingVendors(false);
				setUsersLoading(false);
			}
		};
		if (id && id !== 'undefined') {
			fetchAllInitData();
		}
	}, [id, canReadUsers]);

	// Fetch account heads for expense head dropdown
	useEffect(() => {
		const fetchAccountHeads = async () => {
			setLoadingAccountHeads(true);
			try {
				const res = await fetch('/api/account-masters?limit=500');
				if (!res.ok) {
					console.warn('Account heads API not available');
					setAccountHeads([]);
					return;
				}
				const json = await res.json();
				if (json?.success && Array.isArray(json.data)) {
					setAccountHeads(json.data);
				} else {
					setAccountHeads([]);
				}
			} catch (error) {
				console.warn('Error fetching account heads:', error);
				setAccountHeads([]);
			} finally {
				setLoadingAccountHeads(false);
			}
		};

		fetchAccountHeads();
	}, []);

	// Fetch existing project data
	useEffect(() => {
		if (!id || id === 'undefined') {
			setError('Invalid project ID');
			setLoading(false);
			return;
		}

		// Helper to format date for input[type="date"] (YYYY-MM-DD)
		const formatDateForInput = (dateValue) => {
			if (!dateValue) return '';
			try {
				const date = new Date(dateValue);
				if (isNaN(date.getTime())) return '';
				return date.toISOString().split('T')[0];
			} catch {
				return '';
			}
		};

		const fetchProject = async () => {
			try {
				console.log('[fetchProject] Fetching project data for ID:', id);
				// Use optimized /api/projects/{id}/detail endpoint for better TTFB
				const result = await fetchJSON(`/api/projects/${id}/detail`);
				console.log('[fetchProject] API response success:', result.success);

				if (result.success && result.data) {
					const project = result.data;
					console.log(
						'[fetchProject] Project data keys:',
						Object.keys(project)
					);
					console.log('[fetchProject] Project name:', project.name);
					console.log('[fetchProject] Project client:', project.client_name);
					setForm({
						project_code: project.project_code || project.project_id || '',
						name: project.name || '',
						client_name: project.client_name || '',
						client_contact_details: project.client_contact_details || '',
						project_location_country: project.project_location_country || '',
						project_location_city: project.project_location_city || '',
						project_location_site: project.project_location_site || '',
						industry: project.industry || '',
						contract_type: project.contract_type || project.type || '',
						company_id: project.company_id || '',
						project_manager: project.project_manager || '',
						start_date: formatDateForInput(project.start_date),
						end_date: formatDateForInput(project.end_date),
						target_date: formatDateForInput(project.target_date),
						project_duration_planned: project.project_duration_planned || '',
						project_duration_actual: project.project_duration_actual || '',
						status: project.status || 'Ongoing',
						priority: project.priority || 'MEDIUM',
						progress: project.progress || 0,
						assigned_to: project.assigned_to || '',
						type: project.type || 'EPC',
						description: project.description || '',
						notes: project.notes || '',
						proposal_id: project.proposal_id || '',
						project_value: project.project_value || '',
						currency: project.currency || 'INR',
						payment_terms: project.payment_terms || '',
						invoicing_status: project.invoicing_status || '',
						cost_to_company: project.cost_to_company || '',
						profitability_estimate: project.profitability_estimate || '',
						subcontractors_vendors: project.subcontractors_vendors || '',
						budget: project.budget || '',
						procurement_status: project.procurement_status || '',
						material_delivery_schedule:
							project.material_delivery_schedule || '',
						vendor_management: project.vendor_management || '',
						mobilization_date: formatDateForInput(project.mobilization_date),
						site_readiness: project.site_readiness || '',
						construction_progress: project.construction_progress || '',
						major_risks: project.major_risks || '',
						mitigation_plans: project.mitigation_plans || '',
						change_orders: project.change_orders || '',
						claims_disputes: project.claims_disputes || '',
						final_documentation_status:
							project.final_documentation_status || '',
						lessons_learned: project.lessons_learned || '',
						client_feedback: project.client_feedback || '',
						actual_profit_loss: project.actual_profit_loss || '',
						estimated_manhours:
							project.estimated_manhours || project.estimated_hours || '',
						unit_qty: project.unit_qty || project.unit || '',
						project_team: project.project_team || '',
						// Scope & Deliverables fields
						scope_of_work: project.scope_of_work || '',
						input_document:
							typeof project.input_document === 'object' &&
							project.input_document !== null
								? JSON.stringify(project.input_document)
								: project.input_document || '',
						deliverables: project.deliverables || '',
						list_of_deliverables: project.list_of_deliverables || '',
						software_included: project.software_included || '',
						duration: project.duration || '',
						mode_of_delivery: project.mode_of_delivery || '',
						revision: project.revision || '',
						site_visit: project.site_visit || '',
						quotation_validity: project.quotation_validity || '',
						exclusion: project.exclusion || '',
						billing_and_payment_terms: project.billing_and_payment_terms || '',
						other_terms_and_conditions:
							project.other_terms_and_conditions || '',
						// internal minutes fields
						internal_meeting_no: project.internal_meeting_no || '',
						internal_meeting_client_name:
							project.internal_meeting_client_name || '',
						internal_meeting_date: project.internal_meeting_date || '',
						internal_meeting_organizer:
							project.internal_meeting_organizer || '',
						internal_minutes_drafted: project.internal_minutes_drafted || '',
						internal_meeting_location: project.internal_meeting_location || '',
						internal_client_representative:
							project.internal_client_representative || '',
						internal_meeting_title: project.internal_meeting_title || '',
						internal_points_discussed: project.internal_points_discussed || '',
						internal_persons_involved: project.internal_persons_involved || '',
						// kickoff mapping will be set below if present
						kickoff_meeting_no:
							project.kickoff_meeting_no || project.kickoff_meeting || '',
						kickoff_client_name: project.kickoff_client_name || '',
						kickoff_meeting_date: project.kickoff_meeting_date || '',
						kickoff_meeting_organizer: project.kickoff_meeting_organizer || '',
						kickoff_minutes_drafted: project.kickoff_minutes_drafted || '',
						kickoff_meeting_location: project.kickoff_meeting_location || '',
						kickoff_client_representative:
							project.kickoff_client_representative || '',
						kickoff_meeting_title: project.kickoff_meeting_title || '',
						kickoff_points_discussed: project.kickoff_points_discussed || '',
						kickoff_persons_involved: project.kickoff_persons_involved || '',
					});

					// Fetch proposal if proposal_id exists to auto-populate common fields
					if (project.proposal_id) {
						try {
							const proposalResult = await fetchJSON(
								`/api/proposals/${project.proposal_id}`
							);
							if (proposalResult.success && proposalResult.data) {
								const proposal = proposalResult.data;
								// Map all common fields from proposal to project
								setForm((prev) => ({
									...prev,
									// Company/Client information - fetch from proposal
									company_id: proposal.company_id || prev.company_id,
									client_name: proposal.client_name || prev.client_name,
									name: prev.name || proposal.client_name, // Use proposal client_name as project name if not set
									client_contact_details:
										proposal.client_contact_details ||
										prev.client_contact_details,

									// Scope & Deliverables
									scope_of_work: proposal.scope_of_work || prev.scope_of_work,
									deliverables: proposal.deliverables || prev.deliverables,
									input_document:
										typeof proposal.input_document === 'object' &&
										proposal.input_document !== null
											? JSON.stringify(proposal.input_document)
											: proposal.input_document || prev.input_document,
									list_of_deliverables:
										proposal.list_of_deliverables || prev.list_of_deliverables,

									// Project specifications
									software_included:
										proposal.software_included || prev.software_included,
									duration: proposal.duration || prev.duration,
									mode_of_delivery:
										proposal.mode_of_delivery || prev.mode_of_delivery,
									revision: proposal.revision || prev.revision,
									site_visit: proposal.site_visit || prev.site_visit,

									// Financial terms
									billing_and_payment_terms:
										proposal.billing_and_payment_terms ||
										prev.billing_and_payment_terms,
									payment_terms: proposal.payment_terms || prev.payment_terms,
									quotation_validity:
										proposal.quotation_validity || prev.quotation_validity,
									project_value:
										proposal.total_amount ||
										proposal.project_value ||
										prev.project_value,
									currency: proposal.currency || prev.currency,

									// Terms & Conditions
									exclusion: proposal.exclusion || prev.exclusion,
									other_terms_and_conditions:
										proposal.other_terms_and_conditions ||
										prev.other_terms_and_conditions,

									// Project details
									estimated_manhours:
										proposal.estimated_manhours ||
										proposal.estimated_hours ||
										prev.estimated_manhours,
									unit_qty: proposal.unit_qty || proposal.unit || prev.unit_qty,
									description:
										proposal.description ||
										proposal.project_description ||
										prev.description,
									notes: proposal.notes || prev.notes,
								}));

								// Fetch proposal activities if they exist and project activities are empty
								if (
									!project.project_activities_list ||
									projectActivities.length === 0
								) {
									if (proposal.activities) {
										try {
											const proposalActivities =
												typeof proposal.activities === 'string'
													? JSON.parse(proposal.activities)
													: proposal.activities;

											if (
												Array.isArray(proposalActivities) &&
												proposalActivities.length > 0
											) {
												// Map proposal activities to project activities format
												const mappedActivities = proposalActivities.map(
													(act) => ({
														id: act.id || Date.now() + Math.random(),
														type: act.type || 'activity',
														source: 'proposal',
														name: act.name || act.activity_name || '',
														status: act.status || 'NEW',
														deliverables: act.deliverables || '',
														manhours: act.manhours || 0,
														assigned_users: act.assigned_users || [],
														function_name: act.function_name || 'From Proposal',
													})
												);
												setProjectActivities(mappedActivities);
											}
										} catch (err) {
											console.warn('Failed to parse proposal activities:', err);
										}
									}
								}
							}
						} catch (err) {
							console.warn('Failed to fetch proposal:', err);
						}
					}

					// Load team members
					if (project.team_members) {
						try {
							const parsed =
								typeof project.team_members === 'string'
									? JSON.parse(project.team_members)
									: project.team_members;
							setTeamMembers(Array.isArray(parsed) ? parsed : []);
						} catch {
							setTeamMembers([]);
						}
					}

					// Load project activities
					if (project.project_activities_list) {
						try {
							const parsed =
								typeof project.project_activities_list === 'string'
									? JSON.parse(project.project_activities_list)
									: project.project_activities_list;
							// Ensure assigned_users is always an array for each activity
							const activitiesWithUsers = (
								Array.isArray(parsed) ? parsed : []
							).map((act) => ({
								...act,
								assigned_users: Array.isArray(act.assigned_users)
									? act.assigned_users
									: [],
							}));
							setProjectActivities(activitiesWithUsers);
						} catch {
							setProjectActivities([]);
						}
					}

					// Load planning activities
					if (project.planning_activities_list) {
						try {
							const parsed =
								typeof project.planning_activities_list === 'string'
									? JSON.parse(project.planning_activities_list)
									: project.planning_activities_list;
							setPlanningActivities(Array.isArray(parsed) ? parsed : []);
						} catch {
							setPlanningActivities([]);
						}
					}

					// Load documents list
					if (project.documents_list) {
						try {
							const parsed =
								typeof project.documents_list === 'string'
									? JSON.parse(project.documents_list)
									: project.documents_list;
							setDocumentsList(Array.isArray(parsed) ? parsed : []);
						} catch {
							setDocumentsList([]);
						}
					}

					// Load input documents list - prioritize new structured field over legacy
					if (project.input_documents_list) {
						try {
							const parsed =
								typeof project.input_documents_list === 'string'
									? JSON.parse(project.input_documents_list)
									: project.input_documents_list;
							console.log(
								'[fetchProject] input_documents_list loaded:',
								parsed?.length,
								'items'
							);
							const normalized = (Array.isArray(parsed) ? parsed : []).map(
								(d) => ({
									...d,
									date_received: normalizeDate(d.date_received),
								})
							);
							setInputDocumentsList(normalized);
						} catch (err) {
							console.error(
								'[fetchProject] Error parsing input_documents_list:',
								err
							);
							setInputDocumentsList([]);
						}
					} else if (project.input_document) {
						let parsedDocs = [];
						try {
							const maybeJson = project.input_document.trim();
							if (maybeJson.startsWith('[')) {
								const arr = JSON.parse(maybeJson);
								if (Array.isArray(arr)) {
									parsedDocs = arr
										.map((d) => ({
											id: d.id || Date.now() + Math.random(),
											text: d.text || d.name || '',
											name: d.name || d.text || '',
											fileUrl: d.fileUrl || null,
											thumbUrl: d.thumbUrl || null,
											addedAt: d.addedAt || new Date().toISOString(),
										}))
										.filter((d) => d.text);
								}
							} else {
								// legacy comma separated
								parsedDocs = project.input_document
									.split(',')
									.map((doc, index) => ({
										id: Date.now() + index,
										text: doc.trim(),
										name: doc.trim(),
										fileUrl: null,
										thumbUrl: null,
										addedAt: new Date().toISOString(),
									}))
									.filter((doc) => doc.text);
							}
						} catch {
							// fallback to comma split
							parsedDocs = project.input_document
								.split(',')
								.map((doc, index) => ({
									id: Date.now() + index,
									text: doc.trim(),
									name: doc.trim(),
									fileUrl: null,
									thumbUrl: null,
									addedAt: new Date().toISOString(),
								}))
								.filter((doc) => doc.text);
						}
						setInputDocumentsList(
							parsedDocs.map((d) => ({
								...d,
								date_received: normalizeDate(d.date_received),
							}))
						);
					}

					// Load documents received list (new structured array)
					if (project.documents_received_list) {
						try {
							const parsed =
								typeof project.documents_received_list === 'string'
									? JSON.parse(project.documents_received_list)
									: project.documents_received_list;
							console.log(
								'[fetchProject] documents_received_list loaded:',
								parsed?.length,
								'items'
							);
							setDocumentsReceived(Array.isArray(parsed) ? parsed : []);
						} catch (err) {
							console.error(
								'[fetchProject] Error parsing documents_received_list:',
								err
							);
							setDocumentsReceived([]);
						}
					} else {
						console.log('[fetchProject] No documents_received_list found');
						setDocumentsReceived([]);
					}

					// Load project query log list
					if (project.project_query_log_list) {
						try {
							const parsed =
								typeof project.project_query_log_list === 'string'
									? JSON.parse(project.project_query_log_list)
									: project.project_query_log_list;
							setQueryLog(Array.isArray(parsed) ? parsed : []);
						} catch {
							setQueryLog([]);
						}
					} else {
						setQueryLog([]);
					}

					// Load project assumption list
					if (project.project_assumption_list) {
						try {
							const parsed =
								typeof project.project_assumption_list === 'string'
									? JSON.parse(project.project_assumption_list)
									: project.project_assumption_list;
							setAssumptions(Array.isArray(parsed) ? parsed : []);
						} catch {
							setAssumptions([]);
						}
					} else {
						setAssumptions([]);
					}

					// Load project lessons learnt list
					if (project.project_lessons_learnt_list) {
						try {
							const parsed =
								typeof project.project_lessons_learnt_list === 'string'
									? JSON.parse(project.project_lessons_learnt_list)
									: project.project_lessons_learnt_list;
							setLessonsLearnt(Array.isArray(parsed) ? parsed : []);
						} catch {
							setLessonsLearnt([]);
						}
					} else {
						setLessonsLearnt([]);
					}

					// Load documents issued list
					if (project.documents_issued_list) {
						try {
							const parsed =
								typeof project.documents_issued_list === 'string'
									? JSON.parse(project.documents_issued_list)
									: project.documents_issued_list;
							setDocumentsIssued(Array.isArray(parsed) ? parsed : []);
						} catch {
							setDocumentsIssued([]);
						}
					} else {
						setDocumentsIssued([]);
					}

					// Load project handover list
					if (project.project_handover_list) {
						try {
							const parsed =
								typeof project.project_handover_list === 'string'
									? JSON.parse(project.project_handover_list)
									: project.project_handover_list;
							setProjectHandover(Array.isArray(parsed) ? parsed : []);
						} catch {
							setProjectHandover([]);
						}
					} else {
						setProjectHandover([]);
					}

					// Load project manhours list - supports both old flat format and new month-grouped format
					if (project.project_manhours_list) {
						try {
							const parsed =
								typeof project.project_manhours_list === 'string'
									? JSON.parse(project.project_manhours_list)
									: project.project_manhours_list;

							if (Array.isArray(parsed) && parsed.length > 0) {
								// Check if it's the new format (has 'month' and 'entries' keys)
								const isNewFormat = parsed[0] && 'entries' in parsed[0];

								if (isNewFormat) {
									// Already in new format
									setProjectManhours(parsed);
								} else {
									// Old format - migrate to new format by grouping by month
									const groupedByMonth = {};
									parsed.forEach((row) => {
										const month = row.month || 'unknown';
										if (!groupedByMonth[month]) {
											groupedByMonth[month] = {
												id: Date.now() + Math.random(),
												month: month,
												entries: [],
											};
										}
										// Convert old row to new entry format
										groupedByMonth[month].entries.push({
											id: row.id || Date.now() + Math.random(),
											employee_id: null, // Old format didn't have this
											employee_name: row.name_of_engineer_designer || '',
											rate: 0, // Old format didn't track rate
											salary_type: 'monthly',
											// Sum all hour categories from old format
											hours:
												(parseFloat(row.engineering) || 0) +
												(parseFloat(row.designer) || 0) +
												(parseFloat(row.drafting) || 0) +
												(parseFloat(row.checking) || 0) +
												(parseFloat(row.coordination) || 0) +
												(parseFloat(row.site_visit) || 0) +
												(parseFloat(row.others) || 0),
											total_cost: 0,
											// Preserve old data in legacy field
											legacy_data: {
												engineering: row.engineering,
												designer: row.designer,
												drafting: row.drafting,
												checking: row.checking,
												coordination: row.coordination,
												site_visit: row.site_visit,
												others: row.others,
												remarks: row.remarks,
											},
										});
									});
									setProjectManhours(Object.values(groupedByMonth));
								}
							} else {
								setProjectManhours([]);
							}
						} catch {
							setProjectManhours([]);
						}
					} else {
						setProjectManhours([]);
					}

					// Load project schedule list
					if (project.project_schedule_list) {
						try {
							const parsed =
								typeof project.project_schedule_list === 'string'
									? JSON.parse(project.project_schedule_list)
									: project.project_schedule_list;
							if (
								parsed &&
								typeof parsed === 'object' &&
								!Array.isArray(parsed) &&
								Array.isArray(parsed.rows)
							) {
								setScheduleLocked(Boolean(parsed.locked));
								setProjectSchedule(normalizeScheduleRows(parsed.rows));
							} else {
								setScheduleLocked(false);
								setProjectSchedule(
									normalizeScheduleRows(Array.isArray(parsed) ? parsed : [])
								);
							}
						} catch {
							setScheduleLocked(false);
							setProjectSchedule([]);
						}
					} else {
						setScheduleLocked(false);
						setProjectSchedule([]);
					}

					// Load software items
					if (project.software_items) {
						try {
							const parsed =
								typeof project.software_items === 'string'
									? JSON.parse(project.software_items)
									: project.software_items;
							setSoftwareItems(Array.isArray(parsed) ? parsed : []);
						} catch {
							setSoftwareItems([]);
						}
					} else {
						setSoftwareItems([]);
					}

					// Load internal meetings list (new structured array) or fall back to legacy singular internal fields
					if (project.internal_meetings_list) {
						try {
							const parsed =
								typeof project.internal_meetings_list === 'string'
									? JSON.parse(project.internal_meetings_list)
									: project.internal_meetings_list;
							setInternalMeetings(Array.isArray(parsed) ? parsed : []);
						} catch {
							setInternalMeetings([]);
						}
					} else if (
						project.internal_meeting_no ||
						project.internal_meeting_title ||
						project.internal_persons_involved
					) {
						// backfill a single meeting record from legacy fields
						setInternalMeetings([
							{
								id: Date.now(),
								meeting_no: project.internal_meeting_no || '',
								client_name: project.internal_meeting_client_name || '',
								meeting_date: project.internal_meeting_date || '',
								organizer: project.internal_meeting_organizer || '',
								minutes_drafted: project.internal_minutes_drafted || '',
								meeting_location: project.internal_meeting_location || '',
								client_representative:
									project.internal_client_representative || '',
								meeting_title: project.internal_meeting_title || '',
								points_discussed: project.internal_points_discussed || '',
								persons_involved: project.internal_persons_involved || '',
							},
						]);
					} else {
						setInternalMeetings([]);
					}

					// Load kickoff meetings list (new structured array) or fall back to legacy singular kickoff fields
					if (project.kickoff_meetings_list) {
						try {
							const parsed =
								typeof project.kickoff_meetings_list === 'string'
									? JSON.parse(project.kickoff_meetings_list)
									: project.kickoff_meetings_list;
							setKickoffMeetings(Array.isArray(parsed) ? parsed : []);
						} catch {
							setKickoffMeetings([]);
						}
					} else if (
						project.kickoff_meeting_no ||
						project.kickoff_meeting_title ||
						project.kickoff_persons_involved
					) {
						// backfill a single meeting record from legacy fields
						setKickoffMeetings([
							{
								id: Date.now(),
								meeting_no: project.kickoff_meeting_no || '',
								client_name: project.kickoff_client_name || '',
								meeting_date: project.kickoff_meeting_date || '',
								organizer: project.kickoff_meeting_organizer || '',
								minutes_drafted: project.kickoff_minutes_drafted || '',
								meeting_location: project.kickoff_meeting_location || '',
								client_representative:
									project.kickoff_client_representative || '',
								meeting_title: project.kickoff_meeting_title || '',
								points_discussed: project.kickoff_points_discussed || '',
								persons_involved: project.kickoff_persons_involved || '',
							},
						]);
					} else {
						setKickoffMeetings([]);
					}
				} else {
					setError(result.error || 'Failed to load project');
				}
			} catch (error) {
				console.error('Failed to fetch project', error);
				setError(error?.message || 'Unable to load project');
			} finally {
				setLoading(false);
			}
		};

		fetchProject();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [id]);

	// Software Master, Users, and Document Master are now loaded via /api/projects/[id]/init-data

	// Fetch employees with their salary profiles for manhours rate lookup
	// Function to fetch attendance hours for an employee for a given year
	const fetchAttendanceHours = async (
		employeeId,
		year = new Date().getFullYear()
	) => {
		// Check cache first
		const cacheKey = `${employeeId}_${year}`;
		if (attendanceHoursCache[cacheKey]) {
			return attendanceHoursCache[cacheKey];
		}

		try {
			const res = await fetch(
				`/api/attendance?employee_id=${employeeId}&year=${year}`
			);
			const json = await res.json();

			if (json?.success && Array.isArray(json.records)) {
				const monthlyHours = {
					jan: 0,
					feb: 0,
					mar: 0,
					apr: 0,
					may: 0,
					jun: 0,
					jul: 0,
					aug: 0,
					sep: 0,
					oct: 0,
					nov: 0,
					dec: 0,
				};
				const monthMap = {
					'01': 'jan',
					'02': 'feb',
					'03': 'mar',
					'04': 'apr',
					'05': 'may',
					'06': 'jun',
					'07': 'jul',
					'08': 'aug',
					'09': 'sep',
					10: 'oct',
					11: 'nov',
					12: 'dec',
				};

				json.records.forEach((record) => {
					if (
						record.status === 'P' ||
						record.status === 'HD' ||
						record.status === 'OT'
					) {
						const date = new Date(record.attendance_date);
						const monthKey =
							monthMap[String(date.getMonth() + 1).padStart(2, '0')];

						// Calculate hours from in_time and out_time
						let hours = 8; // Default 8 hours if no time data
						if (record.in_time && record.out_time) {
							const [inH, inM] = record.in_time.split(':').map(Number);
							const [outH, outM] = record.out_time.split(':').map(Number);
							const inDecimal = inH + inM / 60;
							const outDecimal = outH + outM / 60;
							if (outDecimal > inDecimal) {
								hours = outDecimal - inDecimal;
								if (record.status === 'HD') hours = hours / 2; // Half day
							}
						}

						monthlyHours[monthKey] += hours;
					}
				});

				// Round to 1 decimal place
				Object.keys(monthlyHours).forEach((key) => {
					monthlyHours[key] = parseFloat(monthlyHours[key].toFixed(1));
				});

				// Cache the result
				setAttendanceHoursCache((prev) => ({
					...prev,
					[cacheKey]: monthlyHours,
				}));
				return monthlyHours;
			}
		} catch (error) {
			console.error('Failed to fetch attendance hours:', error);
		}
		return null;
	};

	useEffect(() => {
		const fetchEmployeesWithRates = async () => {
			setEmployeesLoading(true);
			try {
				// Fetch employees list from employee master
				const empRes = await fetch('/api/employee-master/list?limit=2000');
				if (!empRes.ok) {
					throw new Error(`HTTP ${empRes.status}: ${empRes.statusText}`);
				}
				const empJson = await empRes.json();

				if (!empJson || typeof empJson !== 'object') {
					console.error('Invalid response format:', empJson);
					setEmployeesWithRates([]);
					setEmployeesLoading(false);
					return;
				}

				if (empJson?.success && Array.isArray(empJson.data)) {
					// First, set employees immediately without rates so UI is responsive
					const basicEmployeesData = empJson.data.map((emp) => ({
						id: emp.id,
						name:
							emp.full_name ||
							`${emp.first_name || ''} ${emp.last_name || ''}`.trim() ||
							emp.email ||
							`Employee ${emp.id}`,
						employee_id: emp.employee_id,
						department: emp.department,
						workplace: emp.workplace,
						rate: 0,
						salary_type: 'monthly',
					}));
					setEmployeesWithRates(basicEmployeesData);
					setEmployeesLoading(false);

					// Then fetch salary profiles in batches to get rates
					const batchSize = 10;
					const updatedEmployees = [...basicEmployeesData];

					for (let i = 0; i < empJson.data.length; i += batchSize) {
						const batch = empJson.data.slice(i, i + batchSize);

						await Promise.all(
							batch.map(async (emp, batchIndex) => {
								try {
									const salaryRes = await fetch(
										`/api/payroll/salary-profile?employee_id=${emp.id}`
									);
									const salaryJson = await salaryRes.json();

									const latestProfile = salaryJson?.data?.[0] || null;

									let rate = 0;
									let salaryType = 'monthly';

									if (latestProfile) {
										salaryType = latestProfile.salary_type || 'monthly';

										if (salaryType === 'hourly') {
											rate = parseFloat(latestProfile.hourly_rate) || 0;
										} else if (salaryType === 'daily') {
											rate = parseFloat(latestProfile.daily_rate) || 0;
										} else if (salaryType === 'custom') {
											try {
												const customData = latestProfile.lumpsum_description
													? JSON.parse(latestProfile.lumpsum_description)
													: {};
												rate =
													parseFloat(customData.hourly_rate) ||
													parseFloat(latestProfile.hourly_rate) ||
													0;
											} catch {
												rate = parseFloat(latestProfile.hourly_rate) || 0;
											}
										} else {
											const grossSalary =
												parseFloat(latestProfile.gross_salary) ||
												parseFloat(latestProfile.employer_cost) ||
												0;
											const stdWorkingDays =
												parseFloat(latestProfile.std_working_days) || 26;
											const stdHoursPerDay =
												parseFloat(latestProfile.std_hours_per_day) || 8;
											rate =
												grossSalary > 0
													? parseFloat(
															(
																grossSalary /
																(stdWorkingDays * stdHoursPerDay)
															).toFixed(2)
														)
													: 0;
										}
									}

									const globalIndex = i + batchIndex;
									updatedEmployees[globalIndex] = {
										...updatedEmployees[globalIndex],
										rate: rate,
										salary_type: salaryType,
									};
								} catch (err) {
									console.error(
										`Failed to fetch salary for employee ${emp.id}:`,
										err
									);
								}
							})
						);

						// Update state after each batch
						setEmployeesWithRates([...updatedEmployees]);
					}
				} else {
					console.error(
						'Failed to fetch employees - invalid response structure:',
						empJson
					);
					setEmployeesWithRates([]);
					setEmployeesLoading(false);
				}
			} catch (error) {
				console.error('Failed to fetch employees with rates:', error);
				setEmployeesLoading(false);
			}
		};

		fetchEmployeesWithRates();
	}, []);

	// Load project team members from project data
	useEffect(() => {
		if (form.project_team) {
			try {
				const teamData =
					typeof form.project_team === 'string'
						? JSON.parse(form.project_team)
						: form.project_team;
				if (Array.isArray(teamData)) {
					setProjectTeamMembers(teamData);
				}
			} catch (error) {
				console.error('Failed to parse project_team:', error);
			}
		}
	}, [form.project_team]);

	// Note: projectActivities is loaded from database or manually selected by user
	// It's not auto-populated from Activity Master to allow users to select specific activities

	const handleChange = (event) => {
		const { name, value } = event.target;
		console.log('[handleChange]', name, '=', value);
		setForm({ ...form, [name]: value });
	};

	// Quotation Form Handlers
	const handleQuotationChange = (e) => {
		if (!canEditQuotations) return; // Prevent changes if no edit permission
		const { name, value } = e.target;
		setQuotationData((prev) => {
			const updated = { ...prev, [name]: value };

			// Auto-calculate GST and net amount when gross amount changes
			if (name === 'gross_amount') {
				const gross = parseFloat(value) || 0;
				const gstRate = parseFloat(prev.gst_percentage) || 18;
				const gstAmount = (gross * gstRate) / 100;
				updated.gst_amount = gstAmount.toFixed(2);
				updated.net_amount = (gross + gstAmount).toFixed(2);
			}

			// Recalculate if GST percentage changes
			if (name === 'gst_percentage') {
				const gross = parseFloat(prev.gross_amount) || 0;
				const gstRate = parseFloat(value) || 18;
				const gstAmount = (gross * gstRate) / 100;
				updated.gst_amount = gstAmount.toFixed(2);
				updated.net_amount = (gross + gstAmount).toFixed(2);
			}

			return updated;
		});
	};

	const saveQuotation = async () => {
		setQuotationSaving(true);
		try {
			const res = await fetch(`/api/projects/${id}/quotation`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(quotationData),
			});
			const json = await res.json();
			if (json?.success) {
				alert('Quotation saved successfully!');
			} else {
				alert('Failed to save quotation: ' + (json?.error || 'Unknown error'));
			}
		} catch (error) {
			console.error('Error saving quotation:', error);
			alert('Error saving quotation');
		} finally {
			setQuotationSaving(false);
		}
	};

	// Fetch latest quotation number from admin quotation page (by project or proposal linkage)
	const syncQuotationFromAdmin = useCallback(async () => {
		// Try to fetch by proposal_id if available, else by project id
		let url = '';
		if (form.proposal_id) {
			url = `/api/admin/quotations/${form.proposal_id}?source=proposal`;
		} else if (id) {
			url = `/api/admin/quotations/${id}`;
		} else {
			setQuotationData((prev) => ({ ...prev }));
			return;
		}
		try {
			const res = await fetch(url);
			const json = await res.json();
			if (json?.success && json.data) {
				const q = json.data;
				let scopeItems = [];
				if (q.scope_items) {
					try {
						scopeItems =
							typeof q.scope_items === 'string'
								? JSON.parse(q.scope_items)
								: q.scope_items;
					} catch (e) {
						/* ignore */
					}
				}
				setQuotationData({
					quotation_number: q.quotation_number || '',
					quotation_date: q.quotation_date
						? q.quotation_date.split('T')[0]
						: '',
					client_name: q.client_name || '',
					enquiry_number: q.enquiry_number || '',
					enquiry_quantity: scopeItems?.[0]?.qty || '',
					scope_of_work: q.annexure_scope_of_work || q.scope_of_work || '',
					gross_amount: q.gross_amount || '',
					gst_percentage: q.gst_percentage || 18,
					gst_amount: q.gst_amount || '',
					net_amount: q.net_amount || '',
					amount_in_words: q.amount_in_words || '',
					scope_items: scopeItems,
				});
			}
		} catch (err) {
			console.warn('Failed to fetch admin quotation data:', err);
		}
	}, [form.proposal_id, id]);

	// Auto-sync when switching to quotation tab (after project data is loaded)
	useEffect(() => {
		if (activeTab === 'quotation' && !loading && id) {
			syncQuotationFromAdmin();
		}
	}, [activeTab, loading, id, syncQuotationFromAdmin]);

	// Purchase Order Form Handlers
	const handlePurchaseOrderChange = (e) => {
		if (!canEditPurchaseOrders) return; // Prevent changes if no edit permission
		const { name, value } = e.target;
		setPurchaseOrderData((prev) => {
			const updated = { ...prev, [name]: value };

			// Auto-calculate GST and net amount when gross amount changes
			if (name === 'gross_amount') {
				const gross = parseFloat(value) || 0;
				const gstRate = parseFloat(prev.gst_percentage) || 18;
				const gstAmount = (gross * gstRate) / 100;
				updated.gst_amount = gstAmount.toFixed(2);
				updated.net_amount = (gross + gstAmount).toFixed(2);
			}

			// Recalculate if GST percentage changes
			if (name === 'gst_percentage') {
				const gross = parseFloat(prev.gross_amount) || 0;
				const gstRate = parseFloat(value) || 18;
				const gstAmount = (gross * gstRate) / 100;
				updated.gst_amount = gstAmount.toFixed(2);
				updated.net_amount = (gross + gstAmount).toFixed(2);
			}

			return updated;
		});
	};

	// Handle vendor selection from dropdown
	const handleVendorSelect = (e) => {
		if (!canEditPurchaseOrders) return;
		const vendorId = e.target.value;
		if (vendorId === '') {
			setSelectedVendor(null);
			setPurchaseOrderData((prev) => ({
				...prev,
				vendor_name: '',
				vendor_id: '',
			}));
			return;
		}
		const vendor = vendors.find((v) => v.id.toString() === vendorId);
		setSelectedVendor(vendor || null);
		if (vendor) {
			setPurchaseOrderData((prev) => ({
				...prev,
				vendor_name: vendor.vendor_name || '',
				vendor_id: vendor.id,
			}));
		}
	};

	const savePurchaseOrder = async () => {
		// Validate vendor selection
		if (!selectedVendor && !purchaseOrderData.vendor_name) {
			alert('Please select a vendor from the dropdown');
			return;
		}

		setPurchaseOrderSaving(true);
		try {
			// Save to project-specific purchase order
			const res = await fetch(`/api/projects/${id}/purchase-order`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(purchaseOrderData),
			});
			const json = await res.json();

			if (json?.success) {
				// Also save to main purchase orders table for display on Purchase Order page
				const vendorAddress = selectedVendor
					? [
							selectedVendor.address_street,
							selectedVendor.address_city,
							selectedVendor.address_state,
							selectedVendor.address_country,
							selectedVendor.address_pin,
						]
							.filter(Boolean)
							.join(', ')
					: '';

				const mainPORes = await fetch('/api/admin/purchase-orders', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						po_number: purchaseOrderData.po_number,
						vendor_name:
							purchaseOrderData.vendor_name || selectedVendor?.vendor_name,
						vendor_email: selectedVendor?.email || '',
						vendor_phone: selectedVendor?.phone || '',
						vendor_address: vendorAddress,
						description: purchaseOrderData.scope_of_work,
						items: [],
						subtotal: parseFloat(purchaseOrderData.gross_amount) || 0,
						tax_rate: parseFloat(purchaseOrderData.gst_percentage) || 18,
						tax_amount: parseFloat(purchaseOrderData.gst_amount) || 0,
						discount: 0,
						total: parseFloat(purchaseOrderData.net_amount) || 0,
						notes: purchaseOrderData.remarks,
						terms: purchaseOrderData.payment_terms,
						delivery_date: purchaseOrderData.delivery_date || null,
						status: 'pending',
						project_id: id,
					}),
				});

				const mainPOJson = await mainPORes.json();

				if (mainPOJson?.success) {
					alert('Purchase Order saved successfully!');
				} else {
					// Project PO saved but main PO failed - still consider partial success
					alert(
						'Purchase Order saved to project. Note: ' +
							(mainPOJson?.message || 'Could not sync to main PO list')
					);
				}
			} else {
				alert(
					'Failed to save purchase order: ' + (json?.error || 'Unknown error')
				);
			}
		} catch (error) {
			console.error('Error saving purchase order:', error);
			alert('Error saving purchase order');
		} finally {
			setPurchaseOrderSaving(false);
		}
	};

	// Sync purchase order data - only client name from project
	const syncPurchaseOrderFromProject = useCallback(() => {
		setPurchaseOrderData((prev) => {
			// If vendor_id exists in previous data, find and set the selected vendor
			if (prev.vendor_id && vendors.length > 0) {
				const vendor = vendors.find(
					(v) =>
						v.id === prev.vendor_id ||
						v.id.toString() === prev.vendor_id.toString()
				);
				if (vendor) {
					setSelectedVendor(vendor);
				}
			}
			return {
				...prev,
				po_number: prev.po_number || `PO-${String(id).padStart(5, '0')}`,
				po_date: prev.po_date || new Date().toISOString().split('T')[0],
				client_name: form.client_name || '',
			};
		});
	}, [form.client_name, id, vendors]);

	// Auto-sync when switching to purchase order tab (after project data is loaded)
	useEffect(() => {
		if (activeTab === 'purchase_order' && !loading && id) {
			syncPurchaseOrderFromProject();
		}
	}, [activeTab, loading, id, syncPurchaseOrderFromProject]);

	// Sync incoming PO data with project details
	useEffect(() => {
		if (activeTab === 'purchase_order' && form.client_name) {
			setIncomingPOData((prev) => ({
				...prev,
				company_name: form.client_name,
				city: form.project_location_city || '',
			}));
		}
	}, [activeTab, form.client_name, form.project_location_city]);

	// Sync invoice data with project details (company name and city) for both invoice and purchase_order tabs
	useEffect(() => {
		if (
			(activeTab === 'invoice' || activeTab === 'purchase_order') &&
			form.client_name
		) {
			setInvoiceData((prev) => ({
				...prev,
				company_name: form.client_name,
				city: form.project_location_city || '',
				project_number: form.project_code || '',
			}));
		}
	}, [
		activeTab,
		form.client_name,
		form.project_location_city,
		form.project_code,
	]);

	// Incoming Purchase Order Handlers
	const handleIncomingPOChange = (e) => {
		if (!canEditPurchaseOrders) return;
		const { name, value } = e.target;
		setIncomingPOData((prev) => ({ ...prev, [name]: value }));
	};

	const handleAddIncomingPO = async () => {
		if (!incomingPOData.company_name) {
			alert('Please ensure company name from project details is set');
			return;
		}
		if (!incomingPOData.po_number) {
			alert('Please enter PO number');
			return;
		}

		setPurchaseOrderSaving(true);
		try {
			const res = await fetch(`/api/projects/${id}/incoming-po`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...incomingPOData,
					project_id: id,
				}),
			});

			// Handle 404 or other errors gracefully - API endpoint not yet implemented
			if (!res.ok) {
				if (res.status === 404) {
					console.warn(
						'Incoming PO API endpoint not yet implemented. Feature will be available once backend is updated.'
					);
					alert(
						'Incoming PO feature is not yet available. Please try again later.'
					);
				} else {
					alert('Failed to add incoming PO: Server error');
				}
				return;
			}

			const json = await res.json();
			if (json?.success) {
				// Refresh incoming POs list
				await fetchIncomingPOs();
				// Reset form but keep company_name and city from project
				setIncomingPOData({
					company_name: form.client_name,
					city: form.project_location_city || '',
					po_number: '',
					po_date: new Date().toISOString().split('T')[0],
					po_amount: '',
					project_number: form.project_code || '',
					expenses_head: '',
					remarks: '',
				});
				alert('Incoming PO added successfully!');
			} else {
				alert('Failed to add incoming PO: ' + (json?.error || 'Unknown error'));
			}
		} catch (error) {
			console.error('Error adding incoming PO:', error);
			alert('Error adding incoming PO');
		} finally {
			setPurchaseOrderSaving(false);
		}
	};

	const handleDeleteIncomingPO = async (poId) => {
		if (!confirm('Are you sure you want to delete this incoming PO?')) return;

		try {
			const res = await fetch(`/api/projects/${id}/incoming-po/${poId}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
			});

			// Handle 404 or other errors gracefully
			if (!res.ok) {
				if (res.status === 404) {
					console.warn('Incoming PO API endpoint not yet implemented');
					alert('Incoming PO feature is not yet available');
				} else {
					alert('Failed to delete incoming PO: Server error');
				}
				return;
			}

			const json = await res.json();
			if (json?.success) {
				await fetchIncomingPOs();
			} else {
				alert(
					'Failed to delete incoming PO: ' + (json?.error || 'Unknown error')
				);
			}
		} catch (error) {
			console.warn('Error deleting incoming PO:', error);
			// Silently fail as API might not be implemented yet
		}
	};

	const fetchIncomingPOs = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${id}/incoming-po`);

			// If endpoint doesn't exist (404 or other error), silently fail
			if (!res.ok) {
				console.warn(
					`Incoming POs API returned ${res.status}, using empty list`
				);
				setIncomingPOs([]);
				return;
			}

			const json = await res.json();
			if (json?.success && Array.isArray(json.data)) {
				setIncomingPOs(json.data);
			} else {
				setIncomingPOs([]);
			}
		} catch (error) {
			console.warn(
				'Incoming POs API not yet available, using empty list:',
				error
			);
			setIncomingPOs([]);
		}
	}, [id]);

	// Auto-fetch incoming POs when switching to purchase_order tab
	useEffect(() => {
		if (activeTab === 'purchase_order' && !loading && id) {
			fetchIncomingPOs();
		}
	}, [activeTab, loading, id, fetchIncomingPOs]);

	// Invoice Handlers
	const handleInvoiceChange = (e) => {
		if (!canEditInvoices && !canEditPurchaseOrders) return; // Prevent changes if no edit permission
		const { name, value } = e.target;
		setInvoiceData((prev) => {
			const updated = { ...prev, [name]: value };
			return updated;
		});
	};

	const handleAddInvoice = async () => {
		if (!invoiceData.invoice_number) {
			alert('Please enter an invoice number');
			return;
		}

		setInvoiceSaving(true);
		try {
			const isEditing = !!editingInvoiceId;
			const payload = { ...invoiceData, tab_type: activeTab };
			const res = await fetch(`/api/projects/${id}/invoice`, {
				method: isEditing ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					isEditing ? { ...payload, invoiceId: editingInvoiceId } : payload
				),
			});
			const json = await res.json();
			if (json?.success) {
				// Refresh invoices list
				await fetchInvoices();
				// Reset form
				setEditingInvoiceId(null);
				setInvoiceData((prev) => ({
					...prev,
					invoice_number: '',
					invoice_date: new Date().toISOString().split('T')[0],
					company_name: form.client_name || '',
					city: form.project_location_city || '',
					project_number: form.project_code || '',
					invoice_amount: '',
					purchase_description: '',
					expenses_head: '',

					payment: '',
					payment_overdue_days: '',
					remarks: '',
				}));
			} else {
				alert(
					(isEditing
						? 'Failed to update invoice: '
						: 'Failed to add invoice: ') + (json?.error || 'Unknown error')
				);
			}
		} catch (error) {
			console.error('Error saving invoice:', error);
			alert('Error saving invoice');
		} finally {
			setInvoiceSaving(false);
		}
	};

	const handleDeleteInvoice = async (invoiceId) => {
		if (!confirm('Are you sure you want to delete this invoice?')) return;

		try {
			const res = await fetch(
				`/api/projects/${id}/invoice?invoiceId=${invoiceId}`,
				{
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
				}
			);
			const json = await res.json();
			if (json?.success) {
				await fetchInvoices();
			} else {
				alert('Failed to delete invoice: ' + (json?.error || 'Unknown error'));
			}
		} catch (error) {
			console.error('Error deleting invoice:', error);
			alert('Error deleting invoice');
		}
	};

	const handleEditInvoice = (inv) => {
		setEditingInvoiceId(inv.id);
		setInvoiceData({
			invoice_number: inv.invoice_number || '',
			invoice_date: inv.invoice_date
				? String(inv.invoice_date).split('T')[0]
				: '',
			company_name: inv.company_name || '',
			city: inv.city || '',
			invoice_amount: inv.invoice_amount || '',
			purchase_description: inv.purchase_description || '',
			project_number: inv.project_number || '',
			expenses_head: inv.expenses_head || '',
			payment: inv.payment || '',
			payment_overdue_days: inv.payment_overdue_days || '',
			remarks: inv.remarks || '',
		});
		// Scroll to the form
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	const saveInvoice = async () => {
		setInvoiceSaving(true);
		try {
			const res = await fetch(`/api/projects/${id}/invoice`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(invoiceData),
			});
			const json = await res.json();
			if (json?.success) {
				alert('Invoice saved successfully!');
				// Refresh invoices list - this will also update nextInvoiceNumber
				await fetchInvoices();
				// Reset form for new invoice
				setInvoiceData((prev) => ({
					...prev,
					invoice_number: '',
					invoice_date: new Date().toISOString().split('T')[0],
					company_name: form.client_name || '',
					city: form.project_location_city || '',
					invoice_amount: '',
					purchase_description: '',
					project_number: form.project_code || '',
					expenses_head: '',
					payment_overdue_days: '',
					remarks: '',
				}));
			} else {
				alert('Failed to save invoice: ' + (json?.error || 'Unknown error'));
			}
		} catch (error) {
			console.error('Error saving invoice:', error);
			alert('Error saving invoice');
		} finally {
			setInvoiceSaving(false);
		}
	};

	const fetchInvoices = useCallback(async () => {
		try {
			const res = await fetch(`/api/projects/${id}/invoice`);
			const json = await res.json();
			if (json?.success) {
				setInvoices(json.invoices || []);
				if (json.nextInvoiceNumber) {
					setNextInvoiceNumber(json.nextInvoiceNumber);
				}
			}
		} catch (error) {
			console.error('Error fetching invoices:', error);
		}
	}, [id]);

	// Sync invoice data from project details only (company_name, city, project_number)
	const syncInvoiceFromProject = useCallback(() => {
		setInvoiceData((prev) => ({
			...prev,
			// Only sync the project-level data; other fields come from user input
			company_name: prev.company_name || form.client_name || '',
			city: prev.city || form.project_location_city || '',
			project_number: prev.project_number || form.project_code || '',
		}));
	}, [form.client_name, form.project_location_city, form.project_code]);

	// Auto-sync when switching to invoice or purchase_order tab
	useEffect(() => {
		if (
			(activeTab === 'invoice' || activeTab === 'purchase_order') &&
			!loading &&
			id
		) {
			// Ensure invoice/PO list and nextInvoiceNumber are loaded before syncing
			fetchInvoices().then(() => {
				syncInvoiceFromProject();
			});
		}
	}, [activeTab, loading, id, fetchInvoices, syncInvoiceFromProject]);

	// Recalculate balance when invoices change
	useEffect(() => {
		if (activeTab === 'invoice') {
			syncInvoiceFromProject();
		}
	}, [invoices, activeTab, syncInvoiceFromProject]);

	// Apply next invoice number as soon as it's available and field is empty
	useEffect(() => {
		if (
			activeTab === 'invoice' &&
			nextInvoiceNumber &&
			!invoiceData.invoice_number
		) {
			setInvoiceData((prev) => ({
				...prev,
				invoice_number: nextInvoiceNumber,
			}));
		}
	}, [activeTab, nextInvoiceNumber, invoiceData.invoice_number]);

	// Input Document List Management with Categories and Full Details
	const addInputDocument = () => {
		if (newInputDocument.description.trim()) {
			const newDoc = {
				id: Date.now(),
				sr_no: newInputDocument.sr_no || String(inputDocumentsList.length + 1),
				date_received:
					normalizeDate(newInputDocument.date_received) ||
					new Date().toISOString().split('T')[0],
				description: newInputDocument.description.trim(),
				drawing_number: newInputDocument.drawing_number || '',
				sheet_number: newInputDocument.sheet_number || '',
				revision_number: newInputDocument.revision_number || '',
				unit_qty: newInputDocument.unit_qty || '',
				document_sent_by: newInputDocument.document_sent_by || '',
				remarks: newInputDocument.remarks || '',
				category: newInputDocument.category || 'others',
				lotNumber: newInputDocument.lotNumber || '',
				subLot: newInputDocument.subLot || '',
				addedAt: new Date().toISOString(),
			};
			const updated = [...inputDocumentsList, newDoc];
			setInputDocumentsList(updated);
			setNewInputDocument({
				sr_no: '',
				date_received: '',
				description: '',
				drawing_number: '',
				sheet_number: '',
				revision_number: '',
				unit_qty: '',
				document_sent_by: '',
				remarks: '',
				category: 'lot',
				lotNumber: '',
				subLot: '',
			});
			// Persist as JSON array
			setForm((prev) => ({ ...prev, input_document: JSON.stringify(updated) }));
		}
	};

	const removeInputDocument = (id) => {
		const updatedList = inputDocumentsList.filter((doc) => doc.id !== id);
		setInputDocumentsList(updatedList);
		setForm((prev) => ({
			...prev,
			input_document: JSON.stringify(updatedList),
		}));
	};

	const handleInputDocumentKeyPress = (e) => {
		if (
			e.key === 'Enter' &&
			(e.target.name === 'description' || e.target.name === 'drawing_number')
		) {
			e.preventDefault();
			addInputDocument();
		}
	};

	// Document master is loaded via /api/projects/[id]/init-data

	// Software Management Functions
	const addSoftwareItem = () => {
		if (
			!selectedSoftwareCategory ||
			!selectedSoftware ||
			!selectedSoftwareVersion
		) {
			alert('Please select category, software, and version');
			return;
		}

		const category = softwareCategories.find(
			(c) => c.id === selectedSoftwareCategory
		);
		const software = category?.softwares?.find(
			(s) => s.id === selectedSoftware
		);
		const version = software?.versions?.find(
			(v) => v.id === selectedSoftwareVersion
		);

		if (!category || !software || !version) return;

		// Check if already added
		const exists = softwareItems.some(
			(item) =>
				item.software_id === selectedSoftware &&
				item.version_id === selectedSoftwareVersion
		);

		if (exists) {
			alert('This software version is already added');
			return;
		}

		const newItem = {
			id: Date.now(),
			category_id: category.id,
			category_name: category.name,
			software_id: software.id,
			software_name: software.name,
			provider: software.provider || '',
			version_id: version.id,
			version_name: version.name,
			release_date: version.release_date || '',
			notes: version.notes || '',
		};

		setSoftwareItems((prev) => [...prev, newItem]);

		// Reset selections
		setSelectedSoftwareCategory('');
		setSelectedSoftware('');
		setSelectedSoftwareVersion('');
	};

	// Project Team Management Functions
	const addTeamMember = (user) => {
		// Check if already added
		const exists = projectTeamMembers.some((member) => member.id === user.id);
		if (exists) {
			alert('This user is already in the team');
			return;
		}

		const teamMember = {
			id: user.id,
			employee_id: user.employee_id || user.id,
			name: user.full_name || user.username,
			email: user.email,
			department: user.department || '',
			position: user.role_name || '',
			role: 'Team Member', // Default role, can be changed
		};

		setProjectTeamMembers((prev) => [...prev, teamMember]);

		// Update form data
		setForm((prev) => ({
			...prev,
			project_team: JSON.stringify([...projectTeamMembers, teamMember]),
		}));
	};

	const removeTeamMember = (memberId) => {
		const updated = projectTeamMembers.filter(
			(member) => member.id !== memberId
		);
		setProjectTeamMembers(updated);

		// Update form data
		setForm((prev) => ({
			...prev,
			project_team: JSON.stringify(updated),
		}));
	};

	const updateTeamMemberRole = (memberId, newRole) => {
		const updated = projectTeamMembers.map((member) =>
			member.id === memberId ? { ...member, role: newRole } : member
		);
		setProjectTeamMembers(updated);

		// Update form data
		setForm((prev) => ({
			...prev,
			project_team: JSON.stringify(updated),
		}));
	};

	// Get filtered users for team selection (only show those not already in team)
	const availableUsers = allUsers.filter(
		(user) =>
			!projectTeamMembers.some((member) => member.id === user.id) &&
			(teamMemberSearch === '' ||
				(user.full_name || user.username || '')
					.toLowerCase()
					.includes(teamMemberSearch.toLowerCase()) ||
				user.email?.toLowerCase().includes(teamMemberSearch.toLowerCase()) ||
				user.department?.toLowerCase().includes(teamMemberSearch.toLowerCase()))
	);

	// Get project team members for use in other tabs (replaces full user list)
	// This ensures only assigned team members appear in dropdowns throughout the project
	const getProjectTeamForDropdown = () => {
		return projectTeamMembers.map((member) => ({
			id: member.id,
			employee_id: member.employee_id,
			name: member.name,
			first_name: member.name.split(' ')[0],
			last_name: member.name.split(' ').slice(1).join(' '),
			email: member.email,
			department: member.department,
			position: member.position,
			project_role: member.role,
		}));
	};

	const removeSoftwareItem = (id) => {
		const updated = softwareItems.filter((item) => item.id !== id);
		setSoftwareItems(updated);
		setForm((prev) => ({ ...prev, software_items: JSON.stringify(updated) }));
	};

	// Get available software for selected category
	const availableSoftware = selectedSoftwareCategory
		? softwareCategories.find((c) => c.id === selectedSoftwareCategory)
				?.softwares || []
		: [];

	// Get available versions for selected software
	const availableVersions = selectedSoftware
		? availableSoftware.find((s) => s.id === selectedSoftware)?.versions || []
		: [];

	// File upload for input documents (images / svg -> via /api/uploads). Supports bulk file selection.
	const handleInputDocumentFileUpload = async (event) => {
		const files = Array.from(event.target.files || []);
		if (files.length === 0) return;

		try {
			const toBase64 = (file) =>
				new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});

			const uploadedDocs = [];
			const failedFiles = [];

			for (const file of files) {
				try {
					const b64 = await toBase64(file);
					const uploadResp = await fetchJSON('/api/uploads', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ filename: file.name, b64 }),
					});

					if (uploadResp.success) {
						uploadedDocs.push({
							id: `${Date.now()}-${uploadedDocs.length}`,
							text: file.name,
							name: file.name,
							fileUrl: uploadResp.data.fileUrl,
							thumbUrl: uploadResp.data.thumbUrl,
							addedAt: new Date().toISOString(),
						});
					} else {
						failedFiles.push(file.name);
					}
				} catch (err) {
					console.error('Upload failed for file:', file.name, err);
					failedFiles.push(file.name);
				}
			}

			if (uploadedDocs.length > 0) {
				const updated = [...inputDocumentsList, ...uploadedDocs];
				setInputDocumentsList(updated);
				setForm((prev) => ({
					...prev,
					input_document: JSON.stringify(updated),
				}));
			}

			if (failedFiles.length > 0) {
				alert(`Some files failed to upload: ${failedFiles.join(', ')}`);
			}
		} catch (e) {
			console.error('File processing error', e);
			alert('Upload failed');
		} finally {
			// reset input so same files can be re-selected
			event.target.value = '';
		}
	};

	// Documents Received helpers
	const addReceivedDocument = () => {
		console.log('[addReceivedDocument] Called with:', newReceivedDoc);
		// Basic validation: require description
		if (!newReceivedDoc.description || !newReceivedDoc.description.trim())
			return;

		// Default date to today if not provided
		const today = new Date().toISOString().slice(0, 10);
		const doc = {
			...newReceivedDoc,
			id: Date.now(),
			date_received: normalizeDate(newReceivedDoc.date_received) || today,
		};
		console.log('[addReceivedDocument] Adding document:', doc);
		setDocumentsReceived((prev) => {
			const updated = [...prev, doc];
			console.log(
				'[addReceivedDocument] New documentsReceived array:',
				updated
			);
			return updated;
		});
		setNewReceivedDoc({
			date_received: '',
			description: '',
			drawing_number: '',
			revision_number: '',
			unit_qty: '',
			document_sent_by: '',
			remarks: '',
		});

		// Focus description input for fast entry
		setTimeout(() => {
			newReceivedDescRef.current?.focus();
		}, 10);
	};

	const updateReceivedDocument = (id, field, value) => {
		setDocumentsReceived((prev) =>
			prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
		);
	};

	const removeReceivedDocument = (id) => {
		setDocumentsReceived((prev) => prev.filter((d) => d.id !== id));
	};

	// Documents Issued helpers
	const addIssuedDocument = () => {
		if (!newIssuedDoc.document_name || !newIssuedDoc.document_name.trim())
			return;
		const issueDate =
			newIssuedDoc.issue_date || new Date().toISOString().slice(0, 10);
		const doc = { ...newIssuedDoc, id: Date.now(), issue_date: issueDate };
		setDocumentsIssued((prev) => [...prev, doc]);
		setNewIssuedDoc({
			document_name: '',
			issued_for: '',
			document_number: '',
			revision_number: '',
			issue_date: '',
			remarks: '',
		});
		setTimeout(() => newIssuedDescRef.current?.focus(), 10);
	};

	const updateIssuedDocument = (id, field, value) => {
		setDocumentsIssued((prev) =>
			prev.map((d) => (d.id === id ? { ...d, [field]: value } : d))
		);
	};

	const removeIssuedDocument = (id) => {
		setDocumentsIssued((prev) => prev.filter((d) => d.id !== id));
	};

	// Project Handover helpers
	const addHandoverRow = () => {
		console.log('[addHandoverRow] Called with:', newHandoverRow);
		if (
			!newHandoverRow.output_by_accent ||
			!newHandoverRow.output_by_accent.trim()
		) {
			console.log(
				'[addHandoverRow] Validation failed - output_by_accent is required'
			);
			return;
		}
		const row = { ...newHandoverRow, id: Date.now() };
		console.log('[addHandoverRow] Adding row:', row);
		setProjectHandover((prev) => {
			const updated = [...prev, row];
			console.log(
				'[addHandoverRow] New projectHandover array length:',
				updated.length
			);
			console.log('[addHandoverRow] New projectHandover array:', updated);
			return updated;
		});
		setNewHandoverRow({
			output_by_accent: '',
			requirement_accomplished: '',
			remark: '',
			hand_over: '',
		});
		setTimeout(() => newHandoverDescRef.current?.focus(), 10);
	};

	const updateHandoverRow = (id, field, value) => {
		setProjectHandover((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
		);
	};

	const removeHandoverRow = (id) => {
		setProjectHandover((prev) => prev.filter((r) => r.id !== id));
	};

	// Project Manhours helpers - new structure grouped by month
	const getNextMonth = (currentMonth) => {
		if (!currentMonth) {
			// Default to current month if no month provided
			const now = new Date();
			return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		}
		const [year, month] = currentMonth.split('-').map(Number);
		const nextMonth = month === 12 ? 1 : month + 1;
		const nextYear = month === 12 ? year + 1 : year;
		return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
	};

	// Generate array of months between start and end (inclusive)
	const generateMonthRange = (start, end) => {
		if (!start || !end) return [];
		const months = [];
		let [startYear, startMonth] = start.split('-').map(Number);
		const [endYear, endMonth] = end.split('-').map(Number);

		while (
			startYear < endYear ||
			(startYear === endYear && startMonth <= endMonth)
		) {
			months.push(`${startYear}-${String(startMonth).padStart(2, '0')}`);
			if (startMonth === 12) {
				startMonth = 1;
				startYear++;
			} else {
				startMonth++;
			}
		}
		return months;
	};

	// Add multiple month sections at once
	const addMonthSections = () => {
		// Get months from range
		const monthsToAdd = generateMonthRange(monthRangeStart, monthRangeEnd);

		if (monthsToAdd.length === 0) {
			alert('Please select a valid month range (From and To)');
			return;
		}

		// Filter out months that already exist
		const existingMonths = projectManhours.map((m) => m.month);
		const newMonths = monthsToAdd.filter((m) => !existingMonths.includes(m));

		if (newMonths.length === 0) {
			alert('All selected months already exist');
			return;
		}

		// Create new month entries
		const newMonthEntries = newMonths.map((month, idx) => ({
			id: Date.now() + idx,
			month: month,
			entries: [],
		}));

		setProjectManhours((prev) =>
			[...prev, ...newMonthEntries].sort((a, b) =>
				a.month.localeCompare(b.month)
			)
		);

		// Clear selection
		setMonthRangeStart('');
		setMonthRangeEnd('');
	};

	// Add an employee entry to a specific month
	const addManhourEntry = (monthId) => {
		if (!newManhourEntry.employee_id || !newManhourEntry.hours) return;

		const employee = employeesWithRates.find(
			(e) => e.id === parseInt(newManhourEntry.employee_id)
		);
		if (!employee) return;

		const entry = {
			id: Date.now(),
			employee_id: employee.id,
			employee_name: employee.name,
			rate: employee.rate,
			salary_type: employee.salary_type,
			hours: parseFloat(newManhourEntry.hours) || 0,
			total_cost: (
				employee.rate * (parseFloat(newManhourEntry.hours) || 0)
			).toFixed(2),
		};

		setProjectManhours((prev) =>
			prev.map((m) => {
				if (m.id === monthId) {
					return { ...m, entries: [...(m.entries || []), entry] };
				}
				return m;
			})
		);

		// Reset the entry form
		setNewManhourEntry({
			employee_id: '',
			employee_name: '',
			rate: '',
			salary_type: '',
			hours: '',
		});
		setTimeout(() => newManhourNameRef.current?.focus(), 10);
	};

	// Update an entry within a month
	const updateManhourEntry = (monthId, entryId, field, value) => {
		setProjectManhours((prev) =>
			prev.map((m) => {
				if (m.id === monthId) {
					const updatedEntries = (m.entries || []).map((e) => {
						if (e.id === entryId) {
							const updated = { ...e, [field]: value };
							// Recalculate total cost if hours changed
							if (field === 'hours') {
								updated.total_cost = (
									updated.rate * (parseFloat(value) || 0)
								).toFixed(2);
							}
							return updated;
						}
						return e;
					});
					return { ...m, entries: updatedEntries };
				}
				return m;
			})
		);
	};

	// Remove an entry from a month
	const removeManhourEntry = (monthId, entryId) => {
		setProjectManhours((prev) =>
			prev.map((m) => {
				if (m.id === monthId) {
					return {
						...m,
						entries: (m.entries || []).filter((e) => e.id !== entryId),
					};
				}
				return m;
			})
		);
	};

	// Remove an entire month section
	const removeMonthSection = (monthId) => {
		setProjectManhours((prev) => prev.filter((m) => m.id !== monthId));
	};

	// Handle employee selection - auto-fill rate
	const handleEmployeeSelect = (employeeId) => {
		const employee = employeesWithRates.find(
			(e) => e.id === parseInt(employeeId)
		);
		if (employee) {
			setNewManhourEntry((prev) => ({
				...prev,
				employee_id: employee.id,
				employee_name: employee.name,
				rate: employee.rate,
				salary_type: employee.salary_type,
			}));
		} else {
			setNewManhourEntry((prev) => ({
				...prev,
				employee_id: '',
				employee_name: '',
				rate: '',
				salary_type: '',
			}));
		}
	};

	// Calculate month totals
	const getMonthTotals = (monthData) => {
		const entries = monthData.entries || [];
		const totalHours = entries.reduce(
			(sum, e) => sum + (parseFloat(e.hours) || 0),
			0
		);
		const totalCost = entries.reduce(
			(sum, e) => sum + (parseFloat(e.total_cost) || 0),
			0
		);
		return { totalHours, totalCost };
	};

	// Query Log helpers
	const addQueryRow = () => {
		if (!newQuery.query_description || !newQuery.query_description.trim())
			return;
		const issuedDate =
			newQuery.query_issued_date || new Date().toISOString().slice(0, 10);
		const row = { ...newQuery, id: Date.now(), query_issued_date: issuedDate };
		setQueryLog((prev) => [...prev, row]);
		setNewQuery({
			query_description: '',
			query_issued_date: '',
			reply_from_client: '',
			reply_received_date: '',
			query_updated_by: '',
			query_resolved: '',
			remark: '',
		});
		setTimeout(() => newQueryDescRef.current?.focus(), 10);
	};

	const updateQueryRow = (id, field, value) => {
		setQueryLog((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
		);
	};

	const removeQueryRow = (id) => {
		setQueryLog((prev) => prev.filter((r) => r.id !== id));
	};

	// Assumption helpers
	const addAssumptionRow = () => {
		if (
			!newAssumption.assumption_description ||
			!newAssumption.assumption_description.trim()
		)
			return;
		const row = { ...newAssumption, id: Date.now() };
		setAssumptions((prev) => [...prev, row]);
		setNewAssumption({
			assumption_description: '',
			reason: '',
			assumption_taken_by: '',
			remark: '',
		});
		setTimeout(() => newAssumptionDescRef.current?.focus(), 10);
	};

	const updateAssumptionRow = (id, field, value) => {
		setAssumptions((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
		);
	};

	const removeAssumptionRow = (id) => {
		setAssumptions((prev) => prev.filter((r) => r.id !== id));
	};

	// Lessons Learnt helpers
	const addLessonRow = () => {
		if (!newLesson.what_was_new || !newLesson.what_was_new.trim()) return;
		const row = { ...newLesson, id: Date.now() };
		setLessonsLearnt((prev) => [...prev, row]);
		setNewLesson({
			what_was_new: '',
			difficulty_faced: '',
			what_you_learn: '',
			areas_of_improvement: '',
			remark: '',
		});
		setTimeout(() => newLessonDescRef.current?.focus(), 10);
	};

	const updateLessonRow = (id, field, value) => {
		setLessonsLearnt((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
		);
	};

	const removeLessonRow = (id) => {
		setLessonsLearnt((prev) => prev.filter((r) => r.id !== id));
	};

	// Project Schedule helpers (add/update/remove)
	const computeScheduleWeeksFromDates = useCallback(
		(startIso, endIso) => {
			const span = getWeekSpanForProjectRange(
				form.start_date,
				form.end_date,
				startIso,
				endIso
			);
			if (!span) return [];
			const start = Math.max(0, span.startWeek);
			const end = Math.min(scheduleWeeks.length - 1, span.endWeek);
			if (end < start) return [];
			const indices = [];
			for (let i = start; i <= end; i += 1) indices.push(i);
			return indices;
		},
		[form.start_date, form.end_date, scheduleWeeks.length]
	);

	const computeScheduleDatesFromWeeks = useCallback(
		(weekIndices) => {
			if (!Array.isArray(weekIndices) || weekIndices.length === 0)
				return { start_date: '', end_date: '' };
			const valid = weekIndices
				.map((w) => Number(w))
				.filter((n) => Number.isFinite(n) && n >= 0 && n < scheduleWeeks.length)
				.sort((a, b) => a - b);
			if (valid.length === 0) return { start_date: '', end_date: '' };
			const first = scheduleWeeks[valid[0]];
			const last = scheduleWeeks[valid[valid.length - 1]];
			return {
				start_date: first?.start ? first.start.toISOString().slice(0, 10) : '',
				end_date: last?.end ? last.end.toISOString().slice(0, 10) : '',
			};
		},
		[scheduleWeeks]
	);

	const addSchedule = (seed = {}) => {
		if (!canEditSchedule) return;
		const defaultSr =
			seed.sr_no && String(seed.sr_no).trim() !== ''
				? seed.sr_no
				: String(projectSchedule.length + 1);
		const legendKey = seed.legend || seed.schedule_legend || '';
		const disciplineSeed = seed.discipline || '';
		const disciplineFromLegend =
			!String(disciplineSeed || '').trim() && legendKey
				? getScheduleLegend(legendKey)?.label || ''
				: disciplineSeed;
		const sch = {
			id: generateScheduleRowId(),
			sr_no: defaultSr,
			activity_description: seed.activity_description || '',
			discipline: disciplineFromLegend,
			legend: legendKey,
			color: seed.color || '',
			unit_qty: seed.unit_qty || '',
			start_date: seed.start_date || '',
			end_date: seed.end_date || '',
			time_required: seed.time_required || '',
			status_completed: seed.status_completed || '',
			remarks: seed.remarks || '',
			weeks: Array.isArray(seed.weeks) ? seed.weeks : undefined,
		};
		setProjectSchedule((prev) => [...prev, sch]);
	};

	const updateSchedule = (id, field, value) => {
		if (!canEditSchedule) return;
		setProjectSchedule((prev) =>
			prev.map((r) => {
				if (r.id !== id) return r;
				const updated = { ...r, [field]: value };
				// Keep weeks <-> dates in sync (for gantt chart editing)
				if (field === 'start_date' || field === 'end_date') {
					updated.weeks = computeScheduleWeeksFromDates(
						updated.start_date,
						updated.end_date
					);
				}
				return updated;
			})
		);
	};

	const toggleScheduleWeek = useCallback(
		(rowId, weekIndex) => {
			if (!canEditSchedule) return;
			const wi = Number(weekIndex);
			if (!Number.isFinite(wi) || wi < 0 || wi >= scheduleWeeks.length) return;

			setProjectSchedule((prev) =>
				prev.map((row) => {
					if (row.id !== rowId) return row;

					const existing =
						Array.isArray(row.weeks) && row.weeks.length > 0
							? row.weeks
							: computeScheduleWeeksFromDates(row.start_date, row.end_date);
					const set = new Set(
						existing.map((n) => Number(n)).filter((n) => Number.isFinite(n))
					);

					const wasMarked = set.has(wi);
					if (wasMarked) set.delete(wi);
					else set.add(wi);

					const weeks = Array.from(set.values()).sort((a, b) => a - b);
					const dates = computeScheduleDatesFromWeeks(weeks);

					const nextRow = {
						...row,
						weeks,
						// when week-cells are edited, derive dates from the selected range
						start_date: dates.start_date,
						end_date: dates.end_date,
					};

					// Apply selected legend when user marks a cell
					if (!wasMarked && selectedScheduleLegend) {
						nextRow.legend = selectedScheduleLegend;

						// If discipline is empty, fill it from the selected legend label
						if (!String(nextRow.discipline || '').trim()) {
							const legend = getScheduleLegend(selectedScheduleLegend);
							if (legend?.label) nextRow.discipline = legend.label;
						}
					}

					return nextRow;
				})
			);
		},
		[
			canEditSchedule,
			scheduleWeeks.length,
			computeScheduleWeeksFromDates,
			computeScheduleDatesFromWeeks,
			selectedScheduleLegend,
			getScheduleLegend,
		]
	);

	const removeSchedule = (id) => {
		if (!canEditSchedule) return;
		setProjectSchedule((prev) => prev.filter((r) => r.id !== id));
	};

	// Project Planning Tab - Activity Management
	const addPlanningActivity = () => {
		if (newPlanningActivity.activity.trim()) {
			const activity = {
				id: Date.now(),
				serialNumber:
					newPlanningActivity.serialNumber.trim() ||
					(planningActivities.length + 1).toString(),
				activity: newPlanningActivity.activity.trim(),
				quantity: newPlanningActivity.quantity.trim(),
				startDate: newPlanningActivity.startDate,
				endDate: newPlanningActivity.endDate,
				actualCompletionDate: newPlanningActivity.actualCompletionDate,
				timeRequired: newPlanningActivity.timeRequired.trim(),
				actualTimeRequired: newPlanningActivity.actualTimeRequired.trim(),
				addedAt: new Date().toISOString(),
			};
			setPlanningActivities([...planningActivities, activity]);
			setNewPlanningActivity({
				serialNumber: '',
				activity: '',
				quantity: '',
				startDate: '',
				endDate: '',
				actualCompletionDate: '',
				timeRequired: '',
				actualTimeRequired: '',
			});
		}
	};

	const removePlanningActivity = (id) => {
		setPlanningActivities(planningActivities.filter((act) => act.id !== id));
	};

	const updatePlanningActivityField = (field, value) => {
		setNewPlanningActivity((prev) => ({ ...prev, [field]: value }));
	};

	// Project Activities Management
	const toggleProjectActivity = (activityId, type) => {
		let activity = null;
		let functionId = null;

		if (type === 'activity') {
			// Find activity in nested structure
			for (const func of functions) {
				const found = func.activities?.find((a) => a.id === activityId);
				if (found) {
					activity = found;
					functionId = func.id;
					break;
				}
			}
		} else {
			// Find sub-activity in nested structure
			for (const func of functions) {
				for (const act of func.activities || []) {
					const found = act.subActivities?.find((sa) => sa.id === activityId);
					if (found) {
						activity = found;
						functionId = func.id;
						break;
					}
				}
				if (activity) break;
			}
		}

		if (!activity) return;

		const exists = projectActivities.find(
			(pa) => pa.id === activityId && pa.type === type
		);

		if (exists) {
			setProjectActivities(
				projectActivities.filter(
					(pa) => !(pa.id === activityId && pa.type === type)
				)
			);
		} else {
			setProjectActivities([
				...projectActivities,
				{
					id: activityId,
					type,
					name: activity.activity_name || activity.name,
					activity_description: activity.activity_description || '',
					function_id: functionId,
					activity_id: activity.activity_id || null,
				},
			]);
		}
	};

	// Scope Activity table helpers (add/update/remove rows with status & deliverables)
	const addScopeActivity = () => {
		const name = (newScopeActivityName || '').trim();
		if (!name) return;
		const row = {
			id: `manual-${Date.now()}`, // Use string ID for manual activities to avoid conflicts
			type: 'manual',
			source: 'manual',
			name,
			activity_description: '',
			status: 'NEW',
			deliverables: '',
			manhours: 0,
			unit_qty: '',
			planned_hours: 0,
			start_time: '',
			end_time: '',
			actual_hours: 0,
			activity_done_by: '',
			status_completed: '',
			remark: '',
			assigned_user: '',
			due_date: '',
			priority: 'MEDIUM',
			assigned_users: [],
			function_name: 'Manual / Other',
		};
		setProjectActivities((prev) => [...prev, row]);
		setNewScopeActivityName('');
	};

	const updateScopeActivity = (id, field, value) => {
		setProjectActivities((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
		);
	};

	const removeScopeActivity = (id) => {
		setProjectActivities((prev) => prev.filter((r) => r.id !== id));
	};

	// Multi-user assignment helpers
	// assigned_users is an array of objects: [{ user_id: '1', planned_hours: 0, actual_hours: 0 }, ...]
	const toggleUserForActivity = (activityId, userId) => {
		setProjectActivities((prev) =>
			prev.map((act) => {
				if (act.id === activityId) {
					const currentUsers = act.assigned_users || [];
					const userIdStr = String(userId);
					// Handle both old object format and new string format
					const isAssigned = currentUsers.some((u) => {
						const id = typeof u === 'object' ? u.user_id : u;
						return String(id) === userIdStr;
					});
					const newUsers = isAssigned
						? currentUsers.filter((u) => {
								const id = typeof u === 'object' ? u.user_id : u;
								return String(id) !== userIdStr;
							})
						: [
								...currentUsers,
								{ user_id: userIdStr, planned_hours: 0, actual_hours: 0 },
							];
					return { ...act, assigned_users: newUsers };
				}
				return act;
			})
		);
	};

	// Update individual user manhours
	const updateUserManhours = (activityId, userId, field, value) => {
		setProjectActivities((prev) =>
			prev.map((act) => {
				if (act.id === activityId) {
					const updatedUsers = (act.assigned_users || []).map((u) => {
						const uId = typeof u === 'object' ? u.user_id : u;
						if (String(uId) === String(userId)) {
							// Only parse as float for numeric fields
							const numericFields = [
								'planned_hours',
								'actual_hours',
								'qty_assigned',
								'qty_completed',
							];
							const newValue = numericFields.includes(field)
								? parseFloat(value) || 0
								: value;

							if (typeof u === 'object') {
								return { ...u, [field]: newValue };
							} else {
								return {
									user_id: u,
									planned_hours:
										field === 'planned_hours' ? parseFloat(value) || 0 : 0,
									actual_hours:
										field === 'actual_hours' ? parseFloat(value) || 0 : 0,
									[field]: newValue,
								};
							}
						}
						return typeof u === 'object'
							? u
							: { user_id: u, planned_hours: 0, actual_hours: 0 };
					});
					return { ...act, assigned_users: updatedUsers };
				}
				return act;
			})
		);
	};

	// Add daily entry for user activity - entries are locked after adding
	const addDailyEntry = (activityId, userId) => {
		setProjectActivities((prev) =>
			prev.map((act) => {
				if (act.id === activityId) {
					const updatedUsers = (act.assigned_users || []).map((u) => {
						const uId = typeof u === 'object' ? u.user_id : u;
						if (String(uId) === String(userId)) {
							const currentEntries =
								typeof u === 'object' && u.daily_entries ? u.daily_entries : [];
							// Get the next date based on last entry, or today if no entries
							let nextDate;
							const validEntries = currentEntries.filter((e) => e != null);
							if (validEntries.length > 0) {
								const lastEntry = validEntries[validEntries.length - 1];
								const lastDate = new Date(lastEntry.date);
								lastDate.setDate(lastDate.getDate() + 1);
								nextDate = lastDate.toISOString().split('T')[0];
							} else {
								nextDate = new Date().toISOString().split('T')[0];
							}
							// Lock all previous entries and add new unlocked entry
							const lockedEntries = validEntries.map((e) => ({
								...e,
								isLocked: true,
							}));
							const newEntry = {
								date: nextDate,
								qty_done: '',
								hours: '',
								remarks: '',
								isLocked: false,
							};
							return { ...u, daily_entries: [...lockedEntries, newEntry] };
						}
						return u;
					});
					return { ...act, assigned_users: updatedUsers };
				}
				return act;
			})
		);
	};

	// Update daily entry for user activity
	const updateDailyEntry = (activityId, userId, entryIndex, field, value) => {
		setProjectActivities((prev) =>
			prev.map((act) => {
				if (act.id === activityId) {
					const updatedUsers = (act.assigned_users || []).map((u) => {
						const uId = typeof u === 'object' ? u.user_id : u;
						if (String(uId) === String(userId) && typeof u === 'object') {
							const entries = [...(u.daily_entries || [])];
							if (entries[entryIndex]) {
								entries[entryIndex] = {
									...entries[entryIndex],
									[field]: value,
								};
							}
							return { ...u, daily_entries: entries };
						}
						return u;
					});
					return { ...act, assigned_users: updatedUsers };
				}
				return act;
			})
		);
	};

	// Remove daily entry for user activity
	const removeDailyEntry = (activityId, userId, entryIndex) => {
		setProjectActivities((prev) =>
			prev.map((act) => {
				if (act.id === activityId) {
					const updatedUsers = (act.assigned_users || []).map((u) => {
						const uId = typeof u === 'object' ? u.user_id : u;
						if (String(uId) === String(userId) && typeof u === 'object') {
							const entries = [...(u.daily_entries || [])];
							entries.splice(entryIndex, 1);
							return { ...u, daily_entries: entries };
						}
						return u;
					});
					return { ...act, assigned_users: updatedUsers };
				}
				return act;
			})
		);
	};

	// Calculate total planned hours for an activity (sum of all user planned hours)
	const getActivityTotalPlanned = (act) => {
		if (!act.assigned_users || act.assigned_users.length === 0)
			return parseFloat(act.planned_hours) || 0;
		return (act.assigned_users || []).reduce((sum, u) => {
			const hours =
				typeof u === 'object' ? parseFloat(u.planned_hours) || 0 : 0;
			return sum + hours;
		}, 0);
	};

	// Calculate total actual hours for an activity (sum of all user actual hours)
	const getActivityTotalActual = (act) => {
		if (!act.assigned_users || act.assigned_users.length === 0)
			return parseFloat(act.actual_hours) || 0;
		return (act.assigned_users || []).reduce((sum, u) => {
			const hours = typeof u === 'object' ? parseFloat(u.actual_hours) || 0 : 0;
			return sum + hours;
		}, 0);
	};

	const getAssignedUserNames = (assignedUsers) => {
		if (!assignedUsers || assignedUsers.length === 0) return 'Select users...';
		const userList = allUsers.length > 0 ? allUsers : userMaster;
		return assignedUsers
			.map((assignment) => {
				const userId =
					typeof assignment === 'object' ? assignment.user_id : assignment;
				const user = userList.find((u) => String(u.id) === String(userId));
				return user
					? user.full_name || user.employee_name || user.username || user.email
					: '';
			})
			.filter(Boolean)
			.join(', ');
	};

	// Helper to check if a user is assigned (handles both old string format and new object format)
	const isUserAssigned = (assignedUsers, userId) => {
		if (!assignedUsers || assignedUsers.length === 0) return false;
		return assignedUsers.some((u) => {
			const id = typeof u === 'object' ? u.user_id : u;
			return String(id) === String(userId);
		});
	};

	// Helper to get user assignment object
	const getUserAssignment = (assignedUsers, userId) => {
		if (!assignedUsers || assignedUsers.length === 0) return null;
		return assignedUsers.find((u) => {
			const id = typeof u === 'object' ? u.user_id : u;
			return String(id) === String(userId);
		});
	};

	// Multi-select activity helpers
	const toggleActivitySelector = () => {
		if (!showActivitySelector) {
			// Reset selection state when opening
			setSelectedActivitiesForAdd({});
			setActivitySelectorSearch('');
		}
		setShowActivitySelector(!showActivitySelector);
	};

	const toggleActivitySelection = (funcId, actId) => {
		const key = `${funcId}|${actId}`;
		setSelectedActivitiesForAdd((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};

	const toggleAllActivitiesInDiscipline = (funcId, acts) => {
		const allSelected = acts.every(
			(act) => selectedActivitiesForAdd[`${funcId}|${act.id}`]
		);
		const updates = {};
		acts.forEach((act) => {
			updates[`${funcId}|${act.id}`] = !allSelected;
		});
		setSelectedActivitiesForAdd((prev) => ({ ...prev, ...updates }));
	};

	const getSelectedCount = () => {
		return Object.values(selectedActivitiesForAdd).filter(Boolean).length;
	};

	const addSelectedActivities = () => {
		const selectedKeys = Object.entries(selectedActivitiesForAdd)
			.filter(([, selected]) => selected)
			.map(([key]) => key);

		const newActivities = [];
		selectedKeys.forEach((key) => {
			const [funcId, actId] = key.split('|');
			const func = functions.find((f) => String(f.id) === funcId);
			const activity = func?.activities?.find((a) => String(a.id) === actId);

			if (activity && func) {
				// Check if already exists
				const exists = projectActivities.some(
					(pa) => String(pa.id) === String(actId) && pa.type === 'activity'
				);
				if (!exists) {
					newActivities.push({
						id: activity.id,
						type: 'activity',
						source: 'master',
						name: activity.activity_name,
						discipline: func.function_name,
						discipline_id: func.id,
						activity_name: activity.activity_name,
						activity_description: activity.activity_description || '',
						planned_hours: parseFloat(activity.default_manhours) || 0,
						actual_hours: 0,
						assigned_user: '',
						assigned_users: [],
						due_date: '',
						priority: 'MEDIUM',
						status: 'Not Started',
						function_name: func.function_name,
						remarks: '',
					});
				}
			}
		});

		if (newActivities.length > 0) {
			setProjectActivities((prev) => [...prev, ...newActivities]);
		}
		setShowActivitySelector(false);
		setSelectedActivitiesForAdd({});
	};

	// Internal Meetings helpers (add/update/remove)
	const addKickoffMeeting = () => {
		const meetingNo = `KOM-${String(kickoffMeetings.length + 1).padStart(3, '0')}`;
		const meeting = {
			id: Date.now(),
			meeting_no: meetingNo,
			client_name: '',
			meeting_date: '',
			organizer: '',
			minutes_drafted: '',
			meeting_location: '',
			client_representative: '',
			meeting_title: newKickoffMeetingTitle || '',
			points_discussed: '',
			persons_involved: '',
		};
		setKickoffMeetings((prev) => [...prev, meeting]);
		setNewKickoffMeetingTitle('');
	};

	const updateKickoffMeeting = (id, field, value) => {
		setKickoffMeetings((prev) =>
			prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
		);
	};

	const updateProjectActivity = (activityId, field, value) => {
		setProjectActivities((prev) =>
			prev.map((act) =>
				act.id === activityId ? { ...act, [field]: value } : act
			)
		);
	};

	const formatAsBulletPoints = (text) => {
		if (!text) return '';
		const lines = text.split('\n').filter((line) => line.trim());
		return lines
			.map((line) => {
				const trimmed = line.trim();
				// If line doesn't start with bullet, add one
				if (
					!trimmed.startsWith('•') &&
					!trimmed.startsWith('-') &&
					!trimmed.startsWith('*')
				) {
					return '• ' + trimmed;
				}
				return trimmed;
			})
			.join('\n');
	};

	const handlePointsBlur = (
		id,
		value,
		updateFunction,
		fieldName = 'points_discussed'
	) => {
		const formatted = formatAsBulletPoints(value);
		updateFunction(id, fieldName, formatted);
	};

	const removeKickoffMeeting = (id) => {
		setKickoffMeetings((prev) => prev.filter((m) => m.id !== id));
	};

	const addInternalMeeting = () => {
		const meetingNo = `IOM-${String(internalMeetings.length + 1).padStart(3, '0')}`;
		const meeting = {
			id: Date.now(),
			meeting_no: meetingNo,
			client_name: '',
			meeting_date: '',
			organizer: '',
			minutes_drafted: '',
			meeting_location: '',
			client_representative: '',
			meeting_title: newInternalMeetingTitle || '',
			points_discussed: '',
			persons_involved: '',
		};
		setInternalMeetings((prev) => [...prev, meeting]);
		setNewInternalMeetingTitle('');
	};

	const updateInternalMeeting = (id, field, value) => {
		setInternalMeetings((prev) =>
			prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
		);
	};

	const removeInternalMeeting = (id) => {
		setInternalMeetings((prev) => prev.filter((m) => m.id !== id));
	};

	// MOM Document Upload handler for meetings
	const handleMomUpload = async (event, meetingId, meetingType) => {
		const file = event.target.files?.[0];
		if (!file) return;

		// Keep client-side limit aligned with API limit.
		const MAX_MOM_FILE_SIZE = 10 * 1024 * 1024;
		if (file.size > MAX_MOM_FILE_SIZE) {
			alert('File size exceeds 10MB limit for MOM upload');
			event.target.value = '';
			return;
		}

		try {
			const formData = new FormData();
			formData.append('file', file);

			const res = await fetch('/api/projects/mom-upload', {
				method: 'POST',
				credentials: 'include',
				body: formData,
			});

			let result;
			try {
				result = await res.json();
			} catch {
				result = { success: false, error: `Upload failed (${res.status})` };
			}

			if (result.success) {
				const momDoc = {
					id: result.data.id,
					file_name: result.data.file_name,
					original_name: result.data.original_name,
					file_url: result.data.file_url,
					file_type: result.data.file_type,
					file_size: result.data.file_size,
					uploaded_at: new Date().toISOString(),
				};

				if (meetingType === 'kickoff') {
					setKickoffMeetings((prev) =>
						prev.map((m) =>
							m.id === meetingId ? { ...m, mom_document: momDoc } : m
						)
					);
				} else {
					setInternalMeetings((prev) =>
						prev.map((m) =>
							m.id === meetingId ? { ...m, mom_document: momDoc } : m
						)
					);
				}
			} else {
				alert(result.error || 'Upload failed');
			}
		} catch (err) {
			console.error('MOM upload failed:', err);
			alert('MOM upload failed');
		} finally {
			event.target.value = '';
		}
	};

	const removeMomDocument = (meetingId, meetingType) => {
		if (meetingType === 'kickoff') {
			setKickoffMeetings((prev) =>
				prev.map((m) => (m.id === meetingId ? { ...m, mom_document: null } : m))
			);
		} else {
			setInternalMeetings((prev) =>
				prev.map((m) => (m.id === meetingId ? { ...m, mom_document: null } : m))
			);
		}
	};

	// Team Member Management (for activities/manhours tracking)
	const addActivityTeamMember = () => {
		setTeamMembers([
			...teamMembers,
			{
				id: Date.now(),
				employee_id: '',
				activity_id: '',
				discipline: '',
				sub_activity: '',
				required_hours: '',
				actual_hours: '',
				planned_start_date: '',
				planned_end_date: '',
				actual_completion_date: '',
				cost: '',
				manhours: 0,
			},
		]);
	};

	const removeActivityTeamMember = (id) => {
		setTeamMembers(teamMembers.filter((member) => member.id !== id));
	};

	const updateActivityTeamMember = (id, field, value) => {
		setTeamMembers(
			teamMembers.map((member) => {
				if (member.id === id) {
					const updated = { ...member, [field]: value };
					// numeric derived fields
					if (field === 'required_hours') {
						updated.manhours = parseFloat(value) || 0;
					}
					// when discipline changes, clear activity and sub-activity to avoid mismatches
					if (field === 'discipline') {
						updated.activity_id = '';
						updated.sub_activity = '';
					}
					// when activity changes, clear any selected sub_activity
					if (field === 'activity_id') {
						updated.sub_activity = '';
					}
					return updated;
				}
				return member;
			})
		);
	};

	// Calculate totals
	const totalManhours = useMemo(() => {
		return teamMembers.reduce(
			(sum, member) => sum + (parseFloat(member.manhours) || 0),
			0
		);
	}, [teamMembers]);

	const totalCost = useMemo(() => {
		return teamMembers.reduce(
			(sum, member) => sum + (parseFloat(member.cost) || 0),
			0
		);
	}, [teamMembers]);

	const handleCancel = () => {
		router.push('/projects');
	};

	const visibleTabs = useMemo(() => {
		const projectModule = sessionUser?.field_permissions?.modules?.projects;
		const sectionAccess = projectModule?.sections || {};

		return TABS.filter((tab) => {
			if (isSuperAdmin) return true;

			const hasActivitiesPermission =
				can('activities', PERMISSIONS.READ) ||
				can('activities', PERMISSIONS.ASSIGN);
			if (tab.adminOnly && !isAdminUser) return false;
			// For project-level views, allow users with project view permission to see these tabs.
			if (
				tab.adminOrActivities &&
				!isAdminUser &&
				!hasActivitiesPermission &&
				!canViewProjectContent
			)
				return false;
			if (tab.userOnly && isAdminUser) return false;
			// "requiresUpdate" means the tab contains edit controls, but view-only users should still be able to see it.
			if (tab.requiresUpdate && !canViewProjectContent) return false;

			if (tab.projectSectionKey) {
				if (projectModule?.enabled === false && !canViewProjectContent)
					return false;
				// When project sections are configured, show only explicitly enabled sections.
				if (projectModule && Object.keys(sectionAccess).length > 0) {
					if (sectionAccess?.[tab.projectSectionKey]?.enabled !== true)
						return false;
				}
			}

			if (tab.requiresPermission) {
				const hasAnyPermission =
					can(tab.requiresPermission, PERMISSIONS.READ) ||
					can(tab.requiresPermission, PERMISSIONS.UPDATE);
				if (!hasAnyPermission) return false;
			}

			return true;
		});
	}, [
		can,
		isAdminUser,
		isSuperAdmin,
		PERMISSIONS,
		canViewProjectContent,
		sessionUser,
	]);

	useEffect(() => {
		if (!visibleTabs.some((tab) => tab.id === activeTab)) {
			setActiveTab(visibleTabs[0]?.id || 'project_details');
		}
	}, [activeTab, visibleTabs]);

	const EXPORT_TAB_OPTIONS = [
		{ key: 'input_documents', title: 'Input Documents' },
		{ key: 'scope', title: 'Scope' },
		{ key: 'project_activity', title: 'Project Activity' },
		{ key: 'documents_issued', title: 'Document Issued' },
		{ key: 'query_log', title: 'Query Log' },
		{ key: 'assumption', title: 'Assumption' },
		{ key: 'discussion', title: 'Discussion' },
	];

	const handleImportProjectTabsExcel = async (event) => {
		if (!canEditProjectContent) {
			alert('You do not have permission to import/edit project data.');
			if (event?.target) event.target.value = '';
			return;
		}
		const file = event?.target?.files?.[0];
		if (!file) return;
		setImportingExcel(true);
		try {
			const results = await importProjectWorkbook({
				file,
				form,
				allUsers,
				userMaster,
				projectTeamMembers,
				id,
			});

			if (results.inputDocumentsList) {
				setInputDocumentsList(results.inputDocumentsList);
			}
			if (results.nextForm) {
				setForm(results.nextForm);
			}
			if (results.projectActivities) {
				setProjectActivities(results.projectActivities);
			}
			if (results.documentsIssued) {
				setDocumentsIssued(results.documentsIssued);
			}
			if (results.queryLog) {
				setQueryLog(results.queryLog);
			}
			if (results.assumptions) {
				setAssumptions(results.assumptions);
			}

			const message = [
				`Imported ${results.updates} sheet(s) into the form.`,
				results.discussionImported > 0
					? `Added ${results.discussionImported} discussion item(s).`
					: 'No discussion rows were added.',
				'Review and click Update Project to save imported tab data.',
			].join(' ');
			alert(message);
		} catch (err) {
			console.error('Excel import failed:', err);
			alert(
				'Failed to import Excel. Please ensure it is a valid workbook exported from this module.'
			);
		} finally {
			if (event?.target) event.target.value = '';
			setImportingExcel(false);
		}
	};

	const handleExportProjectTabsExcel = async () => {
		setExportingExcel(true);
		try {
			const payloads = await getExportSheetPayloads({
				id,
				form,
				inputDocumentsList,
				projectActivities,
				documentsIssued,
				queryLog,
				assumptions,
				allUsers,
				userMaster,
				projectTeamMembers,
			});
			await exportProjectWorkbook({
				form,
				id,
				payloads,
			});
		} catch (err) {
			console.error('Excel export failed:', err);
			alert('Failed to export Excel. Please try again.');
		} finally {
			setExportingExcel(false);
		}
	};

	const handleExportSingleSheetExcel = async () => {
		if (!selectedExportSheet) return;
		setExportingExcel(true);
		try {
			const payloads = await getExportSheetPayloads({
				id,
				form,
				inputDocumentsList,
				projectActivities,
				documentsIssued,
				queryLog,
				assumptions,
				allUsers,
				userMaster,
				projectTeamMembers,
			});
			await exportSingleSheetWorkbook({
				form,
				id,
				payloads,
				selectedExportSheet,
			});
		} catch (err) {
			console.error('Single sheet Excel export failed:', err);
			alert('Failed to export selected sheet. Please try again.');
		} finally {
			setExportingExcel(false);
		}
	};

	const handleSubmit = async (event) => {
		event.preventDefault();

		if (!canEditProjectContent) {
			alert('You do not have permission to update this project.');
			return;
		}

		if (!form.name.trim()) {
			alert('Project name is required');
			return;
		}

		setSubmitting(true);

		try {
			const payload = {
				...form,
				project_duration_planned: form.project_duration_planned
					? Number(form.project_duration_planned)
					: null,
				project_duration_actual: form.project_duration_actual
					? Number(form.project_duration_actual)
					: null,
				project_value: form.project_value ? Number(form.project_value) : null,
				cost_to_company: form.cost_to_company
					? Number(form.cost_to_company)
					: null,
				profitability_estimate: form.profitability_estimate
					? Number(form.profitability_estimate)
					: null,
				budget: form.budget ? Number(form.budget) : null,
				actual_profit_loss: form.actual_profit_loss
					? Number(form.actual_profit_loss)
					: null,
				progress: Number(form.progress) || 0,
				team_members: JSON.stringify(teamMembers),
				software_items: JSON.stringify(softwareItems),
				project_activities_list: JSON.stringify(projectActivities),
				planning_activities_list: JSON.stringify(planningActivities),
				documents_list: JSON.stringify(documentsList),
				input_documents_list: JSON.stringify(inputDocumentsList),
				kickoff_meetings_list: JSON.stringify(kickoffMeetings),
				internal_meetings_list: JSON.stringify(internalMeetings),
				documents_received_list: JSON.stringify(documentsReceived),
				documents_issued_list: JSON.stringify(documentsIssued),
				project_handover_list: JSON.stringify(projectHandover),
				project_manhours_list: JSON.stringify(projectManhours || []),
				project_query_log_list: JSON.stringify(queryLog),
				project_assumption_list: JSON.stringify(assumptions),
				project_lessons_learnt_list: JSON.stringify(lessonsLearnt),
				project_schedule_list: JSON.stringify({
					locked: scheduleLocked,
					rows: projectSchedule,
				}),
			};

			console.log('[SUBMIT] Sending update for project:', id);
			console.log(
				'[SUBMIT] Payload size:',
				JSON.stringify(payload).length,
				'bytes'
			);
			console.log('[SUBMIT] List field counts:', {
				inputDocumentsList: inputDocumentsList.length,
				documentsReceived: documentsReceived.length,
				documentsIssued: documentsIssued.length,
				projectHandover: projectHandover.length,
				projectManhours: projectManhours.length,
				queryLog: queryLog.length,
				assumptions: assumptions.length,
				lessonsLearnt: lessonsLearnt.length,
				projectSchedule: projectSchedule.length,
			});
			console.log(
				'[SUBMIT] Sample data - documentsIssued:',
				JSON.stringify(documentsIssued).substring(0, 200)
			);

			const result = await fetchJSON(`/api/projects/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (result.success) {
				alert('Project updated successfully!');
			} else {
				alert(
					`Failed to update project: ${result.error || result.message || 'Unknown error'}`
				);
			}
		} catch (error) {
			alert(`Failed to update project: ${error?.message || 'Unknown error'}`);
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) return <LoadingFallback />;

	if (error) {
		return (
			<div className="h-screen bg-gray-50 flex flex-col">
				<Navbar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<p className="text-sm text-red-600 mb-4">{error}</p>
						<button
							onClick={() => router.push('/projects')}
							className="text-sm text-[#7F2487] hover:underline"
						>
							Back to Projects
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="min-h-screen flex flex-col overflow-x-hidden"
			style={{ background: '#ffffff' }}
		>
			<Navbar />

			{/* Animated Background */}
			<div
				className="fixed inset-0 pointer-events-none overflow-hidden"
				style={{ zIndex: 0 }}
			>
				<div
					className="absolute -top-[10%] -right-[5%] w-96 h-96 rounded-full opacity-[0.04]"
					style={{
						background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
						filter: 'blur(60px)',
						animation: 'orbit-smooth 20s ease-in-out infinite',
					}}
				/>
				<div
					className="absolute -bottom-[10%] -left-[5%] w-96 h-96 rounded-full opacity-[0.04]"
					style={{
						background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
						filter: 'blur(60px)',
						animation: 'orbit-smooth 25s ease-in-out infinite reverse',
					}}
				/>
			</div>

			<div className="flex-1 relative" style={{ zIndex: 1 }}>
				<div className="h-full overflow-y-auto">
					<form onSubmit={handleSubmit}>
						{/* Premium Header - Full Width Sticky */}
						<header
							className="px-6 lg:px-8 xl:px-12 2xl:px-16 py-5 sticky top-16 z-30"
							style={{
								background:
									'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(249, 250, 251, 0.95) 100%)',
								backdropFilter: 'blur(20px)',
								borderBottom: '1.5px solid rgba(139, 92, 246, 0.1)',
								boxShadow:
									'0 4px 16px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
							}}
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4">
									<button
										type="button"
										onClick={handleCancel}
										className="p-2.5 rounded-xl transition-all duration-300 group"
										style={{
											background:
												'linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%)',
											border: '1.5px solid rgba(139, 92, 246, 0.1)',
											boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.transform = 'translateX(-2px)';
											e.currentTarget.style.boxShadow =
												'0 4px 12px rgba(139, 92, 246, 0.15)';
											e.currentTarget.style.borderColor =
												'rgba(139, 92, 246, 0.25)';
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.transform = 'translateX(0)';
											e.currentTarget.style.boxShadow =
												'0 2px 4px rgba(15, 23, 42, 0.04)';
											e.currentTarget.style.borderColor =
												'rgba(139, 92, 246, 0.1)';
										}}
										title="Back to Projects"
									>
										<ArrowLeftIcon
											className="h-5 w-5 transition-transform duration-300 group-hover:-translate-x-0.5"
											style={{ color: '#8b5cf6' }}
										/>
									</button>
									<div>
										<div className="flex items-center gap-3 mb-1">
											<h1
												className="text-2xl font-bold"
												style={{ color: '#0f172a', letterSpacing: '-0.02em' }}
											>
												Edit Project
											</h1>
											{form.name && (
												<span
													className="px-3 py-1 text-xs font-bold rounded-lg"
													style={{
														background:
															'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.08) 100%)',
														color: '#8b5cf6',
														border: '1px solid rgba(139, 92, 246, 0.2)',
													}}
												>
													{form.name}
												</span>
											)}
										</div>
									</div>
								</div>

								<div className="flex items-center gap-3">
									<input
										ref={excelImportInputRef}
										type="file"
										accept=".xlsx"
										className="hidden"
										onChange={handleImportProjectTabsExcel}
									/>
									<button
										type="button"
										onClick={() => excelImportInputRef.current?.click()}
										disabled={
											importingExcel || exportingExcel || !canEditProjectContent
										}
										className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
										style={{
											background:
												'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
											border: '1.5px solid rgba(16, 185, 129, 0.28)',
											color: '#059669',
											boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
										}}
									>
										{importingExcel ? 'Importing...' : 'Import Excel'}
									</button>
									<select
										value={selectedExportSheet}
										onChange={(e) => setSelectedExportSheet(e.target.value)}
										className="px-3 py-2.5 text-sm rounded-xl border border-gray-300 bg-white text-gray-700"
										title="Select sheet to export"
									>
										{EXPORT_TAB_OPTIONS.map((option) => (
											<option key={option.key} value={option.key}>
												{option.title}
											</option>
										))}
									</select>
									<button
										type="button"
										onClick={handleExportSingleSheetExcel}
										disabled={exportingExcel}
										className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
										style={{
											background:
												'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
											border: '1.5px solid rgba(30, 136, 229, 0.28)',
											color: '#1E88E5',
											boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
										}}
									>
										{exportingExcel ? 'Exporting...' : 'Export Section'}
									</button>
									<button
										type="button"
										onClick={handleExportProjectTabsExcel}
										disabled={exportingExcel}
										className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
										style={{
											background:
												'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
											border: '1.5px solid rgba(127, 36, 135, 0.22)',
											color: '#7F2487',
											boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
										}}
									>
										{exportingExcel ? 'Exporting...' : 'Export Full Workbook'}
									</button>
									<button
										type="button"
										onClick={handleCancel}
										className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300"
										style={{
											background:
												'linear-gradient(135deg, #ffffff 0%, #fafafa 100%)',
											border: '1.5px solid rgba(100, 116, 139, 0.15)',
											color: '#475569',
											boxShadow: '0 2px 4px rgba(15, 23, 42, 0.04)',
										}}
										onMouseEnter={(e) => {
											e.currentTarget.style.transform = 'translateY(-1px)';
											e.currentTarget.style.boxShadow =
												'0 4px 12px rgba(15, 23, 42, 0.08)';
										}}
										onMouseLeave={(e) => {
											e.currentTarget.style.transform = 'translateY(0)';
											e.currentTarget.style.boxShadow =
												'0 2px 4px rgba(15, 23, 42, 0.04)';
										}}
									>
										Cancel
									</button>
									<button
										type="submit"
										disabled={submitting || !canEditProjectContent}
										className="px-6 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
										style={{
											background:
												'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
											color: '#ffffff',
											boxShadow:
												'0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
											letterSpacing: '0.01em',
										}}
										onMouseEnter={(e) =>
											!submitting &&
											(() => {
												e.currentTarget.style.transform = 'translateY(-2px)';
												e.currentTarget.style.boxShadow =
													'0 8px 20px rgba(139, 92, 246, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
											})()
										}
										onMouseLeave={(e) =>
											!submitting &&
											(() => {
												e.currentTarget.style.transform = 'translateY(0)';
												e.currentTarget.style.boxShadow =
													'0 4px 12px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
											})()
										}
									>
										{submitting
											? 'Saving...'
											: canEditProjectContent
												? 'Update Project'
												: 'View Only'}
									</button>
								</div>
							</div>
						</header>

						{/* Minimalistic Tab Navigation */}
						<div
							className="px-6 lg:px-8 xl:px-12 2xl:px-16 sticky z-20 mt-20"
							style={{
								top: 'calc(4rem + 5.5rem)',
								paddingTop: '1rem',
								paddingBottom: '1rem',
								background: '#ffffff',
							}}
						>
							<div
								className="rounded-lg overflow-hidden border border-gray-200"
								style={{
									background: '#ffffff',
									boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
								}}
							>
								<div className="flex items-center gap-0 flex-wrap">
									{visibleTabs.map((tab, index) => {
										const isActive = activeTab === tab.id;
										return (
											<button
												key={tab.id}
												type="button"
												onClick={() => setActiveTab(tab.id)}
												className="relative px-6 py-3.5 text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0"
												style={{
													color: isActive ? '#111827' : '#6b7280',
													borderBottom: isActive
														? '2px solid #111827'
														: '2px solid transparent',
													background: isActive ? '#f9fafb' : 'transparent',
													fontWeight: isActive ? '600' : '500',
												}}
												onMouseEnter={(e) => {
													if (!isActive) {
														e.currentTarget.style.color = '#111827';
														e.currentTarget.style.background = '#fafafa';
													}
												}}
												onMouseLeave={(e) => {
													if (!isActive) {
														e.currentTarget.style.color = '#6b7280';
														e.currentTarget.style.background = 'transparent';
													}
												}}
											>
												{tab.label}
											</button>
										);
									})}
								</div>
							</div>
						</div>

						{/* Main Content Area */}
						<div className="mt-5 px-6 lg:px-8 xl:px-12 2xl:px-16 pb-8 space-y-6">
							<fieldset disabled={!canEditProjectContent}>
								{/* Enhanced Project Details Tab */}
								{activeTab === 'project_details' && (
									<ProjectDetailsTab
										form={form}
										handleChange={handleChange}
										toggleSection={toggleSection}
										openSections={openSections}
										TYPE_OPTIONS={TYPE_OPTIONS}
										docMaster={docMaster}
										newInputDocument={newInputDocument}
										setNewInputDocument={setNewInputDocument}
										addInputDocument={addInputDocument}
									/>
								)}

								{/* Input Documents Tab - Inline Table Format */}
								{activeTab === 'input_documents' && (
									<InputDocumentsTab
										newInputDocument={newInputDocument}
										setNewInputDocument={setNewInputDocument}
										handleInputDocumentKeyPress={handleInputDocumentKeyPress}
										addInputDocument={addInputDocument}
										inputDocumentsList={inputDocumentsList}
										setInputDocumentsList={setInputDocumentsList}
										setForm={setForm}
										removeInputDocument={removeInputDocument}
									/>
								)}

								{/* Software Tab */}
								{activeTab === 'software' && (
									<SoftwareTab
										selectedSoftwareCategory={selectedSoftwareCategory}
										setSelectedSoftwareCategory={setSelectedSoftwareCategory}
										selectedSoftware={selectedSoftware}
										setSelectedSoftware={setSelectedSoftware}
										selectedSoftwareVersion={selectedSoftwareVersion}
										setSelectedSoftwareVersion={setSelectedSoftwareVersion}
										softwareCategories={softwareCategories}
										availableSoftware={availableSoftware}
										availableVersions={availableVersions}
										softwareItems={softwareItems}
										addSoftwareItem={addSoftwareItem}
										removeSoftwareItem={removeSoftwareItem}
									/>
								)}

								{/* Project Team Tab */}
								{activeTab === 'project_team_tab' && (
									<ProjectTeamTab
										toggleSection={toggleSection}
										openSections={openSections}
										teamMemberSearch={teamMemberSearch}
										setTeamMemberSearch={setTeamMemberSearch}
										usersLoading={usersLoading}
										availableUsers={availableUsers}
										allUsers={allUsers}
										addTeamMember={addTeamMember}
										projectTeamMembers={projectTeamMembers}
										updateTeamMemberRole={updateTeamMemberRole}
										removeTeamMember={removeTeamMember}
									/>
								)}

								{/* Enhanced Meetings Tab: Kickoff + Internal Meetings */}
								{activeTab === 'minutes_internal_meet' && (
									<MeetingTab
										newKickoffMeetingTitle={newKickoffMeetingTitle}
										setNewKickoffMeetingTitle={setNewKickoffMeetingTitle}
										addKickoffMeeting={addKickoffMeeting}
										kickoffMeetings={kickoffMeetings}
										updateKickoffMeeting={updateKickoffMeeting}
										handlePointsBlur={handlePointsBlur}
										removeMomDocument={removeMomDocument}
										handleMomUpload={handleMomUpload}
										removeKickoffMeeting={removeKickoffMeeting}
										newInternalMeetingTitle={newInternalMeetingTitle}
										setNewInternalMeetingTitle={setNewInternalMeetingTitle}
										addInternalMeeting={addInternalMeeting}
										internalMeetings={internalMeetings}
										updateInternalMeeting={updateInternalMeeting}
										removeInternalMeeting={removeInternalMeeting}
									/>
								)}

								{/* Project Handover Tab */}
								{activeTab === 'project_handover' && (
									<ProjectHandoverTab
										newHandoverDescRef={newHandoverDescRef}
										newHandoverRow={newHandoverRow}
										setNewHandoverRow={setNewHandoverRow}
										addHandoverRow={addHandoverRow}
										projectHandover={projectHandover}
										updateHandoverRow={updateHandoverRow}
										removeHandoverRow={removeHandoverRow}
									/>
								)}

								{/* Project Manhours Tab */}
								{activeTab === 'project_manhours' && (
									<ProjectManhoursTab
										projectManhours={projectManhours}
										setProjectManhours={setProjectManhours}
										employeesLoading={employeesLoading}
										employeesWithRates={employeesWithRates}
										projectTeamMembers={projectTeamMembers}
										fetchAttendanceHours={fetchAttendanceHours}
									/>
								)}

								{/* Query Log Tab */}
								{activeTab === 'query_log' && (
									<QueryLogTab
										newQueryDescRef={newQueryDescRef}
										newQuery={newQuery}
										setNewQuery={setNewQuery}
										addQueryRow={addQueryRow}
										queryLog={queryLog}
										updateQueryRow={updateQueryRow}
										removeQueryRow={removeQueryRow}
									/>
								)}

								{/* Assumption Tab */}
								{activeTab === 'assumption' && (
									<AssumptionTab
										newAssumptionDescRef={newAssumptionDescRef}
										newAssumption={newAssumption}
										setNewAssumption={setNewAssumption}
										addAssumptionRow={addAssumptionRow}
										assumptions={assumptions}
										updateAssumptionRow={updateAssumptionRow}
										removeAssumptionRow={removeAssumptionRow}
									/>
								)}

								{/* Lessons Learnt Tab */}
								{activeTab === 'lessons_learnt' && (
									<LessonsLearntTab
										newLessonDescRef={newLessonDescRef}
										newLesson={newLesson}
										setNewLesson={setNewLesson}
										addLessonRow={addLessonRow}
										lessonsLearnt={lessonsLearnt}
										updateLessonRow={updateLessonRow}
										removeLessonRow={removeLessonRow}
									/>
								)}

								{/* Documents Issued Tab */}
								{activeTab === 'documents_issued' && (
									<DocumentsIssuedTab
										newIssuedDescRef={newIssuedDescRef}
										newIssuedDoc={newIssuedDoc}
										setNewIssuedDoc={setNewIssuedDoc}
										canEditProjectContent={canEditProjectContent}
										projectActivityDocumentNameOptions={
											projectActivityDocumentNameOptions
										}
										addIssuedDocument={addIssuedDocument}
										documentsIssued={documentsIssued}
										updateIssuedDocument={updateIssuedDocument}
										removeIssuedDocument={removeIssuedDocument}
									/>
								)}

								{/* Documents Received Tab */}
								{activeTab === 'documents_received' && (
									<DocumentsReceivedTab
										newReceivedDoc={newReceivedDoc}
										setNewReceivedDoc={setNewReceivedDoc}
										newReceivedDescRef={newReceivedDescRef}
										addReceivedDocument={addReceivedDocument}
										documentsReceived={documentsReceived}
										updateReceivedDocument={updateReceivedDocument}
										removeReceivedDocument={removeReceivedDocument}
									/>
								)}

								{/* Project Schedule Tab */}
								{activeTab === 'project_schedule' && (
									<ProjectScheduleTab
										scheduleWeeks={scheduleWeeks}
										form={form}
										SCHEDULE_LEGENDS={SCHEDULE_LEGENDS}
										selectedScheduleLegend={selectedScheduleLegend}
										setSelectedScheduleLegend={setSelectedScheduleLegend}
										canEditSchedule={canEditSchedule}
										canEditProjectContent={canEditProjectContent}
										scheduleLocked={scheduleLocked}
										setScheduleLocked={setScheduleLocked}
										scheduleEffectivelyLocked={scheduleEffectivelyLocked}
										addSchedule={addSchedule}
										projectSchedule={projectSchedule}
										computeScheduleWeeksFromDates={
											computeScheduleWeeksFromDates
										}
										updateSchedule={updateSchedule}
										removeSchedule={removeSchedule}
										toggleScheduleWeek={toggleScheduleWeek}
										getScheduleLegend={getScheduleLegend}
										projectActivityScheduleGroups={
											projectActivityScheduleGroups
										}
									/>
								)}

								{/* Project Activity Tab - Admin view for all team members */}
								{activeTab === 'project_activity' && (
									<ProjectActivityTab
										projectActivities={projectActivities}
										getActivityTotalPlanned={getActivityTotalPlanned}
										getActivityTotalActual={getActivityTotalActual}
										functions={functions}
										toggleActivitySelector={toggleActivitySelector}
										showActivitySelector={showActivitySelector}
										activitySelectorSearch={activitySelectorSearch}
										setActivitySelectorSearch={setActivitySelectorSearch}
										getSelectedCount={getSelectedCount}
										addSelectedActivities={addSelectedActivities}
										selectedActivitiesForAdd={selectedActivitiesForAdd}
										toggleAllActivitiesInDiscipline={
											toggleAllActivitiesInDiscipline
										}
										toggleActivitySelection={toggleActivitySelection}
										editingActivityId={editingActivityId}
										setEditingActivityId={setEditingActivityId}
										updateScopeActivity={updateScopeActivity}
										allUsers={allUsers}
										userMaster={userMaster}
										projectTeamMembers={projectTeamMembers}
										updateUserManhours={updateUserManhours}
										toggleUserForActivity={toggleUserForActivity}
										openUserSelectorForActivity={openUserSelectorForActivity}
										setOpenUserSelectorForActivity={
											setOpenUserSelectorForActivity
										}
										isUserAssigned={isUserAssigned}
										removeScopeActivity={removeScopeActivity}
									/>
								)}
								{/* Discussion Tab */}
								{activeTab === 'discussion' && (
									<DiscussionTab
										id={id}
										projectTeamMembers={projectTeamMembers}
										sessionUser={sessionUser}
									/>
								)}
								{/* Quotation Tab - Read Only Details (from Proposal) */}
								{activeTab === 'quotation' && (
									<QuotationTab
										form={form}
										canEditQuotations={canEditQuotations}
										quotationData={quotationData}
									/>
								)}
								{/* Purchase Order Tab */}
								{activeTab === 'purchase_order' && (
									<PurchaseOrderTab
										canEditPurchaseOrders={canEditPurchaseOrders}
										handleAddInvoice={handleAddInvoice}
										invoiceSaving={invoiceSaving}
										invoiceData={invoiceData}
										editingInvoiceId={editingInvoiceId}
										handleInvoiceChange={handleInvoiceChange}
										setEditingInvoiceId={setEditingInvoiceId}
										setInvoiceData={setInvoiceData}
										form={form}
										invoices={invoices}
										handleEditInvoice={handleEditInvoice}
										handleDeleteInvoice={handleDeleteInvoice}
									/>
								)}
								{/* Invoice Tab */}
								{activeTab === 'invoice' && (
									<InvoiceTab
										canEditInvoices={canEditInvoices}
										handleAddInvoice={handleAddInvoice}
										invoiceSaving={invoiceSaving}
										invoiceData={invoiceData}
										editingInvoiceId={editingInvoiceId}
										handleInvoiceChange={handleInvoiceChange}
										setEditingInvoiceId={setEditingInvoiceId}
										setInvoiceData={setInvoiceData}
										form={form}
										invoices={invoices}
										handleEditInvoice={handleEditInvoice}
										handleDeleteInvoice={handleDeleteInvoice}
										loadingAccountHeads={loadingAccountHeads}
										accountHeads={accountHeads}
									/>
								)}
								{/* My Activities Tab - Personalized user manhours tracking */}
								{activeTab === 'my_activities' && (
									<MyActivitiesTab
										sessionUser={sessionUser}
										projectActivities={projectActivities}
										addDailyEntry={addDailyEntry}
										updateDailyEntry={updateDailyEntry}
										updateUserManhours={updateUserManhours}
										removeDailyEntry={removeDailyEntry}
									/>
								)}
								{/* Scope of Work Tab */}
								{activeTab === 'scope' && (
									<ScopeTab
										form={form}
										setForm={setForm}
										canEditProjectContent={canEditProjectContent}
									/>
								)}
								{/* Commercial Tab */}
								{activeTab === 'commercial' && (
									<CommercialTab form={form} handleChange={handleChange} />
								)}
								{/* Activities Tab */}
								{activeTab === 'activities' && (
									<ActivitiesTab
										projectActivities={projectActivities}
										functions={functions}
										openSubActivityDropdowns={openSubActivityDropdowns}
										setOpenSubActivityDropdowns={setOpenSubActivityDropdowns}
										subActivitySearch={subActivitySearch}
										setSubActivitySearch={setSubActivitySearch}
										toggleProjectActivity={toggleProjectActivity}
										setProjectActivities={setProjectActivities}
									/>
								)}
								{/* Team Builder Tab */}
								{activeTab === 'team' && (
									<TeamTab
										addActivityTeamMember={addActivityTeamMember}
										totalManhours={totalManhours}
										totalCost={totalCost}
										teamMembers={teamMembers}
										updateActivityTeamMember={updateActivityTeamMember}
										getProjectTeamForDropdown={getProjectTeamForDropdown}
										functions={functions}
										projectActivities={projectActivities}
										removeActivityTeamMember={removeActivityTeamMember}
									/>
								)}
								{/* Procurement Tab */}
								{activeTab === 'procurement' && (
									<ProcurementTab form={form} handleChange={handleChange} />
								)}
								{/* Construction Tab */}
								{activeTab === 'construction' && (
									<ConstructionTab form={form} handleChange={handleChange} />
								)}
								{/* Risk Tab */}
								{activeTab === 'risk' && (
									<RiskTab form={form} handleChange={handleChange} />
								)}
								{/* Closeout Tab */}
								{activeTab === 'closeout' && (
									<CloseoutTab form={form} handleChange={handleChange} />
								)}
								{/* Project Planning Tab */}
								{activeTab === 'planning' && (
									<PlanningTab
										newPlanningActivity={newPlanningActivity}
										updatePlanningActivityField={updatePlanningActivityField}
										addPlanningActivity={addPlanningActivity}
										planningActivities={planningActivities}
										removePlanningActivity={removePlanningActivity}
									/>
								)}
								{/* Documentation Tab */}
								{activeTab === 'documentation' && (
									<DocumentationTab
										newInputDocument={newInputDocument}
										setNewInputDocument={setNewInputDocument}
										handleInputDocumentKeyPress={handleInputDocumentKeyPress}
										addInputDocument={addInputDocument}
										handleInputDocumentFileUpload={
											handleInputDocumentFileUpload
										}
										inputDocumentsList={inputDocumentsList}
										removeInputDocument={removeInputDocument}
									/>
								)}

								{/* Meetings & Communications Tab */}
								{activeTab === 'meetings' && (
									<MeetingsTab form={form} handleChange={handleChange} />
								)}
							</fieldset>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}

// Project Discussion Form Component - Compact Table-only Design
