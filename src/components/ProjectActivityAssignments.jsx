'use client';

import React, { useState, useEffect } from 'react';
import { fetchJSON } from '@/utils/http';
import {
	ClipboardDocumentListIcon,
	PlusIcon,
	CheckIcon,
	XMarkIcon,
	MagnifyingGlassIcon,
	ArrowsUpDownIcon,
} from '@heroicons/react/24/outline';

const todayStr = () => new Date().toISOString().split('T')[0];

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

function SortHeader({ label, sortKey, sort, onSort }) {
	const isActive = sort.key === sortKey;
	const arrow = !isActive ? '' : sort.dir === 'asc' ? '▲' : '▼';
	return (
		<th
			className="text-center py-1 px-2 font-bold text-[#64126D] uppercase tracking-wide text-[10px] leading-tight select-none"
			aria-sort={
				isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
			}
		>
			<button
				type="button"
				onClick={() => onSort(sortKey)}
				className={`inline-flex items-center justify-center gap-1 w-full ${
					isActive ? 'text-[#64126D]' : 'text-[#64126D]/80'
				} hover:text-[#7F2487] focus:outline-none focus:ring-1 focus:ring-purple-300 rounded`}
				title={`Sort by ${label}`}
			>
				<span>{label}</span>
				{isActive ? (
					<span className="text-[8px]">{arrow}</span>
				) : (
					<ArrowsUpDownIcon className="w-3 h-3 opacity-50" />
				)}
			</button>
		</th>
	);
}

export default function ProjectActivityAssignments({ userId, preloadedData }) {
	const [assignments, setAssignments] = useState([]);
	const [emptyProjects, setEmptyProjects] = useState([]);
	const [loading, setLoading] = useState(true);
	const [hasAccess, setHasAccess] = useState(true);
	const [saving, setSaving] = useState(false);
	const [disciplineOptions, setDisciplineOptions] = useState([]);

	const [addingProjectId, setAddingProjectId] = useState(null);
	const [addForm, setAddForm] = useState({
		project_id: '',
		discipline_id: '',
		activity_id: '',
		sub_activity_id: '',
		manhours_assigned: '',
		quantity: '',
		due_date: todayStr(),
		status: 'Not Started',
	});

	// Search / filter / sort state
	const [search, setSearch] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');
	const [sort, setSort] = useState({ key: 'due_date', dir: 'desc' });

	const toggleSort = (key) => {
		setSort((prev) => {
			if (prev.key !== key) return { key, dir: 'asc' };
			if (prev.dir === 'asc') return { key, dir: 'desc' };
			return { key: null, dir: 'asc' };
		});
	};

	// Use preloaded data if available (from parent dashboard)
	useEffect(() => {
		if (preloadedData) {
			setAssignments(preloadedData.assignments || []);
			setEmptyProjects(preloadedData.emptyProjects || []);
			setLoading(false);
		}
	}, [preloadedData]);

	// Only fetch if no preloaded data provided
	useEffect(() => {
		if (!userId || preloadedData) return;
		loadAssignments();
	}, [userId, preloadedData]);

	// Load discipline/activity/sub-activity dropdown options
	useEffect(() => {
		if (!userId) return;
		(async () => {
			try {
				const res = await fetchJSON('/api/activity-master/options');
				if (res?.success) setDisciplineOptions(res.data || []);
			} catch (err) {
				console.error('Failed to load activity options:', err);
			}
		})();
	}, [userId]);

	const loadAssignments = async () => {
		try {
			const response = await fetch(`/api/users/${userId}/activity-assignments`);
			if (response.status === 401 || response.status === 403) {
				setHasAccess(false);
				setLoading(false);
				return;
			}
			const res = await response.json();
			if (res.success) {
				setAssignments(res.data.assignments || []);
				setEmptyProjects(res.data.emptyProjects || []);
			} else {
				setHasAccess(false);
			}
		} catch (err) {
			console.error('Failed to load activity assignments:', err);
			setHasAccess(false);
		} finally {
			setLoading(false);
		}
	};

	const formatShortDate = (dateStr) => {
		if (!dateStr) return '–';
		const d = new Date(dateStr + 'T00:00:00');
		return d.toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		});
	};

	// ── Open the inline add row ──
	const openAddRow = () => {
		setAddingProjectId('new');
		setAddForm({
			project_id: '',
			discipline_id: '',
			activity_id: '',
			sub_activity_id: '',
			manhours_assigned: '',
			quantity: '',
			due_date: todayStr(),
			status: 'Not Started',
		});
	};

	const closeAddRow = () => {
		if (saving) return;
		setAddingProjectId(null);
	};

	const selectedDiscipline = disciplineOptions.find(
		(d) => d.id === addForm.discipline_id
	);
	const selectedActivity = selectedDiscipline?.activities?.find(
		(a) => a.id === addForm.activity_id
	);

	const submitAdd = async () => {
		const discipline = disciplineOptions.find(
			(d) => d.id === addForm.discipline_id
		);
		const activity = discipline?.activities?.find(
			(a) => a.id === addForm.activity_id
		);
		const subActivity = activity?.subActivities?.find(
			(s) => s.id === addForm.sub_activity_id
		);

		if (!addForm.project_id) {
			alert('Please select a project.');
			return;
		}
		if (!discipline || !activity) {
			alert('Please select a Discipline and Activity.');
			return;
		}

		setSaving(true);
		try {
			const res = await fetchJSON(`/api/users/${userId}/activity-assignments`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					project_id: addForm.project_id,
					discipline_name: discipline.function_name,
					activity_name: activity.activity_name,
					sub_activity_name: subActivity?.name || '',
					default_manhours: subActivity?.default_manhours || 0,
					manhours_assigned: addForm.manhours_assigned,
					qty_completed: addForm.quantity,
					due_date: addForm.due_date || null,
					status: addForm.status,
				}),
			});
			if (res?.success) {
				setAddingProjectId(null);
				await loadAssignments();
			} else {
				alert(res?.error || 'Failed to add activity');
			}
		} catch (err) {
			console.error('Failed to add activity:', err);
			alert('Failed to add activity');
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="bg-white rounded-xl shadow-md border-2 border-purple-200 p-6 mb-6">
				<div className="text-center text-[#4A1254] text-sm">
					Loading assignments...
				</div>
			</div>
		);
	}

	if (!hasAccess) return null;

	// Group assignments by project
	const projectGroups = {};
	const projectOrder = [];
	assignments.forEach((a) => {
		const pid = a.project_id || 'unknown';
		if (!projectGroups[pid]) {
			projectGroups[pid] = {
				project_code: a.project_code,
				project_name: a.project_name,
				activities: [],
			};
			projectOrder.push(pid);
		}
		projectGroups[pid].activities.push(a);
	});
	emptyProjects.forEach((p) => {
		const pid = p.project_id || 'unknown';
		if (!projectGroups[pid]) {
			projectGroups[pid] = {
				project_code: p.project_code,
				project_name: p.project_name,
				activities: [],
			};
			projectOrder.push(pid);
		}
	});

	const COLS = 10; // + actions column

	// Build the list of projects the user can add activities to: any project they
	// already have assignments on, plus any team project with no activities yet.
	// The server-side PATCH endpoint enforces userId, so this is a UI filter only.
	const assignableProjects = (() => {
		const seen = new Set();
		const list = [];
		const push = (p) => {
			if (!p) return;
			const pid = String(p.project_id);
			if (seen.has(pid)) return;
			seen.add(pid);
			list.push({
				project_id: pid,
				project_code: p.project_code,
				project_name: p.project_name,
			});
		};
		assignments.forEach(push);
		emptyProjects.forEach(push);
		return list;
	})();

	// Distinct status values present in the data, for the filter dropdown.
	const statusOptions = (() => {
		const set = new Set();
		assignments.forEach((a) => {
			if (a.status) set.add(a.status);
		});
		return Array.from(set).sort();
	})();

	// Flatten assignments into a single list, preserving per-project grouping order.
	const baseRows = projectOrder.flatMap((pid) => {
		const group = projectGroups[pid];
		return group.activities.map((activity) => ({
			project_code: group.project_code,
			project_name: group.project_name,
			activity,
		}));
	});

	// Apply search, status filter, and sort.
	const q = search.trim().toLowerCase();
	let flatRows = baseRows;
	if (q) {
		flatRows = flatRows.filter((r) => {
			const a = r.activity;
			return (
				(r.project_code || '').toLowerCase().includes(q) ||
				(r.project_name || '').toLowerCase().includes(q) ||
				(a.discipline || '').toLowerCase().includes(q) ||
				(a.activity_name || '').toLowerCase().includes(q) ||
				(a.sub_activity_name || '').toLowerCase().includes(q)
			);
		});
	}
	if (statusFilter !== 'all') {
		flatRows = flatRows.filter(
			(r) => (r.activity.status || 'Not Started') === statusFilter
		);
	}
	if (sort.key) {
		const dir = sort.dir === 'asc' ? 1 : -1;
		const get = (r) => {
			switch (sort.key) {
				case 'project_code':
					return (r.project_code || '').toLowerCase();
				case 'discipline':
					return (r.activity.discipline || '').toLowerCase();
				case 'activity_name':
					return (r.activity.activity_name || '').toLowerCase();
				case 'sub_activity_name':
					return (r.activity.sub_activity_name || '').toLowerCase();
				case 'default_manhours':
					return parseFloat(r.activity.default_manhours) || 0;
				case 'planned_hours':
					return parseFloat(r.activity.planned_hours) || 0;
				case 'qty_completed':
					return parseFloat(r.activity.qty_completed) || 0;
				case 'due_date':
					return r.activity.due_date || '';
				case 'status':
					return (r.activity.status || 'Not Started').toLowerCase();
				default:
					return '';
			}
		};
		flatRows = [...flatRows].sort((a, b) => {
			const va = get(a);
			const vb = get(b);
			if (va < vb) return -1 * dir;
			if (va > vb) return 1 * dir;
			return 0;
		});
	}

	const totalManhours = flatRows.reduce(
		(sum, r) => sum + (parseFloat(r.activity.planned_hours) || 0),
		0
	);
	const isAdding = addingProjectId !== null;
	const hasAnyData = projectOrder.length > 0;

	return (
		<div className="bg-white rounded-xl shadow-lg border-2 border-purple-200 mb-6 ring-1 ring-purple-100">
			{/* Header */}
			<div className="px-3 py-2 border-b-2 border-purple-100 bg-gradient-to-r from-purple-50 to-white flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center shadow-sm">
						<ClipboardDocumentListIcon className="w-4 h-4 text-purple-600" />
					</div>
					<h3 className="text-sm font-bold text-[#4A1254]">
						My Project Activities
					</h3>
				</div>
				{hasAnyData && (
					<button
						onClick={openAddRow}
						disabled={isAdding}
						className="flex items-center gap-1 px-2 py-1 rounded bg-[#64126D] text-white hover:bg-[#7F2487] transition-colors text-xs font-semibold disabled:opacity-50"
						title="Add a new activity"
					>
						<PlusIcon className="w-3.5 h-3.5" />
						Add
					</button>
				)}
			</div>

			{/* Search / filter toolbar */}
			{hasAnyData && (
				<div className="px-3 py-2 border-b border-purple-100 bg-white/60 flex flex-wrap items-center gap-2">
					<div className="relative flex-1 min-w-[180px] max-w-xs">
						<MagnifyingGlassIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search code, project, activity…"
							className="w-full pl-7 pr-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
						/>
					</div>
					<select
						value={statusFilter}
						onChange={(e) => setStatusFilter(e.target.value)}
						className="px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
						title="Filter by status"
					>
						<option value="all">All statuses</option>
						{statusOptions.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
					{(search || statusFilter !== 'all' || sort.key) && (
						<button
							onClick={() => {
								setSearch('');
								setStatusFilter('all');
								setSort({ key: 'due_date', dir: 'desc' });
							}}
							className="px-2 py-1 text-xs font-semibold text-[#64126D] hover:bg-purple-50 rounded"
						>
							Clear
						</button>
					)}
					<span className="ml-auto text-[11px] text-gray-500">
						{flatRows.length}
						{flatRows.length !== baseRows.length
							? ` of ${baseRows.length}`
							: ''}{' '}
						{flatRows.length === 1 ? 'activity' : 'activities'}
					</span>
				</div>
			)}

			{!hasAnyData ? (
				<div className="text-center py-10 text-[#4A1254]">
					<ClipboardDocumentListIcon className="w-14 h-14 mx-auto mb-3 opacity-50" />
					<p className="text-sm">No projects assigned to you</p>
				</div>
			) : (
				<div>
					<table className="w-full text-sm border-collapse table-fixed">
						<colgroup>
							<col className="w-[13%]" />
							<col className="w-[12%]" />
							<col className="w-[16%]" />
							<col className="w-[16%]" />
							<col className="w-[7%]" />
							<col className="w-[7%]" />
							<col className="w-[6%]" />
							<col className="w-[9%]" />
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
								<th className="text-center py-1 px-2 font-bold text-[#64126D] uppercase tracking-wide text-[10px] leading-tight select-none">
									Actions
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-300">
							{flatRows.length === 0 && !isAdding && (
								<tr>
									<td
										colSpan={COLS}
										className="py-6 px-4 text-center text-sm text-[#4A1254]"
									>
										{baseRows.length === 0 ? (
											<>
												No activities yet. Click{' '}
												<span className="font-semibold">Add</span> above to log
												your first activity.
											</>
										) : (
											<>No activities match the current search or filter.</>
										)}
									</td>
								</tr>
							)}

							{flatRows.map(({ project_code, activity }) => {
								const rowKey = `${activity.project_id}-${activity.activity_id}`;

								return (
									<tr
										key={rowKey}
										className="hover:bg-purple-50/40 transition-colors divide-x divide-gray-300"
									>
										<td className="py-1 px-2 text-center align-middle">
											<span
												className="font-mono text-[10px] text-[#4A1254] block break-words leading-tight"
												title={project_code || '–'}
											>
												{project_code || '–'}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span
												className="text-[#4A1254] block break-words leading-tight"
												title={activity.discipline}
											>
												{activity.discipline}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span
												className="font-semibold text-[#4A1254] block break-words leading-tight"
												title={activity.activity_name}
											>
												{activity.activity_name}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span
												className="text-[#4A1254] block break-words leading-tight"
												title={activity.sub_activity_name || '–'}
											>
												{activity.sub_activity_name || '–'}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle text-[#4A1254]">
											{activity.default_manhours || 0}
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span className="text-[#4A1254]">
												{activity.planned_hours || 0}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle text-[#4A1254]">
											{activity.qty_completed || 0}
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span className="text-[#4A1254]">
												{formatShortDate(activity.due_date)}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle">
											<span
												className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadge(
													activity.status
												)}`}
											>
												{activity.status || 'Not Started'}
											</span>
										</td>
										<td className="py-1 px-2 text-center align-middle" />
									</tr>
								);
							})}

							{/* Inline Add Row */}
							{isAdding && (
								<tr className="bg-purple-50/50 divide-x divide-gray-300">
									<td className="py-1 px-2 text-center align-middle">
										<select
											value={addForm.project_id}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													project_id: e.target.value,
												}))
											}
											className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
											title="Select a project you are assigned to"
										>
											<option value="">Select project…</option>
											{assignableProjects.map((p) => (
												<option key={p.project_id} value={p.project_id}>
													{p.project_code
														? `${p.project_code} – ${p.project_name}`
														: p.project_name}
												</option>
											))}
										</select>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<select
											value={addForm.discipline_id}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													discipline_id: e.target.value,
													activity_id: '',
													sub_activity_id: '',
												}))
											}
											className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
										>
											<option value="">Select</option>
											{disciplineOptions.map((d) => (
												<option key={d.id} value={d.id}>
													{d.function_name}
												</option>
											))}
										</select>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<select
											value={addForm.activity_id}
											disabled={!selectedDiscipline}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													activity_id: e.target.value,
													sub_activity_id: '',
												}))
											}
											className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100"
										>
											<option value="">Select</option>
											{(selectedDiscipline?.activities || []).map((a) => (
												<option key={a.id} value={a.id}>
													{a.activity_name}
												</option>
											))}
										</select>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<select
											value={addForm.sub_activity_id}
											disabled={!selectedActivity?.subActivities?.length}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													sub_activity_id: e.target.value,
												}))
											}
											className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none disabled:bg-gray-100"
										>
											<option value="">Select</option>
											{(selectedActivity?.subActivities || []).map((s) => (
												<option key={s.id} value={s.id}>
													{s.name}
												</option>
											))}
										</select>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<input
											type="text"
											readOnly
											value={
												selectedActivity?.subActivities?.find(
													(s) => s.id === addForm.sub_activity_id
												)?.default_manhours || '–'
											}
											className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded text-center bg-gray-100 text-gray-500 focus:outline-none"
										/>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<input
											type="number"
											min="0"
											step="0.5"
											value={addForm.manhours_assigned}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													manhours_assigned: e.target.value,
												}))
											}
											placeholder="Hrs"
											className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
										/>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<input
											type="number"
											min="0"
											step="1"
											value={addForm.quantity}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													quantity: e.target.value,
												}))
											}
											placeholder="Qty"
											className="w-16 px-1.5 py-0.5 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
										/>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<input
											type="date"
											value={addForm.due_date}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													due_date: e.target.value,
												}))
											}
											className="px-2 py-1 text-xs border border-gray-300 rounded text-center focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
										/>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<select
											value={addForm.status}
											onChange={(e) =>
												setAddForm((p) => ({
													...p,
													status: e.target.value,
												}))
											}
											className="w-full px-0.5 py-0.5 text-[10px] border border-gray-300 rounded focus:border-purple-500 focus:ring-1 focus:ring-purple-200 focus:outline-none"
											title="Status"
										>
											<option value="Not Started">Not Started</option>
											<option value="In Progress">In Progress</option>
											<option value="On Hold">On Hold</option>
											<option value="Completed">Completed</option>
											<option value="Cancelled">Cancelled</option>
										</select>
									</td>
									<td className="py-1 px-2 text-center align-middle">
										<div className="flex items-center justify-center gap-1">
											<button
												onClick={() => submitAdd()}
												disabled={saving}
												className="p-1 rounded bg-[#64126D] text-white hover:bg-[#7F2487] transition-colors disabled:opacity-50"
												title="Save"
											>
												<CheckIcon className="w-3.5 h-3.5" />
											</button>
											<button
												onClick={closeAddRow}
												disabled={saving}
												className="p-1 rounded bg-white text-[#4A1254] border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
												title="Cancel"
											>
												<XMarkIcon className="w-3.5 h-3.5" />
											</button>
										</div>
									</td>
								</tr>
							)}

							{flatRows.length > 0 && (
								<tr className="bg-[#64126D]/10 divide-x divide-gray-300 font-bold">
									<td
										colSpan={5}
										className="py-1 px-2 text-right text-[#4A1254] uppercase text-xs tracking-wide"
									>
										{baseRows.length !== flatRows.length
											? 'Total (filtered)'
											: 'Total Manhours'}
									</td>
									<td className="py-1 px-2 text-center text-[#4A1254]">
										{totalManhours}
									</td>
									<td colSpan={4}></td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
