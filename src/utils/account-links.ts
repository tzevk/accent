export type AccountOwnership = {
	employee_id?: number | string | null;
	vendor_id?: number | string | null;
	account_type?: string | null;
};

const normalizeId = (value: unknown): number | null | undefined => {
	if (value === null || value === undefined || value === '') return null;
	const id = typeof value === 'number' ? value : Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

export function ownershipChangeRequested(
	requested: AccountOwnership,
	current: AccountOwnership
): boolean {
	for (const key of ['employee_id', 'vendor_id', 'account_type'] as const) {
		if (!Object.prototype.hasOwnProperty.call(requested, key)) continue;
		const next =
			key === 'account_type'
				? (requested[key] ?? null)
				: normalizeId(requested[key]);
		const previous =
			key === 'account_type'
				? (current[key] ?? null)
				: normalizeId(current[key]);
		if (next === undefined || previous === undefined || next !== previous)
			return true;
	}
	return false;
}

export type AccessState = { status?: unknown; is_active?: unknown };
export function resolveAccessState(
	input: AccessState
): { status: 'active' | 'inactive'; is_active: 1 | 0 } | null {
	const status =
		input.status === undefined
			? undefined
			: typeof input.status === 'string'
				? input.status.toLowerCase()
				: null;
	const active =
		input.is_active === undefined
			? undefined
			: typeof input.is_active === 'boolean'
				? input.is_active
				: input.is_active === 1
					? true
					: input.is_active === 0
						? false
						: null;
	if (
		status === null ||
		(status !== undefined && status !== 'active' && status !== 'inactive')
	)
		return null;
	if (active === null) return null;
	if (
		status !== undefined &&
		active !== undefined &&
		(status === 'active') !== active
	)
		return null;
	const enabled = active ?? (status === undefined || status === 'active');
	return {
		status: enabled ? 'active' : 'inactive',
		is_active: enabled ? 1 : 0,
	};
}

export function isAccountLinkConflict(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const details = error as Record<string, unknown>;
	return (
		details.code === 'ER_DUP_ENTRY' ||
		details.errno === 1062 ||
		details.code === 'ER_NO_REFERENCED_ROW_2' ||
		details.errno === 1452
	);
}
