import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// GET - Fetch account transactions
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page') || '1');
		const limit = parseInt(searchParams.get('limit') || '20');
		const type = searchParams.get('type');
		const offset = (page - 1) * limit;

		connection = await dbConnect();

		// Build query
		let query = 'SELECT * FROM account_transactions WHERE 1=1';
		const params = [];

		if (type && type !== 'all') {
			query += ' AND type = ?';
			params.push(type);
		}

		// Get total count
		const countQuery = query.replace('*', 'COUNT(*) as total');
		const [countResult] = await connection.execute(countQuery, params);
		const total = countResult?.[0]?.total || 0;

		// Get paginated results
		query +=
			' ORDER BY transaction_date DESC, created_at DESC LIMIT ? OFFSET ?';
		params.push(limit, offset);

		const [transactions] = await connection.execute(query, params);

		// Parse JSON attachments for each transaction
		const parsedTransactions = transactions.map((txn) => ({
			...txn,
			attachments:
				typeof txn.attachments === 'string'
					? JSON.parse(txn.attachments)
					: txn.attachments,
		}));

		// Get stats
		let stats = {
			total: 0,
			income: 0,
			expense: 0,
			pending: 0,
			totalIncome: 0,
			totalExpense: 0,
		};
		try {
			const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN type = 'income' THEN 1 ELSE 0 END) as income,
          SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) as expense,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN type = 'income' AND status = 'completed' THEN amount ELSE 0 END) as totalIncome,
          SUM(CASE WHEN type = 'expense' AND status = 'completed' THEN amount ELSE 0 END) as totalExpense
        FROM account_transactions
      `);
			stats = statsResult[0] || stats;
		} catch (statsError) {
			console.error('Error fetching stats:', statsError);
		}

		return NextResponse.json({
			success: true,
			data: parsedTransactions,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
			stats,
		});
	} catch (error) {
		console.error('Error fetching transactions:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch transactions',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) await connection.end();
	}
}
