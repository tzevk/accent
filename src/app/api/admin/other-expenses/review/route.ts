import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	loadOtherExpenseReview,
	type SqlConnection,
} from '@/lib/company-expenditure';

/** The pooled connection the module reads through, as the barrel does. */
const pool: SqlConnection = {
	execute: (statement, params) => query(statement, params)
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unexpected error';
}

/**
 * The review queue: possible duplicate references waiting for a decision,
 * confirmed receipt copies, and entries whose classification or evidence is
 * still unresolved. Unresolved is disclosed, never guessed into a group.
 */
export async function GET(request: Request) {
	const auth = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;

	try {
		const data = await loadOtherExpenseReview(pool);
		return NextResponse.json({ success: true, data });
	} catch (error) {
		console.error('Error reading other-expense review queue:', error);
		return NextResponse.json(
			{ success: false, error: errorMessage(error) },
			{ status: 500 }
		);
	}
}
