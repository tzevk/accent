'use client';

import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import {
	getRolePermissionGroups,
	parseRolePermissions,
} from '@/lib/role-permissions';

type RolePermissionPanelProps = {
	roleName?: string | null;
	roleCode?: string | null;
	roleId?: number | string | null;
	rolePermissions: unknown;
	canManage: boolean;
	onManageAction: () => void;
};

/**
 * Read-only summary of the permissions inherited from the user's role.
 * These grants are additive and cannot be removed from the user-level editor.
 */
export default function RolePermissionPanel({
	roleName,
	roleCode,
	roleId,
	rolePermissions,
	canManage,
	onManageAction,
}: RolePermissionPanelProps) {
	const permissions = parseRolePermissions(rolePermissions);
	const groups = getRolePermissionGroups(permissions)
		.map((group) => ({
			...group,
			actions: group.actions.filter((action) => action.granted),
		}))
		.filter((group) => group.actions.length > 0);

	const title = roleName
		? `Inherited from role: ${roleName}`
		: 'Inherited role permissions';
	const isSuperAdminRole = roleCode === 'super_admin';

	return (
		<section
			aria-labelledby="role-permission-heading"
			className="mb-6 rounded-xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5"
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 ring-1 ring-inset ring-blue-200">
						<ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
					</div>
					<div>
						<h2
							id="role-permission-heading"
							className="text-sm font-semibold text-gray-900"
						>
							{title}
						</h2>
						<p className="mt-1 max-w-3xl text-xs leading-5 text-gray-600">
							These permissions come from the user&apos;s role and are always
							applied in addition to the user-specific permissions below. They
							cannot be removed here; edit the role instead.
						</p>
					</div>
				</div>
				{canManage &&
					!isSuperAdminRole &&
					roleId !== null &&
					roleId !== undefined && (
						<button
							type="button"
							onClick={onManageAction}
							className="shrink-0 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
						>
							Manage role permissions
						</button>
					)}
			</div>

			{isSuperAdminRole && (
				<p className="mt-2 text-xs font-medium text-amber-700">
					Super administrators bypass role permissions. Changes to this role
					have no effect while the account remains a super administrator.
				</p>
			)}

			{groups.length === 0 ? (
				<p className="mt-3 text-sm text-gray-600">
					This role currently grants no permissions.
				</p>
			) : (
				<ul className="mt-3 flex flex-wrap gap-2" aria-label="Role permissions">
					{groups.map((group) => (
						<li
							key={group.resource}
							className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs text-gray-700"
						>
							<span className="font-semibold text-blue-800">{group.label}</span>
							<span className="text-gray-500">: </span>
							{group.actions.map((action) => action.label).join(', ')}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
