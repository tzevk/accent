'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { z } from 'zod';
import {
	ArrowPathIcon,
	CheckCircleIcon,
	PencilSquareIcon,
	PlusIcon,
	XCircleIcon,
} from '@heroicons/react/24/outline';

import ResourceFormModal from '@/components/admin/ResourceFormModal';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCell,
	TableEmpty,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { apiGet, apiPut } from '@/lib/api-client';
import type { TicketDepartment } from '@/lib/tickets/departments';
import type { FormField, ModalMode } from '@/types/admin';

interface RoleOption {
	id: number;
	role_name: string;
	role_code: string | null;
}

interface DepartmentsResponse {
	success: boolean;
	data: TicketDepartment[];
	roles: RoleOption[];
}

export interface TicketDepartmentSettingsProps {
	/** Configuration is super-admin only; the system Administrator role alone does not qualify. */
	isSuperAdmin: boolean;
}

const ENDPOINT = '/api/ticket-departments';

const schema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Department name is required')
		.max(100, 'Department name must be 100 characters or fewer'),
	role_id: z.string(),
	is_active: z.enum(['1', '0']),
});

const createDefaults: Record<string, unknown> = {
	name: '',
	role_id: '',
	is_active: '1',
};

function isActive(department: TicketDepartment): boolean {
	return Boolean(department.is_active);
}

function handlerCount(department: TicketDepartment): number {
	const count = Number(department.handler_count);
	return Number.isFinite(count) && count > 0 ? count : 0;
}

/** Why a department cannot be offered on the new-ticket form, in the order an admin would fix it. */
function blockedReasons(department: TicketDepartment): string[] {
	const reasons: string[] = [];
	if (!isActive(department)) reasons.push('disabled');
	if (department.role_name === null) reasons.push('no responsible role');
	if (handlerCount(department) === 0) reasons.push('no eligible handlers');
	return reasons;
}

export default function TicketDepartmentSettings({
	isSuperAdmin,
}: TicketDepartmentSettingsProps) {
	const queryClient = useQueryClient();

	const { data, isLoading, isFetching, isError, error, refetch } =
		useQuery<DepartmentsResponse>({
			// Distinct leaf from the admin page's all-catalog filter cache: this
			// query keeps the full payload because it also needs the role options.
			queryKey: ['ticket-departments', 'configuration'],
			queryFn: () => apiGet(ENDPOINT, { all: true }),
			enabled: isSuperAdmin,
		});

	const departments = useMemo(() => data?.data ?? [], [data]);
	const roles = useMemo(() => data?.roles ?? [], [data]);

	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });
	/** The department being edited is mapped to a role that is no longer active. */
	const [editingInactiveRole, setEditingInactiveRole] = useState(false);

	const invalidateRoutingCatalog = () => {
		// Ticket rows carry department and role metadata, so they refresh with the catalog.
		void queryClient.invalidateQueries({ queryKey: ['ticket-departments'] });
		void queryClient.invalidateQueries({ queryKey: ['tickets'] });
	};

	const formFields = useMemo<FormField[]>(
		() => [
			{
				name: 'name',
				label: 'Department name',
				type: 'text',
				required: true,
				placeholder: 'e.g. IT',
				hint: 'Shown on the new-ticket form and on the ticket itself.',
				fullWidth: true,
			},
			{
				name: 'role_id',
				label: 'Responsible role',
				type: 'select',
				fullWidth: true,
				placeholder: editingInactiveRole
					? 'Inactive role removed \u2014 assign an active role or leave unconfigured'
					: 'Unconfigured \u2014 not offered on new tickets',
				hint: editingInactiveRole
					? 'The mapped role is no longer active, so it cannot be kept. Assign an active role or save without one. Configure roles and users separately.'
					: 'Role members can handle this department\u2019s tickets. Members with usable account emails receive alerts. Configure roles and users separately.',
				options: roles.map((role) => ({
					value: String(role.id),
					label: role.role_code
						? `${role.role_name} (${role.role_code})`
						: role.role_name,
				})),
			},
			{
				name: 'is_active',
				label: 'Availability',
				type: 'select',
				fullWidth: true,
				hint: 'Disabling stops new tickets, handler access, and pending alerts. Existing tickets and history remain. Reassign open tickets first.',
				options: [
					{ value: '1', label: 'Active' },
					{ value: '0', label: 'Disabled' },
				],
			},
		],
		[roles, editingInactiveRole]
	);

	const toggleMutation = useMutation({
		mutationFn: (department: TicketDepartment) =>
			apiPut(`${ENDPOINT}/${department.id}`, {
				name: department.name,
				// A deactivated mapped role keeps its former id with a null name;
				// resending that id fails the active-role check, so toggle unmaps it.
				role_id: department.role_name === null ? null : department.role_id,
				is_active: !isActive(department),
			}),
		onSuccess: (_result, department) => {
			toast.success(
				isActive(department)
					? `${department.name} disabled`
					: `${department.name} enabled`
			);
			invalidateRoutingCatalog();
		},
		onError: (mutationError) => {
			toast.error(
				mutationError instanceof Error
					? mutationError.message
					: 'Could not update the department'
			);
		},
	});

	if (!isSuperAdmin) return null;

	const openCreate = () => {
		setEditingInactiveRole(false);
		setModalState({ mode: 'create', row: null });
	};

	const openEdit = (department: TicketDepartment) => {
		// role_name is only present while the mapped role is active; a null name
		// means the stored id is stale and must not be seeded into the form.
		const hasActiveRole = department.role_name !== null;
		setEditingInactiveRole(!hasActiveRole && department.role_id !== null);
		setModalState({
			mode: 'edit',
			row: {
				...department,
				role_id: hasActiveRole ? String(department.role_id) : '',
				is_active: isActive(department) ? '1' : '0',
			},
		});
	};

	const closeModal = () => {
		setEditingInactiveRole(false);
		setModalState({ mode: null, row: null });
	};

	const blocked = departments.filter(
		(department) => blockedReasons(department).length > 0
	);

	const errorMessage =
		error instanceof Error ? error.message : 'Something went wrong';

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold text-gray-900">
						Department routing
					</h2>
					<p className="mt-1 max-w-prose text-sm text-gray-600">
						Each new ticket names one responsible department. Every active
						member of that department&rsquo;s role can see and handle its
						tickets, and receives the ticket alert email. Only a department that
						is active, mapped to a role, and has at least one eligible member
						can be selected.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => void refetch()}
						disabled={isFetching}
					>
						<ArrowPathIcon
							className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
						/>
						Refresh
					</Button>
					<Button size="sm" onClick={openCreate}>
						<PlusIcon className="h-4 w-4" />
						Add department
					</Button>
				</div>
			</div>

			{blocked.length > 0 && (
				<div
					className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
					role="status"
				>
					<p className="font-semibold">
						{blocked.length === 1
							? '1 department cannot receive tickets yet'
							: `${blocked.length} departments cannot receive tickets yet`}
					</p>
					<ul className="mt-1 list-disc space-y-0.5 pl-5">
						{blocked.map((department) => (
							<li key={department.id}>
								<span className="font-medium">{department.name}</span>
								{' \u2014 '}
								{blockedReasons(department).join(', ')}
							</li>
						))}
					</ul>
					<p className="mt-1 text-amber-800">
						Map the role and confirm the role has an active member with a usable
						email before employees can pick the department.
					</p>
				</div>
			)}

			{isError ? (
				<div className="px-5 py-10 text-center" role="alert">
					<p className="text-sm text-red-600">
						Could not load departments: {errorMessage}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => void refetch()}
					>
						<ArrowPathIcon className="h-4 w-4" />
						Try again
					</Button>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Department</TableHead>
							<TableHead>Responsible role</TableHead>
							<TableHead>Eligible handlers</TableHead>
							<TableHead>Availability</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableEmpty>Loading departments&hellip;</TableEmpty>
						) : departments.length === 0 ? (
							<TableEmpty>
								No departments yet. Add the first one to start routing tickets.
							</TableEmpty>
						) : (
							departments.map((department) => {
								const active = isActive(department);
								const handlers = handlerCount(department);
								const pending =
									toggleMutation.isPending &&
									toggleMutation.variables?.id === department.id;

								return (
									<TableRow key={department.id}>
										<TableCell className="font-medium">
											{department.name}
										</TableCell>
										<TableCell>
											{department.role_name ? (
												<span className="text-gray-900">
													{department.role_name}
												</span>
											) : department.role_id !== null ? (
												<span className="font-medium text-amber-700">
													Mapped role is inactive &mdash; unavailable for new
													tickets
												</span>
											) : (
												<span className="font-medium text-amber-700">
													Not configured &mdash; unavailable for new tickets
												</span>
											)}
										</TableCell>
										<TableCell>
											{handlers > 0 ? (
												<span className="text-gray-900">
													{handlers} {handlers === 1 ? 'member' : 'members'}
												</span>
											) : (
												<span className="font-medium text-amber-700">
													None &mdash; no alert recipients
												</span>
											)}
										</TableCell>
										<TableCell>
											{active ? (
												<span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
													<CheckCircleIcon className="h-3.5 w-3.5" />
													Active
												</span>
											) : (
												<span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
													<XCircleIcon className="h-3.5 w-3.5" />
													Disabled
												</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											<div className="inline-flex items-center gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openEdit(department)}
												>
													<PencilSquareIcon className="h-4 w-4" />
													Edit
												</Button>
												<Button
													variant="ghost"
													size="sm"
													loading={pending}
													disabled={toggleMutation.isPending}
													onClick={() => toggleMutation.mutate(department)}
												>
													{active ? (
														<XCircleIcon className="h-4 w-4" />
													) : (
														<CheckCircleIcon className="h-4 w-4" />
													)}
													{active ? 'Disable' : 'Enable'}
												</Button>
											</div>
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			)}

			{modalState.mode ? (
				<ResourceFormModal
					mode={modalState.mode}
					row={modalState.row}
					title="Department"
					endpoint={ENDPOINT}
					defaultValues={createDefaults}
					zodSchema={schema}
					formFields={formFields}
					transformSubmit={(values) => ({
						name: String(values.name ?? '').trim(),
						role_id:
							values.role_id === undefined ||
							values.role_id === null ||
							values.role_id === ''
								? null
								: Number(values.role_id),
						is_active: values.is_active === '1',
					})}
					onClose={closeModal}
					onSaved={() => {
						closeModal();
						invalidateRoutingCatalog();
					}}
				/>
			) : null}
		</div>
	);
}
