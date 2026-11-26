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
import { formatDate, formatNumber } from '@/lib/format';
import Link from 'next/link';
import {
	ClipboardDocumentListIcon,
	DocumentIcon,
	PlusIcon,
	CheckIcon,
	XMarkIcon,
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

/** Compact incumbent textarea: one row initially, growing with its content. */
function AutoGrowTextarea({ value, className = '', ...props }) {
	const ref = useRef(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.style.height = 'auto';
		element.style.height = `${element.scrollHeight + 2}px`;
	}, [value]);

	return (
		<textarea
			ref={ref}
			rows={1}
			value={value}
			{...props}
			className={`w-full resize-none overflow-y-auto rounded border leading-5 transition-[border-color,box-shadow] duration-150 focus:outline-none ${className}`}
		/>
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
			className="px-2 py-2 text-center font-bold text-[#64126D] text-xs leading-tight"
			aria-sort={
				isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
			}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className="inline-flex min-h-6 w-full items-center justify-center gap-1 rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
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

const textCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

function numberValue(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function formatQuantity(value) {
	return formatNumber(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function formatDateLabel(value) {
	if (!value) return '–';
	return formatDate(`${value.slice(0, 10)}T00:00:00+05:30`, {
		timeZone: 'Asia/Kolkata',
	});
}

function periodClock(endpoint) {
	return endpoint?.slice(11, 16) ?? '';
}

function startsPreviousDay({ start, end }) {
	return Boolean(start && end && end < start);
}

function addEndpoints(fields) {
	const endDate = fields.dateCompleted;
	const startDate = startsPreviousDay(fields)
		? shiftIstDate(endDate, -1)
		: endDate;
	return {
		start: `${startDate}T${fields.start}`,
		end: `${endDate}T${fields.end}`,
	};
}

function editEndpoint(saved, time) {
	// A clock edit must not move hours to a different date.
	if (!saved || !time) return '';
	return time === periodClock(saved) ? saved : `${saved.slice(0, 10)}T${time}`;
}

function periodDateHint(endpoint, dateCompleted) {
	const date = endpoint?.slice(0, 10);
	if (!date || date === dateCompleted) return '';
	if (
		dateCompleted &&
		date < dateCompleted &&
		shiftIstDate(date, 1) === dateCompleted
	)
		return 'Previous day';
	return formatDateLabel(date);
}

function PeriodTime({ endpoint, dateCompleted }) {
	if (!endpoint) return null;
	const hint = periodDateHint(endpoint, dateCompleted);
	return (
		<>
			<time className="tabular-nums" dateTime={`${endpoint}+05:30`}>
				{periodClock(endpoint)}
			</time>
			{hint && <span className="block text-[11px] text-gray-600">{hint}</span>}
		</>
	);
}

function formatWeekRange(weekStart) {
	const start = formatDate(`${weekStart}T00:00:00+05:30`, {
		timeZone: 'Asia/Kolkata',
	}).split(' ');
	const end = formatDate(`${shiftIstDate(weekStart, 6)}T00:00:00+05:30`, {
		timeZone: 'Asia/Kolkata',
	}).split(' ');
	const startDay = start[0].replace(/^0/, '');
	const endDay = end[0].replace(/^0/, '');
	if (start[2] === end[2]) {
		return `${startDay} ${start[1]} – ${endDay} ${end[1]} ${end[2]}`;
	}
	return `${startDay} ${start[1]} ${start[2]} – ${endDay} ${end[1]} ${end[2]}`;
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
	const periodsCaptionId = `${formId}-periods-caption`;
	const [week, setWeek] = useState(currentWeekStart);
	const [fromDate, setFromDate] = useState(currentWeekStart);
	const [toDate, setToDate] = useState(() =>
		shiftIstDate(currentWeekStart(), 6)
	);
	const [search, setSearch] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');
	const [sort, setSort] = useState({ key: 'due_date', dir: 'desc' });
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
	const yesterday = shiftIstDate(today, -1);
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
				defaultManhours: numberValue(assignment.default_manhours),
				date: String(entry?.date || '').slice(0, 10),
				hours: numberValue(entry?.hours),
				quantity: numberValue(entry?.qty_done),
				remarks: entry?.remarks || '',
				status: assignment.status || 'Not Started',
			}))
			.filter((row) => row.date >= activeWeek && row.date <= weekEnd)
	);

	const workRows = periods.map((period) => {
		const assignment = assignments.find(
			(candidate) =>
				String(candidate.project_id) === String(period.projectId) &&
				String(candidate.activity_id) === String(period.activityId)
		);
		return {
			kind: 'period',
			key: `period-${period.id}`,
			period,
			projectId: period.projectId,
			projectCode: period.projectCode || assignment?.project_code || '',
			projectName: period.projectName || assignment?.project_name || '',
			discipline: period.discipline || assignment?.discipline || '',
			activityId: period.activityId,
			activityName:
				period.activityName || assignment?.activity_name || 'Unnamed Activity',
			subActivityName:
				period.subActivityName ?? assignment?.sub_activity_name ?? '',
			defaultManhours: numberValue(
				period.defaultManhours ?? assignment?.default_manhours
			),
			estimate: numberValue(assignment?.planned_hours),
			start: period.start || '',
			end: period.end || '',
			manhours: numberValue(period.durationSeconds) / 3600,
			weekManhours: numberValue(period.weekSeconds) / 3600,
			quantity: numberValue(period.quantity),
			weekQuantity: numberValue(period.weekQuantity),
			dateCompleted: period.dateCompleted || '',
			status: period.status || assignment?.status || 'Not Started',
			remarks: period.remarks || '',
		};
	});

	const legacyRows = legacyWeekRows.map((row) => ({
		...row,
		kind: 'legacy',
		key: `legacy-${row.key}`,
		period: null,
		start: '',
		end: '',
		manhours: row.hours,
		weekManhours: row.hours,
		dateCompleted: row.date,
		weekQuantity: row.quantity,
		estimate: 0,
	}));

	const loggedAssignments = new Set(
		[...workRows, ...legacyRows].map(
			(row) => `${row.projectId}:${row.activityId}`
		)
	);
	const assignmentRows = assignments
		.filter(
			(assignment) =>
				!loggedAssignments.has(
					`${assignment.project_id}:${assignment.activity_id}`
				)
		)
		.map((assignment) => ({
			kind: 'assignment',
			key: `assignment-${assignment.project_id}-${assignment.activity_id}`,
			period: null,
			projectId: assignment.project_id,
			projectCode: assignment.project_code || '',
			projectName: assignment.project_name || '',
			discipline: assignment.discipline || '',
			activityId: assignment.activity_id,
			activityName: assignment.activity_name || 'Unnamed Activity',
			subActivityName: assignment.sub_activity_name || '',
			defaultManhours: numberValue(assignment.default_manhours),
			estimate: numberValue(assignment.planned_hours),
			start: '',
			end: '',
			manhours: 0,
			weekManhours: 0,
			quantity: 0,
			weekQuantity: 0,
			dateCompleted: '',
			status: assignment.status || 'Not Started',
			remarks: assignment.remarks || '',
		}));

	const baseRows = [...workRows, ...legacyRows, ...assignmentRows];
	const statusOptions = Array.from(
		new Set(baseRows.map((row) => row.status).filter(Boolean))
	).sort(textCollator.compare);

	const normalizedSearch = search.trim().toLowerCase();
	const rangeStart = fromDate || activeWeek;
	const rangeEnd = toDate || weekEnd;
	const fullWeekSelected = rangeStart === activeWeek && rangeEnd === weekEnd;
	let flatRows = baseRows.filter((row) => {
		const matchesSearch =
			!normalizedSearch ||
			(row.kind === 'period'
				? periodSearchText(row.period)
				: legacySearchText(row)
			).includes(normalizedSearch);
		const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
		const matchesDate =
			row.kind === 'assignment'
				? fullWeekSelected
				: row.kind === 'period'
					? row.start.slice(0, 10) <= rangeEnd &&
						row.end.slice(0, 10) >= rangeStart
					: row.dateCompleted >= rangeStart && row.dateCompleted <= rangeEnd;
		return matchesSearch && matchesStatus && matchesDate;
	});

	if (sort.key) {
		const direction = sort.dir === 'asc' ? 1 : -1;
		const valueFor = (row) => {
			switch (sort.key) {
				case 'project_code':
					return `${row.projectCode || ''} ${row.projectName || ''}`.toLowerCase();
				case 'discipline':
					return (row.discipline || '').toLowerCase();
				case 'activity_name':
					return (row.activityName || '').toLowerCase();
				case 'sub_activity_name':
					return (row.subActivityName || '').toLowerCase();
				case 'default_manhours':
					return numberValue(row.defaultManhours);
				case 'planned_hours':
					return numberValue(row.manhours);
				case 'qty_completed':
					return numberValue(row.quantity);
				case 'due_date':
					return row.dateCompleted || '';
				case 'status':
					return (row.status || 'Not Started').toLowerCase();
				default:
					return '';
			}
		};
		flatRows = [...flatRows].sort((left, right) => {
			const leftValue = valueFor(left);
			const rightValue = valueFor(right);
			if (typeof leftValue === 'number' && typeof rightValue === 'number') {
				return (leftValue - rightValue) * direction;
			}
			if (leftValue < rightValue) return -1 * direction;
			if (leftValue > rightValue) return 1 * direction;
			return 0;
		});
	}

	const totalManhours = flatRows.reduce(
		(total, row) => total + numberValue(row.weekManhours),
		0
	);
	const totalQuantity = flatRows.reduce(
		(total, row) => total + numberValue(row.weekQuantity),
		0
	);
	const assignableProjects = projects.map((project) => ({
		project_id: project.projectId,
		project_code: project.projectCode,
		project_name: project.projectName,
	}));
	const hasAnyData = projects.length > 0;
	const COLS = 13;

	const toggleSort = (key) => {
		setSort((previous) => {
			if (previous.key !== key) return { key, dir: 'asc' };
			if (previous.dir === 'asc') return { key, dir: 'desc' };
			return { key: null, dir: 'asc' };
		});
	};

	const clearFilters = () => {
		setSearch('');
		setStatusFilter('all');
		setFromDate(activeWeek);
		setToDate(weekEnd);
		setSort({ key: 'due_date', dir: 'desc' });
	};

	const changeWeek = (offset) => {
		const nextWeek = shiftIstDate(week, offset);
		setWeek(nextWeek);
		setFromDate(nextWeek);
		setToDate(shiftIstDate(nextWeek, 6));
	};

	const showCurrentWeek = () => {
		setWeek(currentWeek);
		setFromDate(currentWeek);
		setToDate(shiftIstDate(currentWeek, 6));
	};

	const openAddRow = () => {
		if (!canLog || projects.length === 0 || mutation.isPending) return;
		setEditing(null);
		setIsAdding(true);
		setAddForm({
			...EMPTY_ADD_FORM,
			dateCompleted: today,
		});
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
				start: periodClock(period.start),
				end: periodClock(period.end),
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

	const updatePeriodField = (mode, field, value) => {
		setActionError('');
		const apply = (current) => ({ ...current, [field]: value });
		if (mode === 'add') {
			setAddForm(apply);
			return;
		}
		setEditing((previous) =>
			previous ? { ...previous, fields: apply(previous.fields) } : previous
		);
	};

	const dateWindowError =
		'You can log or edit Work Periods only when both endpoints fall on today or yesterday in IST. Contact an authorized manager for older work.';
	const validatePeriodFields = (fields, endpoints) => {
		if (!fields.start || !fields.end) return 'Enter both Start and End.';
		if (!fields.dateCompleted) return 'Enter Date Completed.';
		if (fields.dateCompleted > today)
			return 'Date Completed cannot be in the future.';
		if (!endpoints) return dateWindowError;
		const { start, end } = endpoints;
		const startMs = parseIstLocal(start);
		const endMs = parseIstLocal(end);
		if (startMs === null || endMs === null)
			return 'Enter valid Start and End times.';
		if (endMs <= startMs) return 'End must be after Start.';
		const quantity = Number(fields.quantity);
		if (!Number.isFinite(quantity) || quantity < 0) {
			return 'Quantity cannot be negative.';
		}
		if (
			![today, yesterday].includes(istDate(startMs)) ||
			![today, yesterday].includes(istDate(endMs))
		) {
			return dateWindowError;
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
		const endpoints = [today, yesterday].includes(addForm.dateCompleted)
			? addEndpoints(addForm)
			: null;
		const validationError = validatePeriodFields(addForm, endpoints);
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
				...endpoints,
				quantity: numberValue(addForm.quantity),
				dateCompleted: addForm.dateCompleted,
				remarks: addForm.remarks,
			},
		});
	};

	const submitEdit = (event) => {
		event.preventDefault();
		if (!editing) return;
		const endpoints = {
			start: editEndpoint(editing.row.start, editing.fields.start),
			end: editEndpoint(editing.row.end, editing.fields.end),
		};
		const validationError = validatePeriodFields(editing.fields, endpoints);
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
				...endpoints,
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
			className="mt-2 flex items-start gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs leading-snug text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
		>
			<ExclamationCircleIcon
				className="mt-0.5 h-3.5 w-3.5 shrink-0"
				aria-hidden="true"
			/>
			<p>{actionError}</p>
		</div>
	) : null;

	const compactControlClass =
		'w-full min-w-0 px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100';

	const renderTimePicker = (mode, endpoint, time, hint = '') => {
		const label = endpoint === 'start' ? 'Start Period' : 'End Period';
		const id = `${formId}-${mode}-${endpoint}`;
		return (
			<>
				<label htmlFor={id} className="sr-only">
					{label}
				</label>
				<input
					id={id}
					name={endpoint}
					type="time"
					required
					aria-describedby={hint ? `${id}-hint` : undefined}
					disabled={mutation.isPending}
					value={time}
					onChange={(event) =>
						updatePeriodField(mode, endpoint, event.target.value)
					}
					className={compactControlClass}
				/>
				{hint && (
					<span id={`${id}-hint`} className="block text-[11px] text-gray-600">
						{hint}
					</span>
				)}
			</>
		);
	};

	const renderEditorActions = (disabled) => (
		<div className="flex items-center justify-center gap-1">
			<button
				type="submit"
				disabled={disabled}
				className="p-1 rounded bg-[#64126D] text-white hover:bg-[#7F2487] transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
				title="Save Work Period"
				aria-label="Save Work Period"
			>
				<CheckIcon className="w-3.5 h-3.5" aria-hidden="true" />
			</button>
			<button
				type="button"
				onClick={closeEditor}
				disabled={disabled}
				className="p-1 rounded bg-white text-[#4A1254] border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
				title="Cancel"
				aria-label="Cancel"
			>
				<XMarkIcon className="w-3.5 h-3.5" aria-hidden="true" />
			</button>
		</div>
	);

	const renderAddForm = () => (
		<tr className="bg-purple-50/50 divide-x divide-gray-300">
			<td className="py-1 px-2 text-center align-middle">
				<select
					required
					aria-label="Project"
					title="Select a project you are assigned to"
					value={addForm.projectId}
					onChange={(event) =>
						updateAddSelection({ projectId: event.target.value })
					}
					className={compactControlClass}
				>
					<option value="">Select project…</option>
					{assignableProjects.map((project) => (
						<option key={project.project_id} value={project.project_id}>
							{project.project_code
								? `${project.project_code} – ${project.project_name}`
								: project.project_name}
						</option>
					))}
				</select>
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<select
					required
					aria-label="Discipline"
					disabled={optionsQuery.isPending}
					value={addForm.disciplineId}
					onChange={(event) =>
						updateAddSelection({
							disciplineId: event.target.value,
							activityId: '',
							subActivityId: '',
						})
					}
					className={compactControlClass}
				>
					<option value="">Select</option>
					{disciplineOptions.map((discipline) => (
						<option key={discipline.id} value={discipline.id}>
							{discipline.function_name}
						</option>
					))}
				</select>
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<select
					required
					aria-label="Activity"
					disabled={!selectedDiscipline}
					value={addForm.activityId}
					onChange={(event) =>
						updateAddSelection({
							activityId: event.target.value,
							subActivityId: '',
						})
					}
					className={compactControlClass}
				>
					<option value="">Select</option>
					{(selectedDiscipline?.activities || []).map((activity) => (
						<option key={activity.id} value={activity.id}>
							{activity.activity_name}
						</option>
					))}
				</select>
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<select
					required={selectedSubActivities.length > 0}
					aria-label="Sub Activity"
					disabled={!selectedActivity || selectedSubActivities.length === 0}
					value={addForm.subActivityId}
					onChange={(event) =>
						updateAddSelection({ subActivityId: event.target.value })
					}
					className={compactControlClass}
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
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<input
					type="text"
					readOnly
					aria-label="Default MH"
					value={
						selectedSubActivities.find(
							(subActivity) => subActivity.id === addForm.subActivityId
						)?.default_manhours || '–'
					}
					className="w-full max-w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded text-center bg-gray-100 text-gray-500 focus:outline-none"
				/>
			</td>
			<td className="py-1 px-1 text-center align-middle">
				{renderTimePicker(
					'add',
					'start',
					addForm.start,
					startsPreviousDay(addForm) ? 'Previous day' : ''
				)}
			</td>
			<td className="py-1 px-1 text-center align-middle">
				{renderTimePicker('add', 'end', addForm.end)}
			</td>
			<td className="py-1 px-2 text-center align-middle text-xs text-gray-500">
				Auto
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<input
					type="number"
					min="0"
					step="0.01"
					aria-label="Quantity"
					value={addForm.quantity}
					onChange={(event) =>
						updatePeriodField('add', 'quantity', event.target.value)
					}
					placeholder="Qty"
					className={`${compactControlClass} max-w-16 text-center`}
				/>
			</td>
			<td className="py-1 px-2 text-center align-middle">
				<input
					type="date"
					required
					max={today}
					aria-label="Date Completed"
					value={addForm.dateCompleted}
					onChange={(event) =>
						updatePeriodField('add', 'dateCompleted', event.target.value)
					}
					className={compactControlClass}
				/>
			</td>
			<td className="py-1 px-2 text-center align-middle text-xs text-gray-500">
				–
			</td>
			<td className="py-1 px-2 align-middle">
				<AutoGrowTextarea
					value={addForm.remarks}
					onChange={(event) =>
						updatePeriodField('add', 'remarks', event.target.value)
					}
					placeholder="Remark"
					aria-label="Remarks"
					className="max-h-36 px-1.5 py-0.5 text-left text-xs focus:ring-1"
				/>
			</td>
			<td className="py-1 px-2 text-center align-middle">
				{renderEditorActions(mutation.isPending)}
			</td>
		</tr>
	);

	const renderEditForm = () => {
		const period = editing.row;
		const assignment = assignments.find(
			(candidate) =>
				String(candidate.project_id) === String(period.projectId) &&
				String(candidate.activity_id) === String(period.activityId)
		);
		const defaultManhours = numberValue(
			period.defaultManhours ?? assignment?.default_manhours
		);
		const status = period.status || assignment?.status || 'Not Started';
		const documentsName = projectDocumentsName(period);
		return (
			<tr key={period.id} className="bg-purple-50/50 divide-x divide-gray-300">
				<td className="py-1 px-2 text-center align-middle">
					<ProjectNumberValue
						projectId={period.projectId}
						documentsName={documentsName}
						code={period.projectCode || period.projectName || period.projectId}
						documentCount={projectDocumentCount(
							documentCounts,
							period.projectId
						)}
					/>
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<ActivityTextValue value={period.discipline || '–'} />
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<ActivityTextValue
						value={period.activityName || 'Unnamed Activity'}
						className="font-semibold text-[#4A1254]"
					/>
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<ActivityTextValue value={period.subActivityName || '–'} />
				</td>
				<td className="py-1 px-2 text-center align-middle text-[#4A1254]">
					{formatQuantity(defaultManhours)}
				</td>
				<td className="py-1 px-1 text-center align-middle">
					{renderTimePicker(
						'edit',
						'start',
						editing.fields.start,
						periodDateHint(period.start, editing.fields.dateCompleted)
					)}
				</td>
				<td className="py-1 px-1 text-center align-middle">
					{renderTimePicker(
						'edit',
						'end',
						editing.fields.end,
						periodDateHint(period.end, editing.fields.dateCompleted)
					)}
				</td>
				<td className="py-1 px-2 text-center align-middle text-xs text-gray-500">
					Auto
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<input
						type="number"
						min="0"
						step="0.01"
						aria-label="Quantity"
						value={editing.fields.quantity}
						onChange={(event) =>
							updatePeriodField('edit', 'quantity', event.target.value)
						}
						className={`${compactControlClass} max-w-16 text-center`}
					/>
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<input
						type="date"
						required
						max={today}
						aria-label="Date Completed"
						value={editing.fields.dateCompleted}
						onChange={(event) =>
							updatePeriodField('edit', 'dateCompleted', event.target.value)
						}
						className={compactControlClass}
					/>
				</td>
				<td className="py-1 px-2 text-center align-middle">
					<span
						className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
							status
						)}`}
					>
						{status}
					</span>
				</td>
				<td className="py-1 px-2 align-middle">
					<AutoGrowTextarea
						value={editing.fields.remarks}
						onChange={(event) =>
							updatePeriodField('edit', 'remarks', event.target.value)
						}
						aria-label="Remarks"
						className="max-h-36 px-1.5 py-0.5 text-left text-xs focus:ring-1"
					/>
				</td>
				<td className="py-1 px-2 text-center align-middle">
					{renderEditorActions(mutation.isPending)}
				</td>
			</tr>
		);
	};

	return (
		<div className="min-w-0 rounded-xl border-2 border-purple-200 bg-white shadow-lg ring-1 ring-purple-100">
			<div className="px-3 py-2 border-b-2 border-purple-100 bg-gradient-to-r from-purple-50 to-white flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center shadow-sm">
						<ClipboardDocumentListIcon
							className="w-4 h-4 text-purple-600"
							aria-hidden="true"
						/>
					</div>
					<h3 className="text-sm font-bold text-[#4A1254]">
						My Project Activities
					</h3>
				</div>
				{hasAnyData && canLog && (
					<button
						type="button"
						onClick={openAddRow}
						disabled={editorOpen || mutation.isPending}
						className="flex items-center gap-1 px-2 py-1 rounded bg-[#64126D] text-white hover:bg-[#7F2487] transition-colors text-xs font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
						title="Add a new activity"
					>
						<PlusIcon className="w-3.5 h-3.5" aria-hidden="true" />
						Add
					</button>
				)}
			</div>

			{periodData && !canLog && (
				<div className="mx-3 mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-snug text-amber-900">
					<LockClosedIcon
						className="mt-0.5 h-3.5 w-3.5 shrink-0"
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
					className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"
				>
					<p>
						Work Periods could not load:{' '}
						{errorMessage(periodsQuery.error, 'Try again.')}
					</p>
					<button
						type="button"
						onClick={() => periodsQuery.refetch()}
						className="font-semibold underline"
					>
						Try again
					</button>
				</div>
			)}

			{legacyQuery.isError && !preloadedData && !legacyAccessDenied && (
				<div
					role="alert"
					className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"
				>
					<p>
						Project activities could not load:{' '}
						{errorMessage(legacyQuery.error, 'Try again.')}
					</p>
					<button
						type="button"
						onClick={() => legacyQuery.refetch()}
						className="font-semibold underline"
					>
						Try again
					</button>
				</div>
			)}

			{!hasAnyData ? (
				<div className="text-center py-10 text-[#4A1254]">
					<ClipboardDocumentListIcon
						className="w-14 h-14 mx-auto mb-3 opacity-50"
						aria-hidden="true"
					/>
					<p className="text-sm">No projects assigned yet</p>
					<p className="mt-1 text-xs text-gray-500">
						Contact your project manager to be added to a project.
					</p>
				</div>
			) : (
				<>
					<div
						role="search"
						aria-label="Filter project activities"
						className="px-3 py-2 border-b border-purple-100 bg-white/60 flex flex-wrap items-end gap-2"
					>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => changeWeek(-7)}
								aria-label="Previous week"
								title="Previous week"
								className="p-1 rounded text-[#64126D] hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
							>
								<ChevronLeftIcon className="w-3.5 h-3.5" aria-hidden="true" />
							</button>
							<span className="px-1 text-xs font-semibold text-[#4A1254] whitespace-nowrap">
								{formatWeekRange(activeWeek)}
							</span>
							<button
								type="button"
								onClick={() => changeWeek(7)}
								aria-label="Next week"
								title="Next week"
								className="p-1 rounded text-[#64126D] hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
							>
								<ChevronRightIcon className="w-3.5 h-3.5" aria-hidden="true" />
							</button>
							{activeWeek !== currentWeek && (
								<button
									type="button"
									onClick={showCurrentWeek}
									className="px-1 text-xs font-semibold text-[#64126D] hover:bg-purple-50 rounded"
								>
									This week
								</button>
							)}
						</div>
						<div>
							<label
								htmlFor="activity-start-date"
								className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1"
							>
								From
							</label>
							<input
								id="activity-start-date"
								type="date"
								value={fromDate}
								min={activeWeek}
								max={toDate || weekEnd}
								onChange={(event) => setFromDate(event.target.value)}
								className="px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
							/>
						</div>
						<div>
							<label
								htmlFor="activity-end-date"
								className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1"
							>
								To
							</label>
							<input
								id="activity-end-date"
								type="date"
								value={toDate}
								min={fromDate || activeWeek}
								max={weekEnd}
								onChange={(event) => setToDate(event.target.value)}
								className="px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
							/>
						</div>
						<div className="relative min-w-0 grow basis-48">
							<MagnifyingGlassIcon
								className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
								aria-hidden="true"
							/>
							<input
								type="text"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search code, project, activity…"
								aria-label="Search activities"
								className="w-full pl-7 pr-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
							/>
						</div>
						<select
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							className="px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
							title="Filter by status"
							aria-label="Filter by status"
						>
							<option value="all">All statuses</option>
							{statusOptions.map((status) => (
								<option key={status} value={status}>
									{status}
								</option>
							))}
						</select>
						{(search ||
							statusFilter !== 'all' ||
							sort.key ||
							fromDate !== activeWeek ||
							toDate !== weekEnd) && (
							<button
								type="button"
								onClick={clearFilters}
								className="px-2 py-1 text-xs font-semibold text-[#64126D] hover:bg-purple-50 rounded"
							>
								Clear
							</button>
						)}
						<span className="ml-auto text-xs text-gray-500">
							{flatRows.length}
							{flatRows.length !== baseRows.length
								? ` of ${baseRows.length}`
								: ''}{' '}
							{flatRows.length === 1 ? 'activity' : 'activities'}
						</span>
					</div>

					{optionsQuery.isError && isAdding && !actionError && (
						<div
							role="alert"
							className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"
						>
							<p>
								{errorMessage(optionsQuery.error, 'Activities could not load.')}
							</p>
							<button
								type="button"
								onClick={() => optionsQuery.refetch()}
								className="font-semibold underline"
							>
								Try again
							</button>
						</div>
					)}

					{actionErrorNode}

					<form
						aria-label="Work Period editor"
						noValidate
						onSubmit={isAdding ? submitAdd : editing ? submitEdit : undefined}
					>
						<div
							className="relative overflow-x-auto rounded-b-xl"
							role="region"
							aria-labelledby={periodsCaptionId}
							tabIndex={0}
							aria-busy={periodsQuery.isFetching}
						>
							<table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
								<caption id={periodsCaptionId} className="sr-only">
									Project activity table
								</caption>
								<colgroup>
									<col className="w-[9%]" />
									<col className="w-[7%]" />
									<col className="w-[11%]" />
									<col className="w-[9%]" />
									<col className="w-[5%]" />
									<col className="w-[8%]" />
									<col className="w-[8%]" />
									<col className="w-[6%]" />
									<col className="w-[5%]" />
									<col className="w-[11%]" />
									<col className="w-[7%]" />
									<col className="w-[8%]" />
									<col className="w-[6%]" />
								</colgroup>
								<thead className="bg-[#64126D]/10">
									<tr className="divide-x divide-[#64126D]/40">
										<SortHeader
											label="Project Number"
											sortKey="project_code"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Discipline"
											sortKey="discipline"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Activity"
											sortKey="activity_name"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Sub Activity"
											sortKey="sub_activity_name"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Default MH"
											sortKey="default_manhours"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center font-bold text-[#64126D] text-xs leading-tight"
										>
											Start Period
										</th>
										<th
											scope="col"
											className="px-2 py-2 text-center font-bold text-[#64126D] text-xs leading-tight"
										>
											End Period
										</th>
										<SortHeader
											label="Manhours"
											sortKey="planned_hours"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Quantity"
											sortKey="qty_completed"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Date Completed"
											sortKey="due_date"
											sort={sort}
											onSort={toggleSort}
										/>
										<SortHeader
											label="Status"
											sortKey="status"
											sort={sort}
											onSort={toggleSort}
										/>
										<th
											scope="col"
											className="px-2 py-2 text-center font-bold text-[#64126D] text-xs leading-tight"
										>
											Remark
										</th>
										<th
											scope="col"
											className="px-2 py-2 text-center font-bold text-[#64126D] text-xs leading-tight"
										>
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-300">
									{isAdding && renderAddForm()}
									{periodsQuery.isPending &&
										!periodData &&
										!isAdding &&
										flatRows.length === 0 && (
											<tr>
												<td
													colSpan={COLS}
													className="py-6 px-4 text-center text-sm text-[#4A1254]"
												>
													Loading assignments…
												</td>
											</tr>
										)}
									{periodsQuery.isError && !periodData && !isAdding && (
										<tr>
											<td
												colSpan={COLS}
												className="py-6 px-4 text-center text-sm text-red-800"
											>
												Work Periods could not load. Use Try again above.
											</td>
										</tr>
									)}
									{flatRows.length === 0 &&
										!periodsQuery.isPending &&
										!isAdding && (
											<tr>
												<td
													colSpan={COLS}
													className="py-6 px-4 text-center text-sm text-[#4A1254]"
												>
													{baseRows.length === 0 ? (
														<>
															<p>
																No activities yet. Click{' '}
																<span className="font-semibold">Add</span> above
																to log your first activity.
															</p>
															{assignableProjects.length > 0 && (
																<div className="mt-4 space-y-2 text-left max-w-md mx-auto">
																	<p className="text-xs font-semibold text-gray-700">
																		Assigned projects
																	</p>
																	<ul className="space-y-2">
																		{assignableProjects.map((project) => {
																			const documentsName =
																				projectDocumentsName(project);
																			const documentCount =
																				projectDocumentCount(
																					documentCounts,
																					project.project_id
																				);
																			return (
																				<li
																					key={project.project_id}
																					className="flex items-center justify-between gap-3 rounded-lg border border-purple-100 bg-white px-3 py-2"
																				>
																					<span className="text-xs text-gray-700 break-words">
																						{project.project_code
																							? `${project.project_code} – ${project.project_name || ''}`
																							: project.project_name ||
																								project.project_id}
																					</span>
																					<Link
																						href={projectDocumentsHref(
																							project.project_id
																						)}
																						aria-label={documentsName}
																						title={documentsName}
																						className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-purple-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
																					>
																						Open documents
																						<DocumentCountMarker
																							count={documentCount}
																						/>
																					</Link>
																				</li>
																			);
																		})}
																	</ul>
																</div>
															)}
														</>
													) : (
														<>
															No activities match the current search or filter.
														</>
													)}
												</td>
											</tr>
										)}
									{flatRows.map((row) => {
										if (editing && editing.row.id === row.period?.id)
											return renderEditForm();
										const activityName = row.activityName || 'Unnamed Activity';
										const documentsName = projectDocumentsName(row);
										const canEdit = Boolean(
											row.kind === 'period' &&
											row.period.editable &&
											row.period.assignmentId &&
											canLog
										);
										const lockLabel =
											row.kind === 'legacy'
												? 'Historical duration-only log'
												: row.kind === 'assignment'
													? 'No Work Period recorded'
													: !row.period.assignmentId
														? 'Assignment link missing'
														: !canLog
															? 'Logging unavailable'
															: 'Locked';
										return (
											<tr
												key={row.key}
												className="transition-colors divide-x divide-gray-300 hover:bg-purple-50/40"
											>
												<td className="py-1 px-2 text-center align-middle">
													{row.projectId ? (
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
													) : (
														<span className="text-xs text-gray-600">
															Project unavailable
														</span>
													)}
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<ActivityTextValue
														value={row.discipline || '–'}
														className="text-[#4A1254]"
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<ActivityTextValue
														value={activityName}
														className="font-semibold text-[#4A1254]"
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<ActivityTextValue
														value={row.subActivityName || '–'}
														className="text-[#4A1254]"
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle text-[#4A1254]">
													{formatQuantity(row.defaultManhours)}
													{row.kind === 'assignment' && row.estimate > 0 && (
														<span className="block text-[10px] font-normal text-gray-500">
															Estimate: {formatQuantity(row.estimate)}
														</span>
													)}
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<PeriodTime
														endpoint={row.start}
														dateCompleted={row.dateCompleted}
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<PeriodTime
														endpoint={row.end}
														dateCompleted={row.dateCompleted}
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle text-[#4A1254] tabular-nums">
													{row.kind === 'assignment'
														? ''
														: formatQuantity(row.manhours)}
													{row.kind === 'period' &&
														row.weekManhours !== row.manhours && (
															<span className="block text-[10px] font-normal text-gray-500">
																Week: {formatQuantity(row.weekManhours)}
															</span>
														)}
												</td>
												<td className="py-1 px-2 text-center align-middle tabular-nums">
													{row.kind === 'assignment'
														? ''
														: formatQuantity(row.quantity)}
													{row.kind === 'period' &&
														row.weekQuantity !== row.quantity && (
															<span className="block text-[10px] text-gray-500">
																Week: {formatQuantity(row.weekQuantity)}
															</span>
														)}
												</td>
												<td className="py-1 px-2 text-center align-middle">
													{row.dateCompleted
														? formatDateLabel(row.dateCompleted)
														: ''}
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<span
														className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(row.status)}`}
													>
														{row.status || 'Not Started'}
													</span>
												</td>
												<td className="py-1 px-2 align-middle">
													<span className="block max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-700">
														{row.remarks || ''}
													</span>
												</td>
												<td className="py-1 px-2 text-center align-middle">
													{canEdit ? (
														<div className="flex items-center justify-center gap-1">
															<button
																type="button"
																onClick={() => openEditRow(row.period)}
																disabled={mutation.isPending}
																className="p-1 rounded text-[#64126D] hover:bg-purple-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
																title="Edit"
																aria-label={`Edit Work Period for ${activityName}`}
															>
																<PencilSquareIcon
																	className="w-3.5 h-3.5"
																	aria-hidden="true"
																/>
															</button>
															<button
																type="button"
																onClick={() => deletePeriod(row.period)}
																disabled={mutation.isPending}
																className="p-1 rounded text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
																title="Delete"
																aria-label={`Delete Work Period for ${activityName}`}
															>
																<TrashIcon
																	className="w-3.5 h-3.5"
																	aria-hidden="true"
																/>
															</button>
														</div>
													) : (
														<button
															type="button"
															disabled
															className="p-1 rounded text-gray-400 cursor-not-allowed"
															title={
																lockLabel === 'Locked'
																	? 'Both work dates must be today or yesterday to edit.'
																	: lockLabel
															}
															aria-label={`${lockLabel} for ${activityName}`}
														>
															<LockClosedIcon
																className="w-3.5 h-3.5"
																aria-hidden="true"
															/>
														</button>
													)}
												</td>
											</tr>
										);
									})}
									{flatRows.length > 0 && (
										<tr className="bg-[#64126D]/10 divide-x divide-gray-300 font-bold">
											<td
												colSpan={7}
												className="py-1 px-2 text-right text-[#4A1254] uppercase text-xs tracking-wide"
											>
												{flatRows.length !== baseRows.length
													? 'Total (filtered)'
													: 'Total Manhours'}
											</td>
											<td className="py-1 px-2 text-center text-[#4A1254] tabular-nums">
												{formatQuantity(totalManhours)}
											</td>
											<td className="py-1 px-2 text-center text-[#4A1254] tabular-nums">
												{formatQuantity(totalQuantity)}
											</td>
											<td colSpan={4}></td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</form>
					<p className="px-3 py-2 text-[11px] leading-snug text-gray-500">
						Times use IST. For a new entry, an earlier end time means work
						started the previous day. Older entries may have no recorded times.
					</p>
				</>
			)}
		</div>
	);
}
