'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api-client';
import type { OwnersResponse } from '@/components/leads/types';
import { leadKeys } from '@/components/leads/queries';
import { cn } from '@/lib/cn';

export interface LeadOwnerOption {
	id: number;
	full_name: string;
}

interface OwnerSelectProps {
	id: string;
	value: number | null;
	onChange: (ownerUserId: number | null) => void;
	disabled?: boolean;
	describedBy?: string;
	intakeLabel?: string;
	className?: string;
	/**
	 * The accessible name of the control. It is an attribute, not a second
	 * visible label: a visually hidden label is positioned absolutely, and
	 * an absolutely positioned label that sits outside a positioned ancestor
	 * leaves the page at the bottom of the document.
	 */
	label?: string;
	/** The control must carry an owner for the form to be complete. */
	required?: boolean;
}

/**
 * Stable Lead Owner selector backed by GET /api/leads/owners.
 * An empty value means unassigned intake, never an invented owner.
 */
export default function OwnerSelect({
	id,
	value,
	onChange,
	disabled = false,
	describedBy,
	intakeLabel = 'Unassigned intake',
	className = '',
	label,
	required = false,
}: OwnerSelectProps) {
	const ownersQuery = useQuery<OwnersResponse>({
		queryKey: leadKeys.owners,
		queryFn: () => apiGet<OwnersResponse>('/api/leads/owners'),
		staleTime: 60_000,
	});
	const rows = Array.isArray(ownersQuery.data?.data)
		? ownersQuery.data.data
		: [];
	const owners = rows.filter(
		(row) => typeof row.id === 'number' && typeof row.full_name === 'string'
	);
	const loading = ownersQuery.isPending;
	const error =
		ownersQuery.error instanceof Error ? ownersQuery.error.message : null;

	if (ownersQuery.isError) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<p className="text-sm text-red-600" role="alert">
					Could not load owners: {error ?? 'Unknown error'}
				</p>
				<button
					type="button"
					onClick={() => void ownersQuery.refetch()}
					className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
				>
					Retry
				</button>
			</div>
		);
	}

	return (
		<select
			id={id}
			value={value === null || value === undefined ? '' : String(value)}
			onChange={(event) => {
				const raw = event.target.value;
				onChange(raw === '' ? null : Number(raw));
			}}
			disabled={disabled || loading}
			aria-describedby={describedBy}
			aria-label={label}
			aria-required={required || undefined}
			required={required}
			className={cn(
				'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent text-sm',
				className
			)}
		>
			<option value="">{loading ? 'Loading owners…' : intakeLabel}</option>
			{owners.map((owner) => (
				<option key={owner.id} value={owner.id}>
					{owner.full_name}
				</option>
			))}
		</select>
	);
}
