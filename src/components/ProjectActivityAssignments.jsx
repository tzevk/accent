'use client';

import { useState, useEffect, useLayoutEffect, useRef, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';
import {
	istDate,
	parseIstLocal,
	shiftIstDate,
	weekStartFor,
} from '@/lib/work-periods';
import { formatDate, formatNumber } from '@/lib/format';
import {
	formatWorkPeriodClock,
	WorkPeriodTimePicker,
} from '@/components/WorkPeriodTimePicker';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@/components/ui/tooltip';
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

function StatusBadge({ status }) {
	const label = status || 'Not Started';
	const color =
		STATUS_BADGE_CLASSES[label] || 'bg-gray-100 text-gray-600 border-gray-200';
	return (
		<span
			className={`inline-block max-w-full rounded-full border px-1 py-0.5 text-center text-[0.6875rem] font-semibold leading-tight wrap-break-word ${color}`}
		>
			{label}
		</span>
	);
}

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
 * Measure both axes: project codes stay on one line and activity labels
 * wrap to two. Remeasure when the cell or its font changes.
 */
function useIsTruncated(ref, value) {
	const [truncated, setTruncated] = useState(false);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;

		const measure = () =>
			setTruncated(
				element.scrollWidth - element.clientWidth > 1 ||
					element.scrollHeight - element.clientHeight > 1
			);
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
			className="mt-0.5 block w-full rounded border border-purple-200 bg-purple-50/70 px-1 py-0.5 text-left text-xs font-normal leading-snug wrap-break-word text-[#4A1254] shadow-sm"
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
				className={`line-clamp-2 text-xs leading-snug wrap-break-word ${className}`}
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
				className="inline-flex max-w-full items-center gap-0.5 font-mono text-xs text-[#4A1254] leading-tight underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
			>
				<span
					ref={ref}
					data-truncated={truncated ? 'true' : undefined}
					className="block min-w-0 truncate"
				>
					{codeText}
				</span>
				<DocumentCountMarker count={documentCount} className="size-3" />
			</Link>
			{truncated && (
				<FullCellValue id={fullValueId} value={codeText} shown={focused} />
			)}
		</span>
	);
}

const WORK_PERIOD_COLUMNS = [
	{
		label: 'Project Number',
		sortKey: 'project_code',
		help: 'Select the project number to open its documents.',
	},
	{
		label: 'Discipline',
		sortKey: 'discipline',
		help: 'The specialty responsible for the activity.',
	},
	{
		label: 'Activity',
		sortKey: 'activity_name',
		help: 'The type of work you did on the project.',
	},
	{
		label: 'Sub Activity',
		sortKey: 'sub_activity_name',
		help: 'Choose a more specific task when the activity has sub-activities.',
	},
	{
		label: 'Activity Description',
		alignLeft: true,
		help: 'Describe the work you did. This is required to save a Work Period.',
	},
	{
		label: 'Default MH',
		sortKey: 'default_manhours',
		help: 'Preset hours for the activity, not hours you worked.',
	},
	{
		label: 'Manhours',
		sortKey: 'planned_hours',
		help: 'Hours worked, calculated from the start and end times for new entries.',
	},
	{
		label: 'Quantity',
		sortKey: 'qty_completed',
		help: 'Optional: how much work you completed.',
	},
	{
		label: 'Start Period',
		help: 'When you started work, in Indian Standard Time (IST).',
	},
	{
		label: 'End Period',
		help: 'When you finished work, in IST. Save only after the work ends.',
	},
	{
		label: 'Date Completed',
		sortKey: 'due_date',
		help: 'Defaults to the End date for new entries and sets the date the quantity counts toward.',
	},
	{
		label: 'Status',
		sortKey: 'status',
		help: 'The current status of the project activity.',
	},
	{
		label: 'Actions',
		help: 'Edit or delete eligible Work Periods. A lock means the row is read-only.',
	},
];

function WorkPeriodColumnHeader({ column, sort, onSort }) {
	const { label, help, sortKey, alignLeft } = column;
	const isActive = Boolean(sortKey && sort.key === sortKey);
	return (
		<th
			scope="col"
			className={`relative font-bold text-[#64126D] text-xs leading-tight ${sortKey ? 'px-0 text-center' : alignLeft ? 'px-2 text-left' : 'px-2 text-center'}`}
			aria-sort={
				isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
			}
		>
			<Tooltip>
				{sortKey ? (
					<TooltipTrigger
						type="button"
						delay={300}
						onClick={() => onSort(sortKey)}
						className="flex min-h-6 w-full items-center justify-center gap-0.5 rounded px-1 hover:underline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-purple-500"
					>
						<span className="min-w-0 max-w-full text-balance">{label}</span>
						<ArrowsUpDownIcon
							aria-hidden="true"
							className={`absolute bottom-1 left-1/2 size-2.5 shrink-0 -translate-x-1/2 @min-[76rem]:static @min-[76rem]:translate-x-0 ${isActive ? 'opacity-100' : 'opacity-50'}`}
						/>
					</TooltipTrigger>
				) : (
					<TooltipTrigger
						render={<span />}
						tabIndex={0}
						delay={300}
						className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
					>
						{label}
					</TooltipTrigger>
				)}
				<TooltipContent>{help}</TooltipContent>
			</Tooltip>
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
	startDate: '',
	endDate: '',
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

function periodRangeManhours(start, end, rangeStart, rangeEnd) {
	const startMs = parseIstLocal(start);
	const endMs = parseIstLocal(end);
	const rangeStartMs = parseIstLocal(`${rangeStart}T00:00`);
	const rangeEndMs = parseIstLocal(`${shiftIstDate(rangeEnd, 1)}T00:00`);
	if (
		startMs === null ||
		endMs === null ||
		rangeStartMs === null ||
		rangeEndMs === null ||
		endMs <= startMs
	) {
		return 0;
	}
	const clippedStart = Math.max(startMs, rangeStartMs);
	const clippedEnd = Math.min(endMs, rangeEndMs);
	return clippedEnd <= clippedStart
		? 0
		: (clippedEnd - clippedStart) / (60 * 60 * 1000);
}

function addEndpoints(fields) {
	return {
		start: `${fields.startDate}T${fields.start}`,
		end: `${fields.endDate}T${fields.end}`,
	};
}

function editEndpoint(date, time) {
	return date && time ? `${date}T${time}` : '';
}

function effectiveDateCompleted(fields) {
	return fields.dateCompleted || fields.endDate || '';
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

function PeriodTime({ endpoint, dateCompleted, showDate = true }) {
	if (!endpoint) return null;
	const hint = showDate ? periodDateHint(endpoint, dateCompleted) : '';
	return (
		<>
			<time className="tabular-nums" dateTime={`${endpoint}+05:30`}>
				{formatWorkPeriodClock(periodClock(endpoint))}
			</time>
			{hint && (
				<span className="block text-xs leading-snug text-muted-foreground">
					{hint}
				</span>
			)}
		</>
	);
}

function EndpointDateControl({
	id,
	label,
	value,
	min,
	max,
	disabled,
	onChange,
}) {
	return (
		<details className="mt-1 text-xs leading-none text-muted-foreground">
			<summary
				aria-label={`${label} date`}
				className="inline-flex min-h-6 w-fit cursor-pointer list-none items-center rounded px-1 py-1 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
			>
				Date
			</summary>
			<div className="mt-1">
				<label htmlFor={id} className="sr-only">
					{label} Date
				</label>
				<input
					id={id}
					type="date"
					min={min}
					max={max}
					disabled={disabled}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="h-7 w-full min-w-0 rounded border border-input bg-background px-1 text-xs tabular-nums text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
				/>
			</div>
		</details>
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
	const descriptionId = `${formId}-description`;
	const actionErrorId = `${formId}-error`;
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
	const descriptionRequiredError = 'Enter an Activity Description.';
	const descriptionInvalid = actionError === descriptionRequiredError;
	const editorOpen = isAdding || Boolean(editing);

	useEffect(() => {
		if (descriptionInvalid) {
			document.getElementById(descriptionId)?.focus();
		} else if (actionError) {
			errorRef.current?.focus();
		}
	}, [actionError, descriptionId, descriptionInvalid]);

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
			toast.error(
				errorMessage(error, 'The Work Period could not be saved. Try again.'),
				{
					id: actionErrorId,
					ariaProps: { role: 'alert', 'aria-live': 'assertive' },
				}
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
	const readOnly = periodData?.readOnly === true;
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

	const assignmentsById = new Map(assignments.map((row) => [row.id, row]));
	const rangeStart = fromDate || activeWeek;
	const rangeEnd = toDate || weekEnd;
	const rangeStartMidnight = `${rangeStart}T00:00`;
	const isFullWeekRange = rangeStart === activeWeek && rangeEnd === weekEnd;

	const legacyWeekRows = assignments.flatMap((assignment) =>
		rawLegacyEntries(assignment)
			.map((entry, index) => ({
				key: `${assignment.id}-${entry?.date || 'undated'}-${index}`,
				projectId: assignment.project_id,
				projectCode: assignment.project_code || '',
				projectName: assignment.project_name || '',
				discipline: assignment.discipline || '',
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
		const assignment = assignmentsById.get(period.assignmentId);
		return {
			kind: 'period',
			key: `period-${period.id}`,
			period,
			projectId: period.projectId,
			projectCode: period.projectCode || assignment?.project_code || '',
			projectName: period.projectName || assignment?.project_name || '',
			discipline: period.discipline || assignment?.discipline || '',
			activityName:
				period.activityName || assignment?.activity_name || 'Unnamed Activity',
			subActivityName:
				period.subActivityName ?? assignment?.sub_activity_name ?? '',
			defaultManhours: numberValue(
				period.defaultManhours ?? assignment?.default_manhours
			),
			start: period.start || '',
			end: period.end || '',
			manhours: numberValue(period.durationSeconds) / 3600,
			rangeManhours: isFullWeekRange
				? numberValue(period.weekSeconds) / 3600
				: periodRangeManhours(period.start, period.end, rangeStart, rangeEnd),
			quantity: numberValue(period.quantity),
			rangeQuantity: isFullWeekRange
				? numberValue(period.weekQuantity)
				: period.dateCompleted >= rangeStart && period.dateCompleted <= rangeEnd
					? numberValue(period.quantity)
					: 0,
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
		rangeManhours: row.hours,
		dateCompleted: row.date,
		rangeQuantity: row.quantity,
	}));

	const baseRows = [...workRows, ...legacyRows];
	const statusOptions = Array.from(
		new Set(baseRows.map((row) => row.status).filter(Boolean))
	).sort(textCollator.compare);

	const normalizedSearch = search.trim().toLowerCase();
	const quantityInRange = (row) =>
		row.kind === 'period' &&
		numberValue(row.quantity) > 0 &&
		row.dateCompleted >= rangeStart &&
		row.dateCompleted <= rangeEnd;
	let flatRows = baseRows.filter((row) => {
		const matchesSearch =
			!normalizedSearch ||
			(row.kind === 'period'
				? periodSearchText(row.period)
				: legacySearchText(row)
			).includes(normalizedSearch);
		const matchesStatus = statusFilter === 'all' || row.status === statusFilter;
		const matchesDate =
			row.kind === 'period'
				? (row.start.slice(0, 10) <= rangeEnd &&
						row.end > rangeStartMidnight) ||
					quantityInRange(row)
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
		(total, row) => total + numberValue(row.rangeManhours),
		0
	);
	const totalQuantity = flatRows.reduce(
		(total, row) => total + numberValue(row.rangeQuantity),
		0
	);
	const rangeLabel = isFullWeekRange ? 'Week' : 'Selected';
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
			startDate: today,
			endDate: today,
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
				startDate: period.start.slice(0, 10),
				endDate: period.end.slice(0, 10),
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
		const apply = (current) => {
			const next = { ...current, [field]: value };
			if (
				field === 'endDate' &&
				(!current.dateCompleted || current.dateCompleted === current.endDate)
			) {
				next.dateCompleted = value;
			}
			return next;
		};
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
		const dateCompleted = effectiveDateCompleted(fields);
		if (dateCompleted > today) return 'Date Completed cannot be in the future.';
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
		if (!fields.remarks.trim()) return descriptionRequiredError;
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
		const endpoints = addEndpoints(addForm);
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
				dateCompleted: effectiveDateCompleted(addForm),
				remarks: addForm.remarks,
			},
		});
	};

	const submitEdit = (event) => {
		event.preventDefault();
		if (!editing) return;
		const endpoints = {
			start: editEndpoint(editing.fields.startDate, editing.fields.start),
			end: editEndpoint(editing.fields.endDate, editing.fields.end),
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
				dateCompleted: effectiveDateCompleted(editing.fields),
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
			id={actionErrorId}
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

	const renderDescription = (mode, value) => (
		<AutoGrowTextarea
			id={descriptionId}
			name="remarks"
			value={value}
			onChange={(event) =>
				updatePeriodField(mode, 'remarks', event.target.value)
			}
			placeholder="Required"
			aria-label="Activity Description"
			required
			aria-invalid={descriptionInvalid}
			aria-describedby={descriptionInvalid ? actionErrorId : undefined}
			className="max-h-36 px-1.5 py-0.5 text-left text-xs focus:ring-1 aria-invalid:border-red-500"
		/>
	);

	const compactControlClass =
		'w-full min-w-0 px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100';

	const renderEndpointDate = (mode, endpoint, date) => {
		const label = endpoint === 'start' ? 'Start Period' : 'End Period';
		const id = `${formId}-${mode}-${endpoint}-date`;
		return (
			<EndpointDateControl
				id={id}
				label={label}
				value={date}
				min={yesterday}
				max={today}
				disabled={mutation.isPending}
				onChange={(value) => updatePeriodField(mode, `${endpoint}Date`, value)}
			/>
		);
	};

	const renderTimePicker = (mode, endpoint, time, date, hint = '') => {
		const label = endpoint === 'start' ? 'Start Period' : 'End Period';
		const id = `${formId}-${mode}-${endpoint}`;
		return (
			<>
				<WorkPeriodTimePicker
					id={id}
					label={label}
					value={time}
					describedBy={hint ? `${id}-hint` : undefined}
					disabled={mutation.isPending}
					onChange={(value) => updatePeriodField(mode, endpoint, value)}
				/>
				{renderEndpointDate(mode, endpoint, date)}
				{hint && (
					<span
						id={`${id}-hint`}
						className="block text-xs leading-snug text-muted-foreground"
					>
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
			<td className="py-1 px-2 align-middle">
				{renderDescription('add', addForm.remarks)}
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
			<td className="py-1 px-1 text-center align-middle">
				{renderTimePicker(
					'add',
					'start',
					addForm.start,
					addForm.startDate,
					addForm.startDate !== addForm.endDate
						? periodDateHint(
								`${addForm.startDate}T${addForm.start}`,
								effectiveDateCompleted(addForm)
							)
						: ''
				)}
			</td>
			<td className="py-1 px-1 text-center align-middle">
				{renderTimePicker(
					'add',
					'end',
					addForm.end,
					addForm.endDate,
					addForm.startDate !== addForm.endDate
						? periodDateHint(
								`${addForm.endDate}T${addForm.end}`,
								effectiveDateCompleted(addForm)
							)
						: ''
				)}
			</td>
			<td className="py-1 px-1 text-center align-middle">
				<input
					type="date"
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
			<td className="py-1 px-1 text-center align-middle">
				{renderEditorActions(mutation.isPending)}
			</td>
		</tr>
	);

	const renderEditForm = () => {
		const period = editing.row;
		const assignment = assignmentsById.get(period.assignmentId);
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
				<td className="py-1 px-2 align-middle">
					{renderDescription('edit', editing.fields.remarks)}
				</td>
				<td className="py-1 px-2 text-center align-middle text-[#4A1254]">
					{formatQuantity(defaultManhours)}
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
				<td className="py-1 px-1 text-center align-middle">
					{renderTimePicker(
						'edit',
						'start',
						editing.fields.start,
						editing.fields.startDate,
						editing.fields.startDate !== editing.fields.endDate
							? periodDateHint(
									`${editing.fields.startDate}T${editing.fields.start}`,
									effectiveDateCompleted(editing.fields)
								)
							: ''
					)}
				</td>
				<td className="py-1 px-1 text-center align-middle">
					{renderTimePicker(
						'edit',
						'end',
						editing.fields.end,
						editing.fields.endDate,
						editing.fields.startDate !== editing.fields.endDate
							? periodDateHint(
									`${editing.fields.endDate}T${editing.fields.end}`,
									effectiveDateCompleted(editing.fields)
								)
							: ''
					)}
				</td>
				<td className="py-1 px-1 text-center align-middle">
					<input
						type="date"
						max={today}
						aria-label="Date Completed"
						value={editing.fields.dateCompleted}
						onChange={(event) =>
							updatePeriodField('edit', 'dateCompleted', event.target.value)
						}
						className={compactControlClass}
					/>
				</td>
				<td className="py-1 px-1 text-center align-middle">
					<StatusBadge status={status} />
				</td>
				<td className="py-1 px-1 text-center align-middle">
					{renderEditorActions(mutation.isPending)}
				</td>
			</tr>
		);
	};

	return (
		<div className="@container min-w-0 rounded-xl border-2 border-purple-200 bg-white shadow-lg ring-1 ring-purple-100">
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

			{periodData && !canLog && !readOnly && (
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
						<div className="flex h-8 items-center gap-1">
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
								className="block h-8 px-2 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
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
								className="block h-8 px-2 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
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
								className="block h-8 w-full pl-7 pr-2 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
							/>
						</div>
						<select
							value={statusFilter}
							onChange={(event) => setStatusFilter(event.target.value)}
							className="h-8 px-2 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
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
								className="inline-flex h-8 items-center rounded px-2 text-xs font-semibold text-[#64126D] hover:bg-purple-50"
							>
								Clear
							</button>
						)}
						<span className="ml-auto inline-flex h-8 items-center whitespace-pre text-xs text-gray-500">
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
									<col className="w-[8.5%]" />
									<col className="w-[7%]" />
									<col className="w-[10%]" />
									<col className="w-[8.5%]" />
									<col className="w-[11.5%]" />
									<col className="w-[5%]" />
									<col className="w-[6.5%]" />
									<col className="w-[5.5%]" />
									<col className="w-[8%]" />
									<col className="w-[8%]" />
									<col className="w-[9%]" />
									<col className="w-[7.5%]" />
									<col className="w-[5%]" />
								</colgroup>
								<thead className="bg-[#64126D]/10 [&_th]:align-middle [&_th]:pt-2 [&_th]:pb-4 @min-[76rem]:[&_th]:pb-2">
									<tr className="divide-x divide-[#64126D]/40">
										{WORK_PERIOD_COLUMNS.map((column) => (
											<WorkPeriodColumnHeader
												key={column.label}
												column={column}
												sort={sort}
												onSort={toggleSort}
											/>
										))}
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
													Loading recorded work…
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
															<p>No work recorded this week.</p>
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
														<>No recorded work matches the current filters.</>
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
												: !row.period.assignmentId
													? 'Assignment link missing'
													: readOnly
														? 'Read only'
														: !canLog
															? 'Logging unavailable'
															: 'Locked';
										return (
											<tr
												key={row.key}
												className="transition-colors divide-x divide-gray-300 hover:bg-purple-50/40"
											>
												<td className="py-1 px-1 text-center align-middle">
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
												<td className="py-1 px-2 align-middle">
													<span className="block max-h-24 overflow-y-auto whitespace-pre-wrap wrap-break-word text-xs leading-snug text-foreground">
														{row.remarks}
													</span>
												</td>
												<td className="py-1 px-1 text-center align-middle text-xs text-[#4A1254] tabular-nums">
													{formatQuantity(row.defaultManhours)}
												</td>
												<td className="py-1 px-2 text-center align-middle text-[#4A1254] tabular-nums">
													{formatQuantity(row.manhours)}
													{row.kind === 'period' &&
														row.rangeManhours !== row.manhours && (
															<span className="block text-[10px] font-normal text-gray-500">
																{rangeLabel}:{' '}
																{formatQuantity(row.rangeManhours)}
															</span>
														)}
												</td>
												<td className="py-1 px-2 text-center align-middle tabular-nums">
													{formatQuantity(row.quantity)}
													{row.kind === 'period' &&
														row.rangeQuantity !== row.quantity && (
															<span className="block text-[10px] text-gray-500">
																{rangeLabel}:{' '}
																{formatQuantity(row.rangeQuantity)}
															</span>
														)}
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<PeriodTime
														endpoint={row.start}
														dateCompleted={row.dateCompleted}
														showDate={
															row.start.slice(0, 10) !== row.end.slice(0, 10)
														}
													/>
												</td>
												<td className="py-1 px-2 text-center align-middle">
													<PeriodTime
														endpoint={row.end}
														dateCompleted={row.dateCompleted}
														showDate={
															row.start.slice(0, 10) !== row.end.slice(0, 10)
														}
													/>
												</td>
												<td className="py-1 px-1 text-center align-middle whitespace-nowrap text-xs">
													{row.dateCompleted
														? formatDateLabel(row.dateCompleted)
														: ''}
												</td>
												<td className="py-1 px-1 text-center align-middle">
													<StatusBadge status={row.status} />
												</td>
												<td className="py-1 px-1 text-center align-middle">
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
												colSpan={6}
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
											<td colSpan={5}></td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</form>
					<p className="px-3 py-2 text-[11px] leading-snug text-gray-500">
						Times use IST. Start and End dates are independent. Older entries
						may have no recorded times.
					</p>
				</>
			)}
		</div>
	);
}
