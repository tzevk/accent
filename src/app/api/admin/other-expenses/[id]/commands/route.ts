import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeOtherExpenseCommand,
	type OtherExpensePatch,
} from '@/lib/company-expenditure';

const COMMANDS = ['update', 'submit', 'recognize', 'reject', 'cancel'] as const;
type CommandName = (typeof COMMANDS)[number];

/** Conversion evidence is module-owned (#319): changing it — or either side of
 * the currency pair it belongs to — is an approval. */
const CONVERSION_PATCH_FIELDS = [
	'currency',
	'reporting_currency',
	'conversion_rate',
	'conversion_date',
	'conversion_evidence_reference'
] as const;

/** Recognizing and rejecting cost need approval; editing needs update. */
function permissionFor(
	command: CommandName,
	patch: OtherExpensePatch | undefined
): string {
	if (command === 'update' || command === 'submit') {
		const touchesConversion =
			patch !== undefined &&
			CONVERSION_PATCH_FIELDS.some((field) => patch[field] !== undefined);
		return touchesConversion ? PERMISSIONS.APPROVE : PERMISSIONS.UPDATE;
	}
	return PERMISSIONS.APPROVE;
}

function commandOf(value: unknown): CommandName | null {
	const candidate = String(value ?? '').trim() as CommandName;
	return (COMMANDS as readonly string[]).includes(candidate) ? candidate : null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error';
}

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
	const command = commandOf(body.command);
	if (!command) {
		return NextResponse.json(
			{
				success: false,
				error: `Unknown command: ${String(body.command ?? '')}`,
				code: 'invalid_command'
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
				code: 'version_required'
			},
			{ status: 400 }
		);
	}

	const patch = body.patch as OtherExpensePatch | undefined;
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		permissionFor(command, patch)
	);
	if (auth instanceof Response) return auth;
	const user = auth.user;

	try {
		const data = await executeOtherExpenseCommand(
			{
				id,
				command,
				expected_version: expectedVersion,
				reason: body.reason ?? null,
				evidence_reference: body.evidence_reference ?? null,
				patch
			},
			{ id: user?.id ?? null }
		);

		await logActivity({
			userId: user?.id,
			actionType: command === 'recognize' ? 'approve' : 'update',
			resourceType: 'other_expense',
			resourceId: id,
			description: `${command} on other expense ${id}`,
			request
		});

		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail
				},
				{ status: error.status }
			);
		}
		console.error('Error applying other-expense command:', error);
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	}
}
