'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';
import { WorkPeriodFields } from '@/components/WorkPeriodFields';

type Id = string | number;

interface PeriodFieldsValue {
	start: string;
	end: string;
	quantity: string;
	dateCompleted: string;
	remarks: string;
}

interface ManagerAssignment {
	id: Id;
	employeeName: string;
	activityName: string;
	subActivityName: string | null;
}

interface WorkPeriodRow {
	id: Id;
	assignmentId: Id;
	projectId: Id;
	activityId: Id;
	employeeId: Id;
	userId: Id;
	projectCode: string;
	projectName: string;
	discipline: string;
	activityName: string;
	subActivityName: string | null;
	employeeName: string;
	start: string;
	end: string;
	quantity: string | number;
	dateCompleted: string;
	remarks: string;
	durationSeconds: number;
	weekSeconds: number;
	weekQuantity: string | number;
	editable: boolean;
}

interface ProjectWorkPeriodsData {
	canLog: boolean;
	today: string;
	weekStart: string;
	periods: WorkPeriodRow[];
	assignments?: ManagerAssignment[];
}

interface WorkPeriodsResponse {
	success: boolean;
	data: ProjectWorkPeriodsData;
}

interface MutationResponse {
	success: boolean;
	data: { id: Id };
}

type PeriodMutation =
	| {
			kind: 'create';
			assignmentId: Id;
			value: PeriodFieldsValue;
	  }
	| {
			kind: 'update';
			period: WorkPeriodRow;
			value: PeriodFieldsValue;
	  }
	| {
			kind: 'delete';
			period: WorkPeriodRow;
	  };

const EMPTY_FIELDS: PeriodFieldsValue = {
	start: '',
	end: '',
	quantity: '',
	dateCompleted: '',
	remarks: '',
};

function errorMessage(error: unknown) {
	return error instanceof Error
		? error.message
		: 'The work period could not be saved. Please try again.';
}

function formatDuration(seconds: number) {
	const totalMinutes = Math.round(seconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) return `${minutes}m`;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function assignmentLabel(assignment: ManagerAssignment) {
	const activity = assignment.subActivityName
		? `${assignment.activityName} / ${assignment.subActivityName}`
		: assignment.activityName;
	return `${assignment.employeeName} — ${activity}`;
}

function fieldsFromPeriod(period: WorkPeriodRow): PeriodFieldsValue {
	return {
		start: period.start,
		end: period.end,
		quantity: String(period.quantity ?? ''),
		dateCompleted: period.dateCompleted,
		remarks: period.remarks,
	};
}

/**
 * Manager corrections live beside Project Activities but use their own
 * requests. The enclosing project form only owns estimates and assignments.
 */
export default function ProjectWorkPeriods({ projectId }: { projectId: Id }) {
	const headingId = useId();
	const queryClient = useQueryClient();
	const queryKey = ['project-work-periods', String(projectId)] as const;
	const [newAssignmentId, setNewAssignmentId] = useState<Id | ''>('');
	const [newFields, setNewFields] = useState<PeriodFieldsValue>(EMPTY_FIELDS);
	const [editing, setEditing] = useState<WorkPeriodRow | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<WorkPeriodRow | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const periodsQuery = useQuery({
		queryKey,
		enabled: projectId !== '',
		queryFn: async (): Promise<ProjectWorkPeriodsData> => {
			const response = await apiGet<WorkPeriodsResponse>('/api/work-periods', {
				projectId,
			});
			if (!response?.success || !response.data) {
				throw new Error('Work periods could not be loaded for this project.');
			}
			return response.data;
		},
	});

	const saveMutation = useMutation({
		mutationFn: async (input: PeriodMutation): Promise<MutationResponse> => {
			let response: MutationResponse;
			if (input.kind === 'create') {
				response = await apiPost<MutationResponse>('/api/work-periods', {
					manager: true,
					projectId,
					assignmentId: input.assignmentId,
					...input.value,
				});
			} else if (input.kind === 'update') {
				response = await apiPut<MutationResponse>('/api/work-periods', {
					manager: true,
					projectId,
					id: input.period.id,
					...input.value,
				});
			} else {
				response = await apiDelete<MutationResponse>('/api/work-periods', {
					manager: true,
					projectId,
					id: input.period.id,
				});
			}
			if (!response?.success) {
				throw new Error('The work period change was not saved.');
			}
			return response;
		},
		onSuccess: async (_response, input) => {
			await queryClient.invalidateQueries({ queryKey });
			setDeleteTarget(null);
			setNotice(
				input.kind === 'create'
					? 'Work period added.'
					: input.kind === 'update'
						? 'Work period updated.'
						: 'Work period deleted.'
			);
			if (input.kind === 'create') {
				setNewFields(EMPTY_FIELDS);
			} else if (input.kind === 'update') {
				setEditing(null);
			}
		},
	});

	const assignments = periodsQuery.data?.assignments ?? [];
	const periods = periodsQuery.data?.periods ?? [];
	const selectedAssignmentId =
		newAssignmentId || (assignments.length > 0 ? assignments[0].id : '');
	const activeFields = editing ? fieldsFromPeriod(editing) : newFields;
	const busy = saveMutation.isPending;
	const fieldsDisabled = busy || (!editing && selectedAssignmentId === '');

	function updateActiveFields(value: PeriodFieldsValue) {
		saveMutation.reset();
		setNotice(null);
		if (editing) {
			setEditing({ ...editing, ...value });
		} else {
			setNewFields(value);
		}
	}

	function beginEdit(period: WorkPeriodRow) {
		if (!period.editable || busy) return;
		saveMutation.reset();
		setNotice(null);
		setDeleteTarget(null);
		setEditing(period);
	}

	function submitFields() {
		if (busy) return;
		saveMutation.reset();
		setNotice(null);
		setDeleteTarget(null);
		if (editing) {
			saveMutation.mutate({
				kind: 'update',
				period: editing,
				value: fieldsFromPeriod(editing),
			});
			return;
		}
		if (selectedAssignmentId === '') return;
		saveMutation.mutate({
			kind: 'create',
			assignmentId: selectedAssignmentId,
			value: newFields,
		});
	}

	function confirmDelete() {
		if (!deleteTarget || busy) return;
		saveMutation.reset();
		setNotice(null);
		saveMutation.mutate({ kind: 'delete', period: deleteTarget });
	}

	function keepProjectEnterFromSubmitting(event: KeyboardEvent<HTMLElement>) {
		if (
			event.key === 'Enter' &&
			(event.target instanceof HTMLInputElement ||
				event.target instanceof HTMLSelectElement)
		) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	const pendingLabel =
		saveMutation.variables?.kind === 'delete'
			? 'Deleting work period…'
			: 'Saving work period…';

	return (
		<section
			aria-labelledby={headingId}
			onKeyDown={keepProjectEnterFromSubmitting}
			className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id={headingId} className="text-base font-semibold text-gray-900">
						Work periods
					</h2>
					<p className="mt-1 text-sm text-gray-600">
						Add missing older work or correct a recorded period. Times are India
						Standard Time (IST). Project estimates are not changed.
					</p>
				</div>
				{busy && (
					<p role="status" className="text-sm font-medium text-blue-700">
						{pendingLabel}
					</p>
				)}
			</div>

			{notice && (
				<p
					role="status"
					className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
				>
					{notice}
				</p>
			)}
			{saveMutation.isError && (
				<p
					role="alert"
					className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
				>
					{errorMessage(saveMutation.error)}
				</p>
			)}

			<div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
				<h3 className="text-sm font-semibold text-gray-900">
					{editing ? 'Edit work period' : 'Add work period'}
				</h3>
				{editing ? (
					<p className="mt-1 text-sm text-gray-700">
						{editing.employeeName} — {editing.activityName}
						{editing.subActivityName ? ` / ${editing.subActivityName}` : ''}
					</p>
				) : (
					<div className="mt-3 max-w-2xl">
						<label
							htmlFor={`${headingId}-assignment`}
							className="block text-sm font-medium text-gray-700"
						>
							Employee and activity
						</label>
						<select
							id={`${headingId}-assignment`}
							value={selectedAssignmentId}
							onChange={(event) => {
								const assignment = assignments.find(
									(candidate) => String(candidate.id) === event.target.value
								);
								setNewAssignmentId(assignment?.id ?? event.target.value);
								saveMutation.reset();
								setNotice(null);
							}}
							disabled={busy || assignments.length === 0}
							required
							className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
						>
							{assignments.length === 0 ? (
								<option value="">No eligible assignments</option>
							) : (
								assignments.map((assignment) => (
									<option key={assignment.id} value={assignment.id}>
										{assignmentLabel(assignment)}
									</option>
								))
							)}
						</select>
						{assignments.length === 0 && !periodsQuery.isPending && (
							<p className="mt-2 text-sm text-gray-600">
								There are no eligible Project Activity assignments for this
								project.
							</p>
						)}
					</div>
				)}

				<div className="mt-4">
					<WorkPeriodFields
						value={activeFields}
						onChange={updateActiveFields}
						disabled={fieldsDisabled}
					/>
				</div>
				<div className="mt-4 flex flex-wrap gap-3">
					<button
						type="button"
						onClick={submitFields}
						disabled={busy || (!editing && selectedAssignmentId === '')}
						className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300"
					>
						{busy && !editing
							? 'Adding work period…'
							: editing
								? 'Save changes'
								: 'Add work period'}
					</button>
					{editing && (
						<button
							type="button"
							onClick={() => {
								saveMutation.reset();
								setNotice(null);
								setEditing(null);
							}}
							disabled={busy}
							className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
						>
							Cancel
						</button>
					)}
				</div>
			</div>

			{periodsQuery.isPending && (
				<p role="status" className="mt-5 text-sm text-gray-600">
					Loading work periods…
				</p>
			)}
			{periodsQuery.isError && (
				<div role="alert" className="mt-5 rounded-lg bg-red-50 p-4">
					<p className="text-sm text-red-800">
						{errorMessage(periodsQuery.error)}
					</p>
					<button
						type="button"
						onClick={() => void periodsQuery.refetch()}
						className="mt-3 min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
					>
						Try again
					</button>
				</div>
			)}
			{periodsQuery.isFetching && !periodsQuery.isPending && !busy && (
				<p role="status" className="mt-5 text-sm text-gray-600">
					Refreshing work periods…
				</p>
			)}

			{!periodsQuery.isPending &&
				periods.length === 0 &&
				!periodsQuery.isError && (
					<p className="mt-5 text-sm text-gray-600">
						No work periods recorded for this project.
					</p>
				)}
			{periods.length > 0 && (
				<div className="mt-5 overflow-x-auto">
					<table className="w-full min-w-[62rem] border-collapse text-left text-sm">
						<caption className="sr-only">Recorded work periods</caption>
						<thead>
							<tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
								<th scope="col" className="px-3 py-2 font-semibold">
									Employee / activity
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Start (IST)
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									End (IST)
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Duration
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Quantity
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Date completed
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Remarks
								</th>
								<th scope="col" className="px-3 py-2 font-semibold">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{periods.map((period) => (
								<tr
									key={period.id}
									className="border-b border-gray-100 align-top"
								>
									<th
										scope="row"
										className="px-3 py-3 font-medium text-gray-900"
									>
										<span className="block">{period.employeeName}</span>
										<span className="block text-xs font-normal text-gray-600">
											{period.activityName}
											{period.subActivityName
												? ` / ${period.subActivityName}`
												: ''}
										</span>
									</th>
									<td className="whitespace-nowrap px-3 py-3 text-gray-700">
										{period.start}
									</td>
									<td className="whitespace-nowrap px-3 py-3 text-gray-700">
										{period.end}
									</td>
									<td className="whitespace-nowrap px-3 py-3 text-gray-700">
										{formatDuration(period.durationSeconds)}
									</td>
									<td className="px-3 py-3 text-gray-700">{period.quantity}</td>
									<td className="whitespace-nowrap px-3 py-3 text-gray-700">
										{period.dateCompleted}
									</td>
									<td className="max-w-xs break-words px-3 py-3 text-gray-700">
										{period.remarks}
									</td>
									<td className="px-3 py-3">
										{period.editable ? (
											<div className="flex min-w-40 flex-wrap gap-2">
												<button
													type="button"
													onClick={() => beginEdit(period)}
													disabled={busy}
													aria-label={`Edit work period for ${period.employeeName} starting ${period.start}`}
													className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
												>
													Edit
												</button>
												<button
													type="button"
													onClick={() => {
														if (busy) return;
														saveMutation.reset();
														setNotice(null);
														setDeleteTarget(period);
													}}
													disabled={busy}
													aria-label={`Delete work period for ${period.employeeName} starting ${period.start}`}
													className="min-h-11 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
												>
													Delete
												</button>
											</div>
										) : (
											<span className="text-xs text-gray-500">Read only</span>
										)}
										{deleteTarget?.id === period.id && (
											<div
												role="group"
												aria-label={`Delete work period for ${period.employeeName} starting ${period.start}`}
												className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
											>
												<p className="text-sm text-red-900">
													Delete this work period permanently? The Project
													Activity and its other periods are kept.
												</p>
												<div className="mt-3 flex flex-wrap gap-2">
													<button
														type="button"
														onClick={confirmDelete}
														disabled={busy}
														className="min-h-11 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
													>
														{busy ? 'Deleting work period…' : 'Confirm delete'}
													</button>
													<button
														type="button"
														onClick={() => {
															setDeleteTarget(null);
															saveMutation.reset();
														}}
														disabled={busy}
														className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
													>
														Cancel
													</button>
												</div>
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
