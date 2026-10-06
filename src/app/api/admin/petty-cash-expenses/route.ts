import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	fetchPettyCashSummary,
	pettyCashSpendInputFromJson,
	recordPettyCashSpend,
} from '@/lib/company-expenditure';

const TABLE = 'petty_cash_expenses';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const search = searchParams.get('search');
		const unsettled = searchParams.get('unsettled') === 'true';

		db = await dbConnect();

		// ── Build WHERE ──
		const where: string[] = ['pce.isDelete = 0'];
		const params: (string | number)[] = [];

		if (search) {
			const s = `%${search}%`;
			where.push(
				'(pce.transaction_number LIKE ? OR pce.description LIKE ? OR pce.recipient_name LIKE ? OR pce.bill_no LIKE ? OR pce.notes LIKE ?)'
			);
			params.push(s, s, s, s, s);
		}

		if (unsettled) {
			where.push(
				"pce.entry_kind = 'spend' AND pce.source_voucher_id IS NULL AND pce.debit_amount > 0"
			);
		}

		const whereSql = `WHERE ${where.join(' AND ')}`;

		const [rows] = await db.execute(
			`WITH ordered AS (
			  SELECT pce.*, cv.voucher_number as source_voucher_number,
			    SUM(pce.debit_amount - pce.credit_amount)
			      OVER (ORDER BY pce.transaction_date, pce.created_at ROWS UNBOUNDED PRECEDING) as running_balance
			  FROM ${TABLE} pce
			  LEFT JOIN cash_vouchers cv ON pce.source_voucher_id = cv.id
			  ${whereSql}
			)
			SELECT *, ROW_NUMBER() OVER (ORDER BY transaction_date DESC, created_at DESC) as sr_no
			FROM ordered
			ORDER BY transaction_date DESC, created_at DESC`,
			params
		);

		// ── Global stats ──
		const [statsRows] = await db.execute(
			`SELECT
				COALESCE(SUM(debit_amount), 0) as totalDebits,
				COALESCE(SUM(credit_amount), 0) as totalCredits,
				COALESCE(SUM(debit_amount - credit_amount), 0) as balance
			FROM ${TABLE}
			WHERE isDelete = 0`
		);

		// ── Voucher balances for add-dropdown (remaining > 0) ──
		// Only spending draws a voucher down; the funding mirror is the credit
		// side of the voucher itself and never reduces its own balance.
		const [voucherBalances] = await db.execute(
			`SELECT cv.id, cv.voucher_number, cv.total_amount, cv.paid_to, cv.notes, cv.description,
				COALESCE(SUM(CASE WHEN pce.entry_kind = 'spend' THEN pce.debit_amount ELSE 0 END), 0) as total_debited,
				cv.total_amount - COALESCE(SUM(CASE WHEN pce.entry_kind = 'spend' THEN pce.debit_amount ELSE 0 END), 0) as remaining
			FROM cash_vouchers cv
			LEFT JOIN ${TABLE} pce ON pce.source_voucher_id = cv.id AND pce.isDelete = 0
			WHERE (cv.isDelete IS NULL OR cv.isDelete = 0)
			GROUP BY cv.id
			HAVING COALESCE(SUM(CASE WHEN pce.entry_kind = 'spend' THEN pce.debit_amount ELSE 0 END), 0) < cv.total_amount
			ORDER BY cv.voucher_number`
		);

		// Funding, spending, remaining supported funding, and recognized cost,
		// stated separately from the ledger's running balance.
		const funding = await fetchPettyCashSummary(null);

		return NextResponse.json({
			success: true,
			data: rows,
			stats: statsRows[0] || { totalDebits: 0, totalCredits: 0, balance: 0 },
			voucherBalances: voucherBalances || [],
			funding,
		});
	} catch (error) {
		console.error('Error fetching petty cash expenses:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to fetch',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.end();
	}
}

export async function POST(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PETTY_CASH_EXPENSES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const user = authResult.user;

		// One write path: the module mints the number and the cost identity,
		// applies the recognition-period and reference rules (a voucher must
		// exist, a linked cost must resolve), and journals the row.
		const recorded = await recordPettyCashSpend(
			pettyCashSpendInputFromJson(body),
			{ id: user?.id ?? null }
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'petty_cash_expense',
			resourceId: recorded.id,
			description: `Created petty cash ${recorded.transaction_number}: amount ${body.debit_amount ?? body.amount}`,
			request,
		});

		return NextResponse.json({ success: true, data: recorded });
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
		console.error('Error creating petty cash expense:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to create',
			},
			{ status: 500 }
		);
	}
}
