'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	PencilIcon,
	ShieldCheckIcon,
} from '@heroicons/react/24/outline';

import Navbar from '@/components/Navbar';
import RolePermissionDialog from '@/components/permissions/RolePermissionDialog';
import { apiGet, apiPut } from '@/lib/api-client';
import { useSessionRBAC } from '@/utils/client-rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/rbac';

type RoleRow = {
	id: number;
	role_code: string;
	role_name: string;
	role_hierarchy?: number | null;
	department?: string | null;
	description?: string | null;
	status?: string | null;
	permissions?: unknown;
};

function permissionCount(value: unknown): number {
	if (Array.isArray(value)) return value.length;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed.length : 0;
		} catch {
			return value.split(',').filter((item) => item.trim()).length;
		}
	}
	return 0;
}

export default function RolePermissionsPage() {
	const queryClient = useQueryClient();
	const { loading: rbacLoading, can, user } = useSessionRBAC();
	const canRead =
		!rbacLoading &&
		(Boolean(user?.is_super_admin) ||
			can(RESOURCES.SETTINGS, PERMISSIONS.READ));
	const canUpdate =
		!rbacLoading &&
		(Boolean(user?.is_super_admin) ||
			can(RESOURCES.SETTINGS, PERMISSIONS.UPDATE));

	const [search, setSearch] = useState('');
	const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [notice, setNotice] = useState('');

	const { data, error, isPending } = useQuery({
		queryKey: ['roles-master'],
		enabled: canRead,
		queryFn: () =>
			apiGet<{ success: boolean; data: RoleRow[] }>('/api/roles-master'),
	});

	const roles = ((data?.data ?? []) as RoleRow[]).filter((role) => {
		const query = search.trim().toLowerCase();
		if (!query) return true;
		return (
			role.role_name.toLowerCase().includes(query) ||
			role.role_code.toLowerCase().includes(query) ||
			(role.department ?? '').toLowerCase().includes(query)
		);
	});

	const roleCount = useMemo(
		() => ((data?.data ?? []) as RoleRow[]).length,
		[data]
	);

	const handleSave = async (permissions: string[]) => {
		if (!editingRole) return;
		setSaving(true);
		setSaveError(null);
		setNotice('');
		try {
			const result = await apiPut<{
				success: boolean;
				error?: string;
				data?: { permissions?: string[] };
			}>('/api/roles-master', {
				id: editingRole.id,
				permissions,
			});
			if (!result?.success) {
				throw new Error(result?.error || 'Failed to update role permissions');
			}

			queryClient.setQueryData(['roles-master'], (current: unknown) => {
				const typed = current as { data?: RoleRow[] } | undefined;
				if (!typed?.data) return current;
				return {
					...typed,
					data: typed.data.map((role) =>
						role.id === editingRole.id
							? {
									...role,
									permissions: result.data?.permissions ?? permissions,
								}
							: role
					),
				};
			});
			setEditingRole(null);
			setNotice(
				`Permissions updated for ${editingRole.role_name}. They apply to every user with this role.`
			);
		} catch (err) {
			setSaveError(
				err instanceof Error ? err.message : 'Failed to update role permissions'
			);
		} finally {
			setSaving(false);
		}
	};

	if (rbacLoading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<main className="px-4 pb-12 pt-6 sm:px-6 lg:px-8">
					<p className="text-sm text-gray-600">Loading role permissions…</p>
				</main>
			</div>
		);
	}

	if (!canRead) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<main className="px-4 pb-12 pt-6 sm:px-6 lg:px-8">
					<div className="rounded-xl border border-red-200 bg-red-50 p-6">
						<h1 className="text-lg font-semibold text-gray-900">
							Access denied
						</h1>
						<p className="mt-1 text-sm text-gray-700">
							You need settings read permission to view role permissions.
						</p>
					</div>
				</main>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<main className="px-4 pb-12 pt-6 sm:px-6 lg:px-8 xl:px-10">
				<header className="mb-6">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 text-[#64126D] ring-1 ring-inset ring-purple-100">
							<ShieldCheckIcon className="h-5 w-5" aria-hidden="true" />
						</div>
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Edit Role Permissions
							</h1>
							<p className="mt-1 text-sm text-gray-600">
								Manage the flat permissions granted to every user with a role.
							</p>
						</div>
					</div>
				</header>

				{notice && (
					<div
						role="status"
						className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800"
					>
						{notice}
					</div>
				)}

				{error && (
					<div
						role="alert"
						className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
					>
						{error instanceof Error
							? error.message
							: 'Failed to load role permissions.'}
					</div>
				)}

				<section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
					<div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-sm font-semibold text-gray-900">
								Roles ({roleCount})
							</h2>
							<p className="mt-0.5 text-xs text-gray-500">
								Role permissions are additive with user-specific permissions.
							</p>
						</div>
						<label htmlFor="role-search" className="sr-only">
							Search roles
						</label>
						<div className="relative w-full sm:w-72">
							<MagnifyingGlassIcon
								className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
								aria-hidden="true"
							/>
							<input
								id="role-search"
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder="Search role name, code, or department…"
								className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
							/>
						</div>
					</div>

					{isPending ? (
						<p className="px-4 py-10 text-center text-sm text-gray-500">
							Loading roles…
						</p>
					) : roles.length === 0 ? (
						<p className="px-4 py-10 text-center text-sm text-gray-500">
							No roles match this search.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
									<tr>
										<th className="px-4 py-3">Role</th>
										<th className="px-4 py-3">Code</th>
										<th className="px-4 py-3">Department</th>
										<th className="px-4 py-3">Permissions</th>
										<th className="px-4 py-3 text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{roles.map((role) => {
										const isSuperAdminRole = role.role_code === 'super_admin';
										const count = permissionCount(role.permissions);
										return (
											<tr key={role.id} className="hover:bg-gray-50">
												<td className="px-4 py-3">
													<div className="font-medium text-gray-900">
														{role.role_name}
													</div>
													{role.description && (
														<div className="mt-0.5 max-w-md text-xs text-gray-500">
															{role.description}
														</div>
													)}
												</td>
												<td className="px-4 py-3 font-mono text-xs text-gray-600">
													{role.role_code}
												</td>
												<td className="px-4 py-3 text-gray-600">
													{role.department || '—'}
												</td>
												<td className="px-4 py-3 text-gray-600">
													{isSuperAdminRole ? (
														<span className="text-xs font-medium text-amber-700">
															Bypasses permissions
														</span>
													) : (
														`${count} granted`
													)}
												</td>
												<td className="px-4 py-3 text-right">
													{isSuperAdminRole ? (
														<span
															className="text-xs text-gray-400"
															title="Super administrators bypass role permissions"
														>
															No effect
														</span>
													) : (
														<button
															type="button"
															disabled={!canUpdate}
															onClick={() => {
																setSaveError(null);
																setNotice('');
																setEditingRole(role);
															}}
															className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
														>
															<PencilIcon
																className="h-3.5 w-3.5"
																aria-hidden="true"
															/>
															Edit
														</button>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</main>

			<RolePermissionDialog
				open={editingRole !== null}
				roleName={editingRole?.role_name}
				initialPermissions={editingRole?.permissions}
				saving={saving}
				error={saveError}
				onCloseAction={() => {
					if (!saving) setEditingRole(null);
				}}
				onSaveAction={handleSave}
			/>
		</div>
	);
}
