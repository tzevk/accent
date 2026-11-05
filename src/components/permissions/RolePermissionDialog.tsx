'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
	getRolePermissionGroups,
	parseRolePermissions,
	serializeRolePermissions,
	toggleRolePermission,
} from '@/lib/role-permissions';

type RolePermissionDialogProps = {
	open: boolean;
	roleName?: string | null;
	initialPermissions: unknown;
	saving: boolean;
	error?: string | null;
	onCloseAction: () => void;
	onSaveAction: (permissions: string[]) => void;
};

export default function RolePermissionDialog({
	open,
	roleName,
	initialPermissions,
	saving,
	error,
	onCloseAction,
	onSaveAction,
}: RolePermissionDialogProps) {
	const [draft, setDraft] = useState<string[]>([]);
	const [search, setSearch] = useState('');
	const dialogRef = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onCloseAction);
	const savingRef = useRef(saving);

	useEffect(() => {
		closeRef.current = onCloseAction;
		savingRef.current = saving;
	}, [onCloseAction, saving]);

	useEffect(() => {
		if (!open) return;
		setDraft(parseRolePermissions(initialPermissions));
		setSearch('');
	}, [open, initialPermissions]);

	useEffect(() => {
		if (!open) return;
		const previousFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const dialog = dialogRef.current;
		const focusables = () =>
			Array.from(
				dialog?.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
				) ?? []
			);

		dialog?.querySelector<HTMLInputElement>('#role-permission-search')?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				if (!savingRef.current) closeRef.current();
				return;
			}
			if (event.key !== 'Tab') return;

			const items = focusables();
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			const outside = !dialog?.contains(active);

			if (event.shiftKey && (active === first || outside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || outside)) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			previousFocus?.focus?.();
		};
	}, [open]);

	const groups = useMemo(() => {
		const query = search.trim().toLowerCase();
		return getRolePermissionGroups(draft).filter((group) => {
			if (!query) return true;
			return (
				group.label.toLowerCase().includes(query) ||
				group.resource.toLowerCase().includes(query) ||
				group.actions.some(
					(action) =>
						action.key.toLowerCase().includes(query) ||
						action.label.toLowerCase().includes(query)
				)
			);
		});
	}, [draft, search]);

	if (!open) return null;

	const selectedCount = draft.length;

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !saving) onCloseAction();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="role-permission-dialog-title"
				className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
			>
				<div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
					<div>
						<h2
							id="role-permission-dialog-title"
							className="text-lg font-semibold text-gray-900"
						>
							Manage role permissions
						</h2>
						<p className="mt-1 text-xs leading-5 text-gray-600">
							{roleName ? `Role: ${roleName}. ` : ''}
							Changes apply to every user with this role and take effect when
							saved.
						</p>
					</div>
					<button
						type="button"
						onClick={onCloseAction}
						disabled={saving}
						aria-label="Close role permission editor"
						className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
					>
						<XMarkIcon className="h-5 w-5" aria-hidden="true" />
					</button>
				</div>

				<div className="border-b border-gray-200 px-5 py-3">
					<label htmlFor="role-permission-search" className="sr-only">
						Search role permissions
					</label>
					<div className="relative">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							aria-hidden="true"
						/>
						<input
							id="role-permission-search"
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search resources or actions…"
							className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
						/>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{groups.length === 0 ? (
						<p className="py-8 text-center text-sm text-gray-500">
							No permissions match this search.
						</p>
					) : (
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							{groups.map((group) => (
								<fieldset
									key={group.resource}
									className="rounded-lg border border-gray-200 p-3"
								>
									<legend className="px-1 text-sm font-semibold text-gray-900">
										{group.label}
									</legend>
									<div className="mt-2 space-y-1.5">
										{group.actions.map((action) => (
											<label
												key={action.key}
												className="flex cursor-pointer items-start gap-2 rounded p-1 text-sm text-gray-700 hover:bg-gray-50"
											>
												<input
													type="checkbox"
													aria-label={`${group.label}: ${action.label}`}
													checked={action.granted}
													onChange={() =>
														setDraft((current) =>
															toggleRolePermission(current, action.key)
														)
													}
													className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
												<span>
													<span className="font-medium">{action.label}</span>
													<span className="ml-1 text-xs text-gray-500">
														{action.description}
													</span>
												</span>
											</label>
										))}
									</div>
								</fieldset>
							))}
						</div>
					)}
				</div>

				{error && (
					<div
						role="alert"
						className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
					>
						{error}
					</div>
				)}

				<div className="flex items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3">
					<span className="text-xs text-gray-600">
						{selectedCount} permission{selectedCount === 1 ? '' : 's'} selected
					</span>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onCloseAction}
							disabled={saving}
							className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => onSaveAction(serializeRolePermissions(draft))}
							disabled={saving}
							className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{saving ? 'Saving…' : 'Save role permissions'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
