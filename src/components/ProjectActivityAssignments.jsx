'use client';

import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';
import {
	istDate,
	parseIstLocal,
	shiftIstDate,
	weekStartFor,
} from '@/lib/work-periods';
import Link from 'next/link';
import { WorkPeriodFields } from '@/components/WorkPeriodFields';
import {
	ClipboardDocumentListIcon,
	DocumentIcon,
	PlusIcon,
	CheckIcon,
	MagnifyingGlassIcon,
	ArrowsUpDownIcon,
	PencilSquareIcon,
	TrashIcon,
	ExclamationCircleIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	LockClosedIcon,
} from '@heroicons/react/24/outline';

const currentIstDate = () => istDate(Date.now());
const currentWeekStart = () => weekStartFor(currentIstDate());

const STATUS_BADGE_CLASSES = {
	Completed: 'bg-green-100 text-green-700 border-green-200',
	Ongoing: 'bg-blue-100 text-blue-700 border-blue-200',
	'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
	Hold: 'bg-yellow-100 text-yellow-700 border-yellow-200',
	'On Hold': 'bg-yellow-100 text-yellow-700 border-yellow-200',
	Cancelled: 'bg-red-100 text-red-700 border-red-200',
	'Not Started': 'bg-gray-100 text-gray-600 border-gray-200',
};

const getStatusBadge = (status) =>
	STATUS_BADGE_CLASSES[status] || 'bg-gray-100 text-gray-600 border-gray-200';

/**
 * Project navigation vocabulary — one link pattern for every Project name on
 * the dashboard (tickets #333 and #341).
 *
 * The link deep-links to the project's documents tab, the icon is decorative
 * (`aria-hidden`), and the accessible name is carried by the link itself
 * together with the tooltip text, so the Project name stays one
 * keyboard-reachable control instead of two.
 */
const PROJECT_DOCUMENTS_LABEL = 'Open documents for';

/**
 * Tooltip and accessible name for a Project name link.
 *
 * The project a link names is read by `projectLinkName` — one fallback order,
 * the project name, then its code, then its id — and both render sites pass
 * the same project shape, so one project carries one accessible name wherever
 * the dashboard links to it (#341; the label itself is read by the helper
 * ticket #334 added, which both surfaces' names flow through).
 */
function projectDocumentsName(project) {
	const label = projectLinkName(project) || '';
	return `${PROJECT_DOCUMENTS_LABEL} ${label}`;
}

/** Project page URL that opens the documents tab (read by the page itself). */
function projectDocumentsHref(projectId) {
	return `/projects/${projectId}?tab=upload_documents`;
}

/** Per-project document count from the activity-assignments payload. */
function projectDocumentCount(documentCounts, projectId) {
	const count = documentCounts?.[String(projectId)];
	return typeof count === 'number' && count > 0 ? count : 0;
}

/**
 * Decorative document marker rendered inside a Project name link. Returns
 * nothing when the project has no documents, so the icon never appears on an
 * empty project.
 */
function DocumentCountMarker({ count, className = 'h-3.5 w-3.5' }) {
	if (count <= 0) return null;
	return (
		<DocumentIcon
			className={`${className} shrink-0 text-[#64126D]`}
			aria-hidden="true"
		/>
	);
}

/**
 * How a project navigation link names the project it opens, in one pattern at
 * every place the dashboard renders that link (ticket #334): the Project's
 * name, else its code, else its id. The action wording stays with
 * `projectDocumentsName`, so a screen-reader link list hears one destination
 * per project instead of two differently worded links that open it.
 */
function projectLinkName(project) {
	return (
		project?.projectName ||
		project?.project_name ||
		project?.projectCode ||
		project?.project_code ||
		project?.projectId ||
		project?.project_id
	);
}

/**
 * Whether an element's rendered text is cut off by its own box.
 *
 * The measurement is the rendered overflow itself — `scrollWidth` past
 * `clientWidth` on the element that carries the ellipsis — taken after layout
 * and repeated whenever the box changes, because the table re-cuts its fixed
 * columns on resize and when the lazy section first mounts, and webfonts change
 * the text width without resizing the box. A value that fits measures false, so
 * no affordance is ever built for it. Layout does not run under jsdom (every
 * width reads zero), which is the right answer there too.
 */
function useIsTruncated(ref, value) {
	const [truncated, setTruncated] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;

		const measure = () =>
			setTruncated(element.scrollWidth - element.clientWidth > 1);
		measure();

		let active = true;
		document.fonts?.ready.then(
			() => {
				if (active) measure();
			},
			() => {}
		);

		if (typeof ResizeObserver === 'undefined') {
			return () => {
				active = false;
			};
		}
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			active = false;
			observer.disconnect();
		};
	}, [ref, value]);

	return truncated;
}

/**
 * The full value of a truncated cell, rendered while the cell holds focus.
 *
 * The value is real text in the page — never only a `title` — shown as a note
 * under the clipped line, and it doubles as the focused element's accessible
 * description, so a screen reader gets it too. The ellipsis and the pointer
 * tooltip stay exactly where they were.
 */
function FullCellValue({ id, value, shown }) {
	return (
		<span
			id={id}
			data-testid="truncated-cell-value"
			hidden={!shown}
			className="mt-0.5 block w-full rounded border border-purple-200 bg-purple-50/70 px-1 py-0.5 text-left text-xs font-normal leading-snug text-[#4A1254] shadow-sm"
		>
			{value}
		</span>
	);
}

/**
 * One plain activity-table value — Discipline, Activity, Sub Activity.
 *
 * Only a value the rendered box actually cuts off becomes focusable and carries
 * its full text, so a row whose values fit renders exactly as it did before:
 * the same text, the same tooltip, no tab stop, no extra element.
 */
function ActivityTextValue({ value, className = '' }) {
	const ref = useRef(null);
	const truncated = useIsTruncated(ref, value);
	const [focused, setFocused] = useState(false);

	return (
		<span
			className="block"
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
		>
			<span
				ref={ref}
				data-truncated={truncated ? 'true' : undefined}
				tabIndex={truncated ? 0 : undefined}
				title={value}
				className={`block truncate leading-tight ${className}`}
			>
				{value}
			</span>
			{truncated && <FullCellValue value={value} shown={focused} />}
		</span>
	);
}

/**
 * The Project Number cell: the documents link, its decorative document marker
 * and the full code for a keyboard user.
 *
 * The link stays the cell's only control — the marker is decorative — and the
 * revealed code is the link's description, so tabbing onto the link exposes the
 * whole code instead of the ellipsised one. `documentsName` is the one project
 * navigation vocabulary the row and the assigned-projects list already share.
 */
function ProjectNumberValue({ projectId, documentsName, code, documentCount }) {
	const ref = useRef(null);
	const codeText = code || '–';
	const truncated = useIsTruncated(ref, codeText);
	const [focused, setFocused] = useState(false);
	const fullValueId = useId();

	return (
		<span
			className="block"
			onFocus={() => setFocused(true)}
			onBlur={() => setFocused(false)}
		>
			<Link
				href={projectDocumentsHref(projectId)}
				aria-label={documentsName}
				title={documentsName}
				aria-describedby={truncated ? fullValueId : undefined}
				className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-[#4A1254] leading-tight underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
			>
				<span
					ref={ref}
					data-truncated={truncated ? 'true' : undefined}
					className="block min-w-0 truncate"
				>
					{codeText}
				</span>
				<DocumentCountMarker count={documentCount} className="h-3 w-3" />
			</Link>
			{truncated && (
				<FullCellValue id={fullValueId} value={codeText} shown={focused} />
			)}
		</span>
	);
}

function SortHeader({ label, sortKey, sort, onSort }) {
	const isActive = sort.key === sortKey;
	return (
		<th
			scope="col"
			className="px-2 py-2 text-center font-bold text-[#64126D] uppercase tracking-wide text-xs leading-tight"
			aria-sort={
				isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
			}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={`inline-flex min-h-6 w-full items-center justify-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 ${
					isActive ? 'text-[#64126D]' : 'text-[#64126D]/80'
				} hover:text-[#7F2487]`}
			>
				<span>{label}</span>
				<ArrowsUpDownIcon
					aria-hidden="true"
					className={`h-3 w-3 ${isActive ? 'opacity-100' : 'opacity-50'}`}
				/>
			</button>
		</th>
	);
}

const EMPTY_LEGACY_DATA = {
	assignments: [],
	emptyProjects: [],
	accessibleProjects: [],
	documentCounts: {},
};

const EMPTY_ADD_FORM = {
	projectId: '',
	disciplineId: '',
	activityId: '',
	subActivityId: '',
	start: '',
	end: '',
	quantity: '',
	dateCompleted: '',
	remarks: '',
};

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Asia/Kolkata',
	day: '2-digit',
	month: 'short',
	year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Asia/Kolkata',
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC',
	day: 'numeric',
	month: 'short',
});

const textCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

const selectClass =
	'min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 sm:text-sm';

const primaryButtonClass =
	'inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#64126D] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#7F2487] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButtonClass =
	'inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-50';

const iconButtonClass =
	'inline-flex h-8 min-w-8 items-center justify-center rounded-md text-[#64126D] transition-colors hover:bg-purple-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-50';

function numberValue(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function formatQuantity(value) {
	return numberValue(value).toLocaleString('en-IN', {
		maximumFractionDigits: 2,
	});
}

function formatHours(seconds) {
	const minutes = Math.max(0, Math.round(numberValue(seconds) / 60));
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	if (!hours) return `${remainder}m`;
	return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDateLabel(value) {
	if (!value) return '–';
	const date = new Date(`${value.slice(0, 10)}T00:00:00+05:30`);
	return Number.isNaN(date.getTime()) ? '–' : dateFormatter.format(date);
}

function formatDateTimeLabel(value) {
	if (!value) return '–';
	const date = new Date(`${value}+05:30`);
	return Number.isNaN(date.getTime()) ? '–' : dateTimeFormatter.format(date);
}

function formatWeekRange(weekStart) {
	const start = new Date(`${weekStart}T00:00:00Z`);
	const end = new Date(`${shiftIstDate(weekStart, 6)}T00:00:00Z`);
	const startLabel = shortDateFormatter.format(start);
	const endLabel = shortDateFormatter.format(end);
	if (start.getUTCMonth() === end.getUTCMonth()) {
		return `${start.getUTCDate()} ${startLabel.split(' ')[1]} – ${endLabel} ${end.getUTCFullYear()}`;
	}
	if (start.getUTCFullYear() === end.getUTCFullYear()) {
		return `${startLabel} – ${endLabel} ${end.getUTCFullYear()}`;
	}
	return `${startLabel} ${start.getUTCFullYear()} – ${endLabel} ${end.getUTCFullYear()}`;
}

function rawLegacyEntries(assignment) {
	if (
		Object.prototype.hasOwnProperty.call(assignment, 'legacy_daily_entries')
	) {
		return Array.isArray(assignment.legacy_daily_entries)
			? assignment.legacy_daily_entries
			: [];
	}
	return Array.isArray(assignment.daily_entries)
		? assignment.daily_entries
		: [];
}

function errorMessage(error, fallback) {
	return error?.message || fallback;
}

function periodSearchText(period) {
	return [
		period.projectCode,
		period.projectName,
		period.discipline,
		period.activityName,
		period.subActivityName,
		period.employeeName,
		period.remarks,
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

function legacySearchText(row) {
	return [
		row.projectCode,
		row.projectName,
		row.discipline,
		row.activityName,
		row.subActivityName,
		row.remarks,
		row.status,
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

// The dashboard's own failed legacy fetch stays silent; its error line owns
// the message (#340).
export default function ProjectActivityAssignments({ userId, ...props }) {
	return (
		<ProjectActivityAssignmentsForUser
			key={userId}
			userId={userId}
			{...props}
		/>
	);
}

function ProjectActivityAssignmentsForUser({
	userId,
	preloadedData,
	fetchFailed = false,
}) {
	const queryClient = useQueryClient();
	const errorRef = useRef(null);
	const formId = useId();
	const addTitleId = `${formId}-add-title`;
	const editTitleId = `${formId}-edit-title`;
	const periodsCaptionId = `${formId}-periods-caption`;
	const legacyCaptionId = `${formId}-legacy-caption`;
	const [week, setWeek] = useState(currentWeekStart);
	const [search, setSearch] = useState('');
	const [legacyStatus, setLegacyStatus] = useState('all');
	const [sort, setSort] = useState({ key: 'start', dir: 'desc' });
	const [isAdding, setIsAdding] = useState(false);
	const [addForm, setAddForm] = useState({ ...EMPTY_ADD_FORM });
	const [editing, setEditing] = useState(null);
	const [actionError, setActionError] = useState('');
	const editorOpen = isAdding || Boolean(editing);

	useEffect(() => {
		if (actionError) errorRef.current?.focus();
	}, [actionError]);

	const legacyQuery = useQuery({
		queryKey: ['activity-assignments', userId],
		queryFn: async () => {
			const response = await apiGet(
				`/api/users/${userId}/activity-assignments`
			);
			if (!response?.success) {
				throw new Error(
					response?.error || 'Project activities could not load.'
				);
			}
			return response.data;
		},
		enabled: Boolean(userId && !preloadedData && !fetchFailed),
	});

	const periodsQuery = useQuery({
		queryKey: ['work-periods', userId, week],
		queryFn: async () => {
			const response = await apiGet('/api/work-periods', { week, userId });
			if (!response?.success) {
				throw new Error(response?.error || 'Work Periods could not load.');
			}
			return response.data;
		},
		enabled: Boolean(userId && !fetchFailed),
	});

	const optionsQuery = useQuery({
		queryKey: ['activity-master', 'options'],
		queryFn: async () => {
			const response = await apiGet('/api/activity-master/options');
			if (!response?.success) {
				throw new Error(response?.error || 'Activities could not load.');
			}
			return response.data || [];
		},
		enabled: Boolean(userId && isAdding && !fetchFailed),
	});

	const periodData = periodsQuery.data;

	const emitActivityLogSaved = (response) => {
		if (typeof window === 'undefined') return;
		if (
			response &&
			'affected_rows' in response &&
			!(numberValue(response.affected_rows) > 0)
		) {
			return;
		}
		window.dispatchEvent(
			new CustomEvent('activity-log-saved', {
				detail: { userId, savedAt: Date.now() },
			})
		);
	};

	const mutation = useMutation({
		mutationFn: async ({ method, body }) => {
			const response =
				method === 'POST'
					? await apiPost('/api/work-periods', body)
					: method === 'PUT'
						? await apiPut('/api/work-periods', body)
						: await apiDelete('/api/work-periods', body);
			if (!response?.success) {
				throw new Error(
					response?.error || 'The Work Period could not be saved.'
				);
			}
			return response;
		},
		onSuccess: async (response, variables) => {
			if (variables.method !== 'DELETE') emitActivityLogSaved(response);
			if (variables.method === 'POST') setIsAdding(false);
			if (variables.method === 'PUT') setEditing(null);
			setActionError('');
			await queryClient.invalidateQueries({
				queryKey: ['work-periods', userId],
			});
		},
		onError: (error) => {
			setActionError(
				errorMessage(error, 'The Work Period could not be saved. Try again.')
			);
		},
	});

	const legacyAccessDenied =
		!preloadedData &&
		legacyQuery.isError &&
		/unauthorized|forbidden|no access|request failed \(401\)|request failed \(403\)/i.test(
			legacyQuery.error?.message || ''
		);

	if (fetchFailed || legacyAccessDenied) return null;

	const legacyData = preloadedData || legacyQuery.data || EMPTY_LEGACY_DATA;
	const assignments = Array.isArray(legacyData.assignments)
		? legacyData.assignments
		: [];
	const emptyProjects = Array.isArray(legacyData.emptyProjects)
		? legacyData.emptyProjects
		: [];
	const accessibleProjects = Array.isArray(legacyData.accessibleProjects)
		? legacyData.accessibleProjects
		: [];
	const documentCounts = legacyData.documentCounts || {};
	const periods = Array.isArray(periodData?.periods) ? periodData.periods : [];
	const canLog = periodData?.canLog === true;
	const today = periodData?.today || currentIstDate();
	const currentWeek = periodData?.today
		? weekStartFor(periodData.today)
		: currentWeekStart();
	const activeWeek = periodData?.weekStart || week;
	const weekEnd = shiftIstDate(activeWeek, 6);
	const disciplineOptions = optionsQuery.data || [];
	const selectedDiscipline = disciplineOptions.find(
		(discipline) => String(discipline.id) === String(addForm.disciplineId)
	);
	const selectedActivity = selectedDiscipline?.activities?.find(
		(activity) => String(activity.id) === String(addForm.activityId)
	);
	const selectedSubActivities = selectedActivity?.subActivities || [];

	const projects = [];
	const seenProjects = new Set();
	const pushProject = (project) => {
		if (!project) return;
		const projectId = project.projectId ?? project.project_id;
		if (projectId === null || projectId === undefined || projectId === '')
			return;
		const key = String(projectId);
		if (seenProjects.has(key)) return;
		seenProjects.add(key);
		projects.push({
			projectId,
			projectCode: project.projectCode ?? project.project_code ?? '',
			projectName: project.projectName ?? project.project_name ?? '',
		});
	};
	assignments.forEach(pushProject);
	emptyProjects.forEach(pushProject);
	accessibleProjects.forEach(pushProject);
	periods.forEach(pushProject);

	const legacyWeekRows = assignments.flatMap((assignment) =>
		rawLegacyEntries(assignment)
			.map((entry, index) => ({
				key: `${assignment.project_id}-${assignment.activity_id}-${entry?.date || 'undated'}-${index}`,
				projectId: assignment.project_id,
				projectCode: assignment.project_code || '',
				projectName: assignment.project_name || '',
				discipline: assignment.discipline || '',
				activityId: assignment.activity_id,
				activityName: assignment.activity_name || 'Unnamed Activity',
				subActivityName: assignment.sub_activity_name || '',
				date: String(entry?.date || '').slice(0, 10),
				hours: numberValue(entry?.hours),
				quantity: numberValue(entry?.qty_done),
				remarks: entry?.remarks || '',
				status: assignment.status || 'Not Started',
			}))
			.filter((row) => row.date >= activeWeek && row.date <= weekEnd)
	);

	const statusOptions = Array.from(
		new Set(assignments.map((assignment) => assignment.status).filter(Boolean))
	).sort(textCollator.compare);

	const normalizedSearch = search.trim().toLowerCase();
	let periodRows = periods.filter(
		(period) =>
			!normalizedSearch || periodSearchText(period).includes(normalizedSearch)
	);
	if (sort.key) {
		const direction = sort.dir === 'asc' ? 1 : -1;
		const valueFor = (period) => {
			switch (sort.key) {
				case 'project':
					return `${period.projectCode || ''} ${period.projectName || ''}`.toLowerCase();
				case 'activity':
					return (period.activityName || '').toLowerCase();
				case 'duration':
					return numberValue(period.durationSeconds);
				case 'start':
				default:
					return period.start || '';
			}
		};
		periodRows = [...periodRows].sort((left, right) => {
			const leftValue = valueFor(left);
			const rightValue = valueFor(right);
			if (typeof leftValue === 'number' && typeof rightValue === 'number') {
				return (leftValue - rightValue) * direction;
			}
			return textCollator.compare(leftValue, rightValue) * direction;
		});
	}

	const legacyRows = legacyWeekRows.filter((row) => {
		const matchesSearch =
			!normalizedSearch || legacySearchText(row).includes(normalizedSearch);
		const matchesStatus = legacyStatus === 'all' || row.status === legacyStatus;
		return matchesSearch && matchesStatus;
	});

	const weekSeconds = periods.reduce(
		(total, period) => total + numberValue(period.weekSeconds),
		0
	);
	const weekQuantity = periods.reduce(
		(total, period) => total + numberValue(period.weekQuantity),
		0
	);
	const filteredWeekSeconds = periodRows.reduce(
		(total, period) => total + numberValue(period.weekSeconds),
		0
	);
	const filteredWeekQuantity = periodRows.reduce(
		(total, period) => total + numberValue(period.weekQuantity),
		0
	);
	const noProjectsAtAll =
		projects.length === 0 &&
		periods.length === 0 &&
		legacyWeekRows.length === 0 &&
		!periodsQuery.isPending &&
		(preloadedData || !legacyQuery.isPending);

	const toggleSort = (key) => {
		setSort((previous) => {
			if (previous.key !== key) return { key, dir: 'asc' };
			if (previous.dir === 'asc') return { key, dir: 'desc' };
			return { key, dir: 'asc' };
		});
	};

	const clearFilters = () => {
		setSearch('');
		setLegacyStatus('all');
		setSort({ key: 'start', dir: 'desc' });
	};

	const changeWeek = (offset) => {
		setWeek((previous) => shiftIstDate(previous, offset));
	};

	const showCurrentWeek = () => {
		setWeek(currentWeek);
	};

	const openAddRow = () => {
		if (!canLog || projects.length === 0 || mutation.isPending) return;
		setEditing(null);
		setIsAdding(true);
		setAddForm({ ...EMPTY_ADD_FORM });
		setActionError('');
	};

	const openEditRow = (period) => {
		if (
			!period.editable ||
			!period.assignmentId ||
			!canLog ||
			mutation.isPending
		) {
			return;
		}
		setIsAdding(false);
		setEditing({
			row: period,
			fields: {
				start: period.start || '',
				end: period.end || '',
				quantity: period.quantity ?? 0,
				dateCompleted: period.dateCompleted || '',
				remarks: period.remarks || '',
			},
		});
		setActionError('');
	};

	const closeEditor = () => {
		if (mutation.isPending) return;
		setIsAdding(false);
		setEditing(null);
		setActionError('');
	};

	const updateAddSelection = (patch) => {
		setAddForm((previous) => ({ ...previous, ...patch }));
		setActionError('');
	};

	const updateSharedFields = (mode, next) => {
		setActionError('');
		if (mode === 'add') {
			setAddForm((previous) => {
				const previousEndDate = previous.end.slice(0, 10);
				const nextEndDate = next.end.slice(0, 10);
				const hasCustomDate =
					Boolean(next.dateCompleted) && next.dateCompleted !== previousEndDate;
				return {
					...previous,
					...next,
					dateCompleted: hasCustomDate ? next.dateCompleted : nextEndDate,
				};
			});
			return;
		}
		setEditing((previous) => {
			if (!previous) return previous;
			const previousEndDate = previous.fields.end.slice(0, 10);
			const nextEndDate = next.end.slice(0, 10);
			const hasCustomDate =
				Boolean(next.dateCompleted) && next.dateCompleted !== previousEndDate;
			return {
				...previous,
				fields: {
					...next,
					dateCompleted: hasCustomDate ? next.dateCompleted : nextEndDate,
				},
			};
		});
	};

	const validatePeriodFields = (fields) => {
		if (!fields.start || !fields.end) return 'Enter both Start and End.';
		const startMs = parseIstLocal(fields.start);
		const endMs = parseIstLocal(fields.end);
		if (startMs === null || endMs === null) {
			return 'Enter valid Start and End values as YYYY-MM-DD HH:MM.';
		}
		if (endMs <= startMs) return 'End must be after Start.';
		if (!fields.dateCompleted) return 'Enter Date Completed.';
		if (fields.dateCompleted > today)
			return 'Date Completed cannot be in the future.';
		const quantity = Number(fields.quantity);
		if (!Number.isFinite(quantity) || quantity < 0) {
			return 'Quantity cannot be negative.';
		}
		const yesterday = shiftIstDate(today, -1);
		if (
			![today, yesterday].includes(istDate(startMs)) ||
			![today, yesterday].includes(istDate(endMs))
		) {
			return 'You can log or edit Work Periods only when both endpoints fall on today or yesterday in IST. Contact an authorized manager for older work.';
		}
		return '';
	};

	const rejectForm = (message) => {
		setActionError(message);
	};

	const submitAdd = (event) => {
		event.preventDefault();
		if (!addForm.projectId) {
			rejectForm('Please select a project.');
			return;
		}
		if (!selectedDiscipline || !selectedActivity) {
			rejectForm('Please select a Discipline and Activity.');
			return;
		}
		if (selectedSubActivities.length > 0 && !addForm.subActivityId) {
			rejectForm('Please select a Sub Activity.');
			return;
		}
		const validationError = validatePeriodFields(addForm);
		if (validationError) {
			rejectForm(validationError);
			return;
		}
		setActionError('');
		mutation.mutate({
			method: 'POST',
			body: {
				projectId: addForm.projectId,
				disciplineId: addForm.disciplineId,
				activityId: addForm.activityId,
				subActivityId: addForm.subActivityId || null,
				start: addForm.start,
				end: addForm.end,
				quantity: numberValue(addForm.quantity),
				dateCompleted: addForm.dateCompleted,
				remarks: addForm.remarks,
			},
		});
	};

	const submitEdit = (event) => {
		event.preventDefault();
		if (!editing) return;
		const validationError = validatePeriodFields(editing.fields);
		if (validationError) {
			rejectForm(validationError);
			return;
		}
		setActionError('');
		mutation.mutate({
			method: 'PUT',
			body: {
				id: editing.row.id,
				projectId: editing.row.projectId,
				start: editing.fields.start,
				end: editing.fields.end,
				quantity: numberValue(editing.fields.quantity),
				dateCompleted: editing.fields.dateCompleted,
				remarks: editing.fields.remarks,
			},
		});
	};

	const deletePeriod = (period) => {
		if (
			!period.editable ||
			!period.assignmentId ||
			!canLog ||
			mutation.isPending
		) {
			return;
		}
		if (
			!window.confirm(
				'Delete this Work Period? The Project Activity and its other Work Periods will not be deleted.'
			)
		) {
			return;
		}
		setActionError('');
		mutation.mutate({
			method: 'DELETE',
			body: { id: period.id, projectId: period.projectId },
		});
	};

	const actionErrorNode = actionError ? (
		<div
			ref={errorRef}
			role="alert"
			tabIndex={-1}
			className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
		>
			<ExclamationCircleIcon
				className="mt-0.5 h-4 w-4 shrink-0"
				aria-hidden="true"
			/>
			<p>{actionError}</p>
		</div>
	) : null;

	const renderAddForm = () => (
		<tr className="bg-purple-50/60">
			<td colSpan={11} className="px-4 py-4 align-top">
				<form
					aria-labelledby={addTitleId}
					onSubmit={submitAdd}
					noValidate
					className="space-y-5"
				>
					<div>
						<h4 id={addTitleId} className="text-base font-bold text-[#4A1254]">
							Log a Work Period
						</h4>
						<p className="mt-1 text-sm text-gray-600">
							Record one continuous stretch of finished work. Accent calculates
							Logged Hours from Start and End.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<div>
							<label
								htmlFor={`${formId}-project`}
								className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
							>
								Project
							</label>
							<select
								id={`${formId}-project`}
								required
								value={addForm.projectId}
								onChange={(event) =>
									updateAddSelection({ projectId: event.target.value })
								}
								className={selectClass}
							>
								<option value="">Select project…</option>
								{projects.map((project) => (
									<option key={project.projectId} value={project.projectId}>
										{project.projectCode
											? `${project.projectCode} – ${project.projectName}`
											: project.projectName || project.projectId}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor={`${formId}-discipline`}
								className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
							>
								Discipline
							</label>
							<select
								id={`${formId}-discipline`}
								required
								disabled={optionsQuery.isPending}
								value={addForm.disciplineId}
								onChange={(event) =>
									updateAddSelection({
										disciplineId: event.target.value,
										activityId: '',
										subActivityId: '',
									})
								}
								className={selectClass}
							>
								<option value="">
									{optionsQuery.isPending ? 'Loading activities…' : 'Select…'}
								</option>
								{disciplineOptions.map((discipline) => (
									<option key={discipline.id} value={discipline.id}>
										{discipline.function_name}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor={`${formId}-activity`}
								className="mb-1 block text-sm font-semibold text-gray-700 after:ml-0.5 after:text-red-600 after:content-['*']"
							>
								Activity
							</label>
							<select
								id={`${formId}-activity`}
								required
								disabled={!selectedDiscipline}
								value={addForm.activityId}
								onChange={(event) =>
									updateAddSelection({
										activityId: event.target.value,
										subActivityId: '',
									})
								}
								className={selectClass}
							>
								<option value="">Select…</option>
								{(selectedDiscipline?.activities || []).map((activity) => (
									<option key={activity.id} value={activity.id}>
										{activity.activity_name}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor={`${formId}-sub-activity`}
								className={`mb-1 block text-sm font-semibold text-gray-700 ${
									selectedSubActivities.length > 0
										? "after:ml-0.5 after:text-red-600 after:content-['*']"
										: ''
								}`}
							>
								Sub Activity
							</label>
							<select
								id={`${formId}-sub-activity`}
								required={selectedSubActivities.length > 0}
								disabled={
									!selectedActivity || selectedSubActivities.length === 0
								}
								value={addForm.subActivityId}
								onChange={(event) =>
									updateAddSelection({ subActivityId: event.target.value })
								}
								className={selectClass}
							>
								<option value="">
									{selectedSubActivities.length > 0
										? 'Select sub-activity…'
										: 'No sub-activity'}
								</option>
								{selectedSubActivities.map((subActivity) => (
									<option key={subActivity.id} value={subActivity.id}>
										{subActivity.name}
									</option>
								))}
							</select>
						</div>
					</div>
					{optionsQuery.isError && !actionError && (
						<div
							role="alert"
							className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
						>
							<p>
								{errorMessage(optionsQuery.error, 'Activities could not load.')}
							</p>
							<button
								type="button"
								onClick={() => optionsQuery.refetch()}
								className="mt-1 font-semibold underline"
							>
								Try again
							</button>
						</div>
					)}
					<WorkPeriodFields
						value={addForm}
						onChange={(next) => updateSharedFields('add', next)}
						disabled={mutation.isPending}
					/>
					{actionErrorNode}
					<div className="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							onClick={closeEditor}
							disabled={mutation.isPending}
							className={secondaryButtonClass}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={mutation.isPending || optionsQuery.isPending}
							className={primaryButtonClass}
						>
							<CheckIcon className="h-4 w-4" aria-hidden="true" />
							{mutation.isPending ? 'Saving…' : 'Save Work Period'}
						</button>
					</div>
				</form>
			</td>
		</tr>
	);

	const renderEditForm = () => (
		<tr className="bg-purple-50/60">
			<td colSpan={11} className="px-4 py-4 align-top">
				<form
					aria-labelledby={editTitleId}
					onSubmit={submitEdit}
					noValidate
					className="space-y-5"
				>
					<div>
						<h4 id={editTitleId} className="text-base font-bold text-[#4A1254]">
							Edit Work Period
						</h4>
						<p className="mt-1 text-sm text-gray-600">
							{editing.row.projectCode || editing.row.projectName} ·{' '}
							{editing.row.activityName}. The overnight period stays one record.
						</p>
					</div>
					<WorkPeriodFields
						value={editing.fields}
						onChange={(next) => updateSharedFields('edit', next)}
						disabled={mutation.isPending}
					/>
					{actionErrorNode}
					<div className="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							onClick={closeEditor}
							disabled={mutation.isPending}
							className={secondaryButtonClass}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={mutation.isPending}
							className={primaryButtonClass}
						>
							<CheckIcon className="h-4 w-4" aria-hidden="true" />
							{mutation.isPending ? 'Saving…' : 'Save Work Period'}
						</button>
					</div>
				</form>
			</td>
		</tr>
	);

	return (
		<div className="min-w-0 rounded-xl border border-purple-200 bg-white shadow-sm">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-100 bg-purple-50/60 px-4 py-3">
				<div className="flex items-center gap-2">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
						<ClipboardDocumentListIcon
							className="h-5 w-5 text-purple-700"
							aria-hidden="true"
						/>
					</div>
					<h3 className="text-base font-bold text-[#4A1254]">
						My Project Activities
					</h3>
				</div>
				{canLog && projects.length > 0 && (
					<button
						type="button"
						onClick={openAddRow}
						disabled={editorOpen || mutation.isPending}
						title="Log a Work Period"
						className={primaryButtonClass}
					>
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
						Add
					</button>
				)}
			</div>

			<div className="space-y-4 px-4 py-4">
				<nav
					aria-label="Work Period week"
					className="flex flex-wrap items-center gap-2"
				>
					<button
						type="button"
						onClick={() => changeWeek(-7)}
						className={secondaryButtonClass}
					>
						<ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
						Previous week
					</button>
					<p className="min-w-52 px-2 text-center text-sm font-bold text-[#4A1254]">
						{formatWeekRange(activeWeek)}
					</p>
					<button
						type="button"
						onClick={() => changeWeek(7)}
						className={secondaryButtonClass}
					>
						Next week
						<ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
					</button>
					{activeWeek !== currentWeek && (
						<button
							type="button"
							onClick={showCurrentWeek}
							className="min-h-10 rounded-md px-3 text-sm font-semibold text-[#64126D] hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
						>
							This week
						</button>
					)}
					{periodData && (
						<div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
							<span className="font-semibold text-[#4A1254]">
								Week total: {formatHours(weekSeconds)}
							</span>
							<span className="font-semibold text-[#4A1254]">
								Week quantity: {formatQuantity(weekQuantity)}
							</span>
						</div>
					)}
				</nav>

				{periodData && !canLog && (
					<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
						<LockClosedIcon
							className="mt-0.5 h-4 w-4 shrink-0"
							aria-hidden="true"
						/>
						<p>
							Work Period logging is unavailable for this account. Ask your
							manager or support to link your User Account to an Employee.
						</p>
					</div>
				)}

				{periodsQuery.isError && (
					<div
						role="alert"
						className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						<p>
							Work Periods could not load:{' '}
							{errorMessage(periodsQuery.error, 'Try again.')}
						</p>
						<button
							type="button"
							onClick={() => periodsQuery.refetch()}
							className="min-h-8 font-semibold underline"
						>
							Try again
						</button>
					</div>
				)}

				{legacyQuery.isError && !preloadedData && !legacyAccessDenied && (
					<div
						role="alert"
						className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
					>
						<p>
							Project activities could not load:{' '}
							{errorMessage(legacyQuery.error, 'Try again.')}
						</p>
						<button
							type="button"
							onClick={() => legacyQuery.refetch()}
							className="min-h-8 font-semibold underline"
						>
							Try again
						</button>
					</div>
				)}

				{!editorOpen && actionErrorNode}

				{noProjectsAtAll ? (
					<div className="py-8 text-center text-[#4A1254]">
						<ClipboardDocumentListIcon
							className="mx-auto mb-3 h-12 w-12 opacity-50"
							aria-hidden="true"
						/>
						<p className="text-sm font-semibold">No projects assigned yet</p>
						<p className="mt-1 text-sm text-gray-600">
							Contact your project manager to be added to a project.
						</p>
					</div>
				) : (
					<>
						<search className="flex flex-wrap items-end gap-3">
							<div className="min-w-64 grow">
								<label
									htmlFor={`${formId}-search`}
									className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600"
								>
									Search
								</label>
								<div className="relative">
									<MagnifyingGlassIcon
										className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
										aria-hidden="true"
									/>
									<input
										id={`${formId}-search`}
										type="search"
										value={search}
										onChange={(event) => setSearch(event.target.value)}
										placeholder="Code, project, activity, remark…"
										aria-label="Search Work Periods and history"
										className="min-h-11 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-base text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 sm:text-sm"
									/>
								</div>
							</div>
							<div>
								<label
									htmlFor={`${formId}-legacy-status`}
									className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600"
								>
									Legacy status
								</label>
								<select
									id={`${formId}-legacy-status`}
									value={legacyStatus}
									onChange={(event) => setLegacyStatus(event.target.value)}
									className={selectClass}
								>
									<option value="all">All statuses</option>
									{statusOptions.map((status) => (
										<option key={status} value={status}>
											{status}
										</option>
									))}
								</select>
							</div>
							{(search || legacyStatus !== 'all') && (
								<button
									type="button"
									onClick={clearFilters}
									className="min-h-10 px-2 text-sm font-semibold text-[#64126D] hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
								>
									Clear
								</button>
							)}
							<p className="ml-auto text-sm text-gray-600" aria-live="polite">
								{periodRows.length}{' '}
								{periodRows.length === 1 ? 'Work Period' : 'Work Periods'}
							</p>
						</search>

						<div
							className="overflow-x-auto rounded-lg border border-gray-200"
							role="region"
							aria-labelledby={periodsCaptionId}
							tabIndex={0}
							aria-busy={periodsQuery.isFetching}
						>
							<table className="w-full min-w-[1500px] border-collapse text-sm">
								<caption id={periodsCaptionId} className="sr-only">
									Work Periods
								</caption>
								<thead className="sticky top-0 z-10 bg-purple-100/90">
									<tr>
										<SortHeader
											label="Project Number"
											sortKey="project"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Discipline
										</th>
										<SortHeader
											label="Activity"
											sortKey="activity"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Sub Activity
										</th>
										<SortHeader
											label="Start (IST)"
											sortKey="start"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											End (IST)
										</th>
										<SortHeader
											label="Duration"
											sortKey="duration"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Quantity
										</th>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Date Completed
										</th>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Remarks
										</th>
										<th
											scope="col"
											className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200">
									{isAdding && renderAddForm()}
									{periodsQuery.isPending && !periodData && !isAdding && (
										<tr>
											<td
												colSpan={11}
												className="px-4 py-8 text-center text-sm text-gray-600"
											>
												Loading Work Periods…
											</td>
										</tr>
									)}
									{periodsQuery.isError && !periodData && !isAdding && (
										<tr>
											<td
												colSpan={11}
												className="px-4 py-8 text-center text-sm text-red-800"
											>
												Work Periods could not load. Use Try again above.
											</td>
										</tr>
									)}
									{periodRows.length === 0 && periodData && !isAdding && (
										<tr>
											<td
												colSpan={11}
												className="px-4 py-8 text-center text-sm text-[#4A1254]"
											>
												{periods.length === 0
													? 'No Work Periods for this week'
													: 'No Work Periods match the current search.'}
											</td>
										</tr>
									)}
									{periodRows.map((period) => {
										if (editing?.row.id === period.id) return renderEditForm();
										const project = {
											project_id: period.projectId,
											project_code: period.projectCode,
											project_name: period.projectName,
										};
										const documentsName = projectDocumentsName(project);
										const canEdit = Boolean(
											period.editable && period.assignmentId && canLog
										);
										const lockLabel = !period.assignmentId
											? 'Assignment link missing'
											: !canLog
												? 'Logging unavailable'
												: 'Locked';
										const activityName =
											period.activityName || 'Unnamed Activity';
										return (
											<tr
												key={period.id}
												className="align-middle hover:bg-purple-50/40"
											>
												<td className="px-2 py-3 text-center">
													{period.projectId ? (
														<ProjectNumberValue
															projectId={period.projectId}
															documentsName={documentsName}
															code={
																period.projectCode ||
																period.projectName ||
																period.projectId
															}
															documentCount={projectDocumentCount(
																documentCounts,
																period.projectId
															)}
														/>
													) : (
														<span className="text-xs text-gray-600">
															Project unavailable
														</span>
													)}
												</td>
												<td className="px-2 py-3 text-center">
													<ActivityTextValue value={period.discipline || '–'} />
												</td>
												<td className="px-2 py-3 text-center">
													<ActivityTextValue
														value={activityName}
														className="font-semibold text-[#4A1254]"
													/>
												</td>
												<td className="px-2 py-3 text-center">
													<ActivityTextValue
														value={period.subActivityName || 'No sub-activity'}
													/>
												</td>
												<td className="whitespace-nowrap px-2 py-3 text-center text-gray-800">
													{formatDateTimeLabel(period.start)}
												</td>
												<td className="whitespace-nowrap px-2 py-3 text-center text-gray-800">
													{formatDateTimeLabel(period.end)}
												</td>
												<td className="px-2 py-3 text-center font-semibold tabular-nums text-[#4A1254]">
													{formatHours(period.durationSeconds)}
													{numberValue(period.weekSeconds) !==
														numberValue(period.durationSeconds) && (
														<span className="mt-1 block text-xs font-normal text-gray-600">
															This week: {formatHours(period.weekSeconds)}
														</span>
													)}
												</td>
												<td className="px-2 py-3 text-center tabular-nums text-[#4A1254]">
													{formatQuantity(period.quantity)}
													{numberValue(period.weekQuantity) !==
														numberValue(period.quantity) && (
														<span className="mt-1 block text-xs text-gray-600">
															This week: {formatQuantity(period.weekQuantity)}
														</span>
													)}
												</td>
												<td className="px-2 py-3 text-center text-gray-800">
													{formatDateLabel(period.dateCompleted)}
												</td>
												<td className="px-2 py-3 text-left text-gray-700">
													<span className="whitespace-pre-wrap break-words">
														{period.remarks || '–'}
													</span>
												</td>
												<td className="px-2 py-3 text-center">
													{canEdit ? (
														<div className="flex items-center justify-center gap-1">
															<button
																type="button"
																onClick={() => openEditRow(period)}
																disabled={mutation.isPending}
																className={iconButtonClass}
																aria-label={`Edit Work Period for ${activityName}`}
																title="Edit Work Period"
															>
																<PencilSquareIcon
																	className="h-4 w-4"
																	aria-hidden="true"
																/>
															</button>
															<button
																type="button"
																onClick={() => deletePeriod(period)}
																disabled={mutation.isPending}
																className={`${iconButtonClass} text-red-600 hover:bg-red-50`}
																aria-label={`Delete Work Period for ${activityName}`}
																title="Delete Work Period"
															>
																<TrashIcon
																	className="h-4 w-4"
																	aria-hidden="true"
																/>
															</button>
														</div>
													) : (
														<span
															className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600"
															title={
																lockLabel === 'Locked'
																	? 'Both endpoints must fall on today or yesterday in IST.'
																	: lockLabel
															}
														>
															<LockClosedIcon
																className="h-3.5 w-3.5"
																aria-hidden="true"
															/>
															{lockLabel}
														</span>
													)}
												</td>
											</tr>
										);
									})}
									{periodRows.length > 0 && (
										<tr className="bg-purple-50 font-semibold text-[#4A1254]">
											<td
												colSpan={6}
												className="px-3 py-2 text-right text-xs uppercase tracking-wide"
											>
												{periodRows.length !== periods.length
													? 'Total (filtered)'
													: 'Week total'}
											</td>
											<td className="px-2 py-2 text-center tabular-nums">
												{formatHours(filteredWeekSeconds)}
											</td>
											<td className="px-2 py-2 text-center tabular-nums">
												{formatQuantity(filteredWeekQuantity)}
											</td>
											<td
												colSpan={3}
												className="px-3 py-2 text-xs font-normal text-gray-600"
											>
												Quantity is counted only in the week of Date Completed.
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						<p className="text-xs leading-relaxed text-gray-600">
							Both endpoints must fall on today or yesterday in IST for Employee
							edits. Older Work Periods stay visible and can be corrected by an
							authorized manager. Weekly totals use each period&apos;s share
							inside the selected week.
						</p>

						{projects.length > 0 &&
							(periods.length === 0 || periodRows.length === 0) && (
								<section
									aria-labelledby={`${formId}-assigned-projects`}
									className="rounded-lg border border-purple-100 bg-purple-50/40 p-4"
								>
									<h4
										id={`${formId}-assigned-projects`}
										className="text-sm font-bold text-[#4A1254]"
									>
										Assigned projects
									</h4>
									<ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
										{projects.map((project) => {
											const documentsName = projectDocumentsName(project);
											return (
												<li
													key={project.projectId}
													className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-purple-100 bg-white px-3 py-2"
												>
													<span className="min-w-0 break-words text-sm text-gray-800">
														{project.projectCode
															? `${project.projectCode} – ${project.projectName}`
															: project.projectName || project.projectId}
													</span>
													<Link
														href={projectDocumentsHref(project.projectId)}
														aria-label={documentsName}
														title={documentsName}
														className="inline-flex min-h-8 shrink-0 items-center gap-1 text-sm font-semibold text-purple-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
													>
														Open documents
														<DocumentCountMarker
															count={projectDocumentCount(
																documentCounts,
																project.projectId
															)}
														/>
													</Link>
												</li>
											);
										})}
									</ul>
								</section>
							)}

						{legacyWeekRows.length > 0 && (
							<section
								aria-labelledby={`${formId}-legacy-heading`}
								className="space-y-3"
							>
								<div>
									<h4
										id={`${formId}-legacy-heading`}
										className="text-base font-bold text-[#4A1254]"
									>
										Historical duration-only logs
									</h4>
									<p className="mt-1 text-sm text-gray-600">
										Start and End were not recorded for these older logs. Their
										recorded duration stays on its recorded date; no timestamps
										are inferred and they cannot be edited here.
									</p>
								</div>
								<div
									className="overflow-x-auto rounded-lg border border-gray-200"
									role="region"
									aria-labelledby={legacyCaptionId}
									tabIndex={0}
								>
									<table className="w-full min-w-[1200px] border-collapse text-sm">
										<caption id={legacyCaptionId} className="sr-only">
											Historical duration-only logs
										</caption>
										<thead className="bg-gray-100">
											<tr>
												{[
													'Project Number',
													'Discipline',
													'Activity',
													'Sub Activity',
													'Recorded Date',
													'Recorded Hours',
													'Quantity',
													'Status',
													'Remarks',
												].map((label) => (
													<th
														key={label}
														scope="col"
														className="px-2 py-2 text-center text-xs font-bold uppercase tracking-wide text-gray-700"
													>
														{label}
													</th>
												))}
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-200">
											{legacyRows.length === 0 && (
												<tr>
													<td
														colSpan={9}
														className="px-4 py-6 text-center text-sm text-gray-600"
													>
														No historical logs match the current search or
														status.
													</td>
												</tr>
											)}
											{legacyRows.map((row) => {
												const documentsName = projectDocumentsName(row);
												return (
													<tr
														key={row.key}
														className="align-middle hover:bg-gray-50/60"
													>
														<td className="px-2 py-3 text-center">
															<ProjectNumberValue
																projectId={row.projectId}
																documentsName={documentsName}
																code={
																	row.projectCode ||
																	row.projectName ||
																	row.projectId
																}
																documentCount={projectDocumentCount(
																	documentCounts,
																	row.projectId
																)}
															/>
														</td>
														<td className="px-2 py-3 text-center">
															<ActivityTextValue
																value={row.discipline || '–'}
															/>
														</td>
														<td className="px-2 py-3 text-center">
															<ActivityTextValue
																value={row.activityName}
																className="font-semibold text-[#4A1254]"
															/>
														</td>
														<td className="px-2 py-3 text-center">
															<ActivityTextValue
																value={row.subActivityName || '–'}
															/>
														</td>
														<td className="px-2 py-3 text-center">
															{formatDateLabel(row.date)}
														</td>
														<td className="px-2 py-3 text-center font-semibold tabular-nums text-[#4A1254]">
															{formatQuantity(row.hours)}h
														</td>
														<td className="px-2 py-3 text-center tabular-nums">
															{formatQuantity(row.quantity)}
														</td>
														<td className="px-2 py-3 text-center">
															<span
																className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${getStatusBadge(row.status)}`}
															>
																{row.status}
															</span>
														</td>
														<td className="px-2 py-3 text-left">
															<span className="whitespace-pre-wrap break-words text-gray-700">
																{row.remarks || '–'}
															</span>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							</section>
						)}
					</>
				)}
			</div>
		</div>
	);
}
