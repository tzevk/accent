import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * GET /api/leaves/balances
 *
 * Leave balance summary for the signed-in user for a given year
 * (query param `year`, defaults to the current year). Returns the active
 * leave types alongside per-type and aggregate balances.
 */
export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEAVES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	const user = authResult.user;
	const { searchParams } = new URL(request.url);
	const rawYear = Number(searchParams.get('year'));
	const year =
		Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100
			? rawYear
			: new Date().getFullYear();

	let db;
	try {
		db = await dbConnect();

		const [userRows] = await db.execute(
			`SELECT employee_id FROM users WHERE id = ? AND isDelete = 0`,
			[user.id]
		);
		const employeeId = userRows[0]?.employee_id ?? null;

		const [types] = await db.execute(
			`SELECT id, name, code, is_paid, default_annual_quota AS quota,
              requires_balance
       FROM leave_types WHERE isDelete = 0 ORDER BY id ASC`
		);

		const usedByType = new Map<number, number>();
		const totalByType = new Map<number, number>();

		if (employeeId) {
			const [balanceRows] = await db.execute(
				`SELECT leave_type_id, total_leaves, used_leaves
         FROM employee_leaves WHERE employee_id = ? AND year = ?`,
				[employeeId, year]
			);
			for (const row of balanceRows) {
				totalByType.set(Number(row.leave_type_id), Number(row.total_leaves));
				usedByType.set(Number(row.leave_type_id), Number(row.used_leaves));
			}
		}

		const withBalances = (types as Array<Record<string, unknown>>).map(
			(type) => {
				const typeId = Number(type.id);
				const requiresBalance = Number(type.requires_balance) === 1;
				const quota = Number(type.quota ?? 0);
				const total = requiresBalance ? (totalByType.get(typeId) ?? quota) : 0;
				const used = requiresBalance ? (usedByType.get(typeId) ?? 0) : 0;
				return {
					id: typeId,
					name: type.name,
					code: type.code,
					is_paid: Number(type.is_paid) === 1,
					requires_balance: requiresBalance,
					quota,
					total,
					used,
					remaining: Math.max(0, total - used),
				};
			}
		);

		const totals = withBalances.reduce(
			(acc, item) => {
				acc.total += item.total;
				acc.used += item.used;
				return acc;
			},
			{ total: 0, used: 0 }
		);

		return NextResponse.json({
			success: true,
			data: {
				year,
				types: withBalances,
				totals: {
					total: totals.total,
					used: totals.used,
					balance: Math.max(0, totals.total - totals.used),
				},
			},
		});
	} catch (error) {
		console.error('Error fetching leave balances:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to fetch leave balances',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
