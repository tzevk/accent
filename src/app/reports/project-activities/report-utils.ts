/**
 * Data transforms and shared logic for the Project Activities report.
 *
 * API shape (from /api/reports/project-activities):
 *   projects[] → activities[] → members[] → daily_entries[]
 *
 * Tree shape (this module's output):
 *   project → disciplines[] → tasks[] → members[]
 */

export type RollupStatus = 'Completed' | 'In Progress' | 'Not Started';

export interface DailyEntry {
	date: string;
	qty_done?: string | number;
	hours?: string | number;
	remarks?: string;
	[key: string]: unknown;
}

export interface ApiMember {
	user_id: string | number;
	user_name?: string;
	description?: string;
	qty_assigned?: number | string;
	qty_completed?: number | string;
	planned_hours?: number | string;
	actual_hours?: number | string;
	start_date?: string | null;
	due_date?: string | null;
	status?: string;
	remarks?: string;
	daily_entries?: DailyEntry[];
}

export interface ApiActivity {
	id: string | number;
	activity_name?: string;
	activity_description?: string;
	discipline?: string;
	members?: ApiMember[];
	// Optional fields preserved from the project_activities table merge:
	start_date?: string | null;
	end_date?: string | null;
	manhours_planned?: number | string;
	manhours_actual?: number | string;
	status?: string;
	progress_percentage?: number | string;
}

export interface ApiProject {
	project_id: string | number;
	project_name?: string;
	name?: string;
	project_code?: string;
	project_status?: string;
	client_name?: string;
	project_manager?: string;
	start_date?: string | null;
	end_date?: string | null;
	activities?: ApiActivity[];
}

export interface Member extends ApiMember {
	qty_completed: number;
	actual_hours: number;
}

export interface Task {
	id: string | number;
	name: string;
	description: string;
	discipline: string;
	members: Member[];
	total_assigned: number;
	total_done: number;
	status: RollupStatus;
	progress: number;
}

export interface Discipline {
	name: string;
	tasks: Task[];
	total_assigned: number;
	total_done: number;
	status: RollupStatus;
	progress: number;
}

export interface Project {
	project_id: string | number;
	project_name: string;
	project_code: string;
	project_status: string;
	client_name: string;
	project_manager: string;
	start_date: string | null;
	end_date: string | null;
	disciplines: Discipline[];
	total_assigned: number;
	total_done: number;
	task_count: number;
	member_count: number;
	status: RollupStatus;
	progress: number;
}

export interface DisciplineSummary {
	name: string;
	task_count: number;
	total_assigned: number;
	total_done: number;
}

export interface Kpis {
	projects: number;
	tasks: number;
	members: number;
	total_assigned: number;
	total_done: number;
	completed_tasks: number;
	pending_assigned: number;
	completion_rate: number;
}

export interface TreeOptions {
	startDate?: string;
	endDate?: string;
}

export interface FilterOptions {
	search?: string;
	discipline?: string;
}

// ─── Status / progress rollup ─────────────────────────────────────────

/**
 * Roll status up from aggregated qty.
 *   - all done (and target > 0) → 'Completed'
 *   - some done, target > 0     → 'In Progress'
 *   - target = 0                → 'Not Started' (no scope)
 *   - target > 0, no done yet   → 'Not Started'
 */
export function rollupStatus(
	totalAssigned: number,
	totalDone: number
): RollupStatus {
	const a = Number(totalAssigned) || 0;
	const d = Number(totalDone) || 0;
	if (a > 0 && d >= a) return 'Completed';
	if (d > 0 && d < a) return 'In Progress';
	return 'Not Started';
}

export function progressPct(totalAssigned: number, totalDone: number): number {
	const a = Number(totalAssigned) || 0;
	const d = Number(totalDone) || 0;
	if (a <= 0) return 0;
	return Math.min(100, Math.round((d / a) * 100));
}

// ─── Date-range filtering of daily entries ────────────────────────────

/**
 * Filter a member's daily_entries to those within [startDate, endDate] (inclusive).
 * Either bound may be empty. Returns a new object; the input is not mutated.
 * When a date filter is active, qty_completed and actual_hours are recomputed
 * from the in-range entries. Otherwise the API-computed totals are preserved.
 */
export function applyDateRange(
	member: ApiMember,
	startDate: string,
	endDate: string
): Member {
	if (!member) {
		return {
			user_id: '',
			qty_completed: 0,
			actual_hours: 0,
			daily_entries: [],
		};
	}
	const entries = Array.isArray(member.daily_entries)
		? member.daily_entries
		: [];
	const hasStart = !!startDate;
	const hasEnd = !!endDate;

	const inRange = entries.filter((e) => {
		if (!e || !e.date) return false;
		if (hasStart && e.date < startDate) return false;
		if (hasEnd && e.date > endDate) return false;
		return true;
	});

	const filteredQty = inRange.reduce(
		(s, e) => s + (parseFloat(String(e.qty_done ?? '')) || 0),
		0
	);
	const filteredHours = inRange.reduce(
		(s, e) => s + (parseFloat(String(e.hours ?? '')) || 0),
		0
	);

	return {
		...member,
		daily_entries: inRange,
		qty_completed:
			hasStart || hasEnd ? filteredQty : Number(member.qty_completed) || 0,
		actual_hours:
			hasStart || hasEnd ? filteredHours : Number(member.actual_hours) || 0,
	};
}

// ─── Tree builder ─────────────────────────────────────────────────────

/**
 * Build the Project → Discipline → Task → Member tree.
 * The date range, if provided, filters each member's daily_entries before
 * aggregating — so progress and quantities reflect only the selected window.
 */
export function buildTree(
	projects: ApiProject[] | null | undefined,
	options: TreeOptions = {}
): Project[] {
	const { startDate = '', endDate = '' } = options;
	const out: Project[] = [];

	for (const p of projects || []) {
		// Group activities by discipline (case-sensitive on the discipline name,
		// trimmed; the API uses uppercase labels).
		const disciplineMap = new Map<
			string,
			{ name: string; tasks: ApiActivity[] }
		>();
		for (const a of p.activities || []) {
			const dName = (a.discipline || 'General').trim() || 'General';
			if (!disciplineMap.has(dName)) {
				disciplineMap.set(dName, { name: dName, tasks: [] });
			}
			disciplineMap.get(dName)!.tasks.push(a);
		}

		// Per-discipline rollup
		const disciplines: Discipline[] = [];
		for (const d of disciplineMap.values()) {
			const tasks: Task[] = [];
			let dAssigned = 0;
			let dDone = 0;
			for (const act of d.tasks) {
				const members = (act.members || []).map((m) =>
					applyDateRange(m, startDate, endDate)
				);
				const tAssigned = members.reduce(
					(s, m) => s + (Number(m.qty_assigned) || 0),
					0
				);
				const tDone = members.reduce(
					(s, m) => s + (Number(m.qty_completed) || 0),
					0
				);
				tasks.push({
					id: act.id,
					name: act.activity_name || 'Untitled',
					description: act.activity_description || '',
					discipline: d.name,
					members,
					total_assigned: tAssigned,
					total_done: tDone,
					status: rollupStatus(tAssigned, tDone),
					progress: progressPct(tAssigned, tDone),
				});
				dAssigned += tAssigned;
				dDone += tDone;
			}
			disciplines.push({
				name: d.name,
				tasks,
				total_assigned: dAssigned,
				total_done: dDone,
				status: rollupStatus(dAssigned, dDone),
				progress: progressPct(dAssigned, dDone),
			});
		}

		// Project rollup
		const pAssigned = disciplines.reduce((s, d) => s + d.total_assigned, 0);
		const pDone = disciplines.reduce((s, d) => s + d.total_done, 0);
		const pTaskCount = disciplines.reduce((s, d) => s + d.tasks.length, 0);
		const pMemberCount = disciplines.reduce(
			(s, d) => s + d.tasks.reduce((c, t) => c + t.members.length, 0),
			0
		);

		out.push({
			project_id: p.project_id,
			project_name: p.project_name || p.name || `Project #${p.project_id}`,
			project_code: p.project_code || '',
			project_status: p.project_status || 'Active',
			client_name: p.client_name || '',
			project_manager: p.project_manager || '',
			start_date: p.start_date || null,
			end_date: p.end_date || null,
			disciplines,
			total_assigned: pAssigned,
			total_done: pDone,
			task_count: pTaskCount,
			member_count: pMemberCount,
			status: rollupStatus(pAssigned, pDone),
			progress: progressPct(pAssigned, pDone),
		});
	}

	return out;
}

// ─── KPI computation ──────────────────────────────────────────────────

export function computeKpis(tree: Project[]): Kpis {
	let totalTasks = 0;
	let totalMembers = 0;
	let totalAssigned = 0;
	let totalDone = 0;
	let completedTasks = 0;
	let pendingAssigned = 0;

	for (const p of tree) {
		totalTasks += p.task_count;
		totalMembers += p.member_count;
		totalAssigned += p.total_assigned;
		totalDone += p.total_done;
		for (const d of p.disciplines) {
			pendingAssigned += d.tasks
				.filter((t) => t.status === 'Not Started')
				.reduce((s, t) => s + t.total_assigned, 0);
			completedTasks += d.tasks.filter((t) => t.status === 'Completed').length;
		}
	}

	const completionRate =
		totalAssigned > 0 ? Math.round((totalDone / totalAssigned) * 100) : 0;

	return {
		projects: tree.length,
		tasks: totalTasks,
		members: totalMembers,
		total_assigned: totalAssigned,
		total_done: totalDone,
		completed_tasks: completedTasks,
		pending_assigned: pendingAssigned,
		completion_rate: completionRate,
	};
}

// ─── Discipline tab data ──────────────────────────────────────────────

/**
 * Sorted unique discipline names (with counts) for the tab bar.
 */
export function uniqueDisciplines(tree: Project[]): DisciplineSummary[] {
	const map = new Map<string, DisciplineSummary>();
	for (const p of tree) {
		for (const d of p.disciplines) {
			if (!map.has(d.name)) {
				map.set(d.name, {
					name: d.name,
					task_count: 0,
					total_assigned: 0,
					total_done: 0,
				});
			}
			const e = map.get(d.name)!;
			e.task_count += d.tasks.length;
			e.total_assigned += d.total_assigned;
			e.total_done += d.total_done;
		}
	}
	return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Filtering ────────────────────────────────────────────────────────

export function filterTree(
	tree: Project[],
	{ search = '', discipline = 'all' }: FilterOptions = {}
): Project[] {
	const q = search.trim().toLowerCase();

	return tree
		.map((p): Project | null => {
			let disciplines = p.disciplines;
			if (discipline !== 'all') {
				disciplines = disciplines.filter(
					(d) => d.name.toLowerCase() === discipline.toLowerCase()
				);
			}
			if (q) {
				disciplines = disciplines
					.map((d) => {
						const tasks = d.tasks.filter(
							(t) =>
								t.name.toLowerCase().includes(q) ||
								t.members.some((m) =>
									(m.user_name || '').toLowerCase().includes(q)
								)
						);
						return { ...d, tasks };
					})
					.filter((d) => d.tasks.length > 0);
			} else {
				disciplines = disciplines.filter((d) => d.tasks.length > 0);
			}
			if (disciplines.length === 0) return null;

			// Recompute rollups for the filtered slice
			const total_assigned = disciplines.reduce(
				(s, d) => s + d.total_assigned,
				0
			);
			const total_done = disciplines.reduce((s, d) => s + d.total_done, 0);
			return {
				...p,
				disciplines,
				total_assigned,
				total_done,
				task_count: disciplines.reduce((s, d) => s + d.tasks.length, 0),
				member_count: disciplines.reduce(
					(s, d) => s + d.tasks.reduce((c, t) => c + t.members.length, 0),
					0
				),
				status: rollupStatus(total_assigned, total_done),
				progress: progressPct(total_assigned, total_done),
			};
		})
		.filter((p): p is Project => p !== null);
}

// ─── Presentation helpers ─────────────────────────────────────────────

/**
 * Status → Tailwind chip classes (per AGENTS.md color scheme).
 * Maps both our internal RollupStatus values and any raw API status string
 * the API may surface at the member level.
 */
export function statusBadgeClass(status: string | undefined | null): string {
	const s = (status || '').toLowerCase();
	if (s === 'completed' || s === 'done') return 'bg-green-100 text-green-700';
	if (s === 'in progress' || s === 'active' || s === 'ongoing')
		return 'bg-blue-100 text-blue-700';
	if (s === 'on hold' || s === 'hold' || s === 'paused')
		return 'bg-orange-100 text-orange-700';
	if (s === 'rejected' || s === 'cancelled' || s === 'overdue')
		return 'bg-red-100 text-red-700';
	if (s === 'pending' || s === 'submitted' || s === 'draft')
		return 'bg-yellow-100 text-yellow-700';
	return 'bg-gray-100 text-gray-700';
}

/** Number formatter with thousands separator (no currency). */
export function fmtNum(n: number | string | null | undefined): string {
	const v = Number(n);
	if (!Number.isFinite(v)) return '0';
	return v.toLocaleString('en-IN');
}

/** Date formatter — '29 Jul 2026' style. */
export function fmtDate(d: string | null | undefined): string {
	if (!d) return '—';
	const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
	if (Number.isNaN(dt.getTime())) return '—';
	return dt.toLocaleDateString('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
}
