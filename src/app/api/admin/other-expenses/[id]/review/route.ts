import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	resolveOtherExpenseCopy,
	type CopyReviewAction,
} from '@/lib/company-expenditure';

const ACTIONS: readonly CopyReviewAction[] = [
	'confirm_copy',
	'reject_copy',
	'unlink_copy',
];

function actionOf(value: unknown): CopyReviewAction | null {
	const candidate = String(value ?? '').trim() as CopyReviewAction;
	return ACTIONS.includes(candidate) ? candidate : null;
}

/**
 * One review option as text. The module reads these fields through its own
 * string coercion; narrow the raw body value here so the command receives
 * `string | null` instead of an arbitrary JSON value.
 */
function optionalText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text.length === 0 ? null : text;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error';
}

/**
 * A duplicate-reference or link decision. Merging identity is an authorized
 * review act: it needs approval, the expected version, and (for a rejected
 * match) a reason that stays on the record.
 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	if (!id) {
		return NextResponse.json(
			{ success: false, error: 'Missing entry id', code: 'invalid_id' },
			{ status: 400 }
		);
	}

	const body = (await request.json()) as Record<string, unknown>;
	const action = actionOf(body.action);
	if (!action) {
		return NextResponse.json(
			{
				success: false,
				error: `Unknown review action: ${String(body.action ?? '')}`,
				code: 'unknown_review_action',
			},
			{ status: 400 }
		);
	}
	const expectedVersion = Number(body.expected_version);
	if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
		return NextResponse.json(
			{
				success: false,
				error: 'expected_version is required',
				code: 'version_required',
			},
			{ status: 400 }
		);
	}

	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.APPROVE
	);
	if (auth instanceof Response) return auth;
	const user = auth.user;

	try {
		const data = await resolveOtherExpenseCopy(
			{
				id,
				action,
				expected_version: expectedVersion,
				reason: optionalText(body.reason),
				evidence_reference: optionalText(body.evidence_reference),
				target_cost_uid: optionalText(body.target_cost_uid),
			},
			{ id: user?.id ?? null }
		);

		await logActivity({
			userId: user?.id,
			actionType: 'approve',
			resourceType: 'other_expense',
			resourceId: id,
			description: `${action} on other expense ${id}`,
			request,
		});

		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('Error resolving other-expense copy review:', error);
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	}
}
